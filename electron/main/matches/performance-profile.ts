import type {
  GradeComponentObservation,
  InsightObservation,
  RviTimelineObservation,
} from "../database/insights-repo.js"
import {
  GRADE_V3_RECIPE_ID,
} from "./grade-v3-recipe.js"
import {
  aggregateRviProfile,
  RVI_ALGORITHM_VERSION as RVI_V3_ALGORITHM_VERSION,
  RVI_VECTOR_KEYS,
  type RviHeadlineAggregate,
  type RviHillVersatility,
  type RviMatchObservation,
  type RviResolvedWeighting,
  type RviConsistencySummary,
  type RviVectorKey,
  type RviWeighting,
} from "./rvi-contract.js"
import {
  canonicalChampionId,
  PRIMARY_ARCHETYPES,
  type PrimaryArchetype,
} from "./grade-v3-taxonomy.js"
import { POSITIONS, type Position } from "./position.js"
import { RVI_V3_VECTOR_DEFINITIONS } from "./rvi-v3-recipe.js"
import type { ModeFamily } from "./types.js"

export const RVI_ALGORITHM_VERSION = RVI_V3_ALGORITHM_VERSION
export const PERFORMANCE_PROFILE_VERSION = RVI_ALGORITHM_VERSION
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
  /** Compatibility alias for influence. */
  weight: number
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
  /** Average exact per-match Grade v3 component weight. */
  responsibilityWeight: number
  /** False only when this family was observed exclusively at diagnostic weight zero. */
  headlineEligible: boolean
  metrics: PerformanceMetricScore[]
}

export type PerformanceScopeKind =
  | "overall"
  | "position"
  | "primary_archetype"
  | "champion_position"

export interface PerformanceScopeSummary {
  kind: PerformanceScopeKind
  key: string
  score: number
  headline: RviHeadlineAggregate
  games: number
  measuredGames: number
  coverage: number
  confidence: PerformanceConfidence
  position?: Position
  primaryArchetype?: PrimaryArchetype
  championId?: number
}

export interface PerformanceProfileScopes {
  overall: PerformanceScopeSummary
  positions: PerformanceScopeSummary[]
  primaryArchetypes: PerformanceScopeSummary[]
  championPositions: PerformanceScopeSummary[]
}

export interface PerformanceProfileAuxiliary {
  /** These diagnostics describe the sample and never contribute to headline.score. */
  excludedFromHeadline: true
  consistency: RviConsistencySummary
  versatility: {
    champions: RviHillVersatility
    positions: RviHillVersatility
  }
}

/**
 * Renderer-compatible v2 DTO fields are retained at the top level. Exact v3
 * values and uncertainty are additionally exposed through headline, exact
 * responsibility scopes, and the auxiliary sample diagnostics.
 */
export interface PerformanceProfile {
  algorithmVersion: number
  recipeId: string
  scoringContext: PerformanceScoringContext
  weighting: RviResolvedWeighting
  score: number
  headline: RviHeadlineAggregate
  recentHeadline?: RviHeadlineAggregate
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

interface DeprecatedPerformanceProfileFields {
  /** @deprecated RVI v3 does not derive scores from insight observations. */
  family?: ModeFamily
  /** @deprecated Supply rviObservations populated from exact-recipe Grade v3 artifacts. */
  observations?: readonly InsightObservation[]
  /** @deprecated Grade v2 component rows are not valid RVI v3 inputs. */
  gradeComponentHistory?: readonly GradeComponentObservation[]
  /** @deprecated Timeline proxies are diagnostic-only and never enter RVI v3. */
  timelineHistory?: readonly RviTimelineObservation[]
  /** @deprecated Champion-class display ceilings were removed in RVI v3. */
  championRoles?: ReadonlyMap<number, readonly string[]>
}

export interface PerformanceProfileV3Input extends DeprecatedPerformanceProfileFields {
  /** Exact-recipe, per-match Grade v3 RoleFit and RVI metric observations. */
  rviObservations: readonly RviMatchObservation[]
  /** Defaults to the currently bundled immutable Grade v3 recipe. */
  recipeId?: string
  /** Equal match weights are authoritative unless half-life weighting is explicit. */
  weighting?: RviWeighting
  scoringContext?: PerformanceScoringContext
}

/**
 * Temporary compile-time bridge for DB/index/report callers. It intentionally
 * returns no profile: legacy rows cannot be promoted into authoritative v3
 * scores without their recipe identity and stored 0-100 metric percentiles.
 */
export interface LegacyPerformanceProfileInput extends DeprecatedPerformanceProfileFields {
  family: ModeFamily
  observations: readonly InsightObservation[]
  gradeComponentHistory: readonly GradeComponentObservation[]
  rviObservations?: never
  scoringContext?: PerformanceScoringContext
}

function isPerformanceProfileV3Input(
  input: PerformanceProfileV3Input | LegacyPerformanceProfileInput,
): input is PerformanceProfileV3Input {
  return "rviObservations" in input && Array.isArray(input.rviObservations)
}

interface FamilyPresentation {
  label: string
  shortLabel: string
  description: string
}

const FAMILY_PRESENTATION: Readonly<Record<RviVectorKey, FamilyPresentation>> = Object.freeze(
  Object.fromEntries(RVI_V3_VECTOR_DEFINITIONS.map((definition) => [definition.key, {
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
  "kind" | "key" | "position" | "primaryArchetype" | "championId"
>

function positionForScope(value: string | null | undefined): Position | undefined {
  const normalized = value?.trim().toUpperCase()
  return normalized && PERFORMANCE_SCOPE_POSITIONS.has(normalized)
    ? normalized as Position
    : undefined
}

function performanceScopeSummary(
  identity: PerformanceScopeIdentity,
  observations: readonly RviMatchObservation[],
  aggregate: ProfileAggregate,
): PerformanceScopeSummary | undefined {
  if (aggregate.headline.score === null || aggregate.headline.confidence === null) return undefined
  return {
    ...identity,
    score: roundScore(aggregate.headline.score),
    headline: aggregate.headline,
    games: observations.length,
    measuredGames: aggregate.headline.coverage.observedGames,
    coverage: aggregate.headline.coverage.gameRatio ?? 0,
    confidence: aggregate.headline.confidence,
  }
}

function buildPerformanceScopes(
  observations: readonly RviMatchObservation[],
  recipeId: string,
  overallAggregate: ProfileAggregate,
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
    ? performanceScopeSummary(identity, rows, aggregateScope(rows))
    : undefined

  const overall = performanceScopeSummary(
    { kind: "overall", key: "overall" },
    observations,
    overallAggregate,
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

  const championPositionGroups = new Map<
    string,
    { championId: number; position: Position; observations: RviMatchObservation[] }
  >()
  for (const observation of observations) {
    const position = positionForScope(observation.position)
    const championId = observation.championId === null || observation.championId === undefined
      ? undefined
      : canonicalChampionId(observation.championId)
    if (!position || championId === undefined || championId <= 0) continue
    const key = `${championId}:${position}`
    const group = championPositionGroups.get(key) ?? { championId, position, observations: [] }
    group.observations.push(observation)
    championPositionGroups.set(key, group)
  }
  const championPositions = [...championPositionGroups.values()].flatMap(
    (group): PerformanceScopeSummary[] => {
      const summary = summarize({
        kind: "champion_position",
        key: `champion_position:${group.championId}:${group.position}`,
        championId: group.championId,
        position: group.position,
      }, group.observations)
      return summary ? [summary] : []
    },
  ).sort((left, right) => right.games - left.games ||
    (left.championId ?? 0) - (right.championId ?? 0) || left.key.localeCompare(right.key))

  return { overall, positions, primaryArchetypes, championPositions }
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
  const headlineEligible = aggregate.responsibility.positiveGames > 0
  const recentScore = scoringContext === "profile" && recent?.score !== null &&
      recent?.score !== undefined
    ? roundScore(recent.score)
    : undefined
  const comparison = scoringContext === "match"
    ? "Frozen-reference metric percentile from this match"
    : "Frozen-reference metric percentiles across recorded matches"

  return {
    key: family,
    label: presentation.label,
    shortLabel: presentation.shortLabel,
    description: headlineEligible
      ? presentation.description
      : `${presentation.description} This vector is diagnostic for the observed sample and was excluded from every stored role-fit headline.`,
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
    metrics: aggregate.metrics.map((metric): PerformanceMetricScore => ({
      key: metric.key,
      label: metric.label,
      score: metric.score === null ? null : roundScore(metric.score),
      rawValue: metric.rawValue,
      unit: metric.unit,
      tier: metric.tier,
      weight: metric.gradeWeight,
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
        ? `${comparison}; ${metric.comparisonScope} reference`
        : comparison,
      comparisonScope: metric.comparisonScope,
      referenceMatchCount: metric.referenceMatchCount,
    })),
  }
}

export function buildPerformanceProfile(
  input: PerformanceProfileV3Input,
): PerformanceProfile | undefined
/** @deprecated Supply PerformanceProfileV3Input with rviObservations. */
export function buildPerformanceProfile(
  input: LegacyPerformanceProfileInput,
): PerformanceProfile | undefined
export function buildPerformanceProfile(
  input: PerformanceProfileV3Input | LegacyPerformanceProfileInput,
): PerformanceProfile | undefined {
  if (!isPerformanceProfileV3Input(input)) return undefined

  const scoringContext: PerformanceScoringContext = input.scoringContext === "match"
    ? "match"
    : "profile"
  const recipeId = input.recipeId ?? GRADE_V3_RECIPE_ID
  const observations = orderedObservations(input.rviObservations)
  const aggregate = aggregateRviProfile({
    recipeId,
    familyKeys: RVI_VECTOR_KEYS,
    observations,
    weighting: input.weighting,
  })
  if (aggregate.headline.score === null || aggregate.headline.confidence === null) return undefined

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
  const dimensions = RVI_VECTOR_KEYS.flatMap((family) => {
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

  return {
    algorithmVersion: PERFORMANCE_PROFILE_VERSION,
    recipeId,
    scoringContext,
    weighting: aggregate.weighting,
    score: roundScore(aggregate.headline.score),
    headline: aggregate.headline,
    recentHeadline: recent?.headline,
    scopes: buildPerformanceScopes(observations, recipeId, aggregate),
    auxiliary: scoringContext === "profile"
      ? {
        excludedFromHeadline: true,
        consistency: aggregate.consistency,
        versatility: aggregate.versatility,
      }
      : undefined,
    games: observations.length,
    recentGames: recentObservations.length,
    measuredGames: aggregate.headline.coverage.observedGames,
    coverage: aggregate.headline.coverage.gameRatio ?? 0,
    confidence: aggregate.headline.confidence,
    comparison: scoringContext === "match"
      ? "Authoritative Grade v3 role-fit percentile from this match"
      : "Authoritative Grade v3 role-fit percentiles across recorded matches",
    dimensions,
    strongestKey: strongest?.key,
    growthKey: growth?.key,
  }
}
