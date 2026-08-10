import type { Evidence, EvidenceState } from "../../../src/shared/measurement.js"
import {
  canonicalChampionId,
  PRIMARY_ARCHETYPES,
  type PrimaryArchetype,
} from "./match-grade-taxonomy.js"
import { POSITIONS } from "./position.js"
import {
  RVI_CAPABILITY_VECTORS,
  RVI_MATCH_ARM_KEYS,
  RVI_METRIC_POLICIES,
  type RviCapabilityVector,
} from "./match-metric-registry.js"

export const RVI_ALGORITHM_VERSION = 3
export const RVI_SCORE_MIN = 0
export const RVI_SCORE_MAX = 100
export const RVI_MAD_NORMAL_SCALE = 1.4826
export const RVI_BOOTSTRAP_REPLICATES = 2_000
export const RVI_RANGE_MINIMUM_GAMES = 20
export const RVI_VECTOR_KEYS = RVI_CAPABILITY_VECTORS
export const RVI_MATCH_VECTOR_KEYS = RVI_MATCH_ARM_KEYS
export type RviVectorKey = RviCapabilityVector

export const RVI_PROFILE_ONLY_VECTOR_KEYS: readonly RviVectorKey[] =
  Object.freeze(["consistency_versatility"])

export type RviMetricTier = "CORE" | "SECONDARY" | "DIAGNOSTIC" | "N/A"
export type RviMetricEvidenceState = EvidenceState | "missing"
export type RviMetricComparisonScope = "mode" | "position" | "archetype" | "role" | "lobby"

/**
 * One metric retained for RVI inspection. Score evidence is expressed on the
 * public 0-100 scale. Raw evidence remains separate so a calibrated value can
 * never be mistaken for the player's literal match statistic.
 */
export interface RviMetricObservation {
  key: string
  vector: RviVectorKey
  label: string
  description: string
  formula: string
  unit: string
  tier: RviMetricTier
  /** Fixed weight inside this capability vector; diagnostics use zero. */
  vectorWeight: number
  /** Exact influence on the stored Grade recall-score composite; diagnostics use zero. */
  gradeWeight: number
  rawEvidence: Evidence<number>
  scoreEvidence: Evidence<number>
  comparisonScope?: RviMetricComparisonScope
  referenceMatchCount?: number
  sourceQuality?: "verified" | "retained" | "derived" | "legacy"
}

const RVI_POSITION_KEYS = new Set<string>(POSITIONS)
const RVI_PRIMARY_ARCHETYPE_KEYS = new Set<string>(PRIMARY_ARCHETYPES)

export type RviConfidence = "learning" | "provisional" | "established"

export interface RviConfidenceThresholds {
  provisionalGames: number
  establishedGames: number
}

export const RVI_DEFAULT_CONFIDENCE_THRESHOLDS: Readonly<RviConfidenceThresholds> =
  Object.freeze({ provisionalGames: 10, establishedGames: 30 })

export type RviMatchId = string | number

/**
 * One authoritative match Grade observation. Scores are already calibrated
 * percentiles; this contract never rebuilds them from raw telemetry.
 */
export interface RviMatchObservation {
  matchId: RviMatchId
  recipeId: string
  playedAt: number
  recallScore: number | null
  /** Per-match capability scores on 0-100. Kept under the legacy field name for DTO compatibility. */
  familyPercentiles: Readonly<Record<string, number | null | undefined>>
  /** Exact normalized match Grade responsibility carried by each capability vector. */
  familyResponsibilityWeights: Readonly<Record<string, number | null | undefined>>
  /** Individual observations that explain the capability scores. */
  metrics?: readonly RviMetricObservation[]
  championId?: number | null
  position?: string | null
  /** Stored match Grade responsibility archetype; never inferred by RVI. */
  primaryArchetype?: PrimaryArchetype | null
}

export type RviWeighting =
  | { kind: "equal" }
  | { kind: "half_life"; halfLifeMs: number; referenceTime?: number }

export type RviResolvedWeighting =
  | { kind: "equal" }
  | { kind: "half_life"; halfLifeMs: number; referenceTime: number | null }

export interface RviCoverage {
  eligibleGames: number
  observedGames: number
  gameRatio: number | null
  eligibleWeight: number
  observedWeight: number
  weightRatio: number | null
}

export interface RviScoreAggregate {
  score: number | null
  nEff: number
  confidence: RviConfidence | null
  coverage: RviCoverage
}

export interface RviBootstrapConfidenceInterval {
  method: "deterministic_match_bootstrap_percentile"
  confidenceLevel: .95
  lower: number | null
  upper: number | null
  replicates: number
  seed: number | null
  observedGames: number
}

export interface RviHeadlineAggregate extends RviScoreAggregate {
  source: "role_fit"
  /** Sampling uncertainty only; it never changes or shrinks the headline score. */
  confidenceInterval95: RviBootstrapConfidenceInterval
}

/** Equal career-arm composite. Match Grade/Recall Score remains a separate score. */
export interface RviCareerArmHeadlineAggregate extends RviScoreAggregate {
  source: "career_arm_mean"
  availableArms: number
  totalArms: number
  armCoverage: number
  /** Weighted measurement coverage across every declared career arm. */
  evidenceCoverage: number
}

export interface RviFamilyVector extends RviScoreAggregate {
  key: string
  responsibility: RviFamilyResponsibilityAggregate
  metrics: RviMetricAggregate[]
}

export interface RviMetricAggregate extends RviScoreAggregate {
  key: string
  vector: RviVectorKey
  label: string
  description: string
  formula: string
  unit: string
  tier: RviMetricTier
  /** Average fixed vector policy weight over eligible observations. */
  vectorWeight: number
  /** Average exact Grade influence over eligible observations. */
  gradeWeight: number
  rawValue: number | null
  rawNEff: number
  rawCoverage: RviCoverage
  evidenceState: RviMetricEvidenceState
  evidenceReason?: string
  comparisonScope?: RviMetricComparisonScope
  referenceMatchCount?: number
}

export interface RviFamilyResponsibilityAggregate {
  averageWeight: number | null
  positiveGames: number
  nEff: number
  confidence: RviConfidence | null
  coverage: RviCoverage
}

export interface RviConsistencySummary {
  median: number | null
  q1: number | null
  scaledMad: number | null
  nEff: number
  confidence: RviConfidence | null
  coverage: RviCoverage
}

export interface RviVersatilityCategory {
  key: string
  weight: number
  share: number
}

export interface RviHillVersatility {
  effectiveCount: number | null
  entropy: number | null
  nEff: number
  confidence: RviConfidence | null
  coverage: RviCoverage
  categories: RviVersatilityCategory[]
}

export interface RviProfileAggregate {
  algorithmVersion: typeof RVI_ALGORITHM_VERSION
  recipeId: string
  weighting: RviResolvedWeighting
  headline: RviHeadlineAggregate
  families: RviFamilyVector[]
  consistency: RviConsistencySummary
  versatility: {
    champions: RviHillVersatility
    positions: RviHillVersatility
    archetypes: RviHillVersatility
  }
}

export interface RviProfileAggregationInput {
  recipeId: string
  /** Ordered family keys from the recipe; wholly missing families still report zero coverage. */
  familyKeys: readonly string[]
  observations: readonly RviMatchObservation[]
  /** Equal match weights are authoritative unless a half-life is explicitly requested. */
  weighting?: RviWeighting
  confidenceThresholds?: Readonly<RviConfidenceThresholds>
}

interface WeightedObservation {
  observation: RviMatchObservation
  weight: number
}

export interface RviWeightedScore {
  value: number
  weight: number
}

function assertPositiveFinite(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number`)
  }
}

function assertScore(value: number | null | undefined, label: string) {
  if (value === null || value === undefined) return
  if (!Number.isFinite(value) || value < RVI_SCORE_MIN || value > RVI_SCORE_MAX) {
    throw new RangeError(`${label} must be between ${RVI_SCORE_MIN} and ${RVI_SCORE_MAX}`)
  }
}

function validateThresholds(thresholds: Readonly<RviConfidenceThresholds>) {
  assertPositiveFinite(thresholds.provisionalGames, "provisionalGames")
  assertPositiveFinite(thresholds.establishedGames, "establishedGames")
  if (thresholds.establishedGames < thresholds.provisionalGames) {
    throw new RangeError("establishedGames must be greater than or equal to provisionalGames")
  }
}

/** Exponential recency weight: w_i = 2^(-age_i / halfLife). */
export function halfLifeWeight(age: number, halfLife: number): number {
  if (!Number.isFinite(age) || age < 0) throw new RangeError("age must be a non-negative finite number")
  assertPositiveFinite(halfLife, "halfLife")
  return 2 ** (-age / halfLife)
}

/** Kish effective sample size: (sum w)^2 / sum(w^2). */
export function effectiveSampleSize(weights: readonly number[]): number {
  let sum = 0
  let squared = 0
  for (const weight of weights) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError("weights must be non-negative finite numbers")
    }
    sum += weight
    squared += weight * weight
  }
  return squared === 0 ? 0 : sum * sum / squared
}

export function confidenceForEffectiveGames(
  nEff: number,
  thresholds: Readonly<RviConfidenceThresholds> = RVI_DEFAULT_CONFIDENCE_THRESHOLDS,
): RviConfidence | null {
  if (!Number.isFinite(nEff) || nEff < 0) throw new RangeError("nEff must be a non-negative finite number")
  validateThresholds(thresholds)
  if (nEff === 0) return null
  if (nEff >= thresholds.establishedGames) return "established"
  if (nEff >= thresholds.provisionalGames) return "provisional"
  return "learning"
}

function resolvedWeighting(
  weighting: RviWeighting | undefined,
  observations: readonly RviMatchObservation[],
): RviResolvedWeighting {
  if (!weighting || weighting.kind === "equal") return { kind: "equal" }
  assertPositiveFinite(weighting.halfLifeMs, "halfLifeMs")
  let latest: number | null = null
  for (const observation of observations) {
    latest = latest === null ? observation.playedAt : Math.max(latest, observation.playedAt)
  }
  const referenceTime = weighting.referenceTime ?? latest
  if (referenceTime !== null && !Number.isFinite(referenceTime)) {
    throw new RangeError("referenceTime must be finite")
  }
  if (latest !== null && referenceTime !== null && referenceTime < latest) {
    throw new RangeError("referenceTime cannot precede the latest observation")
  }
  return { kind: "half_life", halfLifeMs: weighting.halfLifeMs, referenceTime }
}

function observationWeight(observation: RviMatchObservation, weighting: RviResolvedWeighting) {
  if (weighting.kind === "equal") return 1
  if (weighting.referenceTime === null) return 0
  return halfLifeWeight(weighting.referenceTime - observation.playedAt, weighting.halfLifeMs)
}

function coverageFor(
  values: readonly WeightedObservation[],
  observed: (observation: RviMatchObservation) => boolean,
): RviCoverage {
  const eligibleWeight = values.reduce((sum, value) => sum + value.weight, 0)
  const observedValues = values.filter((value) => observed(value.observation))
  const observedWeight = observedValues.reduce((sum, value) => sum + value.weight, 0)
  return {
    eligibleGames: values.length,
    observedGames: observedValues.length,
    gameRatio: values.length ? observedValues.length / values.length : null,
    eligibleWeight,
    observedWeight,
    weightRatio: eligibleWeight > 0 ? observedWeight / eligibleWeight : null,
  }
}

function aggregateScores(
  values: readonly WeightedObservation[],
  resolve: (observation: RviMatchObservation) => number | null | undefined,
  thresholds: Readonly<RviConfidenceThresholds>,
): RviScoreAggregate {
  const coverage = coverageFor(values, (observation) => {
    const value = resolve(observation)
    return value !== null && value !== undefined
  })
  const observed = values.flatMap(({ observation, weight }) => {
    const value = resolve(observation)
    return value === null || value === undefined || weight === 0 ? [] : [{ value, weight }]
  })
  const weightSum = observed.reduce((sum, value) => sum + value.weight, 0)
  const nEff = effectiveSampleSize(observed.map((value) => value.weight))
  return {
    score: weightSum === 0 ? null : observed.reduce(
      (sum, value) => sum + value.value * value.weight, 0) / weightSum,
    nEff,
    confidence: confidenceForEffectiveGames(nEff, thresholds),
    coverage,
  }
}

function aggregateFamilyResponsibility(
  values: readonly WeightedObservation[],
  familyKey: string,
  thresholds: Readonly<RviConfidenceThresholds>,
): RviFamilyResponsibilityAggregate {
  const resolve = (observation: RviMatchObservation) => {
    const explicit = observation.familyResponsibilityWeights[familyKey]
    if (explicit !== null && explicit !== undefined) return explicit
    const metrics = observation.metrics?.filter((metric) =>
      metric.vector === familyKey && metric.tier !== "N/A") ?? []
    return metrics.length ? metrics.reduce((sum, metric) => sum + metric.gradeWeight, 0) : null
  }
  const coverage = coverageFor(values, (observation) => {
    const value = resolve(observation)
    return value !== null && value !== undefined
  })
  const observed = values.flatMap(({ observation, weight }) => {
    const value = resolve(observation)
    return value === null || value === undefined || weight === 0 ? [] : [{ value, weight }]
  })
  const weightSum = observed.reduce((sum, value) => sum + value.weight, 0)
  const nEff = effectiveSampleSize(observed.map((value) => value.weight))
  return {
    averageWeight: weightSum === 0 ? null : observed.reduce(
      (sum, value) => sum + value.value * value.weight, 0) / weightSum,
    positiveGames: observed.filter((value) => value.value > 0).length,
    nEff,
    confidence: confidenceForEffectiveGames(nEff, thresholds),
    coverage,
  }
}

function matchVectorScore(
  observation: RviMatchObservation,
  vector: string,
): number | null | undefined {
  const explicit = observation.familyPercentiles[vector]
  if (explicit !== null && explicit !== undefined) return explicit
  const rows = observation.metrics ?? []
  const requiredCore = RVI_METRIC_POLICIES.filter((policy) =>
    policy.vector === vector && policy.tier === "CORE")
  for (const policy of requiredCore) {
    const metric = rows.find((candidate) => candidate.key === policy.metricKey)
    if (!metric || (metric.tier !== "N/A" && metric.scoreEvidence.state !== "observed")) {
      return explicit
    }
  }
  const applicable = rows.filter((metric) =>
    metric.vector === vector && metric.tier !== "N/A" && metric.vectorWeight > 0 &&
    (metric.tier === "CORE" || metric.tier === "SECONDARY"))
  const observed = applicable.filter((metric) => metric.scoreEvidence.state === "observed")
  if (!observed.length) return explicit
  const coreBundle = observed.filter((metric) => metric.tier === "CORE")
  const neutralBundle = coreBundle.length > 0 ? coreBundle : observed
  const neutralWeight = neutralBundle.reduce((sum, metric) => sum + metric.vectorWeight, 0)
  const declaredWeight = applicable.reduce((sum, metric) => sum + metric.vectorWeight, 0)
  if (neutralWeight === 0 || declaredWeight === 0) return explicit
  const neutralScore = neutralBundle.reduce((sum, metric) =>
    sum + (metric.scoreEvidence.state === "observed" ? metric.scoreEvidence.value : 0) *
      metric.vectorWeight, 0) / neutralWeight
  const missingSecondaryWeight = applicable.reduce((sum, metric) =>
    metric.tier === "SECONDARY" && metric.scoreEvidence.state !== "observed"
      ? sum + metric.vectorWeight
      : sum, 0)
  // This is only a compatibility fallback for observations without an
  // immutable Grade arm. It mirrors Grade's fixed-denominator neutral fill;
  // missing optional evidence remains missing in the metric aggregates.
  return (observed.reduce((sum, metric) =>
    sum + (metric.scoreEvidence.state === "observed" ? metric.scoreEvidence.value : 0) *
      metric.vectorWeight, 0) + missingSecondaryWeight * neutralScore) / declaredWeight
}

function metricEvidenceReason(metrics: readonly RviMetricObservation[]): string | undefined {
  const counts = new Map<string, number>()
  for (const metric of metrics) {
    if (metric.scoreEvidence.state === "observed" || !metric.scoreEvidence.reason) continue
    counts.set(metric.scoreEvidence.reason, (counts.get(metric.scoreEvidence.reason) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0]
}

function metricEvidenceState(metrics: readonly RviMetricObservation[]): RviMetricEvidenceState {
  if (metrics.some((metric) => metric.scoreEvidence.state === "observed")) return "observed"
  if (metrics.length === 0) return "missing"
  const states = metrics.map((metric) => metric.scoreEvidence.state)
  if (states.every((state) => state === "not_applicable")) return "not_applicable"
  for (const state of ["invalid", "unavailable", "no_opportunity", "unknown"] as const) {
    if (states.includes(state)) return state
  }
  return states[0] ?? "missing"
}

function aggregateMetricObservations(
  values: readonly WeightedObservation[],
  thresholds: Readonly<RviConfidenceThresholds>,
): RviMetricAggregate[] {
  const keys = new Set<string>()
  for (const { observation } of values) {
    for (const metric of observation.metrics ?? []) keys.add(metric.key)
  }

  return [...keys].sort().flatMap((key): RviMetricAggregate[] => {
    const entries = values.flatMap(({ observation, weight }) => {
      const metric = observation.metrics?.find((candidate) => candidate.key === key)
      return metric ? [{ metric, observation, weight }] : []
    })
    const first = entries[0]?.metric
    if (!first) return []
    const eligible = entries.filter(({ metric }) =>
      metric.tier !== "N/A" && metric.scoreEvidence.state !== "not_applicable")
    const tier = (["CORE", "SECONDARY", "DIAGNOSTIC", "N/A"] as const).find(
      (candidate) => entries.some(({ metric }) => metric.tier === candidate),
    ) ?? "N/A"
    const scoreValues: WeightedObservation[] = eligible.map(({ observation, weight }) => ({
      observation,
      weight,
    }))
    const scoreByMatch = new Map(entries.map(({ observation, metric }) => [
      matchKey(observation.matchId),
      metric.scoreEvidence.state === "observed" ? metric.scoreEvidence.value : null,
    ]))
    const score = aggregateScores(scoreValues, (observation) =>
      scoreByMatch.get(matchKey(observation.matchId)), thresholds)

    const rawCoverage: RviCoverage = (() => {
      const eligibleWeight = eligible.reduce((sum, entry) => sum + entry.weight, 0)
      const observed = eligible.filter(({ metric }) => metric.rawEvidence.state === "observed")
      const observedWeight = observed.reduce((sum, entry) => sum + entry.weight, 0)
      return {
        eligibleGames: eligible.length,
        observedGames: observed.length,
        gameRatio: eligible.length ? observed.length / eligible.length : null,
        eligibleWeight,
        observedWeight,
        weightRatio: eligibleWeight > 0 ? observedWeight / eligibleWeight : null,
      }
    })()
    const rawObserved = eligible.flatMap(({ metric, weight }) =>
      metric.rawEvidence.state === "observed" && weight > 0
        ? [{ value: metric.rawEvidence.value, weight }]
        : [])
    const rawWeight = rawObserved.reduce((sum, entry) => sum + entry.weight, 0)
    const policyWeight = eligible.reduce((sum, entry) => sum + entry.weight, 0)
    const referenceCounts = eligible.flatMap(({ metric }) =>
      metric.referenceMatchCount === undefined ? [] : [metric.referenceMatchCount])
    const comparisonScopes = new Set(eligible.flatMap(({ metric }) =>
      metric.comparisonScope ? [metric.comparisonScope] : []))
    const evidenceState = metricEvidenceState(entries.map((entry) => entry.metric))

    return [{
      key,
      vector: first.vector,
      label: first.label,
      description: first.description,
      formula: first.formula,
      unit: first.unit,
      // Responsibility can change with position/archetype. Use the strongest
      // tier actually represented in the aggregate instead of whichever match
      // happened to be first chronologically.
      tier,
      vectorWeight: policyWeight === 0 ? 0 : eligible.reduce(
        (sum, entry) => sum + entry.metric.vectorWeight * entry.weight, 0) / policyWeight,
      gradeWeight: policyWeight === 0 ? 0 : eligible.reduce(
        (sum, entry) => sum + entry.metric.gradeWeight * entry.weight, 0) / policyWeight,
      rawValue: rawWeight === 0 ? null : rawObserved.reduce(
        (sum, entry) => sum + entry.value * entry.weight, 0) / rawWeight,
      rawNEff: effectiveSampleSize(rawObserved.map((entry) => entry.weight)),
      rawCoverage,
      evidenceState,
      // A partial aggregate can contain no-opportunity or unavailable games,
      // but those reasons do not describe the observed aggregate itself.
      evidenceReason: evidenceState === "observed"
        ? undefined
        : metricEvidenceReason(entries.map((entry) => entry.metric)),
      comparisonScope: comparisonScopes.size === 1 ? [...comparisonScopes][0] : undefined,
      referenceMatchCount: referenceCounts.length
        ? Math.round(referenceCounts.reduce((sum, count) => sum + count, 0) / referenceCounts.length)
        : undefined,
      ...score,
    }]
  })
}

/** Weighted empirical quantile: the first value whose cumulative weight reaches p. */
export function weightedQuantile(
  values: readonly RviWeightedScore[],
  probability: number,
): number | null {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError("probability must be between 0 and 1")
  }
  for (const value of values) {
    if (!Number.isFinite(value.value) || !Number.isFinite(value.weight) || value.weight < 0) {
      throw new RangeError("weighted values must contain finite values and non-negative weights")
    }
  }
  const ordered = values.filter((value) => value.weight > 0)
    .sort((left, right) => left.value - right.value)
  const totalWeight = ordered.reduce((sum, value) => sum + value.weight, 0)
  if (totalWeight === 0) return null
  const target = probability * totalWeight
  let cumulative = 0
  for (const value of ordered) {
    cumulative += value.weight
    if (cumulative + Number.EPSILON >= target) return value.value
  }
  return ordered.at(-1)!.value
}

function consistencyFor(
  values: readonly WeightedObservation[],
  thresholds: Readonly<RviConfidenceThresholds>,
): RviConsistencySummary {
  const coverage = coverageFor(values, (observation) => observation.recallScore !== null)
  const observed = values.flatMap(({ observation, weight }) =>
    observation.recallScore === null || weight === 0
      ? [] : [{ value: observation.recallScore, weight }])
  const median = weightedQuantile(observed, .5)
  const q1 = weightedQuantile(observed, .25)
  // 1.4826 makes MAD comparable to standard deviation under a normal model.
  const mad = median === null ? null : weightedQuantile(observed.map((value) => ({
    value: Math.abs(value.value - median),
    weight: value.weight,
  })), .5)
  const nEff = effectiveSampleSize(observed.map((value) => value.weight))
  return {
    median,
    q1,
    scaledMad: mad === null ? null : mad * RVI_MAD_NORMAL_SCALE,
    nEff,
    confidence: confidenceForEffectiveGames(nEff, thresholds),
    coverage,
  }
}

function hillVersatilityFor(
  values: readonly WeightedObservation[],
  resolve: (observation: RviMatchObservation) => string | null,
  thresholds: Readonly<RviConfidenceThresholds>,
): RviHillVersatility {
  const coverage = coverageFor(values, (observation) => resolve(observation) !== null)
  const weights = new Map<string, number>()
  const observedWeights: number[] = []
  for (const value of values) {
    const key = resolve(value.observation)
    if (key === null || value.weight === 0) continue
    weights.set(key, (weights.get(key) ?? 0) + value.weight)
    observedWeights.push(value.weight)
  }
  const totalWeight = [...weights.values()].reduce((sum, weight) => sum + weight, 0)
  const categories = [...weights.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, weight]) => ({ key, weight, share: weight / totalWeight }))
  // Hill D1 = exp(Shannon entropy); repeated play contributes by match weight.
  const entropy = categories.length
    ? -categories.reduce((sum, category) => sum + category.share * Math.log(category.share), 0)
    : null
  const nEff = effectiveSampleSize(observedWeights)
  return {
    effectiveCount: entropy === null ? null : Math.exp(entropy),
    entropy,
    nEff,
    confidence: confidenceForEffectiveGames(nEff, thresholds),
    coverage,
    categories,
  }
}

function matchKey(matchId: RviMatchId) {
  if (typeof matchId === "number" && !Number.isSafeInteger(matchId)) {
    throw new RangeError("numeric matchId values must be safe integers")
  }
  if (typeof matchId === "string" && matchId.length === 0) {
    throw new RangeError("string matchId values cannot be empty")
  }
  return `${typeof matchId}:${matchId}`
}

function fnv1a32(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function deterministicRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 0x1_0000_0000
  }
}

function interpolatedQuantile(ordered: readonly number[], probability: number) {
  const index = (ordered.length - 1) * probability
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  return lower === upper
    ? ordered[lower]
    : ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower)
}

/**
 * Resamples independent matches uniformly with replacement, retaining their
 * configured aggregation weights inside every replicate. Canonical ordering
 * and a data-derived PRNG seed make the percentile interval reproducible.
 */
function headlineBootstrapInterval(
  recipeId: string,
  values: readonly WeightedObservation[],
): RviBootstrapConfidenceInterval {
  const observed = values.flatMap(({ observation, weight }) => {
    const value = observation.recallScore
    return value === null || weight === 0 ? [] : [{
      matchId: observation.matchId,
      playedAt: observation.playedAt,
      value,
      weight,
    }]
  }).sort((left, right) => {
    const leftKey = matchKey(left.matchId)
    const rightKey = matchKey(right.matchId)
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })
  if (!observed.length) {
    return {
      method: "deterministic_match_bootstrap_percentile",
      confidenceLevel: .95,
      lower: null,
      upper: null,
      replicates: 0,
      seed: null,
      observedGames: 0,
    }
  }

  const seed = fnv1a32(JSON.stringify({
    recipeId,
    observations: observed.map((entry) => [
      typeof entry.matchId,
      String(entry.matchId),
      entry.playedAt.toPrecision(17),
      entry.value.toPrecision(17),
      entry.weight.toPrecision(17),
    ]),
  }))
  const random = deterministicRandom(seed)
  const estimates = Array.from({ length: RVI_BOOTSTRAP_REPLICATES }, () => {
    let weightedScore = 0
    let weightSum = 0
    for (let draw = 0; draw < observed.length; draw += 1) {
      const selected = observed[Math.floor(random() * observed.length)]
      weightedScore += selected.value * selected.weight
      weightSum += selected.weight
    }
    return weightedScore / weightSum
  }).sort((left, right) => left - right)

  return {
    method: "deterministic_match_bootstrap_percentile",
    confidenceLevel: .95,
    lower: interpolatedQuantile(estimates, .025),
    upper: interpolatedQuantile(estimates, .975),
    replicates: RVI_BOOTSTRAP_REPLICATES,
    seed,
    observedGames: observed.length,
  }
}

function validateInput(input: RviProfileAggregationInput) {
  if (!input.recipeId.trim()) throw new RangeError("recipeId cannot be empty")
  const familyKeys = new Set<string>()
  for (const familyKey of input.familyKeys) {
    if (!familyKey.trim()) throw new RangeError("family keys cannot be empty")
    if (familyKeys.has(familyKey)) throw new RangeError(`duplicate family key: ${familyKey}`)
    familyKeys.add(familyKey)
  }
  const matches = new Set<string>()
  for (const observation of input.observations) {
    if (observation.recipeId !== input.recipeId) {
      throw new RangeError(`observation recipe ${observation.recipeId} does not match ${input.recipeId}`)
    }
    const key = matchKey(observation.matchId)
    if (matches.has(key)) throw new RangeError(`duplicate match observation: ${observation.matchId}`)
    matches.add(key)
    if (!Number.isFinite(observation.playedAt)) throw new RangeError("playedAt must be finite")
    assertScore(observation.recallScore, "recallScore")
    if (observation.championId !== null && observation.championId !== undefined &&
        (!Number.isSafeInteger(observation.championId) || observation.championId <= 0)) {
      throw new RangeError("championId must be a positive safe integer")
    }
    if (observation.primaryArchetype !== null && observation.primaryArchetype !== undefined &&
        !RVI_PRIMARY_ARCHETYPE_KEYS.has(observation.primaryArchetype)) {
      throw new RangeError(`unknown primary archetype: ${observation.primaryArchetype}`)
    }
    for (const [familyKey, score] of Object.entries(observation.familyPercentiles)) {
      if (!familyKeys.has(familyKey)) throw new RangeError(`unknown family key: ${familyKey}`)
      assertScore(score, `family percentile ${familyKey}`)
    }
    for (const familyKey of familyKeys) {
      if (!(familyKey in observation.familyResponsibilityWeights)) {
        throw new RangeError(`missing family responsibility weight: ${familyKey}`)
      }
    }
    for (const [familyKey, weight] of Object.entries(observation.familyResponsibilityWeights)) {
      if (!familyKeys.has(familyKey)) {
        throw new RangeError(`unknown family responsibility weight: ${familyKey}`)
      }
      if (weight !== null && weight !== undefined &&
          (!Number.isFinite(weight) || weight < 0 || weight > 1)) {
        throw new RangeError(`family responsibility weight ${familyKey} must be between 0 and 1`)
      }
    }
    const metricKeys = new Set<string>()
    for (const metric of observation.metrics ?? []) {
      if (!metric.key.trim()) throw new RangeError("metric keys cannot be empty")
      if (metricKeys.has(metric.key)) throw new RangeError(`duplicate metric key: ${metric.key}`)
      metricKeys.add(metric.key)
      if (!familyKeys.has(metric.vector)) throw new RangeError(`unknown metric vector: ${metric.vector}`)
      if (!metric.label.trim() || !metric.description.trim() || !metric.formula.trim() ||
          !metric.unit.trim()) {
        throw new RangeError(`metric ${metric.key} is missing presentation metadata`)
      }
      if (!Number.isFinite(metric.vectorWeight) || metric.vectorWeight < 0 ||
          !Number.isFinite(metric.gradeWeight) || metric.gradeWeight < 0 || metric.gradeWeight > 1) {
        throw new RangeError(`metric ${metric.key} has invalid weights`)
      }
      if (metric.tier === "N/A" && (metric.vectorWeight !== 0 || metric.gradeWeight !== 0)) {
        throw new RangeError(`not-applicable metric ${metric.key} must have zero weights`)
      }
      if (metric.rawEvidence.state === "observed" && !Number.isFinite(metric.rawEvidence.value)) {
        throw new RangeError(`metric ${metric.key} raw value must be finite`)
      }
      if (metric.scoreEvidence.state === "observed") {
        assertScore(metric.scoreEvidence.value, `metric percentile ${metric.key}`)
      }
      if (metric.referenceMatchCount !== undefined &&
          (!Number.isSafeInteger(metric.referenceMatchCount) || metric.referenceMatchCount < 0)) {
        throw new RangeError(`metric ${metric.key} reference match count must be non-negative`)
      }
    }
  }
}

const clampScore = (value: number) => Math.max(RVI_SCORE_MIN, Math.min(RVI_SCORE_MAX, value))

function rangeDomainScore(
  values: readonly WeightedObservation[],
  resolve: (observation: RviMatchObservation) => string | null,
  breadthTarget: number,
): number | null {
  const groups = new Map<string, WeightedObservation[]>()
  for (const value of values) {
    if (value.observation.recallScore === null || value.weight === 0) continue
    const key = resolve(value.observation)
    if (key === null) continue
    const group = groups.get(key) ?? []
    group.push(value)
    groups.set(key, group)
  }
  const eligible = [...groups.entries()].filter(([, entries]) => entries.length >= 3)
  if (!eligible.length) return null
  const categoryMeans = eligible.map(([, entries]) => {
    const weight = entries.reduce((sum, entry) => sum + entry.weight, 0)
    return {
      value: entries.reduce((sum, entry) =>
        sum + (entry.observation.recallScore as number) * entry.weight, 0) / weight,
      weight: 1,
    }
  })
  const floor = weightedQuantile(categoryMeans, .25)
  const categoryWeights = eligible.map(([, entries]) =>
    entries.reduce((sum, entry) => sum + entry.weight, 0))
  const total = categoryWeights.reduce((sum, weight) => sum + weight, 0)
  const entropy = -categoryWeights.reduce((sum, weight) => {
    const share = weight / total
    return sum + share * Math.log(share)
  }, 0)
  const effectiveBreadth = Math.exp(entropy)
  const breadth = clampScore((effectiveBreadth - 1) / Math.max(1, breadthTarget - 1) * 100)
  return floor === null ? null : .6 * floor + .4 * breadth
}

function careerRangeVector(
  values: readonly WeightedObservation[],
  consistency: RviConsistencySummary,
  thresholds: Readonly<RviConfidenceThresholds>,
): RviFamilyVector {
  const coverage = coverageFor(values, (observation) => observation.recallScore !== null)
  const observed = values.filter((entry) =>
    entry.observation.recallScore !== null && entry.weight > 0)
  const weights = observed.map((entry) => entry.weight)
  const nEff = effectiveSampleSize(weights)
  const learning = observed.length < RVI_RANGE_MINIMUM_GAMES
  const emptyResponsibility: RviFamilyResponsibilityAggregate = {
    averageWeight: 0,
    positiveGames: 0,
    nEff,
    confidence: learning ? "learning" : confidenceForEffectiveGames(nEff, thresholds),
    coverage,
  }
  if (learning || consistency.q1 === null || consistency.scaledMad === null) {
    return {
      key: "consistency_versatility",
      score: null,
      nEff,
      confidence: "learning",
      coverage,
      responsibility: emptyResponsibility,
      metrics: [],
    }
  }

  const games = observed.length
  const positionTarget = Math.min(5, Math.max(2, Math.floor(Math.sqrt(games / 5))))
  const archetypeTarget = Math.min(6, Math.max(2, Math.floor(Math.sqrt(games / 5))))
  const championTarget = Math.min(8, Math.max(3, Math.floor(Math.sqrt(games))))
  const positionKey = (observation: RviMatchObservation) => {
    const position = observation.position?.trim().toUpperCase()
    return position && RVI_POSITION_KEYS.has(position) ? position : null
  }
  const archetypeKey = (observation: RviMatchObservation) =>
    observation.primaryArchetype ?? null
  const championKey = (observation: RviMatchObservation) =>
    observation.championId === null || observation.championId === undefined
      ? null : String(canonicalChampionId(observation.championId))
  const positionScore = rangeDomainScore(observed, positionKey, positionTarget)
  const archetypeScore = rangeDomainScore(observed, archetypeKey, archetypeTarget)
  const championScore = rangeDomainScore(observed, championKey, championTarget)
  const abyssOnly = observed.every((entry) => positionKey(entry.observation) === null)
  const versatility = abyssOnly
    ? archetypeScore === null || championScore === null
      ? null : .6 * archetypeScore + .4 * championScore
    : positionScore === null || archetypeScore === null || championScore === null
      ? null : .4 * positionScore + .35 * archetypeScore + .25 * championScore
  const repeatability = clampScore(100 - 2.5 * consistency.scaledMad)
  const consistencyScore = .6 * consistency.q1 + .4 * repeatability
  return {
    key: "consistency_versatility",
    score: versatility === null ? null : .5 * consistencyScore + .5 * versatility,
    nEff,
    confidence: versatility === null ? "learning" : confidenceForEffectiveGames(nEff, thresholds),
    coverage,
    responsibility: emptyResponsibility,
    metrics: [],
  }
}

/**
 * Aggregates exact-recipe match observations. This low-level headline retains
 * the stored Recall Score sample; the career profile layer separately computes its
 * declared equal mean of available career arms.
 */
export function aggregateRviProfile(input: RviProfileAggregationInput): RviProfileAggregate {
  validateInput(input)
  const thresholds = input.confidenceThresholds ?? RVI_DEFAULT_CONFIDENCE_THRESHOLDS
  validateThresholds(thresholds)
  const weighting = resolvedWeighting(input.weighting, input.observations)
  const observations = input.observations.map((observation) => ({
    observation,
    weight: observationWeight(observation, weighting),
  }))
  const headline = aggregateScores(observations, (observation) => observation.recallScore, thresholds)
  const metrics = aggregateMetricObservations(observations, thresholds)
  const consistency = consistencyFor(observations, thresholds)
  const range = careerRangeVector(observations, consistency, thresholds)
  const families = input.familyKeys.map((key): RviFamilyVector => key ===
    "consistency_versatility" ? range : ({
      key,
      ...aggregateScores(observations, (observation) => matchVectorScore(observation, key), thresholds),
      responsibility: aggregateFamilyResponsibility(observations, key, thresholds),
      metrics: metrics.filter((metric) => metric.vector === key),
    }))
  return {
    algorithmVersion: RVI_ALGORITHM_VERSION,
    recipeId: input.recipeId,
    weighting,
    headline: {
      source: "role_fit",
      ...headline,
      confidenceInterval95: headlineBootstrapInterval(input.recipeId, observations),
    },
    families,
    consistency,
    versatility: {
      champions: hillVersatilityFor(observations, (observation) =>
        observation.championId === null || observation.championId === undefined
          ? null : String(canonicalChampionId(observation.championId)), thresholds),
      positions: hillVersatilityFor(observations, (observation) => {
        const position = observation.position?.trim().toUpperCase()
        return position && RVI_POSITION_KEYS.has(position) ? position : null
      }, thresholds),
      archetypes: hillVersatilityFor(observations, (observation) =>
        observation.primaryArchetype ?? null, thresholds),
    },
  }
}

/**
 * Timeline-derived proxies below are diagnostic evidence only. They are not
 * consumed by aggregateRviProfile and cannot affect the RVI headline.
 */
export interface FightKillEvent {
  timestamp: number
  originalEventIndex: number
  killerId: number
  victimId: number
  assistingParticipantIds: number[]
  victimPosition?: { x: number; y: number }
}

export interface FightCluster {
  events: FightKillEvent[]
  participants: number[]
  classification: "duel" | "skirmish" | "teamfight"
  pick: boolean
}

export type RiftLane = "TOP" | "MIDDLE" | "BOTTOM"
export type Point = { x: number; y: number }

/** Frozen map-11 lane regions used by the existing timeline label mapper. */
export function riftLaneAt(point: Point): RiftLane | undefined {
  const { x, y } = point
  if ((x <= 3_000 && y >= 4_000) || (y >= 12_000 && x <= 11_000)) return "TOP"
  if ((y <= 3_000 && x >= 4_000) || (x >= 12_000 && y <= 11_000)) return "BOTTOM"
  if (x >= 2_000 && x <= 13_000 && y >= 2_000 && y <= 13_000 && Math.abs(x - y) <= 1_600) {
    return "MIDDLE"
  }
  return undefined
}

export interface RoamProxyInput {
  timestamp: number
  ownerPosition?: Point
  ownerRole: RiftLane
  opponentParticipantId: number
  enemyParticipantIds: readonly number[]
}

export function qualifiesAsEarlyRoam(input: RoamProxyInput): Evidence<boolean> {
  if (!input.ownerPosition || !Number.isFinite(input.timestamp) ||
      !Number.isSafeInteger(input.opponentParticipantId) ||
      input.enemyParticipantIds.some((id) => !Number.isSafeInteger(id))) {
    return { state: "unavailable", reason: "incomplete_roam_evidence" }
  }
  if (input.timestamp >= 15 * 60_000) return { state: "not_applicable" }
  const outsideLane = riftLaneAt(input.ownerPosition) !== input.ownerRole
  const nonLaneOpponent = input.enemyParticipantIds.some((id) => id !== input.opponentParticipantId)
  return { state: "observed", value: outsideLane && nonLaneOpponent, source: "derived" }
}

export function isWithinObjectiveProximity(
  ownerPosition: Point | undefined,
  objectivePosition: Point | undefined,
  frameTimestamp: number,
  objectiveTimestamp: number,
): Evidence<boolean> {
  if (!ownerPosition || !objectivePosition || !Number.isFinite(frameTimestamp) ||
      !Number.isFinite(objectiveTimestamp)) {
    return { state: "unavailable", reason: "incomplete_objective_position_evidence" }
  }
  return { state: "observed", value:
    Math.abs(frameTimestamp - objectiveTimestamp) <= 60_000 &&
    Math.hypot(ownerPosition.x - objectivePosition.x, ownerPosition.y - objectivePosition.y) <= 1_500,
    source: "derived" }
}

export interface SetupWardInput {
  objectiveTimestamp: number
  objectiveTeamId: number
  ownerTeamId: number
  objectivePosition?: Point
  wardTimestamp: number
  wardPosition?: Point
  wardAction: "placed" | "killed" | "purchased"
}

export function qualifiesAsObjectiveSetupWard(input: SetupWardInput): Evidence<boolean> {
  if (!input.objectivePosition || !input.wardPosition ||
      !Number.isFinite(input.objectiveTimestamp) || !Number.isFinite(input.wardTimestamp)) {
    return { state: "unavailable", reason: "incomplete_setup_ward_position_evidence" }
  }
  const lead = input.objectiveTimestamp - input.wardTimestamp
  const distance = Math.hypot(
    input.objectivePosition.x - input.wardPosition.x,
    input.objectivePosition.y - input.wardPosition.y,
  )
  return { state: "observed", value:
    input.objectiveTeamId === input.ownerTeamId &&
    input.wardAction !== "purchased" && lead >= 30_000 && lead <= 90_000 && distance <= 1_500,
    source: "derived" }
}

export function clusterFights(events: readonly FightKillEvent[]): Evidence<FightCluster[]> {
  if (events.some((event) => !Number.isFinite(event.timestamp) || !event.victimPosition ||
      !Number.isSafeInteger(event.killerId) || !Number.isSafeInteger(event.victimId) ||
      !Array.isArray(event.assistingParticipantIds))) {
    return { state: "unavailable", reason: "incomplete_spatial_fight_evidence" }
  }
  const ordered = [...events].sort((left, right) =>
    left.timestamp - right.timestamp || left.originalEventIndex - right.originalEventIndex)
  const parent = ordered.map((_, index) => index)
  const root = (index: number): number => parent[index] === index ? index : (parent[index] = root(parent[index]))
  for (let left = 0; left < ordered.length; left += 1) {
    for (let right = left + 1; right < ordered.length; right += 1) {
      if (ordered[right].timestamp - ordered[left].timestamp > 12_000) break
      const dx = ordered[right].victimPosition!.x - ordered[left].victimPosition!.x
      const dy = ordered[right].victimPosition!.y - ordered[left].victimPosition!.y
      if (Math.hypot(dx, dy) <= 1_200) parent[root(right)] = root(left)
    }
  }
  const groups = new Map<number, FightKillEvent[]>()
  ordered.forEach((event, index) => {
    const key = root(index)
    groups.set(key, [...(groups.get(key) ?? []), event])
  })
  const clusters = [...groups.values()].map((cluster): FightCluster => {
    const participants = [...new Set(cluster.flatMap((event) =>
      [event.killerId, event.victimId, ...event.assistingParticipantIds]))].sort((a, b) => a - b)
    const classification = participants.length === 2 ? "duel" :
      participants.length <= 5 ? "skirmish" : "teamfight"
    const pick = participants.length <= 5 && cluster.some((event) =>
      new Set([event.killerId, ...event.assistingParticipantIds]).size >= 2)
    return { events: cluster, participants, classification, pick }
  })
  return { state: "observed", value: clusters, source: "derived" }
}
