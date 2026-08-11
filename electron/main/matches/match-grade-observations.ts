import type { Evidence } from "../../../src/shared/measurement.js"
import {
  noOpportunity,
  notApplicable,
  observed,
  unavailable,
} from "../../../src/shared/measurement.js"
import {
  MATCH_GRADE_RECIPE,
  MATCH_GRADE_METRIC_KEYS,
  MATCH_GRADE_METRIC_DIRECTIONS,
  type MatchGradeMetricKey,
} from "./match-grade-recipe.js"
import {
  calibrationScopeKey,
  resolvePrimaryArchetypeWithSource,
  type MatchGradeModeContext,
  type PrimaryArchetype,
} from "./match-grade-taxonomy.js"
import type { NormalizedPosition } from "./position.js"
import {
  calibrateRawDetailMetric,
  type DetailMetricCalibrationRow,
  type MetricComparisonScope,
  type RawMetricObservation,
} from "./match-metric-observations.js"
import { RVI_METRIC_POLICIES, metricDefinition } from "./match-metric-registry.js"
import {
  shrunkMidEcdf,
  type CalibrationCohort,
  type CalibrationObservation,
} from "./match-grade-calibration.js"
import { rawResponsibilityScores } from "./match-grade.js"

export const MATCH_GRADE_CALIBRATION_FORMAT_VERSION = 5 as const
export const MATCH_GRADE_MINIMUM_REFERENCE_MATCHES = 5
export const MATCH_GRADE_MINIMUM_SCOPE_MATCHES =
  MATCH_GRADE_RECIPE.calibration.minimumScopeMatches

export interface GradeCalibrationClusterFacts {
  gameId: number
  puuid: string
  platformId?: string | null
  riotMatchId?: string | null
}

/**
 * Canonicalizes Match-V5 (`NA1_123`) and LCU (`NA1` + `123`) identities to
 * the same region-safe cluster key. Numeric game ids are not globally unique.
 */
export function gradeCalibrationClusterId(
  facts: GradeCalibrationClusterFacts,
): string {
  const riotMatchId = facts.riotMatchId?.trim().toUpperCase() ?? ""
  const riotPrefix = /^([A-Z0-9]+)[_:][0-9]+$/.exec(riotMatchId)?.[1]
  const platform = facts.platformId?.trim().toUpperCase() ?? ""
  const prefix = riotPrefix || platform
  if (prefix) return `${prefix}:${facts.gameId}`
  if (riotMatchId) return `riot:${riotMatchId}`
  return `local:${facts.puuid}:${facts.gameId}`
}

export interface GradeRawParticipant {
  participantId: number
  teamId: number
  isPlayer: boolean
  championId: number
  position: NormalizedPosition
  primaryArchetype?: PrimaryArchetype
  kills: number
  deaths: number
  assists: number
  damageToChampions: number
  damageTaken?: number
  damageSelfMitigated?: number
  goldEarned: number
  totalMinionsKilled: number
  neutralMinions: number
  damageObjectives: number
  /** Turret overlap is the subset included in damageObjectives. */
  damageTurrets: number
  /** All recorded building damage is the independent structure-output metric. */
  damageStructures: number
  visionScore: number
  wardsPlaced?: number
  wardsKilled?: number
  controlWardsPurchased?: number
  detectorWardsPlaced?: number
  totalTimeSpentDead?: number
  timeCcingOthers: number
  totalHealsOnTeammates?: number
  totalDamageShieldedOnTeammates?: number
}

export interface GradeRawLobby {
  /** Region-safe independent match cluster used by every calibration stage. */
  clusterId: string
  /** Local database identity; never used as a calibration cluster key. */
  matchId: number
  /** Match completion time used only to select a versioned mode baseline. */
  playedAt?: number
  puuid: string
  durationSecs: number
  context: MatchGradeModeContext
  players: readonly GradeRawParticipant[]
  /** Optional expanded RVI evidence derived from the same retained match. */
  detailMetricObservations?: ReadonlyMap<
    number,
    readonly RawMetricObservation[]
  >
}

export interface GradeMetricObservation {
  clusterId: string
  trackedMode: string
  scopeKey: string
  position: NormalizedPosition
  archetype: PrimaryArchetype
  value: number
}

export interface GradeCompositeObservation {
  clusterId: string
  trackedMode: string
  scopeKey: string
  position: NormalizedPosition
  archetype: PrimaryArchetype
  /** First-stage active-evidence responsibility composite in [0, 1]. */
  value: number
}

export interface GradeCalibrationSnapshot {
  formatVersion: typeof MATCH_GRADE_CALIBRATION_FORMAT_VERSION
  referencePopulation: {
    kind: "local_recall_installation"
    clusterUnit: "match"
    clusterIdentity: typeof MATCH_GRADE_RECIPE.calibration.clusterIdentity
    frozen: true
    supportedModes: string[]
    supportedScopes: string[]
    scopeMatchCounts: Record<string, number>
  }
  clusterIds: string[]
  observations: Record<MatchGradeMetricKey, GradeMetricObservation[]>
  /** Frozen raw distributions for inspectable RVI metrics beyond Grade's core. */
  detailObservations: Record<string, GradeMetricObservation[]>
  compositeObservations: GradeCompositeObservation[]
}

export interface PreparedGradeParticipant {
  participantId: number
  teamId: number
  isPlayer: boolean
  championId: number
  position: NormalizedPosition
  primaryArchetype?: PrimaryArchetype
  metricEvidence: Partial<Record<MatchGradeMetricKey, Evidence<number>>>
  metricProvenance: Partial<Record<MatchGradeMetricKey, {
    state: Evidence<number>["state"]
    reason?: string
  }>>
  detailMetricEvidence?: Readonly<Record<string, Evidence<number>>>
  detailMetricProvenance?: Readonly<Record<string, {
    state: Evidence<number>["state"]
    reason?: string
  }>>
  responsibilityEvidence?: Evidence<number>
  peerCount: number
  comparisonScope: "role"
}

export interface PreparedGradeLobby {
  players: PreparedGradeParticipant[]
  evidenceCoverage: number
  referenceSampleCount: number
  referenceMetadata: {
    population: "local_recall_installation"
    frozen: true
    clusterUnit: "match"
    clusterIdentity: typeof MATCH_GRADE_RECIPE.calibration.clusterIdentity
    trackedMode: string
    rulesetKey: string
    scopeKey: string
    scopeFrozen: boolean
    supportedModes: string[]
    supportedScopes: string[]
    minimumReferenceMatches: number
  }
}

export interface GradeCalibrationScopeSummary {
  scopeKey: string
  trackedMode: string
  rulesetKey: string
  independentMatches: number
  supported: boolean
}

const finiteNonnegative = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0

const rate = (value: number, durationSecs: number, scale = 60) =>
  value / durationSecs * scale

const CORE_GRADE_METRICS = new Set<string>(RVI_METRIC_POLICIES
  .filter((policy) => policy.tier === "CORE")
  .map((policy) => policy.metricKey))

/**
 * Converts one complete scoreboard into evidence-aware, duration-normalized
 * observations. This is the only raw formula implementation shared by Grade
 * and the frozen reference builder.
 */
export function deriveRawMetricEvidence(
  lobby: GradeRawLobby,
): Map<number, Partial<Record<MatchGradeMetricKey, Evidence<number>>>> {
  const result = new Map<number, Partial<Record<MatchGradeMetricKey, Evidence<number>>>>()
  if (!Number.isFinite(lobby.durationSecs) || lobby.durationSecs <= 0) return result

  // Production lobbies derive the shared summary inventory once. Grade then
  // selects its registered subset instead of recalculating the same formulas
  // through a parallel RVI-only path. The fallback below remains for pure
  // scorer callers that intentionally provide only legacy Grade raw fields.
  if (lobby.detailMetricObservations) {
    let complete = true
    for (const player of lobby.players) {
      const byKey = new Map((lobby.detailMetricObservations.get(
        player.participantId,
      ) ?? []).map((entry) => [entry.metricKey, entry.rawEvidence]))
      const evidence: Partial<Record<MatchGradeMetricKey, Evidence<number>>> = {}
      for (const metric of MATCH_GRADE_METRIC_KEYS) {
        const entry = byKey.get(metric)
        if (!entry) {
          complete = false
          break
        }
        evidence[metric] = entry
      }
      if (!complete) break
      result.set(player.participantId, evidence)
    }
    if (complete && result.size === lobby.players.length) return result
    result.clear()
  }

  const teamKills = new Map<number, number>()
  const teamDamage = new Map<number, number>()
  for (const player of lobby.players) {
    teamKills.set(player.teamId, (teamKills.get(player.teamId) ?? 0) + player.kills)
    teamDamage.set(
      player.teamId,
      (teamDamage.get(player.teamId) ?? 0) + player.damageToChampions,
    )
  }

  for (const player of lobby.players) {
    const kills = teamKills.get(player.teamId) ?? 0
    const damage = teamDamage.get(player.teamId) ?? 0
    const heal = player.totalHealsOnTeammates
    const shield = player.totalDamageShieldedOnTeammates
    const neutralObjectiveDamage = Math.max(
      0,
      player.damageObjectives - player.damageTurrets,
    )
    result.set(player.participantId, {
      damage_share: damage > 0
        ? observed(player.damageToChampions / damage, { source: "derived" })
        : noOpportunity("team_dealt_no_champion_damage", { source: "derived" }),
      kill_participation: kills > 0
        ? observed(Math.min(1, (player.kills + player.assists) / kills), { source: "derived" })
        : noOpportunity("team_had_no_kills", { source: "derived" }),
      deaths_per_10: observed(rate(player.deaths, lobby.durationSecs, 600), {
        source: "derived",
      }),
      gold_per_min: observed(rate(player.goldEarned, lobby.durationSecs), {
        source: "derived",
      }),
      cs_per_min: observed(rate(
        player.totalMinionsKilled + player.neutralMinions,
        lobby.durationSecs,
      ), { source: "derived" }),
      neutral_objective_damage_per_min: lobby.context.ruleset === "howling_abyss"
        ? notApplicable("ruleset_has_no_neutral_objective_duty", { source: "derived" })
        : observed(rate(neutralObjectiveDamage, lobby.durationSecs), { source: "derived" }),
      structure_damage_per_min: lobby.context.ruleset === "howling_abyss"
        ? notApplicable("objective_family_not_graded_in_howling_abyss", { source: "derived" })
        : observed(rate(player.damageStructures, lobby.durationSecs), { source: "derived" }),
      vision_score_per_min: lobby.context.ruleset === "howling_abyss"
        ? notApplicable("ruleset_has_no_warding_duty", { source: "derived" })
        : observed(rate(player.visionScore, lobby.durationSecs), { source: "derived" }),
      cc_seconds_per_min: observed(rate(player.timeCcingOthers, lobby.durationSecs), {
        source: "derived",
      }),
      ally_heal_shield_per_min: finiteNonnegative(heal) && finiteNonnegative(shield)
        ? observed(rate(heal + shield, lobby.durationSecs), {
          source: "derived",
        })
        : unavailable("source_did_not_capture_complete_ally_heal_and_shield", {
          source: "legacy",
        }),
    })
  }
  return result
}

function emptyObservationRecord(): Record<MatchGradeMetricKey, GradeMetricObservation[]> {
  const observations = {} as Record<MatchGradeMetricKey, GradeMetricObservation[]>
  for (const metric of MATCH_GRADE_METRIC_KEYS) observations[metric] = []
  return observations
}

/** Counts independent matches in the exact mode/rules epoch used for calibration. */
export function summarizeGradeCalibrationScopes(
  lobbies: readonly GradeRawLobby[],
): GradeCalibrationScopeSummary[] {
  const scopes = new Map<string, {
    trackedMode: string
    rulesetKey: string
    clusterIds: Set<string>
  }>()
  for (const lobby of lobbies) {
    const scopeKey = calibrationScopeKey(lobby.context)
    const entry = scopes.get(scopeKey) ?? {
      trackedMode: lobby.context.trackedMode,
      rulesetKey: lobby.context.rulesetKey,
      clusterIds: new Set<string>(),
    }
    entry.clusterIds.add(lobby.clusterId)
    scopes.set(scopeKey, entry)
  }
  return [...scopes.entries()]
    .map(([scopeKey, entry]) => ({
      scopeKey,
      trackedMode: entry.trackedMode,
      rulesetKey: entry.rulesetKey,
      independentMatches: entry.clusterIds.size,
      supported: entry.clusterIds.size >= MATCH_GRADE_MINIMUM_SCOPE_MATCHES,
    }))
    .sort((left, right) => left.scopeKey.localeCompare(right.scopeKey))
}

/** Builds a content-addressable snapshot. Callers persist and freeze it. */
export function buildGradeCalibrationSnapshot(
  lobbies: readonly GradeRawLobby[],
): GradeCalibrationSnapshot {
  const observations = emptyObservationRecord()
  const detailObservations: Record<string, GradeMetricObservation[]> = {}
  const scopeSummaries = summarizeGradeCalibrationScopes(lobbies)
  const supportedScopeSet = new Set(
    scopeSummaries.filter((scope) => scope.supported).map((scope) => scope.scopeKey),
  )
  const candidates = [...lobbies]
    .filter((lobby) => supportedScopeSet.has(calibrationScopeKey(lobby.context)))
    .sort((left, right) =>
      calibrationScopeKey(left.context).localeCompare(calibrationScopeKey(right.context)) ||
      left.clusterId.localeCompare(right.clusterId) || left.puuid.localeCompare(right.puuid))
  const seenClusters = new Set<string>()
  const sorted = candidates.filter((lobby) => {
    if (seenClusters.has(lobby.clusterId)) return false
    seenClusters.add(lobby.clusterId)
    return true
  })
  for (const lobby of sorted) {
    const scopeKey = calibrationScopeKey(lobby.context)
    const evidence = deriveRawMetricEvidence(lobby)
    for (const player of [...lobby.players].sort((left, right) =>
      left.participantId - right.participantId)) {
      const archetype = resolvePrimaryArchetypeWithSource(
        player.championId,
        player.primaryArchetype,
      ).archetype
      const playerEvidence = evidence.get(player.participantId) ?? {}
      for (const metric of MATCH_GRADE_METRIC_KEYS) {
        const entry = playerEvidence[metric]
        if (!metricDefinition(metric)?.applicable({
          context: lobby.context,
          position: player.position,
          archetype,
        })) continue
        if (entry?.state !== "observed" || !Number.isFinite(entry.value)) continue
        observations[metric].push({
          clusterId: lobby.clusterId,
          trackedMode: lobby.context.trackedMode,
          scopeKey,
          position: player.position,
          archetype,
          value: entry.value,
        })
      }
      for (const entry of [...(lobby.detailMetricObservations?.get(
        player.participantId,
      ) ?? [])].sort((left, right) => left.metricKey.localeCompare(right.metricKey))) {
        if (!metricDefinition(entry.metricKey)?.applicable({
          context: lobby.context,
          position: player.position,
          archetype,
        })) continue
        if (entry.rawEvidence.state !== "observed" ||
            !Number.isFinite(entry.rawEvidence.value)) continue
        const rows = detailObservations[entry.metricKey] ?? []
        rows.push({
          clusterId: lobby.clusterId,
          trackedMode: lobby.context.trackedMode,
          scopeKey,
          position: player.position,
          archetype,
          value: entry.rawEvidence.value,
        })
        detailObservations[entry.metricKey] = rows
      }
    }
  }
  const snapshot: GradeCalibrationSnapshot = {
    formatVersion: MATCH_GRADE_CALIBRATION_FORMAT_VERSION,
    referencePopulation: {
      kind: "local_recall_installation",
      clusterUnit: "match",
      clusterIdentity: MATCH_GRADE_RECIPE.calibration.clusterIdentity,
      frozen: true,
      supportedModes: [...new Set(sorted.map((lobby) => lobby.context.trackedMode))].sort(),
      supportedScopes: [...supportedScopeSet].sort(),
      scopeMatchCounts: Object.fromEntries(scopeSummaries
        .filter((scope) => scope.supported)
        .map((scope) => [scope.scopeKey, scope.independentMatches])),
    },
    clusterIds: [...new Set(sorted.map((lobby) => lobby.clusterId))],
    observations,
    detailObservations: Object.fromEntries(Object.entries(detailObservations)
      .sort(([left], [right]) => left.localeCompare(right))),
    compositeObservations: [],
  }

  // Stage two is deliberately built from leave-one-match-out stage-one
  // percentiles. This prevents a reference match from grading itself while
  // making Recall Score a percentile of the same responsibility formula users see.
  for (const lobby of sorted) {
    const prepared = prepareMetricLobbyFromSnapshot(lobby, snapshot)
    attachDetailMetricEvidence(lobby, snapshot, prepared)
    const rawScores = rawResponsibilityScores({
      players: prepared.players,
      context: lobby.context,
    })
    if (rawScores.status !== "ready") continue
    for (const result of [...rawScores.results.values()].sort((left, right) =>
      left.participantId - right.participantId)) {
      snapshot.compositeObservations.push({
        clusterId: lobby.clusterId,
        trackedMode: lobby.context.trackedMode,
        scopeKey: calibrationScopeKey(lobby.context),
        position: result.position,
        archetype: result.primaryArchetype,
        value: result.rawResponsibilityComposite,
      })
    }
  }
  return snapshot
}

const metricDirection = (metric: MatchGradeMetricKey) => MATCH_GRADE_METRIC_DIRECTIONS[metric]

const toCalibrationObservations = (
  entries: readonly GradeMetricObservation[],
): CalibrationObservation[] => entries.map((entry) => ({
  matchId: entry.clusterId,
  value: entry.value,
}))

interface CohortRowIndex<T extends GradeMetricObservation> {
  scopes: Map<string, T[]>
  positions: Map<string, T[]>
  archetypes: Map<string, T[]>
  scopeMatches: Map<string, Set<string>>
}

const positionIndexKey = (scopeKey: string, position: NormalizedPosition) =>
  `${scopeKey}\u0000${position}`
const archetypeIndexKey = (
  scopeKey: string,
  position: NormalizedPosition,
  archetype: PrimaryArchetype,
) => `${scopeKey}\u0000${position}\u0000${archetype}`

function indexCohortRows<T extends GradeMetricObservation>(
  rows: readonly T[],
): CohortRowIndex<T> {
  const index: CohortRowIndex<T> = {
    scopes: new Map(),
    positions: new Map(),
    archetypes: new Map(),
    scopeMatches: new Map(),
  }
  const append = (map: Map<string, T[]>, key: string, row: T) => {
    const entries = map.get(key) ?? []
    entries.push(row)
    map.set(key, entries)
  }
  for (const row of rows) {
    append(index.scopes, row.scopeKey, row)
    append(index.positions, positionIndexKey(row.scopeKey, row.position), row)
    append(index.archetypes, archetypeIndexKey(
      row.scopeKey,
      row.position,
      row.archetype,
    ), row)
    const matches = index.scopeMatches.get(row.scopeKey) ?? new Set<string>()
    matches.add(row.clusterId)
    index.scopeMatches.set(row.scopeKey, matches)
  }
  return index
}

const metricIndexes = new WeakMap<
  GradeCalibrationSnapshot,
  Record<MatchGradeMetricKey, CohortRowIndex<GradeMetricObservation>>
>()
const compositeIndexes = new WeakMap<
  GradeCalibrationSnapshot,
  CohortRowIndex<GradeCompositeObservation>
>()
const detailCalibrationRows = new WeakMap<
  GradeCalibrationSnapshot,
  Map<string, DetailMetricCalibrationRow[]>
>()

function metricIndexFor(snapshot: GradeCalibrationSnapshot) {
  const cached = metricIndexes.get(snapshot)
  if (cached) return cached
  const index = {} as Record<
    MatchGradeMetricKey,
    CohortRowIndex<GradeMetricObservation>
  >
  for (const metric of MATCH_GRADE_METRIC_KEYS) {
    index[metric] = indexCohortRows(snapshot.observations[metric])
  }
  metricIndexes.set(snapshot, index)
  return index
}

function compositeIndexFor(snapshot: GradeCalibrationSnapshot) {
  const cached = compositeIndexes.get(snapshot)
  if (cached) return cached
  const index = indexCohortRows(snapshot.compositeObservations)
  compositeIndexes.set(snapshot, index)
  return index
}

function detailCalibrationRowsFor(
  snapshot: GradeCalibrationSnapshot,
  metricKey: string,
) {
  let cached = detailCalibrationRows.get(snapshot)
  if (!cached) {
    cached = new Map()
    detailCalibrationRows.set(snapshot, cached)
  }
  const existing = cached.get(metricKey)
  if (existing) return existing
  const rows = (snapshot.detailObservations[metricKey] ?? []).map((entry) => ({
      metricKey,
      matchId: entry.clusterId,
      scopeKey: entry.scopeKey,
      position: entry.position,
      archetype: entry.archetype.toUpperCase(),
      value: entry.value,
    }))
  cached.set(metricKey, rows)
  return rows
}

function metricCohortFor(
  snapshot: GradeCalibrationSnapshot,
  metric: MatchGradeMetricKey,
  scopeKey: string,
  position: NormalizedPosition,
  archetype: PrimaryArchetype,
): { cohort: CalibrationCohort; rootMatches: Set<string> } {
  const index = metricIndexFor(snapshot)[metric]
  const mode = index.scopes.get(scopeKey) ?? []
  const positionRows = index.positions.get(positionIndexKey(scopeKey, position)) ?? []
  const archetypeRows = index.archetypes.get(archetypeIndexKey(
    scopeKey,
    position,
    archetype,
  )) ?? []
  return {
    cohort: {
      observations: toCalibrationObservations(archetypeRows),
      parent: {
        observations: toCalibrationObservations(positionRows),
        parent: { observations: toCalibrationObservations(mode) },
      },
    },
    rootMatches: index.scopeMatches.get(scopeKey) ?? new Set(),
  }
}

function compositeCohortFor(
  snapshot: GradeCalibrationSnapshot,
  scopeKey: string,
  position: NormalizedPosition,
  archetype: PrimaryArchetype,
): { cohort: CalibrationCohort; rootMatches: Set<string> } {
  const index = compositeIndexFor(snapshot)
  const mode = index.scopes.get(scopeKey) ?? []
  const positionRows = index.positions.get(positionIndexKey(scopeKey, position)) ?? []
  const archetypeRows = index.archetypes.get(archetypeIndexKey(
    scopeKey,
    position,
    archetype,
  )) ?? []
  return {
    cohort: {
      observations: toCalibrationObservations(archetypeRows),
      parent: {
        observations: toCalibrationObservations(positionRows),
        parent: { observations: toCalibrationObservations(mode) },
      },
    },
    rootMatches: index.scopeMatches.get(scopeKey) ?? new Set(),
  }
}

export interface PreparedDetailMetricObservation extends RawMetricObservation {
  scoreEvidence: Evidence<number>
  comparisonScope?: MetricComparisonScope
  referenceMatchCount?: number
}

/**
 * Calibrates every inspectable metric against the same immutable, clustered
 * reference as Grade. Raw evidence is retained even when its reference scope
 * is too small to produce a truthful score.
 */
export function prepareDetailMetricObservationsFromSnapshot(
  lobby: GradeRawLobby,
  snapshot: GradeCalibrationSnapshot,
): ReadonlyMap<number, readonly PreparedDetailMetricObservation[]> {
  const result = new Map<number, PreparedDetailMetricObservation[]>()
  const scopeKey = calibrationScopeKey(lobby.context)
  for (const player of lobby.players) {
    const archetype = resolvePrimaryArchetypeWithSource(
      player.championId,
      player.primaryArchetype,
    ).archetype
    const rows: PreparedDetailMetricObservation[] = []
    for (const raw of lobby.detailMetricObservations?.get(player.participantId) ?? []) {
      const definition = metricDefinition(raw.metricKey)
      if (!definition) {
        rows.push({
          ...raw,
          scoreEvidence: unavailable("metric_not_registered", { source: "derived" }),
        })
        continue
      }
      if (!definition.applicable({
        context: lobby.context,
        position: player.position,
        archetype,
      })) {
        rows.push({
          ...raw,
          scoreEvidence: notApplicable("metric_not_applicable_to_context", {
            source: "derived",
          }),
        })
        continue
      }
      const calibrated = calibrateRawDetailMetric(raw, {
        matchId: lobby.clusterId,
        scopeKey,
        position: player.position,
        archetype,
      }, detailCalibrationRowsFor(snapshot, raw.metricKey), {
        direction: definition.direction,
        minimumReferenceMatches: MATCH_GRADE_MINIMUM_REFERENCE_MATCHES,
      })
      rows.push({
        ...raw,
        ...calibrated,
      })
    }
    result.set(player.participantId, rows)
  }
  return result
}

function attachDetailMetricEvidence(
  lobby: GradeRawLobby,
  snapshot: GradeCalibrationSnapshot,
  prepared: PreparedGradeLobby,
): void {
  const detail = prepareDetailMetricObservationsFromSnapshot(lobby, snapshot)
  for (const player of prepared.players) {
    const evidence: Record<string, Evidence<number>> = {}
    const provenance: Record<string, {
      state: Evidence<number>["state"]
      reason?: string
    }> = {}
    for (const entry of detail.get(player.participantId) ?? []) {
      evidence[entry.metricKey] = entry.scoreEvidence
      provenance[entry.metricKey] = {
        state: entry.rawEvidence.state,
        ...(entry.rawEvidence.reason ? { reason: entry.rawEvidence.reason } : {}),
      }
    }
    player.detailMetricEvidence = evidence
    player.detailMetricProvenance = provenance
  }
}

/** First-stage metric calibration shared by snapshot construction and scoring. */
function prepareMetricLobbyFromSnapshot(
  lobby: GradeRawLobby,
  snapshot: GradeCalibrationSnapshot,
): PreparedGradeLobby {
  const raw = deriveRawMetricEvidence(lobby)
  const players: PreparedGradeParticipant[] = []
  const scopeKey = calibrationScopeKey(lobby.context)
  let observedCount = 0
  let applicableCount = 0
  let minimumReference = Number.POSITIVE_INFINITY

  for (const player of lobby.players) {
    let playerMinimumReference = Number.POSITIVE_INFINITY
    const archetype = resolvePrimaryArchetypeWithSource(
      player.championId,
      player.primaryArchetype,
    ).archetype
    const metricEvidence: Partial<Record<MatchGradeMetricKey, Evidence<number>>> = {}
    const metricProvenance: PreparedGradeParticipant["metricProvenance"] = {}
    for (const metric of MATCH_GRADE_METRIC_KEYS) {
      const entry = raw.get(player.participantId)?.[metric]
      if (!entry) continue
      metricProvenance[metric] = {
        state: entry.state,
        ...(entry.reason ? { reason: entry.reason } : {}),
      }
      const scoredMetric = CORE_GRADE_METRICS.has(metric)
      if (!metricDefinition(metric)?.applicable({
        context: lobby.context,
        position: player.position,
        archetype,
      })) {
        metricEvidence[metric] = notApplicable("metric_not_applicable_to_context", {
          source: "derived",
        })
        continue
      }
      if (entry.state === "not_applicable") {
        metricEvidence[metric] = entry
        continue
      }
      if (scoredMetric) applicableCount += 1
      if (entry.state === "no_opportunity") {
        metricEvidence[metric] = observed(.5, {
          source: "derived",
          reason: entry.reason ?? "no_opportunity_neutral",
        })
        // This is known source evidence with a deliberately neutral score,
        // not a missing observation. Keep data coverage at 100%.
        if (scoredMetric) observedCount += 1
        continue
      }
      if (entry.state !== "observed") {
        metricEvidence[metric] = entry
        continue
      }
      const { cohort, rootMatches } = metricCohortFor(
        snapshot,
        metric,
        scopeKey,
        player.position,
        archetype,
      )
      const referenceMatches = [...rootMatches]
        .filter((clusterId) => clusterId !== lobby.clusterId).length
      if (scoredMetric) {
        playerMinimumReference = Math.min(playerMinimumReference, referenceMatches)
        minimumReference = Math.min(minimumReference, referenceMatches)
      }
      if (referenceMatches < MATCH_GRADE_MINIMUM_REFERENCE_MATCHES) {
        metricEvidence[metric] = unavailable("reference_population_too_small", {
          source: "derived",
        })
        continue
      }
      const calibrated = shrunkMidEcdf(entry.value, cohort, {
        direction: metricDirection(metric),
        excludeMatchId: lobby.clusterId,
      })
      metricEvidence[metric] = observed(calibrated.percentile, {
        source: "derived",
        reason: calibrated.source,
      })
      if (scoredMetric) observedCount += 1
    }
    players.push({
      participantId: player.participantId,
      teamId: player.teamId,
      isPlayer: player.isPlayer,
      championId: player.championId,
      position: player.position,
      primaryArchetype: player.primaryArchetype,
      metricEvidence,
      metricProvenance,
      peerCount: Number.isFinite(playerMinimumReference) ? playerMinimumReference : 0,
      comparisonScope: "role",
    })
  }

  return {
    players,
    evidenceCoverage: applicableCount === 0 ? 0 : observedCount / applicableCount,
    referenceSampleCount: Number.isFinite(minimumReference) ? minimumReference : 0,
    referenceMetadata: {
      population: "local_recall_installation",
      frozen: true,
      clusterUnit: "match",
      clusterIdentity: MATCH_GRADE_RECIPE.calibration.clusterIdentity,
      trackedMode: lobby.context.trackedMode,
      rulesetKey: lobby.context.rulesetKey,
      scopeKey,
      scopeFrozen: snapshot.referencePopulation.supportedScopes.includes(scopeKey),
      supportedModes: [...snapshot.referencePopulation.supportedModes],
      supportedScopes: [...snapshot.referencePopulation.supportedScopes],
      minimumReferenceMatches: MATCH_GRADE_MINIMUM_REFERENCE_MATCHES,
    },
  }
}

/**
 * Applies both frozen calibration stages without adding the subject match:
 * raw metric -> metric percentile -> responsibility composite -> Recall Score ECDF.
 */
export function prepareGradeLobbyFromSnapshot(
  lobby: GradeRawLobby,
  snapshot: GradeCalibrationSnapshot,
): PreparedGradeLobby {
  const prepared = prepareMetricLobbyFromSnapshot(lobby, snapshot)
  attachDetailMetricEvidence(lobby, snapshot, prepared)
  const rawScores = rawResponsibilityScores({
    players: prepared.players,
    context: lobby.context,
  })
  if (rawScores.status !== "ready") return prepared

  const scopeKey = calibrationScopeKey(lobby.context)
  let minimumReference = prepared.referenceSampleCount
  for (const player of prepared.players) {
    const rawScore = rawScores.results.get(player.participantId)
    if (!rawScore) continue
    const { cohort, rootMatches } = compositeCohortFor(
      snapshot,
      scopeKey,
      rawScore.position,
      rawScore.primaryArchetype,
    )
    const referenceMatches = [...rootMatches]
      .filter((clusterId) => clusterId !== lobby.clusterId).length
    minimumReference = Math.min(minimumReference, referenceMatches)
    player.peerCount = Math.min(player.peerCount, referenceMatches)
    if (referenceMatches < MATCH_GRADE_MINIMUM_REFERENCE_MATCHES) {
      player.responsibilityEvidence = unavailable("composite_reference_population_too_small", {
        source: "derived",
      })
      continue
    }
    const calibrated = shrunkMidEcdf(rawScore.rawResponsibilityComposite, cohort, {
      excludeMatchId: lobby.clusterId,
      rootKappa: MATCH_GRADE_RECIPE.calibration.finalCompositeRootKappa,
    })
    player.responsibilityEvidence = observed(calibrated.percentile, {
      source: "derived",
      reason: calibrated.source,
    })
  }
  prepared.referenceSampleCount = Number.isFinite(minimumReference) ? minimumReference : 0
  return prepared
}
