import { describe, expect, it } from "vitest"
import { readLiveSession } from "../electron/main/live-session.js"
import { readFileSync } from "node:fs"

const client = (responses: Record<string, unknown>) => ({
  request: <T>(path: string) =>
    path in responses
      ? Promise.resolve(responses[path] as T)
      : Promise.reject(new Error(`Missing response for ${path}`)),
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
      "/lol-summoner/v1/summoners/9": {
        gameName: "Local Player",
        tagLine: "NA1",
      },
    }) as never, "ChampSelect")

    expect(live.mode).toBe("aram")
    expect(live.secondsRemaining).toBe(25)
    expect(live.benchChampionIds).toEqual([22, 84])
    expect(live.allies[0].championId).toBe(64)
    expect(live.allies[0].displayName).toBe("Local Player#NA1")
    expect(live.enemies[0].championPickIntent).toBe(157)
  })

  it("keeps the position the client assigned in champion select", async () => {
    const live = await readLiveSession(client({
      "/lol-gameflow/v1/session": {
        gameData: { gameId: 77, gameMode: "CLASSIC", mapId: 11, queue: { id: 420 } },
      },
      "/lol-champ-select/v1/session": {
        localPlayerCellId: 0,
        myTeam: [
          { cellId: 0, championId: 64, assignedPosition: "jungle" },
          { cellId: 1, championId: 17, assignedPosition: "" },
        ],
        theirTeam: [{ cellId: 5, championId: 0, assignedPosition: "utility" }],
      },
    }) as never, "ChampSelect")

    expect(live.allies[0].assignedPosition).toBe("JUNGLE")
    expect(live.allies[1].assignedPosition).toBeUndefined()
    expect(live.enemies[0].assignedPosition).toBe("UTILITY")
  })

  it("uses the champ-select game id when gameflow has not exposed it yet", async () => {
    const live = await readLiveSession(client({
      "/lol-gameflow/v1/session": {
        gameData: { gameMode: "CLASSIC", mapId: 11, queue: { id: 420 } },
      },
      "/lol-champ-select/v1/session": {
        gameId: 88,
        myTeam: [],
        theirTeam: [],
      },
    }) as never, "ChampSelect")

    expect(live.gameId).toBe(88)
  })

  it("keeps Mayhem separate from normal ARAM", async () => {
    const live = await readLiveSession(client({
      "/lol-gameflow/v1/session": {
        gameData: {
          queue: {
            id: 2450,
            gameMode: "KIWI_JADE",
            mapId: 12,
            name: "ARAM: Mayhem Classic-ish",
          },
        },
      },
      "/lol-champ-select/v1/session": { myTeam: [], theirTeam: [] },
    }) as never, "ChampSelect")

    expect(live.mode).toBe("mayhem")
    expect(live.gameMode).toBe("KIWI_JADE")
    expect(live.mapId).toBe(12)
  })

  it("recognizes League Classic during champion select", async () => {
    const live = await readLiveSession(client({
      "/lol-gameflow/v1/session": {
        gameData: {
          queue: {
            id: 4300,
            gameMode: "JADE",
            mapId: 11,
            name: "5v5 Jade",
          },
        },
      },
      "/lol-champ-select/v1/session": { myTeam: [], theirTeam: [] },
    }) as never, "ChampSelect")

    expect(live.mode).toBe("league_classic")
  })

  it("uses both client rosters and resolves in-game Riot IDs locally", async () => {
    const live = await readLiveSession(
      client({
        "/lol-gameflow/v1/session": {
          gameData: {
            gameMode: "ARAM",
            mapId: 12,
            queue: { id: 450, name: "ARAM" },
            teamOne: [
              { championId: 22, puuid: "enemy", summonerId: 1 },
            ],
            teamTwo: [
              { championId: 53, puuid: "mine", summonerId: 2 },
              { championId: 64, puuid: "ally", summonerId: 3 },
            ],
          },
        },
        "/lol-summoner/v1/summoners/1": {
          gameName: "Opponent",
          tagLine: "NA1",
        },
        "/lol-summoner/v1/summoners/2": {
          gameName: "Me",
          tagLine: "TAG",
        },
        "/lol-summoner/v1/summoners/3": {
          gameName: "Ally",
          tagLine: "NA1",
        },
      }) as never,
      "InProgress",
      "mine",
    )

    expect(live.allies.map((entry) => entry.championId)).toEqual([53, 64])
    expect(live.enemies.map((entry) => entry.championId)).toEqual([22])
    expect(live.allies.map((entry) => entry.displayName)).toEqual([
      "Me#TAG",
      "Ally#NA1",
    ])
    expect(live.enemies[0].displayName).toBe("Opponent#NA1")
    expect(live.localPlayerCellId).toBe(live.allies[0].cellId)
  })

  it("preserves Practice queue type separately from CLASSIC game mode", async () => {
    const live = await readLiveSession(client({
      "/lol-gameflow/v1/session": {
        gameData: {
          gameId: 99,
          gameMode: "CLASSIC",
          mapId: 11,
          queue: {
            id: 0,
            gameMode: "CLASSIC",
            type: "PRACTICETOOL",
          },
          teamOne: [],
          teamTwo: [],
        },
      },
    }) as never, "InProgress")

    expect(live.gameMode).toBe("CLASSIC")
    expect(live.gameType).toBe("PRACTICETOOL")
  })

  it("does not resolve identities hidden by ranked champion select", async () => {
    const calls: string[] = []
    const rankedClient = {
      request: async <T>(path: string) => {
        calls.push(path)
        const responses: Record<string, unknown> = {
          "/lol-gameflow/v1/session": {
            gameData: {
              gameMode: "CLASSIC",
              mapId: 11,
              queue: { id: 420 },
            },
          },
          "/lol-champ-select/v1/session": {
            myTeam: [{ cellId: 1, championId: 84, summonerId: 99 }],
            theirTeam: [],
          },
        }
        return responses[path] as T
      },
    }

    const live = await readLiveSession(
      rankedClient as never,
      "ChampSelect",
    )

    expect(live.allies[0].displayName).toBeUndefined()
    expect(calls).not.toContain("/lol-summoner/v1/summoners/99")
  })

  it("is empty outside a game", async () => {
    const live = await readLiveSession(client({}) as never, "Idle")
    expect(live).toMatchObject({ phase: "Idle", allies: [], benchChampionIds: [] })
  })

  it("recomputes recommendations when the available bench changes", () => {
    const page = readFileSync("src/pages/LiveGamePage.vue", "utf8")

    expect(page).toContain("availableFor(live.value)")
    expect(page).toContain("recommendationSignature")
    expect(page).toContain("benchChampionIds")
    expect(page).toContain("live.game")
  })
})
