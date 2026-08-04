import type { Database } from "better-sqlite3"

export interface GoalInput {
  puuid: string
  /** `challenge` tracks a challenge value; `rank` tracks ladder points. */
  kind: "challenge" | "rank"
  targetKey: string
  targetValue: number
  label: string
}

export interface GoalRow extends GoalInput {
  id: number
  createdAt: number
  achievedAt?: number
}

export class GoalsRepository {
  constructor(private readonly db: Database) {}

  add(goal: GoalInput, now = Date.now()): number {
    const result = this.db
      .prepare(
        `INSERT INTO goals
           (puuid, kind, target_key, target_value, label, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        goal.puuid,
        goal.kind,
        goal.targetKey,
        goal.targetValue,
        goal.label,
        now,
      )

    return Number(result.lastInsertRowid)
  }

  /** Outstanding goals first, since those are the ones being worked towards. */
  list(puuid: string): GoalRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, puuid, kind, target_key AS targetKey,
                target_value AS targetValue, label,
                created_at AS createdAt, achieved_at AS achievedAt
         FROM goals
         WHERE puuid = ?
         ORDER BY achieved_at IS NOT NULL, created_at DESC`,
      )
      .all(puuid) as (GoalRow & { achievedAt: number | null })[]

    return rows.map((row) => ({
      ...row,
      achievedAt: row.achievedAt ?? undefined,
    }))
  }

  remove(id: number, puuid: string): boolean {
    // Scoped to the account so one profile can never delete another's goals.
    return (
      this.db
        .prepare("DELETE FROM goals WHERE id = ? AND puuid = ?")
        .run(id, puuid).changes > 0
    )
  }

  /**
   * Records when a goal was reached.
   *
   * The first time is the one that counts, so a goal that dips back below its
   * target and climbs again keeps its original date.
   */
  markAchieved(id: number, now = Date.now()) {
    this.db
      .prepare(
        "UPDATE goals SET achieved_at = ? WHERE id = ? AND achieved_at IS NULL",
      )
      .run(now, id)
  }
}
