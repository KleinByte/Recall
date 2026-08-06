import type { Database } from "better-sqlite3"
import { RepairNotificationCoalescer, type RepairNotification } from "./repair-notifications.js"

export const REMEDIATION_BATCH_LIMIT = 100
export const REMEDIATION_TARGETS = Object.freeze({ grade: 3, label: 3, rvi: 3, report: 3 })

export type RemediationSourcePolicy = "local_only" | "explicit_match_v5"

export interface RemediationPreflight {
  puuid: string
  sourcePolicy: RemediationSourcePolicy
  storedMatches: number
  legacySourceRows: number
  staleGradeRows: number
  partialGradePairs: number
  estimatedRows: number
  estimatedBackupBytes: number
}

export interface RemediationBundleResult {
  changed: boolean
  unresolved?: boolean
  categories?: string[]
}

export interface RemediationHandlers {
  /** Repair/remap retained local evidence before this callback returns. */
  repairBundle(gameId: number, puuid: string, sourcePolicy: RemediationSourcePolicy): RemediationBundleResult
  invalidateQueries?(puuid: string): void
}

export class HistoryRemediationService {
  private readonly notifications: RepairNotificationCoalescer

  constructor(
    private readonly db: Database,
    private readonly handlers: RemediationHandlers,
    publish: (notification: RepairNotification) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.notifications = new RepairNotificationCoalescer(publish)
  }

  preflight(puuid: string, sourcePolicy: RemediationSourcePolicy): RemediationPreflight {
    const value = (sql: string, ...parameters: unknown[]) => {
      try { return Number((this.db.prepare(sql).get(...parameters) as { count: number }).count) }
      catch { return 0 }
    }
    const storedMatches = value("SELECT COUNT(*) AS count FROM matches WHERE puuid = ?", puuid)
    const legacySourceRows = value(
      `SELECT COUNT(*) AS count FROM matches m
       WHERE m.puuid = ? AND NOT EXISTS (
         SELECT 1 FROM match_source_captures c
         WHERE c.game_id = m.game_id AND c.puuid = m.puuid
       )`, puuid,
    )
    const staleGradeRows = value(
      `SELECT COUNT(*) AS count FROM matches
       WHERE puuid = ? AND grade IS NOT NULL
         AND COALESCE(grade_algorithm_version, 0) <> ?`, puuid, REMEDIATION_TARGETS.grade,
    )
    const partialGradePairs = value(
      `SELECT COUNT(*) AS count FROM matches
       WHERE puuid = ? AND ((grade IS NULL) <> (grade_score IS NULL))`, puuid,
    )
    return {
      puuid,
      sourcePolicy,
      storedMatches,
      legacySourceRows,
      staleGradeRows,
      partialGradePairs,
      estimatedRows: storedMatches,
      estimatedBackupBytes: Number(this.db.pragma("page_count", { simple: true })) *
        Number(this.db.pragma("page_size", { simple: true })),
    }
  }

  start(
    puuid: string,
    sourcePolicy: RemediationSourcePolicy,
    verifiedBackup: { path: string; sha256: string },
    startingVersions: Record<string, number>,
  ): number {
    if (!verifiedBackup.path || !/^[a-f0-9]{64}$/.test(verifiedBackup.sha256)) {
      throw new Error("verified_pre_repair_backup_required")
    }
    if (this.db.pragma("quick_check", { simple: true }) !== "ok") throw new Error("quick_check_failed")
    const foreignKeys = this.db.pragma("foreign_key_check") as unknown[]
    if (foreignKeys.length) throw new Error("foreign_key_check_failed")
    const at = this.now()
    return Number(this.db.prepare(
      `INSERT INTO history_remediation_runs
       (puuid, source_policy, status, stage, target_grade_version,
        target_label_version, target_rvi_version, target_report_version,
        starting_versions_json, backup_path, backup_sha256, started_at, updated_at)
       VALUES (?, ?, 'pending', 'preflight', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(puuid, sourcePolicy, REMEDIATION_TARGETS.grade, REMEDIATION_TARGETS.label,
      REMEDIATION_TARGETS.rvi, REMEDIATION_TARGETS.report,
      JSON.stringify(startingVersions), verifiedBackup.path, verifiedBackup.sha256, at, at).lastInsertRowid)
  }

  runNextBatch(runId: number): { status: "running" | "complete" | "complete_with_unresolved"; processed: number } {
    const run = this.db.prepare(
      `SELECT id, puuid, source_policy AS sourcePolicy, last_game_id AS lastGameId,
              unresolved_count AS unresolvedCount
       FROM history_remediation_runs
       WHERE id = ? AND status IN ('pending','running','paused')`,
    ).get(runId) as { id: number; puuid: string; sourcePolicy: RemediationSourcePolicy;
      lastGameId: number | null; unresolvedCount: number } | undefined
    if (!run) throw new Error("remediation_run_not_resumable")
    const matches = this.db.prepare(
      `SELECT game_id AS gameId FROM matches
       WHERE puuid = ? AND game_id > ? ORDER BY game_id LIMIT ?`,
    ).all(run.puuid, run.lastGameId ?? -1, REMEDIATION_BATCH_LIMIT) as { gameId: number }[]
    if (!matches.length) {
      const status = run.unresolvedCount ? "complete_with_unresolved" : "complete"
      const at = this.now()
      this.db.prepare(
        `UPDATE history_remediation_runs SET status = ?, stage = 'verify',
          terminal_reason = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
      ).run(status, status, at, at, runId)
      this.handlers.invalidateQueries?.(run.puuid)
      return { status, processed: 0 }
    }
    const batch = this.notifications.begin()
    let changed = 0
    let unresolved = 0
    const transaction = this.db.transaction(() => {
      this.db.prepare(
        `UPDATE history_remediation_runs SET status = 'running', stage = 'remap',
          updated_at = ? WHERE id = ?`,
      ).run(this.now(), runId)
      for (const match of matches) {
        const result = this.handlers.repairBundle(match.gameId, run.puuid, run.sourcePolicy)
        if (result.changed) {
          changed += 1
          for (const category of result.categories ?? ["source_facts"]) {
            batch.record({ gameId: match.gameId, category,
              version: category === "grade" ? { key: "grade", value: 3 } : undefined })
          }
        }
        if (result.unresolved) unresolved += 1
      }
      this.db.prepare(
        `UPDATE history_remediation_runs
         SET stage = 'invalidate_queries', last_game_id = ?, last_game_puuid = ?,
             processed_count = processed_count + ?, changed_count = changed_count + ?,
             unresolved_count = unresolved_count + ?, updated_at = ? WHERE id = ?`,
      ).run(matches.at(-1)!.gameId, run.puuid, matches.length, changed, unresolved, this.now(), runId)
    })
    try {
      transaction()
      this.handlers.invalidateQueries?.(run.puuid)
      batch.commit()
      return { status: "running", processed: matches.length }
    } catch (error) {
      batch.rollback()
      throw error
    }
  }
}
