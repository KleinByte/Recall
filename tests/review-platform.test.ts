import { describe, expect, it } from "vitest"
import { buildSessions } from "../electron/main/review/sessions.js"
import { recommendChampions } from "../electron/main/review/recommendations.js"
import {
  findTurningPoints,
  mapTimeline,
} from "../electron/main/riot/timeline-mapper.js"
import type { MatchRow } from "../electron/main/matches/types.js"

function match(
  gameId: number,
  playedAt: number,
  durationSecs = 1_800,
  gradeScore = 0,
): MatchRow {
  return {
    gameId,
    playedAt,
    durationSecs,
    gradeScore,
    win: gameId % 2,
    mode: gameId % 2 ? "aram" : "sr_normal",
    championId: gameId,
  } as MatchRow
}

describe("review sessions", () => {
  it("keeps an exact 90 minute idle gap together and splits above it", () => {
    const first = match(1, 0, 1_800)
    const exact = match(2, 1_800_000 + 90 * 60_000)
    const over = match(3, exact.playedAt + 1_800_000 + 90 * 60_000 + 1)
    const sessions = buildSessions([first, exact, over])
    expect(sessions).toHaveLength(2)
    expect(sessions[1].matches.map((entry) => entry.gameId)).toEqual([1, 2])
  })

  it("honors split and join overrides and excludes remakes from results", () => {
    const rows = [match(1, 0, 200), match(2, 300_000), match(3, 20_000_000)]
    const overrides = new Map<number, "split" | "join">([[2, "split"], [3, "join"]])
    const sessions = buildSessions(rows, overrides)
    expect(sessions).toHaveLength(2)
    expect(sessions[0].matches.map((entry) => entry.gameId)).toEqual([2, 3])
    expect(sessions[1].games).toBe(0)
  })

  it("uses the specified first-half/second-half trend thresholds", () => {
    const rows = [0, 0, .3, .3].map((score, index) =>
      match(index + 1, index * 2_000_000, 1_800, score),
    )
    const [session] = buildSessions(rows)
    expect(session.trend).toBe("improved")
    expect(session.trendDelta).toBeCloseTo(.3)
  })
})

describe("champion recommendations", () => {
  const game = (championId: number, win: boolean, playedAt: number, gradeScore = 0) => ({
    championId,
    championName: "",
    win,
    playedAt,
    kills: 5,
    deaths: 5,
    assists: 10,
    gradeScore,
  })

  it("smooths a one-game 100% champion instead of treating it as certainty", () => {
    const ranked = recommendChampions([
      { championId: 1, championName: "A", games: [game(1, true, 1)] },
      {
        championId: 2,
        championName: "B",
        games: Array.from({ length: 20 }, (_, index) => game(2, index < 11, index)),
      },
    ], "best_overall", 100)
    expect(ranked.find((entry) => entry.championId === 1)!.adjustedWinRate)
      .toBeLessThan(1)
    expect(ranked.find((entry) => entry.championId === 1)!.confidence).toBe("thin")
    expect(ranked.find((entry) => entry.championId === 2)!.confidence).toBe("solid")
  })

  it("uses neutral candidate percentiles for one option", () => {
    const [only] = recommendChampions([
      { championId: 1, championName: "Only", games: [game(1, true, 1)] },
    ], "best_overall", 100)
    expect(only.signals.find((signal) => signal.key === "long_term")?.score)
      .toBe(50)
  })

  it("sorts deterministic ties by champion name", () => {
    const ranked = recommendChampions([
      { championId: 2, championName: "Zed", games: [] },
      { championId: 1, championName: "Ahri", games: [] },
    ], "practice", 100)
    expect(ranked.map((entry) => entry.championName)).toEqual(["Ahri", "Zed"])
  })
})

describe("timeline mapping", () => {
  it("keeps supported events, ignores unknown events, and maps owner state", () => {
    const timeline = mapTimeline([
      {
        timestamp: 60_000,
        participantFrames: {
          "1": { participantId: 1, totalGold: 1_000, level: 2, xp: 300, minionsKilled: 7 },
          "6": { participantId: 6, totalGold: 900 },
        },
        events: [
          { type: "ITEM_PURCHASED", timestamp: 60_000, participantId: 1, itemId: 1001 },
          { type: "WARD_PLACED", timestamp: 61_000, participantId: 1 },
        ],
      },
    ], 1, new Map([[1, 100], [6, 200]]))
    expect(timeline.frames[0]).toMatchObject({ ownerGold: 1_000, ownerCs: 7 })
    expect(timeline.events.map((event) => event.type)).toEqual([
      "ITEM_PURCHASED",
      "WARD_PLACED",
    ])
    expect(timeline.events[0]).toMatchObject({
      category: "item",
      participantId: 1,
      itemId: 1001,
    })
    expect(timeline.events[0].eventId).toContain("ITEM_PURCHASED")
    expect(timeline.events[1].category).toBe("vision")
  })

  it("selects at most three separated two-minute gold swings", () => {
    const frames = Array.from({ length: 12 }, (_, index) => ({
      timestamp: index * 60_000,
      blueGold: index % 4 < 2 ? index * 1_500 : 0,
      redGold: index % 4 < 2 ? 0 : index * 1_500,
      ownerGold: 0,
      ownerLevel: 0,
      ownerXp: 0,
      ownerCs: 0,
    }))
    const points = findTurningPoints(frames)
    expect(points.length).toBeLessThanOrEqual(3)
    for (let index = 1; index < points.length; index += 1) {
      expect(points[index].timestamp - points[index - 1].timestamp)
        .toBeGreaterThanOrEqual(180_000)
    }
  })
})
