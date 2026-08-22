import type { ChallengeRow } from "../types/stats"

export type ChallengeSortKey =
  | "closest"
  | "level"
  | "name"
  | "category"
  | "updated"

export type ChallengeSortDirection = "asc" | "desc"

export type ChallengeKind = "capstone" | "grouped" | "standalone"
export type ChallengeKindFilter = "all" | ChallengeKind

export interface ChallengeGroup {
  capstone: ChallengeRow
  members: ChallengeRow[]
}

const CATEGORY_LABELS: Record<string, string> = {
  COLLECTION: "Collection",
  EXPERTISE: "Expertise",
  IMAGINATION: "Imagination",
  LEGACY: "Legacy",
  TEAMWORK: "Teamwork & Strategy",
  VETERANCY: "Veterancy",
}

const GAME_MODE_LABELS: Record<string, string> = {
  ARAM: "ARAM",
  CHERRY: "Arena",
  CLASSIC: "Classic",
  KIWI: "ARAM: Mayhem",
  KIWI_JADE: "ARAM: Mayhem (Jade)",
  STRAWBERRY: "Swarm",
  SWIFTPLAY: "Swiftplay",
}

const MAP_BY_GAME_MODE: Record<string, string> = {
  ARAM: "Howling Abyss",
  CHERRY: "Arena maps",
  CLASSIC: "Summoner's Rift",
  KIWI: "Howling Abyss",
  KIWI_JADE: "Howling Abyss",
  STRAWBERRY: "The Final City",
  SWIFTPLAY: "Summoner's Rift",
}

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

export function challengeCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ")
}

/**
 * Builds the capstone hierarchy reported by League. Member challenges point
 * at their capstone through `parentId`; capstones can also have a parent that
 * represents a client-only category node, so the capstone flag wins.
 */
export function buildChallengeGroups(
  challenges: readonly ChallengeRow[],
): ChallengeGroup[] {
  const capstones = challenges.filter((challenge) => challenge.isCapstone === 1)
  const childrenByParent = new Map<number, ChallengeRow[]>()

  for (const challenge of challenges) {
    if (challenge.parentId === null) continue
    const siblings = childrenByParent.get(challenge.parentId) ?? []
    siblings.push(challenge)
    childrenByParent.set(challenge.parentId, siblings)
  }

  const descendantsOf = (capstoneId: number) => {
    const members: ChallengeRow[] = []
    const visited = new Set([capstoneId])

    const visit = (parentId: number) => {
      for (const child of childrenByParent.get(parentId) ?? []) {
        if (visited.has(child.challengeId)) continue
        visited.add(child.challengeId)
        members.push(child)
        visit(child.challengeId)
      }
    }

    visit(capstoneId)
    return members.sort((left, right) =>
      right.isCapstone - left.isCapstone || left.name.localeCompare(right.name))
  }

  return capstones
    .map((capstone) => ({
      capstone,
      members: descendantsOf(capstone.challengeId),
    }))
    .sort((left, right) => left.capstone.name.localeCompare(right.capstone.name))
}

export function challengeKind(
  challenge: ChallengeRow,
  capstoneIds: ReadonlySet<number>,
): ChallengeKind {
  if (challenge.isCapstone === 1) return "capstone"
  if (challenge.parentId !== null && capstoneIds.has(challenge.parentId)) {
    return "grouped"
  }
  return "standalone"
}

export function challengeMatchesKind(
  challenge: ChallengeRow,
  filter: ChallengeKindFilter,
  capstoneIds: ReadonlySet<number>,
): boolean {
  return filter === "all" || challengeKind(challenge, capstoneIds) === filter
}

/** A selected group contains its capstone and every direct member. */
export function challengeMatchesGroup(
  challenge: ChallengeRow,
  capstoneId: number | null,
  memberIds: ReadonlySet<number> = new Set(),
): boolean {
  return capstoneId === null || challenge.challengeId === capstoneId ||
    memberIds.has(challenge.challengeId)
}

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

/**
 * A challenge is complete when League reports no further milestone, or when
 * the recorded value has already met the reported target. The latter matters
 * for boolean-style 1/1 challenges and for brief client-sync states where the
 * value advances before the tier metadata does.
 */
export function isChallengeCompleted(challenge: ChallengeRow): boolean {
  const target = challenge.nextThreshold
  return challenge.nextLevel === null || target === null ||
    (Number.isFinite(challenge.currentValue) && Number.isFinite(target) &&
      challenge.currentValue >= target)
}

/** One canonical completion selector shared by every challenge surface. */
export function selectIncompleteChallenges(
  challenges: readonly ChallengeRow[],
): ChallengeRow[] {
  return challenges.filter((challenge) => !isChallengeCompleted(challenge))
}

/** Amount still required for the reported target, clamped after completion. */
export function challengeRemaining(challenge: ChallengeRow): number | null {
  return challenge.nextThreshold === null
    ? null
    : Math.max(0, challenge.nextThreshold - challenge.currentValue)
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

/**
 * The client currently repeats a mode once for every applicable queue. Turn
 * the stored payload into a stable, de-duplicated list for filtering.
 */
export function challengeGameModes(challenge: ChallengeRow): string[] {
  try {
    const parsed = JSON.parse(challenge.gameModes) as unknown
    if (!Array.isArray(parsed)) return []
    return [
      ...new Set(
        parsed
          .filter((mode): mode is string => typeof mode === "string")
          .map((mode) => mode.trim().toUpperCase())
          .filter(Boolean),
      ),
    ]
  } catch {
    return []
  }
}

export function challengeGameModeLabel(mode: string): string {
  return (
    GAME_MODE_LABELS[mode] ?? mode
      .toLowerCase()
      .split("_")
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" ")
  )
}

export function challengeMapForGameMode(mode: string): string {
  return MAP_BY_GAME_MODE[mode] ?? "Other maps"
}

/** Empty game-mode lists are global challenges and apply to every mode. */
export function challengeMatchesGameMode(
  challenge: ChallengeRow,
  mode: string,
): boolean {
  if (!mode) return true
  const modes = challengeGameModes(challenge)
  return modes.length === 0 || modes.includes(mode)
}

/** Empty game-mode lists are also valid on every map family. */
export function challengeMatchesMap(
  challenge: ChallengeRow,
  map: string,
): boolean {
  if (!map) return true
  const modes = challengeGameModes(challenge)
  return (
    modes.length === 0 ||
    modes.some((mode) => challengeMapForGameMode(mode) === map)
  )
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
