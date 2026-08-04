import Database from "better-sqlite3-node"
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { BackupManager } from "../electron/main/database/backup-manager.js"
import {
  applyMigrations,
  latestSchemaVersion,
} from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { buildMatchRow } from "./fixtures/matches.js"

let root: string
let databasePath: string
let backupDir: string
let db: Database.Database

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "recall-backups-"))
  databasePath = path.join(root, "stats.db")
  backupDir = path.join(root, "backups")
  db = new Database(databasePath)
  db.pragma("journal_mode = WAL")
  applyMigrations(db)
  new MatchesRepository(db).insertMany([buildMatchRow()])
})

afterEach(() => {
  if (db?.open) db.close()
  rmSync(root, { recursive: true, force: true })
})

function manager() {
  return new BackupManager(databasePath, backupDir, {
    DatabaseClass: Database as never,
    now: () => 1_700_000_000_000,
  })
}

describe("BackupManager", () => {
  it("publishes only verified backups with complete manifests", () => {
    const backup = manager().create(db as never, "manual")
    expect(backup).toMatchObject({
      reason: "manual",
      schemaVersion: latestSchemaVersion,
      matchCount: 1,
      integrity: "ok",
    })
    expect(backup.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(manager().list()).toEqual([backup])
  })

  it("creates a pre-restore generation and restores after restart", () => {
    const selected = manager().create(db as never, "manual")
    db.prepare("DELETE FROM matches").run()
    manager().prepareRestore(db as never, selected.fileName)
    db.close()
    expect(manager().applyRestoreIntent(latestSchemaVersion)).toBe(true)
    db = new Database(databasePath)
    expect(db.prepare("SELECT COUNT(*) AS count FROM matches").get())
      .toEqual({ count: 1 })
    expect(manager().list().some((backup) => backup.reason === "pre-restore"))
      .toBe(true)
  })

  it("rejects a changed backup and path traversal without touching the active database", () => {
    const selected = manager().create(db as never, "manual")
    const original = readFileSync(databasePath)
    appendFileSync(path.join(backupDir, selected.fileName), "changed")
    expect(() => manager().prepareRestore(db as never, selected.fileName))
      .toThrow("Backup")
    expect(() => manager().delete("../stats.db")).toThrow("Invalid backup path")
    expect(readFileSync(databasePath)).toEqual(original)
  })
})
