import { describe, expect, it } from "vitest"
import {
  aggregateRviProfile,
  clusterFights,
  effectiveSampleSize,
  halfLifeWeight,
  type RviMatchObservation,
  type RviMetricObservation,
} from "../electron/main/matches/rvi-contract.js"
import { DEFAULT_GRADE_RECIPE_ID } from
  "../electron/main/matches/match-grade-recipe.js"

const RECIPE_ID = "rvi-current:test-recipe"

function observation(
  matchId: number,
  overrides: Partial<Omit<RviMatchObservation, "matchId">> = {},
): RviMatchObservation {
  return {
    matchId,
    recipeId: RECIPE_ID,
    playedAt: matchId * 1_000,
    recallScore: 50,
    familyPercentiles: { combat: 50, economy: 50 },
    familyResponsibilityWeights: { combat: .5, economy: .5 },
    championId: 1,
    position: "MIDDLE",
    primaryArchetype: "burst_mage",
    ...overrides,
  }
}

function metric(
  key: string,
  score: number | null,
  raw: number | null = score,
): RviMetricObservation {
  return {
    key,
    vector: "combat",
    label: key,
    description: `${key} description`,
    formula: key,
    unit: "%",
    tier: "CORE",
    vectorWeight: 1,
    gradeWeight: .25,
    rawEvidence: raw === null
      ? { state: "unavailable", reason: "raw_missing" }
      : { state: "observed", value: raw },
    scoreEvidence: score === null
      ? { state: "unavailable", reason: "score_missing" }
      : { state: "observed", value: score },
    comparisonScope: "position",
    referenceMatchCount: 40,
  }
}

describe("RVI profile aggregation", () => {
  it("preserves the pure-caller bootstrap seed across the identity-only rename", () => {
    const oldRecipeId =
      "recall.grade.v3.radar-arms.2026-08-10.r2@calibration:compatibility-lobby-rank-r1"
    const rows = [90, 0, 45].map((recallScore, index) => ({
      ...observation(index + 1, { recallScore }),
      recipeId: DEFAULT_GRADE_RECIPE_ID,
    }))
    const current = aggregateRviProfile({
      recipeId: DEFAULT_GRADE_RECIPE_ID,
      familyKeys: ["combat", "economy"],
      observations: rows,
    }).headline.confidenceInterval95
    const legacy = aggregateRviProfile({
      recipeId: oldRecipeId,
      familyKeys: ["combat", "economy"],
      observations: rows.map((row) => ({ ...row, recipeId: oldRecipeId })),
    }).headline.confidenceInterval95

    expect(current).toEqual(legacy)
    expect(current).toMatchInlineSnapshot(`
      {
        "confidenceLevel": 0.95,
        "lower": 15,
        "method": "deterministic_match_bootstrap_percentile",
        "observedGames": 3,
        "replicates": 2000,
        "seed": 3395782763,
        "upper": 90,
      }
    `)
  })

  it("defaults to equal weights and takes the headline only from stored recall-score scores", () => {
    const result = aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["combat", "economy"],
      observations: [
        observation(1, {
          recallScore: 90,
          familyPercentiles: { combat: 10, economy: 100 },
        }),
        observation(2, {
          recallScore: 70,
          familyPercentiles: { combat: 20, economy: 0 },
        }),
      ],
    })

    expect(result.weighting).toEqual({ kind: "equal" })
    expect(result.headline).toMatchObject({ source: "role_fit", score: 80, nEff: 2 })
    expect(result.families.map(({ key, score }) => ({ key, score }))).toEqual([
      { key: "combat", score: 15 },
      { key: "economy", score: 50 },
    ])
  })

  it("keeps zero observed, reports missing coverage, and never shrinks toward 50", () => {
    const result = aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["combat", "economy"],
      observations: [
        observation(1, { recallScore: 20, familyPercentiles: { combat: 0 } }),
        observation(2, { recallScore: null, familyPercentiles: { combat: null } }),
      ],
    })

    expect(result.headline.score).toBe(20)
    expect(result.headline.confidence).toBe("learning")
    expect(result.headline.coverage).toEqual({
      eligibleGames: 2,
      observedGames: 1,
      gameRatio: .5,
      eligibleWeight: 2,
      observedWeight: 1,
      weightRatio: .5,
    })
    expect(result.families[0]).toMatchObject({ score: 0, nEff: 1, confidence: "learning" })
  })

  it("aggregates exact stored family responsibility weights without promoting zero", () => {
    const result = aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["combat", "economy"],
      observations: [
        observation(1, {
          familyResponsibilityWeights: { combat: .25, economy: .75 },
        }),
        observation(2, {
          familyResponsibilityWeights: { combat: 0, economy: 1 },
        }),
      ],
    })

    expect(result.families[0].responsibility).toMatchObject({
      averageWeight: .125,
      positiveGames: 1,
      nEff: 2,
      coverage: { observedGames: 2, gameRatio: 1 },
    })
    expect(result.families[1].responsibility).toMatchObject({
      averageWeight: .875,
      positiveGames: 2,
    })
  })

  it("retains metric rows with raw values, score coverage, and observed zero", () => {
    const result = aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["combat"],
      observations: [
        observation(1, {
          familyPercentiles: { combat: 0 },
          familyResponsibilityWeights: { combat: .25 },
          metrics: [metric("damage_share", 0, .2)],
        }),
        observation(2, {
          familyPercentiles: { combat: null },
          familyResponsibilityWeights: { combat: .25 },
          metrics: [metric("damage_share", null, .3)],
        }),
      ],
    })

    expect(result.families[0].metrics).toEqual([
      expect.objectContaining({
        key: "damage_share",
        score: 0,
        rawValue: .25,
        evidenceState: "observed",
        evidenceReason: undefined,
        gradeWeight: .25,
        coverage: expect.objectContaining({ observedGames: 1, eligibleGames: 2 }),
        rawCoverage: expect.objectContaining({ observedGames: 2, eligibleGames: 2 }),
      }),
    ])
  })

  it("uses the same neutral fixed-denominator fallback when an arm score is absent", () => {
    const row = (
      key: string,
      score: number | null,
      tier: RviMetricObservation["tier"],
      vectorWeight: number,
    ): RviMetricObservation => ({
      ...metric(key, score),
      vector: "combat",
      tier,
      vectorWeight,
    })
    const aggregate = (championDamage: number | null) => aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["combat"],
      observations: [observation(1, {
        familyPercentiles: { combat: null },
        familyResponsibilityWeights: { combat: 1 },
        metrics: [
          row("damage_share", 20, "CORE", .3),
          row("kill_participation", 80, "CORE", .3),
          row("champion_damage_per_min", championDamage, "SECONDARY", .15),
        ],
      })],
    }).families[0].score

    expect(aggregate(null)).toBe(50)
    expect(aggregate(100)).toBe(60)
  })

  it("aggregates changing responsibility tiers independently of match order", () => {
    const core = metric("cs_per_min", 70, 8)
    const notApplicable: RviMetricObservation = {
      ...metric("cs_per_min", 90, 2),
      tier: "N/A",
      vectorWeight: 0,
      gradeWeight: 0,
    }
    const aggregate = (metrics: readonly [RviMetricObservation, RviMetricObservation]) =>
      aggregateRviProfile({
        recipeId: RECIPE_ID,
        familyKeys: ["combat"],
        observations: metrics.map((entry, index) => observation(index + 1, {
          familyPercentiles: { combat: index === 0 ? null : 70 },
          familyResponsibilityWeights: { combat: entry.gradeWeight },
          metrics: [entry],
        })),
      }).families[0].metrics[0]

    expect(aggregate([notApplicable, core])).toMatchObject({
      tier: "CORE",
      score: 70,
      coverage: { eligibleGames: 1, observedGames: 1 },
    })
    expect(aggregate([core, notApplicable])).toMatchObject({
      tier: "CORE",
      score: 70,
      coverage: { eligibleGames: 1, observedGames: 1 },
    })
  })

  it("applies an explicit exponential half-life and Kish effective sample size", () => {
    const observations = [
      observation(1, { playedAt: 0, recallScore: 0 }),
      observation(2, { playedAt: 10, recallScore: 50 }),
      observation(3, { playedAt: 20, recallScore: 100 }),
    ]
    const equal = aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["combat", "economy"],
      observations,
    })
    const decayed = aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["combat", "economy"],
      observations,
      weighting: { kind: "half_life", halfLifeMs: 10 },
    })

    expect(halfLifeWeight(10, 10)).toBe(.5)
    expect(equal.headline.score).toBe(50)
    expect(equal.headline.nEff).toBe(3)
    expect(decayed.weighting).toEqual({ kind: "half_life", halfLifeMs: 10, referenceTime: 20 })
    expect(decayed.headline.score).toBeCloseTo(125 / 1.75, 9)
    expect(decayed.headline.nEff).toBeCloseTo(3.0625 / 1.3125, 9)
    expect(effectiveSampleSize([.25, .5, 1])).toBeCloseTo(3.0625 / 1.3125, 9)
  })

  it("produces a deterministic 95% match-bootstrap headline interval", () => {
    const observations = [10, 30, 70, 90].map((recallScore, index) =>
      observation(index + 1, { recallScore }))
    const aggregate = (rows: RviMatchObservation[]) => aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["combat", "economy"],
      observations: rows,
    })
    const first = aggregate(observations)
    const reordered = aggregate([...observations].reverse())

    expect(reordered.headline.confidenceInterval95)
      .toEqual(first.headline.confidenceInterval95)
    expect(first.headline.confidenceInterval95).toMatchObject({
      method: "deterministic_match_bootstrap_percentile",
      confidenceLevel: .95,
      replicates: 2_000,
      observedGames: 4,
    })
    expect(first.headline.confidenceInterval95.lower).toBeLessThanOrEqual(first.headline.score!)
    expect(first.headline.confidenceInterval95.upper).toBeGreaterThanOrEqual(first.headline.score!)
  })

  it("reports an empty bootstrap interval when no headline is observed", () => {
    const result = aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["combat"],
      observations: [],
    })

    expect(result.headline.score).toBeNull()
    expect(result.headline.confidenceInterval95).toEqual({
      method: "deterministic_match_bootstrap_percentile",
      confidenceLevel: .95,
      lower: null,
      upper: null,
      replicates: 0,
      seed: null,
      observedGames: 0,
    })
  })

  it("keeps confidence metadata separate from the score", () => {
    const input = {
      recipeId: RECIPE_ID,
      familyKeys: ["combat", "economy"],
      observations: [observation(1, { recallScore: 20 })],
    } as const
    const learning = aggregateRviProfile(input)
    const provisional = aggregateRviProfile({
      ...input,
      confidenceThresholds: { provisionalGames: 1, establishedGames: 2 },
    })

    expect(learning.headline).toMatchObject({ score: 20, confidence: "learning" })
    expect(provisional.headline).toMatchObject({ score: 20, confidence: "provisional" })
  })

  it("reports weighted median, Q1, and normal-scaled MAD outside the headline", () => {
    const result = aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["combat", "economy"],
      observations: [10, 20, 30, 40, 100].map((recallScore, index) =>
        observation(index + 1, { recallScore })),
    })

    expect(result.headline.score).toBe(40)
    expect(result.consistency.median).toBe(30)
    expect(result.consistency.q1).toBe(20)
    expect(result.consistency.scaledMad).toBeCloseTo(14.826, 9)
  })

  it("reports champion and position Hill D1 diversity without changing the headline", () => {
    const result = aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["combat", "economy"],
      observations: [
        observation(1, { championId: 18, position: "top", recallScore: 100 }),
        observation(2, { championId: 60_018, position: " TOP ", recallScore: 0 }),
        observation(3, { championId: 2, position: "middle", recallScore: 100 }),
        observation(4, { championId: 3, position: "MIDDLE", recallScore: 0 }),
      ],
    })

    expect(result.headline.score).toBe(50)
    expect(result.versatility.champions.effectiveCount).toBeCloseTo(Math.sqrt(8), 9)
    expect(result.versatility.champions.categories.map(({ key, share }) => ({ key, share })))
      .toEqual([
        { key: "18", share: .5 },
        { key: "2", share: .25 },
        { key: "3", share: .25 },
      ])
    expect(result.versatility.positions.effectiveCount).toBeCloseTo(2, 9)
    expect(result.versatility.positions.categories.map(({ key, share }) => ({ key, share })))
      .toEqual([
        { key: "MIDDLE", share: .5 },
        { key: "TOP", share: .5 },
      ])
  })

  it("does not count unresolved or non-canonical roles as position versatility", () => {
    const result = aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["combat", "economy"],
      observations: [
        observation(1, { position: "TOP" }),
        observation(2, { position: "UNKNOWN" }),
        observation(3, { position: "" }),
        observation(4, { position: "fill" }),
      ],
    })

    expect(result.versatility.positions).toMatchObject({
      effectiveCount: 1,
      coverage: { eligibleGames: 4, observedGames: 1, gameRatio: .25 },
    })
    expect(result.versatility.positions.categories).toEqual([
      { key: "TOP", weight: 1, share: 1 },
    ])
  })

  it("retains empty family vectors with separate zero coverage", () => {
    const result = aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["combat", "vision"],
      observations: [observation(1, {
        recallScore: 75,
        familyPercentiles: { combat: 60 },
        familyResponsibilityWeights: { combat: 1, vision: null },
      })],
    })

    expect(result.headline.score).toBe(75)
    expect(result.families[1]).toMatchObject({
      key: "vision",
      score: null,
      nEff: 0,
      confidence: null,
      coverage: { eligibleGames: 1, observedGames: 0, gameRatio: 0, weightRatio: 0 },
    })
  })

  it("keeps career Range learning until twenty Grade-ready games", () => {
    const rows = Array.from({ length: 19 }, (_, index) => observation(index + 1, {
      recallScore: 60,
      familyPercentiles: { combat: 60, consistency_versatility: null },
      familyResponsibilityWeights: { combat: 1, consistency_versatility: 0 },
      championId: 1,
      position: "MIDDLE",
      primaryArchetype: "burst_mage",
    }))
    const result = aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["combat", "consistency_versatility"],
      observations: rows,
    })

    expect(result.families.at(-1)).toMatchObject({
      key: "consistency_versatility",
      score: null,
      confidence: "learning",
    })
  })

  it("uses the approved consistency floor and adaptive Hill-D1 breadth in Range", () => {
    const rows = Array.from({ length: 20 }, (_, index) => observation(index + 1, {
      recallScore: 60,
      familyPercentiles: { combat: 60, consistency_versatility: null },
      familyResponsibilityWeights: { combat: 1, consistency_versatility: 0 },
      championId: 1 + index % 4,
      position: index % 2 ? "MIDDLE" : "BOTTOM",
      primaryArchetype: index % 2 ? "burst_mage" : "marksman",
    }))
    const result = aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["combat", "consistency_versatility"],
      observations: rows,
    })

    // At 20 games the adaptive targets are 2 positions, 2 archetypes, and
    // 4 champions. Balanced coverage reaches full breadth in every domain.
    expect(result.families.at(-1)).toMatchObject({
      key: "consistency_versatility",
      score: 76,
      confidence: "provisional",
    })
    expect(result.versatility.archetypes.effectiveCount).toBeCloseTo(2, 9)
  })

  it("rejects mixed recipes, duplicates, unknown families, and scores outside 0-100", () => {
    const aggregate = (observations: RviMatchObservation[]) => aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["combat", "economy"],
      observations,
    })

    expect(() => aggregate([
      observation(1, { recipeId: "another-recipe" }),
    ])).toThrow(/recipe/)
    expect(() => aggregate([observation(1), observation(1)])).toThrow(/duplicate match/)
    expect(() => aggregate([
      observation(1, { familyPercentiles: { combat: 50, unknown: 50 } }),
    ])).toThrow(/unknown family/)
    expect(() => aggregate([observation(1, { recallScore: 101 })])).toThrow(/recallScore/)
    expect(() => aggregate([observation(1, {
      familyResponsibilityWeights: { combat: 1.1, economy: 0 },
    })])).toThrow(/responsibility weight/)
    expect(() => aggregate([observation(1, {
      primaryArchetype: "not_real" as RviMatchObservation["primaryArchetype"],
    })])).toThrow(/primary archetype/)
  })
})

describe("fight clustering proxies", () => {
  const event = (timestamp: number, x: number, index: number) => ({
    timestamp, originalEventIndex: index, killerId: index + 1, victimId: index + 2,
    assistingParticipantIds: [], victimPosition: { x, y: 0 },
  })

  it("clusters at inclusive 12-second/1,200-unit thresholds", () => {
    const clustered = clusterFights([event(0, 0, 0), event(12_000, 1_200, 1)])
    expect(clustered.state === "observed" && clustered.value).toHaveLength(1)
    const split = clusterFights([event(0, 0, 0), event(12_001, 1_200, 1)])
    expect(split.state === "observed" && split.value).toHaveLength(2)
  })

  it("returns unavailable for missing spatial evidence", () => {
    expect(clusterFights([{ ...event(0, 0, 0), victimPosition: undefined }]).state)
      .toBe("unavailable")
  })
})
