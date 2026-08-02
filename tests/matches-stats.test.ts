import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { buildMatchRow, buildMatchSequence } from "./fixtures/matches.js"

const PUUID = "test-puuid"

let repo: MatchesRepository

beforeEach(() => {
  const db = new Database(":memory:")
  applyMigrations(db)
  repo = new MatchesRepository(db)
})

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

  it("leaves League Classic out of a feed without hiding Mayhem", () => {
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
        mode: "sr_normal",
        modeFamily: "sr",
        queueName: "Ranked 5s",
      }),
      buildMatchRow({ gameId: 3, playedAt: 3_000, queueId: 420 }),
    ])

    expect(
      repo.getRecentMatches({ puuid: PUUID, excludeLeagueClassic: true }, 6)
        .map((match) => match.gameId),
    ).toEqual([3, 1])
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
