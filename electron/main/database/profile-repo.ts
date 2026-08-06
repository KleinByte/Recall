import type { Database } from "better-sqlite3"
import type { ProfileSnapshotRow } from "../challenges/types.js"

export class ProfileRepository {
  constructor(private readonly db: Database) {}

  /**
   * Stores a snapshot only when its complete source fingerprint has moved.
   *
   * Syncing runs every few minutes, so writing unconditionally would fill the
   * table with identical rows and make any trend unreadable.
   */
  recordSnapshot(row: ProfileSnapshotRow): boolean {
    const latest = this.getLatest(row.puuid)
    if (latest && latest.totalScore === row.totalScore &&
        latest.overallLevel === row.overallLevel && latest.percentile === row.percentile &&
        latest.categoryJson === row.categoryJson) return false

    this.db
      .prepare(
        `INSERT INTO profile_snapshots
           (puuid, recorded_at, overall_level, total_score, percentile, category_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(puuid, recorded_at) DO UPDATE SET
           overall_level = excluded.overall_level,
           total_score = excluded.total_score,
           percentile = excluded.percentile,
           category_json = excluded.category_json`,
      )
      .run(
        row.puuid,
        row.recordedAt,
        row.overallLevel,
        row.totalScore,
        row.percentile,
        row.categoryJson,
      )

    return true
  }

  getLatest(puuid: string): ProfileSnapshotRow | undefined {
    const row = this.db
      .prepare(
        `SELECT puuid, recorded_at AS recordedAt, overall_level AS overallLevel,
                total_score AS totalScore, percentile,
                category_json AS categoryJson
         FROM profile_snapshots
         WHERE puuid = ?
         ORDER BY recorded_at DESC
         LIMIT 1`,
      )
      .get(puuid) as ProfileSnapshotRow | undefined

    return row
  }

  getTrend(puuid: string, sinceMs = 0): ProfileSnapshotRow[] {
    return this.db
      .prepare(
        `SELECT puuid, recorded_at AS recordedAt, overall_level AS overallLevel,
                total_score AS totalScore, percentile,
                category_json AS categoryJson
         FROM profile_snapshots
         WHERE puuid = ? AND recorded_at >= ?
         ORDER BY recorded_at ASC`,
      )
      .all(puuid, sinceMs) as ProfileSnapshotRow[]
  }
}
