import type { Database } from "better-sqlite3"
import { statSync } from "node:fs"
import type { BackupManager } from "./backup-manager.js"
import { schedulerForRoute } from "../riot/request-scheduler.js"

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
    return {
      state,
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
        gradedPercent: counts.matchCount ? 100 * counts.graded / counts.matchCount : 0,
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
