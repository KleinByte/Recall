import { describe, expect, it } from "vitest"
import {
  leaveOneMatchOutPercentile,
  matchClusterWeights,
  midEcdfPercentile,
  normalQuantile,
  shrunkMidEcdf,
  type CalibrationObservation,
} from "../electron/main/matches/match-grade-calibration.js"
import { gradeForRecallScore } from "../electron/main/matches/match-grade-recipe.js"

describe("match Grade match-cluster calibration", () => {
  it("uses midpoint ECDF ties, clamps tails, and keeps zero observable", () => {
    const observations: CalibrationObservation[] = [
      { matchId: "a", value: 0 },
      { matchId: "b", value: 2 },
      { matchId: "c", value: 2 },
      { matchId: "d", value: 4 },
    ]
    expect(midEcdfPercentile(2, observations)).toBe(.5)
    expect(midEcdfPercentile(-1, observations)).toBe(.01)
    expect(midEcdfPercentile(5, observations)).toBe(.99)
    expect(midEcdfPercentile(0, observations)).toBe(.125)
    expect(midEcdfPercentile(0, observations, { direction: "lower" })).toBe(.875)
  })

  it("normalizes every match cluster to total weight one", () => {
    const weighted = matchClusterWeights([
      { matchId: "duplicated", value: 1 },
      { matchId: "duplicated", value: 2 },
      { matchId: "duplicated", value: 3, weight: 2 },
      { matchId: "single", value: 4 },
    ])
    const duplicateWeight = weighted.filter((entry) => entry.matchId === "duplicated")
      .reduce((sum, entry) => sum + entry.clusterWeight, 0)
    const singleWeight = weighted.find((entry) => entry.matchId === "single")!.clusterWeight
    expect(duplicateWeight).toBeCloseTo(1)
    expect(singleWeight).toBe(1)
  })

  it("shrinks local ECDFs toward their parent with default kappa 20", () => {
    const result = shrunkMidEcdf(3, {
      observations: [
        { matchId: "a", value: 1 },
        { matchId: "b", value: 3 },
      ],
    })
    expect(result.localPercentile).toBe(.75)
    expect(result.parentPercentile).toBe(.5)
    expect(result.percentile).toBeCloseTo((2 * .75 + 20 * .5) / 22)
    expect(result.matchClusters).toBe(2)
  })

  it("can keep the root as an exact ECDF while shrinking narrower cohorts", () => {
    const result = shrunkMidEcdf(3, {
      observations: [
        { matchId: "a", value: 1 },
        { matchId: "b", value: 3 },
      ],
    }, { rootKappa: 0 })
    expect(result.localPercentile).toBe(.75)
    expect(result.percentile).toBe(.75)
  })

  it("keeps broad-cohort tails and the median reachable after hierarchical shrinkage", () => {
    const broad = Array.from({ length: 100 }, (_, value) => ({
      matchId: `match-${Math.floor(value / 10)}`,
      value,
    }))
    const position = broad.filter(({ value }) => value % 5 === 0)
    const cohort = {
      observations: position,
      parent: { observations: position, parent: { observations: broad } },
    }
    const percentile = (value: number) => shrunkMidEcdf(value, cohort, {
      rootKappa: 0,
    }).percentile

    expect(percentile(-1)).toBe(.01)
    expect(percentile(49.5)).toBeCloseTo(.5)
    expect(percentile(100)).toBe(.99)
    expect(gradeForRecallScore(percentile(-1) * 100)).toBe("D")
    expect(gradeForRecallScore(percentile(49.5) * 100)).toBe("B+")
    expect(gradeForRecallScore(percentile(100) * 100)).toBe("S+")
  })

  it("falls back through an empty child cohort", () => {
    const result = shrunkMidEcdf(10, {
      observations: [],
      parent: {
        observations: [
          { matchId: "a", value: 0 },
          { matchId: "b", value: 10 },
        ],
      },
    }, { kappa: 0 })
    expect(result).toMatchObject({
      percentile: .75,
      parentPercentile: .75,
      matchClusters: 0,
      source: "parent_fallback",
    })
  })

  it("leave-one-match-out removes the entire dependent match cluster", () => {
    const cohort = {
      observations: [
        { matchId: "subject", value: 1 },
        { matchId: "subject", value: 100 },
        { matchId: "other", value: 2 },
      ],
    }
    const result = leaveOneMatchOutPercentile(3, "subject", cohort, { kappa: 0 })
    expect(result.matchClusters).toBe(1)
    expect(result.percentile).toBe(.99)
  })

  it("is deterministic and monotone for ordered queries", () => {
    const cohort = {
      observations: Array.from({ length: 30 }, (_, index) => ({
        matchId: `match-${index}`,
        value: (index * 17) % 23,
      })),
    }
    const first = Array.from({ length: 41 }, (_, value) => shrunkMidEcdf(value, cohort).percentile)
    const second = Array.from({ length: 41 }, (_, value) => shrunkMidEcdf(value, cohort).percentile)
    expect(second).toEqual(first)
    for (let index = 1; index < first.length; index += 1) {
      expect(first[index]).toBeGreaterThanOrEqual(first[index - 1])
    }
  })

  it("maps the absolute percentile to a bounded normal quantile", () => {
    expect(normalQuantile(.5)).toBeCloseTo(0)
    expect(normalQuantile(.99)).toBeCloseTo(2.32635, 4)
    expect(normalQuantile(.01)).toBeCloseTo(-2.32635, 4)
    expect(normalQuantile(0)).toBe(normalQuantile(.01))
  })

  it("rejects an invalid shrinkage constant", () => {
    expect(() => shrunkMidEcdf(1, { observations: [] }, { kappa: -1 })).toThrow(RangeError)
    expect(() => shrunkMidEcdf(1, { observations: [] }, { rootKappa: -1 })).toThrow(RangeError)
  })
})
