import { describe, expect, it } from "vitest"
import { readJungleEvidenceSample } from
  "../electron/main/jungle/live-jungle-evidence.js"

describe("readJungleEvidenceSample", () => {
  it("uses one aggregate snapshot and resolves legacy active names to Riot ID fields", async () => {
    const calls: string[] = []
    const sample = await readJungleEvidenceSample({
      request: async <T>(path: string) => {
        calls.push(path)
        if (path !== "/liveclientdata/allgamedata") {
          throw new Error(`unexpected endpoint: ${path}`)
        }
        return {
          gameData: { gameTime: 97.25 },
          activePlayer: {
            summonerName: "Recall Player",
            currentGold: 742,
            level: 4,
          },
          allPlayers: [{
            riotIdGameName: "Recall Player",
            riotIdTagLine: "NA1",
            isDead: false,
            scores: { creepScore: 12 },
          }],
        } as unknown as T
      },
    }, 12_345)

    expect(calls).toEqual(["/liveclientdata/allgamedata"])
    expect(sample).toEqual({
      capturedMonotonicMs: 12_345,
      gameTimeMs: 97_250,
      currentGold: 742,
      creepScore: 12,
      level: 4,
      localPlayerDead: false,
    })
  })

  it("falls back to subset endpoints and derives the score lookup Riot ID", async () => {
    const calls: string[] = []
    const sample = await readJungleEvidenceSample({
      request: async <T>(path: string) => {
        calls.push(path)
        if (path === "/liveclientdata/allgamedata") throw new Error("warming_up")
        if (path === "/liveclientdata/gamestats") return { gameTime: 101 } as T
        if (path === "/liveclientdata/activeplayer") {
          return {
            riotIdGameName: "Recall Player",
            riotIdTagLine: "NA1",
            currentGold: 800,
            level: 4,
          } as T
        }
        if (path === "/liveclientdata/playerscores?riotId=Recall%20Player%23NA1") {
          return { creepScore: 16 } as T
        }
        throw new Error(`unexpected endpoint: ${path}`)
      },
    }, 20_000)

    expect(calls).toContain("/liveclientdata/playerscores?riotId=Recall%20Player%23NA1")
    expect(sample).toMatchObject({
      gameTimeMs: 101_000,
      currentGold: 800,
      creepScore: 16,
      level: 4,
    })
  })

  it("does not select an ambiguous game-name fallback", async () => {
    const sample = await readJungleEvidenceSample({
      request: async <T>(path: string) => {
        if (path !== "/liveclientdata/allgamedata") throw new Error("unexpected")
        return {
          gameData: { gameTime: 110 },
          activePlayer: { summonerName: "Shared", currentGold: 900, level: 5 },
          allPlayers: [{
            riotId: "Shared#NA1",
            scores: { creepScore: 20 },
          }, {
            riotId: "Shared#EUW",
            scores: { creepScore: 99 },
          }],
        } as unknown as T
      },
    }, 25_000)

    expect(sample.creepScore).toBeUndefined()
  })
})
