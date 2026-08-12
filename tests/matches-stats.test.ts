import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { buildMatchRow, buildMatchSequence } from "./fixtures/matches.js"

const PUUID = "test-puuid"

let repo: MatchesRepository
let db: InstanceType<typeof Database>

beforeEach(() => {
  db = new Database(":memory:")
  applyMigrations(db)
  repo = new MatchesRepository(db)
})

function storeOwnerPosition(
  gameId: number,
  assignedPosition: string,
  detailVersion = 0,
) {
  db.prepare(
    `INSERT INTO match_participants
     (game_id, puuid, participant_id, team_id, is_player, champion_id, win,
      kills, deaths, assists, gold_earned, damage_to_champions, damage_taken,
      damage_self_mitigated, total_heal, time_ccing_others,
      total_minions_killed, neutral_minions, vision_score, damage_objectives,
      assigned_position, detail_version)
     VALUES (?, ?, 1, 100, 1, 84, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)`,
  ).run(gameId, PUUID, assignedPosition, detailVersion)
}

describe("getSummary", () => {
  it("counts games, wins and losses", () => {
    repo.insertMany(buildMatchSequence([true, true, false, true, false, true]))

    const summary = repo.getSummary({ puuid: PUUID })

    expect(summary.games).toBe(6)
    expect(summary.wins).toBe(4)
    expect(summary.losses).toBe(2)
    expect(summary.winRate).toBeCloseTo(4 / 6)
  })

  it("averages KDA across games", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, kills: 10, deaths: 5, assists: 15 }),
      buildMatchRow({ gameId: 2, kills: 20, deaths: 5, assists: 5 }),
    ])

    const summary = repo.getSummary({ puuid: PUUID })

    expect(summary.avgKills).toBe(15)
    expect(summary.avgDeaths).toBe(5)
    expect(summary.avgAssists).toBe(10)
    // (10 + 20 + 15 + 5) / (5 + 5)
    expect(summary.kda).toBeCloseTo(5)
  })

  it("treats a deathless record as a perfect KDA rather than dividing by zero", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, kills: 7, deaths: 0, assists: 3 }),
    ])

    expect(repo.getSummary({ puuid: PUUID }).kda).toBe(10)
  })

  it("filters by mode", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, mode: "aram", win: 1 }),
      buildMatchRow({ gameId: 2, mode: "aram", win: 0 }),
      buildMatchRow({ gameId: 3, mode: "mayhem", win: 1 }),
    ])

    expect(repo.getSummary({ puuid: PUUID, mode: "mayhem" }).games).toBe(1)
    expect(repo.getSummary({ puuid: PUUID, mode: "aram" }).games).toBe(2)
  })

  it("filters by date", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, playedAt: 1_000 }),
      buildMatchRow({ gameId: 2, playedAt: 9_000 }),
    ])

    expect(repo.getSummary({ puuid: PUUID, sinceMs: 5_000 }).games).toBe(1)
  })

  it("combines season, role, and champion filters", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, playedAt: 1_000, championId: 84, role: "MIDDLE" }),
      buildMatchRow({ gameId: 2, playedAt: 6_000, championId: 84, role: "MIDDLE" }),
      buildMatchRow({ gameId: 3, playedAt: 7_000, championId: 22, role: "MIDDLE" }),
      buildMatchRow({ gameId: 4, playedAt: 8_000, championId: 84, role: "JUNGLE" }),
    ])

    const summary = repo.getSummary({
      puuid: PUUID,
      sinceMs: 5_000,
      untilMs: 7_500,
      championIds: [84],
      roles: ["MIDDLE"],
    })

    expect(summary.games).toBe(1)
  })

  it("normalizes legacy carry and support role labels", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, role: "CARRY", lane: "BOTTOM" }),
      buildMatchRow({ gameId: 2, role: "SUPPORT", lane: "BOTTOM" }),
    ])

    expect(repo.getSummary({ puuid: PUUID, roles: ["BOTTOM"] }).games).toBe(1)
    expect(repo.getSummary({ puuid: PUUID, roles: ["UTILITY"] }).games).toBe(1)
  })

  it("files a duo hint with no lane under no role at all", () => {
    // Short games come back with every player marked SUPPORT and no lane, so
    // the hint on its own is not evidence of anyone having played support.
    repo.insertMany([buildMatchRow({ gameId: 1, role: "SUPPORT", lane: "NONE" })])

    expect(repo.getSummary({ puuid: PUUID, roles: ["UTILITY"] }).games).toBe(0)
  })

  it("uses the champion-select assignment when post-game position is absent", () => {
    repo.insertMany([buildMatchRow({ gameId: 1, role: "SUPPORT", lane: "NONE" })])
    storeOwnerPosition(1, "UTILITY")

    expect(repo.getSummary({ puuid: PUUID, roles: ["UTILITY"] }).games).toBe(1)
  })

  it("keeps Match-V5's played position ahead of the queue assignment", () => {
    repo.insertMany([buildMatchRow({ gameId: 1, role: "MIDDLE", lane: "TOP" })])
    storeOwnerPosition(1, "UTILITY")

    expect(repo.getSummary({ puuid: PUUID, roles: ["MIDDLE"] }).games).toBe(1)
    expect(repo.getSummary({ puuid: PUUID, roles: ["UTILITY"] }).games).toBe(0)
  })

  it("uses the persisted resolved position ahead of contradictory raw role data", () => {
    repo.insertMany([buildMatchRow({
      gameId: 1,
      resolvedPosition: "JUNGLE",
      role: "TOP",
      lane: "TOP",
    })])

    expect(repo.getSummary({ puuid: PUUID, roles: ["JUNGLE"] }).games).toBe(1)
    expect(repo.getSummary({ puuid: PUUID, roles: ["TOP"] }).games).toBe(0)
  })

  // The Matches page shows these totals directly above the games they
  // describe, so it summarises exactly the same query.
  it("describes only the matches a full match query selects", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, mode: "mayhem", championId: 84, win: 1 }),
      buildMatchRow({ gameId: 2, mode: "mayhem", championId: 84, win: 0 }),
      buildMatchRow({ gameId: 3, mode: "mayhem", championId: 22, win: 1 }),
      buildMatchRow({ gameId: 4, mode: "aram", championId: 84, win: 1 }),
    ])

    const summary = repo.getSummary({
      puuid: PUUID,
      modes: ["mayhem"],
      championIds: [84],
    })

    expect(summary.games).toBe(2)
    expect(summary.wins).toBe(1)
  })

  it("counts only wins when the query asks for wins", () => {
    repo.insertMany(buildMatchSequence([true, false, true]))

    expect(repo.getSummary({ puuid: PUUID, result: "win" }).games).toBe(2)
  })

  it("leaves remakes out when the query excludes them", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, durationSecs: 200 }),
      buildMatchRow({ gameId: 2, durationSecs: 1800 }),
    ])

    expect(
      repo.getSummary({ puuid: PUUID, minDurationSecs: 300 }).games,
    ).toBe(1)
  })

  it("excludes custom and bot games from statistics", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, isMatched: 1 }),
      buildMatchRow({ gameId: 2, isMatched: 0 }),
    ])

    expect(repo.getSummary({ puuid: PUUID }).games).toBe(1)
  })

  it("isolates ranked and normal Rift scopes from each other and from ARAM", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, mode: "sr_ranked_solo" }),
      buildMatchRow({ gameId: 2, mode: "sr_ranked_flex" }),
      buildMatchRow({ gameId: 3, mode: "sr_normal" }),
      buildMatchRow({ gameId: 4, mode: "sr_quickplay" }),
      buildMatchRow({ gameId: 5, mode: "sr_swiftplay" }),
      buildMatchRow({ gameId: 6, mode: "aram" }),
      buildMatchRow({ gameId: 7, mode: "mayhem" }),
    ])

    expect(
      repo.getSummary({ puuid: PUUID, modes: ["sr_ranked_solo", "sr_ranked_flex"] }).games,
    ).toBe(2)
    expect(
      repo.getSummary({ puuid: PUUID, modes: ["sr_normal", "sr_quickplay", "sr_swiftplay"] }).games,
    ).toBe(3)
    expect(repo.getSummary({ puuid: PUUID, modes: ["sr_ranked_solo"] }).games).toBe(1)
    expect(repo.getSummary({ puuid: PUUID, modes: ["aram"] }).games).toBe(1)
    expect(repo.getSummary({ puuid: PUUID, modes: ["mayhem"] }).games).toBe(1)
  })

  it("returns zeroes when nothing is recorded", () => {
    const summary = repo.getSummary({ puuid: PUUID })

    expect(summary.games).toBe(0)
    expect(summary.winRate).toBe(0)
    expect(summary.kda).toBe(0)
    expect(summary.currentStreak).toBe(0)
  })
})

describe("getLifetimeTotals", () => {
  it("sums completed owner facts and keeps team objectives explicitly scoped", () => {
    repo.insertMany([
      buildMatchRow({
        gameId: 1,
        win: 1,
        durationSecs: 1_200,
        kills: 4,
        deaths: 2,
        assists: 6,
        largestKillingSpree: 6,
        largestMultiKill: 5,
        doubleKills: 2,
        tripleKills: 1,
        quadraKills: 0,
        endedInSurrender: 1,
        endedInEarlySurrender: 1,
        totalMinionsKilled: 80,
        neutralMinions: 20,
        damageToChampions: 12_000,
        damageTaken: 8_000,
        damageSelfMitigated: 4_000,
        totalHeal: 3_000,
        totalUnitsHealed: 2,
        timeCcingOthers: 12,
        goldEarned: 9_000,
        visionScore: 18,
        wardsPlaced: 7,
        wardsKilled: 2,
        controlWards: 1,
        damageObjectives: 5_000,
        damageTurrets: 2_000,
        turretKills: 1,
        inhibitorKills: 1,
        firstBlood: 1,
        pentaKills: 1,
      }),
      buildMatchRow({
        gameId: 2,
        win: 0,
        durationSecs: 1_800,
        kills: 2,
        deaths: 5,
        assists: 8,
        largestKillingSpree: 3,
        largestMultiKill: 4,
        doubleKills: 1,
        tripleKills: 0,
        quadraKills: 1,
        totalMinionsKilled: 100,
        neutralMinions: 10,
        damageToChampions: 18_000,
        damageTaken: 14_000,
        damageSelfMitigated: 6_000,
        totalHeal: 4_000,
        totalUnitsHealed: 3,
        timeCcingOthers: 18,
        goldEarned: 11_000,
        visionScore: 22,
        wardsPlaced: 9,
        wardsKilled: 3,
        controlWards: 2,
        damageObjectives: 1_500,
        damageTurrets: 2_000,
        turretKills: 2,
        inhibitorKills: 0,
        firstBlood: 0,
      }),
      // Imported but not a completed matched game; it must not enter lifetime totals.
      buildMatchRow({ gameId: 3, isMatched: 0, durationSecs: 900, kills: 99 }),
      buildMatchRow({ gameId: 4, durationSecs: 0, kills: 99 }),
    ])
    storeOwnerPosition(1, "MIDDLE", 8)
    storeOwnerPosition(2, "MIDDLE", 8)

    const updateOwnerDetail = db.prepare(`
      UPDATE match_participants
      SET neutral_minions = ?, gold_spent = ?, total_damage_dealt = ?,
          magic_damage_to_champions = ?, physical_damage_to_champions = ?,
          true_damage_to_champions = ?, control_wards_purchased = ?,
          total_heals_on_teammates = ?,
          total_damage_shielded_on_teammates = ?, longest_time_living = ?,
          wards_placed = ?, wards_killed = ?, control_wards = ?,
          damage_objectives = ?, damage_turrets = ?, turret_kills = ?,
          inhibitor_kills = ?, first_blood = ?
      WHERE game_id = ? AND puuid = ? AND is_player = 1
    `)
    updateOwnerDetail.run(
      20, 8_000, 50_000, 7_000, 4_000, 1_000, 1,
      1_000, 500, 600, 7, 2, 1, 5_000, 2_000, 1, 1, 1,
      1, PUUID,
    )
    updateOwnerDetail.run(
      10, 10_000, 70_000, 10_000, 6_000, 2_000, 2,
      1_500, 700, 900, 9, 3, 2, 1_500, 2_000, 2, 0, 0,
      2, PUUID,
    )

    const insertScoreboardPlayer = db.prepare(`
      INSERT INTO match_participants
        (game_id, puuid, participant_id, team_id, is_player, champion_id, win,
         kills, deaths, assists, gold_earned, damage_to_champions, damage_taken,
         damage_self_mitigated, total_heal, time_ccing_others,
         total_minions_killed, neutral_minions, vision_score, damage_objectives,
         detail_version)
      VALUES (1, ?, ?, ?, 0, 1, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8)
    `)
    for (let participantId = 2; participantId <= 10; participantId += 1) {
      const teamId = participantId <= 5 ? 100 : 200
      insertScoreboardPlayer.run(PUUID, participantId, teamId, teamId === 100 ? 1 : 0)
    }

    const insertTeam = db.prepare(`
      INSERT INTO match_teams
        (game_id, puuid, team_id, win, bans, baron_kills, dragon_kills,
         herald_kills, horde_kills, tower_kills, inhibitor_kills)
      VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?)
    `)
    insertTeam.run(1, PUUID, 100, 1, 1, 3, 1, 2, 7, 1)
    insertTeam.run(1, PUUID, 200, 0, 0, 1, 0, 0, 2, 0)
    db.prepare(`
      INSERT INTO match_capture_manifests
        (game_id, puuid, source, match_mapper_version,
         participant_mapper_version, participant_count, team_count,
         augment_participant_count, captured_categories_json,
         missing_categories_json, unknown_field_names_json, captured_at)
      VALUES (1, ?, 'league_client', 1, 2, 10, 2, 0,
              '["scoreboard","extended_metrics"]', '[]', '[]', 1)
    `).run(PUUID)
    // Game 2 intentionally has no complete team scoreboard.

    expect(repo.getLifetimeTotals(PUUID)).toEqual({
      recordedGames: 2,
      wins: 1,
      losses: 1,
      winRate: .5,
      timePlayedSecs: 3_000,
      championTakedowns: 20,
      kills: 6,
      deaths: 7,
      assists: 14,
      largestKillingSpree: 6,
      largestMultiKill: 5,
      doubleKills: 3,
      tripleKills: 1,
      quadraKills: 1,
      surrenders: 1,
      earlySurrenders: 1,
      totalCs: 210,
      damageToChampions: 30_000,
      damageTaken: 22_000,
      damageSelfMitigated: 10_000,
      totalHeal: 7_000,
      totalUnitsHealed: 5,
      crowdControlSecs: 30,
      goldEarned: 20_000,
      visionScore: 40,
      wardsPlaced: 16,
      wardsKilled: 5,
      controlWards: 3,
      neutralObjectiveDamage: 3_000,
      structureDamage: 4_000,
      turretKills: 3,
      inhibitorKills: 1,
      firstBloods: 1,
      pentaKills: 1,
      detailContext: {
        measuredGames: 2,
        neutralMinions: 30,
        goldSpent: 18_000,
        totalDamageDealt: 120_000,
        magicDamageToChampions: 17_000,
        physicalDamageToChampions: 10_000,
        trueDamageToChampions: 3_000,
        controlWardsPurchased: 3,
        teammateHealing: 2_500,
        teammateShielding: 1_200,
        longestLifeSecs: 900,
      },
      teamContext: {
        measuredGames: 1,
        dragons: 3,
        barons: 1,
        heralds: 1,
        voidGrubs: 2,
        turrets: 7,
        inhibitors: 1,
      },
    })
  })

  it("returns a complete zero contract for an empty archive", () => {
    expect(repo.getLifetimeTotals(PUUID)).toMatchObject({
      recordedGames: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      teamContext: { measuredGames: 0, dragons: 0, barons: 0 },
    })
  })

  it("keeps migrated zero-filled detail out of measured lifetime totals", () => {
    repo.insertMany([buildMatchRow({
      gameId: 8,
      neutralMinions: 30,
      wardsPlaced: 9,
      damageObjectives: 4_000,
    })])
    storeOwnerPosition(8, "MIDDLE")

    expect(repo.getLifetimeTotals(PUUID)).toMatchObject({
      recordedGames: 1,
      totalCs: 60,
      wardsPlaced: 0,
      neutralObjectiveDamage: 0,
      detailContext: { measuredGames: 0, neutralMinions: 0 },
    })
  })
})

describe("streaks", () => {
  it("reports a positive current streak for consecutive recent wins", () => {
    // Oldest first: the three most recent games are wins.
    repo.insertMany(buildMatchSequence([false, true, true, true]))

    expect(repo.getSummary({ puuid: PUUID }).currentStreak).toBe(3)
  })

  it("reports a negative current streak for consecutive recent losses", () => {
    repo.insertMany(buildMatchSequence([true, false, false]))

    expect(repo.getSummary({ puuid: PUUID }).currentStreak).toBe(-2)
  })

  it("reports the longest win streak across all history", () => {
    repo.insertMany(
      buildMatchSequence([true, true, true, true, false, true, true]),
    )

    const summary = repo.getSummary({ puuid: PUUID })

    expect(summary.longestWinStreak).toBe(4)
    expect(summary.currentStreak).toBe(2)
  })

  it("handles a single game", () => {
    repo.insertMany(buildMatchSequence([true]))

    expect(repo.getSummary({ puuid: PUUID }).currentStreak).toBe(1)
  })
})

describe("getChampionStats", () => {
  it("groups results by champion", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, championId: 84, win: 1 }),
      buildMatchRow({ gameId: 2, championId: 84, win: 0 }),
      buildMatchRow({ gameId: 3, championId: 84, win: 1 }),
      buildMatchRow({ gameId: 4, championId: 22, win: 1 }),
    ])

    const stats = repo.getChampionStats({ puuid: PUUID })
    const akali = stats.find((row) => row.championId === 84)

    expect(akali?.games).toBe(3)
    expect(akali?.wins).toBe(2)
    expect(akali?.winRate).toBeCloseTo(2 / 3)
    expect(stats.find((row) => row.championId === 22)?.games).toBe(1)
  })

  it("orders champions by games played", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, championId: 22 }),
      buildMatchRow({ gameId: 2, championId: 84 }),
      buildMatchRow({ gameId: 3, championId: 84 }),
    ])

    expect(repo.getChampionStats({ puuid: PUUID })[0].championId).toBe(84)
  })
})

describe("getRecentMatches", () => {
  it("returns the newest matches first and respects the limit", () => {
    repo.insertMany(buildMatchSequence([true, false, true, false, true]))

    const recent = repo.getRecentMatches({ puuid: PUUID }, 3)

    expect(recent).toHaveLength(3)
    expect(recent[0].gameId).toBe(5)
    expect(recent[2].gameId).toBe(3)
  })

  it("keeps League Classic independently filterable from Mayhem", () => {
    repo.insertMany([
      buildMatchRow({
        gameId: 1,
        playedAt: 1_000,
        queueId: 2450,
        gameMode: "KIWI_JADE",
        mode: "mayhem",
      }),
      buildMatchRow({
        gameId: 2,
        playedAt: 2_000,
        queueId: 710,
        gameMode: "CLASSIC",
        mode: "league_classic",
        modeFamily: "classic",
        queueName: "Ranked 5s",
      }),
      buildMatchRow({ gameId: 3, playedAt: 3_000, queueId: 420 }),
    ])

    expect(
      repo.getRecentMatches({ puuid: PUUID, mode: "league_classic" }, 6)
        .map((match) => match.gameId),
    ).toEqual([2])
    expect(
      repo.getRecentMatches({ puuid: PUUID, mode: "mayhem" }, 6)
        .map((match) => match.gameId),
    ).toEqual([1])
  })
})

describe("getRecentForm", () => {
  it("returns recent results oldest-to-newest for display", () => {
    repo.insertMany(buildMatchSequence([true, false, true]))

    expect(repo.getRecentForm({ puuid: PUUID }, 10)).toEqual([
      true,
      false,
      true,
    ])
  })
})
