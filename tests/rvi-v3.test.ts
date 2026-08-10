import { describe, expect, it } from "vitest"
import {
  aggregateRviProfile,
  clusterFights,
  effectiveSampleSize,
  halfLifeWeight,
  type RviMatchObservation,
  type RviMetricObservation,
} from "../electron/main/matches/rvi-contract.js"

const RECIPE_ID = "rvi-v3:test-recipe"

function observation(
  matchId: number,
  overrides: Partial<Omit<RviMatchObservation, "matchId">> = {},
): RviMatchObservation {
  return {
    matchId,
    recipeId: RECIPE_ID,
    playedAt: matchId * 1_000,
    roleFitScore: 50,
    familyPercentiles: { fighting: 50, resources: 50 },
    familyResponsibilityWeights: { fighting: .5, resources: .5 },
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
    vector: "threat",
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

describe("RVI v3 profile aggregation", () => {
  it("defaults to equal weights and takes the headline only from stored role-fit scores", () => {
    const result = aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["fighting", "resources"],
      observations: [
        observation(1, {
          roleFitScore: 90,
          familyPercentiles: { fighting: 10, resources: 100 },
        }),
        observation(2, {
          roleFitScore: 70,
          familyPercentiles: { fighting: 20, resources: 0 },
        }),
      ],
    })

    expect(result.weighting).toEqual({ kind: "equal" })
    expect(result.headline).toMatchObject({ source: "role_fit", score: 80, nEff: 2 })
    expect(result.families.map(({ key, score }) => ({ key, score }))).toEqual([
      { key: "fighting", score: 15 },
      { key: "resources", score: 50 },
    ])
  })

  it("keeps zero observed, reports missing coverage, and never shrinks toward 50", () => {
    const result = aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["fighting", "resources"],
      observations: [
        observation(1, { roleFitScore: 20, familyPercentiles: { fighting: 0 } }),
        observation(2, { roleFitScore: null, familyPercentiles: { fighting: null } }),
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
      familyKeys: ["fighting", "resources"],
      observations: [
        observation(1, {
          familyResponsibilityWeights: { fighting: .25, resources: .75 },
        }),
        observation(2, {
          familyResponsibilityWeights: { fighting: 0, resources: 1 },
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
      familyKeys: ["threat"],
      observations: [
        observation(1, {
          familyPercentiles: { threat: 0 },
          familyResponsibilityWeights: { threat: .25 },
          metrics: [metric("damage_share", 0, .2)],
        }),
        observation(2, {
          familyPercentiles: { threat: null },
          familyResponsibilityWeights: { threat: .25 },
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
        gradeWeight: .25,
        coverage: expect.objectContaining({ observedGames: 1, eligibleGames: 2 }),
        rawCoverage: expect.objectContaining({ observedGames: 2, eligibleGames: 2 }),
      }),
    ])
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
        familyKeys: ["threat"],
        observations: metrics.map((entry, index) => observation(index + 1, {
          familyPercentiles: { threat: index === 0 ? null : 70 },
          familyResponsibilityWeights: { threat: entry.gradeWeight },
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
      observation(1, { playedAt: 0, roleFitScore: 0 }),
      observation(2, { playedAt: 10, roleFitScore: 50 }),
      observation(3, { playedAt: 20, roleFitScore: 100 }),
    ]
    const equal = aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["fighting", "resources"],
      observations,
    })
    const decayed = aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["fighting", "resources"],
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
    const observations = [10, 30, 70, 90].map((roleFitScore, index) =>
      observation(index + 1, { roleFitScore }))
    const aggregate = (rows: RviMatchObservation[]) => aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["fighting", "resources"],
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
      familyKeys: ["fighting"],
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
      familyKeys: ["fighting", "resources"],
      observations: [observation(1, { roleFitScore: 20 })],
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
      familyKeys: ["fighting", "resources"],
      observations: [10, 20, 30, 40, 100].map((roleFitScore, index) =>
        observation(index + 1, { roleFitScore })),
    })

    expect(result.headline.score).toBe(40)
    expect(result.consistency.median).toBe(30)
    expect(result.consistency.q1).toBe(20)
    expect(result.consistency.scaledMad).toBeCloseTo(14.826, 9)
  })

  it("reports champion and position Hill D1 diversity without changing the headline", () => {
    const result = aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["fighting", "resources"],
      observations: [
        observation(1, { championId: 18, position: "top", roleFitScore: 100 }),
        observation(2, { championId: 60_018, position: " TOP ", roleFitScore: 0 }),
        observation(3, { championId: 2, position: "middle", roleFitScore: 100 }),
        observation(4, { championId: 3, position: "MIDDLE", roleFitScore: 0 }),
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
      familyKeys: ["fighting", "resources"],
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
      familyKeys: ["fighting", "vision"],
      observations: [observation(1, {
        roleFitScore: 75,
        familyPercentiles: { fighting: 60 },
        familyResponsibilityWeights: { fighting: 1, vision: null },
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

  it("rejects mixed recipes, duplicates, unknown families, and scores outside 0-100", () => {
    const aggregate = (observations: RviMatchObservation[]) => aggregateRviProfile({
      recipeId: RECIPE_ID,
      familyKeys: ["fighting", "resources"],
      observations,
    })

    expect(() => aggregate([
      observation(1, { recipeId: "another-recipe" }),
    ])).toThrow(/recipe/)
    expect(() => aggregate([observation(1), observation(1)])).toThrow(/duplicate match/)
    expect(() => aggregate([
      observation(1, { familyPercentiles: { fighting: 50, unknown: 50 } }),
    ])).toThrow(/unknown family/)
    expect(() => aggregate([observation(1, { roleFitScore: 101 })])).toThrow(/roleFitScore/)
    expect(() => aggregate([observation(1, {
      familyResponsibilityWeights: { fighting: 1.1, resources: 0 },
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
