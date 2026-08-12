import { describe, expect, it } from "vitest"
import {
  calendarDays,
  commonSignatureAxes,
  completeRecentRadar,
  durationRecallScoreBins,
  driftSeries,
  MIN_DURATION_TREND_GAMES,
  MIN_WEEKDAY_DISTRIBUTION_GAMES,
  weekdayRecallScoreGroups,
} from "../src/charts/evidence-adapters.js"

describe("chart evidence adapters", () => {
  it("keeps an ungraded day null instead of fabricating B+", () => {
    expect(calendarDays([
      { gameId: 1, playedAt: Date.UTC(2026, 7, 5), championId: 26, win: true, durationSecs: 1_000 },
    ])[0]).toMatchObject({ recallScore: null, games: 1, wins: 1 })
  })

  it("omits weekdays with no finite grades", () => {
    const groups = weekdayRecallScoreGroups([
      { gameId: 1, playedAt: new Date(2026, 7, 3, 12).getTime(), championId: 1, win: true, durationSecs: 1_000, recallScore: 0 },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ label: "Mon", values: [0], eligible: false })
  })

  it("requires three graded matches before a weekday distribution is eligible", () => {
    const monday = new Date(2026, 7, 3, 12).getTime()
    const games = [42, 58, 66].map((recallScore, index) => ({
      gameId: index + 1,
      playedAt: monday + index * 60_000,
      championId: 1,
      win: true,
      durationSecs: 1_000,
      recallScore,
    }))

    expect(MIN_WEEKDAY_DISTRIBUTION_GAMES).toBe(3)
    expect(weekdayRecallScoreGroups(games.slice(0, 2))[0]?.eligible).toBe(false)
    expect(weekdayRecallScoreGroups(games)[0]?.eligible).toBe(true)
  })

  it("uses unsummarized gaps and a five-game median for duration trends", () => {
    const games = [
      ...[10, 20, 30, 40].map((recallScore, index) => ({
        gameId: index + 1,
        playedAt: index,
        championId: 1,
        win: true,
        durationSecs: 12 * 60 + index,
        recallScore,
      })),
      ...[5, 90, 35, 45, 55].map((recallScore, index) => ({
        gameId: index + 10,
        playedAt: index + 10,
        championId: 2,
        win: false,
        durationSecs: 22 * 60 + index,
        recallScore,
      })),
    ]

    expect(MIN_DURATION_TREND_GAMES).toBe(5)
    expect(durationRecallScoreBins(games)).toEqual([
      { minute: 12.5, label: "10–15 min", games: 4, median: null },
      { minute: 17.5, label: "15–20 min", games: 0, median: null },
      { minute: 22.5, label: "20–25 min", games: 5, median: 45 },
    ])
  })

  it("uses only complete common signature axes", () => {
    const rows = [
      { components: [{ key: "combat", label: "Combat", percentile: 0, weight: 1, contribution: 0, scope: "lobby" as const }] },
      { components: [] },
    ]
    expect(commonSignatureAxes(rows)).toEqual([])
  })

  it("does not copy career radar or neutralize drift when recent evidence is missing", () => {
    expect(completeRecentRadar([
      { key: "fight", recentScore: 0 },
      { key: "vision", recentScore: undefined },
    ])).toBeUndefined()
    expect(driftSeries([
      { label: "A", axes: [{ key: "fight", value: 0 }] },
      { label: "B", axes: [] },
    ], "fight")).toEqual([0, null])
  })
})
