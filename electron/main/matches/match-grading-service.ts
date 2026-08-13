import { createHash } from "node:crypto"
import type { Database } from "better-sqlite3"
import {
  GradePersistenceRepository,
  type MatchGradeStatus,
} from "../database/grade-persistence-repo.js"
import { MetricObservationsRepository } from "../database/metric-observations-repo.js"
import {
  getCompatibleGradeRecipeSelection,
  getCompatibleRviRecipeSelection,
} from "../database/grade-recipe-selection.js"
import {
  canonicalJson,
  decodeCanonicalJsonV1,
} from "../database/match-source-repo.js"
import { TimelineRepository } from "../database/timeline-repo.js"
import {
  decodeStoredJsonBody,
  type StoredJsonBodyRow,
} from "../database/json-body-codec.js"
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
  CANONICAL_GRADE_STORAGE_PARTITION,
  CURRENT_GRADE_RECIPE,
  scoreMatchLobby,
} from "./match-grade.js"
import {
  MATCH_GRADE_CALIBRATION_FORMAT_VERSION,
  MATCH_GRADE_MINIMUM_REFERENCE_MATCHES,
  MATCH_GRADE_MINIMUM_SCOPE_MATCHES,
  buildGradeCalibrationSnapshot,
  gradeCalibrationClusterId,
  prepareDetailMetricObservationsFromSnapshot,
  prepareGradeLobbyFromSnapshot,
  summarizeGradeCalibrationScopes,
  type GradeCalibrationSnapshot,
  type GradeRawLobby,
  type GradeRawParticipant,
} from "./match-grade-observations.js"
import {
  recipeIdForCalibration,
  type GradeRecipeIdentityKind,
} from "./match-grade-recipe.js"
import {
  calibrationScopeKey,
  defaultRulesetForModeFamily,
  type MatchGradeModeContext,
} from "./match-grade-taxonomy.js"
import {
  normalizePosition,
  normalizeTeamPositions,
  POSITION_RESOLVER_VERSION,
  POSITIONS,
  type NormalizedPosition,
} from "./position.js"
import type { ModeFamily, TrackedMode } from "./types.js"
import {
  deriveSummaryMetricObservations,
  type SummaryMetricParticipant,
} from "./rvi-summary.js"
import {
  toMatchMetricObservation,
  type MatchMetricObservation,
  type MetricSourceQuality,
  type RawMetricObservation,
} from "./match-metric-observations.js"
import { RVI_SUMMARY_DERIVATION_ID } from "./rvi-summary.js"
import {
  CANONICAL_RVI_STORAGE_PARTITION,
  rviRecipeDefinition,
} from "./rvi-recipe.js"
import { MATCH_GRADE_METRIC_KEYS, type MatchGradeMetricKey } from "./match-grade-recipe.js"
import {
  mapTimeline,
  type CompactTimeline,
} from "../riot/timeline-mapper.js"
import {
  deriveTimelineMetricObservations,
  RVI_TIMELINE_DERIVATION_ID,
} from "./rvi-timeline.js"
import { METRIC_DEFINITIONS } from "./match-metric-registry.js"

export const MATCH_GRADE_MINIMUM_SNAPSHOT_MATCHES = MATCH_GRADE_MINIMUM_SCOPE_MATCHES
export const MATCH_GRADE_MODE_REFERENCE_LIMIT = 100

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

interface StoredParticipantWithMatch extends StoredParticipantRow {
  gameId: number
  ownerPuuid: string
}

export interface PerformanceReferenceStatus {
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
  modeReferences: PerformanceModeReferenceStatus[]
}

export interface PerformanceModeReferenceStatus {
  mode: string
  state: "building" | "frozen"
  readyToFreeze: boolean
  eligibleMatches: number
  requiredMatches: number
  referenceMatches?: number
  frozenAt?: number
  newMatches: number
}

export interface PerformanceReferenceRebuildProgress {
  total: number
  processed: number
  ready: number
  nonready: number
  errors: number
  gameId?: number
}

export interface PerformanceReferenceRebuildResult extends PerformanceReferenceRebuildProgress {
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

function gradeContext(match: StoredMatchRow): MatchGradeModeContext | undefined {
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
): Exclude<MatchGradeStatus, "ready"> | undefined {
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
): GradeRawLobby | undefined {
  const context = gradeContext(match)
  if (!context) return undefined
  const players: GradeRawParticipant[] = participants.map((participant) => {
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
  const summaryPlayers: SummaryMetricParticipant[] = players.map((player) => ({
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
  const sourceQuality = (participant: StoredParticipantRow): MetricSourceQuality => {
    if (participant.gradeCoreSource === "match_v5" ||
        participant.gradeCoreSource === "league_client") return "verified"
    if (participant.gradeCoreSource === "legacy_full_detail") return "retained"
    return "legacy"
  }
  const detailMetricObservations = new Map(participants.map((participant) => [
    participant.participantId,
    deriveSummaryMetricObservations({
      participantId: participant.participantId,
      durationSecs: match.durationSecs,
      context,
      participants: summaryPlayers,
      sourceQuality: sourceQuality(participant),
    }),
  ]))
  return {
    clusterId: gradeCalibrationClusterId(match),
    matchId: match.gameId,
    playedAt: match.playedAt,
    puuid: match.puuid,
    durationSecs: match.durationSecs,
    context,
    players,
    detailMetricObservations,
  }
}

function timelineFramesFromPayload(value: unknown): RawTimelineFrames | undefined {
  if (Array.isArray(value)) return value as RawTimelineFrames
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
  return frames as RawTimelineFrames | undefined
}

function compactTimelineFromJson(value: string | null): CompactTimeline | undefined {
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

type RawTimelineFrames = Parameters<typeof mapTimeline>[0]

interface LoadedTimelineEvidence {
  timeline?: CompactTimeline
  sourceQuality: MetricSourceQuality
  wardEventsComplete: boolean
}

interface ModeCalibrationEpoch {
  /** Games completed before this instant retain the preceding epoch. */
  effectiveFrom: number
  frozenAt: number
  eligibleMatchesAtFreeze: number
  snapshot: GradeCalibrationSnapshot
}

interface VersionedGradeCalibrationSnapshot extends GradeCalibrationSnapshot {
  modeEpochs?: Record<string, ModeCalibrationEpoch[]>
  recentMatchLimit?: number
}

function snapshotFromUnknown(value: unknown): VersionedGradeCalibrationSnapshot {
  if (!value || typeof value !== "object" ||
      (value as GradeCalibrationSnapshot).formatVersion !==
        MATCH_GRADE_CALIBRATION_FORMAT_VERSION) {
    throw new Error("grade_calibration_snapshot_invalid")
  }
  const snapshot = value as VersionedGradeCalibrationSnapshot
  if (!Array.isArray(snapshot.referencePopulation?.supportedModes) ||
      !Array.isArray(snapshot.referencePopulation?.supportedScopes) ||
      snapshot.referencePopulation.clusterIdentity !==
        CURRENT_GRADE_RECIPE.calibration.clusterIdentity ||
      !Array.isArray(snapshot.clusterIds) ||
      !snapshot.referencePopulation.scopeMatchCounts ||
       typeof snapshot.referencePopulation.scopeMatchCounts !== "object" ||
       !snapshot.observations || typeof snapshot.observations !== "object" ||
       !snapshot.detailObservations || typeof snapshot.detailObservations !== "object" ||
       !Array.isArray(snapshot.compositeObservations)) {
    throw new Error("grade_calibration_snapshot_invalid")
  }
  if (snapshot.modeEpochs !== undefined) {
    if (!snapshot.modeEpochs || typeof snapshot.modeEpochs !== "object" ||
        Array.isArray(snapshot.modeEpochs)) {
      throw new Error("grade_calibration_snapshot_invalid")
    }
    for (const [mode, epochs] of Object.entries(snapshot.modeEpochs)) {
      if (!mode || !Array.isArray(epochs) || epochs.length === 0) {
        throw new Error("grade_calibration_snapshot_invalid")
      }
      let previousEffectiveFrom = Number.NEGATIVE_INFINITY
      for (const epoch of epochs) {
        if (!epoch.snapshot || typeof epoch.snapshot !== "object" ||
            !Number.isFinite(epoch.effectiveFrom) || !Number.isFinite(epoch.frozenAt) ||
            !Number.isSafeInteger(epoch.eligibleMatchesAtFreeze) ||
            epoch.effectiveFrom < previousEffectiveFrom) {
          throw new Error("grade_calibration_snapshot_invalid")
        }
        const epochSnapshot = snapshotFromUnknown(epoch.snapshot)
        if (epoch.eligibleMatchesAtFreeze < epochSnapshot.clusterIds.length ||
            epochSnapshot.modeEpochs !== undefined ||
            epochSnapshot.referencePopulation.supportedModes.length !== 1 ||
            epochSnapshot.referencePopulation.supportedModes[0] !== mode) {
          throw new Error("grade_calibration_snapshot_invalid")
        }
        previousEffectiveFrom = epoch.effectiveFrom
      }
    }
  }
  return snapshot
}

function calibrationScopeStatus(lobbies: readonly GradeRawLobby[]) {
  const summaries = summarizeGradeCalibrationScopes(lobbies)
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

function snapshotForMode(
  snapshot: GradeCalibrationSnapshot,
  mode: string,
): GradeCalibrationSnapshot {
  const observations = Object.fromEntries(MATCH_GRADE_METRIC_KEYS.map((metric) => [
    metric,
    snapshot.observations[metric].filter((row) => row.trackedMode === mode),
  ])) as GradeCalibrationSnapshot["observations"]
  const detailObservations = Object.fromEntries(Object.entries(snapshot.detailObservations)
    .map(([metric, rows]) => [metric, rows.filter((row) => row.trackedMode === mode)]))
  const compositeObservations = snapshot.compositeObservations
    .filter((row) => row.trackedMode === mode)
  const clusterIds = new Set<string>()
  for (const rows of Object.values(observations)) {
    for (const row of rows) clusterIds.add(row.clusterId)
  }
  for (const rows of Object.values(detailObservations)) {
    for (const row of rows) clusterIds.add(row.clusterId)
  }
  for (const row of compositeObservations) clusterIds.add(row.clusterId)
  const supportedScopes = snapshot.referencePopulation.supportedScopes
    .filter((scope) => scope.startsWith(`${mode}:`))
  return {
    formatVersion: MATCH_GRADE_CALIBRATION_FORMAT_VERSION,
    referencePopulation: {
      kind: "local_recall_installation",
      clusterUnit: "match",
      clusterIdentity: CURRENT_GRADE_RECIPE.calibration.clusterIdentity,
      frozen: true,
      supportedModes: [mode],
      supportedScopes,
      scopeMatchCounts: Object.fromEntries(supportedScopes.map((scope) => [
        scope,
        snapshot.referencePopulation.scopeMatchCounts[scope] ?? 0,
      ])),
    },
    clusterIds: [...clusterIds].sort(),
    observations,
    detailObservations,
    compositeObservations,
  }
}

function epochsFromSnapshot(
  snapshot: VersionedGradeCalibrationSnapshot,
  frozenAt: number,
): Record<string, ModeCalibrationEpoch[]> {
  if (snapshot.modeEpochs) {
    return Object.fromEntries(Object.entries(snapshot.modeEpochs).map(([mode, epochs]) => [
      mode,
      epochs.map((epoch) => ({
        effectiveFrom: epoch.effectiveFrom,
        frozenAt: epoch.frozenAt,
        eligibleMatchesAtFreeze: epoch.eligibleMatchesAtFreeze,
        snapshot: epoch.snapshot,
      })),
    ]))
  }
  return Object.fromEntries(snapshot.referencePopulation.supportedModes.map((mode) => [
    mode,
    [{
      effectiveFrom: 0,
      frozenAt,
      eligibleMatchesAtFreeze: snapshotForMode(snapshot, mode).clusterIds.length,
      snapshot: snapshotForMode(snapshot, mode),
    }],
  ]))
}

function combineModeEpochs(
  modeEpochs: Readonly<Record<string, readonly ModeCalibrationEpoch[]>>,
): VersionedGradeCalibrationSnapshot {
  const latest = Object.entries(modeEpochs)
    .filter(([, epochs]) => epochs.length > 0)
    .map(([mode, epochs]) => [mode, epochs.at(-1)!.snapshot] as const)
    .sort(([left], [right]) => left.localeCompare(right))
  const observations = Object.fromEntries(MATCH_GRADE_METRIC_KEYS.map((metric) => [
    metric,
    latest.flatMap(([, snapshot]) => snapshot.observations[metric]),
  ])) as GradeCalibrationSnapshot["observations"]
  const detailKeys = [...new Set(latest.flatMap(([, snapshot]) =>
    Object.keys(snapshot.detailObservations)))].sort()
  const detailObservations = Object.fromEntries(detailKeys.map((metric) => [
    metric,
    latest.flatMap(([, snapshot]) => snapshot.detailObservations[metric] ?? []),
  ]))
  const supportedScopes = latest.flatMap(([, snapshot]) =>
    snapshot.referencePopulation.supportedScopes).sort()
  return {
    formatVersion: MATCH_GRADE_CALIBRATION_FORMAT_VERSION,
    referencePopulation: {
      kind: "local_recall_installation",
      clusterUnit: "match",
      clusterIdentity: CURRENT_GRADE_RECIPE.calibration.clusterIdentity,
      frozen: true,
      supportedModes: latest.map(([mode]) => mode),
      supportedScopes,
      scopeMatchCounts: Object.fromEntries(latest.flatMap(([, snapshot]) =>
        Object.entries(snapshot.referencePopulation.scopeMatchCounts))),
    },
    clusterIds: [...new Set(latest.flatMap(([, snapshot]) => snapshot.clusterIds))].sort(),
    observations,
    detailObservations,
    compositeObservations: latest.flatMap(([, snapshot]) =>
      snapshot.compositeObservations),
    modeEpochs: Object.fromEntries(Object.entries(modeEpochs)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([mode, epochs]) => [mode, epochs.map((epoch) => ({
        effectiveFrom: epoch.effectiveFrom,
        frozenAt: epoch.frozenAt,
        eligibleMatchesAtFreeze: epoch.eligibleMatchesAtFreeze,
        snapshot: epoch.snapshot,
      }))])),
    recentMatchLimit: MATCH_GRADE_MODE_REFERENCE_LIMIT,
  }
}

function epochForMatch(
  snapshot: VersionedGradeCalibrationSnapshot,
  mode: string,
  playedAt: number,
): ModeCalibrationEpoch | undefined {
  const epochs = snapshot.modeEpochs?.[mode]
  if (!epochs?.length) {
    return snapshot.referencePopulation.supportedModes.includes(mode)
      ? {
        effectiveFrom: 0,
        frozenAt: 0,
        eligibleMatchesAtFreeze: snapshotForMode(snapshot, mode).clusterIds.length,
        snapshot: snapshotForMode(snapshot, mode),
      }
      : undefined
  }
  return [...epochs].reverse().find((epoch) => epoch.effectiveFrom <= playedAt) ?? epochs[0]
}

/** Pure selection rule shared with calibration contract tests. */
export function selectRecentModeReferenceLobbies(
  lobbies: readonly GradeRawLobby[],
  mode: string,
): GradeRawLobby[] {
  return lobbies.filter((lobby) => lobby.context.trackedMode === mode)
    .sort((left, right) =>
      (right.playedAt ?? right.matchId) - (left.playedAt ?? left.matchId) ||
      right.matchId - left.matchId || right.clusterId.localeCompare(left.clusterId))
    .slice(0, MATCH_GRADE_MODE_REFERENCE_LIMIT)
}

function modeReferenceStatuses(
  lobbies: readonly GradeRawLobby[],
  snapshot?: VersionedGradeCalibrationSnapshot,
  legacyFrozenAt = 0,
  readyModes: ReadonlySet<string> = new Set(),
): PerformanceModeReferenceStatus[] {
  const eligible = new Map<string, number>()
  for (const lobby of lobbies) {
    eligible.set(lobby.context.trackedMode, (eligible.get(lobby.context.trackedMode) ?? 0) + 1)
  }
  const modes = new Set([...eligible.keys(), ...Object.keys(snapshot?.modeEpochs ?? {}),
    ...(snapshot?.referencePopulation.supportedModes ?? [])])
  const allEpochs = snapshot ? epochsFromSnapshot(snapshot, legacyFrozenAt) : {}
  return [...modes].sort().map((mode) => {
    const epochs = allEpochs[mode]
    const latest = epochs?.at(-1)
    const eligibleMatches = eligible.get(mode) ?? 0
    return latest ? {
      mode,
      state: "frozen" as const,
      readyToFreeze: false,
      eligibleMatches,
      requiredMatches: MATCH_GRADE_MINIMUM_SCOPE_MATCHES,
      referenceMatches: latest.snapshot.clusterIds.length,
      frozenAt: latest.frozenAt,
      newMatches: Math.max(0, eligibleMatches - latest.eligibleMatchesAtFreeze),
    } : {
      mode,
      state: "building" as const,
      readyToFreeze: readyModes.has(mode),
      eligibleMatches,
      requiredMatches: MATCH_GRADE_MINIMUM_SCOPE_MATCHES,
      newMatches: eligibleMatches,
    }
  })
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
  snapshot: GradeCalibrationSnapshot,
  context?: MatchGradeModeContext,
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
    minimumReferenceMatches: MATCH_GRADE_MINIMUM_REFERENCE_MATCHES,
  }
}

/**
 * One authoritative Grade/RVI coordinator for startup, sync, import,
 * review, and explicit recalibration. Each mode keeps immutable baseline
 * epochs so a recalibration never changes the comparison used by older games.
 */
export class MatchGradingService {
  private readonly grades: GradePersistenceRepository
  private readonly metrics: MetricObservationsRepository

  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {
    this.grades = new GradePersistenceRepository(db, now)
    this.metrics = new MetricObservationsRepository(db, now)
  }

  referenceStatus(): PerformanceReferenceStatus {
    const selected = getCompatibleGradeRecipeSelection(this.db)
    const eligibleLobbies = this.loadEligibleReferenceLobbies()
    const liveScopes = calibrationScopeStatus(eligibleLobbies)
    if (!selected) {
      return {
        state: "calibrating",
        requiredMatches: MATCH_GRADE_MINIMUM_SNAPSHOT_MATCHES,
        ...liveScopes,
        modeReferences: modeReferenceStatuses(
          eligibleLobbies,
          undefined,
          0,
          new Set(liveScopes.supportedModes),
        ),
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
      requiredMatches: MATCH_GRADE_MINIMUM_SNAPSHOT_MATCHES,
      ...liveScopes,
      supportedScopes: [...snapshot.referencePopulation.supportedScopes],
      supportedModes: [...snapshot.referencePopulation.supportedModes],
      recipeId: selected.publicRecipeId,
      calibrationId: selected.publicCalibrationId,
      frozenAt: row.createdAt,
      referenceMatches: row.sampleCount,
      modeReferences: modeReferenceStatuses(
        eligibleLobbies,
        snapshot,
        row.createdAt,
        new Set(liveScopes.supportedModes),
      ),
    }
  }

  /** Read-only probe used to decide whether startup must create a backup. */
  hasRecoverableRawReferenceData(): boolean {
    return hasRecoverableGradeCoreFactsFromRawPayloads(this.db)
  }

  /**
   * True when a stale cache or derived artifact could still be read as current data.
   * This is checked before any renderer IPC is registered so an upgrade never
   * exposes a legacy grade while the local reference is still calibrating.
   */
  needsDirectCutover(): boolean {
    const rawSelected = this.grades.getSelectedRecipe(CANONICAL_GRADE_STORAGE_PARTITION)
    const selected = getCompatibleGradeRecipeSelection(this.db)
    const hasCurrentRecipe = Boolean(selected)
    const selectedRvi = selected
      ? getCompatibleRviRecipeSelection(this.db, selected)
      : undefined
    const staleRviSelection = hasCurrentRecipe && (
      !selectedRvi
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
          WHERE attempt.algorithm_version = ${CANONICAL_GRADE_STORAGE_PARTITION}
            AND attempt.recipe_id = ?
            AND attempt.grade_status = 'ready'
            AND (
              SELECT COUNT(*) FROM match_metric_observation_details observation
              WHERE observation.game_id = attempt.game_id
                AND observation.puuid = attempt.puuid
                AND observation.participant_id = attempt.owner_participant_id
                AND observation.algorithm_version = ${CANONICAL_RVI_STORAGE_PARTITION}
                AND observation.recipe_id = ?
            ) <> ?
        ) AS present
      `).get(
        selected!.recipeId,
        selectedRvi!.recipeId,
        METRIC_DEFINITIONS.length,
      ) as { present: number }).present) === 1
    const staleSelection = Boolean(rawSelected) && !hasCurrentRecipe
    const staleArtifact = (table: string) => Number((this.db.prepare(`
      SELECT EXISTS(
        SELECT 1 FROM ${table}
        WHERE algorithm_version IN (1, 2)
           ${hasCurrentRecipe
             ? ""
             : `OR algorithm_version = ${CANONICAL_GRADE_STORAGE_PARTITION}`}
      ) AS present
    `).get() as { present: number }).present) === 1
    const staleCache = (table: string) => Number((this.db.prepare(`
      SELECT EXISTS(
        SELECT 1 FROM ${table}
        WHERE ${GRADE_CACHE_PRESENT_SQL}
          ${hasCurrentRecipe ? `AND (
            grade_algorithm_version IS NULL OR
            grade_algorithm_version <> ${CANONICAL_GRADE_STORAGE_PARTITION} OR
            grade_recipe_id IS NULL OR grade_recipe_id <> ?
          )` : ""}
       ) AS present
    `).get(...(hasCurrentRecipe ? [selected!.recipeId] : [])) as { present: number }).present) === 1

    return staleSelection || staleRviSelection || missingMetricInventory || [
      "match_grade_attempts",
      "match_grade_results",
      "match_grade_breakdown_versions",
      "match_grade_breakdowns",
    ].some(staleArtifact) || ["matches", "match_participants"].some(staleCache)
  }

  /** Grades a newly stored match without changing the active reference. */
  gradeStoredMatch(gameId: number, puuid: string): MatchGradeStatus | "calibrating" {
    const selected = getCompatibleGradeRecipeSelection(this.db)
    if (!selected) return "calibrating"
    const selectedRvi = getCompatibleRviRecipeSelection(this.db, selected)
    if (!selectedRvi) return "calibrating"
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
      selected.identity,
    ))()
  }

  /**
   * Regrades atomically after retained source evidence (most commonly a
   * timeline) becomes available. The calibration reference stays frozen, but
   * its metric inventory, arm composite, and Recall Score result advance together.
   */
  refreshMetricObservations(
    gameId: number,
    puuid: string,
  ): MatchGradeStatus | "calibrating" {
    const selected = getCompatibleGradeRecipeSelection(this.db)
    if (!selected) return "calibrating"
    const selectedRvi = getCompatibleRviRecipeSelection(this.db, selected)
    if (!selectedRvi) return "calibrating"
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
      selected.identity,
    ))()
  }

  /**
   * Freezes the first eligible local reference and performs the direct
   * canonical cutover. Later modes freeze automatically when ready.
   */
  ensureFrozenReference(
    backup: VerifiedGradeBackup,
    onProgress?: (progress: PerformanceReferenceRebuildProgress) => void,
  ): PerformanceReferenceRebuildResult | PerformanceReferenceStatus {
    backfillGradeCoreFactsFromRawPayloads(this.db)
    let status = this.referenceStatus()
    const needsDirectCutover = this.needsDirectCutover()
    if (needsDirectCutover && status.supportedScopes.length > 0) {
      // A missing/stale linked RVI inventory does not authorize recalibrating
      // an otherwise valid frozen Grade reference. Reuse its epochs verbatim.
      return this.rebuildReference(
        backup,
        onProgress,
        true,
        !getCompatibleGradeRecipeSelection(this.db),
      )
    }
    if (needsDirectCutover) {
      this.purgePreDerivedState(backup)
      status = this.referenceStatus()
    }
    if (status.state === "frozen") {
      return this.needsAutomaticReferenceUpdate(status)
        ? this.rebuildReference(backup, onProgress, false, false)
        : status
    }
    if (status.supportedScopes.length === 0) return status
    return this.rebuildReference(backup, onProgress, true)
  }

  /** True when an exact mode has reached its first automatic freeze threshold. */
  needsAutomaticReferenceUpdate(
    status: PerformanceReferenceStatus = this.referenceStatus(),
  ): boolean {
    if (status.state !== "frozen") return status.supportedScopes.length > 0
    return status.modeReferences.some((reference) =>
      reference.state === "building" && reference.readyToFreeze)
  }

  /**
   * Explicit user action: append one immutable epoch per eligible mode using
   * its most recent games. Rewriting derived rows keeps older matches on their
   * original epoch and activates the new epochs only for future matches.
   */
  rebuildReference(
    backup: VerifiedGradeBackup,
    onProgress?: (progress: PerformanceReferenceRebuildProgress) => void,
    purgeLegacyAlgorithms = false,
    recalibrateExistingModes = true,
  ): PerformanceReferenceRebuildResult {
    if (!backup.path || !/^[a-f0-9]{64}$/.test(backup.sha256)) {
      throw new Error("verified_grade_rebuild_backup_required")
    }
    backfillGradeCoreFactsFromRawPayloads(this.db)
    const referenceLobbies = this.loadEligibleReferenceLobbies()
    const liveScopes = calibrationScopeStatus(referenceLobbies)
    const previousRecipe = getCompatibleGradeRecipeSelection(this.db)
    const previousSnapshot = previousRecipe
      ? this.loadSnapshot(previousRecipe.calibrationId)
      : undefined
    const previousFrozenAt = previousRecipe
      ? (this.db.prepare(`
          SELECT created_at AS createdAt FROM grade_calibration_snapshots
          WHERE calibration_id = ?
        `).get(previousRecipe.calibrationId) as { createdAt: number } | undefined)?.createdAt ?? 0
      : 0
    const modeEpochs = previousSnapshot
      ? epochsFromSnapshot(previousSnapshot, previousFrozenAt)
      : {}
    const frozenAt = this.now()
    for (const mode of liveScopes.supportedModes) {
      const existing = modeEpochs[mode]
      if (existing?.length && !recalibrateExistingModes) continue
      const allModeLobbies = referenceLobbies
        .filter((lobby) => lobby.context.trackedMode === mode)
      const newestModeMatch = Math.max(0, ...allModeLobbies.map((lobby) =>
        lobby.playedAt ?? 0))
      const nextEffectiveFrom = Math.max(frozenAt, newestModeMatch + 1)
      const modeSnapshot = buildGradeCalibrationSnapshot(
        selectRecentModeReferenceLobbies(referenceLobbies, mode),
      )
      if (!modeSnapshot.referencePopulation.supportedModes.includes(mode)) continue
      modeEpochs[mode] = [
        ...(existing ?? []),
        {
          effectiveFrom: existing?.length ? nextEffectiveFrom : 0,
          frozenAt,
          eligibleMatchesAtFreeze: allModeLobbies.length,
          snapshot: modeSnapshot,
        },
      ]
    }
    const snapshot = combineModeEpochs(modeEpochs)
    if (snapshot.referencePopulation.supportedScopes.length === 0) {
      throw new Error("grade_reference_population_too_small")
    }
    const calibrationHash = sha256(snapshot)
    // A historical row may already own this hash under its opaque old id.
    // Reuse that row rather than violating the immutable UNIQUE(hash) contract.
    const existingCalibration = this.db.prepare(`
      SELECT calibration_id AS calibrationId
      FROM grade_calibration_snapshots WHERE calibration_hash = ?
    `).get(calibrationHash) as { calibrationId: string } | undefined
    const calibrationId = existingCalibration?.calibrationId ??
      `recall.grade.calibration.${calibrationHash}`
    const recipeId = recipeIdForCalibration(calibrationId)
    const recipeDefinition = {
      ...CURRENT_GRADE_RECIPE,
      calibrationId,
      calibrationHash,
      referencePopulation: snapshot.referencePopulation,
    }
    const recipeHash = sha256(recipeDefinition)
    const nextRviRecipe = rviRecipeDefinition(recipeId, calibrationId)
    const rviRecipeId = nextRviRecipe.recipeId
    const rviRecipeHash = sha256(nextRviRecipe)
    const rebuild = this.db.transaction((): PerformanceReferenceRebuildResult => {
      this.grades.registerCalibration({
        calibrationId,
        calibrationHash,
        referencePopulation: snapshot.referencePopulation,
        sampleCount: snapshot.clusterIds.length,
        snapshot,
      })
      this.grades.registerRecipe({
        recipeId,
        algorithmVersion: CANONICAL_GRADE_STORAGE_PARTITION,
        recipeHash,
        calibrationId,
        definition: recipeDefinition,
      })
      this.metrics.registerRecipe({
        recipeId: rviRecipeId,
        algorithmVersion: CANONICAL_RVI_STORAGE_PARTITION,
        recipeHash: rviRecipeHash,
        gradeRecipeId: recipeId,
        calibrationId,
        definition: nextRviRecipe,
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
        algorithmVersion: CANONICAL_GRADE_STORAGE_PARTITION,
        rebuildRunId: runId,
      })
      this.metrics.purgeObservations({
        algorithmVersion: CANONICAL_RVI_STORAGE_PARTITION,
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
          "canonical",
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
      `).get(CANONICAL_GRADE_STORAGE_PARTITION, recipeId) as { count: number }).count)
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
          LEFT JOIN match_metric_observation_details observation
            ON observation.game_id = attempt.game_id
           AND observation.puuid = attempt.puuid
           AND observation.participant_id = attempt.owner_participant_id
           AND observation.algorithm_version = ${CANONICAL_RVI_STORAGE_PARTITION}
           AND observation.recipe_id = ?
          WHERE attempt.algorithm_version = ${CANONICAL_GRADE_STORAGE_PARTITION}
            AND attempt.recipe_id = ?
            AND attempt.grade_status = 'ready'
          GROUP BY attempt.game_id, attempt.puuid, attempt.owner_participant_id
          HAVING COUNT(observation.metric_key) <> ?
        )
      `).get(
        rviRecipeId,
        recipeId,
        METRIC_DEFINITIONS.length,
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

  private purgePreDerivedState(backup: VerifiedGradeBackup): void {
    if (!backup.path || !/^[a-f0-9]{64}$/.test(backup.sha256)) {
      throw new Error("verified_grade_rebuild_backup_required")
    }
    const selected = getCompatibleGradeRecipeSelection(this.db)
    const keepCurrent = Boolean(selected)
    this.db.transaction(() => {
      this.grades.purgeDerivedGrades({ algorithmVersion: 1 })
      this.grades.purgeDerivedGrades({ algorithmVersion: 2 })
      if (!keepCurrent) {
        this.metrics.purgeObservations({ algorithmVersion: CANONICAL_RVI_STORAGE_PARTITION })
        this.db.prepare(`
          DELETE FROM rvi_recipe_selections
          WHERE algorithm_version = ${CANONICAL_RVI_STORAGE_PARTITION}
        `).run()
        this.grades.purgeDerivedGrades({
          algorithmVersion: CANONICAL_GRADE_STORAGE_PARTITION,
        })
        this.db.prepare(`
          DELETE FROM grade_recipe_selections
          WHERE algorithm_version = ${CANONICAL_GRADE_STORAGE_PARTITION}
        `).run()
      }
      this.clearStaleGradeCaches(keepCurrent ? selected!.recipeId : undefined)
    })()
  }

  private clearStaleGradeCaches(currentRecipeId?: string): void {
    const exactCurrent = currentRecipeId
      ? `AND (
          grade_algorithm_version IS NULL OR
          grade_algorithm_version <> ${CANONICAL_GRADE_STORAGE_PARTITION} OR
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
    snapshot: VersionedGradeCalibrationSnapshot,
    recipeIdentity: GradeRecipeIdentityKind,
  ): MatchGradeStatus {
    const activeEpoch = epochForMatch(snapshot, match.mode, match.playedAt)
    const activeSnapshot = activeEpoch?.snapshot
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
        algorithmVersion: CANONICAL_GRADE_STORAGE_PARTITION,
        recipeId,
        inputFingerprint,
        status,
        statusReason: status,
        evidenceCoverage: 0,
        referenceSampleCount: activeSnapshot?.clusterIds.length ?? 0,
        referenceMetadata: snapshotReferenceMetadata(
          activeSnapshot ?? snapshot,
          gradeContext(match),
        ),
        results: new Map(),
      })
      this.replaceMetricObservations(match, rviRecipeId, [])
      return status
    }

    this.persistResolvedPositions(match, participants, resolved)
    const scopeMetadata = snapshotReferenceMetadata(activeSnapshot ?? snapshot, raw.context)
    if (!activeSnapshot || !scopeMetadata.scopeFrozen) {
      this.grades.writeCanonicalGrade(match.gameId, match.puuid, {
        algorithmVersion: CANONICAL_GRADE_STORAGE_PARTITION,
        recipeId,
        inputFingerprint,
        status: "calibrating",
        statusReason: "reference_scope_not_frozen",
        evidenceCoverage: 0,
        referenceSampleCount: 0,
        referenceMetadata: scopeMetadata,
        results: new Map(),
      })
      this.writeMetricObservations(
        match,
        raw,
        rviRecipeId,
        calibrationId,
        activeSnapshot ?? snapshot,
      )
      return "calibrating"
    }
    const prepared = prepareGradeLobbyFromSnapshot(raw, activeSnapshot)
    const referenceMetadata = {
      ...prepared.referenceMetadata,
      modeBaselineFrozenAt: activeEpoch.frozenAt,
      modeBaselineEffectiveFrom: activeEpoch.effectiveFrom,
      modeReferenceLimit: MATCH_GRADE_MODE_REFERENCE_LIMIT,
    }
    const outcome = scoreMatchLobby({
      players: prepared.players,
      context: raw.context,
      calibrationSnapshotId: calibrationId,
      recipeIdentity,
    })
    if (outcome.recipeId && outcome.recipeId !== recipeId) {
      throw new Error("grade_recipe_identity_mismatch")
    }
    if (outcome.status !== "ready") {
      this.grades.writeCanonicalGrade(match.gameId, match.puuid, {
        algorithmVersion: CANONICAL_GRADE_STORAGE_PARTITION,
        recipeId,
        inputFingerprint,
        status: outcome.status,
        statusReason: outcome.reason ?? outcome.status,
        evidenceCoverage: prepared.evidenceCoverage,
        referenceSampleCount: prepared.referenceSampleCount,
        referenceMetadata,
        results: new Map(),
      })
      this.writeMetricObservations(
        match,
        raw,
        rviRecipeId,
        calibrationId,
        activeSnapshot,
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
        recallScore: result.recallScore,
        lobbyPercentile: result.lobbyPercentile,
        evidenceCoverage: prepared.evidenceCoverage,
        referenceSampleCount: prepared.referenceSampleCount,
        referenceMetadata,
        breakdown: result.breakdown,
      },
    ]))
    this.grades.writeCanonicalGrade(match.gameId, match.puuid, {
      algorithmVersion: CANONICAL_GRADE_STORAGE_PARTITION,
      recipeId,
      inputFingerprint,
      status: "ready",
      evidenceCoverage: prepared.evidenceCoverage,
      referenceSampleCount: prepared.referenceSampleCount,
      referenceMetadata,
      results,
    })
    this.writeMetricObservations(
      match,
      raw,
      rviRecipeId,
      calibrationId,
      activeSnapshot,
      prepared,
    )
    return "ready"
  }

  private replaceMetricObservations(
    match: Pick<StoredMatchRow, "gameId" | "puuid">,
    rviRecipeId: string,
    observations: readonly MatchMetricObservation[],
  ): void {
    this.metrics.replaceMatchObservations({
      gameId: match.gameId,
      puuid: match.puuid,
      algorithmVersion: CANONICAL_RVI_STORAGE_PARTITION,
      recipeId: rviRecipeId,
      observations,
    })
  }

  private writeMetricObservations(
    match: StoredMatchRow,
    raw: GradeRawLobby,
    rviRecipeId: string,
    calibrationId: string,
    snapshot: GradeCalibrationSnapshot,
    preparedGrade?: ReturnType<typeof prepareGradeLobbyFromSnapshot>,
  ): void {
    const calibrated = prepareDetailMetricObservationsFromSnapshot(raw, snapshot)
    const gradeByParticipant = new Map(preparedGrade?.players.map((player) => [
      player.participantId,
      player.metricEvidence,
    ]) ?? [])
    const gradeMetricKeys = new Set<string>(MATCH_GRADE_METRIC_KEYS)
    const derivedAt = this.now()
    const observations = [...calibrated.entries()].flatMap(([participantId, rows]) =>
      rows.map((row) => {
        const exactGradeEvidence = gradeMetricKeys.has(row.metricKey)
          ? gradeByParticipant.get(participantId)?.[row.metricKey as MatchGradeMetricKey]
          : undefined
        const scoreEvidence = row.rawEvidence.state === "observed" &&
            exactGradeEvidence?.state === "observed"
          ? exactGradeEvidence
          : row.scoreEvidence
        return toMatchMetricObservation(row, {
          gameId: match.gameId,
          puuid: match.puuid,
          participantId,
          recipeId: rviRecipeId,
          calibrationId,
          derivationId: row.source === "timeline"
            ? RVI_TIMELINE_DERIVATION_ID
            : RVI_SUMMARY_DERIVATION_ID,
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
  ): GradeRawLobby | undefined {
    const lobby = toRawLobby(match, participants, resolved)
    if (!lobby) return undefined
    const timeline = this.loadTimelineEvidence(match, participants)
    const teams = new Map(participants.map((participant) => [
      participant.participantId,
      participant.teamId,
    ]))
    const detailMetricObservations = new Map<number, readonly RawMetricObservation[]>(
      lobby.detailMetricObservations ?? [],
    )
    for (const participant of participants) {
      const position = resolved.get(participant.participantId) ?? "UNKNOWN"
      const opposingRole = participants.filter((candidate) =>
        candidate.teamId !== participant.teamId &&
        (resolved.get(candidate.participantId) ?? "UNKNOWN") === position)
      const timelineRows = deriveTimelineMetricObservations({
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
  ): LoadedTimelineEvidence {
    const selectedSource = new TimelineRepository(this.db).selected(
      match.gameId,
      match.puuid,
    )
    const currentCompact = selectedSource
      ? compactTimelineFromJson(selectedSource.dataJson)
      : undefined
    // Quality and capability claims must describe the bytes actually used,
    // not whichever candidate happened to be updated most recently.
    const sourceQuality: MetricSourceQuality = selectedSource?.source === "match_v5"
      ? "verified"
      : selectedSource ? "retained" : "legacy"
    if (currentCompact) {
      return {
        timeline: currentCompact,
        sourceQuality,
        wardEventsComplete: selectedSource?.source === "match_v5",
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
        const frames = timelineFramesFromPayload(
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
        // Invalid retained evidence remains a reasoned gap.
      }
    }

    return {
      timeline: undefined,
      sourceQuality,
      wardEventsComplete: false,
    }
  }

  private loadSnapshot(calibrationId: string): VersionedGradeCalibrationSnapshot {
    const row = this.db.prepare(`
      SELECT snapshot_encoding AS snapshotEncoding,
             snapshot_uncompressed_bytes AS snapshotUncompressedBytes,
             snapshot_compressed_bytes AS snapshotCompressedBytes,
             snapshot_sha256 AS snapshotSha256,
             snapshot_payload AS snapshotPayload,
             created_at AS createdAt
      FROM grade_calibration_snapshots WHERE calibration_id = ?
    `).get(calibrationId) as (StoredJsonBodyRow & { createdAt: number }) | undefined
    if (!row) throw new Error("grade_calibration_snapshot_not_found")
    const snapshot = snapshotFromUnknown(decodeStoredJsonBody(row).value)
    return snapshot.modeEpochs ? snapshot : {
      ...snapshot,
      modeEpochs: epochsFromSnapshot(snapshot, row.createdAt),
      recentMatchLimit: MATCH_GRADE_MODE_REFERENCE_LIMIT,
    }
  }

  private loadEligibleReferenceLobbies(): GradeRawLobby[] {
    const lobbies: GradeRawLobby[] = []
    const independentMatches = new Set<string>()
    const participantsByMatch = new Map<string, StoredParticipantRow[]>()
    for (const participant of this.loadAllParticipants()) {
      const key = `${participant.gameId}\u0000${participant.ownerPuuid}`
      const group = participantsByMatch.get(key)
      if (group) group.push(participant)
      else participantsByMatch.set(key, [participant])
    }
    for (const match of this.loadAllMatches()) {
      const clusterId = gradeCalibrationClusterId(match)
      if (independentMatches.has(clusterId)) continue
      const participants = participantsByMatch.get(
        `${match.gameId}\u0000${match.puuid}`,
      ) ?? []
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

  private loadAllParticipants(): StoredParticipantWithMatch[] {
    return this.db.prepare(`
      SELECT game_id AS gameId, puuid AS ownerPuuid,
             participant_id AS participantId, team_id AS teamId,
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
      ORDER BY puuid, game_id, participant_id
    `).all() as StoredParticipantWithMatch[]
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
