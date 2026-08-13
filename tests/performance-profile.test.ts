import { describe, expect, it } from "vitest"
import { DEFAULT_GRADE_RECIPE_ID } from "../electron/main/matches/match-grade-recipe.js"
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
    family === "consistency_versatility" ? 0 : value,
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
    recipeId: DEFAULT_GRADE_RECIPE_ID,
    playedAt: matchId * 1_000,
    recallScore: 50,
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

describe("Recall Vector Index performance-profile adapter", () => {
  it("returns no profile for an empty canonical input", () => {
    expect(buildPerformanceProfile({ rviObservations: [] })).toBeUndefined()
  })

  it("returns seven match arms plus career Range and averages available career arms", () => {
    const familyPercentiles: Record<string, number> = {
      combat: 90,
      positioning_survival: 80,
      control_utility: 75,
      economy: 70,
      objectives_macro: 60,
      vision_setup: 50,
      initiative_pressure: 40,
    }
    const profile = buildPerformanceProfile({
      rviObservations: Array.from({ length: 36 }, (_, index) => observation(index + 1, {
        recallScore: 72,
        familyPercentiles,
        championId: 1 + index % 3,
        position: index % 2 ? "MIDDLE" : "BOTTOM",
      })),
    })!

    expect(profile.recipeId).toBe(DEFAULT_GRADE_RECIPE_ID)
    expect(profile.score).toBe(67)
    expect(profile.headline).toMatchObject({
      source: "career_arm_mean",
      score: 67.275,
      availableArms: 8,
      totalArms: 8,
      armCoverage: 1,
      evidenceCoverage: 1,
      nEff: 36,
    })
    expect(profile.confidence).toBe("established")
    expect(profile.dimensions.map((dimension) => dimension.key)).toEqual(RVI_VECTOR_KEYS)
    expect(profile.dimensions.map((dimension) => dimension.score))
      .toEqual([90, 80, 75, 70, 60, 50, 40, 73])
    expect(profile.dimensions.every((dimension) => dimension.metrics.length === 0)).toBe(true)
    expect(profile.auxiliary).toMatchObject({ contributesThroughRange: true })
    expect(profile.auxiliary?.consistency).toMatchObject({ median: 72, scaledMad: 0 })
    expect(profile.recallScoreAverage).toBe(72)
    expect(profile.coverage).toBe(1)
    expect(profile.scopes.overall.headline).toMatchObject({
      source: "career_arm_mean",
      totalArms: 8,
    })
    expect(profile.scopes.positions.every((scope) =>
      scope.headline.source === "career_arm_mean" && scope.headline.totalArms === 7,
    )).toBe(true)
    expect(profile.scopes.primaryArchetypes.every((scope) =>
      scope.headline.source === "career_arm_mean" && scope.headline.totalArms === 7,
    )).toBe(true)
  })

  it("exposes multiple calibrated measurements instead of one synthetic family row", () => {
    const profile = buildPerformanceProfile({
      rviObservations: [observation(1, {
        metrics: [
          metric("damage_share", "combat", 80, {
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
          metric("champion_damage_per_min", "combat", 72, {
            label: "Champion damage per minute",
            rawEvidence: { state: "observed", value: 812 },
            unit: "damage/min",
          }),
        ],
      })],
    })!
    const combat = profile.dimensions.find((dimension) => dimension.key === "combat")!

    expect(combat.metrics).toHaveLength(2)
    expect(combat.metrics[0]).toMatchObject({
      key: "champion_damage_per_min",
      score: 72,
      rawValue: 812,
      tier: "DIAGNOSTIC",
      influence: 0,
    })
    expect(combat.metrics[1]).toMatchObject({
      key: "damage_share",
      score: 80,
      rawValue: .31,
      tier: "CORE",
      influence: .2,
      coverage: 1,
      comparisonScope: "position",
      referenceMatchCount: 64,
    })
    expect(combat.metrics.some((entry) => entry.key === "combat")).toBe(false)
  })

  it("summarizes the exact headline by observed position and archetype", () => {
    const rows = [
      observation(1, { championId: 84, position: "MIDDLE", primaryArchetype: "assassin", recallScore: 80 }),
      observation(2, { championId: 84, position: "MIDDLE", primaryArchetype: "assassin", recallScore: 80 }),
      observation(3, { championId: 84, position: "MIDDLE", primaryArchetype: "assassin", recallScore: null }),
      observation(4, { championId: 18, position: "BOTTOM", primaryArchetype: "marksman", recallScore: 60 }),
      observation(5, { championId: 18, position: "BOTTOM", primaryArchetype: "marksman", recallScore: 40 }),
      observation(6, { championId: null, position: null, primaryArchetype: null, recallScore: 20 }),
    ]
    const profile = buildPerformanceProfile({ rviObservations: rows })!

    expect(profile.scopes.overall).toMatchObject({
      kind: "overall",
      score: 50,
      games: 6,
      measuredGames: 5,
      coverage: 47 / 48,
      confidence: "learning",
    })
    expect(profile.scopes.positions).toEqual([
      expect.objectContaining({ position: "MIDDLE", score: 50, games: 3, coverage: 1 }),
      expect.objectContaining({ position: "BOTTOM", score: 50, games: 2, coverage: 1 }),
    ])
    expect(profile.scopes.primaryArchetypes).toEqual([
      expect.objectContaining({ primaryArchetype: "assassin", score: 50, games: 3 }),
      expect.objectContaining({ primaryArchetype: "marksman", score: 50, games: 2 }),
    ])
    expect(profile.scopes).not.toHaveProperty("championPositions")
    expect(profile.scopes.overall.headline).toEqual(profile.headline)
    expect(profile.auxiliary?.consistency).toBeDefined()
    expect(profile.auxiliary?.versatility).toBeDefined()
  })

  it("keeps zero-weight Marksman Vision and Control diagnostic and out of identity", () => {
    const responsibilityWeights: Record<string, number> = {
      combat: .45,
      positioning_survival: .1,
      economy: .35,
      objectives_macro: .1,
      vision_setup: 0,
      control_utility: 0,
      initiative_pressure: 0,
      consistency_versatility: 0,
    }
    const familyPercentiles: Record<string, number> = {
      combat: 75,
      positioning_survival: 55,
      economy: 70,
      objectives_macro: 56,
      vision_setup: 99,
      control_utility: 98,
      initiative_pressure: 50,
      consistency_versatility: 50,
    }
    const profile = buildPerformanceProfile({
      rviObservations: Array.from({ length: 25 }, (_, index) => observation(index + 1, {
        championId: 18,
        position: "BOTTOM",
        primaryArchetype: "marksman",
        recallScore: 70,
        familyPercentiles: index < 5
          ? { ...familyPercentiles, vision_setup: 90, control_utility: 89 }
          : familyPercentiles,
        familyResponsibilityWeights: responsibilityWeights,
      })),
    })!
    const vision = profile.dimensions.find((dimension) => dimension.key === "vision_setup")!
    const control = profile.dimensions.find((dimension) => dimension.key === "control_utility")!

    expect(vision).toMatchObject({ responsibilityWeight: 0, headlineEligible: true })
    expect(control).toMatchObject({ responsibilityWeight: 0, headlineEligible: true })
    expect(vision.score).toBeGreaterThan(75)
    expect(control.score).toBeGreaterThan(75)
    expect(vision.description).not.toContain("diagnostic")
    expect(control.description).not.toContain("diagnostic")
    expect(profile.strongestKey).toBe("vision_setup")
    expect(profile.growthKey).toBe("control_utility")
    expect(classifyRviIdentity(profile)).toMatchObject({
      label: "Hybrid",
      arms: ["vision_setup", "control_utility"],
    })
  })

  it("shows Enchanter protection inside Utility without letting it drive headline or identity", () => {
    const rows = Array.from({ length: 25 }, (_, index) => observation(index + 1, {
      championId: 16,
      position: "UTILITY",
      primaryArchetype: "enchanter",
      recallScore: 62,
      familyPercentiles: {
        ...familyScores(index < 5 ? 50 : 60),
        combat: index < 5 ? 55 : 65,
        control_utility: 45,
      },
      metrics: [metric(
        "ally_heal_shield_per_min",
        "control_utility",
        index === 0 ? null : index === 1 ? 0 : 100,
        { tier: "SECONDARY", vectorWeight: .2, gradeWeight: .1 },
      )],
    }))
    const profile = buildPerformanceProfile({ rviObservations: rows })!
    const utility = profile.dimensions.find((dimension) => dimension.key === "control_utility")!
    const protection = utility.metrics.find((entry) => entry.key === "ally_heal_shield_per_min")!

    expect(profile.dimensions.map((dimension) => dimension.key)).toEqual(RVI_VECTOR_KEYS)
    expect(protection).toMatchObject({
      score: 96,
      games: 24,
      tier: "SECONDARY",
    })
    expect(protection.influence).toBeCloseTo(.1, 12)
    expect(profile.score).toBe(57)
    expect(profile.strongestKey).toBe("combat")
    expect(profile.growthKey).toBe("combat")
    expect(classifyRviIdentity(profile).arms).not.toContain("initiative_pressure")
  })

  it("uses career arms for career RVI while preserving match Recall Score", () => {
    const row = observation(1, {
      recallScore: 20,
      familyPercentiles: familyScores(90),
    })
    const career = buildPerformanceProfile({ rviObservations: [row] })!
    const match = buildPerformanceProfile({
      rviObservations: [row],
      scoringContext: "match",
    })!

    expect(career.score).toBe(90)
    expect(match.score).toBe(20)
    expect(career.recallScoreAverage).toBe(20)
    expect(match.recallScoreAverage).toBe(20)
    expect(career.coverage).toBe(1)
    expect(match.coverage).toBe(1)
    expect(career.headline).toMatchObject({ armCoverage: 7 / 8, evidenceCoverage: 1 })
    expect(career.dimensions.filter((dimension) =>
      dimension.key !== "consistency_versatility")
      .every((dimension) => dimension.score === 90)).toBe(true)
    expect(career.dimensions.at(-1)?.score).toBeNull()
    expect(career.dimensions.at(-1)?.careerOnly).toBe(true)
    expect(match.dimensions.every((dimension) => dimension.score === 90)).toBe(true)
    expect(career.headline).toMatchObject({ source: "career_arm_mean", score: 90 })
    expect(match.headline).toMatchObject({ source: "role_fit", score: 20 })
  })

  it("preserves profile recent-form fields and excludes career diagnostics from match context", () => {
    const rows = Array.from({ length: 25 }, (_, index) => observation(index + 1, {
      recallScore: index < 5 ? 10 : 90,
      familyPercentiles: familyScores(index < 5 ? 20 : 80),
    }))
    const career = buildPerformanceProfile({ rviObservations: rows })!
    const match = buildPerformanceProfile({ rviObservations: [rows.at(-1)!], scoringContext: "match" })!

    expect(career.score).toBe(68)
    expect(career.recentHeadline?.score).toBe(79.25)
    expect(career.dimensions.filter((dimension) =>
      dimension.key !== "consistency_versatility").every((dimension) =>
      dimension.score === 68 && dimension.recentScore === 80 && dimension.delta === 12)).toBe(true)
    expect(career.growthKey).toBe("combat")
    expect(career.auxiliary?.contributesThroughRange).toBe(true)
    expect(match.recentHeadline).toBeUndefined()
    expect(match.auxiliary).toBeUndefined()
    expect(match.growthKey).toBeUndefined()
    expect(match.dimensions.every((dimension) =>
      dimension.recentScore === undefined && dimension.delta === undefined)).toBe(true)
  })

  it("keeps observed zero, excludes missing values, and exposes coverage separately", () => {
    const profile = buildPerformanceProfile({
      rviObservations: [
        observation(1, { recallScore: 20, familyPercentiles: familyScores(0) }),
        observation(2, { recallScore: null, familyPercentiles: familyScores(null) }),
      ],
    })!

    expect(profile.score).toBe(0)
    expect(profile.games).toBe(2)
    expect(profile.measuredGames).toBe(1)
    expect(profile.coverage).toBe(.5)
    expect(profile.headline.coverage.gameRatio).toBe(.5)
    expect(profile.dimensions).toHaveLength(8)
    expect(profile.dimensions.slice(0, -1).every((dimension) =>
      dimension.score === 0 && dimension.games === 1)).toBe(true)
    expect(profile.dimensions.at(-1)?.score).toBeNull()
  })

  it("uses explicit half-life weighting without changing the underlying formula", () => {
    const profile = buildPerformanceProfile({
      rviObservations: [
        observation(1, { playedAt: 0, recallScore: 0, familyPercentiles: familyScores(0) }),
        observation(2, { playedAt: 10, recallScore: 50, familyPercentiles: familyScores(50) }),
        observation(3, { playedAt: 20, recallScore: 100, familyPercentiles: familyScores(100) }),
      ],
      weighting: { kind: "half_life", halfLifeMs: 10 },
    })!

    expect(profile.score).toBe(71)
    expect(profile.headline.score).toBeCloseTo(125 / 1.75, 9)
    expect(profile.headline.nEff).toBeCloseTo(3.0625 / 1.3125, 9)
    expect(profile.weighting).toEqual({ kind: "half_life", halfLifeMs: 10, referenceTime: 20 })
  })

  it("keeps the career arm headline independent of input order", () => {
    const rows = [10, 30, 70, 90].map((recallScore, index) => observation(index + 1, {
      recallScore,
      familyPercentiles: familyScores(recallScore),
    }))
    const ordered = buildPerformanceProfile({ rviObservations: rows })!
    const reversed = buildPerformanceProfile({ rviObservations: [...rows].reverse() })!

    expect(reversed.headline).toEqual(ordered.headline)
    expect(ordered.headline).toMatchObject({
      source: "career_arm_mean",
      score: 50,
      availableArms: 7,
    })
  })

  it("uses mode family to expose exactly four Abyss match arms plus career Range", () => {
    const row = observation(1, {
      championId: 54,
      recallScore: 35,
      familyPercentiles: familyScores(40),
    })
    const plain = buildPerformanceProfile({ rviObservations: [row] })!
    const aram = buildPerformanceProfile({
      rviObservations: [row],
      family: "aram",
    })!

    expect(aram.score).toBe(plain.score)
    expect(aram.dimensions.map((dimension) => dimension.key)).toEqual([
      "combat",
      "positioning_survival",
      "control_utility",
      "economy",
      "consistency_versatility",
    ])
    expect(aram.dimensions.flatMap((dimension) =>
      dimension.metrics.map((metric) => metric.key))).toEqual([])
  })

  it("rejects observations from a different recipe", () => {
    expect(() => buildPerformanceProfile({
      rviObservations: [observation(1, { recipeId: "another-recipe" })],
    })).toThrow(/recipe/)
  })
})
