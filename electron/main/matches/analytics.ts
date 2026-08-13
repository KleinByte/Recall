export interface Interval { low: number; high: number; level: 0.95 }
import {
  DEFAULT_ANALYTIC_SESSION_GAP_MS,
  groupTimedGames,
} from "../../../src/helpers/time-contract-core.js"

export interface SessionInput {
  gameId: number
  startedAt: number
  durationSecs?: number
}
export interface SessionGame extends SessionInput {
  session: number
  sessionGame: number
  restMinutes?: number
}

export type EvidenceConfidence = "high" | "medium" | "low" | "insufficient"

/**
 * Wilson score confidence interval for binomial proportion
 */
export function wilsonInterval(wins: number, games: number, z = 1.959963984540054): Interval {
  if (games === 0) {
    return { low: 0, high: 1, level: 0.95 }
  }

  const p = wins / games
  const z2 = z * z
  const denominator = 1 + z2 / games
  const center = (p + z2 / (2 * games)) / denominator
  const margin = (z * Math.sqrt(p * (1 - p) / games + z2 / (4 * games * games))) / denominator

  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
    level: 0.95,
  }
}

/**
 * Bayesian shrinkage of observed rate toward baseline prior
 */
export function shrinkRate(wins: number, games: number, baseline: number, priorWeight = 12): number {
  return (wins + priorWeight * baseline) / (games + priorWeight)
}

/**
 * Compute quantile without mutating input array
 */
export function quantile(values: number[], probability: number): number | undefined {
  if (values.length === 0) return undefined

  const sorted = [...values].sort((a, b) => a - b)
  const index = probability * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const weight = index - lower

  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

/**
 * Empirical percentile using midrank for ties
 */
export function empiricalPercentile(values: number[], value: number): number {
  if (values.length === 0) return 0

  let below = 0
  let equal = 0

  for (const v of values) {
    if (v < value) below++
    else if (v === value) equal++
  }

  return (below + equal / 2) / values.length
}

/**
 * Detect play sessions from game timestamps
 */
export function sessionize<T extends SessionInput>(games: T[], breakMinutes = 90): Array<T & SessionGame> {
  const normalized = games.map((game) => ({
    ...game,
    playedAt: game.startedAt,
    durationSecs: game.durationSecs,
  }))
  const gapMs = breakMinutes === 90
    ? DEFAULT_ANALYTIC_SESSION_GAP_MS
    : breakMinutes * 60_000
  const groups = groupTimedGames(normalized, gapMs)
  const results: Array<T & SessionGame> = []
  let previousEnd: number | undefined
  groups.forEach((group, groupIndex) => {
    group.matches.forEach((entry, gameIndex) => {
      const restMinutes = previousEnd === undefined || entry.playedAt === undefined
        ? undefined
        : Math.max(0, entry.playedAt - previousEnd) / 60_000
      results.push({
        ...entry,
        session: groupIndex + 1,
        sessionGame: gameIndex + 1,
        restMinutes,
      })
      previousEnd = entry.durationSecs && entry.playedAt !== undefined
        ? entry.playedAt + entry.durationSecs * 1000
        : undefined
    })
  })
  return results
}

/**
 * Seeded pseudo-random number generator using FNV-1a hash
 */
export function seededRandom(seed: string): () => number {
  // FNV-1a 32-bit hash
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  // Linear congruential generator
  let state = hash >>> 0
  return () => {
    state = Math.imul(state, 1664525) + 1013904223
    return (state >>> 0) / 0x100000000
  }
}

function sampleStandardNormal(rng: () => number): number {
  const first = Math.max(Number.MIN_VALUE, rng())
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * rng())
}

function sampleGamma(shape: number, rng: () => number): number {
  const scale = shape - 1 / 3
  const coefficient = 1 / Math.sqrt(9 * scale)

  while (true) {
    const normal = sampleStandardNormal(rng)
    const base = 1 + coefficient * normal
    if (base <= 0) continue

    const candidate = base ** 3
    const uniform = rng()
    if (
      uniform < 1 - 0.0331 * normal ** 4 ||
      Math.log(uniform) < 0.5 * normal ** 2 + scale * (1 - candidate + Math.log(candidate))
    ) {
      return scale * candidate
    }
  }
}

function sampleBeta(leftShape: number, rightShape: number, rng: () => number): number {
  const left = sampleGamma(leftShape, rng)
  const right = sampleGamma(rightShape, rng)
  return left / (left + right)
}

function valueAtUniformOrder(sorted: number[], uniform: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(uniform * sorted.length))]
}

function sampleBootstrapMedian(sorted: number[], rng: () => number): number {
  const size = sorted.length
  if (size === 0) return 0

  if (size % 2 === 1) {
    const rank = (size + 1) / 2
    const uniform = sampleBeta(rank, size + 1 - rank, rng)
    return valueAtUniformOrder(sorted, uniform)
  }

  const lowerRank = size / 2
  const lowerUniform = sampleBeta(lowerRank, size + 1 - lowerRank, rng)
  const nextSpacing = sampleBeta(1, size - lowerRank, rng)
  const upperUniform = lowerUniform + (1 - lowerUniform) * nextSpacing
  return (
    valueAtUniformOrder(sorted, lowerUniform) +
    valueAtUniformOrder(sorted, upperUniform)
  ) / 2
}

/**
 * Bootstrap confidence interval for median difference
 */
export function bootstrapDifference(left: number[], right: number[], seed: string, resamples = 2_000): Interval {
  const rng = seededRandom(seed)
  const differences: number[] = []
  const sortedLeft = [...left].sort((a, b) => a - b)
  const sortedRight = [...right].sort((a, b) => a - b)

  for (let i = 0; i < resamples; i++) {
    differences.push(
      sampleBootstrapMedian(sortedLeft, rng) - sampleBootstrapMedian(sortedRight, rng),
    )
  }

  const low = quantile(differences, 0.025) ?? 0
  const high = quantile(differences, 0.975) ?? 0

  return { low, high, level: 0.95 }
}

/**
 * Assess confidence level for a finding
 */
export function confidenceForFinding(games: number, interval: Interval | undefined, unit: "grade" | "probability"): EvidenceConfidence {
  if (!interval || games < 10) return "insufficient"

  const width = interval.high - interval.low

  if (unit === "probability") {
    if (games >= 50 && width < 0.15) return "high"
    if (games >= 30 && width < 0.25) return "medium"
    return "low"
  } else { // grade
    if (games >= 50 && width < 1.5) return "high"
    if (games >= 30 && width < 2.5) return "medium"
    return "low"
  }
}
