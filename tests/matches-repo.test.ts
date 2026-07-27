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
