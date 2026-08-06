import { describe, expect, it } from "vitest"
import { bootstrapSessionArithmeticMean, wilson95 } from "../electron/main/matches/statistics.js"
import { benjaminiHochberg, conditionFindingV3 } from "../electron/main/matches/statistical-contract-v3.js"

describe("statistics v3", () => {
  it("returns truthful Wilson intervals including zero and n=1", () => {
    expect(wilson95(0, 0)).toMatchObject({ value: null, interval: null })
    expect(wilson95(0, 1)).toMatchObject({ numerator: 0, denominator: 1, value: 0 })
    expect(wilson95(1, 1).interval?.high).toBe(1)
  })

  it("bootstraps a game-weighted arithmetic mean by session deterministically", () => {
    const input = [
      { sessionId: "a", value: 0 }, { sessionId: "a", value: 0 },
      { sessionId: "a", value: 9 }, { sessionId: "b", value: 1 },
      { sessionId: "c", value: 2 },
    ]
    const first = bootstrapSessionArithmeticMean(input, "chart-mean:test:bucket")
    const second = bootstrapSessionArithmeticMean(input, "chart-mean:test:bucket")
    expect(first).toEqual(second)
    expect(first.mean).toBe(2.4)
    expect(first.draws).toBe(2_000)
  })

  it("uses a disjoint complement and session-cluster bootstrap", () => {
    const values = Array.from({ length: 16 }, (_, index) => ({
      id: index, sessionId: Math.floor(index / 2), selected: index < 8,
      gradeScore: index < 8 ? 1 : 0,
    }))
    const finding = conditionFindingV3(values, "fixture")
    expect(finding).toMatchObject({ status: "ready", selectedGames: 8,
      complementGames: 8, sessions: 8, effect: 1, draws: 2_000 })
    expect(finding.interval?.low).toBe(1)
  })

  it("applies Benjamini-Hochberg to one report family", () => {
    expect(benjaminiHochberg([
      { key: "a", pValue: .01 }, { key: "b", pValue: .04 },
      { key: "c", pValue: .2 }, { key: "d", pValue: .9 },
    ]).map((entry) => entry.passes)).toEqual([true, true, false, false])
  })
})
