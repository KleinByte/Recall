import type { ChallengesRepository } from "../database/challenges-repo.js"
import type { LcuClient } from "../lcu-client.js"
import { mapChallengeRow } from "./map-challenge.js"
import type {
  ChallengeHistoryRow,
  ChallengeRow,
  LcuChallenge,
} from "./types.js"

export interface ChallengeSyncResult {
  total: number
  changed: number
}

/**
 * Keeps the local challenge catalogue in step with the client.
 *
 * The client reports only a challenge's present value. Recording a history row
 * whenever a value or level moves turns that into a progress record the client
 * itself cannot produce — how much was gained this week, and when each tier was
 * reached.
 *
 * History is written only on change, so a sync that finds nothing new costs one
 * request and no rows.
 */
export class ChallengeSync {
  constructor(
    private readonly client: LcuClient,
    private readonly repository: ChallengesRepository,
    private readonly puuid: string,
  ) {}

  async syncNow(now = Date.now()): Promise<ChallengeSyncResult> {
    let payload: Record<string, LcuChallenge>

    try {
      payload = await this.client.request<Record<string, LcuChallenge>>(
        "/lol-challenges/v1/challenges/local-player",
      )
    } catch (error) {
      // A closed or busy client is normal; the next sync will pick this up.
      console.warn(`Challenge sync skipped: ${(error as Error).message}`)
      return { total: 0, changed: 0 }
    }

    const rows = Object.values(payload ?? {})
      .filter((challenge) => challenge && typeof challenge.id === "number")
      .map((challenge) => mapChallengeRow(challenge, this.puuid, now))

    if (rows.length === 0) return { total: 0, changed: 0 }

    const previous = this.repository.getProgressSnapshot(this.puuid)
    const history = this.changedRows(rows, previous, now)

    this.repository.saveSnapshot(rows, history)

    return { total: rows.length, changed: history.length }
  }

  private changedRows(
    rows: ChallengeRow[],
    previous: Map<number, { currentValue: number; currentLevel: string }>,
    now: number,
  ): ChallengeHistoryRow[] {
    const history: ChallengeHistoryRow[] = []

    for (const row of rows) {
      const before = previous.get(row.challengeId)

      // The first sighting is recorded so later comparisons have a baseline.
      const changed =
        !before ||
        before.currentValue !== row.currentValue ||
        before.currentLevel !== row.currentLevel

      if (!changed) continue

      history.push({
        challengeId: row.challengeId,
        puuid: row.puuid,
        recordedAt: now,
        currentValue: row.currentValue,
        currentLevel: row.currentLevel,
      })
    }

    return history
  }
}
