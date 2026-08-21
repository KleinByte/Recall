import type { CampClearEvent, CampKey } from "./contracts.js"

/** A standard first full clear contains six unique, non-river jungle camps. */
export const FULL_CLEAR_CAMP_COUNT = 6

/**
 * After eight minutes a sixth unique camp is no longer a useful first-clear
 * comparison. Keeping the window explicit prevents a late route from
 * silently inflating a champion's average.
 */
export const INITIAL_CLEAR_WINDOW_MS = 8 * 60_000

const FIRST_CLEAR_CAMPS = new Set<CampKey>([
  "west_blue",
  "west_gromp",
  "west_wolves",
  "west_raptors",
  "west_red",
  "west_krugs",
  "east_blue",
  "east_gromp",
  "east_wolves",
  "east_raptors",
  "east_red",
  "east_krugs",
])

export interface InitialJungleClear {
  /** Unique camps in observed clear order, capped at the six-camp finish. */
  camps: CampClearEvent[]
  complete: boolean
  /** In-game clock time at which the sixth unique camp was cleared. */
  clearTimeMs?: number
  /** Mean of the weakest source/attribution confidence for every route camp. */
  confidence?: number
}
export interface JungleClearSample {
  gameId: number
  championId: number
  playedAt: number
  win: number
  clearTimeMs: number
  route: CampKey[]
  confidence: number
}

export interface ChampionJungleClearStats {
  championId: number
  /** Recorded games in which the owner was resolved as the jungler. */
  jungleGames: number
  /** Jungle games with at least one local first-clear camp observation. */
  telemetryGames: number
  /** Complete six-unique-camp samples, newest first. */
  samples: JungleClearSample[]
  averageClearTimeMs?: number
  fastest?: JungleClearSample
  longest?: JungleClearSample
}

export function deriveInitialJungleClear(
  events: readonly CampClearEvent[],
): InitialJungleClear {
  const seen = new Set<CampKey>()
  const camps: CampClearEvent[] = []
  const ordered = [...events].sort((left, right) =>
    left.clearedAtMs - right.clearedAtMs ||
    (left.routeIndex ?? Number.MAX_SAFE_INTEGER) -
      (right.routeIndex ?? Number.MAX_SAFE_INTEGER))

  for (const event of ordered) {
    if (event.attribution !== "local" ||
        event.clearedAtMs < 0 ||
        event.clearedAtMs > INITIAL_CLEAR_WINDOW_MS ||
        !FIRST_CLEAR_CAMPS.has(event.campKey) ||
        seen.has(event.campKey)) continue
    seen.add(event.campKey)
    camps.push(event)
    if (camps.length === FULL_CLEAR_CAMP_COUNT) break
  }

  const complete = camps.length === FULL_CLEAR_CAMP_COUNT
  const confidence = camps.length
    ? camps.reduce((total, event) => total + Math.min(
      event.sourceConfidence,
      event.attributionConfidence,
    ), 0) / camps.length
    : undefined

  return {
    camps,
    complete,
    clearTimeMs: complete ? camps.at(-1)?.clearedAtMs : undefined,
    confidence,
  }
}
