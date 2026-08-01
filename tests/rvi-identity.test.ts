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
  confidence: "established",
  metrics: [],
})

const profile = (scores: Record<string, number>, measuredGames = 40): PerformanceProfile => ({
  algorithmVersion: 1,
  score: Object.values(scores).reduce((sum, score) => sum + score, 0) / Object.keys(scores).length,
  games: measuredGames,
  recentGames: Math.min(20, measuredGames),
  measuredGames,
  coverage: 1,
  confidence: measuredGames >= 30 ? "established" : measuredGames >= 10 ? "provisional" : "learning",
  comparison: "test",
  dimensions: Object.entries(scores).map(([key, score]) => dimension(key, score)),
})

describe("RVI identity", () => {
  it("waits for a measured RVI sample", () => {
    expect(classifyRviIdentity(profile({ fighting: 80, initiative: 74 }, 4)).label)
      .toBe("Developing Identity")
  })

  it("turns the RVI shape into a recognizable playstyle", () => {
    const result = classifyRviIdentity(profile({
      fighting: 78,
      initiative: 72,
      farming: 57,
      survivability: 54,
      objectives: 52,
      vision: 49,
      consistency: 55,
      versatility: 53,
    }))

    expect(result.label).toBe("Playmaker")
    expect(result.vectors).toEqual(["fighting", "initiative"])
    expect(result.description).toContain("create openings")
  })

  it("uses a single vector when it clearly dominates", () => {
    expect(classifyRviIdentity(profile({ fighting: 82, farming: 60, vision: 48 })).label)
      .toBe("Brawler")
  })

  it("recognizes an even RVI shape", () => {
    expect(classifyRviIdentity(profile({ fighting: 62, farming: 60, vision: 58, objectives: 59 })).label)
      .toBe("All-Rounder")
  })

  it("uses macro-oriented archetypes instead of category summaries", () => {
    expect(classifyRviIdentity(profile({
      objectives: 78,
      farming: 73,
      vision: 55,
      consistency: 54,
      fighting: 52,
      initiative: 51,
      survivability: 50,
      versatility: 49,
    })).label).toBe("Macro Player")
  })

  it("preserves mode-specific teamfight identities", () => {
    expect(classifyRviIdentity(profile({
      fightControl: 79,
      teamPresence: 74,
      fighting: 56,
      sustain: 54,
      survivability: 52,
      consistency: 51,
      versatility: 50,
    })).label).toBe("Teamfight Conductor")
  })
})
