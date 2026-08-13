import { describe, expect, it } from "vitest"
import {
  CURRENT_GRADE_RECIPE,
  recipeIdForCalibration,
} from "../electron/main/matches/match-grade-recipe.js"
import { CHAMPION_CLASSES } from "../electron/main/matches/champion-classes.js"
import {
  CURATED_PRIMARY_ARCHETYPES,
  SPECIALIST_RESPONSIBILITY_OVERRIDES,
  calibrationScopeKey,
  canonicalChampionId,
  isSupportedModeContext,
  resolvePrimaryArchetypeWithSource,
  responsibilityTiersFor,
  unmappedChampionTaxonomyIds,
  type MatchGradeModeContext,
} from "../electron/main/matches/match-grade-taxonomy.js"

const sr: MatchGradeModeContext = {
  modeFamily: "sr",
  trackedMode: "sr_ranked_solo",
  ruleset: "standard_sr",
  rulesetKey: "standard-sr-rules-r1",
}

describe("match Grade taxonomy and recipe identity", () => {
  it("canonicalizes League Classic ids before curated resolution", () => {
    expect(canonicalChampionId(60018)).toBe(18)
    expect(canonicalChampionId(60154)).toBe(154)
    expect(resolvePrimaryArchetypeWithSource(60018)).toMatchObject({
      archetype: "marksman",
      source: "curated",
    })
    expect(resolvePrimaryArchetypeWithSource(60154)).toMatchObject({
      archetype: "vanguard",
      source: "curated",
    })
  })

  it("grades Zac Jungle by Vanguard responsibilities", () => {
    const tiers = responsibilityTiersFor(sr, "JUNGLE", "vanguard")
    expect(tiers).toEqual({
      combat: 1,
      positioning_survival: 2,
      control_utility: 2,
      economy: 1,
      objectives_macro: 2,
      vision_setup: 1,
      initiative_pressure: 2,
    })
  })

  it.each([["BOTTOM", 1], ["MIDDLE", 2]] as const)(
    "grades Tristana %s by Marksman responsibilities",
    (position, initiative) => {
      expect(responsibilityTiersFor(sr, position, "marksman")).toEqual({
        combat: 2,
        positioning_survival: 1,
        control_utility: 0,
        economy: 2,
        objectives_macro: 1,
        vision_setup: 0,
        initiative_pressure: initiative,
      })
    },
  )

  it("labels checked-in, explicit Specialist, and future fallbacks honestly", () => {
    expect(resolvePrimaryArchetypeWithSource(103)).toMatchObject({
      archetype: "burst_mage",
      source: "curated",
    })
    expect(resolvePrimaryArchetypeWithSource(9)).toMatchObject({
      archetype: "specialist",
      source: "curated",
    })
    expect(resolvePrimaryArchetypeWithSource(999_999)).toMatchObject({
      archetype: "specialist",
      source: "specialist_fallback",
    })
  })

  it("uses heterogeneous champion-specific Specialist policies", () => {
    const kayle = responsibilityTiersFor(sr, "TOP", "specialist", 10)
    const teemo = responsibilityTiersFor(sr, "TOP", "specialist", 17)
    const chogath = responsibilityTiersFor(sr, "TOP", "specialist", 31)

    expect(kayle).toMatchObject({ combat: 2, vision_setup: 0, control_utility: 0 })
    expect(teemo).toMatchObject({ combat: 1, vision_setup: 2, control_utility: 1 })
    expect(chogath).toMatchObject({ objectives_macro: 2, control_utility: 2 })
    expect(teemo).not.toEqual(kayle)
    expect(responsibilityTiersFor(sr, "TOP", "specialist", 60_017)).toEqual(teemo)
  })

  it("has an explicit responsibility policy for every curated Specialist", () => {
    const specialists = [...CURATED_PRIMARY_ARCHETYPES]
      .filter(([, archetype]) => archetype === "specialist")
      .map(([championId]) => championId)
      .sort((left, right) => left - right)
    expect([...SPECIALIST_RESPONSIBILITY_OVERRIDES.keys()].sort((left, right) => left - right))
      .toEqual(specialists)
  })

  it.each([
    [2, "diver"], // Olaf
    [3, "warden"], // Galio
    [6, "juggernaut"], // Urgot
    [8, "battlemage"], // Vladimir
    [25, "catcher"], // Morgana
    [72, "vanguard"], // Skarner
    [101, "artillery"], // Xerath
    [102, "diver"], // post-VGU Shyvana
    [143, "catcher"], // Zyra
    [235, "marksman"], // Senna
    [555, "assassin"], // Pyke
    [777, "assassin"], // Yone
    [799, "diver"], // Ambessa
    [800, "burst_mage"], // Mel
    [805, "assassin"], // Locke
    [897, "warden"], // K'Sante
    [904, "skirmisher"], // Zaahen
    [910, "artillery"], // Hwei
  ] as const)("resolves champion %i to its detailed primary subclass", (championId, archetype) => {
    expect(resolvePrimaryArchetypeWithSource(championId)).toMatchObject({
      archetype,
      source: "curated",
    })
  })

  it("has an exhaustive checked-in entry for every bundled modern and Classic id", () => {
    const bundledCanonicalIds = new Set([...CHAMPION_CLASSES.keys()].map(canonicalChampionId))
    expect(unmappedChampionTaxonomyIds()).toEqual([])
    expect(CURATED_PRIMARY_ARCHETYPES.size).toBe(bundledCanonicalIds.size)
  })

  it("makes exactly Combat, Survival, Utility, and Economy mode-capable on the Abyss", () => {
    const aram: MatchGradeModeContext = {
      modeFamily: "aram",
      trackedMode: "aram",
      ruleset: "howling_abyss",
      rulesetKey: "aram-rules-r1",
    }
    const tiers = responsibilityTiersFor(aram, "UNKNOWN", "vanguard")
    expect(Object.entries(tiers).filter(([, tier]) => tier > 0).map(([key]) => key)).toEqual([
      "combat",
      "positioning_survival",
      "control_utility",
      "economy",
    ])
    expect(tiers).toMatchObject({
      objectives_macro: 0,
      vision_setup: 0,
      initiative_pressure: 0,
    })
  })

  it("separates tracked mode and rules epochs in calibration scope", () => {
    const normal = { ...sr, trackedMode: "sr_normal" }
    const swiftplay = { ...sr, trackedMode: "sr_swiftplay" }
    expect(calibrationScopeKey(normal)).not.toBe(calibrationScopeKey(swiftplay))
    expect(isSupportedModeContext(normal)).toBe(true)
    expect(isSupportedModeContext({ ...normal, modeFamily: "other" })).toBe(false)
    expect(isSupportedModeContext({ ...normal, ruleset: "howling_abyss" })).toBe(false)
  })

  it("binds each final recipe id to one calibration snapshot", () => {
    const first = recipeIdForCalibration("sha256.aaa")
    const second = recipeIdForCalibration("sha256.bbb")
    expect(first).not.toBe(second)
    expect(first).toContain(CURRENT_GRADE_RECIPE.recipeDefinitionId)
    expect(() => recipeIdForCalibration("mutable current")).toThrow(TypeError)
    expect(Object.isFrozen(CURRENT_GRADE_RECIPE)).toBe(true)
    expect(Object.isFrozen(CURRENT_GRADE_RECIPE.aggregation.familyMetrics.combat)).toBe(true)
  })
})
