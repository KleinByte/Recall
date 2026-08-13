import { describe, expect, it } from "vitest"
import { noOpportunity, observed, unavailable } from "../src/shared/measurement.js"
import {
  componentScore,
  magnitudeScore,
  rankPercentile,
  scoreMatchLobby,
  type MatchGradeLobbyInput,
  type MatchGradeParticipantInput,
} from "../electron/main/matches/match-grade.js"
import {
  CURRENT_GRADE_EVIDENCE_POLICY_ID,
  MATCH_GRADE_METRIC_KEYS,
  MATCH_GRADE_SCORE_THRESHOLDS,
  gradeForRecallScore,
} from "../electron/main/matches/match-grade-recipe.js"
import {
  PRIMARY_ARCHETYPES,
  defaultGradeModeContext,
} from "../electron/main/matches/match-grade-taxonomy.js"
import type { NormalizedPosition } from "../electron/main/matches/position.js"

const positions: NormalizedPosition[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]

const evidence = (value = .5) => Object.fromEntries(
  MATCH_GRADE_METRIC_KEYS.map((metric) => [metric, observed(value, { source: "derived" })]),
) as MatchGradeParticipantInput["metricEvidence"]

const players = (): MatchGradeParticipantInput[] => Array.from({ length: 10 }, (_, index) => ({
  participantId: index + 1,
  teamId: index < 5 ? 100 : 200,
  isPlayer: index === 0,
  position: positions[index % positions.length],
  primaryArchetype: "specialist",
  metricEvidence: evidence(),
  responsibilityEvidence: observed(.5, { source: "derived" }),
  peerCount: 80,
  comparisonScope: "role",
}))

const prepared = (rows = players()): MatchGradeLobbyInput => ({
  players: rows,
  context: {
    modeFamily: "sr",
    trackedMode: "sr_ranked_solo",
    ruleset: "standard_sr",
    rulesetKey: "sr-ranked-standard-rules-r1",
  },
  calibrationSnapshotId: "sha256.deadbeef",
})
describe("match Grade compatibility math exports", () => {
  it("keeps fair ties and a neutral one-peer rank", () => {
    expect(rankPercentile([1], 1)).toBe(.5)
    expect(rankPercentile([1, 2, 2, 4], 2)).toBe(.5)
  })

  it("keeps the old magnitude helper isolated from the canonical core", () => {
    expect(magnitudeScore([0, 10], 10)).toBe(1)
    expect(magnitudeScore([0, 10], 0, "inverse")).toBe(1)
    expect(componentScore([0, 10], 10)).toMatchObject({
      rankPercentile: 1,
      magnitudeScore: 1,
      componentScore: .75,
    })
  })
})

describe("match Grade pure scoring contract", () => {
  it("scores ten players with absolute Recall Score and a separate lobby percentile", () => {
    const outcome = scoreMatchLobby(prepared())
    expect(outcome.status).toBe("ready")
    expect(outcome.results.size).toBe(10)
    const result = outcome.results.get(1)!
    expect(result.recallScore).toBeCloseTo(50)
    expect(result.breakdown.rawResponsibilityScore).toBeCloseTo(50)
    expect(result.gradeScore).toBeCloseTo(0)
    expect(result.grade).toBe("B+")
    expect(result.lobbyPercentile).toBe(.5)
    expect(result.compositePercentile).toBe(result.lobbyPercentile)
    expect(result.breakdown.recipeId).toContain("@calibration:sha256.deadbeef")
    expect(result.breakdown).toMatchObject({
      evidencePolicyVersion: CURRENT_GRADE_EVIDENCE_POLICY_ID,
      positionResolverVersion: expect.any(Number),
      gradeCoreFactContractVersion: expect.any(Number),
    })
    expect(result.breakdown.components.reduce((sum, component) => sum + component.weight, 0) +
      result.breakdown.neutralizedResponsibilityWeight).toBeCloseTo(1)
    expect(result.breakdown.components.reduce(
      (sum, component) => sum + component.contribution,
      result.breakdown.neutralizedResponsibilityContribution,
    )).toBeCloseTo(result.breakdown.rawResponsibilityScore / 100)
  })

  it("uses the frozen composite percentile, not the raw arithmetic composite, for letters", () => {
    const rows = players()
    rows[0].metricEvidence = evidence(.9)
    rows[0].responsibilityEvidence = observed(.2, {
      source: "derived",
      reason: "local_shrunk",
    })

    const result = scoreMatchLobby(prepared(rows)).results.get(1)!
    expect(result.breakdown.rawResponsibilityScore).toBeCloseTo(90)
    expect(result.recallScore).toBeCloseTo(20)
    expect(result.grade).toBe("C+")
    expect(result.gradeScore).toBeCloseTo(-.841621, 5)
  })

  it("withholds a grade when the final composite reference is unavailable", () => {
    const rows = players()
    rows[0].responsibilityEvidence = unavailable("composite_reference_population_too_small")
    expect(scoreMatchLobby(prepared(rows))).toMatchObject({
      status: "missing_core_metric",
      reason: "participant:1:role_fit:composite_reference_population_too_small",
    })
  })

  it.each(MATCH_GRADE_SCORE_THRESHOLDS)(
    "maps %s directly from a Recall Score of %f",
    (grade, minimum) => {
      expect(gradeForRecallScore(minimum)).toBe(grade)
    },
  )

  it("keeps the core-only arm unchanged on its fixed declared denominator", () => {
    const rows = players()
    rows[0].primaryArchetype = "marksman"
    rows[0].position = "BOTTOM"
    rows[0].metricEvidence.damage_share = observed(.9)
    rows[0].metricEvidence.kill_participation = observed(.1)
    const result = scoreMatchLobby(prepared(rows)).results.get(1)!
    const combat = result.breakdown.components.find((entry) => entry.key === "combat")!
    expect(combat.componentScore).toBeCloseTo(.5)
    expect(combat.signals.map((entry) => entry.weight)).toEqual([.5, .5])
  })

  it("assigns missing secondary mass to the core bundle without observing it", () => {
    const rows = players()
    rows[0].position = "UTILITY"
    rows[0].metricEvidence.cc_seconds_per_min = observed(.2)
    rows[0].metricEvidence.ally_heal_shield_per_min = observed(.8)
    rows[0].detailMetricEvidence = {
      team_protection_share: unavailable("not_collected"),
    }

    const control = scoreMatchLobby(prepared(rows)).results.get(1)!
      .breakdown.components.find((entry) => entry.key === "control_utility")!

    // .7 * .2 + .2 * .8 + the missing .1 inheriting the .2 CORE bundle.
    expect(control.componentScore).toBeCloseTo(.32)
    expect(control.signals).toEqual([
      expect.objectContaining({ key: "cc_seconds_per_min", percentile: .2, weight: .8 }),
      expect.objectContaining({ key: "ally_heal_shield_per_min", percentile: .8, weight: .2 }),
    ])
    expect(control.signals.some((entry) => entry.key === "team_protection_share")).toBe(false)
  })

  it("keeps absent, unavailable, and no-opportunity optional rows composite-neutral", () => {
    const score = (detailMetricEvidence?: MatchGradeParticipantInput["detailMetricEvidence"]) => {
      const rows = players()
      rows[0].metricEvidence.damage_share = observed(.2)
      rows[0].metricEvidence.kill_participation = observed(.8)
      rows[0].detailMetricEvidence = detailMetricEvidence
      return scoreMatchLobby(prepared(rows)).results.get(1)!.breakdown.rawResponsibilityScore
    }

    const absent = score()
    expect(score({ champion_damage_per_min: unavailable("not_collected") })).toBe(absent)
    expect(score({
      champion_damage_per_min: noOpportunity("no_recorded_fight_opportunity"),
    })).toBe(absent)
  })

  it("lets an observed secondary change the raw responsibility composite", () => {
    const baselineRows = players()
    baselineRows[0].metricEvidence.damage_share = observed(.2)
    baselineRows[0].metricEvidence.kill_participation = observed(.2)
    const baseline = scoreMatchLobby(prepared(baselineRows)).results.get(1)!
      .breakdown.rawResponsibilityScore

    const enrichedRows = players()
    enrichedRows[0].metricEvidence.damage_share = observed(.2)
    enrichedRows[0].metricEvidence.kill_participation = observed(.2)
    enrichedRows[0].detailMetricEvidence = { champion_damage_per_min: observed(1) }
    const enriched = scoreMatchLobby(prepared(enrichedRows)).results.get(1)!
      .breakdown.rawResponsibilityScore

    expect(enriched).toBeGreaterThan(baseline)
  })

  it("keeps unavailable Initiative off the radar and neutral in the composite", () => {
    const baselineRows = players()
    const baseline = scoreMatchLobby(prepared(baselineRows)).results.get(1)!

    const unavailableRows = players()
    unavailableRows[0].detailMetricEvidence = {
      early_takedown_participation: unavailable("timeline_missing"),
      spatial_early_roam_rate: noOpportunity("no_roam_opportunity"),
      early_structure_participation: unavailable("timeline_missing"),
      early_objective_participation: unavailable("timeline_missing"),
    }
    const missing = scoreMatchLobby(prepared(unavailableRows)).results.get(1)!
    expect(missing.breakdown.rawResponsibilityScore)
      .toBe(baseline.breakdown.rawResponsibilityScore)
    expect(missing.breakdown.components.some((entry) =>
      entry.key === "initiative_pressure")).toBe(false)
    expect(missing.breakdown.omittedComponents).toContainEqual(expect.objectContaining({
      key: "initiative_pressure",
    }))
    expect(missing.breakdown.neutralizedResponsibilityWeight).toBeGreaterThan(0)

    const observedRows = players()
    observedRows[0].detailMetricEvidence = { early_takedown_participation: observed(1) }
    const observedInitiative = scoreMatchLobby(prepared(observedRows)).results.get(1)!
    expect(observedInitiative.breakdown.rawResponsibilityScore)
      .toBeGreaterThan(baseline.breakdown.rawResponsibilityScore)
    expect(observedInitiative.breakdown.components.find((entry) =>
      entry.key === "initiative_pressure")).toMatchObject({
      componentScore: 1,
      signals: [expect.objectContaining({
        key: "early_takedown_participation",
        weight: 1,
      })],
    })
    expect(observedInitiative.breakdown.neutralizedResponsibilityWeight).toBe(0)
    expect(observedInitiative.breakdown.components.find((entry) => entry.key === "combat")?.weight)
      .toBe(baseline.breakdown.components.find((entry) => entry.key === "combat")?.weight)
  })

  it("preserves an observed zero instead of treating it as missing", () => {
    const rows = players()
    rows[0].metricEvidence.damage_share = observed(0)
    rows[0].metricEvidence.kill_participation = observed(0)
    const outcome = scoreMatchLobby(prepared(rows))
    expect(outcome.status).toBe("ready")
    expect(outcome.results.get(1)?.breakdown.components.find((entry) => entry.key === "combat"))
      .toMatchObject({ componentScore: 0, evidenceState: "observed" })
  })

  it("persists no-opportunity provenance after neutral scoring", () => {
    const rows = players()
    rows[0].metricEvidence.kill_participation = observed(.5, {
      source: "derived",
      reason: "team_had_no_kills",
    })
    rows[0].metricProvenance = {
      kill_participation: {
        state: "no_opportunity",
        reason: "team_had_no_kills",
      },
    }
    const signal = scoreMatchLobby(prepared(rows)).results.get(1)!.breakdown.components
      .find((entry) => entry.key === "combat")!.signals
      .find((entry) => entry.key === "kill_participation")
    expect(signal).toMatchObject({
      percentile: .5,
      sourceEvidenceState: "no_opportunity",
      sourceEvidenceReason: "team_had_no_kills",
    })
  })

  it("lets calibrated optional evidence contribute inside its arm", () => {
    const rows = players()
    rows[0].metricEvidence.ally_heal_shield_per_min = observed(.73, {
      source: "derived",
      reason: "local_shrunk",
    })
    const control = scoreMatchLobby(prepared(rows)).results.get(1)!
      .breakdown.components.find((entry) => entry.key === "control_utility")!
    expect(control.signals).toContainEqual(expect.objectContaining({
      key: "ally_heal_shield_per_min",
      percentile: .73,
      sourceEvidenceState: "observed",
      calibrationReason: "local_shrunk",
    }))
    expect(control.componentScore).toBeGreaterThan(.5)
  })

  it.each(PRIMARY_ARCHETYPES)(
    "keeps %s gradable when diagnostic ally sustain is unavailable",
    (archetype) => {
      const rows = players()
      rows[0].primaryArchetype = archetype
      // Utility makes control a responsibility for every archetype, so this
      // exercises the signal contract rather than a diagnostic family tier.
      rows[0].position = "UTILITY"
      rows[0].metricEvidence.cc_seconds_per_min = observed(0)
      rows[0].metricEvidence.ally_heal_shield_per_min = unavailable("not_collected")

      const outcome = scoreMatchLobby(prepared(rows))
      expect(outcome.status).toBe("ready")
      expect(outcome.results.get(1)?.breakdown.components.find(
        (entry) => entry.key === "control_utility",
      )).toMatchObject({
        componentScore: 0,
        evidenceState: "observed",
        signals: [{ key: "cc_seconds_per_min", percentile: 0, weight: 1 }],
      })
    },
  )

  it("withholds the whole result when required evidence is missing", () => {
    const rows = players()
    rows[0].primaryArchetype = "marksman"
    rows[0].position = "BOTTOM"
    rows[0].metricEvidence.damage_share = unavailable("source_absent")
    expect(scoreMatchLobby(prepared(rows))).toMatchObject({
      status: "missing_core_metric",
      results: new Map(),
      reason: "participant:1:combat:damage_share:source_absent",
    })
  })

  it("omits zero-responsibility or optional-only arms without invalidating Grade", () => {
    const rows = players()
    rows[0].primaryArchetype = "marksman"
    rows[0].position = "BOTTOM"
    rows[0].metricEvidence.vision_score_per_min = unavailable("not_collected")
    rows[0].metricEvidence.cc_seconds_per_min = unavailable("not_collected")
    const outcome = scoreMatchLobby(prepared(rows))
    expect(outcome.status).toBe("ready")
    const breakdown = outcome.results.get(1)!.breakdown
    expect(breakdown.responsibilityTiers).toMatchObject({
      vision_setup: 0,
      control_utility: 0,
    })
    expect(breakdown.omittedComponents.map((entry) => entry.key)).toEqual([
      "control_utility",
      "vision_setup",
      "initiative_pressure",
    ])
    expect(breakdown.components.reduce((sum, component) => sum + component.weight, 0) +
      breakdown.neutralizedResponsibilityWeight).toBeCloseTo(1)
    expect(breakdown.neutralizedResponsibilityWeight).toBeGreaterThan(0)
  })

  it("is monotone in every higher-is-better evidenced percentile", () => {
    for (let step = 0; step <= 20; step += 1) {
      const rows = players()
      rows[0].metricEvidence.damage_share = observed(step / 40)
      const before = scoreMatchLobby(prepared(rows)).results.get(1)!
        .breakdown.rawResponsibilityScore
      rows[0].metricEvidence.damage_share = observed(step / 40 + .25)
      const after = scoreMatchLobby(prepared(rows)).results.get(1)!
        .breakdown.rawResponsibilityScore
      expect(after).toBeGreaterThanOrEqual(before)
    }
  })

  it("is deterministic under input ordering", () => {
    const forward = scoreMatchLobby(prepared(players()))
    const reversed = scoreMatchLobby(prepared(players().reverse()))
    expect([...reversed.results.entries()]).toEqual([...forward.results.entries()])
  })

  it.each([
    players().slice(0, 9),
    players().map((row, index) => index === 9 ? { ...row, participantId: 1 } : row),
    players().map((row) => ({ ...row, isPlayer: false })),
    players().map((row, index) => ({ ...row, isPlayer: index < 2 })),
    players().map((row, index) => index === 9 ? { ...row, teamId: 100 } : row),
  ])("rejects malformed lobby shape", (rows) => {
    expect(scoreMatchLobby(prepared(rows)).status).toBe("incomplete_lobby")
  })

  it("requires an immutable calibration snapshot identity", () => {
    expect(scoreMatchLobby({ ...prepared(), calibrationSnapshotId: "current snapshot" }))
      .toMatchObject({ status: "missing_source_fact", reason: "invalid_calibration_snapshot_id" })
  })

  it("rejects mismatched mode/ruleset context", () => {
    const input = prepared()
    input.context = { ...input.context, ruleset: "howling_abyss" }
    expect(scoreMatchLobby(input).status).toBe("unsupported_mode")
  })
})

describe("match Grade mode context", () => {
  it("uses an explicit compatibility ruleset context", () => {
    expect(defaultGradeModeContext("classic")).toMatchObject({
      trackedMode: "league_classic",
      ruleset: "league_classic",
    })
  })
})
