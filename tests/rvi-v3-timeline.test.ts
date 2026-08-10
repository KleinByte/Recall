import { describe, expect, it } from "vitest"
import type {
  CompactTimeline,
  CompactTimelineEvent,
  CompactTimelineFrame,
} from "../electron/main/riot/timeline-mapper.js"
import { defaultGradeModeContext } from
  "../electron/main/matches/grade-v3-taxonomy.js"
import {
  RVI_V3_FIGHT_CLUSTER_RADIUS,
  RVI_V3_FIGHT_CLUSTER_WINDOW_MS,
  TIMELINE_METRIC_KEYS_V3,
  clusterTimelineFightsV3,
  deriveTimelineMetricObservationsV3,
} from "../electron/main/matches/rvi-v3-timeline.js"

const teams = new Map([
  [1, 100], [2, 100], [3, 100], [4, 100], [5, 100],
  [6, 200], [7, 200], [8, 200], [9, 200], [10, 200],
])

function participant(participantId: number, timestamp: number, point = { x: 7_000, y: 7_000 }) {
  return {
    participantId,
    teamId: teams.get(participantId),
    currentGold: 0,
    totalGold: 500 + timestamp / 1_000 + (participantId === 1 ? 100 : 0),
    level: 1,
    xp: 100 + timestamp / 1_000 + (participantId === 1 ? 50 : 0),
    minionsKilled: Math.floor(timestamp / 60_000) + (participantId === 1 ? 5 : 0),
    jungleMinionsKilled: 0,
    position: point,
  }
}

function frame(timestamp: number, ownerPoint = { x: 7_000, y: 7_000 }): CompactTimelineFrame {
  return {
    timestamp,
    blueGold: 10_000 + timestamp / 1_000,
    redGold: 9_000 + timestamp / 1_000,
    ownerGold: 0,
    ownerLevel: 1,
    ownerXp: 0,
    ownerCs: 0,
    participants: [...teams].map(([participantId]) =>
      participant(participantId, timestamp, participantId === 1 ? ownerPoint : undefined)),
  }
}

function event(
  eventId: string,
  timestamp: number,
  type: string,
  overrides: Partial<CompactTimelineEvent> = {},
): CompactTimelineEvent {
  return {
    eventId,
    timestamp,
    type,
    category: type === "CHAMPION_KILL" ? "kill" :
      type.startsWith("WARD_") ? "vision" : "objective",
    ...overrides,
  }
}

function timeline(events: CompactTimelineEvent[], extraFrames: CompactTimelineFrame[] = []): CompactTimeline {
  return {
    frames: [5, 10, 12, 15, 20, 30].map((minute) => frame(minute * 60_000))
      .concat(extraFrames).sort((a, b) => a.timestamp - b.timestamp),
    events,
    turningPoints: [],
  }
}

function byKey(result: ReturnType<typeof deriveTimelineMetricObservationsV3>) {
  return new Map(result.map((entry) => [entry.metricKey, entry]))
}

const rift = defaultGradeModeContext("sr")

describe("Recall v3 corrected timeline diagnostics", () => {
  it("clusters deterministically at the exact temporal and spatial boundaries", () => {
    const first = event("a", 0, "CHAMPION_KILL", {
      participantId: 1,
      targetId: 6,
      assistingParticipantIds: [],
      teamId: 100,
      position: { x: 0, y: 0 },
    })
    const boundary = event("b", RVI_V3_FIGHT_CLUSTER_WINDOW_MS, "CHAMPION_KILL", {
      participantId: 2,
      targetId: 7,
      assistingParticipantIds: [1],
      teamId: 100,
      position: { x: RVI_V3_FIGHT_CLUSTER_RADIUS, y: 0 },
    })
    const clustered = clusterTimelineFightsV3([first, boundary])
    const permuted = clusterTimelineFightsV3([boundary, first])
    expect(clustered).toEqual(permuted)
    expect(clustered.state === "observed" && clustered.value).toHaveLength(1)
    expect(clusterTimelineFightsV3([first, {
      ...boundary,
      timestamp: RVI_V3_FIGHT_CLUSTER_WINDOW_MS + 1,
    }])).toMatchObject({ state: "observed", value: [{}, {}] })
    expect(clusterTimelineFightsV3([first, {
      ...boundary,
      position: { x: RVI_V3_FIGHT_CLUSTER_RADIUS + 1, y: 0 },
    }])).toMatchObject({ state: "observed", value: [{}, {}] })
    expect(clusterTimelineFightsV3([{ ...first, position: undefined }]))
      .toMatchObject({ state: "unavailable", reason: "incomplete_spatial_fight_evidence" })
  })

  it("returns the full inventory and derives phase, objective, setup, and early evidence", () => {
    const events = [
      event("kill", 5 * 60_000, "CHAMPION_KILL", {
        participantId: 1, targetId: 7, assistingParticipantIds: [], teamId: 100,
        position: { x: 7_000, y: 7_000 },
      }),
      event("ward", 11 * 60_000, "WARD_PLACED", {
        participantId: 1, teamId: 100, position: { x: 5_100, y: 5_100 },
      }),
      event("dragon", 12 * 60_000, "ELITE_MONSTER_KILL", {
        participantId: 2, assistingParticipantIds: [1], teamId: 100,
        objective: "DRAGON", position: { x: 5_000, y: 5_000 },
      }),
      event("tower", 13 * 60_000, "BUILDING_KILL", {
        participantId: 1, teamId: 100, position: { x: 9_000, y: 9_000 },
      }),
    ]
    const result = deriveTimelineMetricObservationsV3({
      participantId: 1,
      teamId: 100,
      durationSecs: 32 * 60,
      context: rift,
      position: "MIDDLE",
      opponentParticipantId: 6,
      participantTeams: teams,
      wardEventsComplete: true,
      timeline: timeline(events, [frame(11 * 60_000, { x: 5_100, y: 5_100 })]),
    })
    expect(result).toHaveLength(TIMELINE_METRIC_KEYS_V3.length)
    expect(new Set(result.map((entry) => entry.metricKey)).size).toBe(result.length)
    const metrics = byKey(result)
    expect(metrics.get("gold_delta_10")?.rawEvidence)
      .toMatchObject({ state: "observed", value: 100 })
    expect(metrics.get("cs_delta_10")?.rawEvidence)
      .toMatchObject({ state: "observed", value: 5 })
    expect(metrics.get("objective_participation_rate")?.rawEvidence)
      .toMatchObject({ state: "observed", value: 1 })
    expect(metrics.get("objective_setup_ward_rate")?.rawEvidence)
      .toMatchObject({ state: "observed", value: 1 })
    expect(metrics.get("early_structure_participation")?.rawEvidence)
      .toMatchObject({ state: "observed", value: 1 })
    expect(metrics.get("early_objective_participation")?.rawEvidence)
      .toMatchObject({ state: "observed", value: 1 })
  })

  it("keeps mode exclusions, missing opponent evidence, and zero opportunities distinct", () => {
    const empty = timeline([])
    const aramMetrics = byKey(deriveTimelineMetricObservationsV3({
      participantId: 1,
      teamId: 100,
      durationSecs: 20 * 60,
      context: defaultGradeModeContext("aram"),
      timeline: empty,
      participantTeams: teams,
    }))
    expect(aramMetrics.get("objective_participation_rate")?.rawEvidence.state)
      .toBe("not_applicable")
    expect(aramMetrics.get("recorded_fight_involvement_per_min")?.rawEvidence)
      .toMatchObject({ state: "observed", value: 0 })
    expect(aramMetrics.get("duel_outcome_rate")?.rawEvidence.state).toBe("no_opportunity")

    const riftMetrics = byKey(deriveTimelineMetricObservationsV3({
      participantId: 1,
      teamId: 100,
      durationSecs: 20 * 60,
      context: rift,
      position: "MIDDLE",
      timeline: empty,
      participantTeams: teams,
    }))
    expect(riftMetrics.get("gold_delta_10")?.rawEvidence)
      .toMatchObject({ state: "unavailable", reason: "exact_opposing_role_not_resolved" })
    expect(riftMetrics.get("objective_setup_ward_rate")?.rawEvidence.state)
      .toBe("no_opportunity")
  })

  it("returns a reasoned full inventory when no timeline was retained", () => {
    const riftMetrics = byKey(deriveTimelineMetricObservationsV3({
      participantId: 1,
      teamId: 100,
      durationSecs: 20 * 60,
      context: rift,
      position: "MIDDLE",
      participantTeams: teams,
    }))
    expect(riftMetrics.size).toBe(TIMELINE_METRIC_KEYS_V3.length)
    expect(riftMetrics.get("teamfight_outcome_rate")?.rawEvidence)
      .toMatchObject({ state: "unavailable", reason: "timeline_not_retained" })
    expect(riftMetrics.get("objective_setup_ward_rate")?.rawEvidence)
      .toMatchObject({ state: "unavailable", reason: "timeline_not_retained" })

    const aramMetrics = byKey(deriveTimelineMetricObservationsV3({
      participantId: 1,
      teamId: 100,
      durationSecs: 20 * 60,
      context: defaultGradeModeContext("aram"),
    }))
    expect(aramMetrics.get("teamfight_outcome_rate")?.rawEvidence)
      .toMatchObject({ state: "unavailable", reason: "timeline_not_retained" })
    expect(aramMetrics.get("objective_setup_ward_rate")?.rawEvidence.state)
      .toBe("not_applicable")
  })

  it("counts the exact pre-objective temporal and spatial boundary", () => {
    const death = event("death", 11 * 60_000, "CHAMPION_KILL", {
      participantId: 6, targetId: 1, assistingParticipantIds: [], teamId: 200,
      position: { x: 5_000, y: 5_000 },
    })
    const objective = event("objective", 12 * 60_000, "ELITE_MONSTER_KILL", {
      participantId: 6, assistingParticipantIds: [], teamId: 200,
      objective: "DRAGON", position: { x: 7_500, y: 5_000 },
    })
    const atBoundary = byKey(deriveTimelineMetricObservationsV3({
      participantId: 1,
      teamId: 100,
      durationSecs: 20 * 60,
      context: rift,
      position: "MIDDLE",
      opponentParticipantId: 6,
      participantTeams: teams,
      timeline: timeline([death, objective]),
    }))
    expect(atBoundary.get("pre_objective_deaths_per_opportunity")?.rawEvidence)
      .toMatchObject({ state: "observed", value: 1 })
    const outside = byKey(deriveTimelineMetricObservationsV3({
      participantId: 1,
      teamId: 100,
      durationSecs: 20 * 60,
      context: rift,
      position: "MIDDLE",
      opponentParticipantId: 6,
      participantTeams: teams,
      timeline: timeline([death, { ...objective, timestamp: 12 * 60_000 + 1 }]),
    }))
    expect(outside.get("pre_objective_deaths_per_opportunity")?.rawEvidence)
      .toMatchObject({ state: "observed", value: 0 })
  })

  it("never treats a ward purchase as objective setup", () => {
    const objective = event("objective", 12 * 60_000, "ELITE_MONSTER_KILL", {
      participantId: 2, assistingParticipantIds: [1], teamId: 100,
      objective: "DRAGON", position: { x: 5_000, y: 5_000 },
    })
    const purchase = event("purchase", 11 * 60_000, "ITEM_PURCHASED", {
      category: "item", participantId: 1, teamId: 100, itemId: 2055,
    })
    const metrics = byKey(deriveTimelineMetricObservationsV3({
      participantId: 1,
      teamId: 100,
      durationSecs: 20 * 60,
      context: rift,
      position: "MIDDLE",
      opponentParticipantId: 6,
      participantTeams: teams,
      wardEventsComplete: true,
      timeline: timeline([purchase, objective]),
    }))
    expect(metrics.get("objective_setup_ward_rate")?.rawEvidence)
      .toMatchObject({ state: "observed", value: 0 })
  })
})
