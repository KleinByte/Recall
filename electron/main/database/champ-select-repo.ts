import type { Database } from "better-sqlite3"
import type { ParticipantRow } from "../matches/types.js"

export interface ChampSelectPosition {
  championId: number
  position: string
}

/**
 * Holds the positions champion select assigned to the local team.
 *
 * Ranked lobbies hide teammate identities during selection, so a champion id
 * is the only stable way to tie an assignment back to a player once the match
 * is recorded.
 */
export class ChampSelectRepository {
  constructor(private readonly db: Database) {}

  record(gameId: number, puuid: string, positions: ChampSelectPosition[]) {
    const usable = positions.filter(
      (entry) => entry.championId > 0 && entry.position.length > 0,
    )
    if (usable.length === 0) return 0

    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO champ_select_positions
       (game_id, puuid, champion_id, position, captured_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    const capturedAt = Date.now()

    return this.db.transaction((batch: ChampSelectPosition[]) => {
      let written = 0
      for (const entry of batch) {
        written += insert.run(
          gameId,
          puuid,
          entry.championId,
          entry.position,
          capturedAt,
        ).changes
      }
      return written
    })(usable)
  }

  positionsFor(gameId: number, puuid: string): Map<number, string> {
    const rows = this.db.prepare(
      `SELECT champion_id AS championId, position
       FROM champ_select_positions
       WHERE game_id = ? AND puuid = ?`,
    ).all(gameId, puuid) as ChampSelectPosition[]

    return new Map(rows.map((row) => [row.championId, row.position]))
  }

  /**
   * Champion select only states positions for the local team, and identifies
   * those players by champion rather than by name, so the assignment is
   * matched back to the owner's side of the lobby by champion id.
   *
   * Lobby writes replace the whole row, so this runs before every one of them
   * rather than only on the write that first recorded the match.
   */
  stamp(gameId: number | undefined, puuid: string, rows: ParticipantRow[]) {
    if (!gameId) return

    const assigned = this.positionsFor(gameId, puuid)
    if (assigned.size === 0) return

    const ownTeam = rows.find((row) => row.isPlayer === 1)?.teamId
    for (const row of rows) {
      if (row.teamId !== ownTeam) continue
      row.assignedPosition = assigned.get(row.championId)
    }
  }

  deleteAll(puuid: string) {
    return this.db
      .prepare("DELETE FROM champ_select_positions WHERE puuid = ?")
      .run(puuid).changes
  }
}
