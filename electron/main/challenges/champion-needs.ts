import type { ChallengeRow } from "./types.js"

export interface ChampionNeed {
  challengeId: number
  name: string
  currentLevel: string
  currentValue: number
  nextThreshold: number | null
}

/**
 * Works out which challenges each champion still counts toward.
 *
 * This is the question the client cannot answer: it will show a challenge's
 * progress, but not which champions are still missing from it. Inverting the
 * relationship turns 66 champion challenges into a straight answer to "who
 * should I play next".
 *
 * Retired challenges are excluded because no amount of play advances them.
 */
export function championsNeededFor(
  challenges: ChallengeRow[],
  allChampionIds: number[],
): Map<number, ChampionNeed[]> {
  const needs = new Map<number, ChampionNeed[]>()

  const relevant = challenges.filter(
    (challenge) =>
      challenge.idListType === "CHAMPION" && challenge.isRetired === 0,
  )

  for (const challenge of relevant) {
    let completed: number[]

    try {
      completed = JSON.parse(challenge.completedIds) as number[]
    } catch {
      continue
    }

    const done = new Set(completed)

    for (const championId of allChampionIds) {
      if (done.has(championId)) continue

      const entry: ChampionNeed = {
        challengeId: challenge.challengeId,
        name: challenge.name,
        currentLevel: challenge.currentLevel,
        currentValue: challenge.currentValue,
        nextThreshold: challenge.nextThreshold,
      }

      const existing = needs.get(championId)
      if (existing) {
        existing.push(entry)
      } else {
        needs.set(championId, [entry])
      }
    }
  }

  return needs
}
