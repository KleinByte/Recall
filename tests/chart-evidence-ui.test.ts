import { describe, expect, it } from "vitest"
import {
  calendarDays,
  commonSignatureAxes,
  completeRecentRadar,
  driftSeries,
  weekdayRoleFitGroups,
} from "../src/charts/evidence-adapters.js"

describe("chart evidence adapters", () => {
  it("keeps an ungraded day null instead of fabricating B+", () => {
    expect(calendarDays([
      { gameId: 1, playedAt: Date.UTC(2026, 7, 5), championId: 26, win: true, durationSecs: 1_000 },
    ])[0]).toMatchObject({ roleFitScore: null, games: 1, wins: 1 })
  })

  it("omits weekdays with no finite grades", () => {
    const groups = weekdayRoleFitGroups([
      { gameId: 1, playedAt: new Date(2026, 7, 3, 12).getTime(), championId: 1, win: true, durationSecs: 1_000, roleFitScore: 0 },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ label: "Mon", values: [0] })
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
