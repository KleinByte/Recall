import { describe, expect, it } from "vitest"
import {
  aggregateRviDimension,
  aggregateRviHeadline,
  aggregateRviMetric,
  clusterFights,
  scaleRviMetric,
} from "../electron/main/matches/rvi-contract.js"
import { invalid, noOpportunity, notApplicable, observed, unavailable } from "../src/shared/measurement.js"

describe("RVI v3", () => {
  it("scales, clamps, and keeps observed zero", () => {
    expect(scaleRviMetric(0, .35)).toBe(0)
    expect(scaleRviMetric(.35, .35)).toBe(1)
    expect(scaleRviMetric(.70, .35)).toBe(1)
    expect(aggregateRviMetric([observed(0), observed(1), unavailable("missing")]))
      .toMatchObject({ mean: .5, observedGames: 2, applicableEligibleGames: 3, metricCoverage: 2 / 3 })
  })

  it("excludes no-opportunity/not-applicable and counts missing evidence", () => {
    expect(aggregateRviMetric([notApplicable(), noOpportunity()])).toMatchObject({
      mean: null, metricCoverage: null,
    })
    expect(aggregateRviMetric([unavailable(), invalid()])).toMatchObject({
      mean: null, metricCoverage: 0,
    })
  })

  it("computes coverage, effective weight, nEff, and stabilization once", () => {
    const result = aggregateRviDimension([
      { key: "a", baseWeight: .6, ...aggregateRviMetric([observed(1), observed(0)]) },
      { key: "b", baseWeight: .4, ...aggregateRviMetric([observed(.5), unavailable()]) },
    ])
    expect(result.dimensionCoverage).toBe(.8)
    expect(result.availableWeight).toBe(.8)
    expect(result.dimensionRaw).toBe(.5)
    expect(result.nEff).toBeCloseTo(1.75, 9)
    expect(result.displayScore).toBe(50)
  })

  it("gates headline below .80 and never substitutes missing dimensions", () => {
    const dimension = { dimensionCoverage: .799999, availableWeight: 1,
      dimensionRaw: .5, nEff: 20, displayScore: 50, confidence: "provisional" as const }
    expect(aggregateRviHeadline(Array(6).fill(dimension)).score).toBeNull()
    expect(aggregateRviHeadline(Array(6).fill({ ...dimension, dimensionCoverage: .8 })).score).toBe(50)
    expect(aggregateRviHeadline(Array(5).fill({ ...dimension, dimensionCoverage: 1 })).score).toBeNull()
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
