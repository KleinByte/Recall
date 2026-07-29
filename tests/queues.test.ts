import { describe, expect, it } from "vitest"
import { classifyMatch } from "../electron/main/matches/classify.js"
import { indexQueues, type QueueInfo } from "../electron/main/matches/queues.js"
import type { LcuGame } from "../electron/main/matches/types.js"

const game = (overrides: Partial<LcuGame> = {}): LcuGame =>
  ({
    gameId: 1,
    gameCreation: 0,
    gameDuration: 1200,
    gameMode: "CLASSIC",
    gameType: "MATCHED_GAME",
    gameVersion: "16.14",
    queueId: 420,
    mapId: 11,
    participants: [],
    ...overrides,
  }) as LcuGame

/** Shaped like the client's own `/lol-game-queues/v1/queues` entries. */
const queue = (overrides: Partial<QueueInfo> = {}): QueueInfo => ({
  id: 420,
  name: "Ranked Solo/Duo",
  shortName: "Ranked Solo/Duo",
  gameMode: "CLASSIC",
  mapId: 11,
  isRanked: true,
  ...overrides,
})

describe("indexQueues", () => {
  it("keys the client's queue list by id", () => {
    const queues = indexQueues([
      queue({ id: 420 }),
      queue({ id: 450, name: "ARAM", gameMode: "ARAM", mapId: 12, isRanked: false }),
    ])

    expect(queues.get(450)?.name).toBe("ARAM")
    expect(queues.get(420)?.isRanked).toBe(true)
  })

  it("ignores entries without an id", () => {
    const queues = indexQueues([{ name: "broken" } as QueueInfo])

    expect(queues.size).toBe(0)
  })
})

describe("classifyMatch with client queue data", () => {
  it("records the queue's official name", () => {
    const result = classifyMatch(game({ queueId: 2400, mapId: 12, gameMode: "KIWI" }), {
      ...queue({
        id: 2400,
        name: "ARAM: Mayhem",
        gameMode: "KIWI",
        mapId: 12,
        isRanked: false,
      }),
    })

    expect(result?.mode).toBe("mayhem")
    expect(result?.queueName).toBe("ARAM: Mayhem")
  })

  it("trusts the client over the payload for whether a queue is ranked", () => {
    // A Rift queue the hardcoded table has never heard of.
    const result = classifyMatch(
      game({ queueId: 9001 }),
      queue({ id: 9001, name: "Ranked Something", isRanked: true }),
    )

    expect(result?.family).toBe("sr")
    expect(result?.isRanked).toBe(true)
  })

  it("classifies by the client's map when the payload has none", () => {
    const result = classifyMatch(
      game({ queueId: 450, mapId: 0, gameMode: "" }),
      queue({ id: 450, name: "ARAM", gameMode: "ARAM", mapId: 12, isRanked: false }),
    )

    expect(result?.mode).toBe("aram")
  })

  it("still classifies when the client has no metadata to offer", () => {
    const result = classifyMatch(game({ queueId: 420 }))

    expect(result?.mode).toBe("sr_ranked_solo")
    expect(result?.isRanked).toBe(true)
    expect(result?.queueName).toBeUndefined()
  })

  it("retains other modes with the client-provided queue name", () => {
    const result = classifyMatch(
      game({ queueId: 1700, mapId: 30, gameMode: "CHERRY" }),
      queue({ id: 1700, name: "Arena", gameMode: "CHERRY", mapId: 30, isRanked: false }),
    )

    expect(result).toEqual({
      mode: "other",
      family: "other",
      isRanked: false,
      queueName: "Arena",
    })
  })
})
