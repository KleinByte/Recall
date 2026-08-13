import { describe, expect, it } from "vitest"
import { REVIEW_METRIC_FLOORS } from "../electron/main/review/review-service.js"
import { recommendationDirection } from "../electron/main/review/recommendations.js"

describe("review contract", () => {
  it("pins a positive finite robust floor for every review metric", () => {
    expect(Object.keys(REVIEW_METRIC_FLOORS).sort()).toEqual([
      "cs", "damage", "deaths", "gold", "grade", "kda", "objectives", "vision",
    ])
    expect(Object.values(REVIEW_METRIC_FLOORS).every((value) =>
      Number.isFinite(value) && value > 0)).toBe(true)
  })
})

describe("recommendation direction", () => {
  it("uses fixed latest and preceding slices and requires interval evidence", () => {
    const games = Array.from({ length: 20 }, (_, index) => ({
      gameId: index + 1,
      championId: 1,
      championName: "A",
      playedAt: 10_000_000 - index * 10_000_000,
      durationSecs: 1_800,
      win: index < 10,
      kills: 1,
      deaths: 1,
      assists: 1,
      gradeScore: index < 10 ? 1 : -1,
    }))
    expect(recommendationDirection(games, "sr", 1, 0)).toMatchObject({
      direction: "up", latestGames: 10, precedingGames: 10, draws: 2_000,
    })
    expect(recommendationDirection(games.slice(0, 14), "sr", 1, 0).direction)
      .toBe("unknown")
  })
})
