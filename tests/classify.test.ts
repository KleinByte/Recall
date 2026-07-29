import { describe, expect, it } from "vitest"
import { classifyMatch } from "../electron/main/matches/classify.js"
import type { LcuGame } from "../electron/main/matches/types.js"

const game = (overrides: Partial<LcuGame> = {}) =>
  ({
    mapId: 12,
    gameMode: "ARAM",
    gameType: "MATCHED_GAME",
    queueId: 450,
    ...overrides,
  }) as LcuGame

const rift = (queueId: number, gameMode = "CLASSIC") =>
  ({
    mapId: 11,
    gameMode,
    gameType: "MATCHED_GAME",
    queueId,
  }) as LcuGame

describe("classifyMatch", () => {
  it("classifies standard ARAM", () => {
    expect(classifyMatch(game())).toEqual({
      mode: "aram",
      family: "aram",
      isRanked: false,
    })
  })

  it("classifies ARAM Mayhem from the KIWI game mode", () => {
    expect(classifyMatch(game({ gameMode: "KIWI", queueId: 2400 }))?.mode).toBe(
      "mayhem",
    )
  })

  it("classifies KIWI_JADE variants as Mayhem", () => {
    expect(
      classifyMatch(game({ gameMode: "KIWI_JADE", queueId: 2450 }))?.mode,
    ).toBe("mayhem")
  })

  it("keeps games played on other maps", () => {
    expect(
      classifyMatch(game({ mapId: 33, gameMode: "STRAWBERRY", queueId: 1810 })),
    ).toMatchObject({ mode: "other", family: "other" })
  })

  it("keeps unrelated modes played on the Howling Abyss", () => {
    expect(
      classifyMatch(game({ gameMode: "URF", queueId: 900 })),
    ).toMatchObject({ mode: "other", family: "other" })
  })
})

describe("classifyMatch — Summoner's Rift", () => {
  it("classifies ranked solo", () => {
    expect(classifyMatch(rift(420))).toEqual({
      mode: "sr_ranked_solo",
      family: "sr",
      isRanked: true,
    })
  })

  it("classifies ranked flex", () => {
    expect(classifyMatch(rift(440))?.mode).toBe("sr_ranked_flex")
  })

  it("classifies quickplay", () => {
    expect(classifyMatch(rift(490))?.mode).toBe("sr_quickplay")
  })

  it("classifies swiftplay, which reports its own game mode", () => {
    expect(classifyMatch(rift(480, "SWIFTPLAY"))?.mode).toBe("sr_swiftplay")
  })

  it("classifies normal draft and blind", () => {
    expect(classifyMatch(rift(400))?.mode).toBe("sr_normal")
    expect(classifyMatch(rift(430))?.mode).toBe("sr_normal")
  })

  it("falls back to normal for an unknown Rift queue rather than dropping it", () => {
    expect(classifyMatch(rift(9999))?.mode).toBe("sr_normal")
  })

  it("marks only ranked queues as ranked", () => {
    expect(classifyMatch(rift(400))?.isRanked).toBe(false)
    expect(classifyMatch(rift(440))?.isRanked).toBe(true)
  })

  it("puts every Rift queue in the sr family", () => {
    for (const queueId of [400, 420, 430, 440, 480, 490, 9999]) {
      expect(classifyMatch(rift(queueId))?.family).toBe("sr")
    }
  })

  it("keeps Arena and future queues as other history", () => {
    const arena = {
      mapId: 30,
      gameMode: "CHERRY",
      gameType: "MATCHED_GAME",
      queueId: 1700,
    } as LcuGame

    expect(classifyMatch(arena)).toEqual({
      mode: "other",
      family: "other",
      isRanked: false,
      queueName: undefined,
    })
  })
})
