import { describe, expect, it } from "vitest"
import { noOpportunity, observed, unavailable } from "../src/shared/measurement.js"
import {
  componentScore,
  gradeLobbyV3,
  magnitudeScore,
  rankPercentile,
  scoreLobbyV3,
  type GradeLobbyV3Input,
  type GradePlayerV3Input,
} from "../electron/main/matches/grade-v3.js"
import {
  GRADE_METRICS,
  GRADE_V3_ROLE_FIT_THRESHOLDS,
  gradeForRoleFitScore,
} from "../electron/main/matches/grade-v3-recipe.js"
import {
  PRIMARY_ARCHETYPES,
  defaultGradeModeContext,
} from "../electron/main/matches/grade-v3-taxonomy.js"
import type { GradeInput } from "../electron/main/matches/grade.js"
import type { NormalizedPosition } from "../electron/main/matches/position.js"

const positions: NormalizedPosition[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]

const evidence = (value = .5) => Object.fromEntries(
  GRADE_METRICS.map((metric) => [metric, observed(value, { source: "derived" })]),
) as GradePlayerV3Input["metricEvidence"]

const players = (): GradePlayerV3Input[] => Array.from({ length: 10 }, (_, index) => ({
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

const prepared = (rows = players()): GradeLobbyV3Input => ({
  players: rows,
  context: {
    modeFamily: "sr",
    trackedMode: "sr_ranked_solo",
    ruleset: "standard_sr",
    rulesetKey: "sr-ranked-standard-rules-r1",
  },
  calibrationSnapshotId: "sha256.deadbeef",
})
const legacyLobby = (): GradeInput[] => Array.from({ length: 10 }, (_, index) => ({
  participantId: index + 1,
  teamId: index < 5 ? 100 : 200,
  isPlayer: index === 0,
  kills: index,
  deaths: 9 - index,
  assists: index + 1,
  damageToChampions: index * 1_000,
  damageTaken: (10 - index) * 900,
  damageMitigated: index * 300,
  goldEarned: 8_000 + index * 500,
  csPerMin: index,
  visionScore: index * 2,
  damageObjectives: index * 100,
  role: positions[index % positions.length],
}))

describe("Grade v3 compatibility math exports", () => {
  it("keeps fair ties and a neutral one-peer rank", () => {
    expect(rankPercentile([1], 1)).toBe(.5)
    expect(rankPercentile([1, 2, 2, 4], 2)).toBe(.5)
  })

  it("keeps the old magnitude helper isolated from the v3 core", () => {
    expect(magnitudeScore([0, 10], 10)).toBe(1)
    expect(magnitudeScore([0, 10], 0, "inverse")).toBe(1)
    expect(componentScore([0, 10], 10)).toMatchObject({
      rankPercentile: 1,
      magnitudeScore: 1,
      componentScore: .75,
    })
  })
})

describe("Grade v3 pure scoring contract", () => {
  it("scores ten players with absolute role fit and a separate lobby percentile", () => {
    const outcome = scoreLobbyV3(prepared())
    expect(outcome.status).toBe("ready")
    expect(outcome.results.size).toBe(10)
    const result = outcome.results.get(1)!
    expect(result.roleFitScore).toBeCloseTo(50)
    expect(result.breakdown.rawResponsibilityScore).toBeCloseTo(50)
    expect(result.gradeScore).toBeCloseTo(0)
    expect(result.grade).toBe("B+")
    expect(result.lobbyPercentile).toBe(.5)
    expect(result.compositePercentile).toBe(result.lobbyPercentile)
    expect(result.breakdown.recipeId).toContain("@calibration:sha256.deadbeef")
    expect(result.breakdown).toMatchObject({
      evidencePolicyVersion: expect.stringContaining("recall.grade.v3.evidence"),
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

    const result = scoreLobbyV3(prepared(rows)).results.get(1)!
    expect(result.breakdown.rawResponsibilityScore).toBeCloseTo(90)
    expect(result.roleFitScore).toBeCloseTo(20)
    expect(result.grade).toBe("C+")
    expect(result.gradeScore).toBeCloseTo(-.841621, 5)
  })

  it("withholds a grade when the final composite reference is unavailable", () => {
    const rows = players()
    rows[0].responsibilityEvidence = unavailable("composite_reference_population_too_small")
    expect(scoreLobbyV3(prepared(rows))).toMatchObject({
      status: "missing_core_metric",
      reason: "participant:1:role_fit:composite_reference_population_too_small",
    })
  })

  it.each(GRADE_V3_ROLE_FIT_THRESHOLDS)(
    "maps %s directly from a RoleFit score of %f",
    (grade, minimum) => {
      expect(gradeForRoleFitScore(minimum)).toBe(grade)
    },
  )

  it("keeps the core-only arm unchanged on its fixed declared denominator", () => {
    const rows = players()
    rows[0].primaryArchetype = "marksman"
    rows[0].position = "BOTTOM"
    rows[0].metricEvidence.damage_share = observed(.9)
    rows[0].metricEvidence.kill_participation = observed(.1)
    const result = scoreLobbyV3(prepared(rows)).results.get(1)!
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

    const control = scoreLobbyV3(prepared(rows)).results.get(1)!
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
    const score = (detailMetricEvidence?: GradePlayerV3Input["detailMetricEvidence"]) => {
      const rows = players()
      rows[0].metricEvidence.damage_share = observed(.2)
      rows[0].metricEvidence.kill_participation = observed(.8)
      rows[0].detailMetricEvidence = detailMetricEvidence
      return scoreLobbyV3(prepared(rows)).results.get(1)!.breakdown.rawResponsibilityScore
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
    const baseline = scoreLobbyV3(prepared(baselineRows)).results.get(1)!
      .breakdown.rawResponsibilityScore

    const enrichedRows = players()
    enrichedRows[0].metricEvidence.damage_share = observed(.2)
    enrichedRows[0].metricEvidence.kill_participation = observed(.2)
    enrichedRows[0].detailMetricEvidence = { champion_damage_per_min: observed(1) }
    const enriched = scoreLobbyV3(prepared(enrichedRows)).results.get(1)!
      .breakdown.rawResponsibilityScore

    expect(enriched).toBeGreaterThan(baseline)
  })

  it("keeps unavailable Initiative off the radar and neutral in the composite", () => {
    const baselineRows = players()
    const baseline = scoreLobbyV3(prepared(baselineRows)).results.get(1)!

    const unavailableRows = players()
    unavailableRows[0].detailMetricEvidence = {
      early_takedown_participation: unavailable("timeline_missing"),
      spatial_early_roam_rate: noOpportunity("no_roam_opportunity"),
      early_structure_participation: unavailable("timeline_missing"),
      early_objective_participation: unavailable("timeline_missing"),
    }
    const missing = scoreLobbyV3(prepared(unavailableRows)).results.get(1)!
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
    const observedInitiative = scoreLobbyV3(prepared(observedRows)).results.get(1)!
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
    const outcome = scoreLobbyV3(prepared(rows))
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
    const signal = scoreLobbyV3(prepared(rows)).results.get(1)!.breakdown.components
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
    const control = scoreLobbyV3(prepared(rows)).results.get(1)!
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

      const outcome = scoreLobbyV3(prepared(rows))
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
    expect(scoreLobbyV3(prepared(rows))).toMatchObject({
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
    const outcome = scoreLobbyV3(prepared(rows))
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
      const before = scoreLobbyV3(prepared(rows)).results.get(1)!
        .breakdown.rawResponsibilityScore
      rows[0].metricEvidence.damage_share = observed(step / 40 + .25)
      const after = scoreLobbyV3(prepared(rows)).results.get(1)!
        .breakdown.rawResponsibilityScore
      expect(after).toBeGreaterThanOrEqual(before)
    }
  })

  it("is deterministic under input ordering", () => {
    const forward = scoreLobbyV3(prepared(players()))
    const reversed = scoreLobbyV3(prepared(players().reverse()))
    expect([...reversed.results.entries()]).toEqual([...forward.results.entries()])
  })

  it.each([
    players().slice(0, 9),
    players().map((row, index) => index === 9 ? { ...row, participantId: 1 } : row),
    players().map((row) => ({ ...row, isPlayer: false })),
    players().map((row, index) => ({ ...row, isPlayer: index < 2 })),
    players().map((row, index) => index === 9 ? { ...row, teamId: 100 } : row),
  ])("rejects malformed lobby shape", (rows) => {
    expect(scoreLobbyV3(prepared(rows)).status).toBe("incomplete_lobby")
  })

  it("requires an immutable calibration snapshot identity", () => {
    expect(scoreLobbyV3({ ...prepared(), calibrationSnapshotId: "current snapshot" }))
      .toMatchObject({ status: "missing_source_fact", reason: "invalid_calibration_snapshot_id" })
  })

  it("rejects mismatched mode/ruleset context", () => {
    const input = prepared()
    input.context = { ...input.context, ruleset: "howling_abyss" }
    expect(scoreLobbyV3(input).status).toBe("unsupported_mode")
  })
})

describe("legacy Grade v3 entry point", () => {
  it("keeps shape, mode, and forced-status compatibility", () => {
    expect(gradeLobbyV3(legacyLobby().slice(0, 9), "sr").status).toBe("incomplete_lobby")
    expect(gradeLobbyV3(legacyLobby(), "other").status).toBe("unsupported_mode")
    expect(gradeLobbyV3(legacyLobby(), "sr", "short_game")).toMatchObject({
      status: "short_game",
      results: new Map(),
    })
  })

  it("does not invent new source signals absent from GradeInput", () => {
    const outcome = gradeLobbyV3(legacyLobby(), "sr")
    expect(outcome.status).toBe("missing_core_metric")
    expect(outcome.reason).toContain("cc_seconds_per_min")
  })

  it("rejects a non-finite core value instead of coercing it to zero", () => {
    const rows = legacyLobby()
    rows[3] = { ...rows[3], kills: Number.NaN }
    expect(gradeLobbyV3(rows, "sr")).toMatchObject({
      status: "missing_core_metric",
      reason: "required_core_field",
    })
  })

  it("uses an explicit compatibility ruleset context", () => {
    expect(defaultGradeModeContext("classic")).toMatchObject({
      trackedMode: "league_classic",
      ruleset: "league_classic",
    })
  })
})
