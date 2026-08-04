import { describe, expect, it } from "vitest"
import { mapMatchRow } from "../electron/main/matches/map-match.js"
import type { LcuGame } from "../electron/main/matches/types.js"

const PUUID = "fe2ae539-39ac-5eb8-9774-ffa34bc2e5d2"

/** Mirrors the shape returned by the live client for a Mayhem game. */
const mayhemGame = (overrides: Partial<LcuGame> = {}): LcuGame =>
  ({
    gameId: 5608942546,
    gameCreation: 1785036484000,
    gameDuration: 1241,
    gameMode: "KIWI",
    gameType: "MATCHED_GAME",
    gameVersion: "16.14.794.5912",
    queueId: 2400,
    mapId: 12,
    participants: [
      {
        championId: 84,
        stats: {
          win: true,
          kills: 12,
          deaths: 7,
          assists: 20,
          champLevel: 18,
          goldEarned: 15400,
          totalDamageDealtToChampions: 42000,
          totalDamageTaken: 38000,
          damageSelfMitigated: 21000,
          totalHeal: 9000,
          totalUnitsHealed: 3,
          timeCCingOthers: 41,
          largestKillingSpree: 4,
          largestMultiKill: 2,
          doubleKills: 2,
          tripleKills: 1,
          quadraKills: 0,
          pentaKills: 0,
          totalMinionsKilled: 88,
          visionScore: 6,
          gameEndedInSurrender: false,
          gameEndedInEarlySurrender: false,
        },
      },
    ],
    ...overrides,
  }) as LcuGame

describe("mapMatchRow", () => {
  it("maps a Mayhem game into a database row", () => {
    const row = mapMatchRow(mayhemGame(), PUUID)

    expect(row).toMatchObject({
      gameId: 5608942546,
      puuid: PUUID,
      mode: "mayhem",
      gameMode: "KIWI",
      queueId: 2400,
      isMatched: 1,
      playedAt: 1785036484000,
      durationSecs: 1241,
      championId: 84,
      win: 1,
      kills: 12,
      deaths: 7,
      assists: 20,
      damageToChampions: 42000,
      endedInSurrender: 0,
    })
  })

  it("records a loss as 0", () => {
    const game = mayhemGame()
    game.participants[0].stats.win = false

    expect(mapMatchRow(game, PUUID)?.win).toBe(0)
  })

  it("flags custom games as unmatched so they can be excluded from stats", () => {
    const row = mapMatchRow(mayhemGame({ gameType: "CUSTOM_GAME" }), PUUID)

    expect(row?.isMatched).toBe(0)
  })

  it("flags Riot bot queues as unmatched even though Riot calls them matched games", () => {
    const row = mapMatchRow(
      riftGame({ queueId: 890, gameType: "MATCHED_GAME" }),
      PUUID,
    )

    expect(row?.isMatched).toBe(0)
  })

  it("recognizes a newly named bot queue from client metadata", () => {
    const row = mapMatchRow(riftGame({ queueId: 9999 }), PUUID, {
      id: 9999,
      name: "Co-op vs. AI Expert Bot",
      shortName: "Expert Bot",
      gameMode: "CLASSIC",
      mapId: 11,
      isRanked: false,
    })

    expect(row?.isMatched).toBe(0)
  })

  it("defaults missing numeric stats to zero", () => {
    const game = mayhemGame()
    delete (game.participants[0].stats as Record<string, unknown>).visionScore

    expect(mapMatchRow(game, PUUID)?.visionScore).toBe(0)
  })

  it("retains modes outside Rift and ARAM as other", () => {
    const row = mapMatchRow(
      mayhemGame({ mapId: 30, gameMode: "CHERRY", queueId: 1700 }),
      PUUID,
    )

    expect(row?.mode).toBe("other")
    expect(row?.modeFamily).toBe("other")
  })

  it("returns undefined when the payload has no participant", () => {
    expect(mapMatchRow(mayhemGame({ participants: [] }), PUUID)).toBeUndefined()
  })
})

/** Mirrors a ranked Summoner's Rift payload. */
const riftGame = (overrides: Partial<LcuGame> = {}): LcuGame =>
  ({
    gameId: 5600000001,
    gameCreation: 1785000000000,
    gameDuration: 1800,
    gameMode: "CLASSIC",
    gameType: "MATCHED_GAME",
    gameVersion: "16.14",
    queueId: 420,
    mapId: 11,
    participants: [
      {
        championId: 64,
        timeline: { lane: "JUNGLE", role: "NONE" },
        stats: {
          win: true,
          kills: 8,
          deaths: 4,
          assists: 12,
          champLevel: 16,
          goldEarned: 13500,
          totalDamageDealtToChampions: 24000,
          totalDamageTaken: 28000,
          damageSelfMitigated: 19000,
          totalHeal: 6000,
          totalUnitsHealed: 1,
          timeCCingOthers: 35,
          largestKillingSpree: 4,
          largestMultiKill: 2,
          doubleKills: 1,
          tripleKills: 0,
          quadraKills: 0,
          pentaKills: 0,
          totalMinionsKilled: 45,
          neutralMinionsKilled: 135,
          visionScore: 28,
          wardsPlaced: 12,
          wardsKilled: 6,
          visionWardsBoughtInGame: 3,
          damageDealtToObjectives: 31000,
          damageDealtToTurrets: 4200,
          turretKills: 2,
          inhibitorKills: 1,
          firstBloodKill: true,
          gameEndedInSurrender: false,
          gameEndedInEarlySurrender: false,
        },
      },
    ],
    ...overrides,
  }) as LcuGame

describe("mapMatchRow — Summoner's Rift", () => {
  it("records the mode, family and ranked flag", () => {
    const row = mapMatchRow(riftGame(), PUUID)

    expect(row).toMatchObject({
      mode: "sr_ranked_solo",
      modeFamily: "sr",
      isRanked: 1,
    })
  })

  it("records lane and role from the timeline", () => {
    const row = mapMatchRow(riftGame(), PUUID)

    expect(row?.lane).toBe("JUNGLE")
    expect(row?.role).toBe("NONE")
  })

  it("records vision and objective statistics", () => {
    const row = mapMatchRow(riftGame(), PUUID)

    expect(row).toMatchObject({
      visionScore: 28,
      wardsPlaced: 12,
      wardsKilled: 6,
      controlWards: 3,
      damageObjectives: 31000,
      damageTurrets: 4200,
      turretKills: 2,
      inhibitorKills: 1,
      firstBlood: 1,
    })
  })

  it("counts jungle camps toward creep score per minute", () => {
    const row = mapMatchRow(riftGame(), PUUID)

    // (45 lane + 135 jungle) over 30 minutes
    expect(row?.csPerMin).toBeCloseTo(6)
    expect(row?.goldPerMin).toBeCloseTo(450)
  })

  it("does not divide by zero for a game with no recorded duration", () => {
    const row = mapMatchRow(riftGame({ gameDuration: 0 }), PUUID)

    expect(Number.isFinite(row!.csPerMin)).toBe(true)
  })

  it("leaves lane and role undefined when the timeline is absent", () => {
    const game = riftGame()
    delete game.participants[0].timeline

    const row = mapMatchRow(game, PUUID)

    expect(row?.lane).toBeUndefined()
    expect(row?.role).toBeUndefined()
  })
})
