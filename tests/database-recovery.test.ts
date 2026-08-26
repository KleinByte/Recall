import Database from "better-sqlite3-node"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DatabaseRecoveryExhaustedError,
  openDatabaseWithRecovery,
  recoverCorruptDatabase,
  restoreDatabaseFromSelectedBackup,
} from "../electron/main/database/recovery.js"
import { DatabaseStartupError } from "../electron/main/database/connection.js"
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

function makeMigrationShapeInvalid(filePath: string) {
  const db = new Database(filePath)
  db.exec("ALTER TABLE matches ADD COLUMN grade TEXT")
  db.close()
}

function writeManagedManifest(filePath: string, createdAt: number, sha256: string) {
  const inspected = new Database(filePath, { readonly: true })
  const schemaVersion = Number(inspected.pragma("user_version", { simple: true }))
  inspected.close()
  writeFileSync(`${filePath}.manifest.json`, JSON.stringify({
    format: "recall-managed-backup",
    manifestVersion: 2,
    fileName: path.basename(filePath),
    createdAt,
    reason: "daily",
    protection: { kind: "none" },
    appVersion: "test",
    releaseSequence: 1,
    sha256,
    schemaVersion,
    sizeBytes: statSync(filePath).size,
    matchCount: 1,
    integrity: "ok",
  }))
}

describe("database startup recovery", () => {
  it("migrates a user-selected backup and preserves the newer active generation", () => {
    const newer = new Database(active)
    newer.pragma(`user_version = ${latestSchemaVersion + 1}`)
    newer.close()
    const selected = path.join(backups, "chosen.db")
    createVersionOneDatabase(selected, 42)

    const result = restoreDatabaseFromSelectedBackup(active, selected, {
      DatabaseClass: Database as never,
      now: () => 500,
    })

    expect(result.recovery).toMatchObject({
      sourcePath: selected,
      sourceSchemaVersion: 1,
      targetSchemaVersion: latestSchemaVersion,
      triggerPhase: "compatibility",
    })
    expect(result.database.pragma("user_version", { simple: true }))
      .toBe(latestSchemaVersion)
    expect(result.database.prepare("SELECT game_id AS gameId FROM matches").get())
      .toEqual({ gameId: 42 })
    result.database.close()

    const original = new Database(result.recovery.quarantinedPath, { readonly: true })
    expect(original.pragma("user_version", { simple: true }))
      .toBe(latestSchemaVersion + 1)
    original.close()
    const immutableSource = new Database(selected, { readonly: true })
    expect(immutableSource.pragma(
      "user_version",
      { simple: true },
    )).toBe(1)
    immutableSource.close()
  })

  it("leaves the active generation untouched when a selected backup is too new", () => {
    const activeDb = new Database(active)
    activeDb.pragma(`user_version = ${latestSchemaVersion + 1}`)
    activeDb.close()
    const selected = path.join(backups, "chosen.db")
    const selectedDb = new Database(selected)
    selectedDb.pragma(`user_version = ${latestSchemaVersion + 1}`)
    selectedDb.close()
    const original = readFileSync(active)

    expect(() => restoreDatabaseFromSelectedBackup(active, selected, {
      DatabaseClass: Database as never,
      now: () => 500,
    })).toThrow("newer than this Recall build")

    expect(readFileSync(active)).toEqual(original)
    expect(readdirSync(path.dirname(active))).toEqual(["stats.db"])
  })

  it("uses the newest working backup, migrates it, and preserves the failed generation", () => {
    writeFileSync(path.join(backups, "stats-daily-400.db"), "broken backup")
    const incompatible = path.join(backups, "stats-pre-update-300.db")
    const newer = new Database(incompatible)
    newer.pragma(`user_version = ${latestSchemaVersion + 1}`)
    newer.close()
    const unmigratable = path.join(backups, "stats-pre-repair-250.db")
    createVersionOneDatabase(unmigratable, 25)
    makeMigrationShapeInvalid(unmigratable)
    const working = path.join(backups, "stats-daily-200.db")
    createVersionOneDatabase(working, 42)

    const damaged = Buffer.from("not a sqlite database")
    writeFileSync(active, damaged)
    const attempts: string[] = []

    const result = openDatabaseWithRecovery(active, {
      backupDir: backups,
      DatabaseClass: Database as never,
      now: () => 500,
      onAttempt: (attempt) => attempts.push(attempt.message),
    })

    expect(result.recovery).toMatchObject({
      sourcePath: working,
      sourceSchemaVersion: 1,
      targetSchemaVersion: latestSchemaVersion,
    })
    expect(result.recovery?.rejectedCandidates).toHaveLength(3)
    expect(attempts).toHaveLength(3)
    expect(result.database.pragma("user_version", { simple: true }))
      .toBe(latestSchemaVersion)
    expect(result.database.prepare("SELECT game_id AS gameId FROM matches").get())
      .toEqual({ gameId: 42 })
    result.database.close()

    const quarantine = result.recovery!.quarantinedPath
    expect(readFileSync(quarantine)).toEqual(damaged)
    expect(existsSync(active)).toBe(true)
    const immutableSource = new Database(working, { readonly: true })
    expect(immutableSource.pragma("user_version", { simple: true })).toBe(1)
    immutableSource.close()
    expect(readdirSync(path.dirname(active)).some((name) =>
      name.includes(".recovery-") && !name.includes(".recovery-original-")))
      .toBe(false)
  })

  it("recovers when the active database cannot complete its migrations", () => {
    createVersionOneDatabase(active, 7)
    makeMigrationShapeInvalid(active)
    const working = path.join(backups, "stats-daily-100.db")
    createVersionOneDatabase(working, 99)

    const result = openDatabaseWithRecovery(active, {
      backupDir: backups,
      DatabaseClass: Database as never,
      now: () => 500,
      onAttempt: () => undefined,
    })

    expect(result.recovery?.sourcePath).toBe(working)
    expect(result.recovery?.triggerPhase).toBe("migration")
    expect(result.recovery?.rejectedCandidates).toHaveLength(1)
    expect(result.database.prepare("SELECT game_id AS gameId FROM matches").get())
      .toEqual({ gameId: 99 })
    result.database.close()

    const original = new Database(result.recovery!.quarantinedPath, { readonly: true })
    expect(original.prepare("SELECT game_id AS gameId FROM matches").get())
      .toEqual({ gameId: 7 })
    original.close()
  })

  it("rejects a tampered managed backup before trying an older backup", () => {
    const tampered = path.join(backups, "stats-daily-300.db")
    createVersionOneDatabase(tampered, 30)
    writeManagedManifest(tampered, 300, "0".repeat(64))
    const working = path.join(backups, "stats-daily-200.db")
    createVersionOneDatabase(working, 20)
    const digest = createHash("sha256").update(readFileSync(working)).digest("hex")
    writeManagedManifest(working, 200, digest)
    writeFileSync(active, "broken active")

    const result = openDatabaseWithRecovery(active, {
      backupDir: backups,
      DatabaseClass: Database as never,
      now: () => 500,
      onAttempt: () => undefined,
    })

    expect(result.recovery?.sourcePath).toBe(working)
    expect(result.recovery?.rejectedCandidates).toEqual([
      expect.objectContaining({
        sourcePath: tampered,
        phase: "catalog",
        message: "backup_hash_mismatch",
      }),
    ])
    result.database.close()
  })

  it("leaves the active generation untouched when no backup can be migrated", () => {
    const damaged = Buffer.from("broken active")
    writeFileSync(active, damaged)
    const brokenBackup = path.join(backups, "stats-daily-100.db")
    writeFileSync(brokenBackup, "broken backup")

    let failure: unknown
    try {
      openDatabaseWithRecovery(active, {
        backupDir: backups,
        DatabaseClass: Database as never,
        now: () => 500,
        onAttempt: () => undefined,
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(DatabaseRecoveryExhaustedError)
    expect((failure as DatabaseRecoveryExhaustedError).attempts).toEqual([
      expect.objectContaining({ sourcePath: brokenBackup }),
    ])
    expect(readFileSync(active)).toEqual(damaged)
    expect(readdirSync(path.dirname(active))).toEqual(["stats.db"])
  })

  it("does not replace data for lock or other environmental failures", () => {
    const original = Buffer.from("active bytes remain")
    writeFileSync(active, original)
    createVersionOneDatabase(path.join(backups, "stats-daily-100.db"), 10)
    const onAttempt = vi.fn()

    class BusyDatabase {
      open = true

      pragma() {
        throw Object.assign(new Error("database is busy"), { code: "SQLITE_BUSY" })
      }

      close() {
        this.open = false
      }
    }

    let failure: unknown
    try {
      openDatabaseWithRecovery(active, {
        backupDir: backups,
        DatabaseClass: BusyDatabase as never,
        onAttempt,
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(DatabaseStartupError)
    expect((failure as DatabaseStartupError).recoverable).toBe(false)
    expect((failure as DatabaseStartupError).code).toBe("SQLITE_BUSY")
    expect(onAttempt).not.toHaveBeenCalled()
    expect(readFileSync(active)).toEqual(original)
  })

  it("quarantines the complete SQLite generation, including sidecars", () => {
    const damaged = Buffer.from("broken active")
    const wal = Buffer.from("preserved wal")
    const shm = Buffer.from("preserved shm")
    writeFileSync(active, damaged)
    writeFileSync(`${active}-wal`, wal)
    writeFileSync(`${active}-shm`, shm)
    createVersionOneDatabase(path.join(backups, "stats-daily-100.db"), 10)

    const recovery = recoverCorruptDatabase(active, backups, {
      DatabaseClass: Database as never,
      now: () => 500,
      onAttempt: () => undefined,
    })!

    expect(readFileSync(recovery.quarantinedPath)).toEqual(damaged)
    expect(readFileSync(`${recovery.quarantinedPath}-wal`)).toEqual(wal)
    expect(readFileSync(`${recovery.quarantinedPath}-shm`)).toEqual(shm)
    const recovered = new Database(active, { readonly: true })
    expect(recovered.pragma("user_version", { simple: true }))
      .toBe(latestSchemaVersion)
    recovered.close()
  })

  it("rolls promotion back when the staged database cannot be published", () => {
    const damaged = Buffer.from("broken active")
    writeFileSync(active, damaged)
    createVersionOneDatabase(path.join(backups, "stats-daily-100.db"), 10)

    expect(() => openDatabaseWithRecovery(active, {
      backupDir: backups,
      DatabaseClass: Database as never,
      now: () => 500,
      onAttempt: () => undefined,
      renameFile: (source, destination) => {
        if (source.includes(`.recovery-${process.pid}-`) && destination === active) {
          throw new Error("promotion blocked")
        }
        renameSync(source, destination)
      },
    })).toThrow("verified backup could not replace")

    expect(readFileSync(active)).toEqual(damaged)
    expect(readdirSync(path.dirname(active))).toEqual(["stats.db"])
  })

})
