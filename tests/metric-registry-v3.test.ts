import { describe, expect, it } from "vitest"
import {
  METRIC_DEFINITIONS_V3,
  RVI_CAPABILITY_VECTORS_V3,
  RVI_MATCH_ARM_KEYS_V3,
  RVI_PROFILE_ONLY_ARM_KEYS_V3,
  RVI_V3_METRIC_POLICIES,
  SUMMARY_METRIC_KEYS_V3,
  TIMELINE_METRIC_KEYS_V3,
  assertValidMetricRegistryV3,
  metricDefinitionV3,
  rviMetricPolicyV3,
} from "../electron/main/matches/metric-registry-v3.js"
import {
  RVI_V3_RECIPE_DEFINITION_ID,
  rviRecipeDefinitionV3,
  rviRecipeIdForCalibration,
} from "../electron/main/matches/rvi-v3-recipe.js"
import { defaultGradeModeContext } from
  "../electron/main/matches/grade-v3-taxonomy.js"

describe("Recall v3 metric registry", () => {
  it("registers every summary and timeline key exactly once in one vector", () => {
    expect(() => assertValidMetricRegistryV3()).not.toThrow()
    const expected = [...SUMMARY_METRIC_KEYS_V3, ...TIMELINE_METRIC_KEYS_V3]
    expect(METRIC_DEFINITIONS_V3).toHaveLength(expected.length)
    expect(RVI_V3_METRIC_POLICIES).toHaveLength(expected.length)
    expect(new Set(METRIC_DEFINITIONS_V3.map((entry) => entry.key)).size).toBe(expected.length)
    expect(new Set(RVI_V3_METRIC_POLICIES.map((entry) => entry.metricKey)).size)
      .toBe(expected.length)
    expect(new Set(RVI_V3_METRIC_POLICIES.map((entry) => entry.vector)))
      .toEqual(new Set(RVI_MATCH_ARM_KEYS_V3))
    expect(RVI_CAPABILITY_VECTORS_V3).toEqual([
      ...RVI_MATCH_ARM_KEYS_V3,
      ...RVI_PROFILE_ONLY_ARM_KEYS_V3,
    ])
  })

  it("scores restored evidence inside seven arms with fixed within-arm weights", () => {
    expect(rviMetricPolicyV3("damage_share")).toMatchObject({
      vector: "combat", tier: "CORE", vectorWeight: .3,
    })
    expect(rviMetricPolicyV3("kill_participation")).toMatchObject({
      vector: "combat", tier: "CORE", vectorWeight: .3,
    })
    expect(rviMetricPolicyV3("ally_heal_shield_per_min")).toMatchObject({
      vector: "control_utility", tier: "SECONDARY", vectorWeight: .2,
    })
    expect(rviMetricPolicyV3("teamfight_outcome_rate")).toMatchObject({
      vector: "combat", tier: "SECONDARY", vectorWeight: .05,
    })
    expect(rviMetricPolicyV3("baron_participation_rate")).toMatchObject({
      vector: "objectives_macro", tier: "DIAGNOSTIC", vectorWeight: 0,
    })
    for (const arm of RVI_MATCH_ARM_KEYS_V3) {
      expect(RVI_V3_METRIC_POLICIES
        .filter((entry) => entry.vector === arm && entry.tier !== "DIAGNOSTIC")
        .reduce((sum, entry) => sum + entry.vectorWeight, 0)).toBeCloseTo(1, 12)
    }
    expect(RVI_V3_METRIC_POLICIES.every((entry) => !("gradeWeight" in entry))).toBe(true)
  })

  it("owns labels, formulas, direction, source, and contextual applicability", () => {
    expect(metricDefinitionV3("deaths_per_10")).toMatchObject({
      direction: "lower",
      unit: "deaths_per_10_min",
      source: "scoreboard",
    })
    expect(metricDefinitionV3("deaths_per_10")?.formula).toContain("600")
    const rift = defaultGradeModeContext("sr")
    const aram = defaultGradeModeContext("aram")
    expect(metricDefinitionV3("objective_participation_rate")?.applicable({
      context: rift,
      position: "JUNGLE",
    })).toBe(true)
    expect(metricDefinitionV3("objective_participation_rate")?.applicable({
      context: aram,
    })).toBe(false)
    expect(metricDefinitionV3("spatial_early_roam_rate")?.applicable({
      context: rift,
      position: "MIDDLE",
    })).toBe(true)
    expect(metricDefinitionV3("spatial_early_roam_rate")?.applicable({
      context: rift,
      position: "JUNGLE",
    })).toBe(false)
    expect(metricDefinitionV3("cs_per_min")?.applicable({
      context: rift,
      position: "UTILITY",
    })).toBe(false)
  })

  it("creates immutable identities that change with either referenced recipe", () => {
    const first = rviRecipeIdForCalibration("grade:a", "calibration:a")
    expect(first).toContain(RVI_V3_RECIPE_DEFINITION_ID)
    expect(rviRecipeIdForCalibration("grade:b", "calibration:a")).not.toBe(first)
    expect(rviRecipeIdForCalibration("grade:a", "calibration:b")).not.toBe(first)
    const definition = rviRecipeDefinitionV3("grade:a", "calibration:a")
    expect(definition.metricDefinitions).toHaveLength(METRIC_DEFINITIONS_V3.length)
    expect(JSON.stringify(definition)).not.toContain("applicable")
  })
})
