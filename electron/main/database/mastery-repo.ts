import type { Database } from "better-sqlite3"
import type { ChampionMasterySnapshot } from "../matches/types.js"

interface StoredMasteryRow {
  championId: number
  championLevel: number
  championPoints: number
  championPointsSinceLastLevel: number
  championPointsUntilNextLevel: number
  tokensEarned: number
  highestGrade: string | null
  updatedAt: number
}

export class MasteryRepository {
  constructor(private readonly db: Database) {}

  get(
    ownerPuuid: string,
    participantPuuid: string,
    championId: number,
  ): ChampionMasterySnapshot | undefined {
    const row = this.db.prepare(
      `SELECT champion_id AS championId, champion_level AS championLevel,
              champion_points AS championPoints,
              champion_points_since_last_level AS championPointsSinceLastLevel,
              champion_points_until_next_level AS championPointsUntilNextLevel,
              tokens_earned AS tokensEarned, highest_grade AS highestGrade,
              updated_at AS updatedAt
       FROM champion_mastery_cache
       WHERE owner_puuid = ? AND participant_puuid = ? AND champion_id = ?`,
    ).get(ownerPuuid, participantPuuid, championId) as StoredMasteryRow | undefined

    return row ? { ...row, highestGrade: row.highestGrade ?? undefined } : undefined
  }

  upsert(
    ownerPuuid: string,
    participantPuuid: string,
    mastery: ChampionMasterySnapshot,
  ) {
    this.db.prepare(
      `INSERT INTO champion_mastery_cache
       (owner_puuid, participant_puuid, champion_id, champion_level,
        champion_points, champion_points_since_last_level,
        champion_points_until_next_level, tokens_earned, highest_grade, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_puuid, participant_puuid, champion_id) DO UPDATE SET
         champion_level = excluded.champion_level,
         champion_points = excluded.champion_points,
         champion_points_since_last_level = excluded.champion_points_since_last_level,
         champion_points_until_next_level = excluded.champion_points_until_next_level,
         tokens_earned = excluded.tokens_earned,
         highest_grade = excluded.highest_grade,
         updated_at = excluded.updated_at`,
    ).run(
      ownerPuuid,
      participantPuuid,
      mastery.championId,
      mastery.championLevel,
      mastery.championPoints,
      mastery.championPointsSinceLastLevel,
      mastery.championPointsUntilNextLevel,
      mastery.tokensEarned,
      mastery.highestGrade ?? null,
      mastery.updatedAt,
    )
  }

  deleteAll(ownerPuuid: string) {
    return this.db.prepare(
      "DELETE FROM champion_mastery_cache WHERE owner_puuid = ?",
    ).run(ownerPuuid).changes
  }
}
