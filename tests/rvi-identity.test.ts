import { describe, expect, it } from "vitest"
import { classifyRviIdentity } from "../src/helpers/rvi-identity"
import type { PerformanceDimensionScore, PerformanceProfile } from "../src/types/stats"

const dimension = (key: string, score: number): PerformanceDimensionScore => ({
  key,
  label: key,
  shortLabel: key,
  description: key,
  score,
  recentScore: score,
  delta: 0,
  games: 40,
  eligibleGames: 40,
  coverage: 1,
  effectiveGames: 40,
  confidence: "established",
  responsibilityWeight: 1,
  headlineEligible: true,
  careerOnly: false,
  metrics: [],
})

const profile = (scores: Record<string, number>, measuredGames = 40): PerformanceProfile => {
  const score = Object.values(scores).reduce((sum, value) => sum + value, 0) /
    Object.keys(scores).length
  const confidence = measuredGames >= 30
    ? "established" as const
    : measuredGames >= 10 ? "provisional" as const : "learning" as const
  const coverage = {
    eligibleGames: measuredGames,
    observedGames: measuredGames,
    gameRatio: 1,
    eligibleWeight: measuredGames,
    observedWeight: measuredGames,
    weightRatio: 1,
  }
  const headline = {
    source: "role_fit" as const,
    score,
    nEff: measuredGames,
    confidence,
    coverage,
    confidenceInterval95: {
      method: "deterministic_match_bootstrap_percentile" as const,
      confidenceLevel: 0.95 as const,
      lower: score,
      upper: score,
      replicates: 2_000,
      seed: 1,
      observedGames: measuredGames,
    },
  }
  return {
    algorithmVersion: 3,
    recipeId: "test-recipe",
    scoringContext: "profile",
    weighting: { kind: "equal" },
    score,
    roleFitAverage: score,
    headline,
    scopes: {
      overall: {
        kind: "overall",
        key: "overall",
        score,
        headline,
        games: measuredGames,
        measuredGames,
        coverage: 1,
        confidence,
      },
      positions: [],
      primaryArchetypes: [],
    },
    games: measuredGames,
    recentGames: Math.min(20, measuredGames),
    measuredGames,
    coverage: 1,
    confidence,
    comparison: "test",
    dimensions: Object.entries(scores).map(([key, value]) => dimension(key, value)),
  }
}

describe("RVI identity", () => {
  it("waits for a measured RVI sample", () => {
    expect(classifyRviIdentity(profile({ combat: 80, control_utility: 74 }, 4)).label)
      .toBe("Developing Identity")
  })

  it("turns the RVI shape into a recognizable playstyle", () => {
    const result = classifyRviIdentity(profile({
      combat: 78,
      control_utility: 72,
      economy: 57,
      positioning_survival: 54,
      objectives_macro: 52,
      vision_setup: 49,
    }))

    expect(result.label).toBe("Playmaker")
    expect(result.vectors).toEqual(["combat", "control_utility"])
    expect(result.description).toContain("fight impact")
  })

  it("uses a single vector when it clearly dominates", () => {
    expect(classifyRviIdentity(profile({ combat: 82, economy: 60, vision_setup: 48 })).label)
      .toBe("Combat Carry")
  })

  it("recognizes an even RVI shape", () => {
    expect(classifyRviIdentity(profile({
      combat: 62,
      initiative_pressure: 61,
      positioning_survival: 60,
      control_utility: 59,
      economy: 58,
      objectives_macro: 57,
    })).label)
      .toBe("All-Rounder")
  })

  it("uses macro-oriented archetypes instead of category summaries", () => {
    expect(classifyRviIdentity(profile({
      objectives_macro: 78,
      economy: 73,
      vision_setup: 55,
      combat: 52,
      control_utility: 51,
      positioning_survival: 50,
    })).label).toBe("Macro Player")
  })

  it("uses availability and control for the vanguard identity", () => {
    expect(classifyRviIdentity(profile({
      control_utility: 79,
      positioning_survival: 74,
      combat: 56,
      objectives_macro: 54,
      economy: 52,
      vision_setup: 51,
    })).label).toBe("Vanguard")
  })
})
