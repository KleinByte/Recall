export const MAX_ANALYTIC_MATCH_DURATION_SECS = 12 * 60 * 60
export const DEFAULT_ANALYTIC_SESSION_GAP_MS = 90 * 60 * 1000
export const MOMENTUM_GAP_MS = 30 * 60 * 1000

export const DURATION_BUCKETS_SECONDS = {
  sr: [[0, 1320], [1320, 1680], [1680, 2040], [2040, Infinity]],
  classic: [[0, 1320], [1320, 1680], [1680, 2040], [2040, Infinity]],
  aram: [[0, 720], [720, 960], [960, 1200], [1200, Infinity]],
} as const

export type DurationBucketFamily = keyof typeof DURATION_BUCKETS_SECONDS
export type DurationBucketMode = DurationBucketFamily | "mayhem" | "other"

export interface DurationBucket {
  index: number
  lowerSeconds: number
  upperSeconds: number
}

export function durationBucketFor(
  mode: DurationBucketMode,
  durationSeconds: number,
): DurationBucket | undefined {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0 || mode === "other") {
    return undefined
  }
  const family: DurationBucketFamily = mode === "mayhem" ? "aram" : mode
  const buckets = DURATION_BUCKETS_SECONDS[family]
  const index = buckets.findIndex(([lower, upper]) =>
    durationSeconds >= lower && durationSeconds < upper)
  if (index < 0) return undefined
  const [lowerSeconds, upperSeconds] = buckets[index]
  return { index, lowerSeconds, upperSeconds }
}

export interface TimedGame {
  gameId: number
  playedAt?: number | null
  durationSecs?: number | null
}

export type SessionBoundaryAction = "split" | "join"

export interface TimeSession<T extends TimedGame> {
  kind: "analytical" | "unanalysable"
  matches: T[]
  startAt?: number
  endAt?: number
  playTimeMs: number
}

export function canonicalPlayEndMs(game: TimedGame): number | undefined {
  if (!Number.isSafeInteger(game.playedAt) || (game.playedAt ?? 0) < 0 ||
      !Number.isSafeInteger(game.durationSecs) || (game.durationSecs ?? 0) <= 0 ||
      (game.durationSecs ?? 0) > MAX_ANALYTIC_MATCH_DURATION_SECS) return undefined
  const end = game.playedAt! + game.durationSecs! * 1000
  return Number.isSafeInteger(end) ? end : undefined
}

/**
 * Groups games by canonical play time. Invalid rows remain hard-boundary
 * singletons so callers cannot silently join valid games across unknown time.
 */
export function groupTimedGames<T extends TimedGame>(
  source: readonly T[],
  gapMs = DEFAULT_ANALYTIC_SESSION_GAP_MS,
  overrides: ReadonlyMap<number, SessionBoundaryAction> = new Map(),
): TimeSession<T>[] {
  const indexed = source.map((match, index) => ({ match, index }))
  indexed.sort((left, right) => {
    const leftAt = Number.isSafeInteger(left.match.playedAt)
      ? left.match.playedAt as number
      : Number.POSITIVE_INFINITY
    const rightAt = Number.isSafeInteger(right.match.playedAt)
      ? right.match.playedAt as number
      : Number.POSITIVE_INFINITY
    return leftAt - rightAt || left.match.gameId - right.match.gameId || left.index - right.index
  })

  const sessions: TimeSession<T>[] = []
  let current: TimeSession<T> | undefined
  let previousEnd: number | undefined

  for (const { match } of indexed) {
    const end = canonicalPlayEndMs(match)
    if (end === undefined) {
      current = undefined
      previousEnd = undefined
      sessions.push({ kind: "unanalysable", matches: [match], playTimeMs: 0 })
      continue
    }

    const action = overrides.get(match.gameId)
    const rawGap = previousEnd === undefined ? undefined : match.playedAt! - previousEnd
    const gap = rawGap === undefined ? undefined : Math.max(0, rawGap)
    const canJoin = current?.kind === "analytical" && previousEnd !== undefined
    const startsNew = !canJoin || action === "split" ||
      (action !== "join" && gap! >= gapMs)

    if (startsNew) {
      current = {
        kind: "analytical",
        matches: [],
        startAt: match.playedAt!,
        endAt: end,
        playTimeMs: 0,
      }
      sessions.push(current)
    }
    const active = current!
    active.matches.push(match)
    active.startAt = Math.min(active.startAt!, match.playedAt!)
    active.endAt = Math.max(active.endAt!, end)
    active.playTimeMs += match.durationSecs! * 1000
    previousEnd = end
  }

  return sessions
}
