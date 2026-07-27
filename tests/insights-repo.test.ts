import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { InsightsRepository } from "../electron/main/database/insights-repo.js"
import { ParticipantsRepository } from "../electron/main/database/participants-repo.js"
import type { ParticipantRow } from "../electron/main/matches/types.js"
import { buildMatchRow } from "./fixtures/matches.js"

const PUUID = "test-puuid"

let matches: MatchesRepository
let insights: InsightsRepository
let participants: ParticipantsRepository

beforeEach(() => {
  const db = new Database(":memory:")
  applyMigrations(db)
  matches = new MatchesRepository(db)
  insights = new InsightsRepository(db)
  participants = new ParticipantsRepository(db)
})

/** A lobby member. Only the fields each test cares about are overridden. */
const player = (overrides: Partial<ParticipantRow> = {}): ParticipantRow => ({
  gameId: 1,
  puuid: PUUID,
  participantId: 1,
  teamId: 100,
  isPlayer: 0,
  championId: 84,
  win: 1,
  summonerName: "Someone#NA1",
  profileIcon: 0,
  spell1Id: 4,
  spell2Id: 14,
  items: [0, 0, 0, 0, 0, 0, 0],
  perkPrimaryStyle: 0,
  perkSubStyle: 0,
  perks: [0, 0, 0, 0, 0, 0],
  champLevel: 18,
  kills: 2,
  deaths: 2,
  assists: 2,
  goldEarned: 10000,
  goldSpent: 9000,
  damageToChampions: 10000,
  totalDamageDealt: 50000,
  magicDamageToChampions: 0,
  physicalDamageToChampions: 0,
  trueDamageToChampions: 0,
  damageTaken: 10000,
  damageSelfMitigated: 5000,
  totalHeal: 1000,
  totalUnitsHealed: 1,
  timeCcingOthers: 5,
  largestKillingSpree: 1,
  largestMultiKill: 1,
  doubleKills: 0,
  tripleKills: 0,
  quadraKills: 0,
  pentaKills: 0,
  totalMinionsKilled: 50,
  neutralMinions: 0,
  visionScore: 10,
  wardsPlaced: 1,
  wardsKilled: 0,
  controlWards: 0,
  damageObjectives: 1000,
  damageTurrets: 500,
  turretKills: 0,
  inhibitorKills: 0,
  longestTimeLiving: 200,
  firstBlood: 0,
  firstTower: 0,
  ...overrides,
})

describe("getDurationBuckets", () => {
  it("groups games into the bands for their mode", () => {
    matches.insertMany([
      buildMatchRow({ gameId: 1, durationSecs: 600, win: 1 }),
      buildMatchRow({ gameId: 2, durationSecs: 660, win: 0 }),
      buildMatchRow({ gameId: 3, durationSecs: 1500, win: 1 }),
    ])

    const buckets = insights.getDurationBuckets({ puuid: PUUID }, "aram")

    expect(buckets[0].games).toBe(2)
    expect(buckets[0].wins).toBe(1)
    expect(buckets[0].winRate).toBeCloseTo(0.5)
    expect(buckets.at(-1)!.games).toBe(1)
  })

  it("keeps empty bands so the shape never depends on the data", () => {
    matches.insertMany([buildMatchRow({ gameId: 1, durationSecs: 600 })])

    expect(insights.getDurationBuckets({ puuid: PUUID }, "aram")).toHaveLength(4)
  })

  it("uses the longer bands on the Rift", () => {
    matches.insertMany([
      buildMatchRow({ gameId: 1, durationSecs: 1500, mode: "sr_normal", modeFamily: "sr" }),
    ])

    const buckets = insights.getDurationBuckets({ puuid: PUUID }, "sr")

    // 25 minutes is the second Rift band, but the top ARAM one.
    expect(buckets[1].games).toBe(1)
  })

  it("returns no rows when nothing is recorded", () => {
    expect(insights.getDurationBuckets({ puuid: PUUID }, "aram")).toEqual([])
  })
})

describe("getTimeOfDay", () => {
  it("splits games across three-hour blocks and weekdays", () => {
    matches.insertMany([
      buildMatchRow({ gameId: 1, playedAt: Date.UTC(2023, 10, 14, 13), win: 1 }),
      buildMatchRow({ gameId: 2, playedAt: Date.UTC(2023, 10, 14, 14), win: 0 }),
    ])

    const { hours, weekdays } = insights.getTimeOfDay({ puuid: PUUID })

    expect(hours).toHaveLength(8)
    expect(weekdays).toHaveLength(7)
    expect(hours.reduce((sum, row) => sum + row.games, 0)).toBe(2)
    expect(weekdays.reduce((sum, row) => sum + row.games, 0)).toBe(2)
  })

  it("returns nothing when no games are recorded", () => {
    const { hours, weekdays } = insights.getTimeOfDay({ puuid: PUUID })

    expect(hours).toEqual([])
    expect(weekdays).toEqual([])
  })
})

describe("getStreakBehaviour", () => {
  it("separates games played after a win from those after a loss", () => {
    // Oldest first: W, W, L, L.
    matches.insertMany([
      buildMatchRow({ gameId: 1, playedAt: 1000, win: 1 }),
      buildMatchRow({ gameId: 2, playedAt: 2000, win: 1 }),
      buildMatchRow({ gameId: 3, playedAt: 3000, win: 0 }),
      buildMatchRow({ gameId: 4, playedAt: 4000, win: 0 }),
    ])

    const behaviour = insights.getStreakBehaviour({ puuid: PUUID })!

    // Games 2 and 3 followed a win; game 4 followed a loss.
    expect(behaviour.afterWin.games).toBe(2)
    expect(behaviour.afterWin.wins).toBe(1)
    expect(behaviour.afterLoss.games).toBe(1)
    expect(behaviour.afterLoss.wins).toBe(0)
  })

  it("reports nothing when there is no game to follow", () => {
    matches.insertMany([buildMatchRow({ gameId: 1 })])

    expect(insights.getStreakBehaviour({ puuid: PUUID })).toBeUndefined()
  })
})

describe("getTeamContribution", () => {
  it("measures the player's share of their own team", () => {
    // The player deals 20k of their team's 60k. The enemy team is irrelevant.
    participants.insertMany([
      player({ participantId: 1, isPlayer: 1, damageToChampions: 20000 }),
      player({ participantId: 2, damageToChampions: 10000 }),
      player({ participantId: 3, damageToChampions: 10000 }),
      player({ participantId: 4, damageToChampions: 10000 }),
      player({ participantId: 5, damageToChampions: 10000 }),
      player({ participantId: 6, teamId: 200, damageToChampions: 90000 }),
    ])

    const share = insights.getTeamContribution({ puuid: PUUID })!

    expect(share.games).toBe(1)
    expect(share.damageShare).toBeCloseTo(20000 / 60000)
  })

  it("averages the share across games rather than pooling them", () => {
    participants.insertMany([
      player({ gameId: 1, participantId: 1, isPlayer: 1, damageToChampions: 30000 }),
      player({ gameId: 1, participantId: 2, damageToChampions: 10000 }),
      player({ gameId: 2, participantId: 1, isPlayer: 1, damageToChampions: 1000 }),
      player({ gameId: 2, participantId: 2, damageToChampions: 9000 }),
    ])

    // Mean of 0.75 and 0.1, not 31000 / 50000.
    expect(insights.getTeamContribution({ puuid: PUUID })!.damageShare).toBeCloseTo(
      0.425,
    )
  })

  it("reports nothing when no lobby has been recorded", () => {
    expect(insights.getTeamContribution({ puuid: PUUID })).toBeUndefined()
  })
})

describe("getChampionPool", () => {
  it("measures how concentrated the pool is", () => {
    matches.insertMany([
      ...[1, 2, 3, 4, 5].map((id) =>
        buildMatchRow({ gameId: id, championId: 84, win: 1 }),
      ),
      ...[6, 7, 8, 9, 10].map((id) =>
        buildMatchRow({ gameId: id, championId: id, win: 0 }),
      ),
    ])

    const pool = insights.getChampionPool({ puuid: PUUID })!

    expect(pool.champions).toBe(6)
    expect(pool.games).toBe(10)
    // The five most played champions cover nine of the ten games.
    expect(pool.coreShare).toBeCloseTo(0.9)
    expect(pool.coreWinRate).toBeGreaterThan(pool.restWinRate)
  })

  it("reports nothing when no games are recorded", () => {
    expect(insights.getChampionPool({ puuid: PUUID })).toBeUndefined()
  })
})

describe("getBuildPatterns", () => {
  it("counts finished items the player actually held", () => {
    matches.insertMany([buildMatchRow({ gameId: 1, win: 1 })])
    participants.insertMany([
      player({
        participantId: 1,
        isPlayer: 1,
        win: 1,
        items: [3089, 3020, 0, 0, 0, 0, 2055],
      }),
    ])

    const items = insights.getBuildPatterns({ puuid: PUUID }, 5)

    expect(items.map((row) => row.itemId).sort()).toEqual([3020, 3089])
    expect(items[0].games).toBe(1)
    expect(items[0].winRate).toBe(1)
  })

  it("ignores the trinket slot and empty slots", () => {
    matches.insertMany([buildMatchRow({ gameId: 1 })])
    participants.insertMany([
      player({
        participantId: 1,
        isPlayer: 1,
        items: [0, 0, 0, 0, 0, 0, 3340],
      }),
    ])

    expect(insights.getBuildPatterns({ puuid: PUUID }, 5)).toEqual([])
  })

  it("counts only the player, never their lobby", () => {
    matches.insertMany([buildMatchRow({ gameId: 1 })])
    participants.insertMany([
      player({ participantId: 1, isPlayer: 1, items: [3089, 0, 0, 0, 0, 0, 0] }),
      player({ participantId: 2, items: [3031, 0, 0, 0, 0, 0, 0] }),
    ])

    expect(
      insights.getBuildPatterns({ puuid: PUUID }, 5).map((row) => row.itemId),
    ).toEqual([3089])
  })

  it("orders the most built first and respects the limit", () => {
    matches.insertMany([
      buildMatchRow({ gameId: 1 }),
      buildMatchRow({ gameId: 2 }),
    ])
    participants.insertMany([
      player({ gameId: 1, participantId: 1, isPlayer: 1, items: [3089, 3020, 0, 0, 0, 0, 0] }),
      player({ gameId: 2, participantId: 1, isPlayer: 1, items: [3089, 0, 0, 0, 0, 0, 0] }),
    ])

    const items = insights.getBuildPatterns({ puuid: PUUID }, 1)

    expect(items).toHaveLength(1)
    expect(items[0].itemId).toBe(3089)
    expect(items[0].games).toBe(2)
  })
})
