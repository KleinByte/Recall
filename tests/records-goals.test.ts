import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { GoalsRepository } from "../electron/main/database/goals-repo.js"
import { buildMatchRow } from "./fixtures/matches.js"

const PUUID = "test-puuid"

let matches: MatchesRepository
let goals: GoalsRepository

beforeEach(() => {
  const db = new Database(":memory:")
  applyMigrations(db)
  matches = new MatchesRepository(db)
  goals = new GoalsRepository(db)
})

describe("getRecords", () => {
  it("finds the single best game for each record", () => {
    matches.insertMany([
      buildMatchRow({ gameId: 1, kills: 12, championId: 84 }),
      buildMatchRow({ gameId: 2, kills: 27, championId: 22 }),
      buildMatchRow({ gameId: 3, kills: 4, championId: 64 }),
    ])

    const kills = matches
      .getRecords({ puuid: PUUID })
      .find((record) => record.key === "kills")!

    expect(kills.value).toBe(27)
    expect(kills.gameId).toBe(2)
    expect(kills.championId).toBe(22)
  })

  it("covers the records the page shows", () => {
    matches.insertMany([buildMatchRow({ gameId: 1 })])

    const keys = matches.getRecords({ puuid: PUUID }).map((r) => r.key)

    expect(keys).toEqual([
      "kills",
      "assists",
      "damage",
      "gold",
      "spree",
      "cs",
      "kda",
    ])
  })

  it("reports nothing when no games are recorded", () => {
    expect(matches.getRecords({ puuid: PUUID })).toEqual([])
  })

  it("honours the mode filter", () => {
    matches.insertMany([
      buildMatchRow({ gameId: 1, mode: "aram", kills: 30 }),
      buildMatchRow({ gameId: 2, mode: "mayhem", kills: 5 }),
    ])

    const kills = matches
      .getRecords({ puuid: PUUID, mode: "mayhem" })
      .find((record) => record.key === "kills")!

    expect(kills.value).toBe(5)
  })

  it("does not let a bot game become a personal record", () => {
    matches.insertMany([
      buildMatchRow({
        gameId: 1,
        queueId: 890,
        isMatched: 0,
        damageToChampions: 200_000,
      }),
      buildMatchRow({
        gameId: 2,
        queueId: 450,
        damageToChampions: 42_000,
      }),
    ])

    const damage = matches
      .getRecords({ puuid: PUUID })
      .find((record) => record.key === "damage")!

    expect(damage.gameId).toBe(2)
    expect(damage.value).toBe(42_000)
  })

  it("keeps League Classic out of Rift records", () => {
    matches.insertMany([
      buildMatchRow({
        gameId: 1,
        queueId: 710,
        gameMode: "CLASSIC",
        queueName: "Ranked 5s",
        mode: "sr_normal",
        modeFamily: "sr",
        kills: 40,
      }),
      buildMatchRow({
        gameId: 2,
        queueId: 400,
        gameMode: "CLASSIC",
        queueName: "Normal",
        mode: "sr_normal",
        modeFamily: "sr",
        kills: 18,
      }),
    ])

    const kills = matches
      .getRecords({
        puuid: PUUID,
        modes: [
          "sr_ranked_solo",
          "sr_ranked_flex",
          "sr_normal",
          "sr_quickplay",
          "sr_swiftplay",
        ],
        excludeLeagueClassic: true,
      })
      .find((record) => record.key === "kills")!

    expect(kills.gameId).toBe(2)
    expect(kills.value).toBe(18)
  })

  it("keeps ARAM and Mayhem records in their own scopes", () => {
    matches.insertMany([
      buildMatchRow({ gameId: 1, mode: "aram", kills: 20 }),
      buildMatchRow({ gameId: 2, mode: "mayhem", kills: 35 }),
      buildMatchRow({ gameId: 3, mode: "other", kills: 50 }),
    ])

    expect(
      matches.getRecords({ puuid: PUUID, mode: "aram" })
        .find((record) => record.key === "kills")!.gameId,
    ).toBe(1)
    expect(
      matches.getRecords({ puuid: PUUID, mode: "mayhem" })
        .find((record) => record.key === "kills")!.gameId,
    ).toBe(2)
  })

  it("excludes rotating Rift modes and Arena from unscoped records", () => {
    matches.insertMany([
      buildMatchRow({
        gameId: 1,
        queueId: 900,
        gameMode: "URF",
        mode: "sr_normal",
        modeFamily: "sr",
        kills: 45,
      }),
      buildMatchRow({
        gameId: 2,
        queueId: 1750,
        gameMode: "CHERRY",
        mode: "other",
        modeFamily: "other",
        kills: 40,
      }),
      buildMatchRow({
        gameId: 3,
        queueId: 450,
        gameMode: "ARAM",
        mode: "aram",
        modeFamily: "aram",
        kills: 22,
      }),
    ])

    const kills = matches
      .getRecords({ puuid: PUUID })
      .find((record) => record.key === "kills")!

    expect(kills.gameId).toBe(3)
    expect(kills.value).toBe(22)
  })
})

describe("GoalsRepository", () => {
  it("stores a goal and gives it back", () => {
    const id = goals.add({
      puuid: PUUID,
      kind: "challenge",
      targetKey: "101000",
      targetValue: 50,
      label: "Reach Gold in Jack of All Trades",
    })

    const stored = goals.list(PUUID)

    expect(stored).toHaveLength(1)
    expect(stored[0].id).toBe(id)
    expect(stored[0].label).toBe("Reach Gold in Jack of All Trades")
    expect(stored[0].achievedAt).toBeUndefined()
  })

  it("keeps goals for different accounts apart", () => {
    goals.add({
      puuid: PUUID,
      kind: "rank",
      targetKey: "RANKED_SOLO_5x5",
      targetValue: 1200,
      label: "Reach Gold",
    })
    goals.add({
      puuid: "somebody-else",
      kind: "rank",
      targetKey: "RANKED_SOLO_5x5",
      targetValue: 1600,
      label: "Reach Platinum",
    })

    expect(goals.list(PUUID)).toHaveLength(1)
  })

  it("removes a goal", () => {
    const id = goals.add({
      puuid: PUUID,
      kind: "rank",
      targetKey: "RANKED_SOLO_5x5",
      targetValue: 1200,
      label: "Reach Gold",
    })

    expect(goals.remove(id, PUUID)).toBe(true)
    expect(goals.list(PUUID)).toHaveLength(0)
  })

  it("will not remove another account's goal", () => {
    const id = goals.add({
      puuid: "somebody-else",
      kind: "rank",
      targetKey: "RANKED_SOLO_5x5",
      targetValue: 1200,
      label: "Reach Gold",
    })

    expect(goals.remove(id, PUUID)).toBe(false)
  })

  it("marks a goal as reached", () => {
    const id = goals.add({
      puuid: PUUID,
      kind: "rank",
      targetKey: "RANKED_SOLO_5x5",
      targetValue: 1200,
      label: "Reach Gold",
    })

    goals.markAchieved(id, 5_000)

    expect(goals.list(PUUID)[0].achievedAt).toBe(5_000)
  })

  it("leaves a goal already reached alone", () => {
    const id = goals.add({
      puuid: PUUID,
      kind: "rank",
      targetKey: "RANKED_SOLO_5x5",
      targetValue: 1200,
      label: "Reach Gold",
    })
    goals.markAchieved(id, 5_000)
    goals.markAchieved(id, 9_000)

    expect(goals.list(PUUID)[0].achievedAt).toBe(5_000)
  })

  it("lists goals still to reach before ones already met", () => {
    const done = goals.add({
      puuid: PUUID,
      kind: "rank",
      targetKey: "a",
      targetValue: 1,
      label: "Done",
    })
    goals.add({
      puuid: PUUID,
      kind: "rank",
      targetKey: "b",
      targetValue: 2,
      label: "Outstanding",
    })
    goals.markAchieved(done, 1_000)

    expect(goals.list(PUUID).map((goal) => goal.label)).toEqual([
      "Outstanding",
      "Done",
    ])
  })
})
