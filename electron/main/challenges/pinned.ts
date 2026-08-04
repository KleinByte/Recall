import type { ChallengeRow } from "./types.js"

/**
 * Challenges the player is actively chasing.
 *
 * A pinned challenge is only useful in champion select if it is tracked per
 * champion — "win with every champion in ARAM" can answer whether the one you
 * are holding counts, whereas "deal ten million damage" cannot.
 */

export interface ChampionStatus {
  challengeId: number
  name: string
  /** Whether this champion is already done for the challenge. */
  completed: boolean
  /** How many champions are done in total, for context. */
  completedCount: number
}

/**
 * Whether a challenge can answer for a single champion.
 *
 * Retired challenges are excluded even when they are tracked per champion.
 * The client keeps seasonal copies such as "All Random All Champs: 2024
 * Split 1" alongside the live one, and no amount of play advances them, so
 * calling a champion "needed" for one would be untrue.
 */
export function isChampionChallenge(challenge: ChallengeRow): boolean {
  return challenge.idListType === "CHAMPION" && challenge.isRetired !== 1
}

function completedIdsOf(challenge: ChallengeRow): number[] {
  try {
    const parsed = JSON.parse(challenge.completedIds) as unknown
    return Array.isArray(parsed) ? (parsed as number[]) : []
  } catch {
    // A malformed list means we know of nothing completed, which is the safe
    // reading: it prompts a second look rather than claiming a champion is done.
    return []
  }
}

/**
 * Whether a champion counts towards a pinned challenge.
 *
 * Returns `undefined` for challenges that are not tracked per champion, so
 * callers can leave them out rather than showing a meaningless answer.
 */
export function championStatusFor(
  challenge: ChallengeRow,
  championId: number,
): ChampionStatus | undefined {
  if (!isChampionChallenge(challenge)) return undefined

  const completed = completedIdsOf(challenge)

  return {
    challengeId: challenge.challengeId,
    name: challenge.name,
    completed: completed.includes(championId),
    completedCount: completed.length,
  }
}
