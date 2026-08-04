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
const player = (overrides: Partial<ParticipantRow> & { extendedMetrics?: Record<string, number | boolean> } = {}): ParticipantRow => {
  const { extendedMetrics, ...participantOverrides } = overrides
  return {
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
    extendedMetrics,
    ...participantOverrides,
  }
}

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

  it("isolates ranked and normal Rift scopes from each other and from ARAM", () => {
    matches.insertMany([
      buildMatchRow({ gameId: 1, mode: "sr_ranked_solo", modeFamily: "sr", durationSecs: 1200 }),
      buildMatchRow({ gameId: 2, mode: "sr_ranked_flex", modeFamily: "sr", durationSecs: 1200 }),
      buildMatchRow({ gameId: 3, mode: "sr_normal", modeFamily: "sr", durationSecs: 1200 }),
      buildMatchRow({ gameId: 4, mode: "sr_quickplay", modeFamily: "sr", durationSecs: 1200 }),
      buildMatchRow({ gameId: 5, mode: "sr_swiftplay", modeFamily: "sr", durationSecs: 1200 }),
      buildMatchRow({ gameId: 6, mode: "aram", modeFamily: "aram", durationSecs: 900 }),
      buildMatchRow({ gameId: 7, mode: "mayhem", modeFamily: "aram", durationSecs: 900 }),
    ])

    expect(
      insights
        .getDurationBuckets({ puuid: PUUID, modes: ["sr_ranked_solo", "sr_ranked_flex"] }, "sr")
        .reduce((sum, row) => sum + row.games, 0),
    ).toBe(2)
    expect(
      insights
        .getDurationBuckets({ puuid: PUUID, modes: ["sr_normal", "sr_quickplay", "sr_swiftplay"] }, "sr")
        .reduce((sum, row) => sum + row.games, 0),
    ).toBe(3)
    expect(
      insights
        .getDurationBuckets({ puuid: PUUID, modes: ["sr_ranked_solo"] }, "sr")
        .reduce((sum, row) => sum + row.games, 0),
    ).toBe(1)
    expect(
      insights
        .getDurationBuckets({ puuid: PUUID, modes: ["aram"] }, "aram")
        .reduce((sum, row) => sum + row.games, 0),
    ).toBe(1)
    // ARAM scope never includes Mayhem
    expect(
      insights
        .getDurationBuckets({ puuid: PUUID, modes: ["mayhem"] }, "aram")
        .reduce((sum, row) => sum + row.games, 0),
    ).toBe(1)
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
    expect(pool.top).toEqual([
      { championId: 84, games: 5, wins: 5 },
      { championId: 6, games: 1, wins: 0 },
      { championId: 7, games: 1, wins: 0 },
      { championId: 8, games: 1, wins: 0 },
      { championId: 9, games: 1, wins: 0 },
    ])
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

describe("getObservations", () => {
  it("requires both teams and at least 10 participants for completeLobby", () => {
    matches.insertMany([
      buildMatchRow({
        gameId: 1,
        mode: "sr_ranked_solo",
        modeFamily: "sr",
        durationSecs: 1800,
        playedAt: 1000,
        kills: 5,
        assists: 3,
        damageToChampions: 10000,
      }),
      buildMatchRow({
        gameId: 2,
        mode: "sr_ranked_solo",
        modeFamily: "sr",
        durationSecs: 1800,
        playedAt: 2000,
        kills: 6,
        assists: 4,
        damageToChampions: 12000,
      }),
    ])

    // Game 1: 5 local team + 1 enemy = 6 participants (INCOMPLETE)
    participants.insertMany([
      player({
        gameId: 1,
        participantId: 1,
        isPlayer: 1,
        teamId: 100,
        kills: 5,
        assists: 3,
        damageToChampions: 10000,
      }),
      player({ gameId: 1, participantId: 2, teamId: 100, kills: 2, damageToChampions: 5000 }),
      player({ gameId: 1, participantId: 3, teamId: 100, kills: 1, damageToChampions: 3000 }),
      player({ gameId: 1, participantId: 4, teamId: 100, kills: 0, damageToChampions: 2000 }),
      player({ gameId: 1, participantId: 5, teamId: 100, kills: 0, damageToChampions: 1000 }),
      player({ gameId: 1, participantId: 6, teamId: 200, kills: 0, damageToChampions: 500 }),
    ])

    // Game 2: 5 local team + 5 enemy = 10 participants (COMPLETE)
    participants.insertMany([
      player({
        gameId: 2,
        participantId: 1,
        isPlayer: 1,
        teamId: 100,
        kills: 6,
        assists: 4,
        damageToChampions: 12000,
      }),
      player({ gameId: 2, participantId: 2, teamId: 100, kills: 3, damageToChampions: 8000 }),
      player({ gameId: 2, participantId: 3, teamId: 100, kills: 2, damageToChampions: 6000 }),
      player({ gameId: 2, participantId: 4, teamId: 100, kills: 1, damageToChampions: 4000 }),
      player({ gameId: 2, participantId: 5, teamId: 100, kills: 0, damageToChampions: 2000 }),
      player({ gameId: 2, participantId: 6, teamId: 200, kills: 1, damageToChampions: 5000 }),
      player({ gameId: 2, participantId: 7, teamId: 200, kills: 0, damageToChampions: 3000 }),
      player({ gameId: 2, participantId: 8, teamId: 200, kills: 0, damageToChampions: 2000 }),
      player({ gameId: 2, participantId: 9, teamId: 200, kills: 0, damageToChampions: 1000 }),
      player({ gameId: 2, participantId: 10, teamId: 200, kills: 0, damageToChampions: 500 }),
    ])

    const rows = insights.getObservations({ puuid: PUUID, modes: ["sr_ranked_solo"] })

    expect(rows).toHaveLength(2)

    // Game 1: incomplete lobby - no team-derived metrics
    expect(rows[0].gameId).toBe(1)
    expect(rows[0].completeLobby).toBe(false)
    expect(rows[0].metrics.killParticipation).toBeUndefined()
    expect(rows[0].metrics.teamDamageShare).toBeUndefined()
    expect(rows[0].metrics.allyHealShieldPerMinute).toBeUndefined()

    // Game 2: complete lobby - team-derived metrics present
    expect(rows[1].gameId).toBe(2)
    expect(rows[1].completeLobby).toBe(true)
    expect(rows[1].metrics.killParticipation).toBeCloseTo((6 + 4) / 12)
    expect(rows[1].metrics.teamDamageShare).toBeCloseTo(12000 / 32000)
  })

  it("returns a bounded observation set for scoped matches", () => {
    // Two graded Rift matches: one complete lobby, one local row only
    matches.insertMany([
      buildMatchRow({
        gameId: 1,
        mode: "sr_ranked_solo",
        modeFamily: "sr",
        queueId: 420,
        role: "MIDDLE",
        durationSecs: 1800,
        playedAt: 1000,
        win: 1,
        kills: 8,
        deaths: 4,
        assists: 12,
        damageToChampions: 20000,
        damageTaken: 15000,
        goldEarned: 12000,
        totalMinionsKilled: 150,
        neutralMinions: 30,
        visionScore: 40,
        damageObjectives: 3000,
        timeCcingOthers: 60,
      }),
      buildMatchRow({
        gameId: 2,
        mode: "sr_ranked_solo",
        modeFamily: "sr",
        queueId: 420,
        role: "JUNGLE",
        durationSecs: 1200,
        playedAt: 2000,
        win: 0,
        kills: 2,
        deaths: 8,
        assists: 6,
        damageToChampions: 8000,
        damageTaken: 20000,
        goldEarned: 9000,
        totalMinionsKilled: 30,
        neutralMinions: 100,
        visionScore: 0,
        damageObjectives: 0,
        timeCcingOthers: 20,
      }),
    ])

    // Set grades separately
    matches.setGrade(1, PUUID, "A", 0.5)
    matches.setGrade(2, PUUID, "C", -0.3)

    // Complete lobby for game 1
    participants.insertMany([
      player({
        gameId: 1,
        participantId: 1,
        isPlayer: 1,
        teamId: 100,
        kills: 8,
        deaths: 4,
        assists: 12,
        damageToChampions: 20000,
        extendedMetrics: {
          totalHealsOnTeammates: 2000,
          totalDamageShieldedOnTeammates: 1500,
        },
      }),
      player({ gameId: 1, participantId: 2, teamId: 100, kills: 4, damageToChampions: 0 }),
      player({ gameId: 1, participantId: 3, teamId: 100, kills: 6, damageToChampions: 0 }),
      player({ gameId: 1, participantId: 4, teamId: 100, kills: 2, damageToChampions: 0 }),
      player({ gameId: 1, participantId: 5, teamId: 100, kills: 0, damageToChampions: 0 }),
      player({ gameId: 1, participantId: 6, teamId: 200 }),
      player({ gameId: 1, participantId: 7, teamId: 200 }),
      player({ gameId: 1, participantId: 8, teamId: 200 }),
      player({ gameId: 1, participantId: 9, teamId: 200 }),
      player({ gameId: 1, participantId: 10, teamId: 200 }),
    ])

    // No lobby data for game 2

    const rows = insights.getObservations({ puuid: PUUID, modes: ["sr_ranked_solo"] })

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      gameId: 1,
      playedAt: 1000,
      mode: "sr_ranked_solo",
      family: "sr",
      queueId: 420,
      win: true,
      gradeScore: 0.5,
      championId: 84,
      role: "MIDDLE",
      durationSecs: 1800,
      completeLobby: true,
    })
    expect(rows[0].endedAt).toBe(1000 + 1800 * 1000)
    expect(rows[0].metrics.kda).toBeCloseTo((8 + 12) / 4)
    expect(rows[0].metrics.deaths).toBe(4)
    expect(rows[0].metrics.damagePerMinute).toBeCloseTo(20000 / 30)
    expect(rows[0].metrics.damageTakenPerMinute).toBeCloseTo(15000 / 30)
    expect(rows[0].metrics.goldPerMinute).toBeCloseTo(12000 / 30)
    expect(rows[0].metrics.csPerMinute).toBeCloseTo(180 / 30)
    expect(rows[0].metrics.visionPerMinute).toBeCloseTo(40 / 30)
    expect(rows[0].metrics.objectiveDamagePerMinute).toBeCloseTo(3000 / 30)
    expect(rows[0].metrics.ccPerMinute).toBeCloseTo(60 / 30)
    expect(rows[0].metrics.killParticipation).toBeCloseTo((8 + 12) / 20)
    expect(rows[0].metrics.teamDamageShare).toBeCloseTo(20000 / 20000)
    expect(rows[0].metrics.allyHealShieldPerMinute).toBeCloseTo((2000 + 1500) / 30)

    expect(rows[1]).toMatchObject({
      gameId: 2,
      mode: "sr_ranked_solo",
      family: "sr",
      role: "JUNGLE",
      completeLobby: false,
    })
    expect(rows[1].metrics.killParticipation).toBeUndefined()
    expect(rows[1].metrics.teamDamageShare).toBeUndefined()
    expect(rows[1].metrics.allyHealShieldPerMinute).toBeUndefined()
  })

  it("orders results by played_at ASC, game_id ASC", () => {
    matches.insertMany([
      buildMatchRow({
        gameId: 3,
        mode: "aram",
        modeFamily: "aram",
        playedAt: 1000,
        durationSecs: 900,
      }),
      buildMatchRow({
        gameId: 1,
        mode: "aram",
        modeFamily: "aram",
        playedAt: 1000,
        durationSecs: 900,
      }),
      buildMatchRow({
        gameId: 2,
        mode: "aram",
        modeFamily: "aram",
        playedAt: 500,
        durationSecs: 900,
      }),
    ])

    const rows = insights.getObservations({ puuid: PUUID, modes: ["aram"] })

    expect(rows.map((r) => r.gameId)).toEqual([2, 1, 3])
  })

  it("uses a constant number of SQL statements as match count grows", () => {
    const prepareCount = new Map<string, number>()
    const originalPrepare = insights.db.prepare.bind(insights.db)
    insights.db.prepare = (sql: string) => {
      prepareCount.set(sql, (prepareCount.get(sql) ?? 0) + 1)
      return originalPrepare(sql)
    }

    matches.insertMany([
      buildMatchRow({ gameId: 1, mode: "aram", modeFamily: "aram", durationSecs: 900 }),
    ])
    insights.getObservations({ puuid: PUUID, modes: ["aram"] })
    const countWithOne = prepareCount.size

    prepareCount.clear()
    matches.insertMany([
      buildMatchRow({ gameId: 2, mode: "aram", modeFamily: "aram", durationSecs: 900 }),
      buildMatchRow({ gameId: 3, mode: "aram", modeFamily: "aram", durationSecs: 900 }),
      buildMatchRow({ gameId: 4, mode: "aram", modeFamily: "aram", durationSecs: 900 }),
    ])
    insights.getObservations({ puuid: PUUID, modes: ["aram"] })
    const countWithFour = prepareCount.size

    expect(countWithFour).toBe(countWithOne)
  })

  it("handles missing vision and objective damage gracefully", () => {
    matches.insertMany([
      buildMatchRow({
        gameId: 1,
        mode: "aram",
        modeFamily: "aram",
        durationSecs: 900,
        visionScore: 0,
        damageObjectives: 0,
      }),
    ])

    const rows = insights.getObservations({ puuid: PUUID, modes: ["aram"] })

    expect(rows[0].metrics.visionPerMinute).toBeUndefined()
    expect(rows[0].metrics.objectiveDamagePerMinute).toBeUndefined()
  })

  it("parses extended JSON defensively for heal/shield metrics", () => {
    matches.insertMany([
      buildMatchRow({ gameId: 1, mode: "aram", modeFamily: "aram", durationSecs: 900 }),
    ])
    participants.insertMany([
      player({
        gameId: 1,
        participantId: 1,
        isPlayer: 1,
        teamId: 100,
        damageToChampions: 5000,
        extendedMetrics: { totalHealsOnTeammates: 1200 },
      }),
      player({ gameId: 1, participantId: 2, teamId: 100, damageToChampions: 0 }),
      player({ gameId: 1, participantId: 3, teamId: 100, damageToChampions: 0 }),
      player({ gameId: 1, participantId: 4, teamId: 100, damageToChampions: 0 }),
      player({ gameId: 1, participantId: 5, teamId: 100, damageToChampions: 0 }),
      player({ gameId: 1, participantId: 6, teamId: 200, damageToChampions: 0 }),
      player({ gameId: 1, participantId: 7, teamId: 200, damageToChampions: 0 }),
      player({ gameId: 1, participantId: 8, teamId: 200, damageToChampions: 0 }),
      player({ gameId: 1, participantId: 9, teamId: 200, damageToChampions: 0 }),
      player({ gameId: 1, participantId: 10, teamId: 200, damageToChampions: 0 }),
    ])

    const rows = insights.getObservations({ puuid: PUUID, modes: ["aram"] })

    expect(rows[0].completeLobby).toBe(true)
    expect(rows[0].metrics.allyHealShieldPerMinute).toBeCloseTo(1200 / 15)
  })

  it("uses MAX(1, duration_secs) for rate calculations", () => {
    matches.insertMany([
      buildMatchRow({
        gameId: 1,
        mode: "aram",
        modeFamily: "aram",
        durationSecs: 0,
        damageToChampions: 5000,
        goldEarned: 3000,
      }),
    ])

    const rows = insights.getObservations({ puuid: PUUID, modes: ["aram"] })

    expect(rows[0].metrics.damagePerMinute).toBeCloseTo(5000 * 60)
    expect(rows[0].metrics.goldPerMinute).toBeCloseTo(3000 * 60)
  })

  it("sets endedAt to undefined when duration is zero", () => {
    matches.insertMany([
      buildMatchRow({
        gameId: 1,
        mode: "aram",
        modeFamily: "aram",
        playedAt: 1000,
        durationSecs: 0,
      }),
    ])

    const rows = insights.getObservations({ puuid: PUUID, modes: ["aram"] })

    expect(rows[0].endedAt).toBeUndefined()
  })
})

describe("getFinalItemObservations", () => {
  it("returns final item sets using slots 0-5 only", () => {
    matches.insertMany([
      buildMatchRow({
        gameId: 1,
        mode: "sr_ranked_solo",
        modeFamily: "sr",
        role: "MIDDLE",
      }),
    ])
    matches.setGrade(1, PUUID, "A", 0.5)
    participants.insertMany([
      player({
        gameId: 1,
        participantId: 1,
        isPlayer: 1,
        items: [3089, 3020, 3135, 3165, 3157, 0, 3340],
      }),
    ])

    const rows = insights.getFinalItemObservations({ puuid: PUUID, modes: ["sr_ranked_solo"] })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      gameId: 1,
      championId: 84,
      role: "MIDDLE",
      gradeScore: 0.5,
    })
    expect(rows[0].itemIds).toEqual([3089, 3020, 3135, 3165, 3157])
  })

  it("omits slot 6 (trinket) from item sets", () => {
    matches.insertMany([buildMatchRow({ gameId: 1, mode: "aram", modeFamily: "aram" })])
    participants.insertMany([
      player({
        gameId: 1,
        participantId: 1,
        isPlayer: 1,
        items: [3089, 0, 0, 0, 0, 0, 3340],
      }),
    ])

    const rows = insights.getFinalItemObservations({ puuid: PUUID, modes: ["aram"] })

    expect(rows[0].itemIds).toEqual([3089])
  })

  it("removes zero IDs and duplicates from item sets", () => {
    matches.insertMany([buildMatchRow({ gameId: 1, mode: "aram", modeFamily: "aram" })])
    participants.insertMany([
      player({
        gameId: 1,
        participantId: 1,
        isPlayer: 1,
        items: [3089, 0, 3089, 3020, 0, 3020, 0],
      }),
    ])

    const rows = insights.getFinalItemObservations({ puuid: PUUID, modes: ["aram"] })

    expect(rows[0].itemIds.sort()).toEqual([3020, 3089])
  })

  it("returns an empty array when no matches exist", () => {
    const rows = insights.getFinalItemObservations({ puuid: PUUID, modes: ["aram"] })

    expect(rows).toEqual([])
  })
})

describe("getGradeComponentHistory", () => {
  it("returns the player's chart-ready grade components in chronological order", () => {
    matches.insertMany([
      buildMatchRow({ gameId: 2, playedAt: 2_000, mode: "aram", modeFamily: "aram" }),
      buildMatchRow({ gameId: 1, playedAt: 1_000, mode: "aram", modeFamily: "aram" }),
    ])

    for (const gameId of [1, 2]) {
      matches.setGrade(gameId, PUUID, "A", gameId / 10)
      participants.insertMany([player({ gameId, participantId: 1, isPlayer: 1 })])
      participants.setGrades(gameId, PUUID, new Map([[1, {
        grade: "A",
        score: gameId / 10,
        percentile: 0.7,
        breakdown: {
          algorithmVersion: 1,
          compositePercentile: 0.7,
          components: [{
            key: "combat",
            label: "Combat",
            percentile: 0.8,
            weight: 0.2,
            contribution: 0.16,
            scope: "lobby",
          }],
        },
      }]]))
    }

    const rows = insights.getGradeComponentHistory({ puuid: PUUID, modes: ["aram"] })

    expect(rows.map((row) => row.gameId)).toEqual([1, 2])
    expect(rows[0].components[0]).toMatchObject({ key: "combat", percentile: 0.8 })
    expect(rows[1]).toMatchObject({ grade: "A", gradeScore: 0.2, compositePercentile: 0.7 })
  })
})
