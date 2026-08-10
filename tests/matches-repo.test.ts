import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { buildMatchRow } from "./fixtures/matches.js"

const PUUID = "test-puuid"

let repo: MatchesRepository

beforeEach(() => {
  const db = new Database(":memory:")
  applyMigrations(db)
  repo = new MatchesRepository(db)
})

describe("MatchesRepository", () => {
  it("inserts new matches and reports how many were stored", () => {
    const inserted = repo.insertMany([
      buildMatchRow({ gameId: 1 }),
      buildMatchRow({ gameId: 2 }),
      buildMatchRow({ gameId: 3 }),
    ])

    expect(inserted).toBe(3)
    expect(repo.countMatches(PUUID)).toBe(3)
  })

  it("ignores matches it has already stored", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1 }),
      buildMatchRow({ gameId: 2 }),
      buildMatchRow({ gameId: 3 }),
    ])

    // An overlapping sync window: two already-known games plus one new one.
    const inserted = repo.insertMany([
      buildMatchRow({ gameId: 2 }),
      buildMatchRow({ gameId: 3 }),
      buildMatchRow({ gameId: 4 }),
    ])

    expect(inserted).toBe(1)
    expect(repo.countMatches(PUUID)).toBe(4)
  })

  it("lets authoritative Match-V5 duration validation replace an LCU summary", () => {
    repo.insertMany([buildMatchRow({
      gameId: 9,
      durationSecs: 1_200,
      durationQuality: "source_reported",
    })])

    repo.insertMany([buildMatchRow({
      gameId: 9,
      durationSecs: 600,
      durationQuality: "inconsistent",
      riotMatchId: "NA1_9",
    })])

    expect(repo.getMatch(9, PUUID)).toMatchObject({
      durationSecs: 600,
      durationQuality: "inconsistent",
      riotMatchId: "NA1_9",
    })
  })

  it("reconciles independent LCU summary and scoreboard durations before grading", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 10, durationSecs: 1_200, durationQuality: "source_reported" }),
      buildMatchRow({ gameId: 11, durationSecs: 1_200, durationQuality: "source_reported" }),
      buildMatchRow({ gameId: 12, durationSecs: 0, durationQuality: "invalid" }),
      buildMatchRow({ gameId: 13, durationSecs: 1_200, durationQuality: "source_reported" }),
    ])

    expect(repo.reconcileLcuDetailDuration(10, PUUID, 1_201)).toBe("verified")
    expect(repo.reconcileLcuDetailDuration(11, PUUID, 1_300)).toBe("inconsistent")
    expect(repo.reconcileLcuDetailDuration(12, PUUID, 900)).toBe("source_reported")
    expect(repo.reconcileLcuDetailDuration(13, PUUID, 43_201)).toBe("invalid")
    expect(repo.getMatch(10, PUUID)).toMatchObject({
      durationSecs: 1_200,
      durationQuality: "verified",
    })
    expect(repo.getMatch(11, PUUID)?.durationQuality).toBe("inconsistent")
    expect(repo.getMatch(12, PUUID)).toMatchObject({
      durationSecs: 900,
      durationQuality: "source_reported",
    })
    expect(repo.getMatch(13, PUUID)?.durationQuality).toBe("invalid")
  })

  it("keeps the same game separately for different accounts", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, puuid: "account-a" }),
      buildMatchRow({ gameId: 1, puuid: "account-b" }),
    ])

    expect(repo.countMatches("account-a")).toBe(1)
    expect(repo.countMatches("account-b")).toBe(1)
  })

  it("reports the oldest recorded match date", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, playedAt: 5_000 }),
      buildMatchRow({ gameId: 2, playedAt: 1_000 }),
    ])

    expect(repo.getOldestPlayedAt(PUUID)).toBe(1_000)
  })

  it("reports no oldest date when nothing is stored", () => {
    expect(repo.getOldestPlayedAt(PUUID)).toBeUndefined()
  })
})
