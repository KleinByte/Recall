import type { Database } from "better-sqlite3"
import type { RankedSnapshot } from "../ranked/rank.js"

export class RankedRepository {
  constructor(private readonly db: Database) {}

  /**
   * Stores a standing only when it has actually changed.
   *
   * Syncing runs every few minutes whether or not a game was played, so
   * writing unconditionally would bury a season's progress in thousands of
   * identical rows.
   */
  recordSnapshot(row: RankedSnapshot): boolean {
    const latest = this.getLatest(row.puuid, row.queue)

    const unchanged =
      latest &&
      latest.tier === row.tier &&
      latest.division === row.division &&
      latest.leaguePoints === row.leaguePoints &&
      latest.wins === row.wins &&
      latest.losses === row.losses

    if (unchanged) return false

    this.db
      .prepare(
        `INSERT OR REPLACE INTO ranked_snapshots
           (puuid, queue, recorded_at, tier, division, league_points, wins, losses)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.puuid,
        row.queue,
        row.recordedAt,
        row.tier,
        row.division,
        row.leaguePoints,
        row.wins,
        row.losses,
      )

    return true
  }

  getHistory(puuid: string, queue: string, sinceMs = 0): RankedSnapshot[] {
    return this.db
      .prepare(
        `SELECT puuid, queue, recorded_at AS recordedAt, tier, division,
                league_points AS leaguePoints, wins, losses
         FROM ranked_snapshots
         WHERE puuid = ? AND queue = ? AND recorded_at >= ?
         ORDER BY recorded_at ASC`,
      )
      .all(puuid, queue, sinceMs) as RankedSnapshot[]
  }

  getLatest(puuid: string, queue: string): RankedSnapshot | undefined {
    return this.db
      .prepare(
        `SELECT puuid, queue, recorded_at AS recordedAt, tier, division,
                league_points AS leaguePoints, wins, losses
         FROM ranked_snapshots
         WHERE puuid = ? AND queue = ?
         ORDER BY recorded_at DESC
         LIMIT 1`,
      )
      .get(puuid, queue) as RankedSnapshot | undefined
  }

  getQueues(puuid: string): string[] {
    const rows = this.db
      .prepare(
        "SELECT DISTINCT queue FROM ranked_snapshots WHERE puuid = ?",
      )
      .all(puuid) as { queue: string }[]

    return rows.map((row) => row.queue)
  }
}
