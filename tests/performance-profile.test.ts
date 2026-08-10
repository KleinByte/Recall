import { describe, expect, it } from "vitest"
import type { InsightObservation } from "../electron/main/database/insights-repo.js"
import { GRADE_V3_RECIPE_ID } from "../electron/main/matches/grade-v3-recipe.js"
import { buildPerformanceProfile } from "../electron/main/matches/performance-profile.js"
import {
  RVI_VECTOR_KEYS,
  type RviMatchObservation,
  type RviMetricObservation,
} from "../electron/main/matches/rvi-contract.js"
import { classifyRviIdentity } from "../src/helpers/rvi-identity.js"

function familyScores(value: number | null): Record<string, number | null> {
  return Object.fromEntries(RVI_VECTOR_KEYS.map((family) => [family, value]))
}

function familyWeights(value = 1 / (RVI_VECTOR_KEYS.length - 1)): Record<string, number> {
  return Object.fromEntries(RVI_VECTOR_KEYS.map((family) => [
    family,
    family === "initiative_pressure" ? 0 : value,
  ]))
}

function metric(
  key: string,
  vector: RviMetricObservation["vector"],
  score: number | null,
  overrides: Partial<RviMetricObservation> = {},
): RviMetricObservation {
  return {
    key,
    vector,
    label: key,
    description: `${key} description`,
    formula: key,
    unit: "percentile",
    tier: "DIAGNOSTIC",
    vectorWeight: 0,
    gradeWeight: 0,
    rawEvidence: score === null
      ? { state: "unavailable", reason: "source_missing" }
      : { state: "observed", value: score },
    scoreEvidence: score === null
      ? { state: "unavailable", reason: "score_missing" }
      : { state: "observed", value: score },
    ...overrides,
  }
}

function observation(
  matchId: number,
  overrides: Partial<Omit<RviMatchObservation, "matchId">> = {},
): RviMatchObservation {
  const base: RviMatchObservation = {
    matchId,
    recipeId: GRADE_V3_RECIPE_ID,
    playedAt: matchId * 1_000,
    roleFitScore: 50,
    familyPercentiles: familyScores(50),
    familyResponsibilityWeights: familyWeights(),
    championId: 1,
    position: "MIDDLE",
    primaryArchetype: "burst_mage",
  }
  return {
    ...base,
    ...overrides,
    familyPercentiles: {
      ...base.familyPercentiles,
      ...overrides.familyPercentiles,
    },
    familyResponsibilityWeights: {
      ...base.familyResponsibilityWeights,
      ...overrides.familyResponsibilityWeights,
    },
  }
}

describe("Recall Vector Index v3 performance-profile adapter", () => {
  it("returns no profile for empty v3 input or legacy-only rows", () => {
    expect(buildPerformanceProfile({ rviObservations: [] })).toBeUndefined()
    expect(buildPerformanceProfile({
      family: "sr",
      observations: [] as InsightObservation[],
      gradeComponentHistory: [],
    })).toBeUndefined()
  })

  it("returns eight capability vectors and the authoritative role-fit headline", () => {
    const familyPercentiles: Record<string, number> = {
      threat: 90,
      teamfighting: 85,
      positioning_survival: 80,
      control_utility: 75,
      economy: 70,
      objectives_macro: 60,
      vision_setup: 50,
      initiative_pressure: 40,
    }
    const profile = buildPerformanceProfile({
      rviObservations: Array.from({ length: 36 }, (_, index) => observation(index + 1, {
        roleFitScore: 72,
        familyPercentiles,
        championId: 1 + index % 3,
        position: index % 2 ? "MIDDLE" : "BOTTOM",
      })),
    })!

    expect(profile.algorithmVersion).toBe(3)
    expect(profile.recipeId).toBe(GRADE_V3_RECIPE_ID)
    expect(profile.score).toBe(72)
    expect(profile.headline).toMatchObject({ source: "role_fit", score: 72, nEff: 36 })
    expect(profile.headline.confidenceInterval95).toMatchObject({ lower: 72, upper: 72 })
    expect(profile.confidence).toBe("established")
    expect(profile.dimensions.map((dimension) => dimension.key)).toEqual(RVI_VECTOR_KEYS)
    expect(profile.dimensions.map((dimension) => dimension.score))
      .toEqual([90, 85, 80, 75, 70, 60, 50, 40])
    expect(profile.dimensions.every((dimension) => dimension.metrics.length === 0)).toBe(true)
    expect(profile.auxiliary).toMatchObject({ excludedFromHeadline: true })
    expect(profile.auxiliary?.consistency).toMatchObject({ median: 72, scaledMad: 0 })
  })

  it("exposes multiple calibrated measurements instead of one synthetic family row", () => {
    const profile = buildPerformanceProfile({
      rviObservations: [observation(1, {
        metrics: [
          metric("damage_share", "threat", 80, {
            label: "Damage share",
            tier: "CORE",
            vectorWeight: 1,
            gradeWeight: .2,
            rawEvidence: { state: "observed", value: .31 },
            unit: "%",
            formula: "player champion damage / team champion damage",
            comparisonScope: "position",
            referenceMatchCount: 64,
          }),
          metric("champion_damage_per_min", "threat", 72, {
            label: "Champion damage per minute",
            rawEvidence: { state: "observed", value: 812 },
            unit: "damage/min",
          }),
        ],
      })],
    })!
    const threat = profile.dimensions.find((dimension) => dimension.key === "threat")!

    expect(threat.metrics).toHaveLength(2)
    expect(threat.metrics[0]).toMatchObject({
      key: "champion_damage_per_min",
      score: 72,
      rawValue: 812,
      tier: "DIAGNOSTIC",
      influence: 0,
    })
    expect(threat.metrics[1]).toMatchObject({
      key: "damage_share",
      score: 80,
      rawValue: .31,
      tier: "CORE",
      influence: .2,
      coverage: 1,
      comparisonScope: "position",
      referenceMatchCount: 64,
    })
    expect(threat.metrics.some((entry) => entry.key === "threat")).toBe(false)
  })

  it("summarizes the exact headline by observed position, archetype, and champion-position", () => {
    const rows = [
      observation(1, { championId: 84, position: "MIDDLE", primaryArchetype: "assassin", roleFitScore: 80 }),
      observation(2, { championId: 84, position: "MIDDLE", primaryArchetype: "assassin", roleFitScore: 80 }),
      observation(3, { championId: 84, position: "MIDDLE", primaryArchetype: "assassin", roleFitScore: null }),
      observation(4, { championId: 18, position: "BOTTOM", primaryArchetype: "marksman", roleFitScore: 60 }),
      observation(5, { championId: 18, position: "BOTTOM", primaryArchetype: "marksman", roleFitScore: 40 }),
      observation(6, { championId: null, position: null, primaryArchetype: null, roleFitScore: 20 }),
    ]
    const profile = buildPerformanceProfile({ rviObservations: rows })!

    expect(profile.scopes.overall).toMatchObject({
      kind: "overall",
      score: 56,
      games: 6,
      measuredGames: 5,
      coverage: 5 / 6,
      confidence: "learning",
    })
    expect(profile.scopes.positions).toEqual([
      expect.objectContaining({ position: "MIDDLE", score: 80, games: 3, coverage: 2 / 3 }),
      expect.objectContaining({ position: "BOTTOM", score: 50, games: 2, coverage: 1 }),
    ])
    expect(profile.scopes.primaryArchetypes).toEqual([
      expect.objectContaining({ primaryArchetype: "assassin", score: 80, games: 3 }),
      expect.objectContaining({ primaryArchetype: "marksman", score: 50, games: 2 }),
    ])
    expect(profile.scopes.championPositions).toEqual([
      expect.objectContaining({ championId: 84, position: "MIDDLE", score: 80, games: 3 }),
      expect.objectContaining({ championId: 18, position: "BOTTOM", score: 50, games: 2 }),
    ])
    expect(profile.scopes.overall.headline).toBe(profile.headline)
    expect(profile.auxiliary?.consistency).toBeDefined()
    expect(profile.auxiliary?.versatility).toBeDefined()
  })

  it("keeps zero-weight Marksman Vision and Control diagnostic and out of identity", () => {
    const responsibilityWeights: Record<string, number> = {
      threat: .35,
      teamfighting: .1,
      positioning_survival: .1,
      economy: .35,
      objectives_macro: .1,
      vision_setup: 0,
      control_utility: 0,
      initiative_pressure: 0,
    }
    const familyPercentiles: Record<string, number> = {
      threat: 75,
      teamfighting: 60,
      positioning_survival: 55,
      economy: 70,
      objectives_macro: 56,
      vision_setup: 99,
      control_utility: 98,
      initiative_pressure: 50,
    }
    const profile = buildPerformanceProfile({
      rviObservations: Array.from({ length: 25 }, (_, index) => observation(index + 1, {
        championId: 18,
        position: "BOTTOM",
        primaryArchetype: "marksman",
        roleFitScore: 70,
        familyPercentiles: index < 5
          ? { ...familyPercentiles, vision_setup: 90, control_utility: 89 }
          : familyPercentiles,
        familyResponsibilityWeights: responsibilityWeights,
      })),
    })!
    const vision = profile.dimensions.find((dimension) => dimension.key === "vision_setup")!
    const control = profile.dimensions.find((dimension) => dimension.key === "control_utility")!

    expect(vision).toMatchObject({ responsibilityWeight: 0, headlineEligible: false })
    expect(control).toMatchObject({ responsibilityWeight: 0, headlineEligible: false })
    expect(vision.score).toBeGreaterThan(75)
    expect(control.score).toBeGreaterThan(75)
    expect(vision.description).toContain("diagnostic")
    expect(control.description).toContain("diagnostic")
    expect(profile.strongestKey).toBe("threat")
    expect(profile.growthKey).toBeUndefined()
    expect(classifyRviIdentity(profile)).toMatchObject({
      label: "Carry",
      vectors: ["threat", "economy"],
    })
  })

  it("shows Enchanter protection inside Utility without letting it drive headline or identity", () => {
    const rows = Array.from({ length: 25 }, (_, index) => observation(index + 1, {
      championId: 16,
      position: "UTILITY",
      primaryArchetype: "enchanter",
      roleFitScore: 62,
      familyPercentiles: {
        ...familyScores(index < 5 ? 50 : 60),
        threat: index < 5 ? 55 : 65,
        control_utility: 45,
      },
      metrics: [metric(
        "ally_heal_shield_per_min",
        "control_utility",
        index === 0 ? null : index === 1 ? 0 : 100,
      )],
    }))
    const profile = buildPerformanceProfile({ rviObservations: rows })!
    const utility = profile.dimensions.find((dimension) => dimension.key === "control_utility")!
    const protection = utility.metrics.find((entry) => entry.key === "ally_heal_shield_per_min")!

    expect(profile.dimensions.map((dimension) => dimension.key)).toEqual(RVI_VECTOR_KEYS)
    expect(protection).toMatchObject({
      score: 96,
      games: 24,
      influence: 0,
      tier: "DIAGNOSTIC",
    })
    expect(profile.score).toBe(62)
    expect(profile.strongestKey).toBe("threat")
    expect(profile.growthKey).toBe("threat")
    expect(classifyRviIdentity(profile).vectors).not.toContain("initiative_pressure")
  })

  it("never rebuilds the headline from family dimensions or shrinks a small sample", () => {
    const row = observation(1, {
      roleFitScore: 20,
      familyPercentiles: familyScores(90),
    })
    const career = buildPerformanceProfile({ rviObservations: [row] })!
    const match = buildPerformanceProfile({
      rviObservations: [row],
      scoringContext: "match",
    })!

    expect(career.score).toBe(20)
    expect(match.score).toBe(20)
    expect(career.dimensions.every((dimension) => dimension.score === 90)).toBe(true)
    expect(match.dimensions.every((dimension) => dimension.score === 90)).toBe(true)
    expect(career.headline.confidence).toBe("learning")
    expect(career.headline.confidenceInterval95).toMatchObject({ lower: 20, upper: 20 })
  })

  it("preserves profile recent-form fields and excludes career diagnostics from match context", () => {
    const rows = Array.from({ length: 25 }, (_, index) => observation(index + 1, {
      roleFitScore: index < 5 ? 10 : 90,
      familyPercentiles: familyScores(index < 5 ? 20 : 80),
    }))
    const career = buildPerformanceProfile({ rviObservations: rows })!
    const match = buildPerformanceProfile({ rviObservations: [rows.at(-1)!], scoringContext: "match" })!

    expect(career.score).toBe(74)
    expect(career.recentHeadline?.score).toBe(90)
    expect(career.dimensions.every((dimension) =>
      dimension.score === 68 && dimension.recentScore === 80 && dimension.delta === 12)).toBe(true)
    expect(career.growthKey).toBe("threat")
    expect(career.auxiliary?.excludedFromHeadline).toBe(true)
    expect(match.recentHeadline).toBeUndefined()
    expect(match.auxiliary).toBeUndefined()
    expect(match.growthKey).toBeUndefined()
    expect(match.dimensions.every((dimension) =>
      dimension.recentScore === undefined && dimension.delta === undefined)).toBe(true)
  })

  it("keeps observed zero, excludes missing values, and exposes coverage separately", () => {
    const profile = buildPerformanceProfile({
      rviObservations: [
        observation(1, { roleFitScore: 20, familyPercentiles: familyScores(0) }),
        observation(2, { roleFitScore: null, familyPercentiles: familyScores(null) }),
      ],
    })!

    expect(profile.score).toBe(20)
    expect(profile.games).toBe(2)
    expect(profile.measuredGames).toBe(1)
    expect(profile.coverage).toBe(.5)
    expect(profile.dimensions).toHaveLength(8)
    expect(profile.dimensions.every((dimension) =>
      dimension.score === 0 && dimension.games === 1)).toBe(true)
  })

  it("uses explicit half-life weighting without changing the underlying formula", () => {
    const profile = buildPerformanceProfile({
      rviObservations: [
        observation(1, { playedAt: 0, roleFitScore: 0, familyPercentiles: familyScores(0) }),
        observation(2, { playedAt: 10, roleFitScore: 50, familyPercentiles: familyScores(50) }),
        observation(3, { playedAt: 20, roleFitScore: 100, familyPercentiles: familyScores(100) }),
      ],
      weighting: { kind: "half_life", halfLifeMs: 10 },
    })!

    expect(profile.score).toBe(71)
    expect(profile.headline.score).toBeCloseTo(125 / 1.75, 9)
    expect(profile.headline.nEff).toBeCloseTo(3.0625 / 1.3125, 9)
    expect(profile.weighting).toEqual({ kind: "half_life", halfLifeMs: 10, referenceTime: 20 })
  })

  it("exposes the deterministic bootstrap interval independent of input order", () => {
    const rows = [10, 30, 70, 90].map((roleFitScore, index) => observation(index + 1, {
      roleFitScore,
      familyPercentiles: familyScores(roleFitScore),
    }))
    const ordered = buildPerformanceProfile({ rviObservations: rows })!
    const reversed = buildPerformanceProfile({ rviObservations: [...rows].reverse() })!

    expect(reversed.headline.confidenceInterval95)
      .toEqual(ordered.headline.confidenceInterval95)
    expect(ordered.headline.confidenceInterval95).toMatchObject({
      confidenceLevel: .95,
      replicates: 2_000,
      observedGames: 4,
    })
  })

  it("ignores legacy mode, timeline, and champion-class display inputs", () => {
    const row = observation(1, {
      championId: 54,
      roleFitScore: 35,
      familyPercentiles: familyScores(40),
    })
    const plain = buildPerformanceProfile({ rviObservations: [row] })!
    const legacyDecorated = buildPerformanceProfile({
      rviObservations: [row],
      family: "aram",
      timelineHistory: [],
      championRoles: new Map([[54, ["marksman"]]]),
    })!

    expect(legacyDecorated.score).toBe(plain.score)
    expect(legacyDecorated.dimensions).toEqual(plain.dimensions)
    expect(legacyDecorated.dimensions.flatMap((dimension) =>
      dimension.metrics.map((metric) => metric.key))).toEqual([])
  })

  it("rejects observations from a different recipe", () => {
    expect(() => buildPerformanceProfile({
      rviObservations: [observation(1, { recipeId: "another-recipe" })],
    })).toThrow(/recipe/)
  })
})
