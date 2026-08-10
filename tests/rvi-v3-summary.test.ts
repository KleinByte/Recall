import { describe, expect, it } from "vitest"
import { defaultGradeModeContext } from
  "../electron/main/matches/grade-v3-taxonomy.js"
import {
  SUMMARY_METRIC_KEYS_V3,
  deriveSummaryMetricObservationsV3,
  type SummaryMetricParticipantV3,
} from "../electron/main/matches/rvi-v3-summary.js"
import { metricDefinitionV3 } from "../electron/main/matches/metric-registry-v3.js"

const participant = (
  participantId: number,
  overrides: Partial<SummaryMetricParticipantV3> = {},
): SummaryMetricParticipantV3 => ({
  participantId,
  teamId: participantId <= 5 ? 100 : 200,
  kills: 0,
  deaths: 0,
  assists: 0,
  damageToChampions: 0,
  goldEarned: 10_000,
  totalMinionsKilled: 100,
  neutralMinions: 0,
  damageObjectives: 0,
  damageTurrets: 0,
  damageStructures: 0,
  visionScore: 0,
  timeCcingOthers: 0,
  damageTaken: 0,
  damageSelfMitigated: 0,
  wardsPlaced: 0,
  wardsKilled: 0,
  ...overrides,
})

describe("Recall v3 summary metric derivation", () => {
  it("emits the full inventory, duration-normalized formulas, and observed zero", () => {
    const result = deriveSummaryMetricObservationsV3({
      participantId: 1,
      durationSecs: 1_200,
      context: defaultGradeModeContext("sr"),
      participants: Array.from({ length: 10 }, (_, index) => participant(index + 1,
        index === 0
          ? { damageToChampions: 10_000, deaths: 2, kills: 2, assists: 3 }
          : index === 1 ? { damageToChampions: 10_000, kills: 3 } : {})),
    })
    expect(result).toHaveLength(SUMMARY_METRIC_KEYS_V3.length)
    const metrics = new Map(result.map((entry) => [entry.metricKey, entry]))
    expect(metrics.get("damage_share")?.rawEvidence)
      .toMatchObject({ state: "observed", value: .5 })
    expect(metrics.get("deaths_per_10")?.rawEvidence)
      .toMatchObject({ state: "observed", value: 1 })
    expect(metrics.get("champion_damage_per_min")?.rawEvidence)
      .toMatchObject({ state: "observed", value: 500 })
    expect(metrics.get("cc_seconds_per_min")?.rawEvidence)
      .toMatchObject({ state: "observed", value: 0 })
    for (const observation of result) {
      expect(observation.source, observation.metricKey)
        .toBe(metricDefinitionV3(observation.metricKey)?.source)
    }
  })

  it("marks Rift-only metrics not applicable in Howling Abyss", () => {
    const result = new Map(deriveSummaryMetricObservationsV3({
      participantId: 1,
      durationSecs: 1_200,
      context: defaultGradeModeContext("aram"),
      participants: [participant(1)],
    }).map((entry) => [entry.metricKey, entry]))
    expect(result.get("neutral_objective_damage_per_min")?.rawEvidence.state)
      .toBe("not_applicable")
    expect(result.get("vision_score_per_min")?.rawEvidence.state).toBe("not_applicable")
    expect(result.get("wards_placed_per_min")?.rawEvidence.state).toBe("not_applicable")
  })

  it("does not invent team shares from an incomplete scoreboard", () => {
    const result = new Map(deriveSummaryMetricObservationsV3({
      participantId: 1,
      durationSecs: 1_200,
      context: defaultGradeModeContext("sr"),
      participants: [participant(1, { damageToChampions: 1_000, kills: 1 })],
    }).map((entry) => [entry.metricKey, entry]))
    expect(result.get("damage_share")?.rawEvidence)
      .toMatchObject({ state: "unavailable", reason: "damage_share_requires_complete_team_source" })
    expect(result.get("kill_participation")?.rawEvidence)
      .toMatchObject({ state: "unavailable", reason: "kill_participation_requires_complete_team_source" })
  })
})
