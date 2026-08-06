import type { Database } from "better-sqlite3"
import type { BackupManifest } from "./backup-manager.js"

export const ACCOUNT_SCOPED_DELETE_ORDER = [
  "match_enrichment_jobs", "history_remediation_runs", "riot_history_run_matches",
  "riot_history_runs", "riot_match_ingestion", "riot_history_backfill",
  "augment_enrichment_jobs", "match_performance_label_versions",
  "match_label_evaluation_versions", "match_grade_breakdown_versions",
  "match_grade_results", "match_grade_attempts", "participant_augments",
  "match_annotation_tags", "match_experiments", "match_grade_breakdowns",
  "session_boundary_overrides", "match_timeline_cache", "match_annotations",
  "match_capture_manifests", "match_performance_labels", "match_label_evaluations",
  "match_source_capture_payloads", "match_source_captures", "match_timeline_sources",
  "match_source_payloads", "live_capture_compactions", "live_game_events",
  "live_game_snapshots", "champ_select_positions", "match_participants", "match_teams",
  "matches", "annotation_tags", "practice_experiments", "challenge_history", "challenges",
  "profile_snapshots", "ranked_snapshots", "goals", "champion_mastery_cache",
  "sync_health", "riot_accounts",
] as const

export class ClearHistoryService {
  constructor(private readonly db: Database) {}

  clear(puuid: string, backup: BackupManifest): { deleted: number; recoveryPoint: string } {
    if (backup.reason !== "pre-clear" || backup.integrity !== "ok" ||
        backup.protection.kind !== "until_user_deletes") {
      throw new Error("verified_pre_clear_backup_required")
    }
    const schema = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'",
    ).all() as { name: string }[]
    const present = new Set(schema.map((row) => row.name))
    let deleted = 0
    this.db.exec("BEGIN IMMEDIATE")
    try {
      for (const table of ACCOUNT_SCOPED_DELETE_ORDER) {
        if (!present.has(table)) continue
        const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
        const names = new Set(columns.map((row) => row.name))
        const ownerColumn = names.has("puuid") ? "puuid" : names.has("owner_puuid") ? "owner_puuid" : undefined
        if (!ownerColumn) throw new Error(`account_scope_column_missing:${table}`)
        deleted += this.db.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} = ?`).run(puuid).changes
      }
      const remaining = ACCOUNT_SCOPED_DELETE_ORDER.reduce((sum, table) => {
        if (!present.has(table)) return sum
        const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
        const names = new Set(columns.map((row) => row.name))
        const ownerColumn = names.has("puuid") ? "puuid" : names.has("owner_puuid") ? "owner_puuid" : undefined
        return sum + (ownerColumn ? Number((this.db.prepare(
          `SELECT COUNT(*) AS count FROM ${table} WHERE ${ownerColumn} = ?`,
        ).get(puuid) as { count: number }).count) : 0)
      }, 0)
      if (remaining) throw new Error("account_rows_remain_after_clear")
      if ((this.db.pragma("foreign_key_check") as unknown[]).length) throw new Error("foreign_key_check_failed")
      this.db.exec("COMMIT")
      return { deleted, recoveryPoint: backup.fileName }
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
  }
}
