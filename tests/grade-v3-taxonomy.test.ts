import { describe, expect, it } from "vitest"
import {
  GRADE_V3_RECIPE,
  recipeIdForCalibration,
} from "../electron/main/matches/grade-v3-recipe.js"
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
  type GradeModeContextV3,
} from "../electron/main/matches/grade-v3-taxonomy.js"

const sr: GradeModeContextV3 = {
  modeFamily: "sr",
  trackedMode: "sr_ranked_solo",
  ruleset: "standard_sr",
  rulesetKey: "standard-sr-rules-r1",
}

describe("Grade v3 taxonomy and recipe identity", () => {
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
      fighting: 1,
      availability: 2,
      resources: 1,
      objectives: 2,
      vision: 1,
      control: 2,
    })
  })

  it.each(["BOTTOM", "MIDDLE"] as const)(
    "grades Tristana %s by Marksman responsibilities",
    (position) => {
      expect(responsibilityTiersFor(sr, position, "marksman")).toEqual({
        fighting: 2,
        availability: 1,
        resources: 2,
        objectives: 1,
        vision: 0,
        control: 0,
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

    expect(kayle).toMatchObject({ fighting: 2, vision: 0, control: 0 })
    expect(teemo).toMatchObject({ fighting: 1, vision: 2, control: 1 })
    expect(chogath).toMatchObject({ objectives: 2, control: 2 })
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

  it("makes ARAM objective and vision families diagnostic", () => {
    const aram: GradeModeContextV3 = {
      modeFamily: "aram",
      trackedMode: "aram",
      ruleset: "howling_abyss",
      rulesetKey: "aram-rules-r1",
    }
    expect(responsibilityTiersFor(aram, "UNKNOWN", "vanguard")).toMatchObject({
      objectives: 0,
      vision: 0,
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
    expect(first).toContain(GRADE_V3_RECIPE.recipeDefinitionId)
    expect(() => recipeIdForCalibration("mutable current")).toThrow(TypeError)
    expect(Object.isFrozen(GRADE_V3_RECIPE)).toBe(true)
    expect(Object.isFrozen(GRADE_V3_RECIPE.aggregation.familyMetrics.fighting)).toBe(true)
  })
})
