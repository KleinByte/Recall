import type { Database } from "better-sqlite3"
import { statSync } from "node:fs"
import type { BackupManager } from "./backup-manager.js"
import { schedulerForRoute } from "../riot/request-scheduler.js"
import {
  MATCH_GRADE_ALGORITHM_VERSION,
  MATCH_GRADE_RECIPE_DEFINITION_ID,
} from "../matches/match-grade-recipe.js"

export class DataTrustService {
  private lastIntegrityCheck = Date.now()
  private lastIntegrity: "ok" | "failed" | "unknown" = "ok"
  private startupError?: string

  constructor(
    private readonly db: Database,
    private readonly databasePath: string,
    private readonly backups: BackupManager,
  ) {}

  check() {
    this.lastIntegrityCheck = Date.now()
    this.lastIntegrity =
      this.db.pragma("quick_check", { simple: true }) === "ok" ? "ok" : "failed"
    return this.lastIntegrity
  }

  setStartupError(message: string) {
    this.startupError = message
  }

  report(puuid?: string, keyConfigured = false, keyProtected = false) {
    const account = puuid
      ? this.db.prepare(
        `SELECT regional_route AS route FROM riot_accounts WHERE puuid = ?`,
      ).get(puuid) as { route: string } | undefined
      : undefined
    const counts = puuid
      ? this.db.prepare(
        `SELECT COUNT(*) AS matchCount, MIN(played_at) AS oldestPlayedAt,
                MAX(played_at) AS newestPlayedAt,
                COUNT(grade) AS graded,
                (SELECT COUNT(*) FROM (
                   SELECT game_id FROM match_participants
                   WHERE puuid = ?
                   GROUP BY game_id
                   HAVING COUNT(*) >= 10
                 )) AS complete,
                (SELECT COUNT(*) FROM match_timeline_cache
                 WHERE puuid = ? AND status = 'ready') AS timelines,
                (SELECT COUNT(*) FROM match_capture_manifests
                 WHERE puuid = ?) AS captured,
                (SELECT COUNT(DISTINCT game_id) FROM participant_augments
                 WHERE puuid = ?) AS augmentMatches,
                (SELECT COUNT(*) FROM match_capture_manifests
                 WHERE puuid = ? AND unknown_field_names_json <> '[]') AS drifted
         FROM matches WHERE puuid = ?`,
      ).get(puuid, puuid, puuid, puuid, puuid, puuid) as {
        matchCount: number
        oldestPlayedAt: number | null
        newestPlayedAt: number | null
        graded: number
        complete: number
        timelines: number
        captured: number
        augmentMatches: number
        drifted: number
      }
      : {
        matchCount: 0, oldestPlayedAt: null, newestPlayedAt: null,
        graded: 0, complete: 0, timelines: 0, captured: 0,
        augmentMatches: 0, drifted: 0,
      }
    const syncRows = puuid
      ? this.db.prepare(
        `SELECT source, first_observed_at AS firstObservedAt,
                last_attempt_at AS lastAttemptAt, last_success_at AS lastSuccessAt,
                last_error AS lastError, items_seen AS itemsSeen,
                items_written AS itemsWritten
         FROM sync_health WHERE puuid = ?`,
      ).all(puuid) as Array<Record<string, unknown>>
      : []
    const sync = (source: string) => {
      const row = syncRows.find((entry) => entry.source === source)
      return {
        source,
        firstObservedAt: row?.firstObservedAt,
        lastAttemptAt: row?.lastAttemptAt,
        lastSuccessAt: row?.lastSuccessAt,
        lastError: row?.lastError,
        itemsSeen: Number(row?.itemsSeen ?? 0),
        itemsWritten: Number(row?.itemsWritten ?? 0),
        running: false,
      }
    }
    const history = puuid
      ? this.db.prepare(
        `SELECT status,
                COALESCE(coverage_through_seconds, end_time_seconds) AS endTimeSeconds,
                ids_scanned AS idsScanned, matches_downloaded AS downloaded,
                matches_imported AS imported, matches_skipped AS skipped,
                last_error AS lastError
         FROM riot_history_backfill WHERE puuid = ?
         ORDER BY updated_at DESC LIMIT 1`,
      ).get(puuid) as Record<string, unknown> | undefined
      : undefined
    const leagueClient = sync("league_client")
    const riotSync = sync("riot_history")
    if (history?.lastError) riotSync.lastError = history.lastError
    riotSync.running = history?.status === "running"
    const unresolved =
      Boolean(leagueClient.lastError) ||
      (keyConfigured && Boolean(riotSync.lastError))
    const state = this.lastIntegrity === "failed" || unresolved || this.startupError
      ? "needs_attention"
      : riotSync.running
        ? "syncing"
        : !keyConfigured
          ? "local_only"
          : "healthy"
    const rateLimits = account?.route
      ? schedulerForRoute(account.route).snapshot()
      : []
    const scalar = (sql: string, ...parameters: unknown[]) => {
      if (!puuid) return 0
      try { return Number((this.db.prepare(sql).get(...parameters) as { count: number }).count) }
      catch { return 0 }
    }
    const selectedGradeRecipe = puuid ? this.db.prepare(`
      SELECT r.recipe_id AS recipeId
      FROM grade_recipe_selections s
      JOIN grade_recipes r
        ON r.algorithm_version = s.algorithm_version
       AND r.recipe_id = s.recipe_id
      WHERE s.algorithm_version = ?
        AND r.calibration_id IS NOT NULL
        AND r.recipe_id NOT LIKE 'legacy:%'
        AND json_extract(r.definition_json, '$.recipeDefinitionId') = ?
        AND r.recipe_id = ? || '@calibration:' || r.calibration_id
    `).get(
      MATCH_GRADE_ALGORITHM_VERSION,
      MATCH_GRADE_RECIPE_DEFINITION_ID,
      MATCH_GRADE_RECIPE_DEFINITION_ID,
    ) as { recipeId: string } | undefined : undefined
    const gradeEligible = selectedGradeRecipe ? scalar(
      `SELECT COUNT(*) AS count FROM match_grade_attempts
       WHERE puuid = ? AND algorithm_version = ? AND recipe_id = ?
         AND grade_status = 'ready'`, puuid, MATCH_GRADE_ALGORITHM_VERSION,
      selectedGradeRecipe.recipeId,
    ) : 0
    const currentGrades = selectedGradeRecipe ? scalar(
      `SELECT COUNT(*) AS count FROM matches
       WHERE puuid = ? AND grade_status = 'ready' AND grade_algorithm_version = ?
         AND grade_recipe_id = ?`, puuid, MATCH_GRADE_ALGORITHM_VERSION,
      selectedGradeRecipe.recipeId,
    ) : 0
    const selectedRviRecipe = puuid ? this.db.prepare(`
      SELECT recipe.recipe_id AS recipeId
      FROM rvi_recipe_selections selection
      JOIN rvi_recipes recipe
        ON recipe.algorithm_version = selection.algorithm_version
       AND recipe.recipe_id = selection.recipe_id
      JOIN grade_recipe_selections grade_selection
        ON grade_selection.algorithm_version = recipe.algorithm_version
       AND grade_selection.recipe_id = recipe.grade_recipe_id
      JOIN grade_recipes grade_recipe
        ON grade_recipe.recipe_id = recipe.grade_recipe_id
       AND grade_recipe.calibration_id = recipe.calibration_id
      WHERE selection.algorithm_version = ?
    `).get(MATCH_GRADE_ALGORITHM_VERSION) as { recipeId: string } | undefined : undefined
    const rviObservationMatches = selectedRviRecipe ? scalar(
      `SELECT COUNT(DISTINCT game_id) AS count
       FROM match_metric_observations
       WHERE puuid = ? AND algorithm_version = ? AND recipe_id = ?`,
      puuid,
      MATCH_GRADE_ALGORITHM_VERSION,
      selectedRviRecipe.recipeId,
    ) : 0
    const mixedRviObservations = scalar(
      `SELECT COUNT(*) AS count
       FROM match_metric_observations observation
       LEFT JOIN rvi_recipe_selections selection
         ON selection.algorithm_version = observation.algorithm_version
        AND selection.recipe_id = observation.recipe_id
       LEFT JOIN rvi_recipes recipe
         ON recipe.algorithm_version = observation.algorithm_version
        AND recipe.recipe_id = observation.recipe_id
        AND recipe.calibration_id = observation.calibration_id
       WHERE observation.puuid = ? AND observation.algorithm_version = ?
         AND (selection.recipe_id IS NULL OR recipe.recipe_id IS NULL)`,
      puuid,
      MATCH_GRADE_ALGORITHM_VERSION,
    )
    const invalidRviSelection = puuid && !selectedRviRecipe ? Number((this.db.prepare(`
      SELECT EXISTS (
        SELECT 1 FROM rvi_recipe_selections WHERE algorithm_version = ?
      ) AS count
    `).get(MATCH_GRADE_ALGORITHM_VERSION) as { count: number }).count) : 0
    const rviRecipeIntegrityIssues = mixedRviObservations + invalidRviSelection
    const intentionallyUngraded = selectedGradeRecipe ? scalar(
      `SELECT COUNT(*) AS count FROM match_grade_attempts
       WHERE puuid = ? AND algorithm_version = ? AND recipe_id = ?
         AND grade_status IN
         ('unsupported_mode','short_game','terminated','ineligible_for_progression',
          'unmatched','bot_or_tutorial')`, puuid, MATCH_GRADE_ALGORITHM_VERSION,
      selectedGradeRecipe.recipeId,
    ) : 0
    const clientStatus = this.lastIntegrity === "failed" || this.startupError || leagueClient.lastError
      ? "needs_attention" as const : "healthy" as const
    const optionalStatus = !keyConfigured ? "not_configured" as const :
      /\b(?:401|403|expired)\b/i.test(String(riotSync.lastError ?? "")) ? "key_expired" as const :
        history?.status === "running" ? "running" as const :
          history?.lastError ? "needs_attention" as const : "configured" as const
    return {
      state: rviRecipeIntegrityIssues > 0 ? "needs_attention" as const : state,
      clientHealth: {
        status: clientStatus,
        totalStoredMatches: counts.matchCount,
        eligibleStatisticalMatches: scalar(
          `SELECT COUNT(*) AS count FROM matches
           WHERE puuid = ? AND is_matched = 1 AND duration_secs >= 300
             AND mode_family IN ('sr','aram','classic')`, puuid,
        ),
        gradableMatches: gradeEligible,
        currentVersionEligibleGrades: currentGrades,
        intentionallyUngradedModes: intentionallyUngraded,
        gradeCoverage: gradeEligible ? currentGrades / gradeEligible : null,
        selectedRviRecipeId: selectedRviRecipe?.recipeId,
        rviObservationMatches,
        rviRecipeIntegrityIssues,
        endpoint: leagueClient,
      },
      optionalHistory: {
        status: optionalStatus,
        configured: keyConfigured,
        route: account?.route,
        idsDiscovered: Number(history?.idsScanned ?? 0),
        detailReady: Number(history?.downloaded ?? 0),
        imported: Number(history?.imported ?? 0),
        unresolved: Number(history?.skipped ?? 0),
        range: {
          earliestVerifiedAt: leagueClient.firstObservedAt,
          latestVerifiedAt: counts.newestPlayedAt ?? undefined,
          requestedThrough: typeof history?.endTimeSeconds === "number"
            ? history.endTimeSeconds * 1000 : undefined,
        },
        resumePosition: Number(history?.idsScanned ?? 0),
        pauseReason: optionalStatus === "key_expired" ? "key_expired" :
          history?.lastError ? String(history.lastError) : undefined,
      },
      database: {
        path: this.databasePath,
        sizeBytes: statSync(this.databasePath).size,
        schemaVersion: this.db.pragma("user_version", { simple: true }) as number,
        matchCount: counts.matchCount,
        oldestPlayedAt: counts.oldestPlayedAt ?? undefined,
        newestPlayedAt: counts.newestPlayedAt ?? undefined,
        completeScoreboardPercent: counts.matchCount
          ? 100 * counts.complete / counts.matchCount
          : 0,
        gradedPercent: counts.matchCount ? 100 * currentGrades / counts.matchCount : 0,
        timelineCount: counts.timelines,
        captureManifestPercent: counts.matchCount
          ? 100 * counts.captured / counts.matchCount
          : 0,
        augmentMatchCount: counts.augmentMatches,
        schemaDriftMatchCount: counts.drifted,
        lastIntegrityCheck: this.lastIntegrityCheck,
        integrity: this.lastIntegrity,
      },
      leagueClient,
      riotHistory: {
        ...riotSync,
        keyConfigured,
        keyProtected,
        route: account?.route,
        coverage: {
          status: history?.status === "complete"
            ? "complete"
            : history?.status === "running"
              ? "running"
              : history?.lastError
                ? "needs_attention"
                : "observed",
          through: typeof history?.endTimeSeconds === "number"
            ? history.endTimeSeconds * 1000
            : undefined,
          firstObservedAt: leagueClient.firstObservedAt,
          idsScanned: Number(history?.idsScanned ?? 0),
          downloaded: Number(history?.downloaded ?? 0),
          imported: Number(history?.imported ?? 0),
          skipped: Number(history?.skipped ?? 0),
        },
        rateLimits,
        nextEligibleAt: Math.max(
          0,
          ...rateLimits
            .filter((window) => window.used >= window.limit)
            .map((window) => window.resetsAt ?? 0),
        ) || undefined,
      },
      backups: this.backups.list(),
    }
  }

  recordSync(
    puuid: string,
    source: "league_client" | "riot_history" | "riot_timeline",
    result: { success: boolean; seen?: number; written?: number; error?: string },
  ) {
    const now = Date.now()
    this.db.prepare(
      `INSERT INTO sync_health
       (puuid, source, first_observed_at, last_attempt_at, last_success_at,
        last_error_at, last_error, items_seen, items_written)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(puuid, source) DO UPDATE SET
         last_attempt_at = excluded.last_attempt_at,
         last_success_at = CASE WHEN excluded.last_error IS NULL
           THEN excluded.last_success_at ELSE sync_health.last_success_at END,
         last_error_at = excluded.last_error_at,
         last_error = excluded.last_error,
         items_seen = excluded.items_seen,
         items_written = excluded.items_written`,
    ).run(
      puuid,
      source,
      now,
      now,
      result.success ? now : null,
      result.error ? now : null,
      result.error ?? null,
      result.seen ?? 0,
      result.written ?? 0,
    )
  }

  recordAttempt(
    puuid: string,
    source: "league_client" | "riot_history" | "riot_timeline",
  ) {
    const now = Date.now()
    this.db.prepare(
      `INSERT INTO sync_health
       (puuid, source, first_observed_at, last_attempt_at, items_seen, items_written)
       VALUES (?, ?, ?, ?, 0, 0)
       ON CONFLICT(puuid, source) DO UPDATE SET
         last_attempt_at = excluded.last_attempt_at`,
    ).run(puuid, source, now, now)
  }
}
