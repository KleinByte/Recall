import { createHash } from "node:crypto"
import type { Database } from "better-sqlite3"
import {
  GradePersistenceRepository,
  type GradeStatus,
  type StoredGradeRecipe,
} from "../database/grade-persistence-repo.js"
import { MetricObservationsRepository } from "../database/metric-observations-repo.js"
import {
  canonicalJson,
  decodeCanonicalJsonV1,
} from "../database/match-source-repo.js"
import {
  evaluateMatchEligibility,
  isBotQueue,
  type MatchEligibilityResult,
} from "./eligibility.js"
import {
  GRADE_CORE_FACT_CONTRACT_VERSION,
  isGradeCoreSource,
} from "./grade-core-facts.js"
import {
  backfillGradeCoreFactsFromRawPayloads,
  hasRecoverableGradeCoreFactsFromRawPayloads,
} from "./grade-core-backfill.js"
import {
  GRADE_V3_ALGORITHM_VERSION,
  GRADE_V3_RECIPE,
  GRADE_V3_RECIPE_DEFINITION_ID,
  scoreLobbyV3,
} from "./grade-v3.js"
import {
  GRADE_V3_CALIBRATION_FORMAT_VERSION,
  GRADE_V3_MINIMUM_REFERENCE_MATCHES,
  GRADE_V3_MINIMUM_SCOPE_MATCHES,
  buildGradeCalibrationSnapshotV3,
  gradeCalibrationClusterIdV3,
  prepareDetailMetricObservationsFromSnapshotV3,
  prepareGradeLobbyFromSnapshotV3,
  summarizeGradeCalibrationScopesV3,
  type GradeCalibrationSnapshotV3,
  type GradeRawLobbyV3,
  type GradeRawParticipantV3,
} from "./grade-v3-observations.js"
import {
  recipeIdForCalibration,
} from "./grade-v3-recipe.js"
import {
  calibrationScopeKey,
  defaultRulesetForModeFamily,
  type GradeModeContextV3,
} from "./grade-v3-taxonomy.js"
import {
  normalizePosition,
  normalizeTeamPositions,
  POSITION_RESOLVER_VERSION,
  POSITIONS,
  type NormalizedPosition,
} from "./position.js"
import type { ModeFamily, TrackedMode } from "./types.js"
import {
  deriveSummaryMetricObservationsV3,
  type SummaryMetricParticipantV3,
} from "./rvi-v3-summary.js"
import {
  toMatchMetricObservationV3,
  type MatchMetricObservationV3,
  type MetricSourceQualityV3,
  type RawMetricObservationV3,
} from "./metric-observations-v3.js"
import { RVI_V3_SUMMARY_DERIVATION_ID } from "./rvi-v3-summary.js"
import {
  RVI_V3_ALGORITHM_VERSION,
  rviRecipeDefinitionV3,
  rviRecipeIdForCalibration,
} from "./rvi-v3-recipe.js"
import { GRADE_METRICS, type GradeMetricV3 } from "./grade-v3-recipe.js"
import {
  mapTimeline,
  TIMELINE_MAPPER_VERSION,
  type CompactTimeline,
} from "../riot/timeline-mapper.js"
import {
  deriveTimelineMetricObservationsV3,
  RVI_V3_TIMELINE_DERIVATION_ID,
} from "./rvi-v3-timeline.js"
import { METRIC_DEFINITIONS_V3 } from "./metric-registry-v3.js"
import {
  selectTimelineSource,
  type TimelineSourceCandidate,
} from "./timeline-source-selector.js"

export const GRADE_V3_MINIMUM_SNAPSHOT_MATCHES = GRADE_V3_MINIMUM_SCOPE_MATCHES

interface StoredMatchRow {
  gameId: number
  puuid: string
  platformId: string | null
  riotMatchId: string | null
  queueId: number
  gameMode: string
  mode: TrackedMode
  modeFamily: ModeFamily
  isMatched: number
  durationSecs: number
  playedAt: number
  queueName: string | null
  ownerEligibleForProgression: number | null
  durationQuality: string | null
  endOfGameResult: string | null
  endedInEarlySurrender: number
}

interface StoredParticipantRow {
  participantId: number
  teamId: number
  isPlayer: number
  championId: number
  spell1Id: number
  spell2Id: number
  kills: number
  deaths: number
  assists: number
  damageToChampions: number
  damageTaken: number
  damageSelfMitigated: number
  goldEarned: number
  totalMinionsKilled: number
  neutralMinions: number
  damageObjectives: number
  damageTurrets: number
  timeCcingOthers: number
  visionScore: number
  wardsPlaced: number
  wardsKilled: number
  eligibleForProgression: number | null
  controlWardsPurchased: number | null
  detectorWardsPlaced: number | null
  totalHealsOnTeammates: number | null
  totalDamageShieldedOnTeammates: number | null
  damageDealtToBuildings: number | null
  assignedPosition: string | null
  lcuLane: string | null
  lcuRole: string | null
  legacyLane: string | null
  legacyRole: string | null
  matchV5TeamPosition: string | null
  matchV5IndividualPosition: string | null
  resolvedPosition: string | null
  positionResolverVersion: number | null
  extendedMetricsJson: string
  gradeCoreComplete: number
  gradeCoreSource: string
  gradeCoreMissingFieldsJson: string
  gradeCoreContractVersion: number
}

export interface RecallV3CalibrationStatus {
  state: "calibrating" | "frozen"
  requiredMatches: number
  eligibleMatches: number
  largestScopeMatches: number
  scopeMatchCounts: Record<string, number>
  supportedScopes: string[]
  supportedModes: string[]
  recipeId?: string
  calibrationId?: string
  frozenAt?: number
  referenceMatches?: number
}

export interface RecallV3RebuildProgress {
  total: number
  processed: number
  ready: number
  nonready: number
  errors: number
  gameId?: number
}

export interface RecallV3RebuildResult extends RecallV3RebuildProgress {
  recipeId: string
  calibrationId: string
  runId: number
}

export interface VerifiedGradeBackup {
  path: string
  sha256: string
}

const sha256 = (value: unknown) => createHash("sha256")
  .update(canonicalJson(value))
  .digest("hex")

const finiteNonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0

function parseExtendedMetrics(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function optionalMetric(
  stored: number | null,
  extended: Record<string, unknown>,
  key: string,
): number | undefined {
  if (finiteNonnegative(stored)) return stored
  const value = extended[key]
  return finiteNonnegative(value) ? value : undefined
}

function gradeContext(match: StoredMatchRow): GradeModeContextV3 | undefined {
  if (match.modeFamily === "other") return undefined
  return {
    modeFamily: match.modeFamily,
    trackedMode: match.mode,
    ruleset: defaultRulesetForModeFamily(match.modeFamily),
    rulesetKey: `${match.mode}:rules-r1`,
  }
}

function resolvedPosition(
  participant: StoredParticipantRow,
  family: ModeFamily,
): NormalizedPosition {
  if (family === "aram") return "UNKNOWN"
  const stored = participant.resolvedPosition?.trim().toUpperCase()
  if (participant.positionResolverVersion === POSITION_RESOLVER_VERSION &&
      stored && (POSITIONS as readonly string[]).includes(stored)) {
    return stored as NormalizedPosition
  }
  return normalizePosition({
    matchV5TeamPosition: participant.matchV5TeamPosition,
    matchV5IndividualPosition: participant.matchV5IndividualPosition,
    assignedPosition: participant.assignedPosition,
    lcuLane: participant.lcuLane,
    lcuRole: participant.lcuRole,
    legacyLane: participant.legacyLane,
    legacyRole: participant.legacyRole,
    spell1Id: participant.spell1Id,
    spell2Id: participant.spell2Id,
  })
}

function resolvedLobbyPositions(
  participants: readonly StoredParticipantRow[],
  family: ModeFamily,
): Map<number, NormalizedPosition> {
  if (family === "aram") {
    return new Map(participants.map((participant) => [participant.participantId, "UNKNOWN"]))
  }
  const result = new Map<number, NormalizedPosition>()
  const teams = new Map<number, StoredParticipantRow[]>()
  for (const participant of participants) {
    const team = teams.get(participant.teamId) ?? []
    team.push(participant)
    teams.set(participant.teamId, team)
  }
  for (const team of teams.values()) {
    const reconciled = normalizeTeamPositions(team)
    for (const participant of team) {
      result.set(
        participant.participantId,
        reconciled?.get(participant.participantId) ?? resolvedPosition(participant, family),
      )
    }
  }
  return result
}

function exactPositionShape(
  participants: readonly StoredParticipantRow[],
  family: ModeFamily,
  resolved: ReadonlyMap<number, NormalizedPosition>,
): boolean {
  if (family === "aram") return true
  const byTeam = new Map<number, NormalizedPosition[]>()
  for (const participant of participants) {
    const position = resolved.get(participant.participantId) ?? "UNKNOWN"
    const positions = byTeam.get(participant.teamId) ?? []
    positions.push(position)
    byTeam.set(participant.teamId, positions)
  }
  const expected = [...POSITIONS].sort().join("|")
  return [...byTeam.values()].every((positions) =>
    positions.length === POSITIONS.length && [...positions].sort().join("|") === expected)
}

type DurationQuality = MatchEligibilityResult["durationQuality"]

function durationQuality(value: string | null): DurationQuality {
  if (value === null || value === "legacy") return "legacy"
  return ["verified", "source_reported", "inconsistent", "invalid"].includes(value)
    ? value as DurationQuality
    : "invalid"
}

function sourceFactsComplete(participants: readonly StoredParticipantRow[]): boolean {
  return participants.every((participant) => {
    if (participant.gradeCoreComplete !== 1 ||
        participant.gradeCoreContractVersion !== GRADE_CORE_FACT_CONTRACT_VERSION ||
        !isGradeCoreSource(participant.gradeCoreSource) ||
        participant.gradeCoreSource === "legacy_unknown" ||
        participant.gradeCoreSource === "legacy_full_detail") return false
    try {
      const missing = JSON.parse(participant.gradeCoreMissingFieldsJson) as unknown
      return Array.isArray(missing) && missing.length === 0
    } catch {
      return false
    }
  })
}

function terminatedMatch(match: StoredMatchRow): boolean {
  if (match.endedInEarlySurrender === 1) return true
  const result = match.endOfGameResult?.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
  return Boolean(result && !result.startsWith("gamecomplete"))
}

function gradeEligibility(
  match: StoredMatchRow,
  participants: readonly StoredParticipantRow[],
  resolved: ReadonlyMap<number, NormalizedPosition>,
): Exclude<GradeStatus, "ready"> | undefined {
  const coreMetricsComplete = participants.every((participant) => [
    participant.kills,
    participant.deaths,
    participant.assists,
    participant.damageToChampions,
    participant.goldEarned,
    participant.totalMinionsKilled,
    participant.neutralMinions,
    participant.damageObjectives,
    participant.damageTurrets,
    participant.timeCcingOthers,
    participant.visionScore,
  ].every(finiteNonnegative) && Number.isSafeInteger(participant.championId) &&
    participant.championId > 0)
  const factsComplete = sourceFactsComplete(participants)
  const quality = durationQuality(match.durationQuality)
  const ownerProgression = participants.find((participant) => participant.isPlayer === 1)
    ?.eligibleForProgression
  const eligibleForProgression = match.ownerEligibleForProgression === 0 ||
      ownerProgression === 0
    ? false
    : match.ownerEligibleForProgression === 1 || ownerProgression === 1
      ? true
      : null
  const legacyProvenance = quality === "legacy"
  const contextComplete = Boolean(
    match.gameMode?.trim() && match.mode?.trim() && match.modeFamily?.trim(),
  )
  const eligibility = evaluateMatchEligibility({
    provenance: legacyProvenance ? "legacy" : "current_source",
    normalizedDurationSeconds: Number.isSafeInteger(match.durationSecs)
      ? match.durationSecs
      : null,
    durationQuality: quality,
    knownBotTutorial: isBotQueue(match.queueId, match.queueName ?? undefined),
    matched: match.isMatched === 1,
    family: match.modeFamily,
    contextComplete,
    registeredCapability: ["sr", "aram", "classic", "other"].includes(match.modeFamily),
    terminated: terminatedMatch(match),
    eligibleForProgression,
    requiredSourceFactsComplete: factsComplete,
    missingOnlyLegacyCompatibleFacts: legacyProvenance && factsComplete,
    lobby: participants.map((participant) => ({
      participantId: participant.participantId,
      teamId: participant.teamId,
      owner: participant.isPlayer === 1,
    })),
    coreMetricsComplete,
  })
  if (!eligibility.gradeEligible) {
    return eligibility.reason === "eligible"
      ? "missing_source_fact"
      : eligibility.reason
  }
  if (!gradeContext(match)) return "unsupported_mode"
  if (!exactPositionShape(participants, match.modeFamily, resolved)) return "position_unresolved"
  return undefined
}

function toRawLobby(
  match: StoredMatchRow,
  participants: readonly StoredParticipantRow[],
  resolved: ReadonlyMap<number, NormalizedPosition>,
): GradeRawLobbyV3 | undefined {
  const context = gradeContext(match)
  if (!context) return undefined
  const players: GradeRawParticipantV3[] = participants.map((participant) => {
    const extended = parseExtendedMetrics(participant.extendedMetricsJson)
    return {
      participantId: participant.participantId,
      teamId: participant.teamId,
      isPlayer: participant.isPlayer === 1,
      championId: participant.championId,
      position: resolved.get(participant.participantId) ?? "UNKNOWN",
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      damageToChampions: participant.damageToChampions,
      damageTaken: participant.damageTaken,
      damageSelfMitigated: participant.damageSelfMitigated,
      goldEarned: participant.goldEarned,
      totalMinionsKilled: participant.totalMinionsKilled,
      neutralMinions: participant.neutralMinions,
      damageObjectives: participant.damageObjectives,
      damageTurrets: participant.damageTurrets,
      // `damageDealtToBuildings` is not exposed consistently by LCU and
      // Match-V5. Turret damage is the common source fact, so it is the only
      // scored structure definition. Broader building damage stays diagnostic.
      damageStructures: participant.damageTurrets,
      visionScore: participant.visionScore,
      wardsPlaced: participant.wardsPlaced,
      wardsKilled: participant.wardsKilled,
      controlWardsPurchased: optionalMetric(
        participant.controlWardsPurchased,
        extended,
        "visionWardsBoughtInGame",
      ),
      detectorWardsPlaced: optionalMetric(
        participant.detectorWardsPlaced,
        extended,
        "detectorWardsPlaced",
      ),
      totalTimeSpentDead: optionalMetric(
        null,
        extended,
        "totalTimeSpentDead",
      ),
      timeCcingOthers: participant.timeCcingOthers,
      totalHealsOnTeammates: optionalMetric(
        participant.totalHealsOnTeammates,
        extended,
        "totalHealsOnTeammates",
      ),
      totalDamageShieldedOnTeammates: optionalMetric(
        participant.totalDamageShieldedOnTeammates,
        extended,
        "totalDamageShieldedOnTeammates",
      ),
    }
  })
  const summaryPlayers: SummaryMetricParticipantV3[] = players.map((player) => ({
    participantId: player.participantId,
    teamId: player.teamId,
    kills: player.kills,
    deaths: player.deaths,
    assists: player.assists,
    damageToChampions: player.damageToChampions,
    goldEarned: player.goldEarned,
    totalMinionsKilled: player.totalMinionsKilled,
    neutralMinions: player.neutralMinions,
    damageObjectives: player.damageObjectives,
    damageTurrets: player.damageTurrets,
    damageStructures: player.damageStructures,
    visionScore: player.visionScore,
    timeCcingOthers: player.timeCcingOthers,
    damageTaken: player.damageTaken ?? Number.NaN,
    damageSelfMitigated: player.damageSelfMitigated ?? Number.NaN,
    wardsPlaced: player.wardsPlaced ?? Number.NaN,
    wardsKilled: player.wardsKilled ?? Number.NaN,
    controlWardsPurchased: player.controlWardsPurchased,
    detectorWardsPlaced: player.detectorWardsPlaced,
    totalTimeSpentDead: player.totalTimeSpentDead,
    totalHealsOnTeammates: player.totalHealsOnTeammates,
    totalDamageShieldedOnTeammates: player.totalDamageShieldedOnTeammates,
  }))
  const sourceQuality = (participant: StoredParticipantRow): MetricSourceQualityV3 => {
    if (participant.gradeCoreSource === "match_v5" ||
        participant.gradeCoreSource === "league_client") return "verified"
    if (participant.gradeCoreSource === "legacy_full_detail") return "retained"
    return "legacy"
  }
  const detailMetricObservations = new Map(participants.map((participant) => [
    participant.participantId,
    deriveSummaryMetricObservationsV3({
      participantId: participant.participantId,
      durationSecs: match.durationSecs,
      context,
      participants: summaryPlayers,
      sourceQuality: sourceQuality(participant),
    }),
  ]))
  return {
    clusterId: gradeCalibrationClusterIdV3(match),
    matchId: match.gameId,
    puuid: match.puuid,
    durationSecs: match.durationSecs,
    context,
    players,
    detailMetricObservations,
  }
}

function timelineFramesFromPayloadV3(value: unknown): RawTimelineFramesV3 | undefined {
  if (Array.isArray(value)) return value as RawTimelineFramesV3
  if (!value || typeof value !== "object") return undefined
  const payload = value as {
    frames?: unknown
    info?: { frames?: unknown }
  }
  const frames = Array.isArray(payload.frames)
    ? payload.frames
    : Array.isArray(payload.info?.frames)
      ? payload.info.frames
      : undefined
  return frames as RawTimelineFramesV3 | undefined
}

function compactTimelineFromJsonV3(value: string | null): CompactTimeline | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as Partial<CompactTimeline>
    return Array.isArray(parsed.frames) && Array.isArray(parsed.events) &&
        Array.isArray(parsed.turningPoints)
      ? parsed as CompactTimeline
      : undefined
  } catch {
    return undefined
  }
}

type RawTimelineFramesV3 = Parameters<typeof mapTimeline>[0]

interface LoadedTimelineEvidenceV3 {
  timeline?: CompactTimeline
  sourceQuality: MetricSourceQualityV3
  wardEventsComplete: boolean
}

function snapshotFromUnknown(value: unknown): GradeCalibrationSnapshotV3 {
  if (!value || typeof value !== "object" ||
      (value as GradeCalibrationSnapshotV3).formatVersion !==
        GRADE_V3_CALIBRATION_FORMAT_VERSION) {
    throw new Error("grade_v3_calibration_snapshot_invalid")
  }
  const snapshot = value as GradeCalibrationSnapshotV3
  if (!Array.isArray(snapshot.referencePopulation?.supportedModes) ||
      !Array.isArray(snapshot.referencePopulation?.supportedScopes) ||
      snapshot.referencePopulation.clusterIdentity !==
        GRADE_V3_RECIPE.calibration.clusterIdentity ||
      !Array.isArray(snapshot.clusterIds) ||
      !snapshot.referencePopulation.scopeMatchCounts ||
       typeof snapshot.referencePopulation.scopeMatchCounts !== "object" ||
       !snapshot.observations || typeof snapshot.observations !== "object" ||
       !snapshot.detailObservations || typeof snapshot.detailObservations !== "object" ||
       !Array.isArray(snapshot.compositeObservations)) {
    throw new Error("grade_v3_calibration_snapshot_invalid")
  }
  return snapshot
}

function selectedRecipeIsCurrent(
  recipe: StoredGradeRecipe | undefined,
): recipe is StoredGradeRecipe & { calibrationId: string } {
  if (!recipe?.calibrationId) return false
  const definition = recipe.definition && typeof recipe.definition === "object"
    ? recipe.definition as Record<string, unknown>
    : undefined
  return recipe.recipeId === recipeIdForCalibration(recipe.calibrationId) &&
    definition?.recipeDefinitionId === GRADE_V3_RECIPE_DEFINITION_ID
}

function calibrationScopeStatus(lobbies: readonly GradeRawLobbyV3[]) {
  const summaries = summarizeGradeCalibrationScopesV3(lobbies)
  const supported = summaries.filter((scope) => scope.supported)
  return {
    eligibleMatches: lobbies.length,
    largestScopeMatches: Math.max(0, ...summaries.map((scope) => scope.independentMatches)),
    scopeMatchCounts: Object.fromEntries(summaries.map((scope) => [
      scope.scopeKey,
      scope.independentMatches,
    ])),
    supportedScopes: supported.map((scope) => scope.scopeKey),
    supportedModes: [...new Set(supported.map((scope) => scope.trackedMode))].sort(),
  }
}

const GRADE_CACHE_PRESENT_SQL = `(
  grade IS NOT NULL OR grade_score IS NOT NULL OR
  grade_algorithm_version IS NOT NULL OR grade_status IS NOT NULL OR
  grade_composite_percentile IS NOT NULL OR grade_recipe_id IS NOT NULL OR
  role_fit_score IS NOT NULL OR grade_evidence_coverage IS NOT NULL OR
  grade_reference_sample_count IS NOT NULL OR
  grade_reference_metadata_json IS NOT NULL
)`

const CLEAR_GRADE_CACHE_SQL = `
  grade = NULL, grade_score = NULL, grade_algorithm_version = NULL,
  grade_status = NULL, grade_composite_percentile = NULL,
  grade_recipe_id = NULL, role_fit_score = NULL,
  grade_evidence_coverage = NULL, grade_reference_sample_count = NULL,
  grade_reference_metadata_json = NULL
`

function snapshotReferenceMetadata(
  snapshot: GradeCalibrationSnapshotV3,
  context?: GradeModeContextV3,
) {
  const scopeKey = context ? calibrationScopeKey(context) : undefined
  return {
    population: "local_recall_installation" as const,
    frozen: true as const,
    clusterUnit: "match" as const,
    clusterIdentity: snapshot.referencePopulation.clusterIdentity,
    supportedModes: [...snapshot.referencePopulation.supportedModes],
    supportedScopes: [...snapshot.referencePopulation.supportedScopes],
    ...(context ? {
      trackedMode: context.trackedMode,
      rulesetKey: context.rulesetKey,
      scopeKey,
      scopeFrozen: snapshot.referencePopulation.supportedScopes.includes(scopeKey!),
    } : {}),
    minimumReferenceMatches: GRADE_V3_MINIMUM_REFERENCE_MATCHES,
  }
}

/**
 * One authoritative Grade/RVI v3 coordinator for startup, sync, import,
 * review, and explicit recalibration. Frozen snapshots never absorb new games.
 */
export class RecallV3Service {
  private readonly grades: GradePersistenceRepository
  private readonly metrics: MetricObservationsRepository

  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {
    this.grades = new GradePersistenceRepository(db, now)
    this.metrics = new MetricObservationsRepository(db, now)
  }

  calibrationStatus(): RecallV3CalibrationStatus {
    const selected = this.grades.getSelectedRecipe(GRADE_V3_ALGORITHM_VERSION)
    const liveScopes = calibrationScopeStatus(this.loadEligibleReferenceLobbies())
    if (!selectedRecipeIsCurrent(selected)) {
      return {
        state: "calibrating",
        requiredMatches: GRADE_V3_MINIMUM_SNAPSHOT_MATCHES,
        ...liveScopes,
      }
    }
    const row = this.db.prepare(`
      SELECT sample_count AS sampleCount, created_at AS createdAt
      FROM grade_calibration_snapshots WHERE calibration_id = ?
    `).get(selected.calibrationId) as { sampleCount: number; createdAt: number } | undefined
    if (!row) throw new Error("selected_grade_calibration_missing")
    const snapshot = this.loadSnapshot(selected.calibrationId)
    return {
      state: "frozen",
      requiredMatches: GRADE_V3_MINIMUM_SNAPSHOT_MATCHES,
      ...liveScopes,
      supportedScopes: [...snapshot.referencePopulation.supportedScopes],
      supportedModes: [...snapshot.referencePopulation.supportedModes],
      recipeId: selected.recipeId,
      calibrationId: selected.calibrationId,
      frozenAt: row.createdAt,
      referenceMatches: row.sampleCount,
    }
  }

  /** Read-only probe used to decide whether startup must create a backup. */
  hasRecoverableRawReferenceData(): boolean {
    return hasRecoverableGradeCoreFactsFromRawPayloads(this.db)
  }

  /**
   * True when a pre-v3 cache/artifact could still be read as current data.
   * This is checked before any renderer IPC is registered so an upgrade never
   * exposes a legacy grade while the local reference is still calibrating.
   */
  needsDirectCutover(): boolean {
    const selected = this.grades.getSelectedRecipe(GRADE_V3_ALGORITHM_VERSION)
    const hasCurrentRecipe = selectedRecipeIsCurrent(selected)
    const selectedRvi = this.metrics.getSelectedRecipe(GRADE_V3_ALGORITHM_VERSION)
    const staleRviSelection = hasCurrentRecipe && (
      !selectedRvi || selectedRvi.recipeId !== rviRecipeIdForCalibration(
        selected.recipeId,
        selected.calibrationId,
      ) || selectedRvi.gradeRecipeId !== selected.recipeId ||
      selectedRvi.calibrationId !== selected.calibrationId
    )
    const missingMetricInventory = hasCurrentRecipe && !staleRviSelection &&
      Number((this.db.prepare(`
        SELECT EXISTS(
          SELECT 1
          FROM match_grade_attempts attempt
          JOIN match_participants participant
            ON participant.game_id = attempt.game_id
           AND participant.puuid = attempt.puuid
           AND participant.participant_id = attempt.owner_participant_id
           AND participant.is_player = 1
          WHERE attempt.algorithm_version = 3
            AND attempt.recipe_id = ?
            AND attempt.grade_status = 'ready'
            AND (
              SELECT COUNT(*) FROM match_metric_observations observation
              WHERE observation.game_id = attempt.game_id
                AND observation.puuid = attempt.puuid
                AND observation.participant_id = attempt.owner_participant_id
                AND observation.algorithm_version = 3
                AND observation.recipe_id = ?
            ) <> ?
        ) AS present
      `).get(
        selected.recipeId,
        selectedRvi!.recipeId,
        METRIC_DEFINITIONS_V3.length,
      ) as { present: number }).present) === 1
    const staleSelection = Boolean(selected) && !hasCurrentRecipe
    const staleArtifact = (table: string) => Number((this.db.prepare(`
      SELECT EXISTS(
        SELECT 1 FROM ${table}
        WHERE algorithm_version IN (1, 2)
           ${hasCurrentRecipe ? "" : "OR algorithm_version = 3"}
      ) AS present
    `).get() as { present: number }).present) === 1
    const staleCache = (table: string) => Number((this.db.prepare(`
      SELECT EXISTS(
        SELECT 1 FROM ${table}
        WHERE ${GRADE_CACHE_PRESENT_SQL}
          ${hasCurrentRecipe ? `AND (
            grade_algorithm_version IS NULL OR grade_algorithm_version <> 3 OR
            grade_recipe_id IS NULL OR grade_recipe_id <> ?
          )` : ""}
       ) AS present
    `).get(...(hasCurrentRecipe ? [selected.recipeId] : [])) as { present: number }).present) === 1

    return staleSelection || staleRviSelection || missingMetricInventory || [
      "match_grade_attempts",
      "match_grade_results",
      "match_grade_breakdown_versions",
      "match_grade_breakdowns",
    ].some(staleArtifact) || ["matches", "match_participants"].some(staleCache)
  }

  /** Grades a newly stored match without changing the active reference. */
  gradeStoredMatch(gameId: number, puuid: string): GradeStatus | "calibrating" {
    const selected = this.grades.getSelectedRecipe(GRADE_V3_ALGORITHM_VERSION)
    if (!selectedRecipeIsCurrent(selected)) return "calibrating"
    const selectedRvi = this.metrics.getSelectedRecipe(RVI_V3_ALGORITHM_VERSION)
    const expectedRviRecipeId = rviRecipeIdForCalibration(
      selected.recipeId,
      selected.calibrationId,
    )
    if (!selectedRvi || selectedRvi.recipeId !== expectedRviRecipeId ||
        selectedRvi.gradeRecipeId !== selected.recipeId ||
        selectedRvi.calibrationId !== selected.calibrationId) return "calibrating"
    const snapshot = this.loadSnapshot(selected.calibrationId)
    const { match, participants } = this.loadStoredMatch(gameId, puuid)
    if (!match) throw new Error("grade_match_not_found")
    return this.db.transaction(() => this.gradeOne(
      match,
      participants,
      selected.recipeId,
      selectedRvi.recipeId,
      selected.calibrationId,
      snapshot,
    ))()
  }

  /**
   * Regrades atomically after retained source evidence (most commonly a
   * timeline) becomes available. The calibration reference stays frozen, but
   * its metric inventory, arm composite, and RoleFit result advance together.
   */
  refreshMetricObservations(
    gameId: number,
    puuid: string,
  ): GradeStatus | "calibrating" {
    const selected = this.grades.getSelectedRecipe(GRADE_V3_ALGORITHM_VERSION)
    if (!selectedRecipeIsCurrent(selected)) return "calibrating"
    const selectedRvi = this.metrics.getSelectedRecipe(RVI_V3_ALGORITHM_VERSION)
    if (!selectedRvi || selectedRvi.recipeId !== rviRecipeIdForCalibration(
      selected.recipeId,
      selected.calibrationId,
    ) || selectedRvi.gradeRecipeId !== selected.recipeId ||
      selectedRvi.calibrationId !== selected.calibrationId) return "calibrating"
    const snapshot = this.loadSnapshot(selected.calibrationId)
    const { match, participants } = this.loadStoredMatch(gameId, puuid)
    if (!match) throw new Error("metric_observation_match_not_found")
    return this.db.transaction(() => this.gradeOne(
      match,
      participants,
      selected.recipeId,
      selectedRvi.recipeId,
      selected.calibrationId,
      snapshot,
    ))()
  }

  /**
   * Freezes the first eligible local reference and performs the direct v3
   * cutover. Once selected, this is a no-op until explicit recalibration.
   */
  ensureFrozenReference(
    backup: VerifiedGradeBackup,
    onProgress?: (progress: RecallV3RebuildProgress) => void,
  ): RecallV3RebuildResult | RecallV3CalibrationStatus {
    backfillGradeCoreFactsFromRawPayloads(this.db)
    let status = this.calibrationStatus()
    const needsDirectCutover = this.needsDirectCutover()
    if (needsDirectCutover && status.supportedScopes.length > 0) {
      return this.recalibrate(backup, onProgress, true)
    }
    if (needsDirectCutover) {
      this.purgePreV3DerivedState(backup)
      status = this.calibrationStatus()
    }
    if (status.state === "frozen") return status
    if (status.supportedScopes.length === 0) return status
    return this.recalibrate(backup, onProgress, true)
  }

  /** Explicit user action: build a new immutable snapshot, purge, and regrade. */
  recalibrate(
    backup: VerifiedGradeBackup,
    onProgress?: (progress: RecallV3RebuildProgress) => void,
    purgeLegacyAlgorithms = false,
  ): RecallV3RebuildResult {
    if (!backup.path || !/^[a-f0-9]{64}$/.test(backup.sha256)) {
      throw new Error("verified_grade_rebuild_backup_required")
    }
    backfillGradeCoreFactsFromRawPayloads(this.db)
    const referenceLobbies = this.loadEligibleReferenceLobbies()
    const snapshot = buildGradeCalibrationSnapshotV3(referenceLobbies)
    if (snapshot.referencePopulation.supportedScopes.length === 0) {
      throw new Error("grade_v3_reference_population_too_small")
    }
    const calibrationHash = sha256(snapshot)
    const calibrationId = `recall.grade.v3.calibration.${calibrationHash}`
    const recipeId = recipeIdForCalibration(calibrationId)
    const recipeDefinition = {
      ...GRADE_V3_RECIPE,
      calibrationId,
      calibrationHash,
      referencePopulation: snapshot.referencePopulation,
    }
    const recipeHash = sha256(recipeDefinition)
    const rviRecipeDefinition = rviRecipeDefinitionV3(recipeId, calibrationId)
    const rviRecipeId = rviRecipeDefinition.recipeId
    const rviRecipeHash = sha256(rviRecipeDefinition)
    const rebuild = this.db.transaction((): RecallV3RebuildResult => {
      this.grades.registerCalibration({
        calibrationId,
        calibrationHash,
        referencePopulation: snapshot.referencePopulation,
        sampleCount: snapshot.clusterIds.length,
        snapshot,
      })
      this.grades.registerRecipe({
        recipeId,
        algorithmVersion: GRADE_V3_ALGORITHM_VERSION,
        recipeHash,
        calibrationId,
        definition: recipeDefinition,
      })
      this.metrics.registerRecipe({
        recipeId: rviRecipeId,
        algorithmVersion: RVI_V3_ALGORITHM_VERSION,
        recipeHash: rviRecipeHash,
        gradeRecipeId: recipeId,
        calibrationId,
        definition: rviRecipeDefinition,
      })

      const matches = this.loadAllMatches()
      const owners = [...new Set(matches.map((match) => match.puuid))]
      const runId = this.grades.createRebuildRun({
        puuid: owners.length === 1 ? owners[0] : "local-installation",
        recipeId,
        totalMatches: matches.length,
        verifiedBackup: backup,
      })
      if (purgeLegacyAlgorithms) {
        this.grades.purgeDerivedGrades({ algorithmVersion: 1 })
        this.grades.purgeDerivedGrades({ algorithmVersion: 2 })
        // Includes pre-versioned caches that cannot be selected by algorithm.
        this.clearStaleGradeCaches()
      }
      this.grades.purgeDerivedGrades({
        algorithmVersion: GRADE_V3_ALGORITHM_VERSION,
        rebuildRunId: runId,
      })
      this.metrics.purgeObservations({
        algorithmVersion: RVI_V3_ALGORITHM_VERSION,
      })
      this.grades.selectRecipe(recipeId)
      this.metrics.selectRecipe(rviRecipeId)

      let processed = 0
      let ready = 0
      let nonready = 0
      for (const match of matches) {
        const participants = this.loadParticipants(match.gameId, match.puuid)
        const status = this.gradeOne(
          match,
          participants,
          recipeId,
          rviRecipeId,
          calibrationId,
          snapshot,
        )
        if (status === "ready") ready += 1
        else nonready += 1
        processed += 1
        const progress = {
          total: matches.length,
          processed,
          ready,
          nonready,
          errors: 0,
          gameId: match.gameId,
        }
        onProgress?.(progress)
        this.grades.updateRebuildRun(runId, {
          status: "running",
          stage: "recompute",
          processedMatches: processed,
          readyMatches: ready,
          nonreadyMatches: nonready,
          errorMatches: 0,
          lastGameId: match.gameId,
        })
      }

      const written = Number((this.db.prepare(`
        SELECT COUNT(*) AS count FROM match_grade_attempts
        WHERE algorithm_version = ? AND recipe_id = ?
      `).get(GRADE_V3_ALGORITHM_VERSION, recipeId) as { count: number }).count)
      if (written !== matches.length) {
        throw new Error(`grade_rebuild_verification_failed:${written}/${matches.length}`)
      }
      const incompleteMetricInventories = Number((this.db.prepare(`
        SELECT COUNT(*) AS count FROM (
          SELECT attempt.game_id, attempt.puuid, attempt.owner_participant_id
          FROM match_grade_attempts attempt
          JOIN match_participants participant
            ON participant.game_id = attempt.game_id
           AND participant.puuid = attempt.puuid
           AND participant.participant_id = attempt.owner_participant_id
           AND participant.is_player = 1
          LEFT JOIN match_metric_observations observation
            ON observation.game_id = attempt.game_id
           AND observation.puuid = attempt.puuid
           AND observation.participant_id = attempt.owner_participant_id
           AND observation.algorithm_version = 3
           AND observation.recipe_id = ?
          WHERE attempt.algorithm_version = 3 AND attempt.recipe_id = ?
            AND attempt.grade_status = 'ready'
          GROUP BY attempt.game_id, attempt.puuid, attempt.owner_participant_id
          HAVING COUNT(observation.metric_key) <> ?
        )
      `).get(
        rviRecipeId,
        recipeId,
        METRIC_DEFINITIONS_V3.length,
      ) as { count: number }).count)
      if (incompleteMetricInventories !== 0) {
        throw new Error(
          `rvi_rebuild_verification_failed:${incompleteMetricInventories}`,
        )
      }
      this.grades.updateRebuildRun(runId, {
        status: "complete",
        stage: "complete",
        processedMatches: processed,
        readyMatches: ready,
        nonreadyMatches: nonready,
        errorMatches: 0,
        lastGameId: matches.at(-1)?.gameId,
      })
      return {
        recipeId,
        calibrationId,
        runId,
        total: matches.length,
        processed,
        ready,
        nonready,
        errors: 0,
      }
    })
    return rebuild()
  }

  private purgePreV3DerivedState(backup: VerifiedGradeBackup): void {
    if (!backup.path || !/^[a-f0-9]{64}$/.test(backup.sha256)) {
      throw new Error("verified_grade_rebuild_backup_required")
    }
    const selected = this.grades.getSelectedRecipe(GRADE_V3_ALGORITHM_VERSION)
    const keepCurrentV3 = selectedRecipeIsCurrent(selected)
    this.db.transaction(() => {
      this.grades.purgeDerivedGrades({ algorithmVersion: 1 })
      this.grades.purgeDerivedGrades({ algorithmVersion: 2 })
      if (!keepCurrentV3) {
        this.metrics.purgeObservations({ algorithmVersion: 3 })
        this.db.prepare(
          "DELETE FROM rvi_recipe_selections WHERE algorithm_version = 3",
        ).run()
        this.grades.purgeDerivedGrades({ algorithmVersion: 3 })
        this.db.prepare(
          "DELETE FROM grade_recipe_selections WHERE algorithm_version = 3",
        ).run()
      }
      this.clearStaleGradeCaches(keepCurrentV3 ? selected.recipeId : undefined)
    })()
  }

  private clearStaleGradeCaches(currentRecipeId?: string): void {
    const exactCurrent = currentRecipeId
      ? `AND (
          grade_algorithm_version IS NULL OR grade_algorithm_version <> 3 OR
          grade_recipe_id IS NULL OR grade_recipe_id <> ?
        )`
      : ""
    for (const table of ["matches", "match_participants"] as const) {
      this.db.prepare(`
        UPDATE ${table} SET ${CLEAR_GRADE_CACHE_SQL}
        WHERE ${GRADE_CACHE_PRESENT_SQL} ${exactCurrent}
      `).run(...(currentRecipeId ? [currentRecipeId] : []))
    }
  }

  private gradeOne(
    match: StoredMatchRow,
    participants: readonly StoredParticipantRow[],
    recipeId: string,
    rviRecipeId: string,
    calibrationId: string,
    snapshot: GradeCalibrationSnapshotV3,
  ): GradeStatus {
    const resolved = resolvedLobbyPositions(participants, match.modeFamily)
    const ineligible = gradeEligibility(match, participants, resolved)
    const raw = ineligible ? undefined : this.buildRawLobby(match, participants, resolved)
    const detailMetricEvidence = raw
      ? [...(raw.detailMetricObservations ?? new Map())]
        .sort(([left], [right]) => left - right)
        .map(([participantId, rows]) => ({
          participantId,
          rows: [...rows].sort((left, right) => left.metricKey.localeCompare(right.metricKey)),
        }))
      : []
    const inputFingerprint = sha256({
      recipeId,
      match,
      resolvedPositions: [...resolved],
      participants: [...participants].sort((left, right) =>
        left.participantId - right.participantId),
      detailMetricEvidence,
    })
    if (!raw) {
      const status = ineligible ?? "unsupported_mode"
      this.grades.writeCanonicalGrade(match.gameId, match.puuid, {
        algorithmVersion: GRADE_V3_ALGORITHM_VERSION,
        recipeId,
        inputFingerprint,
        status,
        statusReason: status,
        evidenceCoverage: 0,
        referenceSampleCount: snapshot.clusterIds.length,
        referenceMetadata: snapshotReferenceMetadata(snapshot, gradeContext(match)),
        results: new Map(),
      })
      this.replaceMetricObservations(match, rviRecipeId, [])
      return status
    }

    this.persistResolvedPositions(match, participants, resolved)
    const scopeMetadata = snapshotReferenceMetadata(snapshot, raw.context)
    if (!scopeMetadata.scopeFrozen) {
      this.grades.writeCanonicalGrade(match.gameId, match.puuid, {
        algorithmVersion: GRADE_V3_ALGORITHM_VERSION,
        recipeId,
        inputFingerprint,
        status: "calibrating",
        statusReason: "reference_scope_not_frozen",
        evidenceCoverage: 0,
        referenceSampleCount: 0,
        referenceMetadata: scopeMetadata,
        results: new Map(),
      })
      this.writeMetricObservations(match, raw, rviRecipeId, calibrationId, snapshot)
      return "calibrating"
    }
    const prepared = prepareGradeLobbyFromSnapshotV3(raw, snapshot)
    const outcome = scoreLobbyV3({
      players: prepared.players,
      context: raw.context,
      calibrationSnapshotId: calibrationId,
    })
    if (outcome.recipeId && outcome.recipeId !== recipeId) {
      throw new Error("grade_recipe_identity_mismatch")
    }
    if (outcome.status !== "ready") {
      this.grades.writeCanonicalGrade(match.gameId, match.puuid, {
        algorithmVersion: GRADE_V3_ALGORITHM_VERSION,
        recipeId,
        inputFingerprint,
        status: outcome.status,
        statusReason: outcome.reason ?? outcome.status,
        evidenceCoverage: prepared.evidenceCoverage,
        referenceSampleCount: prepared.referenceSampleCount,
        referenceMetadata: prepared.referenceMetadata,
        results: new Map(),
      })
      this.writeMetricObservations(
        match,
        raw,
        rviRecipeId,
        calibrationId,
        snapshot,
        prepared,
      )
      return outcome.status
    }
    const results = new Map([...outcome.results].map(([participantId, result]) => [
      participantId,
      {
        participantId,
        grade: result.grade,
        gradeScore: result.gradeScore,
        roleFitScore: result.roleFitScore,
        lobbyPercentile: result.lobbyPercentile,
        evidenceCoverage: prepared.evidenceCoverage,
        referenceSampleCount: prepared.referenceSampleCount,
        referenceMetadata: prepared.referenceMetadata,
        breakdown: result.breakdown,
      },
    ]))
    this.grades.writeCanonicalGrade(match.gameId, match.puuid, {
      algorithmVersion: GRADE_V3_ALGORITHM_VERSION,
      recipeId,
      inputFingerprint,
      status: "ready",
      evidenceCoverage: prepared.evidenceCoverage,
      referenceSampleCount: prepared.referenceSampleCount,
      referenceMetadata: prepared.referenceMetadata,
      results,
    })
    this.writeMetricObservations(
      match,
      raw,
      rviRecipeId,
      calibrationId,
      snapshot,
      prepared,
    )
    return "ready"
  }

  private replaceMetricObservations(
    match: Pick<StoredMatchRow, "gameId" | "puuid">,
    rviRecipeId: string,
    observations: readonly MatchMetricObservationV3[],
  ): void {
    this.metrics.replaceMatchObservations({
      gameId: match.gameId,
      puuid: match.puuid,
      algorithmVersion: RVI_V3_ALGORITHM_VERSION,
      recipeId: rviRecipeId,
      observations,
    })
  }

  private writeMetricObservations(
    match: StoredMatchRow,
    raw: GradeRawLobbyV3,
    rviRecipeId: string,
    calibrationId: string,
    snapshot: GradeCalibrationSnapshotV3,
    preparedGrade?: ReturnType<typeof prepareGradeLobbyFromSnapshotV3>,
  ): void {
    const calibrated = prepareDetailMetricObservationsFromSnapshotV3(raw, snapshot)
    const gradeByParticipant = new Map(preparedGrade?.players.map((player) => [
      player.participantId,
      player.metricEvidence,
    ]) ?? [])
    const gradeMetricKeys = new Set<string>(GRADE_METRICS)
    const derivedAt = this.now()
    const observations = [...calibrated.entries()].flatMap(([participantId, rows]) =>
      rows.map((row) => {
        const exactGradeEvidence = gradeMetricKeys.has(row.metricKey)
          ? gradeByParticipant.get(participantId)?.[row.metricKey as GradeMetricV3]
          : undefined
        const scoreEvidence = row.rawEvidence.state === "observed" &&
            exactGradeEvidence?.state === "observed"
          ? exactGradeEvidence
          : row.scoreEvidence
        return toMatchMetricObservationV3(row, {
          gameId: match.gameId,
          puuid: match.puuid,
          participantId,
          recipeId: rviRecipeId,
          calibrationId,
          derivationId: row.source === "timeline"
            ? RVI_V3_TIMELINE_DERIVATION_ID
            : RVI_V3_SUMMARY_DERIVATION_ID,
          derivedAt,
        }, scoreEvidence, {
          comparisonScope: row.comparisonScope,
          referenceMatchCount: row.referenceMatchCount,
        })
      }))
    this.replaceMetricObservations(match, rviRecipeId, observations)
  }

  private buildRawLobby(
    match: StoredMatchRow,
    participants: readonly StoredParticipantRow[],
    resolved: ReadonlyMap<number, NormalizedPosition>,
  ): GradeRawLobbyV3 | undefined {
    const lobby = toRawLobby(match, participants, resolved)
    if (!lobby) return undefined
    const timeline = this.loadTimelineEvidence(match, participants)
    const teams = new Map(participants.map((participant) => [
      participant.participantId,
      participant.teamId,
    ]))
    const detailMetricObservations = new Map<number, readonly RawMetricObservationV3[]>(
      lobby.detailMetricObservations ?? [],
    )
    for (const participant of participants) {
      const position = resolved.get(participant.participantId) ?? "UNKNOWN"
      const opposingRole = participants.filter((candidate) =>
        candidate.teamId !== participant.teamId &&
        (resolved.get(candidate.participantId) ?? "UNKNOWN") === position)
      const timelineRows = deriveTimelineMetricObservationsV3({
        participantId: participant.participantId,
        teamId: participant.teamId,
        durationSecs: match.durationSecs,
        context: lobby.context,
        position,
        ...(opposingRole.length === 1
          ? { opponentParticipantId: opposingRole[0].participantId }
          : {}),
        timeline: timeline.timeline,
        participantTeams: teams,
        wardEventsComplete: timeline.wardEventsComplete,
        sourceQuality: timeline.sourceQuality,
      })
      detailMetricObservations.set(participant.participantId, [
        ...(lobby.detailMetricObservations?.get(participant.participantId) ?? []),
        ...timelineRows,
      ])
    }
    return { ...lobby, detailMetricObservations }
  }

  private loadTimelineEvidence(
    match: StoredMatchRow,
    participants: readonly StoredParticipantRow[],
  ): LoadedTimelineEvidenceV3 {
    const cache = this.db.prepare(`
      SELECT status, mapper_version AS mapperVersion, data_json AS dataJson
      FROM match_timeline_cache WHERE game_id = ? AND puuid = ?
    `).get(match.gameId, match.puuid) as {
      status: string
      mapperVersion: number
      dataJson: string | null
    } | undefined
    const selectedSource = selectTimelineSource(this.db.prepare(`
      SELECT source, mapper_version AS mapperVersion, status,
             data_json AS dataJson, captured_at AS capturedAt
      FROM match_timeline_sources
      WHERE game_id = ? AND puuid = ?
    `).all(match.gameId, match.puuid) as TimelineSourceCandidate[])
    const selectedCompact = compactTimelineFromJsonV3(selectedSource?.dataJson ?? null)
    const currentCompact = selectedCompact ?? (
      cache?.status === "ready" && cache.mapperVersion === TIMELINE_MAPPER_VERSION
        ? compactTimelineFromJsonV3(cache.dataJson)
        : undefined
    )
    // Quality and capability claims must describe the bytes actually used,
    // not whichever source row happened to be updated most recently.
    const actualSource = selectedCompact ? selectedSource : undefined
    const sourceQuality: MetricSourceQualityV3 = actualSource?.source === "match_v5"
      ? "verified"
      : actualSource ? "retained" : "legacy"
    if (currentCompact) {
      return {
        timeline: currentCompact,
        sourceQuality,
        wardEventsComplete: actualSource?.source === "match_v5",
      }
    }

    const raw = this.db.prepare(`
      SELECT source, payload, sha256, mapper_version AS mapperVersion
      FROM match_source_payloads
      WHERE owner_puuid = ? AND game_id = ? AND kind = 'timeline'
        AND mapping_status = 'mapped'
      ORDER BY CASE source WHEN 'match_v5' THEN 0 ELSE 1 END,
               fetched_at DESC
      LIMIT 1
    `).get(match.puuid, match.gameId) as {
      source: "league_client" | "match_v5"
      payload: Buffer
      sha256: string
      mapperVersion: number
    } | undefined
    if (raw) {
      try {
        const frames = timelineFramesFromPayloadV3(
          decodeCanonicalJsonV1(raw.payload, raw.sha256),
        )
        const owner = participants.find((participant) => participant.isPlayer === 1)
        if (frames?.length && owner) {
          return {
            timeline: mapTimeline(
              frames,
              owner.participantId,
              new Map(participants.map((participant) => [
                participant.participantId,
                participant.teamId,
              ])),
            ),
            sourceQuality: raw.source === "match_v5" ? "verified" : "retained",
            wardEventsComplete: raw.source === "match_v5",
          }
        }
      } catch {
        // Preserve the existing compact fallback and expose reasoned gaps.
      }
    }

    return {
      timeline: cache?.status === "ready" &&
          cache.mapperVersion === TIMELINE_MAPPER_VERSION
        ? compactTimelineFromJsonV3(cache.dataJson)
        : undefined,
      sourceQuality,
      wardEventsComplete: false,
    }
  }

  private loadSnapshot(calibrationId: string): GradeCalibrationSnapshotV3 {
    const row = this.db.prepare(`
      SELECT snapshot_json AS snapshotJson
      FROM grade_calibration_snapshots WHERE calibration_id = ?
    `).get(calibrationId) as { snapshotJson: string } | undefined
    if (!row) throw new Error("grade_calibration_snapshot_not_found")
    return snapshotFromUnknown(JSON.parse(row.snapshotJson))
  }

  private loadEligibleReferenceLobbies(): GradeRawLobbyV3[] {
    const lobbies: GradeRawLobbyV3[] = []
    const independentMatches = new Set<string>()
    for (const match of this.loadAllMatches()) {
      const clusterId = gradeCalibrationClusterIdV3(match)
      if (independentMatches.has(clusterId)) continue
      const participants = this.loadParticipants(match.gameId, match.puuid)
      const resolved = resolvedLobbyPositions(participants, match.modeFamily)
      if (gradeEligibility(match, participants, resolved)) continue
      const lobby = this.buildRawLobby(match, participants, resolved)
      if (lobby) {
        independentMatches.add(clusterId)
        lobbies.push(lobby)
      }
    }
    return lobbies
  }

  private loadStoredMatch(gameId: number, puuid: string) {
    const match = this.db.prepare(`
      SELECT m.game_id AS gameId, m.puuid, ra.platform_id AS platformId,
             m.riot_match_id AS riotMatchId, m.queue_id AS queueId,
             m.game_mode AS gameMode, m.mode, m.mode_family AS modeFamily,
             m.is_matched AS isMatched, m.duration_secs AS durationSecs,
             m.played_at AS playedAt, m.queue_name AS queueName,
             m.owner_eligible_for_progression AS ownerEligibleForProgression,
             m.duration_quality AS durationQuality,
             m.end_of_game_result AS endOfGameResult,
             m.ended_in_early_surrender AS endedInEarlySurrender
      FROM matches m
      LEFT JOIN riot_accounts ra ON ra.puuid = m.puuid
      WHERE m.game_id = ? AND m.puuid = ?
    `).get(gameId, puuid) as StoredMatchRow | undefined
    return { match, participants: match ? this.loadParticipants(gameId, puuid) : [] }
  }

  private loadAllMatches(): StoredMatchRow[] {
    return this.db.prepare(`
      SELECT m.game_id AS gameId, m.puuid, ra.platform_id AS platformId,
             m.riot_match_id AS riotMatchId, m.queue_id AS queueId,
             m.game_mode AS gameMode, m.mode, m.mode_family AS modeFamily,
             m.is_matched AS isMatched, m.duration_secs AS durationSecs,
             m.played_at AS playedAt, m.queue_name AS queueName,
             m.owner_eligible_for_progression AS ownerEligibleForProgression,
             m.duration_quality AS durationQuality,
             m.end_of_game_result AS endOfGameResult,
             m.ended_in_early_surrender AS endedInEarlySurrender
      FROM matches m
      LEFT JOIN riot_accounts ra ON ra.puuid = m.puuid
      ORDER BY m.played_at, m.game_id, m.puuid
    `).all() as StoredMatchRow[]
  }

  private loadParticipants(gameId: number, puuid: string): StoredParticipantRow[] {
    return this.db.prepare(`
      SELECT participant_id AS participantId, team_id AS teamId,
             is_player AS isPlayer, champion_id AS championId,
             spell1_id AS spell1Id, spell2_id AS spell2Id,
             kills, deaths, assists, damage_to_champions AS damageToChampions,
             damage_taken AS damageTaken,
             damage_self_mitigated AS damageSelfMitigated,
             gold_earned AS goldEarned,
             total_minions_killed AS totalMinionsKilled,
             neutral_minions AS neutralMinions,
             damage_objectives AS damageObjectives,
             damage_turrets AS damageTurrets,
             time_ccing_others AS timeCcingOthers,
             vision_score AS visionScore,
             wards_placed AS wardsPlaced, wards_killed AS wardsKilled,
             eligible_for_progression AS eligibleForProgression,
             control_wards_purchased AS controlWardsPurchased,
             detector_wards_placed AS detectorWardsPlaced,
             total_heals_on_teammates AS totalHealsOnTeammates,
             total_damage_shielded_on_teammates AS totalDamageShieldedOnTeammates,
             damage_dealt_to_buildings AS damageDealtToBuildings,
             assigned_position AS assignedPosition,
             lcu_lane AS lcuLane, lcu_role AS lcuRole,
             lane AS legacyLane, role AS legacyRole,
             match_v5_team_position AS matchV5TeamPosition,
             match_v5_individual_position AS matchV5IndividualPosition,
             resolved_position AS resolvedPosition,
             position_resolver_version AS positionResolverVersion,
             extended_metrics_json AS extendedMetricsJson,
             grade_core_complete AS gradeCoreComplete,
             grade_core_source AS gradeCoreSource,
             grade_core_missing_fields_json AS gradeCoreMissingFieldsJson,
             grade_core_contract_version AS gradeCoreContractVersion
      FROM match_participants
      WHERE game_id = ? AND puuid = ?
      ORDER BY participant_id
    `).all(gameId, puuid) as StoredParticipantRow[]
  }

  private persistResolvedPositions(
    match: StoredMatchRow,
    participants: readonly StoredParticipantRow[],
    resolved: ReadonlyMap<number, NormalizedPosition>,
  ): void {
    const update = this.db.prepare(`
      UPDATE match_participants
      SET resolved_position = ?, position_resolver_version = ?
      WHERE game_id = ? AND puuid = ? AND participant_id = ?
    `)
    for (const participant of participants) {
      update.run(
        resolved.get(participant.participantId) ?? "UNKNOWN",
        POSITION_RESOLVER_VERSION,
        match.gameId,
        match.puuid,
        participant.participantId,
      )
    }
    const owner = participants.find((participant) => participant.isPlayer === 1)
    if (owner) {
      this.db.prepare(`
        UPDATE matches SET resolved_position = ?, position_resolver_version = ?
        WHERE game_id = ? AND puuid = ?
      `).run(resolved.get(owner.participantId) ?? "UNKNOWN", POSITION_RESOLVER_VERSION,
        match.gameId, match.puuid)
    }
  }
}
