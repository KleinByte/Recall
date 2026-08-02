import { describe, expect, it } from "vitest"
import {
  mapParticipants,
  mapTeams,
} from "../electron/main/matches/map-participants.js"

const PUUID = "test-puuid"

const detail = (overrides: Record<string, unknown> = {}) => ({
  gameId: 7,
  participantIdentities: Array.from({ length: 10 }, (_, index) => ({
    participantId: index + 1,
    player: {
      puuid: index === 0 ? PUUID : `other-${index}`,
      gameName: `Player${index}`,
      tagLine: "NA1",
      profileIcon: 500 + index,
    },
  })),
  participants: Array.from({ length: 10 }, (_, index) => ({
    participantId: index + 1,
    teamId: index < 5 ? 100 : 200,
    championId: 84 + index,
    spell1Id: 4,
    spell2Id: 14,
    stats: {
      win: index < 5,
      kills: index,
      deaths: 3,
      assists: 7,
      champLevel: 18,
      goldEarned: 10000 + index,
      goldSpent: 9000,
      totalDamageDealtToChampions: 20000 + index,
      totalDamageDealt: 90000,
      magicDamageDealtToChampions: 12000,
      physicalDamageDealtToChampions: 7000,
      trueDamageDealtToChampions: 1000,
      totalDamageTaken: 15000,
      damageSelfMitigated: 9000,
      totalHeal: 2000,
      totalUnitsHealed: 3,
      timeCCingOthers: 12,
      largestKillingSpree: 4,
      largestMultiKill: 2,
      doubleKills: 1,
      totalMinionsKilled: 120,
      neutralMinionsKilled: 20,
      visionScore: 25,
      wardsPlaced: 9,
      wardsKilled: 3,
      visionWardsBoughtInGame: 2,
      damageDealtToObjectives: 4000,
      damageDealtToTurrets: 2500,
      turretKills: 1,
      inhibitorKills: 0,
      longestTimeSpentLiving: 480,
      firstBloodKill: index === 0,
      firstTowerKill: false,
      item0: 6655,
      item1: 3089,
      item2: 3040,
      item3: 3158,
      item4: 6653,
      item5: 3116,
      item6: 2055,
      perkPrimaryStyle: 8200,
      perkSubStyle: 8300,
      perk0: 8214,
      perk1: 8226,
      perk2: 8210,
      perk3: 8237,
      perk4: 8345,
      perk5: 8347,
    },
    timeline: { lane: "MIDDLE", role: "SOLO" },
  })),
  teams: [
    {
      teamId: 100,
      win: "Win",
      bans: [{ championId: 12 }, { championId: 34 }],
      baronKills: 1,
      dragonKills: 3,
      riftHeraldKills: 1,
      hordeKills: 5,
      towerKills: 8,
      inhibitorKills: 2,
      firstBlood: true,
      firstTower: true,
      firstBaron: true,
      firstDargon: true,
      firstInhibitor: true,
    },
    {
      teamId: 200,
      win: "Fail",
      bans: [{ championId: 56 }],
      baronKills: 0,
      dragonKills: 1,
      towerKills: 2,
    },
  ],
  ...overrides,
})

describe("mapParticipants", () => {
  it("maps every player in the lobby", () => {
    const rows = mapParticipants(detail(), PUUID)

    expect(rows).toHaveLength(10)
    expect(rows[0].gameId).toBe(7)
  })

  it("marks which row is the local player", () => {
    const rows = mapParticipants(detail(), PUUID)

    expect(rows.filter((row) => row.isPlayer === 1)).toHaveLength(1)
    expect(rows.find((row) => row.isPlayer === 1)!.participantId).toBe(1)
  })

  it("records who else was in the game", () => {
    const rows = mapParticipants(detail(), PUUID)

    expect(rows[3].summonerName).toBe("Player3#NA1")
    expect(rows[3].profileIcon).toBe(503)
    expect(rows[3].participantPuuid).toBe("other-3")
  })

  it("falls back to a summoner name when there is no Riot ID", () => {
    const payload = detail({
      participantIdentities: [
        { participantId: 1, player: { puuid: PUUID, summonerName: "OldName" } },
      ],
    })

    expect(mapParticipants(payload, PUUID)[0].summonerName).toBe("OldName")
  })

  it("records the build each player finished with", () => {
    const row = mapParticipants(detail(), PUUID)[0]

    expect(row.items).toEqual([6655, 3089, 3040, 3158, 6653, 3116, 2055])
    expect(row.spell1Id).toBe(4)
    expect(row.spell2Id).toBe(14)
  })

  it("records the runes each player took", () => {
    const row = mapParticipants(detail(), PUUID)[0]

    expect(row.perkPrimaryStyle).toBe(8200)
    expect(row.perkSubStyle).toBe(8300)
    expect(row.perks).toEqual([8214, 8226, 8210, 8237, 8345, 8347])
  })

  it("records ordered augments and extended fields for every participant", () => {
    const payload = detail()
    for (const [index, player] of payload.participants.entries()) {
      Object.assign(player.stats, {
        playerAugment1: 100 + index,
        playerAugment2: 200 + index,
        playerAugment3: 300 + index,
        playerAugment4: 400 + index,
        damageDealtToBuildings: 1234 + index,
      })
    }

    const rows = mapParticipants(payload, PUUID)

    expect(rows.every((row) => row.augments?.length === 4)).toBe(true)
    expect(rows[6].augments?.map((augment) => augment.augmentId)).toEqual([
      106, 206, 306, 406,
    ])
    expect(rows[6].extendedMetrics?.damageDealtToBuildings).toBe(1240)
  })

  it("copies the whole statistical line", () => {
    const row = mapParticipants(detail(), PUUID)[2]

    expect(row.kills).toBe(2)
    expect(row.damageToChampions).toBe(20002)
    expect(row.magicDamageToChampions).toBe(12000)
    expect(row.goldSpent).toBe(9000)
    expect(row.wardsPlaced).toBe(9)
    expect(row.longestTimeLiving).toBe(480)
    expect(row.champLevel).toBe(18)
    expect(row.lane).toBe("MIDDLE")
  })

  it("returns nothing when the payload has no participants", () => {
    expect(mapParticipants({ gameId: 7 }, PUUID)).toEqual([])
  })

  it("returns nothing when the local player is not in the lobby", () => {
    const payload = detail({
      participantIdentities: [
        { participantId: 1, player: { puuid: "somebody-else" } },
      ],
    })

    expect(mapParticipants(payload, PUUID)).toEqual([])
  })

  it("treats missing statistics as zero rather than failing", () => {
    const payload = detail({
      participants: [
        { participantId: 1, teamId: 100, championId: 84, stats: {} },
      ],
      participantIdentities: [{ participantId: 1, player: { puuid: PUUID } }],
    })

    const row = mapParticipants(payload, PUUID)[0]

    expect(row.kills).toBe(0)
    expect(row.win).toBe(0)
    expect(row.items).toEqual([0, 0, 0, 0, 0, 0, 0])
  })
})

describe("mapTeams", () => {
  it("maps both sides", () => {
    const teams = mapTeams(detail(), PUUID)

    expect(teams).toHaveLength(2)
    expect(teams[0].teamId).toBe(100)
  })

  it("reads the winning side from the client's wording", () => {
    const teams = mapTeams(detail(), PUUID)

    expect(teams[0].win).toBe(1)
    expect(teams[1].win).toBe(0)
  })

  it("records objectives, including the client's misspelt dragon", () => {
    const team = mapTeams(detail(), PUUID)[0]

    expect(team.baronKills).toBe(1)
    expect(team.dragonKills).toBe(3)
    expect(team.heraldKills).toBe(1)
    expect(team.hordeKills).toBe(5)
    expect(team.firstDragon).toBe(1)
  })

  it("records the bans as champion ids", () => {
    expect(JSON.parse(mapTeams(detail(), PUUID)[0].bans)).toEqual([12, 34])
  })

  it("copes with a mode that has no teams block", () => {
    expect(mapTeams({ gameId: 7 }, PUUID)).toEqual([])
  })
})
