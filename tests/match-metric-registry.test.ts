import { describe, expect, it } from "vitest"
import {
  METRIC_DEFINITIONS,
  RVI_CAPABILITY_VECTORS,
  RVI_MATCH_ARM_KEYS,
  RVI_PROFILE_ONLY_ARM_KEYS,
  RVI_METRIC_POLICIES,
  SUMMARY_METRIC_KEYS,
  TIMELINE_METRIC_KEYS,
  assertValidMetricRegistry,
  metricDefinition,
  rviMetricPolicy,
} from "../electron/main/matches/match-metric-registry.js"
import {
  CURRENT_RVI_RECIPE_DEFINITION_ID,
  rviRecipeDefinition,
  rviRecipeIdForCalibration,
} from "../electron/main/matches/rvi-recipe.js"
import { defaultGradeModeContext } from
  "../electron/main/matches/match-grade-taxonomy.js"

describe("Recall metric registry", () => {
  it("registers every summary and timeline key exactly once in one vector", () => {
    expect(() => assertValidMetricRegistry()).not.toThrow()
    const expected = [...SUMMARY_METRIC_KEYS, ...TIMELINE_METRIC_KEYS]
    expect(METRIC_DEFINITIONS).toHaveLength(expected.length)
    expect(RVI_METRIC_POLICIES).toHaveLength(expected.length)
    expect(new Set(METRIC_DEFINITIONS.map((entry) => entry.key)).size).toBe(expected.length)
    expect(new Set(RVI_METRIC_POLICIES.map((entry) => entry.metricKey)).size)
      .toBe(expected.length)
    expect(new Set(RVI_METRIC_POLICIES.map((entry) => entry.vector)))
      .toEqual(new Set(RVI_MATCH_ARM_KEYS))
    expect(RVI_CAPABILITY_VECTORS).toEqual([
      ...RVI_MATCH_ARM_KEYS,
      ...RVI_PROFILE_ONLY_ARM_KEYS,
    ])
  })

  it("scores restored evidence inside seven arms with fixed within-arm weights", () => {
    expect(rviMetricPolicy("damage_share")).toMatchObject({
      vector: "combat", tier: "CORE", vectorWeight: .3,
    })
    expect(rviMetricPolicy("kill_participation")).toMatchObject({
      vector: "combat", tier: "CORE", vectorWeight: .3,
    })
    expect(rviMetricPolicy("ally_heal_shield_per_min")).toMatchObject({
      vector: "control_utility", tier: "SECONDARY", vectorWeight: .2,
    })
    expect(rviMetricPolicy("teamfight_outcome_rate")).toMatchObject({
      vector: "combat", tier: "SECONDARY", vectorWeight: .05,
    })
    expect(rviMetricPolicy("baron_participation_rate")).toMatchObject({
      vector: "objectives_macro", tier: "DIAGNOSTIC", vectorWeight: 0,
    })
    for (const arm of RVI_MATCH_ARM_KEYS) {
      expect(RVI_METRIC_POLICIES
        .filter((entry) => entry.vector === arm && entry.tier !== "DIAGNOSTIC")
        .reduce((sum, entry) => sum + entry.vectorWeight, 0)).toBeCloseTo(1, 12)
    }
    expect(RVI_METRIC_POLICIES.every((entry) => !("gradeWeight" in entry))).toBe(true)
  })

  it("owns labels, formulas, direction, source, and contextual applicability", () => {
    expect(metricDefinition("deaths_per_10")).toMatchObject({
      direction: "lower",
      unit: "deaths_per_10_min",
      source: "scoreboard",
    })
    expect(metricDefinition("deaths_per_10")?.formula).toContain("600")
    const rift = defaultGradeModeContext("sr")
    const aram = defaultGradeModeContext("aram")
    expect(metricDefinition("objective_participation_rate")?.applicable({
      context: rift,
      position: "JUNGLE",
    })).toBe(true)
    expect(metricDefinition("objective_participation_rate")?.applicable({
      context: aram,
    })).toBe(false)
    expect(metricDefinition("spatial_early_roam_rate")?.applicable({
      context: rift,
      position: "MIDDLE",
    })).toBe(true)
    expect(metricDefinition("spatial_early_roam_rate")?.applicable({
      context: rift,
      position: "JUNGLE",
    })).toBe(false)
    expect(metricDefinition("cs_per_min")?.applicable({
      context: rift,
      position: "UTILITY",
    })).toBe(false)
  })

  it("creates immutable identities that change with either referenced recipe", () => {
    const first = rviRecipeIdForCalibration("grade:a", "calibration:a")
    expect(first).toContain(CURRENT_RVI_RECIPE_DEFINITION_ID)
    expect(rviRecipeIdForCalibration("grade:b", "calibration:a")).not.toBe(first)
    expect(rviRecipeIdForCalibration("grade:a", "calibration:b")).not.toBe(first)
    const definition = rviRecipeDefinition("grade:a", "calibration:a")
    expect(definition.metricDefinitions).toHaveLength(METRIC_DEFINITIONS.length)
    expect(JSON.stringify(definition)).not.toContain("applicable")
  })
})
