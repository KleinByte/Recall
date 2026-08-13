import type { Database } from "better-sqlite3"
import type { StatsFilter } from "./matches-repo.js"
import { durationBucketsFor } from "../matches/insights.js"
import { computePerGameAxes } from "../matches/style.js"
import type { ModeFamily, TrackedMode } from "../matches/types.js"
import type { GradeComponent } from "../review/types.js"
import type { CompactTimeline } from "../riot/timeline-mapper.js"
import {
  MATCH_GRADE_ARM_KEYS,
  MATCH_GRADE_ARM_LABELS,
  CANONICAL_GRADE_STORAGE_PARTITION,
  gradeRecipeDefinitionId,
} from "../matches/match-grade-recipe.js"
import {
  PRIMARY_ARCHETYPES,
  type PrimaryArchetype,
} from "../matches/match-grade-taxonomy.js"
import {
  MetricObservationsRepository,
  type OwnerMetricObservation,
} from "./metric-observations-repo.js"
import {
  RVI_VECTOR_KEYS,
  type RviMatchObservation,
  type RviMetricObservation,
  type RviVectorKey,
} from "../matches/rvi-contract.js"
import type { Evidence, EvidenceState } from "../../../src/shared/measurement.js"
import {
  metricDefinition,
  rviMetricPolicy,
} from "../matches/match-metric-registry.js"
import {
  CANONICAL_RVI_STORAGE_PARTITION,
} from "../matches/rvi-recipe.js"
import {
  getCompatibleGradeRecipeSelection,
  getCompatibleRviRecipeSelection,
  type CompatibleGradeRecipeSelection,
} from "./grade-recipe-selection.js"
import {
  GRADE_CORE_FACT_CONTRACT_VERSION,
  isGradeCoreSource,
} from "../matches/grade-core-facts.js"
import { sessionize } from "../matches/analytics.js"

export interface BucketRow {
  label: string
  games: number
  wins: number
  winRate: number
  avgGradeScore?: number
}

export interface TimeBucketRow {
  label: string
  games: number
  wins: number
  winRate: number
}

export interface StreakBehaviour {
  afterWin: TimeBucketRow
  afterLoss: TimeBucketRow
}

export interface ContributionShare {
  games: number
  damageShare: number
  goldShare: number
  killShare: number
}

export interface ChampionPool {
  champions: number
  games: number
  coreShare: number
  coreWinRate: number
  restWinRate: number
  top: Array<{ championId: number; games: number; wins: number }>
}

export interface BuiltItem {
  itemId: number
  games: number
  wins: number
  winRate: number
}

export interface InsightMetrics {
  kda: number
  deaths: number
  damagePerMinute: number
  damageTakenPerMinute: number
  goldPerMinute: number
  csPerMinute: number
  visionPerMinute?: number
  objectiveDamagePerMinute?: number
  ccPerMinute?: number
  killParticipation?: number
  teamDamageShare?: number
  allyHealShieldPerMinute?: number
}

export interface InsightObservation {
  gameId: number
  playedAt: number
  endedAt?: number
  mode: TrackedMode
  family: ModeFamily
  queueId: number
  win: boolean
  grade?: string
  /** Legacy/internal compatibility normal score. */
  gradeScore?: number
  /** Authoritative Recall score on a fixed 0-100 scale. */
  recallScore?: number
  championId: number
  role?: string
  durationSecs: number
  /** Stable account-history session identity, computed before page filters. */
  session?: number
  /** Stable ordinal within the account-history session, computed before page filters. */
  sessionGame?: number
  restMinutes?: number
  previousWin?: boolean
  priorChampionGames?: number
  completeLobby: boolean
  metrics: InsightMetrics
  styleAxes: Record<string, number>
}

export interface GradeComponentObservation {
  gameId: number
  playedAt: number
  win?: boolean
  championId?: number
  role?: string
  grade?: string
  /** Authoritative Recall score on a fixed 0-100 scale. */
  recallScore?: number
  session?: number
  sessionGame?: number
  restMinutes?: number
  compositePercentile: number
  components: GradeComponent[]
}

/**
 * Authoritative RVI input for the one match Grade recipe selected by this install.
 * Recipe identity travels with the rows so callers never need to infer it from
 * an algorithm version or from whichever breakdown happens to be newest.
 */
export interface RviObservationSet {
  algorithmVersion: typeof CANONICAL_GRADE_STORAGE_PARTITION
  recipeId: string
  calibrationId: string
  familyKeys: readonly RviVectorKey[]
  observations: RviMatchObservation[]
}

export interface FinalItemObservation {
  gameId: number
  championId: number
  role?: string
  /** Authoritative Recall score on a fixed 0-100 scale. */
  recallScore?: number
  itemIds: number[]
}

/** Three-hour blocks, which stay readable with a small history. */
const HOUR_BLOCKS = [
  "00–03",
  "03–06",
  "06–09",
  "09–12",
  "12–15",
  "15–18",
  "18–21",
  "21–24",
]

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** How many champions count as the player's core pool. */
const CORE_POOL_SIZE = 5

/** Slots 0–5 are the build; slot 6 is the trinket, which is not a purchase. */
const BUILD_SLOTS = ["item0", "item1", "item2", "item3", "item4", "item5"]

function normalizedRole(alias = ""): string {
  const prefix = alias ? `${alias}.` : ""
  return `CASE
    WHEN UPPER(COALESCE(${prefix}resolved_position, '')) IN
        ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')
      THEN UPPER(${prefix}resolved_position)
    WHEN UPPER(COALESCE(${prefix}role, '')) IN ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')
      THEN UPPER(${prefix}role)
    WHEN UPPER(COALESCE(${prefix}role, '')) IN ('SUPPORT', 'DUO_SUPPORT') THEN 'UTILITY'
    WHEN UPPER(COALESCE(${prefix}role, '')) IN ('CARRY', 'DUO_CARRY') THEN 'BOTTOM'
    WHEN UPPER(COALESCE(${prefix}lane, '')) IN ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM')
      THEN UPPER(${prefix}lane)
    ELSE NULL
  END`
}

function canonicalParticipantRole(participantAlias = "p", matchAlias = "m"): string {
  return `CASE
    WHEN UPPER(COALESCE(${participantAlias}.resolved_position, '')) IN
        ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')
      THEN UPPER(${participantAlias}.resolved_position)
    ELSE ${normalizedRole(matchAlias)}
  END`
}

export interface RviTimelineObservation {
  gameId: number
  playedAt: number
  durationSecs: number
  participantId: number
  teamId: number
  opponentParticipantId?: number
  summary: CompactTimeline
}

function scope(filter: StatsFilter) {
  const conditions = ["puuid = ?", "is_matched = 1"]
  const params: (string | number)[] = [filter.puuid]

  if (filter.mode) {
    conditions.push("mode = ?")
    params.push(filter.mode)
  } else if (filter.modes?.length) {
    conditions.push(`mode IN (${filter.modes.map(() => "?").join(", ")})`)
    params.push(...filter.modes)
  }

  if (filter.modeFamily) {
    conditions.push("mode_family = ?")
    params.push(filter.modeFamily)
  }

  if (filter.sinceMs !== undefined) {
    conditions.push("played_at >= ?")
    params.push(filter.sinceMs)
  }

  if (filter.untilMs !== undefined) {
    conditions.push("played_at <= ?")
    params.push(filter.untilMs)
  }

  if (filter.championIds?.length) {
    conditions.push(`champion_id IN (${filter.championIds.map(() => "?").join(", ")})`)
    params.push(...filter.championIds)
  }

  if (filter.roles?.length) {
    conditions.push(`${normalizedRole()} IN (${filter.roles.map(() => "?").join(", ")})`)
    params.push(...filter.roles)
  }

  return { where: `WHERE ${conditions.join(" AND ")}`, params }
}

/** Conditions against the participant table, optionally narrowed by mode. */
function lobbyScope(filter: StatsFilter) {
  const conditions = ["p.puuid = ?", "COALESCE(m.is_matched, 1) = 1"]
  const params: (string | number)[] = [filter.puuid]

  if (filter.mode) {
    conditions.push("m.mode = ?")
    params.push(filter.mode)
  } else if (filter.modes?.length) {
    conditions.push(`m.mode IN (${filter.modes.map(() => "?").join(", ")})`)
    params.push(...filter.modes)
  }

  if (filter.modeFamily) {
    conditions.push("m.mode_family = ?")
    params.push(filter.modeFamily)
  }

  if (filter.sinceMs !== undefined) {
    conditions.push("m.played_at >= ?")
    params.push(filter.sinceMs)
  }

  if (filter.untilMs !== undefined) {
    conditions.push("m.played_at <= ?")
    params.push(filter.untilMs)
  }

  if (filter.championIds?.length) {
    conditions.push(`m.champion_id IN (${filter.championIds.map(() => "?").join(", ")})`)
    params.push(...filter.championIds)
  }

  if (filter.roles?.length) {
    conditions.push(`${normalizedRole("m")} IN (${filter.roles.map(() => "?").join(", ")})`)
    params.push(...filter.roles)
  }

  return { conditions, params }
}

const rate = (wins: number, games: number) => (games === 0 ? 0 : wins / games)

const finiteInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum

interface SelectedGradeResult {
  grade: string
  gradeScore: number
  recallScore: number
}

interface AccountSessionContext {
  session: number
  sessionGame: number
  restMinutes?: number
  previousWin?: boolean
  priorChampionGames: number
}

/**
 * Reads only ready owner results for the selected calibrated recipe. The
 * denormalized match columns are a display cache; analyses use the immutable
 * result table so an interrupted rebuild cannot mix recipes in one sample.
 */
function selectedGradeResults(
  db: Database,
  filter: StatsFilter,
  selected: CompatibleGradeRecipeSelection | undefined,
): Map<number, SelectedGradeResult> {
  if (!selected) return new Map()
  const { conditions, params } = lobbyScope(filter)
  const rows = db.prepare(
    `SELECT m.game_id AS gameId, r.grade, r.grade_score AS gradeScore,
            r.role_fit_score AS recallScore
     FROM match_participants p
     JOIN matches m
       ON m.game_id = p.game_id AND m.puuid = p.puuid
     JOIN match_grade_attempts a
       ON a.game_id = p.game_id AND a.puuid = p.puuid
      AND a.owner_participant_id = p.participant_id
      AND a.algorithm_version = ? AND a.recipe_id = ?
      AND a.grade_status = 'ready'
     JOIN match_grade_results r
       ON r.game_id = p.game_id AND r.puuid = p.puuid
      AND r.participant_id = p.participant_id
      AND r.algorithm_version = a.algorithm_version
      AND r.recipe_id = a.recipe_id
      AND r.grade_status = 'ready'
      AND r.role_fit_score IS NOT NULL
      AND a.role_fit_score = r.role_fit_score
     WHERE ${[...conditions, "p.is_player = 1"].join(" AND ")}`,
  ).all(
    CANONICAL_GRADE_STORAGE_PARTITION,
    selected.recipeId,
    ...params,
  ) as Array<{ gameId: number; grade: string; gradeScore: number; recallScore: number }>

  return new Map(rows.flatMap((row): Array<[number, SelectedGradeResult]> =>
    finiteInRange(row.recallScore, 0, 100) && Number.isFinite(row.gradeScore)
      ? [[row.gameId, {
          grade: row.grade,
          gradeScore: row.gradeScore,
          recallScore: row.recallScore,
        }]]
      : []))
}

/**
 * Session identity is account chronology, not filtered-page chronology.
 * Intervening modes, champions, and positions therefore still advance the
 * physical play session before a selected report is sliced.
 */
function accountSessionContexts(db: Database, puuid: string): Map<number, AccountSessionContext> {
  const rows = db.prepare(
    `SELECT game_id AS gameId, played_at AS startedAt,
            duration_secs AS durationSecs, win, champion_id AS championId
     FROM matches
     WHERE puuid = ? AND is_matched = 1
     ORDER BY played_at ASC, game_id ASC`,
  ).all(puuid) as Array<{
    gameId: number
    startedAt: number
    durationSecs: number
    win: number
    championId: number
  }>
  const sessions = sessionize(rows)
  const contexts = new Map<number, AccountSessionContext>()
  const championCounts = new Map<number, number>()
  for (let index = 0; index < sessions.length; index++) {
    const current = sessions[index]
    const previous = sessions[index - 1]
    const priorChampionGames = championCounts.get(current.championId) ?? 0
    contexts.set(current.gameId, {
      session: current.session,
      sessionGame: current.sessionGame,
      restMinutes: current.restMinutes,
      previousWin: previous?.session === current.session ? previous.win === 1 : undefined,
      priorChampionGames,
    })
    championCounts.set(current.championId, priorChampionGames + 1)
  }
  return contexts
}

interface ParsedGradeBreakdown {
  components: GradeComponent[]
  primaryArchetype: PrimaryArchetype
  metrics: ParsedGradeMetric[]
}

interface ParsedGradeMetric {
  key: string
  percentile: number | null
  evidenceState: EvidenceState | "missing"
  evidenceReason?: string
  sourceEvidenceState: EvidenceState | "missing"
  sourceEvidenceReason?: string
  gradeWeight: number
  responsibilityTier: "CORE" | "SECONDARY" | "DIAGNOSTIC" | "N/A"
  comparisonScope?: "role" | "lobby"
  referenceMatchCount?: number
}

const PRIMARY_ARCHETYPE_KEYS = new Set<string>(PRIMARY_ARCHETYPES)
const GRADE_EVIDENCE_STATES = new Set([
  "observed",
  "unavailable",
  "no_opportunity",
  "invalid",
  "not_applicable",
  "unknown",
  "missing",
])

function parsedResponsibilityTier(value: unknown): ParsedGradeMetric["responsibilityTier"] {
  return value === 2 ? "CORE" : value === 1 ? "SECONDARY" : "DIAGNOSTIC"
}

/**
 * Stored match Grade component scores are calibrated 0-1 family percentiles.
 * RVI's public observation contract uses 0-100. Missing diagnostic families
 * remain null; they are coverage gaps and must not silently become zero.
 */
function parseGradeBreakdown(
  value: string,
  recipeId: string,
  recallScore: number,
  recipeDefinitionId: string,
): ParsedGradeBreakdown | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
  const breakdown = parsed as Record<string, unknown>
  const storedRecallScore = breakdown.recallScore ?? breakdown.roleFitScore
  if (breakdown.algorithmVersion !== CANONICAL_GRADE_STORAGE_PARTITION ||
      breakdown.recipeDefinitionId !== recipeDefinitionId ||
      breakdown.recipeId !== recipeId ||
      typeof breakdown.primaryArchetype !== "string" ||
      !PRIMARY_ARCHETYPE_KEYS.has(breakdown.primaryArchetype) ||
      !finiteInRange(storedRecallScore, 0, 100) ||
      Math.abs(storedRecallScore - recallScore) > 1e-9 ||
      !Array.isArray(breakdown.components) || breakdown.components.length === 0) return undefined

  const seen = new Set<string>()
  const seenMetrics = new Set<string>()
  const knownFamilies = new Set<string>(MATCH_GRADE_ARM_KEYS)
  const components: GradeComponent[] = []
  const metrics: ParsedGradeMetric[] = []
  for (const value of breakdown.components) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    const component = value as Record<string, unknown>
    const percentile = component.componentScore ?? component.rankPercentile
    if (typeof component.key !== "string" || !knownFamilies.has(component.key) ||
        seen.has(component.key) || typeof component.label !== "string" ||
        !finiteInRange(percentile, 0, 1) || !finiteInRange(component.weight, 0, 1) ||
        !finiteInRange(component.contribution, 0, 1) ||
        (component.comparisonScope !== undefined &&
          component.comparisonScope !== "lobby" && component.comparisonScope !== "role")) {
      return undefined
    }
    seen.add(component.key)
    components.push({
      key: component.key as GradeComponent["key"],
      label: MATCH_GRADE_ARM_LABELS[component.key as GradeComponent["key"]],
      percentile,
      weight: component.weight,
      contribution: component.contribution,
      scope: component.comparisonScope === "lobby" ? "lobby" : "role",
    })
    if (component.signals !== undefined && !Array.isArray(component.signals)) return undefined
    for (const signalValue of component.signals ?? []) {
      if (!signalValue || typeof signalValue !== "object" || Array.isArray(signalValue)) {
        return undefined
      }
      const signal = signalValue as Record<string, unknown>
      if (typeof signal.key !== "string" || !metricDefinition(signal.key) ||
          seenMetrics.has(signal.key) || !finiteInRange(signal.percentile, 0, 1) ||
          !finiteInRange(signal.weight, 0, 1) || signal.evidenceState !== "observed" ||
          typeof signal.sourceEvidenceState !== "string" ||
          !GRADE_EVIDENCE_STATES.has(signal.sourceEvidenceState) ||
          (signal.sourceEvidenceReason !== undefined &&
            typeof signal.sourceEvidenceReason !== "string")) return undefined
      seenMetrics.add(signal.key)
      metrics.push({
        key: signal.key,
        percentile: signal.percentile,
        evidenceState: "observed",
        sourceEvidenceState: signal.sourceEvidenceState as EvidenceState | "missing",
        sourceEvidenceReason: signal.sourceEvidenceReason as string | undefined,
        gradeWeight: component.weight * signal.weight,
        responsibilityTier: parsedResponsibilityTier(component.responsibilityTier),
        comparisonScope: component.comparisonScope === "lobby" ? "lobby" : "role",
        referenceMatchCount: Number.isSafeInteger(component.peerCount) &&
          (component.peerCount as number) >= 0 ? component.peerCount as number : undefined,
      })
    }
  }

  if (breakdown.diagnosticMetrics !== undefined && !Array.isArray(breakdown.diagnosticMetrics)) {
    return undefined
  }
  for (const diagnosticValue of breakdown.diagnosticMetrics ?? []) {
    if (!diagnosticValue || typeof diagnosticValue !== "object" ||
        Array.isArray(diagnosticValue)) return undefined
    const diagnostic = diagnosticValue as Record<string, unknown>
    if (typeof diagnostic.key !== "string" || !metricDefinition(diagnostic.key) ||
        seenMetrics.has(diagnostic.key) || typeof diagnostic.evidenceState !== "string" ||
        !GRADE_EVIDENCE_STATES.has(diagnostic.evidenceState) ||
        (diagnostic.sourceEvidenceState !== undefined &&
          (typeof diagnostic.sourceEvidenceState !== "string" ||
            !GRADE_EVIDENCE_STATES.has(diagnostic.sourceEvidenceState))) ||
        (diagnostic.sourceEvidenceReason !== undefined &&
          typeof diagnostic.sourceEvidenceReason !== "string")) return undefined
    const evidenceState = diagnostic.evidenceState as EvidenceState | "missing"
    if (evidenceState === "observed" && !finiteInRange(diagnostic.percentile, 0, 1)) {
      return undefined
    }
    if (evidenceState !== "observed" && diagnostic.percentile !== undefined) return undefined
    seenMetrics.add(diagnostic.key)
    metrics.push({
      key: diagnostic.key,
      percentile: evidenceState === "observed" ? diagnostic.percentile as number : null,
      evidenceState,
      evidenceReason: typeof diagnostic.calibrationReason === "string"
        ? diagnostic.calibrationReason
        : undefined,
      sourceEvidenceState: (diagnostic.sourceEvidenceState ?? evidenceState) as
        EvidenceState | "missing",
      sourceEvidenceReason: diagnostic.sourceEvidenceReason as string | undefined,
      gradeWeight: 0,
      responsibilityTier: "DIAGNOSTIC",
    })
  }
  return {
    components,
    primaryArchetype: breakdown.primaryArchetype as PrimaryArchetype,
    metrics,
  }
}

function unobservedEvidence(
  state: Exclude<EvidenceState, "observed"> | "missing",
  reason?: string,
): Evidence<number> {
  return state === "missing"
    ? { state: "unavailable", reason: reason ?? "legacy_missing_evidence", source: "legacy" }
    : reason ? { state, reason } : { state }
}

function scoreEvidenceFromParsed(metric: ParsedGradeMetric): Evidence<number> {
  if (metric.evidenceState === "observed") {
    return metric.percentile === null
      ? { state: "invalid", reason: "observed_percentile_missing" }
      : { state: "observed", value: metric.percentile * 100, source: "derived" }
  }
  return unobservedEvidence(metric.evidenceState, metric.evidenceReason)
}

function rawEvidenceFromParsed(metric: ParsedGradeMetric): Evidence<number> {
  if (metric.sourceEvidenceState === "observed") {
    return {
      state: "unavailable",
      reason: "raw_value_not_retained_in_grade_breakdown",
      source: "legacy",
    }
  }
  return unobservedEvidence(metric.sourceEvidenceState, metric.sourceEvidenceReason)
}

function scaledStoredScore(evidence: Evidence<number>): Evidence<number> {
  return evidence.state === "observed"
    ? { ...evidence, value: evidence.value * 100 }
    : evidence
}

function metricTier(
  rawEvidence: Evidence<number>,
  scoreEvidence: Evidence<number>,
  policyTier: RviMetricObservation["tier"],
): RviMetricObservation["tier"] {
  if (rawEvidence.state === "not_applicable" || scoreEvidence.state === "not_applicable") {
    return "N/A"
  }
  return policyTier
}

function rviMetricFromStored(
  metric: OwnerMetricObservation,
  parsedByKey: ReadonlyMap<string, ParsedGradeMetric>,
): RviMetricObservation | undefined {
  const definition = metricDefinition(metric.metricKey)
  const policy = rviMetricPolicy(metric.metricKey)
  if (!definition || !policy) return undefined
  const parsed = parsedByKey.get(metric.metricKey)
  // The frozen Grade component is authoritative for any metric it consumed,
  // including neutral no-opportunity evidence. The stored row still preserves
  // literal raw provenance for audit and display.
  const scoreEvidence = parsed
    ? scoreEvidenceFromParsed(parsed)
    : scaledStoredScore(metric.scoreEvidence)
  const tier = metricTier(
    metric.rawEvidence,
    scoreEvidence,
    policy.tier,
  )
  return {
    key: metric.metricKey,
    vector: policy.vector,
    label: definition.label,
    description: definition.description,
    formula: definition.formula,
    unit: metric.unit || definition.unit,
    tier,
    vectorWeight: tier === "N/A" ? 0 : policy.vectorWeight,
    gradeWeight: tier === "N/A" ? 0 : parsed?.gradeWeight ?? 0,
    rawEvidence: metric.rawEvidence,
    scoreEvidence,
    comparisonScope: metric.comparisonScope,
    referenceMatchCount: metric.referenceMatchCount,
    sourceQuality: metric.sourceQuality,
  }
}

function rviMetricFromBreakdown(metric: ParsedGradeMetric): RviMetricObservation | undefined {
  const definition = metricDefinition(metric.key)
  const policy = rviMetricPolicy(metric.key)
  if (!definition || !policy) return undefined
  const rawEvidence = rawEvidenceFromParsed(metric)
  const scoreEvidence = scoreEvidenceFromParsed(metric)
  const tier = metricTier(rawEvidence, scoreEvidence, policy.tier)
  return {
    key: metric.key,
    vector: policy.vector,
    label: definition.label,
    description: definition.description,
    formula: definition.formula,
    unit: definition.unit,
    tier,
    vectorWeight: tier === "N/A" ? 0 : policy.vectorWeight,
    gradeWeight: tier === "N/A" ? 0 : metric.gradeWeight,
    rawEvidence,
    scoreEvidence,
    comparisonScope: metric.comparisonScope,
    referenceMatchCount: metric.referenceMatchCount,
    sourceQuality: "legacy",
  }
}

function rviMetricsForMatch(
  breakdown: ParsedGradeBreakdown,
  stored: readonly OwnerMetricObservation[],
): RviMetricObservation[] {
  const parsedByKey = new Map(breakdown.metrics.map((metric) => [metric.key, metric]))
  const merged = new Map<string, RviMetricObservation>()
  for (const metric of breakdown.metrics) {
    const fallback = rviMetricFromBreakdown(metric)
    if (fallback) merged.set(fallback.key, fallback)
  }
  for (const metric of stored) {
    const exact = rviMetricFromStored(metric, parsedByKey)
    if (exact) merged.set(exact.key, exact)
  }
  return [...merged.values()].sort((left, right) => left.key.localeCompare(right.key))
}

function rviVectorMapsForMatch(breakdown: ParsedGradeBreakdown): {
  familyPercentiles: Record<RviVectorKey, number | null>
  familyResponsibilityWeights: Record<RviVectorKey, number | null>
} {
  const familyPercentiles = Object.fromEntries(
    RVI_VECTOR_KEYS.map((key) => [key, null]),
  ) as Record<RviVectorKey, number | null>
  const familyResponsibilityWeights = Object.fromEntries(
    RVI_VECTOR_KEYS.map((key) => [key, null]),
  ) as Record<RviVectorKey, number | null>

  // The immutable Grade breakdown is authoritative for match arms. Stored
  // metric rows explain those arms, but cannot silently rebuild a different
  // radar after a late refresh or an applicability-policy change.
  for (const component of breakdown.components) {
    const vector = component.key as RviVectorKey
    familyPercentiles[vector] = component.percentile * 100
    familyResponsibilityWeights[vector] = component.weight
  }

  return { familyPercentiles, familyResponsibilityWeights }
}

/**
 * Questions about a player's record that need more than a running total.
 *
 * Each answer states how many games it rests on, because with a few dozen
 * games most of these are suggestive rather than conclusive, and the caller
 * needs to be able to say so.
 */
export class InsightsRepository {
  constructor(readonly db: Database) {}

  /**
   * Results by how long the game ran.
   *
   * Empty bands are kept, so the shape of the answer never depends on the
   * data and a chart does not reshuffle itself as history accumulates.
   */
  getDurationBuckets(filter: StatsFilter, family: ModeFamily): BucketRow[] {
    const { where, params } = scope(filter)

    const total = this.db
      .prepare(`SELECT COUNT(*) AS games FROM matches ${where}`)
      .get(...params) as { games: number }

    if (total.games === 0) return []

    let floor = 0

    return durationBucketsFor(family).map((bucket) => {
      const row = this.db
        .prepare(
          `SELECT COUNT(*) AS games, COALESCE(SUM(win), 0) AS wins,
                  AVG(grade_score) AS avgGradeScore
           FROM matches ${where}
             AND duration_secs >= ? AND duration_secs < ?`,
        )
        .get(...params, floor, bucket.maxSecs) as {
        games: number
        wins: number
        avgGradeScore: number | null
      }

      floor = bucket.maxSecs

      return {
        label: bucket.label,
        games: row.games,
        wins: row.wins,
        winRate: rate(row.wins, row.games),
        avgGradeScore: row.avgGradeScore ?? undefined,
      }
    })
  }

  /**
   * Results by when the game was played, in the player's own timezone.
   *
   * Hours and weekdays are reported separately rather than as a grid: a 7 × 24
   * heatmap needs hundreds of games before it says anything at all.
   */
  getTimeOfDay(filter: StatsFilter): {
    hours: TimeBucketRow[]
    weekdays: TimeBucketRow[]
  } {
    const { where, params } = scope(filter)

    const rows = this.db
      .prepare(
        `SELECT
           CAST(strftime('%H', played_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
           CAST(strftime('%w', played_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS weekday,
           COUNT(*) AS games,
           COALESCE(SUM(win), 0) AS wins
         FROM matches ${where}
         GROUP BY hour, weekday`,
      )
      .all(...params) as {
      hour: number
      weekday: number
      games: number
      wins: number
    }[]

    if (rows.length === 0) return { hours: [], weekdays: [] }

    const hours = HOUR_BLOCKS.map((label) => ({
      label,
      games: 0,
      wins: 0,
      winRate: 0,
    }))
    const weekdays = WEEKDAYS.map((label) => ({
      label,
      games: 0,
      wins: 0,
      winRate: 0,
    }))

    for (const row of rows) {
      const block = hours[Math.floor(row.hour / 3)]
      block.games += row.games
      block.wins += row.wins

      const day = weekdays[row.weekday]
      day.games += row.games
      day.wins += row.wins
    }

    for (const entry of [...hours, ...weekdays]) {
      entry.winRate = rate(entry.wins, entry.games)
    }

    return { hours, weekdays }
  }

  /**
   * How the player does after a win compared with after a loss.
   *
   * `LAG` reads the previous game in play order, which answers the question
   * without pulling the whole history into memory to walk it.
   */
  getStreakBehaviour(filter: StatsFilter): StreakBehaviour | undefined {
    const { where, params } = scope(filter)

    const rows = this.db
      .prepare(
        `SELECT previous, COUNT(*) AS games, COALESCE(SUM(win), 0) AS wins
         FROM (
           SELECT win,
                  LAG(win) OVER (ORDER BY played_at, game_id) AS previous
           FROM matches ${where}
         )
         WHERE previous IS NOT NULL
         GROUP BY previous`,
      )
      .all(...params) as { previous: number; games: number; wins: number }[]

    if (rows.length === 0) return undefined

    const of = (previous: number): TimeBucketRow => {
      const row = rows.find((entry) => entry.previous === previous)
      const games = row?.games ?? 0
      const wins = row?.wins ?? 0

      return {
        label: previous === 1 ? "After a win" : "After a loss",
        games,
        wins,
        winRate: rate(wins, games),
      }
    }

    return { afterWin: of(1), afterLoss: of(0) }
  }

  /**
   * The player's share of what their own side produced.
   *
   * Grouping by game and team and keeping only the side containing the player
   * means a share is always out of four teammates plus themselves, never out
   * of the whole lobby. Shares are averaged per game so one enormous game
   * cannot speak for the rest.
   */
  getTeamContribution(filter: StatsFilter): ContributionShare | undefined {
    const { conditions, params } = lobbyScope(filter)

    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS games,
                AVG(damageShare) AS damageShare,
                AVG(goldShare)   AS goldShare,
                AVG(killShare)   AS killShare
         FROM (
           SELECT
             SUM(CASE WHEN p.is_player = 1 THEN p.damage_to_champions ELSE 0 END) * 1.0
               / NULLIF(SUM(p.damage_to_champions), 0) AS damageShare,
             SUM(CASE WHEN p.is_player = 1 THEN p.gold_earned ELSE 0 END) * 1.0
               / NULLIF(SUM(p.gold_earned), 0) AS goldShare,
             SUM(CASE WHEN p.is_player = 1 THEN p.kills ELSE 0 END) * 1.0
               / NULLIF(SUM(p.kills), 0) AS killShare
           FROM match_participants p
           LEFT JOIN matches m
             ON m.game_id = p.game_id AND m.puuid = p.puuid
           WHERE ${conditions.join(" AND ")}
           GROUP BY p.game_id, p.team_id
           HAVING SUM(p.is_player) = 1
         )`,
      )
      .get(...params) as {
      games: number
      damageShare: number | null
      goldShare: number | null
      killShare: number | null
    }

    if (row.games === 0) return undefined

    return {
      games: row.games,
      damageShare: row.damageShare ?? 0,
      goldShare: row.goldShare ?? 0,
      killShare: row.killShare ?? 0,
    }
  }

  /** How wide the champion pool is, and whether spreading out costs anything. */
  getChampionPool(filter: StatsFilter): ChampionPool | undefined {
    const { where, params } = scope(filter)

    const rows = this.db
      .prepare(
        `SELECT champion_id AS championId, COUNT(*) AS games,
                COALESCE(SUM(win), 0) AS wins
         FROM matches ${where}
         GROUP BY champion_id
         ORDER BY games DESC, wins DESC`,
      )
      .all(...params) as { championId: number; games: number; wins: number }[]

    if (rows.length === 0) return undefined

    const core = rows.slice(0, CORE_POOL_SIZE)
    const rest = rows.slice(CORE_POOL_SIZE)

    const sum = (entries: typeof rows, key: "games" | "wins") =>
      entries.reduce((total, entry) => total + entry[key], 0)

    const games = sum(rows, "games")

    return {
      champions: rows.length,
      games,
      coreShare: games === 0 ? 0 : sum(core, "games") / games,
      coreWinRate: rate(sum(core, "wins"), sum(core, "games")),
      restWinRate: rate(sum(rest, "wins"), sum(rest, "games")),
      top: core,
    }
  }

  /**
   * The items the player finishes games holding.
   *
   * The client exposes no purchase events, so this is the final inventory and
   * never the order things were bought in.
   */
  getBuildPatterns(filter: StatsFilter, limit: number): BuiltItem[] {
    const { conditions, params } = lobbyScope(filter)
    const all = [...conditions, "p.is_player = 1"].join(" AND ")

    const slots = BUILD_SLOTS.map(
      (slot) =>
        `SELECT p.${slot} AS itemId, p.win AS win
         FROM match_participants p
         LEFT JOIN matches m
           ON m.game_id = p.game_id AND m.puuid = p.puuid
         WHERE ${all}`,
    ).join(" UNION ALL ")

    // The clause is repeated once per slot, so its parameters must be too.
    const slotParams = BUILD_SLOTS.flatMap(() => params)

    return this.db
      .prepare(
        `SELECT itemId, COUNT(*) AS games, COALESCE(SUM(win), 0) AS wins,
                COALESCE(SUM(win), 0) * 1.0 / COUNT(*) AS winRate
         FROM (${slots})
         WHERE itemId > 0
         GROUP BY itemId
         ORDER BY games DESC, wins DESC
         LIMIT ?`,
      )
      .all(...slotParams, limit) as BuiltItem[]
  }

  /**
   * Bounded observation set for all scoped matches.
   *
   * Returns local metrics from matches plus complete-lobby metrics from
   * participants when available, using a constant number of SQL statements.
   */
  getObservations(filter: StatsFilter): InsightObservation[] {
    const { where, params } = scope(filter)
    const activeGrades = selectedGradeResults(
      this.db,
      filter,
      getCompatibleGradeRecipeSelection(this.db),
    )
    const sessionContexts = accountSessionContexts(this.db, filter.puuid)

    // One query for all local metrics ordered by played_at, game_id
    const matchRows = this.db
      .prepare(
        `SELECT game_id, played_at, mode, mode_family, queue_id, win,
                grade, grade_score, role_fit_score, champion_id,
                ${normalizedRole()} AS resolved_role, duration_secs,
                kills, deaths, assists,
                damage_to_champions, damage_taken, damage_self_mitigated,
                total_heal, gold_earned,
                total_minions_killed, neutral_minions,
                vision_score, damage_objectives, time_ccing_others
         FROM matches ${where}
         ORDER BY played_at ASC, game_id ASC`,
      )
      .all(...params) as {
      game_id: number
      played_at: number
      mode: TrackedMode
      mode_family: ModeFamily
      queue_id: number
      win: number
      grade: string | null
      grade_score: number | null
      role_fit_score: number | null
      champion_id: number
      resolved_role: string | null
      duration_secs: number
      kills: number
      deaths: number
      assists: number
      damage_to_champions: number
      damage_taken: number
      damage_self_mitigated: number
      total_heal: number
      gold_earned: number
      total_minions_killed: number
      neutral_minions: number
      vision_score: number
      damage_objectives: number
      time_ccing_others: number
    }[]

    if (matchRows.length === 0) return []

    // One grouped query for complete-lobby totals (team kills, team damage, heal/shield)
    // Uses a CTE to compute game-wide stats (total participants, team count) for completeLobby detection
    const { conditions, params: lobbyParams } = lobbyScope(filter)
    const lobbyRows = this.db
      .prepare(
        `WITH game_stats AS (
           SELECT p.game_id,
                  COUNT(*) AS total_participants,
                  COUNT(DISTINCT p.team_id) AS team_count
           FROM match_participants p
           LEFT JOIN matches m
             ON m.game_id = p.game_id AND m.puuid = p.puuid
           WHERE ${conditions.join(" AND ")}
           GROUP BY p.game_id
         )
         SELECT p.game_id,
                SUM(CASE WHEN p.is_player = 1 THEN p.kills ELSE 0 END) AS player_kills,
                SUM(CASE WHEN p.is_player = 1 THEN p.assists ELSE 0 END) AS player_assists,
                SUM(CASE WHEN p.is_player = 1 THEN p.damage_to_champions ELSE 0 END) AS player_damage,
                SUM(p.kills) AS team_kills,
                SUM(p.damage_to_champions) AS team_damage,
                COUNT(*) AS participant_count,
                MAX(CASE WHEN p.is_player = 1 THEN p.extended_metrics_json ELSE NULL END) AS player_extended_json,
                MAX(CASE WHEN p.is_player = 1 THEN p.grade_core_complete ELSE NULL END) AS player_grade_core_complete,
                MAX(CASE WHEN p.is_player = 1 THEN p.grade_core_source ELSE NULL END) AS player_grade_core_source,
                MAX(CASE WHEN p.is_player = 1 THEN p.grade_core_missing_fields_json ELSE NULL END) AS player_grade_core_missing_fields_json,
                MAX(CASE WHEN p.is_player = 1 THEN p.grade_core_contract_version ELSE NULL END) AS player_grade_core_contract_version,
                gs.total_participants,
                gs.team_count
         FROM match_participants p
         LEFT JOIN matches m
           ON m.game_id = p.game_id AND m.puuid = p.puuid
         JOIN game_stats gs
           ON gs.game_id = p.game_id
         WHERE ${conditions.join(" AND ")}
         GROUP BY p.game_id, p.team_id
         HAVING SUM(p.is_player) = 1`,
      )
      .all(...lobbyParams, ...lobbyParams) as {
      game_id: number
      player_kills: number
      player_assists: number
      player_damage: number
      team_kills: number
      team_damage: number
      participant_count: number
      player_extended_json: string | null
      player_grade_core_complete: number | null
      player_grade_core_source: string | null
      player_grade_core_missing_fields_json: string | null
      player_grade_core_contract_version: number | null
      total_participants: number
      team_count: number
    }[]

    const lobbyMap = new Map(lobbyRows.map((row) => [row.game_id, row]))

    return matchRows.map((m) => {
      const lobby = lobbyMap.get(m.game_id)
      const activeGrade = activeGrades.get(m.game_id)
      const sessionContext = sessionContexts.get(m.game_id)
      const completeLobby = !!lobby && lobby.total_participants >= 10 && lobby.team_count >= 2
      const durationMins = Math.max(1, m.duration_secs) / 60

      let gradeCoreMissingFields: unknown = null
      try {
        gradeCoreMissingFields = JSON.parse(lobby?.player_grade_core_missing_fields_json ?? "null")
      } catch {
        // Malformed metadata is unavailable evidence, never an observed zero.
      }
      const gradeCoreSource = lobby?.player_grade_core_source
      const coreFactsObserved = lobby?.player_grade_core_complete === 1 &&
        lobby.player_grade_core_contract_version === GRADE_CORE_FACT_CONTRACT_VERSION &&
        isGradeCoreSource(gradeCoreSource) && gradeCoreSource !== "legacy_unknown" &&
        Array.isArray(gradeCoreMissingFields) && gradeCoreMissingFields.length === 0

      let extendedMetrics: Record<string, number | boolean | string> = {}
      if (lobby?.player_extended_json) {
        try {
          extendedMetrics = JSON.parse(lobby.player_extended_json)
        } catch {
          // Defensive: leave empty if parse fails
        }
      }

      const healValue =
        typeof extendedMetrics.totalHealsOnTeammates === "number"
          ? extendedMetrics.totalHealsOnTeammates
          : undefined
      const shieldValue =
        typeof extendedMetrics.totalDamageShieldedOnTeammates === "number"
          ? extendedMetrics.totalDamageShieldedOnTeammates
          : undefined

      const allyHealShieldPerMinute =
        healValue !== undefined || shieldValue !== undefined
          ? ((healValue ?? 0) + (shieldValue ?? 0)) / durationMins
          : undefined

      const csPerMin = (m.total_minions_killed + m.neutral_minions) / durationMins

      return {
        gameId: m.game_id,
        playedAt: m.played_at,
        endedAt: m.duration_secs > 0
          ? m.played_at + m.duration_secs * 1_000
          : undefined,
        mode: m.mode,
        family: m.mode_family,
        queueId: m.queue_id,
        win: m.win === 1,
        grade: activeGrade?.grade,
        gradeScore: activeGrade?.gradeScore,
        recallScore: activeGrade?.recallScore,
        championId: m.champion_id,
        role: m.resolved_role ?? undefined,
        durationSecs: m.duration_secs,
        ...sessionContext,
        completeLobby,
        metrics: {
          kda: m.deaths === 0 ? m.kills + m.assists : (m.kills + m.assists) / m.deaths,
          deaths: m.deaths,
          damagePerMinute: m.damage_to_champions / durationMins,
          damageTakenPerMinute: m.damage_taken / durationMins,
          goldPerMinute: m.gold_earned / durationMins,
          csPerMinute: csPerMin,
          visionPerMinute: coreFactsObserved ? m.vision_score / durationMins : undefined,
          objectiveDamagePerMinute: coreFactsObserved
            ? m.damage_objectives / durationMins
            : undefined,
          ccPerMinute: coreFactsObserved ? m.time_ccing_others / durationMins : undefined,
          killParticipation:
            completeLobby && lobby.team_kills > 0
              ? (lobby.player_kills + lobby.player_assists) / lobby.team_kills
              : undefined,
          teamDamageShare:
            completeLobby && lobby.team_damage > 0 ? lobby.player_damage / lobby.team_damage : undefined,
          allyHealShieldPerMinute:
            completeLobby ? allyHealShieldPerMinute : undefined,
        },
        styleAxes: coreFactsObserved ? computePerGameAxes({
          kills: m.kills,
          assists: m.assists,
          damageToChampions: m.damage_to_champions,
          damageTaken: m.damage_taken,
          damageSelfMitigated: m.damage_self_mitigated,
          damageObjectives: m.damage_objectives,
          totalHeal: m.total_heal,
          csPerMin,
          visionPerMin: m.vision_score / durationMins,
          ccPerMin: m.time_ccing_others / durationMins,
        }, m.mode_family as ModeFamily) : {},
      }
    })
  }

  /** Authoritatively selected timelines with the identity context RVI needs. */
  getRviTimelineHistory(filter: StatsFilter, limit = 240): RviTimelineObservation[] {
    const { conditions, params } = lobbyScope(filter)
    const rows = this.db.prepare(
      `SELECT m.game_id AS gameId, m.played_at AS playedAt,
              m.duration_secs AS durationSecs, p.participant_id AS participantId,
              p.team_id AS teamId, t.data_json AS dataJson,
              (
                SELECT o.participant_id
                FROM match_participants o
                WHERE o.game_id = p.game_id AND o.puuid = p.puuid
                  AND o.team_id <> p.team_id
                  AND UPPER(COALESCE(o.role, o.lane, '')) =
                      UPPER(COALESCE(p.role, p.lane, ''))
                LIMIT 1
              ) AS opponentParticipantId
       FROM match_participants p
       JOIN matches m ON m.game_id = p.game_id AND m.puuid = p.puuid
       JOIN selected_match_timelines t ON t.game_id = p.game_id AND t.puuid = p.puuid
       WHERE ${conditions.join(" AND ")} AND p.is_player = 1
       ORDER BY m.played_at DESC, m.game_id DESC
       LIMIT ?`,
    ).all(...params, limit) as Array<{
      gameId: number
      playedAt: number
      durationSecs: number
      participantId: number
      teamId: number
      opponentParticipantId: number | null
      dataJson: string
    }>

    return rows.flatMap((row) => {
      try {
        return [{
          gameId: row.gameId,
          playedAt: row.playedAt,
          durationSecs: row.durationSecs,
          participantId: row.participantId,
          teamId: row.teamId,
          opponentParticipantId: row.opponentParticipantId ?? undefined,
          summary: JSON.parse(row.dataJson) as CompactTimeline,
        }]
      } catch {
        return []
      }
    }).reverse()
  }

  /**
   * match Grade rows eligible to feed RVI.
   *
   * This deliberately does not use the denormalized match grade cache or the
   * compatibility breakdown table. A row is eligible only when the selected
   * non-legacy recipe, its ready owner attempt, result, and immutable versioned
  * breakdown all agree on the exact recipe identity.
  */
  getRviObservations(filter: StatsFilter, limit?: number): RviObservationSet | undefined {
    const selected = getCompatibleGradeRecipeSelection(this.db)
    if (!selected) return undefined
    const metricRepository = new MetricObservationsRepository(this.db)
    const selectedRvi = getCompatibleRviRecipeSelection(this.db, selected)
    if (!selectedRvi) return undefined
    const publicRviRecipeId = selectedRvi.publicRecipeId

    const conditions = [
      "m.puuid = ?",
      "m.is_matched = 1",
      "p.is_player = 1",
      "a.owner_participant_id = p.participant_id",
      "a.algorithm_version = ?",
      "a.recipe_id = ?",
      "a.grade_status = 'ready'",
      "a.role_fit_score = r.role_fit_score",
      "r.algorithm_version = a.algorithm_version",
      "r.recipe_id = a.recipe_id",
      "r.grade_status = 'ready'",
      "r.role_fit_score IS NOT NULL",
      "b.algorithm_version = r.algorithm_version",
      "b.recipe_id = r.recipe_id",
      "b.role_fit_score IS NOT NULL",
      "b.role_fit_score = r.role_fit_score",
    ]
    const params: (string | number)[] = [
      filter.puuid,
      CANONICAL_GRADE_STORAGE_PARTITION,
      selected.recipeId,
    ]

    if (filter.mode) {
      conditions.push("m.mode = ?")
      params.push(filter.mode)
    } else if (filter.modes?.length) {
      conditions.push(`m.mode IN (${filter.modes.map(() => "?").join(", ")})`)
      params.push(...filter.modes)
    }
    if (filter.modeFamily) {
      conditions.push("m.mode_family = ?")
      params.push(filter.modeFamily)
    }
    if (filter.sinceMs !== undefined) {
      conditions.push("m.played_at >= ?")
      params.push(filter.sinceMs)
    }
    if (filter.untilMs !== undefined) {
      conditions.push("m.played_at <= ?")
      params.push(filter.untilMs)
    }
    if (filter.championIds?.length) {
      conditions.push(`p.champion_id IN (${filter.championIds.map(() => "?").join(", ")})`)
      params.push(...filter.championIds)
    }
    if (filter.roles?.length) {
      conditions.push(`${canonicalParticipantRole("p", "m")} IN (${filter.roles
        .map(() => "?").join(", ")})`)
      params.push(...filter.roles.map((role) => role.toUpperCase()))
    }
    const rowLimit = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit!)) : undefined
    const limitSql = rowLimit === undefined ? "" : " LIMIT ?"
    const queryParams = rowLimit === undefined ? params : [...params, rowLimit]

    const rows = this.db.prepare(
      `SELECT m.game_id AS gameId, m.played_at AS playedAt,
              p.participant_id AS participantId,
              p.champion_id AS championId,
              ${canonicalParticipantRole("p", "m")} AS resolvedPosition,
              r.role_fit_score AS recallScore,
              b.components_json AS breakdownJson
       FROM matches m
       JOIN match_participants p
         ON p.game_id = m.game_id AND p.puuid = m.puuid
       JOIN match_grade_attempts a
         ON a.game_id = p.game_id AND a.puuid = p.puuid
       JOIN match_grade_results r
         ON r.game_id = p.game_id
        AND r.puuid = p.puuid
        AND r.participant_id = p.participant_id
       JOIN match_grade_breakdown_versions b
         ON b.game_id = r.game_id
        AND b.puuid = r.puuid
        AND b.participant_id = r.participant_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY m.played_at DESC, m.game_id DESC${limitSql}`,
    ).all(...queryParams) as Array<{
      gameId: number
      playedAt: number
      participantId: number
      championId: number | null
      resolvedPosition: string | null
      recallScore: number
      breakdownJson: string
    }>

    const storedMetricsByMatch = new Map<string, OwnerMetricObservation[]>()
    if (selectedRvi) {
      for (const metric of metricRepository.getOwnerHistory(
        filter.puuid,
        CANONICAL_RVI_STORAGE_PARTITION,
        selectedRvi.recipeId,
      )) {
        const key = `${metric.gameId}:${metric.participantId}`
        const group = storedMetricsByMatch.get(key) ?? []
        group.push(metric)
        storedMetricsByMatch.set(key, group)
      }
    }

    const observations = rows.flatMap((row): RviMatchObservation[] => {
      if (!finiteInRange(row.recallScore, 0, 100) ||
          !Number.isFinite(row.playedAt) ||
          (row.championId !== null && (!Number.isSafeInteger(row.championId) || row.championId <= 0))) {
        return []
      }
      const breakdown = parseGradeBreakdown(
        row.breakdownJson,
        selected.recipeId,
        row.recallScore,
        gradeRecipeDefinitionId(selected.identity),
      )
      if (!breakdown) return []
      const metrics = rviMetricsForMatch(
        breakdown,
        storedMetricsByMatch.get(`${row.gameId}:${row.participantId}`) ?? [],
      )
      const vectorMaps = rviVectorMapsForMatch(breakdown)
      return [{
        matchId: row.gameId,
        recipeId: publicRviRecipeId,
        playedAt: row.playedAt,
        recallScore: row.recallScore,
        ...vectorMaps,
        metrics,
        championId: row.championId,
        position: row.resolvedPosition,
        primaryArchetype: breakdown.primaryArchetype,
      }]
    }).reverse()

    return {
      algorithmVersion: CANONICAL_RVI_STORAGE_PARTITION,
      recipeId: publicRviRecipeId,
      calibrationId: selected.publicCalibrationId,
      familyKeys: [...RVI_VECTOR_KEYS],
      observations,
    }
  }

  /** Chart-ready grade families for the exact selected match Grade recipe. */
  getGradeComponentHistory(filter: StatsFilter, limit = 60): GradeComponentObservation[] {
    const selected = getCompatibleGradeRecipeSelection(this.db)
    return selected
      ? this.getGradeComponentHistoryForRecipe(filter, limit, selected)
      : []
  }

  private getGradeComponentHistoryForRecipe(
    filter: StatsFilter,
    limit: number,
    selected: CompatibleGradeRecipeSelection,
  ): GradeComponentObservation[] {
    const recipeId = selected.recipeId
    const sessionContexts = accountSessionContexts(this.db, filter.puuid)
    const conditions = [
      "m.puuid = ?",
      "m.is_matched = 1",
      "p.is_player = 1",
      "a.owner_participant_id = p.participant_id",
      "a.algorithm_version = ?",
      "a.recipe_id = ?",
      "a.grade_status = 'ready'",
      "a.role_fit_score = r.role_fit_score",
      "r.algorithm_version = a.algorithm_version",
      "r.recipe_id = a.recipe_id",
      "r.grade_status = 'ready'",
      "r.role_fit_score IS NOT NULL",
      "b.algorithm_version = r.algorithm_version",
      "b.recipe_id = r.recipe_id",
      "b.role_fit_score = r.role_fit_score",
    ]
    const params: (string | number)[] = [
      filter.puuid,
      CANONICAL_GRADE_STORAGE_PARTITION,
      recipeId,
    ]

    if (filter.mode) {
      conditions.push("m.mode = ?")
      params.push(filter.mode)
    } else if (filter.modes?.length) {
      conditions.push(`m.mode IN (${filter.modes.map(() => "?").join(", ")})`)
      params.push(...filter.modes)
    }
    if (filter.modeFamily) {
      conditions.push("m.mode_family = ?")
      params.push(filter.modeFamily)
    }
    if (filter.sinceMs !== undefined) {
      conditions.push("m.played_at >= ?")
      params.push(filter.sinceMs)
    }
    if (filter.untilMs !== undefined) {
      conditions.push("m.played_at <= ?")
      params.push(filter.untilMs)
    }
    if (filter.championIds?.length) {
      conditions.push(`p.champion_id IN (${filter.championIds.map(() => "?").join(", ")})`)
      params.push(...filter.championIds)
    }
    if (filter.roles?.length) {
      conditions.push(`${canonicalParticipantRole("p", "m")} IN (${filter.roles
        .map(() => "?").join(", ")})`)
      params.push(...filter.roles.map((role) => role.toUpperCase()))
    }

    const rowLimit = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 60
    const rows = this.db.prepare(
      `SELECT m.game_id AS gameId, m.played_at AS playedAt,
              m.win, p.champion_id AS championId,
              ${canonicalParticipantRole("p", "m")} AS role,
              r.grade, r.grade_score AS gradeScore,
              r.role_fit_score AS recallScore,
              b.components_json AS breakdownJson
       FROM matches m
       JOIN match_participants p
         ON p.game_id = m.game_id AND p.puuid = m.puuid
       JOIN match_grade_attempts a
         ON a.game_id = p.game_id AND a.puuid = p.puuid
       JOIN match_grade_results r
         ON r.game_id = p.game_id
        AND r.puuid = p.puuid
        AND r.participant_id = p.participant_id
       JOIN match_grade_breakdown_versions b
         ON b.game_id = r.game_id
        AND b.puuid = r.puuid
        AND b.participant_id = r.participant_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY m.played_at DESC, m.game_id DESC
       LIMIT ?`,
    ).all(...params, rowLimit) as Array<{
      gameId: number
      playedAt: number
      win: number
      championId: number
      role: string | null
      grade: string
      gradeScore: number
      recallScore: number
      breakdownJson: string
    }>

    return rows.flatMap((row): GradeComponentObservation[] => {
      if (!finiteInRange(row.recallScore, 0, 100) || !Number.isFinite(row.gradeScore)) return []
      const breakdown = parseGradeBreakdown(
        row.breakdownJson,
        recipeId,
        row.recallScore,
        gradeRecipeDefinitionId(selected.identity),
      )
      if (!breakdown) return []
      return [{
        gameId: row.gameId,
        playedAt: row.playedAt,
        win: row.win === 1,
        championId: row.championId,
        role: row.role ?? undefined,
        grade: row.grade,
        recallScore: row.recallScore,
        ...sessionContexts.get(row.gameId),
        compositePercentile: row.recallScore / 100,
        components: breakdown.components,
      }]
    }).reverse()
  }

  /**
   * Final item sets from scoped matches.
   *
   * Returns slots 0-5 only, omitting slot 6 (trinket), with zero IDs and
   * duplicates removed.
   */
  getFinalItemObservations(filter: StatsFilter): FinalItemObservation[] {
    const { conditions, params } = lobbyScope(filter)
    const all = [...conditions, "p.is_player = 1"].join(" AND ")
    const activeGrades = selectedGradeResults(
      this.db,
      filter,
      getCompatibleGradeRecipeSelection(this.db),
    )

    const rows = this.db
      .prepare(
        `SELECT m.game_id, m.champion_id,
                ${normalizedRole("m")} AS role, m.grade_score,
                p.item0, p.item1, p.item2, p.item3, p.item4, p.item5
         FROM match_participants p
         LEFT JOIN matches m
           ON m.game_id = p.game_id AND m.puuid = p.puuid
         WHERE ${all}
         ORDER BY m.played_at ASC, m.game_id ASC`,
      )
      .all(...params) as {
      game_id: number
      champion_id: number
      role: string | null
      grade_score: number | null
      item0: number
      item1: number
      item2: number
      item3: number
      item4: number
      item5: number
    }[]

    return rows.map((row) => {
      const activeGrade = activeGrades.get(row.game_id)
      const slots = [row.item0, row.item1, row.item2, row.item3, row.item4, row.item5]
      const itemIds = [...new Set(slots.filter((id) => id > 0))]

      return {
        gameId: row.game_id,
        championId: row.champion_id,
        role: row.role ?? undefined,
        recallScore: activeGrade?.recallScore,
        itemIds,
      }
    })
  }
}
