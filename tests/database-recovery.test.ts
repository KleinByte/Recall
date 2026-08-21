import Database from "better-sqlite3-node"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { openDatabaseWithRecovery } from "../electron/main/database/recovery.js"
import {
  latestSchemaVersion,
  migrations,
} from "../electron/main/database/migrations.js"

let root: string
let active: string
let backups: string

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "recall-recovery-test-"))
  active = path.join(root, "user-data", "stats.db")
  backups = path.join(root, "backups")
  mkdirSync(path.dirname(active), { recursive: true })
  mkdirSync(backups, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function createVersionOneDatabase(filePath: string, gameId: number) {
  const db = new Database(filePath)
  db.exec(migrations[0].up)
  db.pragma("user_version = 1")
  db.prepare(
    `INSERT INTO matches VALUES (
       ?, 'player', 450, 'ARAM', 'aram', 1, 1, 1200, 'v', 84, 1,
       10, 5, 15, 18, 12000, 20000, 10000, 5000, 1000, 1, 20, 3, 2,
       1, 0, 0, 0, 60, 5, 0, 0
     )`,
  ).run(gameId)
  db.close()
}

describe("database corruption recovery", () => {
  it("uses the newest working backup, migrates it, and preserves the corrupt generation", () => {
    writeFileSync(path.join(backups, "stats-daily-400.db"), "broken backup")
    const incompatible = path.join(backups, "stats-pre-update-300.db")
    const newer = new Database(incompatible)
    newer.pragma(`user_version = ${latestSchemaVersion + 1}`)
    newer.close()
    const working = path.join(backups, "stats-daily-200.db")
    createVersionOneDatabase(working, 42)

    const damaged = Buffer.from("not a sqlite database")
    writeFileSync(active, damaged)

    const result = openDatabaseWithRecovery(active, {
      backupDir: backups,
      DatabaseClass: Database as never,
      now: () => 500,
    })

    expect(result.recovery?.sourcePath).toBe(working)
    expect(result.database.pragma("user_version", { simple: true }))
      .toBe(latestSchemaVersion)
    expect(result.database.prepare("SELECT game_id AS gameId FROM matches").get())
      .toEqual({ gameId: 42 })
    result.database.close()

    const quarantine = result.recovery!.quarantinedPath
    expect(readFileSync(quarantine)).toEqual(damaged)
    expect(existsSync(active)).toBe(true)
  })

  it("does not replace a healthy database when a migration has a code defect", () => {
    createVersionOneDatabase(active, 7)
    const malformedMigration = new Database(active)
    malformedMigration.exec("ALTER TABLE matches ADD COLUMN grade TEXT")
    malformedMigration.close()
    createVersionOneDatabase(path.join(backups, "stats-daily-100.db"), 99)

    expect(() => openDatabaseWithRecovery(active, {
      backupDir: backups,
      DatabaseClass: Database as never,
      now: () => 500,
    })).toThrow("duplicate column name")

    const preserved = new Database(active, { readonly: true })
    expect(preserved.prepare("SELECT game_id AS gameId FROM matches").get())
      .toEqual({ gameId: 7 })
    preserved.close()
    expect(existsSync(`${active}.corrupt-500`)).toBe(false)
  })
})
