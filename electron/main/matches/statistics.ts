import { createHash } from "node:crypto"

export const WILSON_Z_95 = 1.959963984540054
export const DEFAULT_BOOTSTRAP_DRAWS = 2_000

export interface ConfidenceInterval {
  low: number
  high: number
  level: .95
}

export interface BinomialEstimate {
  numerator: number
  denominator: number
  value: number | null
  interval: ConfidenceInterval | null
}

export interface SessionValue {
  sessionId: string | number
  value: number
}

function assertCount(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name}_must_be_non_negative_integer`)
}

export function wilson95(numerator: number, denominator: number): BinomialEstimate {
  assertCount(numerator, "numerator")
  assertCount(denominator, "denominator")
  if (numerator > denominator) throw new RangeError("numerator_exceeds_denominator")
  if (denominator === 0) return { numerator, denominator, value: null, interval: null }
  const value = numerator / denominator
  const z2 = WILSON_Z_95 ** 2
  const scale = 1 + z2 / denominator
  const center = (value + z2 / (2 * denominator)) / scale
  const margin = WILSON_Z_95 * Math.sqrt(
    value * (1 - value) / denominator + z2 / (4 * denominator ** 2),
  ) / scale
  return {
    numerator,
    denominator,
    value,
    interval: { low: Math.max(0, center - margin), high: Math.min(1, center + margin), level: .95 },
  }
}

/** Linear-interpolated quantile; undefined is preserved for an empty sample. */
export function interpolatedQuantile(values: readonly number[], probability: number): number | undefined {
  if (!values.length) return undefined
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError("probability_out_of_range")
  }
  const sorted = [...values].sort((left, right) => left - right)
  const position = (sorted.length - 1) * probability
  const lower = Math.floor(position)
  const fraction = position - lower
  return sorted[lower] + (sorted[lower + 1] - sorted[lower] || 0) * fraction
}

/** SHA-256 keyed 32-bit generator. The key, not observation ordering, determines its stream. */
export function keyedRandom(key: string): () => number {
  const digest = createHash("sha256").update(key, "utf8").digest()
  let state = digest.readUInt32BE(0) || 0x6d2b79f5
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 0x100000000
  }
}

function sessionGroups(values: readonly SessionValue[]): number[][] {
  const bySession = new Map<string | number, number[]>()
  for (const entry of values) {
    if (!Number.isFinite(entry.value)) continue
    const group = bySession.get(entry.sessionId) ?? []
    group.push(entry.value)
    bySession.set(entry.sessionId, group)
  }
  return [...bySession.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([, group]) => group)
}

export interface MeanBootstrapResult {
  mean: number | null
  games: number
  sessions: number
  draws: number
  interval: ConfidenceInterval | null
  reason?: "insufficient_evidence"
}

/**
 * Game-weighted arithmetic-mean bootstrap with 90-minute sessions supplied by
 * the caller. A sampled session contributes every game in that session.
 */
export function bootstrapSessionArithmeticMean(
  values: readonly SessionValue[],
  key: string,
  draws = DEFAULT_BOOTSTRAP_DRAWS,
  minimumGames = 5,
): MeanBootstrapResult {
  const groups = sessionGroups(values)
  const games = groups.reduce((sum, group) => sum + group.length, 0)
  if (games < minimumGames || groups.length === 0) {
    return { mean: null, games, sessions: groups.length, draws: 0, interval: null,
      reason: "insufficient_evidence" }
  }
  if (!Number.isSafeInteger(draws) || draws <= 0) throw new RangeError("draws_must_be_positive_integer")
  const mean = groups.flat().reduce((sum, value) => sum + value, 0) / games
  const rng = keyedRandom(key)
  const samples: number[] = []
  for (let draw = 0; draw < draws; draw += 1) {
    let sum = 0
    let count = 0
    for (let index = 0; index < groups.length; index += 1) {
      const sampled = groups[Math.floor(rng() * groups.length)]
      sum += sampled.reduce((total, value) => total + value, 0)
      count += sampled.length
    }
    samples.push(sum / count)
  }
  return {
    mean,
    games,
    sessions: groups.length,
    draws,
    interval: {
      low: interpolatedQuantile(samples, .025)!,
      high: interpolatedQuantile(samples, .975)!,
      level: .95,
    },
  }
}

export interface ChartWindowMetadata {
  timezone: string
  lowerInclusiveUtc: number
  upperInclusiveUtc: number
  totalEligible: number
  included: number
  truncated: boolean
  oldestIncludedAt: number | null
}

export function chartWindowMetadata(input: Omit<ChartWindowMetadata, "truncated">): ChartWindowMetadata {
  if (input.lowerInclusiveUtc > input.upperInclusiveUtc) throw new RangeError("invalid_window")
  if (!input.timezone) throw new RangeError("timezone_required")
  return { ...input, truncated: input.included < input.totalEligible }
}
