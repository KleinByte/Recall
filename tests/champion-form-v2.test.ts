import { describe, expect, it } from "vitest"
import {
  FORM_Z80,
  buildChampionFormV2,
  type ChampionFormGame,
} from "../electron/main/matches/champion-form.js"

const asOfMs = Date.UTC(2026, 7, 5, 17)
const game = (overrides: Partial<ChampionFormGame> = {}): ChampionFormGame => ({
  championId: 1, family: "sr", playedAt: asOfMs, gradeScore: 1,
  gradeEligible: true, analyticsEligible: true, win: true,
  kills: 5, deaths: 2, assists: 7, ...overrides,
})

describe("Champion Form v2", () => {
  it("uses the inclusive 90-calendar-day boundary", () => {
    const base = buildChampionFormV2([], { asOfMs, timeZone: "America/Chicago", family: "sr" })
    const result = buildChampionFormV2([
      game({ playedAt: base.window.lowerMs }),
      game({ championId: 2, playedAt: base.window.lowerMs - 1 }),
    ], { asOfMs, timeZone: "America/Chicago", family: "sr" })
    expect(result.earlySignals.map((row) => row.championId)).toEqual([1])
  })

  it("matches every posterior field exactly", () => {
    const games = [game({ gradeScore: 1 }), game({ gradeScore: -1, playedAt: asOfMs - 1 })]
    const [row] = buildChampionFormV2(games, {
      asOfMs, timeZone: "America/Chicago", family: "sr",
    }).earlySignals
    const sigma = Math.sqrt(2)
    expect(row.posteriorMean).toBe(0)
    expect(row.posteriorSE).toBe(sigma / Math.sqrt(10))
    expect(row.lower80).toBe(-FORM_Z80 * sigma / Math.sqrt(10))
    expect(row.upper80).toBe(FORM_Z80 * sigma / Math.sqrt(10))
    expect(row.rankScore).toBe(row.lower80)
  })

  it("uses old same-family grades only for the prior", () => {
    const preview = buildChampionFormV2([], { asOfMs, timeZone: "UTC", family: "sr" })
    const result = buildChampionFormV2([
      game({ gradeScore: 2 }),
      game({ gradeScore: -2, playedAt: preview.window.lowerMs - 1 }),
      game({ family: "aram", gradeScore: 100, playedAt: preview.window.lowerMs - 1 }),
    ], { asOfMs, timeZone: "UTC", family: "sr" })
    expect(result.earlySignals[0].gradedGames).toBe(1)
    expect(result.baselineMean).toBe(0)
    expect(result.earlySignals[0].posteriorMean).toBe(2 / 9)
  })

  it("classifies 1–4 as early, 5+ as main, and confidence at 5/12", () => {
    const games = [
      ...Array.from({ length: 4 }, (_, index) => game({ championId: 1, playedAt: asOfMs - index })),
      ...Array.from({ length: 5 }, (_, index) => game({ championId: 2, playedAt: asOfMs - index })),
      ...Array.from({ length: 12 }, (_, index) => game({ championId: 3, playedAt: asOfMs - index })),
    ]
    const result = buildChampionFormV2(games, { asOfMs, timeZone: "UTC", family: "sr" })
    expect(result.earlySignals[0]).toMatchObject({ championId: 1, confidence: "thin" })
    expect(result.main.find((row) => row.championId === 2)?.confidence).toBe("fair")
    expect(result.main.find((row) => row.championId === 3)?.confidence).toBe("solid")
  })

  it("ignores newer unsupported history when selecting the default family", () => {
    const result = buildChampionFormV2([
      game({ family: "aram", playedAt: asOfMs - 1 }),
      game({ family: "other", playedAt: asOfMs, gradeScore: null, gradeEligible: false }),
    ], { asOfMs, timeZone: "UTC" })
    expect(result.activeFamily).toBe("aram")
  })

  it("returns an explicit empty state for all-Arena history", () => {
    expect(buildChampionFormV2([
      game({ family: "other", gradeScore: null, gradeEligible: false }),
    ], { asOfMs, timeZone: "UTC" })).toMatchObject({
      activeFamily: null, reason: "no_supported_grade_history", main: [], earlySignals: [],
    })
  })
})
