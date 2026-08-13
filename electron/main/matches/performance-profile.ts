import {
  DEFAULT_GRADE_RECIPE_ID,
} from "./match-grade-recipe.js"
import {
  aggregateRviProfile,
  RVI_VECTOR_KEYS,
  type RviCareerArmHeadlineAggregate,
  type RviHeadlineAggregate,
  type RviHillVersatility,
  type RviMatchObservation,
  type RviResolvedWeighting,
  type RviConsistencySummary,
  type RviVectorKey,
  type RviWeighting,
} from "./rvi-contract.js"
import {
  PRIMARY_ARCHETYPES,
  type PrimaryArchetype,
} from "./match-grade-taxonomy.js"
import { POSITIONS, type Position } from "./position.js"
import {
  RVI_VECTOR_DEFINITIONS,
} from "./rvi-recipe.js"
import type { ModeFamily } from "./types.js"

export const PERFORMANCE_RECENT_GAMES = 20

export type PerformanceConfidence = "learning" | "provisional" | "established"
export type PerformanceScoringContext = "profile" | "match"

export interface PerformanceMetricScore {
  key: string
  label: string
  score: number | null
  rawValue: number | null
  unit: string
  tier: "CORE" | "SECONDARY" | "DIAGNOSTIC" | "N/A"
  /** Compatibility alias for exact stored Grade influence. */
  weight: number
  /** Declared recipe weight inside the containing RVI arm, before active-evidence normalization. */
  vectorWeight: number
  /** Exact stored contribution to the match Grade/Recall Score responsibility mix. */
  gradeInfluence: number
  influence: number
  games: number
  eligibleGames: number
  coverage: number | null
  effectiveGames: number
  evidenceState: "observed" | "unavailable" | "no_opportunity" | "invalid" |
    "not_applicable" | "unknown" | "missing"
  evidenceReason?: string
  description: string
  formula: string
  comparison: string
  comparisonScope?: string
  referenceMatchCount?: number
}

export interface PerformanceDimensionScore {
  key: string
  label: string
  shortLabel: string
  description: string
  score: number | null
  recentScore?: number
  delta?: number
  games: number
  eligibleGames: number
  coverage: number | null
  effectiveGames: number
  confidence: PerformanceConfidence | null
  /** Average exact per-match match Grade component weight. */
  responsibilityWeight: number
  /** Whether this arm enters the displayed match or career headline. */
  headlineEligible: boolean
  /** True for the Range arm, which is calculated only across a career sample. */
  careerOnly: boolean
  metrics: PerformanceMetricScore[]
}

export type PerformanceScopeKind =
  | "overall"
  | "position"
  | "primary_archetype"

export interface PerformanceScopeSummary {
  kind: PerformanceScopeKind
  key: string
  score: number
  headline: RviHeadlineAggregate | RviCareerArmHeadlineAggregate
  games: number
  measuredGames: number
  coverage: number
  confidence: PerformanceConfidence
  position?: Position
  primaryArchetype?: PrimaryArchetype
}

export interface PerformanceProfileScopes {
  overall: PerformanceScopeSummary
  positions: PerformanceScopeSummary[]
  primaryArchetypes: PerformanceScopeSummary[]
}

export interface PerformanceProfileAuxiliary {
  /** Consistency and breadth feed the career-only Range arm. */
  contributesThroughRange: true
  consistency: RviConsistencySummary
  versatility: {
    champions: RviHillVersatility
    positions: RviHillVersatility
    archetypes: RviHillVersatility
  }
}

/** Canonical profile with exact responsibility scopes and sample diagnostics. */
export interface PerformanceProfile {
  recipeId: string
  scoringContext: PerformanceScoringContext
  weighting: RviResolvedWeighting
  score: number
  /** Mean stored match Recall Score; separate from the career arm mean. */
  recallScoreAverage: number
  headline: RviHeadlineAggregate | RviCareerArmHeadlineAggregate
  recentHeadline?: RviHeadlineAggregate | RviCareerArmHeadlineAggregate
  scopes: PerformanceProfileScopes
  auxiliary?: PerformanceProfileAuxiliary
  games: number
  recentGames: number
  measuredGames: number
  coverage: number
  confidence: PerformanceConfidence
  comparison: string
  dimensions: PerformanceDimensionScore[]
  strongestKey?: string
  growthKey?: string
}

export interface PerformanceProfileInput {
  /** Selected mode family controls which recipe arms are mode-capable. */
  family?: ModeFamily
  /** Exact-recipe, per-match match Grade Recall Score and RVI metric observations. */
  rviObservations: readonly RviMatchObservation[]
  /** Defaults to the currently bundled immutable match Grade recipe. */
  recipeId?: string
  /** Equal match weights are authoritative unless half-life weighting is explicit. */
  weighting?: RviWeighting
  scoringContext?: PerformanceScoringContext
}

interface FamilyPresentation {
  label: string
  shortLabel: string
  description: string
}

const FAMILY_PRESENTATION: Readonly<Record<RviVectorKey, FamilyPresentation>> = Object.freeze(
  Object.fromEntries(RVI_VECTOR_DEFINITIONS.map((definition) => [definition.key, {
    label: definition.label,
    shortLabel: definition.shortLabel,
    description: definition.description,
  }])) as Record<RviVectorKey, FamilyPresentation>,
)

const roundScore = (value: number) => Math.round(Math.min(100, Math.max(0, value)))

function matchIdKey(matchId: RviMatchObservation["matchId"]) {
  return `${typeof matchId}:${String(matchId)}`
}

function orderedObservations(observations: readonly RviMatchObservation[]) {
  return [...observations].sort((left, right) =>
    left.playedAt - right.playedAt || matchIdKey(left.matchId).localeCompare(matchIdKey(right.matchId)))
}

const PERFORMANCE_SCOPE_POSITIONS = new Set<string>(POSITIONS)
type ProfileAggregate = ReturnType<typeof aggregateRviProfile>
type PerformanceScopeIdentity = Pick<
  PerformanceScopeSummary,
  "kind" | "key" | "position" | "primaryArchetype"
>

function positionForScope(value: string | null | undefined): Position | undefined {
  const normalized = value?.trim().toUpperCase()
  return normalized && PERFORMANCE_SCOPE_POSITIONS.has(normalized)
    ? normalized as Position
    : undefined
}

const ABYSS_MATCH_ARMS: readonly RviVectorKey[] = Object.freeze([
  "combat",
  "positioning_survival",
  "control_utility",
  "economy",
])

function activeVectorKeys(
  family: ModeFamily | undefined,
  scoringContext: PerformanceScoringContext,
): readonly RviVectorKey[] {
  const matchArms = family === "aram"
    ? ABYSS_MATCH_ARMS
    : RVI_VECTOR_KEYS.filter((key) => key !== "consistency_versatility")
  return scoringContext === "profile"
    ? [...matchArms, "consistency_versatility"]
    : matchArms
}

function careerArmHeadline(
  aggregate: ProfileAggregate,
  arms: readonly RviVectorKey[],
): RviCareerArmHeadlineAggregate {
  const available = arms.flatMap((key) => {
    const family = aggregate.families.find((candidate) => candidate.key === key)
    return family?.score === null || family?.score === undefined ? [] : [family]
  })
  const scores = available.map((family) => family.score as number)
  const declared = arms.flatMap((key) => {
    const family = aggregate.families.find((candidate) => candidate.key === key)
    return family ? [family] : []
  })
  const eligibleEvidenceWeight = declared.reduce((sum, family) =>
    sum + family.coverage.eligibleWeight, 0)
  const observedEvidenceWeight = declared.reduce((sum, family) =>
    sum + family.coverage.observedWeight, 0)
  const confidenceRank: Record<PerformanceConfidence, number> = {
    learning: 0,
    provisional: 1,
    established: 2,
  }
  const confidence = available.flatMap((family) =>
    family.confidence === null ? [] : [family.confidence])
    .sort((left, right) => confidenceRank[left] - confidenceRank[right])[0] ?? null
  return {
    source: "career_arm_mean",
    score: scores.length
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : null,
    // Career uncertainty follows the least-supported arm that actually enters
    // the mean. Recall Score sample size is not a proxy for arm completeness.
    nEff: available.length ? Math.min(...available.map((family) => family.nEff)) : 0,
    confidence,
    coverage: aggregate.headline.coverage,
    availableArms: scores.length,
    totalArms: arms.length,
    armCoverage: arms.length ? scores.length / arms.length : 0,
    evidenceCoverage: eligibleEvidenceWeight > 0
      ? observedEvidenceWeight / eligibleEvidenceWeight
      : 0,
  }
}

function performanceScopeSummary(
  identity: PerformanceScopeIdentity,
  observations: readonly RviMatchObservation[],
  aggregate: ProfileAggregate,
  activeArms: readonly RviVectorKey[],
  scoringContext: PerformanceScoringContext,
): PerformanceScopeSummary | undefined {
  const headline = scoringContext === "match"
    ? aggregate.headline
    : careerArmHeadline(aggregate, activeArms)
  if (headline.score === null || headline.confidence === null) return undefined
  return {
    ...identity,
    score: roundScore(headline.score),
    headline,
    games: observations.length,
    measuredGames: headline.coverage.observedGames,
    coverage: headline.source === "career_arm_mean"
      ? headline.evidenceCoverage
      : headline.coverage.gameRatio ?? 0,
    confidence: headline.confidence,
  }
}

function buildPerformanceScopes(
  observations: readonly RviMatchObservation[],
  recipeId: string,
  overallAggregate: ProfileAggregate,
  activeArms: readonly RviVectorKey[],
  scoringContext: PerformanceScoringContext,
): PerformanceProfileScopes {
  const weighting: RviWeighting = overallAggregate.weighting.kind === "equal"
    ? { kind: "equal" }
    : {
      kind: "half_life",
      halfLifeMs: overallAggregate.weighting.halfLifeMs,
      referenceTime: overallAggregate.weighting.referenceTime ?? undefined,
    }
  const aggregateScope = (rows: readonly RviMatchObservation[]) => aggregateRviProfile({
    recipeId,
    familyKeys: RVI_VECTOR_KEYS,
    observations: rows,
    weighting,
  })
  const summarize = (
    identity: PerformanceScopeIdentity,
    rows: readonly RviMatchObservation[],
  ) => rows.length
    ? performanceScopeSummary(
      identity,
      rows,
      aggregateScope(rows),
      scoringContext === "profile"
        ? activeArms.filter((key) => key !== "consistency_versatility")
        : activeArms,
      scoringContext,
    )
    : undefined

  const overall = performanceScopeSummary(
    { kind: "overall", key: "overall" },
    observations,
    overallAggregate,
    activeArms,
    scoringContext,
  )!
  const positions = POSITIONS.flatMap((position): PerformanceScopeSummary[] => {
    const rows = observations.filter((observation) =>
      positionForScope(observation.position) === position)
    const summary = summarize({ kind: "position", key: `position:${position}`, position }, rows)
    return summary ? [summary] : []
  })
  const primaryArchetypes = PRIMARY_ARCHETYPES.flatMap(
    (primaryArchetype): PerformanceScopeSummary[] => {
      const rows = observations.filter((observation) =>
        observation.primaryArchetype === primaryArchetype)
      const summary = summarize({
        kind: "primary_archetype",
        key: `primary_archetype:${primaryArchetype}`,
        primaryArchetype,
      }, rows)
      return summary ? [summary] : []
    },
  ).sort((left, right) => right.games - left.games || left.key.localeCompare(right.key))

  return { overall, positions, primaryArchetypes }
}

function profileDimension(
  family: RviVectorKey,
  aggregate: ReturnType<typeof aggregateRviProfile>["families"][number],
  recent: ReturnType<typeof aggregateRviProfile>["families"][number] | undefined,
  scoringContext: PerformanceScoringContext,
): PerformanceDimensionScore {
  const presentation = FAMILY_PRESENTATION[family]
  const score = aggregate.score === null ? null : roundScore(aggregate.score)
  const responsibilityWeight = aggregate.responsibility.averageWeight ?? 0
  const profileOnly = family === "consistency_versatility"
  const headlineEligible = scoringContext === "profile"
    ? score !== null
    : !profileOnly && aggregate.responsibility.positiveGames > 0
  const recentScore = scoringContext === "profile" && recent?.score !== null &&
      recent?.score !== undefined
    ? roundScore(recent.score)
    : undefined
  const comparison = scoringContext === "match"
    ? "Compared with similar recorded matches"
    : "Compared across the selected recorded matches"

  return {
    key: family,
    label: presentation.label,
    shortLabel: presentation.shortLabel,
    description: headlineEligible || profileOnly
      ? presentation.description
      : `${presentation.description} This vector is diagnostic for the observed sample and was excluded from every stored recall-score headline.`,
    score,
    recentScore,
    delta: recentScore === undefined || score === null ? undefined : recentScore - score,
    games: aggregate.coverage.observedGames,
    eligibleGames: aggregate.coverage.eligibleGames,
    coverage: aggregate.coverage.gameRatio,
    effectiveGames: aggregate.nEff,
    confidence: aggregate.confidence,
    responsibilityWeight,
    headlineEligible,
    careerOnly: profileOnly,
    metrics: aggregate.metrics.map((metric): PerformanceMetricScore => ({
      key: metric.key,
      label: metric.label,
      score: metric.score === null ? null : roundScore(metric.score),
      rawValue: metric.rawValue,
      unit: metric.unit,
      tier: metric.tier,
      weight: metric.gradeWeight,
      vectorWeight: metric.vectorWeight,
      gradeInfluence: metric.gradeWeight,
      influence: metric.gradeWeight,
      games: metric.coverage.observedGames,
      eligibleGames: metric.coverage.eligibleGames,
      coverage: metric.coverage.gameRatio,
      effectiveGames: metric.nEff,
      evidenceState: metric.evidenceState,
      evidenceReason: metric.evidenceReason,
      description: metric.description,
      formula: metric.formula,
      comparison: metric.comparisonScope
        ? `${comparison} · grouped by ${metric.comparisonScope}`
        : comparison,
      comparisonScope: metric.comparisonScope,
      referenceMatchCount: metric.referenceMatchCount,
    })),
  }
}

export function buildPerformanceProfile(
  input: PerformanceProfileInput,
): PerformanceProfile | undefined {
  const scoringContext: PerformanceScoringContext = input.scoringContext === "match"
    ? "match"
    : "profile"
  const recipeId = input.recipeId ?? DEFAULT_GRADE_RECIPE_ID
  const observations = orderedObservations(input.rviObservations)
  const aggregate = aggregateRviProfile({
    recipeId,
    familyKeys: RVI_VECTOR_KEYS,
    observations,
    weighting: input.weighting,
  })
  if (aggregate.headline.score === null || aggregate.headline.confidence === null) return undefined
  const activeArms = activeVectorKeys(input.family, scoringContext)

  const recentObservations = observations.slice(-PERFORMANCE_RECENT_GAMES)
  const recent = scoringContext === "profile"
    ? aggregateRviProfile({
      recipeId,
      familyKeys: RVI_VECTOR_KEYS,
      observations: recentObservations,
      weighting: input.weighting,
    })
    : undefined
  const recentFamilies = new Map(recent?.families.map((family) => [family.key, family]))
  const dimensions = activeArms.flatMap((family) => {
    const familyAggregate = aggregate.families.find((entry) => entry.key === family)
    if (!familyAggregate) return []
    return [profileDimension(
      family,
      familyAggregate,
      recentFamilies.get(family),
      scoringContext,
    )]
  })
  const headlineDimensions = dimensions.filter((dimension) =>
    dimension.headlineEligible && dimension.score !== null)
  const strongest = [...headlineDimensions].sort((left, right) => right.score! - left.score!)[0]
  const growth = scoringContext === "profile"
    ? [...headlineDimensions]
      .filter((dimension) => dimension.delta !== undefined && dimension.delta > 0)
      .sort((left, right) => right.delta! - left.delta!)[0]
    : undefined
  const headline = scoringContext === "match"
    ? aggregate.headline
    : careerArmHeadline(aggregate, activeArms)
  if (headline.score === null || headline.confidence === null) return undefined
  const recentHeadline = scoringContext === "profile" && recent
    ? careerArmHeadline(recent, activeArms)
    : undefined

  return {
    recipeId,
    scoringContext,
    weighting: aggregate.weighting,
    score: roundScore(headline.score),
    recallScoreAverage: roundScore(aggregate.headline.score),
    headline,
    ...(recentHeadline && recentHeadline.score !== null ? { recentHeadline } : {}),
    scopes: buildPerformanceScopes(
      observations,
      recipeId,
      aggregate,
      activeArms,
      scoringContext,
    ),
    auxiliary: scoringContext === "profile"
      ? {
        contributesThroughRange: true,
        consistency: aggregate.consistency,
        versatility: aggregate.versatility,
      }
      : undefined,
    games: observations.length,
    recentGames: recentObservations.length,
    measuredGames: headline.coverage.observedGames,
    coverage: headline.source === "career_arm_mean"
      ? headline.evidenceCoverage
      : headline.coverage.gameRatio ?? 0,
    confidence: headline.confidence,
    comparison: scoringContext === "match"
      ? "This match compared with similar recorded games"
      : "Average of the career arms with enough data",
    dimensions,
    strongestKey: strongest?.key,
    growthKey: growth?.key,
  }
}
