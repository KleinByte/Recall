import type { Evidence } from "../../../src/shared/measurement.js"
import {
  invalid,
  noOpportunity,
  notApplicable,
  observed,
  unavailable,
} from "../../../src/shared/measurement.js"
import type { CompactTimeline, CompactTimelineEvent, CompactTimelineFrame } from
  "../riot/timeline-mapper.js"
import type { Position } from "./position.js"
import type { GradeModeContextV3 } from "./grade-v3-taxonomy.js"
import {
  TIMELINE_METRIC_KEYS_V3,
  metricDefinitionV3,
  type TimelineMetricKeyV3,
} from "./metric-registry-v3.js"
import type {
  MetricSourceQualityV3,
  RawMetricObservationV3,
} from "./metric-observations-v3.js"

export { TIMELINE_METRIC_KEYS_V3 }

export const RVI_V3_TIMELINE_DERIVATION_ID =
  "recall.rvi.v3.timeline.2026-08-09.r1" as const
export const RVI_V3_FIGHT_CLUSTER_WINDOW_MS = 12_000
export const RVI_V3_FIGHT_CLUSTER_RADIUS = 1_200
export const RVI_V3_PHASE_FRAME_TOLERANCE_MS = 30_000
export const RVI_V3_OBJECTIVE_FRAME_TOLERANCE_MS = 60_000
export const RVI_V3_OBJECTIVE_PROXIMITY_RADIUS = 1_500
export const RVI_V3_PRE_OBJECTIVE_WINDOW_MS = 60_000
export const RVI_V3_PRE_OBJECTIVE_RADIUS = 2_500
export const RVI_V3_EARLY_END_MS = 15 * 60_000

export interface TimelineMetricDerivationInputV3 {
  participantId: number
  teamId: number
  durationSecs: number
  context: GradeModeContextV3
  position?: Position | "UNKNOWN"
  /** Exact opposing role resolved before timeline derivation. */
  opponentParticipantId?: number
  timeline?: CompactTimeline
  /** Optional authoritative identities when old compact frames omit team ids. */
  participantTeams?: ReadonlyMap<number, number> | Readonly<Record<number, number>>
  /** True only when the source/mapping contract proves ward events were retained. */
  wardEventsComplete?: boolean
  sourceQuality?: MetricSourceQualityV3
}

export type TimelineMetricObservationV3 = RawMetricObservationV3<TimelineMetricKeyV3>

export interface TimelineFightClusterV3 {
  events: readonly CompactTimelineEvent[]
  participantIds: readonly number[]
  classification: "duel" | "skirmish" | "teamfight"
  pick: boolean
}

type Point = { x: number; y: number }
type LanePosition = "TOP" | "MIDDLE" | "BOTTOM"

const finitePoint = (point: Point | undefined): point is Point =>
  point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y)
const positiveId = (value: number | undefined): value is number =>
  value !== undefined && Number.isSafeInteger(value) && value > 0
const isRift = (context: GradeModeContextV3) => context.ruleset !== "howling_abyss"

const timelineObserved = (value: number) => observed(value, { source: "derived" })
const timelineUnavailable = (reason: string) => unavailable<number>(reason, { source: "legacy" })
const timelineInvalid = (reason: string) => invalid<number>(reason, { source: "derived" })
const timelineNoOpportunity = (reason: string) =>
  noOpportunity<number>(reason, { source: "derived" })
const timelineNotApplicable = (reason: string) =>
  notApplicable<number>(reason, { source: "derived" })

function raw(
  metricKey: TimelineMetricKeyV3,
  rawEvidence: Evidence<number>,
  sourceQuality: MetricSourceQualityV3,
  details: Pick<RawMetricObservationV3, "numerator" | "denominator" | "opportunityCount"> = {},
): TimelineMetricObservationV3 {
  return {
    metricKey,
    rawEvidence,
    unit: metricDefinitionV3(metricKey)?.unit ?? "unknown",
    source: "timeline",
    sourceQuality,
    ...details,
  }
}

function ratioEvidence(
  numerator: number,
  denominator: number,
  zeroReason: string,
): Evidence<number> {
  return denominator === 0
    ? timelineNoOpportunity(zeroReason)
    : timelineObserved(numerator / denominator)
}

function detailsForRate(numerator: number, denominator: number) {
  return { numerator, denominator, opportunityCount: denominator }
}

function teamEntries(
  input: TimelineMetricDerivationInputV3,
): Map<number, number> {
  const result = new Map<number, number>()
  if (input.participantTeams instanceof Map) {
    for (const [participantId, teamId] of input.participantTeams) {
      if (positiveId(participantId) && Number.isSafeInteger(teamId)) result.set(participantId, teamId)
    }
  } else if (input.participantTeams) {
    for (const [participantId, teamId] of Object.entries(input.participantTeams)) {
      const id = Number(participantId)
      if (positiveId(id) && Number.isSafeInteger(teamId)) result.set(id, teamId)
    }
  }
  const timeline = input.timeline
  if (!timeline) return result
  for (const frame of timeline.frames) {
    for (const participant of frame.participants) {
      if (positiveId(participant.participantId) && Number.isSafeInteger(participant.teamId)) {
        result.set(participant.participantId, participant.teamId as number)
      }
    }
  }
  result.set(input.participantId, input.teamId)
  for (const event of timeline.events) {
    if (positiveId(event.participantId) && Number.isSafeInteger(event.teamId)) {
      result.set(event.participantId, event.teamId as number)
      for (const assister of event.assistingParticipantIds ?? []) {
        if (positiveId(assister)) result.set(assister, event.teamId as number)
      }
      if (positiveId(event.targetId) && (event.teamId === 100 || event.teamId === 200)) {
        result.set(event.targetId, event.teamId === 100 ? 200 : 100)
      }
    }
  }
  return result
}

function eventParticipants(event: CompactTimelineEvent): number[] {
  return [...new Set([
    ...(positiveId(event.participantId) ? [event.participantId] : []),
    ...(positiveId(event.targetId) ? [event.targetId] : []),
    ...(event.assistingParticipantIds ?? []).filter(positiveId),
  ])]
}

function directlyParticipates(event: CompactTimelineEvent, participantId: number): boolean {
  return event.participantId === participantId ||
    event.assistingParticipantIds?.includes(participantId) === true
}

function eventTeam(event: CompactTimelineEvent, teams: ReadonlyMap<number, number>): number | undefined {
  return Number.isSafeInteger(event.teamId)
    ? event.teamId
    : positiveId(event.participantId) ? teams.get(event.participantId) : undefined
}

const stableEventOrder = (left: CompactTimelineEvent, right: CompactTimelineEvent) =>
  left.timestamp - right.timestamp || left.eventId.localeCompare(right.eventId)

/** Deterministic connected components at the frozen 12-second/1,200-unit boundary. */
export function clusterTimelineFightsV3(
  events: readonly CompactTimelineEvent[],
): Evidence<readonly TimelineFightClusterV3[]> {
  const kills = events.filter((event) => event.type === "CHAMPION_KILL")
  if (kills.some((event) => !Number.isFinite(event.timestamp) ||
      !positiveId(event.participantId) || !positiveId(event.targetId) ||
      (event.assistingParticipantIds !== undefined &&
       !Array.isArray(event.assistingParticipantIds)) || !finitePoint(event.position) ||
      (event.assistingParticipantIds ?? []).some((id) => !positiveId(id)))) {
    return unavailable("incomplete_spatial_fight_evidence", { source: "legacy" })
  }
  const ordered = [...kills].sort(stableEventOrder)
  const parent = ordered.map((_, index) => index)
  const root = (index: number): number => parent[index] === index
    ? index
    : (parent[index] = root(parent[index]))
  for (let left = 0; left < ordered.length; left += 1) {
    for (let right = left + 1; right < ordered.length; right += 1) {
      if (ordered[right].timestamp - ordered[left].timestamp > RVI_V3_FIGHT_CLUSTER_WINDOW_MS) break
      const a = ordered[left].position as Point
      const b = ordered[right].position as Point
      if (Math.hypot(a.x - b.x, a.y - b.y) <= RVI_V3_FIGHT_CLUSTER_RADIUS) {
        parent[root(right)] = root(left)
      }
    }
  }
  const components = new Map<number, CompactTimelineEvent[]>()
  ordered.forEach((event, index) => {
    const key = root(index)
    components.set(key, [...(components.get(key) ?? []), event])
  })
  const clusters = [...components.values()].map((cluster): TimelineFightClusterV3 => {
    const participantIds = [...new Set(cluster.flatMap(eventParticipants))].sort((a, b) => a - b)
    const classification = participantIds.length === 2
      ? "duel"
      : participantIds.length <= 5 ? "skirmish" : "teamfight"
    const pick = participantIds.length <= 5 && cluster.some((event) =>
      1 + (event.assistingParticipantIds?.length ?? 0) >= 2)
    return Object.freeze({
      events: Object.freeze([...cluster]),
      participantIds: Object.freeze(participantIds),
      classification,
      pick,
    })
  })
  return observed(Object.freeze(clusters), { source: "derived" })
}

function nearestFrame(
  frames: readonly CompactTimelineFrame[],
  timestamp: number,
  toleranceMs: number,
): CompactTimelineFrame | undefined {
  const frame = frames.reduce<CompactTimelineFrame | undefined>((best, current) =>
    !best || Math.abs(current.timestamp - timestamp) < Math.abs(best.timestamp - timestamp) ||
      (Math.abs(current.timestamp - timestamp) === Math.abs(best.timestamp - timestamp) &&
       current.timestamp < best.timestamp)
      ? current
      : best, undefined)
  return frame && Math.abs(frame.timestamp - timestamp) <= toleranceMs ? frame : undefined
}

function frameParticipant(
  frame: CompactTimelineFrame | undefined,
  participantId: number,
) {
  return frame?.participants.find((participant) => participant.participantId === participantId)
}

function participantPointNear(
  timeline: CompactTimeline,
  participantId: number,
  timestamp: number,
  toleranceMs = RVI_V3_OBJECTIVE_FRAME_TOLERANCE_MS,
): Point | undefined {
  const participant = frameParticipant(nearestFrame(timeline.frames, timestamp, toleranceMs), participantId)
  return finitePoint(participant?.position) ? participant.position : undefined
}

function objectiveToken(event: CompactTimelineEvent): string {
  return event.objective?.toUpperCase().replaceAll("_", "") ?? ""
}

function isBaron(event: CompactTimelineEvent) {
  return objectiveToken(event).includes("BARON")
}

function isDragon(event: CompactTimelineEvent) {
  return objectiveToken(event).includes("DRAGON")
}

function isHerald(event: CompactTimelineEvent) {
  const token = objectiveToken(event)
  return token.includes("RIFTHERALD") || token.includes("HERALD")
}

function fightOutcome(
  cluster: TimelineFightClusterV3,
  ownerTeamId: number,
  teams: ReadonlyMap<number, number>,
): number | undefined {
  let ownKills = 0
  let opposingKills = 0
  for (const event of cluster.events) {
    const team = eventTeam(event, teams)
    if (team === undefined) return undefined
    if (team === ownerTeamId) ownKills += 1
    else opposingKills += 1
  }
  return ownKills > opposingKills ? 1 : ownKills < opposingKills ? 0 : .5
}

function isForward(point: Point | undefined, teamId: number): boolean | undefined {
  if (!finitePoint(point) || (teamId !== 100 && teamId !== 200)) return undefined
  return teamId === 100 ? point.x + point.y > 16_000 : point.x + point.y < 14_000
}

export function riftLaneAtV3(point: Point): LanePosition | undefined {
  const { x, y } = point
  if ((x <= 3_000 && y >= 4_000) || (y >= 12_000 && x <= 11_000)) return "TOP"
  if ((y <= 3_000 && x >= 4_000) || (x >= 12_000 && y <= 11_000)) return "BOTTOM"
  if (x >= 2_000 && x <= 13_000 && y >= 2_000 && y <= 13_000 &&
      Math.abs(x - y) <= 1_600) return "MIDDLE"
  return undefined
}

function allUnavailable(
  reason: string,
  sourceQuality: MetricSourceQualityV3,
): TimelineMetricObservationV3[] {
  return TIMELINE_METRIC_KEYS_V3.map((key) => raw(key, timelineUnavailable(reason), sourceQuality))
}

/** Derives every corrected timeline proxy without applying a display ceiling. */
export function deriveTimelineMetricObservationsV3(
  input: TimelineMetricDerivationInputV3,
): TimelineMetricObservationV3[] {
  const quality = input.sourceQuality ?? "retained"
  const timeline = input.timeline
  if (!timeline) {
    return TIMELINE_METRIC_KEYS_V3.map((key) => {
      const applicable = metricDefinitionV3(key)?.applicable({
        context: input.context,
        position: input.position,
      }) ?? true
      return raw(key, applicable
        ? timelineUnavailable("timeline_not_retained")
        : timelineNotApplicable("metric_not_applicable_to_context"), quality)
    })
  }
  if (!positiveId(input.participantId) || !Number.isSafeInteger(input.teamId)) {
    return allUnavailable("owner_timeline_identity_missing", quality)
  }
  if (!Number.isFinite(input.durationSecs) || input.durationSecs <= 0) {
    return TIMELINE_METRIC_KEYS_V3.map((key) =>
      raw(key, timelineInvalid("match_duration_must_be_positive"), quality))
  }

  const values = new Map<TimelineMetricKeyV3, TimelineMetricObservationV3>()
  const set = (
    key: TimelineMetricKeyV3,
    evidence: Evidence<number>,
    details: Pick<RawMetricObservationV3, "numerator" | "denominator" | "opportunityCount"> = {},
  ) => values.set(key, raw(key, evidence, quality, details))
  const setRate = (key: TimelineMetricKeyV3, numerator: number, denominator: number, reason: string) =>
    set(key, ratioEvidence(numerator, denominator, reason), detailsForRate(numerator, denominator))
  const teams = teamEntries(input)
  const kills = timeline.events
    .filter((event) => event.type === "CHAMPION_KILL")
    .sort(stableEventOrder)
  const objectives = timeline.events
    .filter((event) => event.type === "ELITE_MONSTER_KILL")
    .sort(stableEventOrder)
  const structures = timeline.events
    .filter((event) => event.type === "BUILDING_KILL")
    .sort(stableEventOrder)
  const clustersEvidence = clusterTimelineFightsV3(kills)

  if (clustersEvidence.state !== "observed") {
    for (const key of [
      "pick_conversion_rate", "duel_outcome_rate", "teamfight_participation_rate",
      "teamfight_outcome_rate", "skirmish_outcome_rate",
      "recorded_fight_involvement_per_min", "isolated_death_rate",
      "outnumbered_death_rate", "teamfight_survival_rate",
      "solo_pressure_outcome_rate",
    ] as const) set(key, timelineUnavailable(clustersEvidence.reason ?? "fight_clusters_unavailable"))
  } else {
    const clusters = clustersEvidence.value
    const incompleteTeams = clusters.some((cluster) =>
      cluster.participantIds.some((participantId) => !teams.has(participantId)))
    if (incompleteTeams) {
      for (const key of [
        "pick_conversion_rate", "duel_outcome_rate", "teamfight_participation_rate",
        "teamfight_outcome_rate", "skirmish_outcome_rate", "isolated_death_rate",
        "outnumbered_death_rate", "teamfight_survival_rate", "solo_pressure_outcome_rate",
      ] as const) set(key, timelineUnavailable("fight_participant_team_identity_missing"))
    } else {
      const involved = clusters.filter((cluster) => cluster.participantIds.includes(input.participantId))
      const outcomeRate = (
        key: TimelineMetricKeyV3,
        selected: readonly TimelineFightClusterV3[],
        reason: string,
      ) => {
        const outcomes = selected.map((cluster) => fightOutcome(cluster, input.teamId, teams))
        if (outcomes.some((entry) => entry === undefined)) {
          set(key, timelineUnavailable("fight_outcome_team_identity_missing"))
          return
        }
        const total = (outcomes as number[]).reduce((sum, entry) => sum + entry, 0)
        set(key, selected.length === 0 ? timelineNoOpportunity(reason) : timelineObserved(total / selected.length), {
          numerator: total,
          denominator: selected.length,
          opportunityCount: selected.length,
        })
      }
      outcomeRate("pick_conversion_rate", involved.filter((cluster) => cluster.pick),
        "no_involved_pick_clusters")
      outcomeRate("duel_outcome_rate", involved.filter((cluster) => cluster.classification === "duel"),
        "no_involved_duel_clusters")
      outcomeRate("skirmish_outcome_rate",
        involved.filter((cluster) => cluster.classification === "skirmish"),
        "no_involved_skirmish_clusters")
      outcomeRate("teamfight_outcome_rate",
        involved.filter((cluster) => cluster.classification === "teamfight"),
        "no_involved_teamfight_clusters")
      outcomeRate("solo_pressure_outcome_rate",
        involved.filter((cluster) => cluster.classification === "duel"),
        "no_involved_solo_clusters")

      const teamfightOpportunities = clusters.filter((cluster) =>
        cluster.classification === "teamfight" &&
        cluster.participantIds.some((participantId) => teams.get(participantId) === input.teamId))
      const involvedTeamfights = teamfightOpportunities.filter((cluster) =>
        cluster.participantIds.includes(input.participantId))
      setRate("teamfight_participation_rate", involvedTeamfights.length,
        teamfightOpportunities.length, "no_recorded_teamfight_clusters")
      const survived = involvedTeamfights.filter((cluster) =>
        !cluster.events.some((event) => event.targetId === input.participantId)).length
      setRate("teamfight_survival_rate", survived, involvedTeamfights.length,
        "no_involved_teamfight_clusters")

      const deathClusters = clusters.filter((cluster) =>
        cluster.events.some((event) => event.targetId === input.participantId))
      const isolated = deathClusters.filter((cluster) =>
        cluster.participantIds.every((participantId) => participantId === input.participantId ||
          teams.get(participantId) !== input.teamId)).length
      const outnumbered = deathClusters.filter((cluster) => {
        const allies = cluster.participantIds.filter((participantId) =>
          participantId !== input.participantId && teams.get(participantId) === input.teamId).length
        const enemies = cluster.participantIds.filter((participantId) =>
          teams.get(participantId) !== input.teamId).length
        return enemies > allies
      }).length
      setRate("isolated_death_rate", isolated, deathClusters.length, "player_had_no_recorded_deaths")
      setRate("outnumbered_death_rate", outnumbered, deathClusters.length, "player_had_no_recorded_deaths")
    }
    const involvedCount = clustersEvidence.value.filter((cluster) =>
      cluster.participantIds.includes(input.participantId)).length
    set("recorded_fight_involvement_per_min",
      timelineObserved(involvedCount * 60 / input.durationSecs), {
        numerator: involvedCount,
        denominator: input.durationSecs,
        opportunityCount: clustersEvidence.value.length,
      })
  }

  const ownerDeaths = kills.filter((event) => event.targetId === input.participantId)
  if (!isRift(input.context)) {
    set("forward_death_share", timelineNotApplicable("forward_map_proxy_not_applicable"))
    set("pre_objective_deaths_per_opportunity",
      timelineNotApplicable("ruleset_has_no_rift_objectives"))
  } else {
    const forwardDeaths = ownerDeaths.map((event) => isForward(event.position, input.teamId))
    if (forwardDeaths.some((entry) => entry === undefined)) {
      set("forward_death_share", timelineUnavailable("forward_death_position_or_team_missing"))
    } else {
      const count = forwardDeaths.filter(Boolean).length
      setRate("forward_death_share", count, ownerDeaths.length, "player_had_no_recorded_deaths")
    }

    if (objectives.length === 0) {
      set("pre_objective_deaths_per_opportunity",
        timelineNoOpportunity("no_retained_neutral_objectives"), detailsForRate(0, 0))
    } else if (ownerDeaths.some((event) => !finitePoint(event.position)) ||
        objectives.some((event) => !finitePoint(event.position))) {
      set("pre_objective_deaths_per_opportunity",
        timelineUnavailable("pre_objective_spatial_evidence_missing"))
    } else {
      const qualifying = ownerDeaths.filter((death) => {
        const next = objectives.find((objective) =>
          objective.timestamp >= death.timestamp &&
          objective.timestamp - death.timestamp <= RVI_V3_PRE_OBJECTIVE_WINDOW_MS)
        return next !== undefined && Math.hypot(
          next.position!.x - death.position!.x,
          next.position!.y - death.position!.y,
        ) <= RVI_V3_PRE_OBJECTIVE_RADIUS
      }).length
      setRate("pre_objective_deaths_per_opportunity", qualifying, objectives.length,
        "no_retained_neutral_objectives")
    }
  }

  const phaseMetric = (
    key: TimelineMetricKeyV3,
    minute: number,
    field: "gold" | "cs" | "xp",
  ) => {
    if (!isRift(input.context)) {
      set(key, timelineNotApplicable("opposing_role_phase_delta_not_applicable"))
      return
    }
    if (!positiveId(input.opponentParticipantId)) {
      set(key, timelineUnavailable("exact_opposing_role_not_resolved"))
      return
    }
    const timestamp = minute * 60_000
    const frame = nearestFrame(timeline.frames, timestamp, RVI_V3_PHASE_FRAME_TOLERANCE_MS)
    const owner = frameParticipant(frame, input.participantId)
    const opponent = frameParticipant(frame, input.opponentParticipantId)
    if (!frame || !owner || !opponent) {
      set(key, timelineUnavailable("phase_frame_not_within_30_seconds"))
      return
    }
    const value = field === "gold"
      ? owner.totalGold - opponent.totalGold
      : field === "xp"
        ? owner.xp - opponent.xp
        : owner.minionsKilled + owner.jungleMinionsKilled -
          opponent.minionsKilled - opponent.jungleMinionsKilled
    if (!Number.isFinite(value)) set(key, timelineInvalid("phase_delta_not_finite"))
    else set(key, timelineObserved(value))
  }
  for (const minute of [10, 15, 20, 30] as const) {
    phaseMetric(`gold_delta_${minute}`, minute, "gold")
    phaseMetric(`cs_delta_${minute}`, minute, "cs")
  }
  phaseMetric("xp_delta_10", 10, "xp")
  phaseMetric("xp_delta_15", 15, "xp")

  const objectiveTeamUnknown = objectives.some((event) => eventTeam(event, teams) === undefined)
  const teamObjectives = objectives.filter((event) => eventTeam(event, teams) === input.teamId)
  const participationRate = (
    key: TimelineMetricKeyV3,
    selected: readonly CompactTimelineEvent[],
    zeroReason: string,
  ) => {
    if (objectiveTeamUnknown) {
      set(key, timelineUnavailable("objective_team_identity_missing"))
      return
    }
    let incomplete = false
    let count = 0
    for (const event of selected) {
      if (directlyParticipates(event, input.participantId)) {
        count += 1
        continue
      }
      const ownerPoint = participantPointNear(timeline, input.participantId, event.timestamp)
      if (!ownerPoint || !finitePoint(event.position)) {
        incomplete = true
        continue
      }
      if (Math.hypot(ownerPoint.x - event.position.x, ownerPoint.y - event.position.y) <=
          RVI_V3_OBJECTIVE_PROXIMITY_RADIUS) count += 1
    }
    if (incomplete) set(key, timelineUnavailable("objective_proximity_evidence_missing"))
    else setRate(key, count, selected.length, zeroReason)
  }

  if (!isRift(input.context)) {
    for (const key of [
      "objective_participation_rate", "dragon_participation_rate",
      "herald_participation_rate", "baron_participation_rate",
      "objective_secure_rate", "objective_proximity_rate",
      "structure_takedown_participation_rate", "baron_conversion_gold_delta",
      "objective_setup_ward_rate", "early_structure_participation",
      "early_objective_participation",
    ] as const) set(key, timelineNotApplicable("ruleset_has_no_rift_objective_duty"))
  } else {
    participationRate("objective_participation_rate", teamObjectives, "team_secured_no_objectives")
    participationRate("dragon_participation_rate", teamObjectives.filter(isDragon),
      "team_secured_no_dragons")
    participationRate("herald_participation_rate", teamObjectives.filter(isHerald),
      "team_secured_no_heralds")
    participationRate("baron_participation_rate", teamObjectives.filter(isBaron),
      "team_secured_no_barons")

    if (objectiveTeamUnknown) {
      set("objective_secure_rate", timelineUnavailable("objective_team_identity_missing"))
      set("objective_proximity_rate", timelineUnavailable("objective_team_identity_missing"))
    } else {
      const secured = teamObjectives.filter((event) => event.participantId === input.participantId).length
      setRate("objective_secure_rate", secured, teamObjectives.length, "team_secured_no_objectives")
      const proximities = teamObjectives.map((event) => {
        const ownerPoint = participantPointNear(timeline, input.participantId, event.timestamp)
        return ownerPoint && finitePoint(event.position)
          ? Math.hypot(ownerPoint.x - event.position.x, ownerPoint.y - event.position.y) <=
            RVI_V3_OBJECTIVE_PROXIMITY_RADIUS
          : undefined
      })
      if (proximities.some((entry) => entry === undefined)) {
        set("objective_proximity_rate", timelineUnavailable("objective_proximity_evidence_missing"))
      } else {
        setRate("objective_proximity_rate", proximities.filter(Boolean).length,
          teamObjectives.length, "team_secured_no_objectives")
      }
    }

    const structureTeamUnknown = structures.some((event) => eventTeam(event, teams) === undefined)
    const teamStructures = structures.filter((event) => eventTeam(event, teams) === input.teamId)
    if (structureTeamUnknown) {
      set("structure_takedown_participation_rate",
        timelineUnavailable("structure_team_identity_missing"))
    } else {
      const involved = teamStructures.filter((event) =>
        directlyParticipates(event, input.participantId)).length
      setRate("structure_takedown_participation_rate", involved, teamStructures.length,
        "team_took_no_recorded_structures")
    }

    const teamBarons = teamObjectives.filter(isBaron)
    if (objectiveTeamUnknown) {
      set("baron_conversion_gold_delta", timelineUnavailable("objective_team_identity_missing"))
    } else if (teamBarons.length === 0) {
      set("baron_conversion_gold_delta", timelineNoOpportunity("team_secured_no_barons"),
        { opportunityCount: 0 })
    } else {
      const deltas = teamBarons.map((event) => {
        const start = nearestFrame(timeline.frames, event.timestamp,
          RVI_V3_OBJECTIVE_FRAME_TOLERANCE_MS)
        const endTarget = Math.min(input.durationSecs * 1_000, event.timestamp + 180_000)
        const end = nearestFrame(timeline.frames, endTarget,
          RVI_V3_OBJECTIVE_FRAME_TOLERANCE_MS)
        if (!start || !end) return undefined
        const sign = input.teamId === 100 ? 1 : input.teamId === 200 ? -1 : undefined
        if (sign === undefined) return undefined
        return sign * ((end.blueGold - end.redGold) - (start.blueGold - start.redGold))
      })
      if (deltas.some((entry) => entry === undefined)) {
        set("baron_conversion_gold_delta", timelineUnavailable("baron_conversion_frames_missing"))
      } else {
        const total = (deltas as number[]).reduce((sum, entry) => sum + entry, 0)
        set("baron_conversion_gold_delta", timelineObserved(total / deltas.length), {
          numerator: total,
          denominator: deltas.length,
          opportunityCount: deltas.length,
        })
      }
    }

    if (teamObjectives.length === 0) {
      set("objective_setup_ward_rate", timelineNoOpportunity("team_secured_no_objectives"),
        detailsForRate(0, 0))
    } else if (input.wardEventsComplete !== true) {
      set("objective_setup_ward_rate", timelineUnavailable("positioned_ward_events_not_retained"))
    } else {
      const wards = timeline.events.filter((event) =>
        (event.type === "WARD_PLACED" || event.type === "WARD_KILL") &&
        event.participantId === input.participantId && eventTeam(event, teams) === input.teamId)
      let incomplete = false
      const prepared = teamObjectives.filter((objective) => wards.some((ward) => {
        const lead = objective.timestamp - ward.timestamp
        if (lead < 30_000 || lead > 90_000) return false
        if (!finitePoint(objective.position) || !finitePoint(ward.position)) {
          incomplete = true
          return false
        }
        return Math.hypot(objective.position.x - ward.position.x,
          objective.position.y - ward.position.y) <= RVI_V3_OBJECTIVE_PROXIMITY_RADIUS
      })).length
      if (incomplete) set("objective_setup_ward_rate",
        timelineUnavailable("setup_ward_position_evidence_missing"))
      else setRate("objective_setup_ward_rate", prepared, teamObjectives.length,
        "team_secured_no_objectives")
    }

    const earlyTeamStructures = teamStructures.filter((event) => event.timestamp < RVI_V3_EARLY_END_MS)
    if (structureTeamUnknown) {
      set("early_structure_participation", timelineUnavailable("structure_team_identity_missing"))
    } else {
      setRate("early_structure_participation", earlyTeamStructures.filter((event) =>
        directlyParticipates(event, input.participantId)).length, earlyTeamStructures.length,
      "team_took_no_early_structures")
    }
    participationRate("early_objective_participation",
      teamObjectives.filter((event) => event.timestamp < RVI_V3_EARLY_END_MS),
      "team_secured_no_early_objectives")
  }

  const earlyTeamKills = kills.filter((event) =>
    event.timestamp < RVI_V3_EARLY_END_MS && eventTeam(event, teams) === input.teamId)
  const earlyTeamIdentityMissing = kills.some((event) =>
    event.timestamp < RVI_V3_EARLY_END_MS && eventTeam(event, teams) === undefined)
  if (earlyTeamIdentityMissing) {
    set("early_takedown_participation", timelineUnavailable("early_kill_team_identity_missing"))
  } else {
    setRate("early_takedown_participation", earlyTeamKills.filter((event) =>
      directlyParticipates(event, input.participantId)).length, earlyTeamKills.length,
    "team_had_no_early_kills")
  }

  const contributions = kills.filter((event) =>
    eventTeam(event, teams) === input.teamId && directlyParticipates(event, input.participantId))
  if (!isRift(input.context)) {
    set("forward_takedown_share", timelineNotApplicable("forward_map_proxy_not_applicable"))
    set("solo_pressure_outcome_rate", timelineNotApplicable("solo_pressure_rift_only"))
  } else {
    const forward = contributions.map((event) => isForward(event.position, input.teamId))
    if (forward.some((entry) => entry === undefined)) {
      set("forward_takedown_share", timelineUnavailable("forward_takedown_position_or_team_missing"))
    } else {
      setRate("forward_takedown_share", forward.filter(Boolean).length, contributions.length,
        "player_had_no_recorded_takedown_contributions")
    }
  }

  const earlyContributions = contributions.filter((event) => event.timestamp < RVI_V3_EARLY_END_MS)
  if (!isRift(input.context) || (input.position !== "TOP" && input.position !== "MIDDLE" &&
      input.position !== "BOTTOM")) {
    set("spatial_early_roam_rate", timelineNotApplicable("spatial_roam_requires_lane_position"))
  } else if (!positiveId(input.opponentParticipantId)) {
    set("spatial_early_roam_rate", timelineUnavailable("exact_lane_opponent_not_resolved"))
  } else if (earlyContributions.length === 0) {
    set("spatial_early_roam_rate", timelineNoOpportunity("no_early_takedown_contributions"),
      detailsForRate(0, 0))
  } else {
    let incomplete = false
    const qualifying = earlyContributions.filter((event) => {
      const ownerPoint = participantPointNear(timeline, input.participantId, event.timestamp)
      if (!ownerPoint) {
        incomplete = true
        return false
      }
      const enemyParticipants = eventParticipants(event).filter((participantId) =>
        teams.get(participantId) !== input.teamId)
      if (enemyParticipants.some((participantId) => !teams.has(participantId))) {
        incomplete = true
        return false
      }
      return riftLaneAtV3(ownerPoint) !== input.position &&
        enemyParticipants.some((participantId) => participantId !== input.opponentParticipantId)
    }).length
    if (incomplete) set("spatial_early_roam_rate", timelineUnavailable("spatial_roam_evidence_missing"))
    else setRate("spatial_early_roam_rate", qualifying, earlyContributions.length,
      "no_early_takedown_contributions")
  }

  return TIMELINE_METRIC_KEYS_V3.map((key) => values.get(key) ??
    raw(key, timelineUnavailable("timeline_metric_derivation_incomplete"), quality))
}

export function timelineMetricEvidenceByKeyV3(
  input: TimelineMetricDerivationInputV3,
): ReadonlyMap<TimelineMetricKeyV3, TimelineMetricObservationV3> {
  return new Map(deriveTimelineMetricObservationsV3(input).map((entry) => [
    entry.metricKey,
    entry,
  ]))
}
