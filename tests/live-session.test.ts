import { describe, expect, it } from "vitest"
import { readLiveSession } from "../electron/main/live-session.js"

const client = (responses: Record<string, unknown>) => ({
  request: <T>(path: string) => Promise.resolve(responses[path] as T),
})

describe("readLiveSession", () => {
  it("maps an ARAM champion-select roster and bench", async () => {
    const live = await readLiveSession(client({
      "/lol-gameflow/v1/session": {
        gameData: { gameId: 55, gameMode: "ARAM", mapId: 12, queue: { id: 450, name: "ARAM" } },
      },
      "/lol-champ-select/v1/session": {
        localPlayerCellId: 2,
        rerollsRemaining: 1,
        benchChampions: [22, 84],
        timer: { adjustedTimeLeftInPhase: 24_200 },
        myTeam: [{ cellId: 2, championId: 64, championPickIntent: 64, summonerId: 9 }],
        theirTeam: [{ cellId: 7, championId: 0, championPickIntent: 157 }],
      },
    }) as never, "ChampSelect")

    expect(live.mode).toBe("aram")
    expect(live.secondsRemaining).toBe(25)
    expect(live.benchChampionIds).toEqual([22, 84])
    expect(live.allies[0].championId).toBe(64)
    expect(live.enemies[0].championPickIntent).toBe(157)
  })

  it("keeps Mayhem separate from normal ARAM", async () => {
    const live = await readLiveSession(client({
      "/lol-gameflow/v1/session": { gameData: { gameMode: "KIWI", mapId: 12, queue: { id: 2400 } } },
      "/lol-champ-select/v1/session": { myTeam: [], theirTeam: [] },
    }) as never, "ChampSelect")

    expect(live.mode).toBe("mayhem")
  })

  it("is empty outside a game", async () => {
    const live = await readLiveSession(client({}) as never, "Idle")
    expect(live).toMatchObject({ phase: "Idle", allies: [], benchChampionIds: [] })
  })
})
