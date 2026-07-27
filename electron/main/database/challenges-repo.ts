import type { Database } from "better-sqlite3"
import type {
  ChallengeHistoryRow,
  ChallengeRow,
} from "../challenges/types.js"

export interface ChallengeFilter {
  puuid: string
  category?: string
  level?: string
  includeRetired?: boolean
  idListType?: string
  search?: string
}

const COLUMNS = [
  "challenge_id",
  "puuid",
  "name",
  "description",
  "category",
  "id_list_type",
  "game_modes",
  "current_level",
  "next_level",
  "current_value",
  "current_threshold",
  "next_threshold",
  "thresholds",
  "percentile",
  "points_awarded",
  "is_capstone",
  "is_apex",
  "is_retired",
  "parent_id",
  "icon_path",
  "completed_ids",
  "updated_at",
] as const

const UPSERT_SQL = `
  INSERT INTO challenges (${COLUMNS.join(", ")})
  VALUES (${COLUMNS.map(() => "?").join(", ")})
  ON CONFLICT (challenge_id, puuid) DO UPDATE SET
    name              = excluded.name,
    description       = excluded.description,
    category          = excluded.category,
    id_list_type      = excluded.id_list_type,
    game_modes        = excluded.game_modes,
    current_level     = excluded.current_level,
    next_level        = excluded.next_level,
    current_value     = excluded.current_value,
    current_threshold = excluded.current_threshold,
    next_threshold    = excluded.next_threshold,
    thresholds        = excluded.thresholds,
    percentile        = excluded.percentile,
    points_awarded    = excluded.points_awarded,
    is_capstone       = excluded.is_capstone,
    is_apex           = excluded.is_apex,
    is_retired        = excluded.is_retired,
    parent_id         = excluded.parent_id,
    icon_path         = excluded.icon_path,
    completed_ids     = excluded.completed_ids,
    updated_at        = excluded.updated_at
`

const toValues = (row: ChallengeRow) => [
  row.challengeId,
  row.puuid,
  row.name,
  row.description,
  row.category,
  row.idListType,
  row.gameModes,
  row.currentLevel,
  row.nextLevel,
  row.currentValue,
  row.currentThreshold,
  row.nextThreshold,
  row.thresholds,
  row.percentile,
  row.pointsAwarded,
  row.isCapstone,
  row.isApex,
  row.isRetired,
  row.parentId,
  row.iconPath,
  row.completedIds,
  row.updatedAt,
]

const toRow = (row: Record<string, never>): ChallengeRow => ({
  challengeId: row.challenge_id,
  puuid: row.puuid,
  name: row.name,
  description: row.description,
  category: row.category,
  idListType: row.id_list_type,
  gameModes: row.game_modes,
  currentLevel: row.current_level,
  nextLevel: row.next_level,
  currentValue: row.current_value,
  currentThreshold: row.current_threshold,
  nextThreshold: row.next_threshold,
  thresholds: row.thresholds,
  percentile: row.percentile,
  pointsAwarded: row.points_awarded,
  isCapstone: row.is_capstone,
  isApex: row.is_apex,
  isRetired: row.is_retired,
  parentId: row.parent_id,
  iconPath: row.icon_path,
  completedIds: row.completed_ids,
  updatedAt: row.updated_at,
})

export class ChallengesRepository {
  constructor(private readonly db: Database) {}

  upsertMany(rows: ChallengeRow[]): number {
    if (rows.length === 0) return 0

    const statement = this.db.prepare(UPSERT_SQL)

    const run = this.db.transaction((batch: ChallengeRow[]) => {
      for (const row of batch) statement.run(toValues(row))
      return batch.length
    })

    return run(rows)
  }

  getAll(filter: ChallengeFilter): ChallengeRow[] {
    const conditions = ["puuid = ?"]
    const params: (string | number)[] = [filter.puuid]

    if (!filter.includeRetired) conditions.push("is_retired = 0")

    if (filter.category) {
      conditions.push("category = ?")
      params.push(filter.category)
    }

    if (filter.level) {
      conditions.push("current_level = ?")
      params.push(filter.level)
    }

    if (filter.idListType) {
      conditions.push("id_list_type = ?")
      params.push(filter.idListType)
    }

    if (filter.search) {
      conditions.push("(name LIKE ? OR description LIKE ?)")
      const term = `%${filter.search}%`
      params.push(term, term)
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM challenges WHERE ${conditions.join(" AND ")}
         ORDER BY category, name`,
      )
      .all(...params) as Record<string, never>[]

    return rows.map(toRow)
  }

  getById(challengeId: number, puuid: string): ChallengeRow | undefined {
    const row = this.db
      .prepare("SELECT * FROM challenges WHERE challenge_id = ? AND puuid = ?")
      .get(challengeId, puuid) as Record<string, never> | undefined

    return row ? toRow(row) : undefined
  }

  /**
   * The stored value and level for each challenge, used to detect change
   * without re-reading every column.
   */
  getProgressSnapshot(
    puuid: string,
  ): Map<number, { currentValue: number; currentLevel: string }> {
    const rows = this.db
      .prepare(
        `SELECT challenge_id AS id, current_value AS value, current_level AS level
         FROM challenges WHERE puuid = ?`,
      )
      .all(puuid) as { id: number; value: number; level: string }[]

    return new Map(
      rows.map((row) => [
        row.id,
        { currentValue: row.value, currentLevel: row.level },
      ]),
    )
  }

  recordHistory(rows: ChallengeHistoryRow[]): number {
    if (rows.length === 0) return 0

    const statement = this.db.prepare(
      `INSERT OR IGNORE INTO challenge_history
         (challenge_id, puuid, recorded_at, current_value, current_level)
       VALUES (?, ?, ?, ?, ?)`,
    )

    const run = this.db.transaction((batch: ChallengeHistoryRow[]) => {
      let written = 0
      for (const row of batch) {
        written += statement.run(
          row.challengeId,
          row.puuid,
          row.recordedAt,
          row.currentValue,
          row.currentLevel,
        ).changes
      }
      return written
    })

    return run(rows)
  }

  getHistory(challengeId: number, puuid: string): ChallengeHistoryRow[] {
    const rows = this.db
      .prepare(
        `SELECT challenge_id AS challengeId, puuid, recorded_at AS recordedAt,
                current_value AS currentValue, current_level AS currentLevel
         FROM challenge_history
         WHERE challenge_id = ? AND puuid = ?
         ORDER BY recorded_at ASC`,
      )
      .all(challengeId, puuid) as ChallengeHistoryRow[]

    return rows
  }

  countChallenges(puuid: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS total FROM challenges WHERE puuid = ?")
      .get(puuid) as { total: number }

    return row.total
  }
}
