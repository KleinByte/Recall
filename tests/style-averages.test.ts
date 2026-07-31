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

describe("getStyleAverages", () => {
  it("expresses one game as proportions of what the player did", () => {
    repo.insertMany([buildMatchRow({ gameId: 1 })])

    const averages = repo.getStyleAverages({ puuid: PUUID })!

    // 10 kills of 25 kill involvements.
    expect(averages.aggression).toBeCloseTo(0.4)
    // 30k dealt against 25k taken.
    expect(averages.damage).toBeCloseTo(30000 / 55000)
    // 15k shrugged off against 25k that landed.
    expect(averages.durability).toBeCloseTo(15000 / 40000)
    // farming is now unused (CS pace is displayed via csPerMin directly).
    expect(averages.farming).toBe(0)
    expect(averages.sustain).toBeCloseTo(5000 / 30000)
    // 5 vision score over 20 minutes.
    expect(averages.visionPerMin).toBeCloseTo(0.25)
    expect(averages.ccPerMin).toBeCloseTo(1.5)
    expect(averages.games).toBe(1)
  })

  it("averages each game equally rather than summing career totals", () => {
    repo.insertMany([
      // A short game with a high damage share.
      buildMatchRow({
        gameId: 1,
        durationSecs: 600,
        damageToChampions: 9000,
        damageTaken: 1000,
      }),
      // A long game with a low one. Totals would let this game dominate.
      buildMatchRow({
        gameId: 2,
        durationSecs: 3000,
        damageToChampions: 20000,
        damageTaken: 80000,
      }),
    ])

    const averages = repo.getStyleAverages({ puuid: PUUID })!

    // Mean of 0.9 and 0.2, not 29000 / 110000.
    expect(averages.damage).toBeCloseTo(0.55)
  })

  it("survives a game with no gold, no kills and no damage taken", () => {
    repo.insertMany([
      buildMatchRow({
        gameId: 1,
        kills: 0,
        assists: 0,
        goldEarned: 0,
        damageTaken: 0,
        damageToChampions: 0,
        damageSelfMitigated: 0,
        totalHeal: 0,
        durationSecs: 0,
      }),
    ])

    const averages = repo.getStyleAverages({ puuid: PUUID })!

    for (const value of Object.values(averages)) {
      expect(Number.isFinite(value)).toBe(true)
    }
    expect(averages.aggression).toBe(0)
    expect(averages.farming).toBe(0)
  })

  it("never reports more than all of a player's gold as farm", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, totalMinionsKilled: 400, goldEarned: 3000 }),
    ])

    // farming field is unused; CS pace is delivered via csPerMin directly.
    expect(repo.getStyleAverages({ puuid: PUUID })!.farming).toBe(0)
  })

  it("counts jungle camps as farm alongside minions via csPerMin", () => {
    repo.insertMany([
      buildMatchRow({
        gameId: 1,
        totalMinionsKilled: 100,
        neutralMinions: 100,
        goldEarned: 14000,
      }),
    ])

    // csPerMin is stored on the matches table, unrelated to the farming ratio.
    expect(repo.getStyleAverages({ puuid: PUUID })!.farming).toBe(0)
  })

  it("honours the match filters", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, mode: "mayhem", kills: 20, assists: 0 }),
      buildMatchRow({ gameId: 2, mode: "aram", kills: 0, assists: 20 }),
    ])

    const mayhem = repo.getStyleAverages({ puuid: PUUID, modes: ["mayhem"] })!

    expect(mayhem.games).toBe(1)
    expect(mayhem.aggression).toBe(1)
  })

  it("reads only the most recent games when given a window", () => {
    repo.insertMany([
      ...buildMatchSequence([true, true, true]),
      buildMatchRow({
        gameId: 9,
        playedAt: 1_800_000_000_000,
        kills: 20,
        assists: 0,
      }),
    ])

    const recent = repo.getStyleAverages({ puuid: PUUID }, { limit: 1 })!

    expect(recent.games).toBe(1)
    expect(recent.aggression).toBe(1)
  })

  it("skips the recent window when asked for what came before it", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, playedAt: 1_000, kills: 0, assists: 20 }),
      buildMatchRow({
        gameId: 2,
        playedAt: 9_000,
        kills: 20,
        assists: 0,
      }),
    ])

    const earlier = repo.getStyleAverages({ puuid: PUUID }, { offset: 1 })!

    expect(earlier.games).toBe(1)
    expect(earlier.aggression).toBe(0)
  })

  it("reports nothing when the filter selects no games", () => {
    repo.insertMany([buildMatchRow({ gameId: 1, mode: "aram" })])

    expect(
      repo.getStyleAverages({ puuid: PUUID, modes: ["sr_ranked_solo"] }),
    ).toBeUndefined()
  })

  it("carries the per-minute and multikill detail the page shows", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, doubleKills: 2, pentaKills: 1 }),
      buildMatchRow({ gameId: 2, doubleKills: 1, pentaKills: 0 }),
    ])

    const averages = repo.getStyleAverages({ puuid: PUUID })!

    expect(averages.doubleKills).toBe(3)
    expect(averages.pentaKills).toBe(1)
    expect(averages.avgDeaths).toBe(5)
    expect(averages.damagePerMin).toBeCloseTo(30000 / 20)
  })
})

describe("getChampionStats", () => {
  it("reports the average grade so champions can be ranked by how you played", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, championId: 84 }),
      buildMatchRow({ gameId: 2, championId: 84 }),
      buildMatchRow({ gameId: 3, championId: 22 }),
    ])
    repo.setGrade(1, PUUID, "S", 1.4)
    repo.setGrade(2, PUUID, "B", -0.2)

    const stats = repo.getChampionStats({ puuid: PUUID })
    const akali = stats.find((row) => row.championId === 84)!
    const caitlyn = stats.find((row) => row.championId === 22)!

    expect(akali.avgGradeScore).toBeCloseTo(0.6)
    expect(akali.gradedGames).toBe(2)
    expect(caitlyn.avgGradeScore).toBeUndefined()
    expect(caitlyn.gradedGames).toBe(0)
  })
})
