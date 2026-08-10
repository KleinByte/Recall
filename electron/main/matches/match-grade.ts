import type { Evidence, EvidenceState } from "../../../src/shared/measurement.js"
import { observed } from "../../../src/shared/measurement.js"
import type { RecallGrade } from "../../../src/shared/recall-grade.js"
import type { NormalizedPosition } from "./position.js"
import {
  MATCH_GRADE_ARM_KEYS,
  MATCH_GRADE_ARM_LABELS,
  MATCH_GRADE_DIAGNOSTIC_METRIC_KEYS,
  MATCH_GRADE_EVIDENCE_POLICY_VERSION,
  MATCH_GRADE_ALGORITHM_VERSION,
  MATCH_GRADE_RECIPE,
  MATCH_GRADE_RECIPE_DEFINITION_ID,
  MATCH_GRADE_RECIPE_ID,
  gradeForRecallScore,
  recipeIdForCalibration,
  type MatchGradeArmKey,
  type MatchGradeMetricKey,
  type ResponsibilityTier,
} from "./match-grade-recipe.js"
import {
  PRIMARY_ARCHETYPES,
  isSupportedModeContext,
  resolvePrimaryArchetypeWithSource,
  responsibilityTiersFor,
  type ArchetypeResolutionSource,
  type MatchGradeModeContext,
  type PrimaryArchetype,
} from "./match-grade-taxonomy.js"
import { clampCalibrationPercentile, normalQuantile } from "./match-grade-calibration.js"
import {
  RVI_METRIC_POLICIES,
  metricDefinition,
  type MetricKey,
} from "./match-metric-registry.js"

export {
  MATCH_GRADE_ALGORITHM_VERSION,
  MATCH_GRADE_RECIPE,
  MATCH_GRADE_RECIPE_DEFINITION_ID,
  MATCH_GRADE_RECIPE_ID,
  recipeIdForCalibration,
}

export type MatchGradeStatus =
  | "ready"
  | "incomplete_lobby"
  | "missing_core_metric"
  | "unsupported_mode"
  | "short_game"
  | "invalid_duration"
  | "terminated"
  | "ineligible_for_progression"
  | "unmatched"
  | "bot_or_tutorial"
  | "missing_source_fact"
  | "legacy_unknown"
  | "calibrating"
  | "position_unresolved"

export interface MatchGradeParticipantInput {
  participantId: number
  teamId: number
  isPlayer: boolean
  championId?: number
  position: NormalizedPosition
  primaryArchetype?: PrimaryArchetype
  /**
   * Calibrated, higher-is-better percentiles. Raw signals become these through
   * match-grade-calibration; zero is a valid observed percentile.
   */
  metricEvidence: Partial<Record<MatchGradeMetricKey, Evidence<number>>>
  /** Calibrated optional arm detail. Missing detail never blocks core grading. */
  detailMetricEvidence?: Readonly<Record<string, Evidence<number>>>
  detailMetricProvenance?: Readonly<Record<string, {
    state: EvidenceState
    reason?: string
  }>>
  /** Original evidence state before calibration (notably no-opportunity). */
  metricProvenance?: Partial<Record<MatchGradeMetricKey, {
    state: EvidenceState
    reason?: string
  }>>
  /** Final composite percentile from the frozen-reference calibrator. */
  responsibilityEvidence?: Evidence<number>
  /** Optional audit facts supplied by the calibrator. */
  peerCount?: number
  comparisonScope?: "role" | "lobby"
}

export interface MatchGradeLobbyInput {
  players: readonly MatchGradeParticipantInput[]
  context: MatchGradeModeContext
  /** Immutable calibration snapshot id or content hash. */
  calibrationSnapshotId: string
}

export interface GradeComponent {
  key: MatchGradeArmKey
  label: string
  componentScore: number
  rankPercentile: number
  magnitudeScore: number
  peerCount: number
  comparisonScope: "role" | "lobby"
  metricBasis: "individual" | "team_share"
  responsibilityTier: ResponsibilityTier
  weight: number
  contribution: number
  evidenceState: EvidenceState
  signals: {
    key: MetricKey
    percentile: number
    weight: number
    evidenceState: "observed"
    sourceEvidenceState: EvidenceState
    sourceEvidenceReason?: string
    calibrationReason?: string
  }[]
}

export interface GradeDiagnosticMetric {
  key: MatchGradeMetricKey
  evidenceState: EvidenceState | "missing"
  percentile?: number
  sourceEvidenceState: EvidenceState | "missing"
  sourceEvidenceReason?: string
  calibrationReason?: string
}

export interface OmittedGradeComponent {
  key: string
  reason: string
  evidenceState?: EvidenceState | "missing"
}

export interface GradeResult {
  grade: RecallGrade
  /** Monotonic normal-score compatibility transform; never used for the letter. */
  gradeScore: number
  /** Frozen-reference responsibility score; never derived from current-lobby placement. */
  recallScore: number
  /** Current-match placement; never used to derive the letter. */
  lobbyPercentile: number
  /** Compatibility alias for old repositories. */
  compositePercentile: number
  breakdown: {
    algorithmVersion: 3
    recipeDefinitionId: string
    recipeId: string
    calibrationSnapshotId: string
    taxonomyVersion: string
    positionResolverVersion: number
    gradeCoreFactContractVersion: number
    evidencePolicyVersion: typeof MATCH_GRADE_EVIDENCE_POLICY_VERSION
    calibrationClusterPolicy: string
    context: MatchGradeModeContext
    position: NormalizedPosition
    primaryArchetype: PrimaryArchetype
    archetypeSource: ArchetypeResolutionSource
    responsibilityTiers: Readonly<Record<MatchGradeArmKey, ResponsibilityTier>>
    /** Arithmetic responsibility composite before the second ECDF stage. */
    rawResponsibilityScore: number
    /** Declared responsibility held neutral because an optional-only arm was unavailable. */
    neutralizedResponsibilityWeight: number
    /** Arithmetic contribution of that unavailable responsibility mass. */
    neutralizedResponsibilityContribution: number
    recallScoreCalibrationSource: string
    recallScore: number
    gradeScore: number
    lobbyPercentile: number
    compositePercentile: number
    components: GradeComponent[]
    diagnosticMetrics: GradeDiagnosticMetric[]
    omittedComponents: OmittedGradeComponent[]
  }
}

export interface MatchGradeOutcome {
  status: MatchGradeStatus
  algorithmVersion: 3
  recipeDefinitionId: string
  recipeId?: string
  results: Map<number, GradeResult>
  reason?: string
}

const EMPTY_OUTCOME_BASE = {
  algorithmVersion: MATCH_GRADE_ALGORITHM_VERSION,
  recipeDefinitionId: MATCH_GRADE_RECIPE_DEFINITION_ID,
} as const

const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length
const stableScore = (value: number) => Math.round(value * 1e12) / 1e12

/** Fair midpoint rank retained for current-lobby placement compatibility. */
export function rankPercentile(values: readonly number[], value: number): number {
  if (values.length < 2) return .5
  const better = values.filter((entry) => entry > value).length
  const tied = values.filter((entry) => entry === value).length
  return (values.length - 1 - better - (tied - 1) / 2) / (values.length - 1)
}

/** Compatibility formula only; the v3 recipe itself uses calibrated ECDFs. */
export function magnitudeScore(
  values: readonly number[],
  value: number,
  direction: "normal" | "inverse" = "normal",
): number {
  const average = mean(values)
  if (average <= 0) return .5
  return direction === "normal"
    ? Math.max(0, Math.min(1, value / (2 * average)))
    : Math.max(0, Math.min(1, 1 - value / (2 * average)))
}

/** Compatibility formula only; not used by scoreMatchLobby. */
export function componentScore(
  values: readonly number[],
  value: number,
  direction: "normal" | "inverse" = "normal",
) {
  const rankedValues = direction === "inverse" ? values.map((entry) => -entry) : values
  const rankedValue = direction === "inverse" ? -value : value
  const rank = rankPercentile(rankedValues, rankedValue)
  const magnitude = magnitudeScore(values, value, direction)
  const reliability = (values.length - 1) / (values.length + 1)
  const adjustedRank = .5 + (rank - .5) * reliability
  return {
    componentScore: .75 * adjustedRank + .25 * magnitude,
    rankPercentile: rank,
    magnitudeScore: magnitude,
    peerCount: values.length,
  }
}

const emptyOutcome = (status: Exclude<MatchGradeStatus, "ready">, reason?: string): MatchGradeOutcome => ({
  ...EMPTY_OUTCOME_BASE,
  status,
  results: new Map(),
  ...(reason ? { reason } : {}),
})

function lobbyShape(players: readonly { participantId: number; teamId: number; isPlayer: boolean }[]) {
  if (players.length !== 10 || new Set(players.map((player) => player.participantId)).size !== 10) {
    return false
  }
  if (!players.every((player) =>
    Number.isSafeInteger(player.participantId) && player.participantId > 0 &&
    Number.isSafeInteger(player.teamId) && player.teamId > 0)) return false
  const teams = new Map<number, number>()
  for (const player of players) teams.set(player.teamId, (teams.get(player.teamId) ?? 0) + 1)
  return teams.size === 2 && [...teams.values()].every((count) => count === 5) &&
    players.filter((player) => player.isPlayer).length === 1
}

const knownArchetypes = new Set<string>(PRIMARY_ARCHETYPES)

interface FamilyResolution {
  score?: number
  signals: GradeComponent["signals"]
  reason?: string
  evidenceState?: EvidenceState | "missing"
}

function resolveFamily(
  player: MatchGradeParticipantInput,
  family: MatchGradeArmKey,
  context: MatchGradeModeContext,
  archetype: PrimaryArchetype,
): FamilyResolution {
  const policies = RVI_METRIC_POLICIES.filter((policy) =>
    policy.vector === family && policy.tier !== "DIAGNOSTIC" &&
    metricDefinition(policy.metricKey)?.applicable({
      context,
      position: player.position,
      archetype,
    }))
  const observedPolicies: Array<{
    policy: typeof policies[number]
    evidence: Extract<Evidence<number>, { state: "observed" }>
    provenance?: { state: EvidenceState; reason?: string }
  }> = []
  for (const policy of policies) {
    const evidence = (player.metricEvidence as Readonly<Record<string, Evidence<number>>>)[
      policy.metricKey
    ] ?? player.detailMetricEvidence?.[policy.metricKey]
    const provenance = (player.metricProvenance as Readonly<Record<string, {
      state: EvidenceState
      reason?: string
    }>>)?.[policy.metricKey] ?? player.detailMetricProvenance?.[policy.metricKey]
    if (!evidence || evidence.state !== "observed") {
      // Core scoreboard evidence remains mandatory. Restored detail is
      // opportunity-aware and scores when present without invalidating an
      // otherwise complete match.
      if (policy.tier === "CORE") {
        return {
          signals: [],
          reason: `${policy.metricKey}:${evidence?.reason ?? evidence?.state ?? "missing"}`,
          evidenceState: evidence?.state ?? "missing",
        }
      }
      continue
    }
    if (!Number.isFinite(evidence.value) || evidence.value < 0 || evidence.value > 1) {
      return {
        signals: [],
        reason: `${policy.metricKey}:percentile_out_of_range`,
        evidenceState: "invalid",
      }
    }
    observedPolicies.push({ policy, evidence, provenance })
  }

  const declaredDenominator = policies.reduce(
    (sum, policy) => sum + policy.vectorWeight,
    0,
  )
  if (declaredDenominator <= 0 || observedPolicies.length === 0) {
    return { signals: [], reason: "no_observed_arm_metrics", evidenceState: "not_applicable" }
  }

  const coreBundle = observedPolicies.filter((entry) => entry.policy.tier === "CORE")
  // Initiative has no scoreboard CORE metric. Once any of its SECONDARY
  // evidence is observed, that observed bundle becomes the neutral basis for
  // the remaining optional measurements. With none observed, the arm remains
  // unavailable and is neutralized only at the responsibility-composite layer.
  const neutralBundle = coreBundle.length > 0 ? coreBundle : observedPolicies
  const neutralBundleWeight = neutralBundle.reduce(
    (sum, entry) => sum + entry.policy.vectorWeight,
    0,
  )
  if (neutralBundleWeight <= 0) {
    return { signals: [], reason: "no_observed_arm_metrics", evidenceState: "not_applicable" }
  }
  const neutralBundleScore = neutralBundle.reduce(
    (sum, entry) => sum + entry.evidence.value * entry.policy.vectorWeight,
    0,
  ) / neutralBundleWeight
  const missingSecondaryWeight = policies.reduce((sum, policy) => {
    if (policy.tier !== "SECONDARY" ||
        observedPolicies.some((entry) => entry.policy.metricKey === policy.metricKey)) return sum
    return sum + policy.vectorWeight
  }, 0)

  // Missing/no-opportunity SECONDARY evidence is not promoted to observed.
  // For arithmetic only, its declared mass inherits the observed CORE bundle
  // (or the observed Initiative bundle). This keeps the arm on one immutable
  // denominator while ensuring absence cannot raise or lower a core-only score.
  const signals: GradeComponent["signals"] = observedPolicies.map((entry) => ({
      key: entry.policy.metricKey,
      percentile: entry.evidence.value,
      weight: stableScore(entry.policy.vectorWeight / declaredDenominator +
        (neutralBundle.includes(entry)
          ? missingSecondaryWeight / declaredDenominator *
            entry.policy.vectorWeight / neutralBundleWeight
          : 0)),
      evidenceState: "observed",
      sourceEvidenceState: entry.provenance?.state ?? entry.evidence.state,
      ...(entry.provenance?.reason
        ? { sourceEvidenceReason: entry.provenance.reason }
        : {}),
      ...(entry.evidence.reason ? { calibrationReason: entry.evidence.reason } : {}),
    }))
  const observedNumerator = observedPolicies.reduce(
    (sum, entry) => sum + entry.evidence.value * entry.policy.vectorWeight,
    0,
  )
  return {
    score: stableScore(
      (observedNumerator + missingSecondaryWeight * neutralBundleScore) /
        declaredDenominator,
    ),
    signals,
  }
}

interface ResolvedPlayer {
  player: MatchGradeParticipantInput
  archetype: PrimaryArchetype
  archetypeSource: ArchetypeResolutionSource
  tiers: Readonly<Record<MatchGradeArmKey, ResponsibilityTier>>
  components: GradeComponent[]
  omitted: OmittedGradeComponent[]
  composite: number
  neutralizedResponsibilityWeight: number
  neutralizedResponsibilityContribution: number
}

type ResponsibilityResolution =
  | { status: "ready"; resolved: ResolvedPlayer[] }
  | { status: Exclude<MatchGradeStatus, "ready">; reason?: string }

function resolveResponsibilityLobby(
  input: Pick<MatchGradeLobbyInput, "players" | "context">,
): ResponsibilityResolution {
  if (!isSupportedModeContext(input.context)) return { status: "unsupported_mode" }
  if (!lobbyShape(input.players)) return { status: "incomplete_lobby" }
  const players = [...input.players].sort((a, b) => a.participantId - b.participantId)
  const resolved: ResolvedPlayer[] = []
  for (const player of players) {
    if (input.context.ruleset !== "howling_abyss" && player.position === "UNKNOWN") {
      return {
        status: "missing_core_metric",
        reason: `participant:${player.participantId}:position:unknown`,
      }
    }
    if (player.primaryArchetype && !knownArchetypes.has(player.primaryArchetype)) {
      return {
        status: "missing_core_metric",
        reason: `participant:${player.participantId}:archetype:invalid`,
      }
    }
    const archetypeResolution = resolvePrimaryArchetypeWithSource(
      player.championId,
      player.primaryArchetype,
    )
    const tiers = responsibilityTiersFor(
      input.context,
      player.position,
      archetypeResolution.archetype,
      player.championId,
    )
    const resolvedFamilies: Array<{
      family: MatchGradeArmKey
      tier: ResponsibilityTier
      result: FamilyResolution & { score: number }
    }> = []
    const omitted: OmittedGradeComponent[] = []
    for (const family of MATCH_GRADE_ARM_KEYS) {
      const familyResult = resolveFamily(
        player,
        family,
        input.context,
        archetypeResolution.archetype,
      )
      const tier = tiers[family]
      if (familyResult.score === undefined) {
        const hasApplicableCore = RVI_METRIC_POLICIES.some((policy) =>
          policy.vector === family && policy.tier === "CORE" &&
          metricDefinition(policy.metricKey)?.applicable({
            context: input.context,
            position: player.position,
            archetype: archetypeResolution.archetype,
          }))
        if (tier > 0 && hasApplicableCore) {
          return {
            status: "missing_core_metric",
            reason: `participant:${player.participantId}:${family}:${familyResult.reason}`,
          }
        }
        omitted.push({
          key: family,
          reason: familyResult.reason ?? "diagnostic_unavailable",
          evidenceState: familyResult.evidenceState,
        })
        continue
      }
      resolvedFamilies.push({
        family,
        tier,
        result: familyResult as FamilyResolution & { score: number },
      })
    }
    const declaredDenominator = MATCH_GRADE_ARM_KEYS.reduce(
      (sum, family) => sum + tiers[family],
      0,
    )
    const resolvedDenominator = resolvedFamilies.reduce(
      (sum, entry) => sum + entry.tier,
      0,
    )
    if (declaredDenominator <= 0 || resolvedDenominator <= 0) {
      return {
        status: "missing_core_metric",
        reason: `participant:${player.participantId}:no_observed_responsibilities`,
      }
    }
    const components: GradeComponent[] = resolvedFamilies.map(({ family, tier, result }) => {
      const weight = stableScore(tier / declaredDenominator)
      return {
        key: family,
        label: MATCH_GRADE_ARM_LABELS[family],
        componentScore: result.score,
        rankPercentile: result.score,
        magnitudeScore: result.score,
        peerCount: player.peerCount ?? players.length,
        comparisonScope: player.comparisonScope ?? "role",
        metricBasis: family === "combat" ? "team_share" : "individual",
        responsibilityTier: tier,
        weight,
        contribution: result.score * weight,
        evidenceState: "observed",
        signals: result.signals,
      }
    })
    const resolvedNumerator = resolvedFamilies.reduce(
      (sum, entry) => sum + entry.result.score * entry.tier,
      0,
    )
    const resolvedBaseline = resolvedNumerator / resolvedDenominator
    const neutralResponsibilityTier = declaredDenominator - resolvedDenominator
    const neutralizedResponsibilityWeight = stableScore(
      neutralResponsibilityTier / declaredDenominator,
    )
    const neutralizedResponsibilityContribution = stableScore(
      neutralizedResponsibilityWeight * resolvedBaseline,
    )
    // Different responsibility denominators can otherwise turn mathematically
    // equal scores into false lobby ranks through floating-point dust.
    const composite = stableScore(
      (resolvedNumerator + neutralResponsibilityTier * resolvedBaseline) /
        declaredDenominator,
    )
    resolved.push({
      player,
      archetype: archetypeResolution.archetype,
      archetypeSource: archetypeResolution.source,
      tiers,
      components,
      omitted,
      composite,
      neutralizedResponsibilityWeight,
      neutralizedResponsibilityContribution,
    })
  }
  return { status: "ready", resolved }
}

export interface RawResponsibilityResult {
  participantId: number
  position: NormalizedPosition
  primaryArchetype: PrimaryArchetype
  /** Fixed-denominator arithmetic mean of metric/family percentiles. */
  rawResponsibilityComposite: number
}

export interface RawResponsibilityLobbyOutcome {
  status: MatchGradeStatus
  results: Map<number, RawResponsibilityResult>
  reason?: string
}

/**
 * Resolves the first-stage responsibility composite without assigning a grade.
 * Snapshot construction uses this boundary before the final composite ECDF.
 */
export function rawResponsibilityScores(
  input: Pick<MatchGradeLobbyInput, "players" | "context">,
): RawResponsibilityLobbyOutcome {
  const outcome = resolveResponsibilityLobby(input)
  if (outcome.status !== "ready") {
    return {
      status: outcome.status,
      results: new Map(),
      ...(outcome.reason ? { reason: outcome.reason } : {}),
    }
  }
  return {
    status: "ready",
    results: new Map(outcome.resolved.map((entry) => [
      entry.player.participantId,
      {
        participantId: entry.player.participantId,
        position: entry.player.position,
        primaryArchetype: entry.archetype,
        rawResponsibilityComposite: entry.composite,
      },
    ])),
  }
}

function diagnosticMetricsFor(player: MatchGradeParticipantInput): GradeDiagnosticMetric[] {
  return MATCH_GRADE_DIAGNOSTIC_METRIC_KEYS.map((key) => {
    const evidence = player.metricEvidence[key]
    const provenance = player.metricProvenance?.[key]
    if (!evidence) {
      return {
        key,
        evidenceState: "missing" as const,
        sourceEvidenceState: provenance?.state ?? "missing" as const,
        ...(provenance?.reason ? { sourceEvidenceReason: provenance.reason } : {}),
      }
    }
    return {
      key,
      evidenceState: evidence.state,
      ...(evidence.state === "observed" ? { percentile: evidence.value } : {}),
      sourceEvidenceState: provenance?.state ?? evidence.state,
      ...(provenance?.reason ? { sourceEvidenceReason: provenance.reason } : {}),
      ...(evidence.reason ? { calibrationReason: evidence.reason } : {}),
    }
  })
}

/** Pure match Grade scorer. No database, clock, random, or mutable global inputs. */
export function scoreMatchLobby(input: MatchGradeLobbyInput): MatchGradeOutcome {
  const responsibility = resolveResponsibilityLobby(input)
  if (responsibility.status !== "ready") {
    return emptyOutcome(responsibility.status, responsibility.reason)
  }
  let recipeId: string
  try {
    recipeId = recipeIdForCalibration(input.calibrationSnapshotId)
  } catch {
    return emptyOutcome("missing_source_fact", "invalid_calibration_snapshot_id")
  }

  for (const entry of responsibility.resolved) {
    const evidence = entry.player.responsibilityEvidence
    if (!evidence || evidence.state !== "observed") {
      return emptyOutcome(
        "missing_core_metric",
        `participant:${entry.player.participantId}:role_fit:${evidence?.reason ?? evidence?.state ?? "missing"}`,
      )
    }
    if (!Number.isFinite(evidence.value) || evidence.value < 0 || evidence.value > 1) {
      return emptyOutcome(
        "missing_core_metric",
        `participant:${entry.player.participantId}:role_fit:percentile_out_of_range`,
      )
    }
  }

  const composites = responsibility.resolved.map((entry) => entry.composite)
  const results = new Map<number, GradeResult>()
  for (const entry of responsibility.resolved) {
    const recallScorePercentile = (entry.player.responsibilityEvidence as {
      state: "observed"
      value: number
    }).value
    const rawResponsibilityScore = entry.composite * 100
    const recallScore = recallScorePercentile * 100
    const gradeScore = normalQuantile(recallScorePercentile)
    const lobbyPercentile = rankPercentile(composites, entry.composite)
    results.set(entry.player.participantId, {
      grade: gradeForRecallScore(recallScore),
      gradeScore,
      recallScore,
      lobbyPercentile,
      compositePercentile: lobbyPercentile,
      breakdown: {
        algorithmVersion: MATCH_GRADE_ALGORITHM_VERSION,
        recipeDefinitionId: MATCH_GRADE_RECIPE_DEFINITION_ID,
        recipeId,
        calibrationSnapshotId: input.calibrationSnapshotId,
        taxonomyVersion: MATCH_GRADE_RECIPE.taxonomyVersion,
        positionResolverVersion: MATCH_GRADE_RECIPE.sourceContracts.positionResolverVersion,
        gradeCoreFactContractVersion:
          MATCH_GRADE_RECIPE.sourceContracts.gradeCoreFactContractVersion,
        evidencePolicyVersion: MATCH_GRADE_RECIPE.sourceContracts.evidencePolicyVersion,
        calibrationClusterPolicy: MATCH_GRADE_RECIPE.calibration.clusterIdentity,
        context: { ...input.context },
        position: entry.player.position,
        primaryArchetype: entry.archetype,
        archetypeSource: entry.archetypeSource,
        responsibilityTiers: entry.tiers,
        rawResponsibilityScore,
        neutralizedResponsibilityWeight: entry.neutralizedResponsibilityWeight,
        neutralizedResponsibilityContribution: entry.neutralizedResponsibilityContribution,
        recallScoreCalibrationSource:
          entry.player.responsibilityEvidence?.reason ?? "frozen_composite_ecdf",
        recallScore,
        gradeScore,
        lobbyPercentile,
        compositePercentile: lobbyPercentile,
        components: entry.components,
        diagnosticMetrics: diagnosticMetricsFor(entry.player),
        omittedComponents: entry.omitted,
      },
    })
  }
  return {
    ...EMPTY_OUTCOME_BASE,
    status: "ready",
    recipeId,
    results,
  }
}

