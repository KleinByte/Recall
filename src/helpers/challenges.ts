import type { ChallengeRow } from "../types/stats"

export type ChallengeSortKey =
  | "closest"
  | "level"
  | "name"
  | "category"
  | "updated"

export type ChallengeSortDirection = "asc" | "desc"

const LEVEL_ORDER = [
  "NONE",
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
]

/**
 * Progress through the current tier, rather than progress from zero.
 *
 * A value of 95 at a 100-point threshold is not necessarily 95% through the
 * tier when the previous tier started at 90. Using the current threshold keeps
 * "closest" comparable across challenges with very different score scales.
 */
export function challengeTierProgress(challenge: ChallengeRow): number {
  const next = challenge.nextThreshold
  if (next === null) return 1

  const current = challenge.currentThreshold ?? 0
  const span = next - current
  if (span <= 0) return 0

  return Math.min(1, Math.max(0, (challenge.currentValue - current) / span))
}

/** No next tier means the challenge has reached its highest available tier. */
export function isChallengeCompleted(challenge: ChallengeRow): boolean {
  return challenge.nextLevel === null || challenge.nextThreshold === null
}

/**
 * Legacy challenges stay out of the normal browser because they cannot be
 * progressed. Selecting LEGACY explicitly makes them available for reference.
 */
export function challengeMatchesCategory(
  challenge: ChallengeRow,
  category: string,
): boolean {
  if (category === "LEGACY") return challenge.category === "LEGACY"
  if (challenge.category === "LEGACY") return false
  return category === "All" || challenge.category === category
}

function levelRank(level: string): number {
  const rank = LEVEL_ORDER.indexOf(level.toUpperCase())
  return rank < 0 ? 0 : rank
}

function compareBy(
  left: ChallengeRow,
  right: ChallengeRow,
  key: ChallengeSortKey,
): number {
  switch (key) {
    case "closest":
      return challengeTierProgress(left) - challengeTierProgress(right)
    case "level":
      return levelRank(left.currentLevel) - levelRank(right.currentLevel)
    case "category":
      return left.category.localeCompare(right.category)
    case "updated":
      return left.updatedAt - right.updatedAt
    case "name":
      return left.name.localeCompare(right.name)
  }
}

export function sortChallenges(
  challenges: ChallengeRow[],
  key: ChallengeSortKey,
  direction: ChallengeSortDirection,
): ChallengeRow[] {
  const multiplier = direction === "asc" ? 1 : -1

  return [...challenges].sort((left, right) => {
    const primary = compareBy(left, right, key) * multiplier
    return primary || left.name.localeCompare(right.name)
  })
}
