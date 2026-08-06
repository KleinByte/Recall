import { describe, expect, it } from "vitest"
import {
  bootstrapDifference, empiricalPercentile, sessionize,
  shrinkRate, wilsonInterval,
} from "../electron/main/matches/analytics.js"

describe("analytics primitives", () => {
  it.each([[0, 1], [1, 1], [0, 20], [20, 20]])(
    "keeps Wilson bounds valid for %i wins in %i games",
    (wins, games) => {
      const interval = wilsonInterval(wins, games)
      expect(interval.low).toBeGreaterThanOrEqual(0)
      expect(interval.high).toBeLessThanOrEqual(1)
      expect(interval.low).toBeLessThanOrEqual(interval.high)
    },
  )

  it("shrinks a sparse rate more than a supported rate", () => {
    const sparse = shrinkRate(1, 1, 0.5)
    const supported = shrinkRate(100, 100, 0.5)
    expect(sparse).toBeLessThan(supported)
    expect(sparse).toBeCloseTo(7 / 13)
  })

  it("gives tied empirical values their shared midrank", () => {
    expect(empiricalPercentile([1, 2, 2, 4], 2)).toBeCloseTo(0.5)
  })

  it("breaks sessions after more than 90 minutes from game end", () => {
    const games = [
      { gameId: 1, startedAt: 0, durationSecs: 30 * 60 },
      { gameId: 2, startedAt: 100 * 60_000, durationSecs: 25 * 60 },
      { gameId: 3, startedAt: 215 * 60_000, durationSecs: 24 * 60 },
    ]
    expect(sessionize(games).map((game) => game.sessionGame)).toEqual([1, 2, 1])
  })

  it("starts a new session around a missing end time", () => {
    const games = [
      { gameId: 1, startedAt: 0, durationSecs: undefined },
      { gameId: 2, startedAt: 10_000, durationSecs: 10 },
    ]
    expect(sessionize(games).map((game) => game.sessionGame)).toEqual([1, 1])
  })

  it("returns the same bootstrap interval for the same seed", () => {
    const first = bootstrapDifference([.8, .9], [.2, .3], "player:aram:dpm")
    const second = bootstrapDifference([.8, .9], [.2, .3], "player:aram:dpm")
    expect(first).toEqual(second)
  })
})
