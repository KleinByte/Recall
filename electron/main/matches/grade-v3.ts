import type { Evidence, EvidenceState } from "../../../src/shared/measurement.js"
import { noOpportunity, observed, unavailable } from "../../../src/shared/measurement.js"
import type { ModeFamily } from "./types.js"
import type { Grade, GradeInput } from "./grade.js"
import type { NormalizedPosition } from "./position.js"
import { normalizePosition } from "./position.js"
import {
  GRADE_FAMILIES,
  GRADE_V3_DIAGNOSTIC_METRICS,
  GRADE_V3_EVIDENCE_POLICY_VERSION,
  GRADE_V3_ALGORITHM_VERSION,
  GRADE_V3_RECIPE,
  GRADE_V3_RECIPE_DEFINITION_ID,
  GRADE_V3_RECIPE_ID,
  gradeForRoleFitScore,
  recipeIdForCalibration,
  type GradeFamilyV3,
  type GradeMetricV3,
  type ResponsibilityTier,
} from "./grade-v3-recipe.js"
import {
  PRIMARY_ARCHETYPES,
  defaultGradeModeContext,
  isSupportedModeContext,
  primaryArchetypeForClass,
  resolvePrimaryArchetypeWithSource,
  responsibilityTiersFor,
  type ArchetypeResolutionSource,
  type GradeModeContextV3,
  type PrimaryArchetype,
} from "./grade-v3-taxonomy.js"
import { clampCalibrationPercentile, normalQuantile } from "./grade-v3-calibration.js"

export {
  GRADE_V3_ALGORITHM_VERSION,
  GRADE_V3_RECIPE,
  GRADE_V3_RECIPE_DEFINITION_ID,
  GRADE_V3_RECIPE_ID,
  recipeIdForCalibration,
}

export type GradeV3Status =
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

export interface GradePlayerV3Input {
  participantId: number
  teamId: number
  isPlayer: boolean
  championId?: number
  position: NormalizedPosition
  primaryArchetype?: PrimaryArchetype
  /**
   * Calibrated, higher-is-better percentiles. Raw signals become these through
   * grade-v3-calibration; zero is a valid observed percentile.
   */
  metricEvidence: Partial<Record<GradeMetricV3, Evidence<number>>>
  /** Original evidence state before calibration (notably no-opportunity). */
  metricProvenance?: Partial<Record<GradeMetricV3, {
    state: EvidenceState
    reason?: string
  }>>
  /** Final composite percentile from the frozen-reference calibrator. */
  responsibilityEvidence?: Evidence<number>
  /** Optional audit facts supplied by the calibrator. */
  peerCount?: number
  comparisonScope?: "role" | "lobby"
}

export interface GradeLobbyV3Input {
  players: readonly GradePlayerV3Input[]
  context: GradeModeContextV3
  /** Immutable calibration snapshot id or content hash. */
  calibrationSnapshotId: string
}

export interface GradeComponentV3 {
  key: GradeFamilyV3
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
    key: GradeMetricV3
    percentile: number
    weight: number
    evidenceState: "observed"
    sourceEvidenceState: EvidenceState
    sourceEvidenceReason?: string
    calibrationReason?: string
  }[]
}

export interface GradeDiagnosticMetricV3 {
  key: GradeMetricV3
  evidenceState: EvidenceState | "missing"
  percentile?: number
  sourceEvidenceState: EvidenceState | "missing"
  sourceEvidenceReason?: string
  calibrationReason?: string
}

export interface OmittedGradeComponentV3 {
  key: string
  reason: string
  evidenceState?: EvidenceState | "missing"
}

export interface GradeResultV3 {
  grade: Grade
  /** Monotonic normal-score compatibility transform; never used for the letter. */
  gradeScore: number
  /** Frozen-reference responsibility score; never derived from current-lobby placement. */
  roleFitScore: number
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
    evidencePolicyVersion: typeof GRADE_V3_EVIDENCE_POLICY_VERSION
    calibrationClusterPolicy: string
    context: GradeModeContextV3
    position: NormalizedPosition
    primaryArchetype: PrimaryArchetype
    archetypeSource: ArchetypeResolutionSource
    responsibilityTiers: Readonly<Record<GradeFamilyV3, ResponsibilityTier>>
    /** Arithmetic responsibility composite before the second ECDF stage. */
    rawResponsibilityScore: number
    roleFitCalibrationSource: string
    roleFitScore: number
    gradeScore: number
    lobbyPercentile: number
    compositePercentile: number
    components: GradeComponentV3[]
    diagnosticMetrics: GradeDiagnosticMetricV3[]
    omittedComponents: OmittedGradeComponentV3[]
  }
}

export interface GradeLobbyV3Outcome {
  status: GradeV3Status
  algorithmVersion: 3
  recipeDefinitionId: string
  recipeId?: string
  results: Map<number, GradeResultV3>
  reason?: string
}

const EMPTY_OUTCOME_BASE = {
  algorithmVersion: GRADE_V3_ALGORITHM_VERSION,
  recipeDefinitionId: GRADE_V3_RECIPE_DEFINITION_ID,
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

/** Compatibility formula only; not used by scoreLobbyV3. */
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

const emptyOutcome = (status: Exclude<GradeV3Status, "ready">, reason?: string): GradeLobbyV3Outcome => ({
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

function applicableMetrics(
  family: GradeFamilyV3,
  position: NormalizedPosition,
) {
  const configured = GRADE_V3_RECIPE.aggregation.familyMetrics[family]
  if (family === "resources" && position === "UTILITY") {
    return configured.filter((metric) => metric.key !== "cs_per_min")
  }
  return [...configured]
}

interface FamilyResolution {
  score?: number
  signals: GradeComponentV3["signals"]
  reason?: string
  evidenceState?: EvidenceState | "missing"
}

function resolveFamily(
  player: GradePlayerV3Input,
  family: GradeFamilyV3,
): FamilyResolution {
  const metrics = applicableMetrics(family, player.position)
  const denominator = metrics.reduce((sum, metric) => sum + metric.weight, 0)
  const signals: GradeComponentV3["signals"] = []
  for (const metric of metrics) {
    const evidence = player.metricEvidence[metric.key]
    if (!evidence) {
      return { signals, reason: `${metric.key}:missing`, evidenceState: "missing" }
    }
    if (evidence.state !== "observed") {
      return {
        signals,
        reason: `${metric.key}:${evidence.reason ?? evidence.state}`,
        evidenceState: evidence.state,
      }
    }
    // Do not use truthiness here: an observed zero is valid and intentionally scored.
    if (!Number.isFinite(evidence.value) || evidence.value < 0 || evidence.value > 1) {
      return { signals, reason: `${metric.key}:percentile_out_of_range`, evidenceState: "invalid" }
    }
    signals.push({
      key: metric.key,
      percentile: evidence.value,
      weight: metric.weight / denominator,
      evidenceState: "observed",
      sourceEvidenceState: player.metricProvenance?.[metric.key]?.state ?? evidence.state,
      ...(player.metricProvenance?.[metric.key]?.reason
        ? { sourceEvidenceReason: player.metricProvenance[metric.key]?.reason }
        : {}),
      ...(evidence.reason ? { calibrationReason: evidence.reason } : {}),
    })
  }
  return {
    score: signals.reduce((sum, signal) => sum + signal.percentile * signal.weight, 0),
    signals,
  }
}

interface ResolvedPlayer {
  player: GradePlayerV3Input
  archetype: PrimaryArchetype
  archetypeSource: ArchetypeResolutionSource
  tiers: Readonly<Record<GradeFamilyV3, ResponsibilityTier>>
  components: GradeComponentV3[]
  omitted: OmittedGradeComponentV3[]
  composite: number
}

type ResponsibilityResolution =
  | { status: "ready"; resolved: ResolvedPlayer[] }
  | { status: Exclude<GradeV3Status, "ready">; reason?: string }

function resolveResponsibilityLobbyV3(
  input: Pick<GradeLobbyV3Input, "players" | "context">,
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
    const denominator = GRADE_FAMILIES.reduce((sum, family) => sum + tiers[family], 0)
    if (denominator <= 0) {
      return {
        status: "missing_core_metric",
        reason: `participant:${player.participantId}:no_responsibilities`,
      }
    }

    const components: GradeComponentV3[] = []
    const omitted: OmittedGradeComponentV3[] = []
    for (const family of GRADE_FAMILIES) {
      const familyResult = resolveFamily(player, family)
      const tier = tiers[family]
      if (familyResult.score === undefined) {
        if (tier > 0) {
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
      const weight = tier / denominator
      components.push({
        key: family,
        label: family[0].toUpperCase() + family.slice(1),
        componentScore: familyResult.score,
        rankPercentile: familyResult.score,
        magnitudeScore: familyResult.score,
        peerCount: player.peerCount ?? players.length,
        comparisonScope: player.comparisonScope ?? "role",
        metricBasis: family === "fighting" ? "team_share" : "individual",
        responsibilityTier: tier,
        weight,
        contribution: familyResult.score * weight,
        evidenceState: "observed",
        signals: familyResult.signals,
      })
    }
    // Different responsibility denominators can otherwise turn mathematically
    // equal scores into false lobby ranks through floating-point dust.
    const composite = stableScore(
      components.reduce((sum, component) => sum + component.contribution, 0),
    )
    resolved.push({
      player,
      archetype: archetypeResolution.archetype,
      archetypeSource: archetypeResolution.source,
      tiers,
      components,
      omitted,
      composite,
    })
  }
  return { status: "ready", resolved }
}

export interface RawResponsibilityResultV3 {
  participantId: number
  position: NormalizedPosition
  primaryArchetype: PrimaryArchetype
  /** Fixed-denominator arithmetic mean of metric/family percentiles. */
  rawResponsibilityComposite: number
}

export interface RawResponsibilityLobbyV3Outcome {
  status: GradeV3Status
  results: Map<number, RawResponsibilityResultV3>
  reason?: string
}

/**
 * Resolves the first-stage responsibility composite without assigning a grade.
 * Snapshot construction uses this boundary before the final composite ECDF.
 */
export function rawResponsibilityScoresV3(
  input: Pick<GradeLobbyV3Input, "players" | "context">,
): RawResponsibilityLobbyV3Outcome {
  const outcome = resolveResponsibilityLobbyV3(input)
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

function diagnosticMetricsFor(player: GradePlayerV3Input): GradeDiagnosticMetricV3[] {
  return GRADE_V3_DIAGNOSTIC_METRICS.map((key) => {
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

/** Pure Grade v3 scorer. No database, clock, random, or mutable global inputs. */
export function scoreLobbyV3(input: GradeLobbyV3Input): GradeLobbyV3Outcome {
  const responsibility = resolveResponsibilityLobbyV3(input)
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
  const results = new Map<number, GradeResultV3>()
  for (const entry of responsibility.resolved) {
    const roleFitPercentile = (entry.player.responsibilityEvidence as {
      state: "observed"
      value: number
    }).value
    const rawResponsibilityScore = entry.composite * 100
    const roleFitScore = roleFitPercentile * 100
    const gradeScore = normalQuantile(roleFitPercentile)
    const lobbyPercentile = rankPercentile(composites, entry.composite)
    results.set(entry.player.participantId, {
      grade: gradeForRoleFitScore(roleFitScore),
      gradeScore,
      roleFitScore,
      lobbyPercentile,
      compositePercentile: lobbyPercentile,
      breakdown: {
        algorithmVersion: GRADE_V3_ALGORITHM_VERSION,
        recipeDefinitionId: GRADE_V3_RECIPE_DEFINITION_ID,
        recipeId,
        calibrationSnapshotId: input.calibrationSnapshotId,
        taxonomyVersion: GRADE_V3_RECIPE.taxonomyVersion,
        positionResolverVersion: GRADE_V3_RECIPE.sourceContracts.positionResolverVersion,
        gradeCoreFactContractVersion:
          GRADE_V3_RECIPE.sourceContracts.gradeCoreFactContractVersion,
        evidencePolicyVersion: GRADE_V3_RECIPE.sourceContracts.evidencePolicyVersion,
        calibrationClusterPolicy: GRADE_V3_RECIPE.calibration.clusterIdentity,
        context: { ...input.context },
        position: entry.player.position,
        primaryArchetype: entry.archetype,
        archetypeSource: entry.archetypeSource,
        responsibilityTiers: entry.tiers,
        rawResponsibilityScore,
        roleFitCalibrationSource:
          entry.player.responsibilityEvidence?.reason ?? "frozen_composite_ecdf",
        roleFitScore,
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

/** Alias naming the evidence-prepared boundary explicitly. */
export const gradePreparedLobbyV3 = scoreLobbyV3

const numeric = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0

function legacyLobbyShape(lobby: readonly GradeInput[]) {
  return lobbyShape(lobby.map((entry) => ({
    participantId: entry.participantId,
    teamId: entry.teamId,
    isPlayer: entry.isPlayer === true,
  })))
}

function rankedEvidence(
  values: readonly (number | undefined)[],
  index: number,
  direction: "higher" | "lower" = "higher",
): Evidence<number> {
  const value = values[index]
  if (!numeric(value)) return unavailable("legacy_grade_input_missing", { source: "legacy" })
  const peers = values.filter(numeric)
  const signed = direction === "lower" ? peers.map((entry) => -entry) : peers
  return observed(clampCalibrationPercentile(rankPercentile(
    signed,
    direction === "lower" ? -value : value,
  )), { source: "derived", reason: "compatibility_lobby_rank" })
}

/**
 * Compatibility adapter for current GradeInput callers. It intentionally does
 * not invent CC, ally heal/shield, or structure-damage evidence; responsibilities
 * that require those signals are withheld until ingestion supplies them.
 */
function prepareLegacyLobby(lobby: readonly GradeInput[]): GradePlayerV3Input[] {
  const teamKills = new Map<number, number>()
  const teamDamage = new Map<number, number>()
  const teamObjectives = new Map<number, number>()
  for (const player of lobby) {
    teamKills.set(player.teamId, (teamKills.get(player.teamId) ?? 0) + player.kills)
    teamDamage.set(player.teamId, (teamDamage.get(player.teamId) ?? 0) + player.damageToChampions)
    teamObjectives.set(player.teamId, (teamObjectives.get(player.teamId) ?? 0) +
      (numeric(player.damageObjectives) ? player.damageObjectives : 0))
  }
  const damageShare = lobby.map((player) => {
    const total = teamDamage.get(player.teamId) ?? 0
    return total > 0 ? player.damageToChampions / total : undefined
  })
  const participation = lobby.map((player) => {
    const total = teamKills.get(player.teamId) ?? 0
    return total > 0 ? (player.kills + player.assists) / total : undefined
  })
  const deaths = lobby.map((player) => player.deaths)
  const gold = lobby.map((player) => player.goldEarned)
  const farming = lobby.map((player) => player.csPerMin)
  const objectives = lobby.map((player) => {
    if (!numeric(player.damageObjectives)) return undefined
    const total = teamObjectives.get(player.teamId) ?? 0
    return total > 0 ? player.damageObjectives : undefined
  })
  const vision = lobby.map((player) => player.visionScore)

  return lobby.map((player, index) => {
    const noTeamKills = (teamKills.get(player.teamId) ?? 0) <= 0
    const noTeamDamage = (teamDamage.get(player.teamId) ?? 0) <= 0
    const noObjectives = numeric(player.damageObjectives) &&
      (teamObjectives.get(player.teamId) ?? 0) <= 0
    return {
      participantId: player.participantId,
      teamId: player.teamId,
      isPlayer: player.isPlayer === true,
      position: normalizePosition({ assignedPosition: player.role }),
      primaryArchetype: primaryArchetypeForClass(player.championClass),
      comparisonScope: "lobby",
      peerCount: lobby.length,
      metricEvidence: {
        damage_share: noTeamDamage
          ? noOpportunity("team_dealt_no_champion_damage", { source: "derived" })
          : rankedEvidence(damageShare, index),
        kill_participation: noTeamKills
          ? noOpportunity("team_had_no_kills", { source: "derived" })
          : rankedEvidence(participation, index),
        // Match duration is shared, so totals preserve within-lobby rate ordering.
        deaths_per_10: rankedEvidence(deaths, index, "lower"),
        gold_per_min: rankedEvidence(gold, index),
        cs_per_min: rankedEvidence(farming, index),
        neutral_objective_damage_per_min: noObjectives
          ? noOpportunity("team_had_no_objective_damage", { source: "derived" })
          : rankedEvidence(objectives, index),
        structure_damage_per_min: unavailable("not_present_in_legacy_grade_input", { source: "legacy" }),
        vision_score_per_min: rankedEvidence(vision, index),
        cc_seconds_per_min: unavailable("not_present_in_legacy_grade_input", { source: "legacy" }),
        ally_heal_shield_per_min: unavailable("not_present_in_legacy_grade_input", { source: "legacy" }),
      },
    }
  })
}

export function gradeLobbyV3(
  lobby: readonly GradeInput[],
  family: ModeFamily,
  forcedStatus?: Exclude<GradeV3Status, "ready">,
): GradeLobbyV3Outcome {
  if (forcedStatus) return emptyOutcome(forcedStatus)
  if (family === "other") return emptyOutcome("unsupported_mode")
  if (!legacyLobbyShape(lobby)) return emptyOutcome("incomplete_lobby")
  if (!lobby.every((player) => [
    player.kills,
    player.deaths,
    player.assists,
    player.damageToChampions,
    player.damageTaken,
    player.goldEarned,
  ].every(numeric))) {
    return emptyOutcome("missing_core_metric", "required_core_field")
  }
  return scoreLobbyV3({
    players: prepareLegacyLobby(lobby),
    context: defaultGradeModeContext(family),
    calibrationSnapshotId: "compatibility-lobby-rank-r1",
  })
}

export function gradeLobbyBoth(lobby: GradeInput[], family: ModeFamily) {
  return { v3: gradeLobbyV3(lobby, family) }
}
