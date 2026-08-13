import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import {
  AccountProfileRepository,
  type AccountProfileSnapshotInput,
} from "../electron/main/database/account-profile-repo.js"
import {
  applyMigrations,
  executeMigration,
  latestSchemaVersion,
  migrations,
} from "../electron/main/database/migrations.js"
import { AccountProfileCapture } from "../electron/main/account-profile-capture.js"

const baseSnapshot = {
  puuid: "owner-puuid",
  summonerId: 12345,
  gameName: "Recall Player",
  tagLine: "NA1",
  profileIconId: 29,
  summonerLevel: 314,
  platformId: "NA1",
  regionalRoute: "americas",
  observedAt: 1_000,
} satisfies AccountProfileSnapshotInput

describe("account profile schema", () => {
  it("upgrades a v26 database with nullable LCU profile history", () => {
    const db = new Database(":memory:")
    for (const migration of migrations.slice(0, 26)) executeMigration(db, migration)
    db.pragma("user_version = 26")

    expect(db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'account_profile_snapshots'
    `).get()).toBeUndefined()

    expect(applyMigrations(db)).toBe(latestSchemaVersion)

    const columns = db.pragma("table_info(account_profile_snapshots)") as {
      name: string
      notnull: number
    }[]
    const nullableColumns = new Map(columns.map((column) => [
      column.name,
      column.notnull === 0,
    ]))
    for (const column of [
      "summoner_id",
      "game_name",
      "tag_line",
      "profile_icon_id",
      "summoner_level",
      "platform_id",
      "regional_route",
    ]) {
      expect(nullableColumns.get(column), `${column} should be nullable`).toBe(true)
    }
    expect(nullableColumns.get("puuid")).toBe(false)
    expect(nullableColumns.get("observed_at")).toBe(false)

    const indices = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND tbl_name = 'account_profile_snapshots'
    `).all() as { name: string }[]
    expect(indices.map((index) => index.name)).toContain(
      "idx_account_profile_snapshots_owner_time",
    )
  })
})

describe("AccountProfileRepository", () => {
  let db: Database.Database
  let repository: AccountProfileRepository

  beforeEach(() => {
    db = new Database(":memory:")
    applyMigrations(db)
    repository = new AccountProfileRepository(db)
  })

  it("preserves an observed profile and explicit unknown fields", () => {
    const unknownSnapshot: AccountProfileSnapshotInput = {
      ...baseSnapshot,
      summonerId: null,
      gameName: null,
      tagLine: null,
      profileIconId: null,
      summonerLevel: null,
      platformId: null,
      regionalRoute: null,
    }

    expect(repository.recordSnapshot(unknownSnapshot)).toBe(true)
    expect(repository.getLatest(baseSnapshot.puuid)).toEqual(unknownSnapshot)
  })

  it("does not append identical periodic or reconnect observations", () => {
    expect(repository.recordSnapshot(baseSnapshot)).toBe(true)
    expect(repository.recordSnapshot({
      ...baseSnapshot,
      observedAt: baseSnapshot.observedAt + 5 * 60_000,
    })).toBe(false)

    expect(repository.getHistory(baseSnapshot.puuid)).toEqual([baseSnapshot])
  })

  it("records real changes and records a later return to an earlier state", () => {
    const changed = {
      ...baseSnapshot,
      profileIconId: 30,
      summonerLevel: 315,
      observedAt: 2_000,
    }
    const changedBack = {
      ...baseSnapshot,
      observedAt: 3_000,
    }

    expect(repository.recordSnapshot(baseSnapshot)).toBe(true)
    expect(repository.recordSnapshot(changed)).toBe(true)
    expect(repository.recordSnapshot({ ...changed, observedAt: 2_500 })).toBe(false)
    expect(repository.recordSnapshot(changedBack)).toBe(true)

    expect(repository.getHistory(baseSnapshot.puuid)).toEqual([
      baseSnapshot,
      changed,
      changedBack,
    ])
  })

  it("deduplicates each account independently", () => {
    expect(repository.recordSnapshot(baseSnapshot)).toBe(true)
    expect(repository.recordSnapshot({
      ...baseSnapshot,
      puuid: "another-puuid",
      observedAt: 2_000,
    })).toBe(true)

    expect(repository.getHistory(baseSnapshot.puuid)).toHaveLength(1)
    expect(repository.getHistory("another-puuid")).toHaveLength(1)
  })

  it("refreshes mutable LCU profile fields and deduplicates unchanged observations", async () => {
    let now = 2_000
    const capture = new AccountProfileCapture(repository, () => now)
    const routes = { platformId: "NA1", regionalRoute: "americas" }
    capture.record(baseSnapshot, routes)

    expect(await capture.refresh(
      async () => baseSnapshot,
      baseSnapshot.puuid,
      routes,
      () => true,
    )).toEqual({ state: "unchanged", summoner: baseSnapshot })
    expect(repository.getHistory(baseSnapshot.puuid)).toHaveLength(1)

    const refreshed = {
      ...baseSnapshot,
      summonerLevel: 315,
      profileIconId: 30,
    }
    now += 1_000
    expect(await capture.refresh(
      async () => refreshed,
      baseSnapshot.puuid,
      routes,
      () => true,
    )).toEqual({ state: "changed", summoner: refreshed })
    expect(repository.getHistory(baseSnapshot.puuid)).toHaveLength(2)
  })

  it("does not write a refresh that completed after its session became stale", async () => {
    const capture = new AccountProfileCapture(repository, () => 2_000)
    capture.record(baseSnapshot, { platformId: "NA1", regionalRoute: "americas" })

    expect(await capture.refresh(
      async () => ({ ...baseSnapshot, summonerLevel: 999 }),
      baseSnapshot.puuid,
      { platformId: "NA1", regionalRoute: "americas" },
      () => false,
    )).toEqual({ state: "stale" })
    expect(repository.getHistory(baseSnapshot.puuid)).toHaveLength(1)
  })

  it("does not attribute a replacement account to the active account", async () => {
    const capture = new AccountProfileCapture(repository, () => 2_000)
    capture.record(baseSnapshot, { platformId: "NA1", regionalRoute: "americas" })

    expect(await capture.refresh(
      async () => ({ ...baseSnapshot, puuid: "different-account" }),
      baseSnapshot.puuid,
      { platformId: "NA1", regionalRoute: "americas" },
      () => true,
    )).toEqual({ state: "account_changed" })

    expect(repository.getHistory(baseSnapshot.puuid)).toHaveLength(1)
    expect(repository.getHistory("different-account")).toHaveLength(0)
  })
})
