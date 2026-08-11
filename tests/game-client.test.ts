import { describe, expect, it } from "vitest"
import { readLiveGameSnapshot } from "../electron/main/game-client.js"

const client = (responses: Record<string, unknown>) => ({
  request: <T>(path: string) => Promise.resolve(responses[path] as T),
})

describe("readLiveGameSnapshot", () => {
  it("maps the documented local feed and splits teams around the active player", async () => {
    const snapshot = await readLiveGameSnapshot(client({
      "/liveclientdata/gamestats": {
        gameTime: 725.4,
        gameMode: "ARAM",
        mapName: "Howling Abyss",
        mapNumber: 12,
      },
      "/liveclientdata/activeplayer": {
        riotId: "Recall Player#NA1",
        currentGold: 1_245.8,
        level: 11,
        championStats: { abilityHaste: 35 },
        fullRunes: {
          primaryRuneTree: { id: 8000 },
          secondaryRuneTree: { id: 8300 },
          generalRunes: [8005, 9111, 9104, 8014, 8345, 8347]
            .map((id) => ({ id })),
          statRunes: [{ id: 5005 }, { id: 5008 }, { id: 5001 }],
        },
      },
      "/liveclientdata/playerlist": [
        {
          championName: "Ashe",
          riotId: "Recall Player#NA1",
          team: "ORDER",
          level: 11,
          scores: {
            kills: 5,
            deaths: 3,
            assists: 8,
            creepScore: 41,
            wardScore: 0,
          },
          items: [
            {
              itemID: 3078,
              displayName: "Trinity Force",
              count: 1,
              price: 3333,
              canUse: false,
              consumable: false,
            },
          ],
          summonerSpells: {
            summonerSpellOne: { displayName: "Flash" },
            summonerSpellTwo: { displayName: "Mark" },
          },
          runes: { keystone: { displayName: "Lethal Tempo" } },
        },
        {
          championName: "Leona",
          riotId: "Ally#NA1",
          team: "ORDER",
          level: 10,
          scores: {},
        },
        {
          championName: "Zed",
          riotId: "Opponent#NA1",
          team: "CHAOS",
          level: 11,
          isDead: true,
          respawnTimer: 12.3,
          scores: { kills: 4, deaths: 5, assists: 2 },
        },
      ],
      "/liveclientdata/eventdata": {
        Events: [
          {
            EventID: 9,
            EventName: "ChampionKill",
            EventTime: 718.2,
            KillerName: "Recall Player",
            VictimName: "Opponent",
            Assisters: ["Ally"],
          },
          {
            EventID: 10,
            EventName: "Multikill",
            EventTime: 719.1,
            KillerName: "Recall Player",
            KillStreak: 3,
          },
        ],
      },
    }))

    expect(snapshot.available).toBe(true)
    expect(snapshot.gameTime).toBe(725.4)
    expect(snapshot.allies).toHaveLength(2)
    expect(snapshot.enemies).toHaveLength(1)
    expect(snapshot.allies[0]).toMatchObject({
      championName: "Ashe",
      isLocal: true,
      scores: { kills: 5, deaths: 3, assists: 8, creepScore: 41 },
      summonerSpells: ["Flash", "Mark"],
      keystone: "Lethal Tempo",
    })
    expect(snapshot.allies[0].items[0]).toMatchObject({
      itemId: 3078,
      name: "Trinity Force",
    })
    expect(snapshot.enemies[0]).toMatchObject({
      isDead: true,
      respawnTimer: 12.3,
    })
    expect(snapshot.activePlayer?.runes).toEqual({
      primaryStyleId: 8000,
      secondaryStyleId: 8300,
      generalRuneIds: [8005, 9111, 9104, 8014, 8345, 8347],
      statRuneIds: [5005, 5008, 5001],
    })
    expect(snapshot.events[0]).toMatchObject({
      id: 9,
      name: "ChampionKill",
      victimName: "Opponent",
      assisters: ["Ally"],
    })
    expect(snapshot.events[1]).toMatchObject({
      id: 10,
      name: "Multikill",
      multiKill: 3,
    })
  })

  it("does not guess an enemy side when the active player cannot be identified", async () => {
    const snapshot = await readLiveGameSnapshot(client({
      "/liveclientdata/gamestats": { gameTime: 1 },
      "/liveclientdata/activeplayer": { riotId: "Missing#NA1" },
      "/liveclientdata/playerlist": [
        { championName: "Annie", team: "ORDER" },
      ],
      "/liveclientdata/eventdata": { Events: [] },
    }))

    expect(snapshot.allies).toHaveLength(1)
    expect(snapshot.enemies).toEqual([])
  })
})
