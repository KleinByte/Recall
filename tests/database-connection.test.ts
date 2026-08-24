// Production better-sqlite3 is rebuilt for Electron; tests use the matching
// Node ABI package while exercising the same connection implementation.
import Database from "better-sqlite3-node"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  DatabaseStartupError,
  openDatabase,
} from "../electron/main/database/connection.js"
import {
  latestSchemaVersion,
  migrations,
} from "../electron/main/database/migrations.js"

let dir: string
let file: string

const options = {
  DatabaseClass: Database as never,
  now: () => 123,
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "recall-connection-test-"))
  file = path.join(dir, "stats.db")
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function createVersionOneDatabase() {
  const db = new Database(file)
  db.exec(migrations[0].up)
  db.pragma("user_version = 1")
  db.prepare(
    `INSERT INTO matches VALUES (
       1, 'player', 450, 'ARAM', 'aram', 1, 1, 1200, 'v', 84, 1,
       10, 5, 15, 18, 12000, 20000, 10000, 5000, 1000, 1, 20, 3, 2,
       1, 0, 0, 0, 60, 5, 0, 0
     )`,
  ).run()
  db.close()
}

describe("openDatabase", () => {
  it("creates a new database using valid pragma syntax", () => {
    const db = openDatabase(file, options)

    expect(db.pragma("busy_timeout", { simple: true })).toBe(10_000)
    expect(db.pragma("user_version", { simple: true })).toBe(latestSchemaVersion)
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok")
    db.close()
  })

  it("backs up and upgrades an existing database without losing history", () => {
    createVersionOneDatabase()

    const db = openDatabase(file, options)

    expect(db.pragma("user_version", { simple: true })).toBe(latestSchemaVersion)
    expect(db.prepare("SELECT count(*) AS n FROM matches").get()).toEqual({ n: 1 })
    db.close()

    const backup = `${file}.pre-migration-v1-123.bak`
    expect(existsSync(backup)).toBe(true)
    const backupDb = new Database(backup, { readonly: true })
    expect(backupDb.pragma("integrity_check", { simple: true })).toBe("ok")
    expect(backupDb.pragma("user_version", { simple: true })).toBe(1)
    expect(backupDb.prepare("SELECT count(*) AS n FROM matches").get()).toEqual({
      n: 1,
    })
    backupDb.close()
  })

  it("leaves an existing database untouched when a migration fails", () => {
    createVersionOneDatabase()
    const db = new Database(file)
    db.exec("ALTER TABLE matches ADD COLUMN grade TEXT")
    db.close()

    let failure: unknown
    try {
      openDatabase(file, options)
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(DatabaseStartupError)
    expect(failure).toMatchObject({
      phase: "migration",
      recoverable: true,
    })
    expect((failure as Error).message).toContain("duplicate column name")

    expect(existsSync(file)).toBe(true)
    expect(readdirSync(dir).some((name) => name.includes(".damaged-"))).toBe(false)
    const preserved = new Database(file, { readonly: true })
    expect(preserved.pragma("user_version", { simple: true })).toBe(1)
    expect(preserved.prepare("SELECT count(*) AS n FROM matches").get()).toEqual({
      n: 1,
    })
    preserved.close()
  })

  it("does not open a database created by a newer Recall schema", () => {
    const db = new Database(file)
    db.pragma(`user_version = ${latestSchemaVersion + 1}`)
    db.close()

    let failure: unknown
    try {
      openDatabase(file, options)
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(DatabaseStartupError)
    expect(failure).toMatchObject({
      phase: "compatibility",
      recoverable: false,
    })
    expect((failure as Error).message).toContain("newer than this Recall build")
    expect(existsSync(file)).toBe(true)
  })

  it("never replaces or quarantines a corrupt existing database", () => {
    const original = Buffer.from("not a sqlite database")
    writeFileSync(file, original)

    let failure: unknown
    try {
      openDatabase(file, options)
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(DatabaseStartupError)
    expect(failure).toMatchObject({ recoverable: true })

    expect(readFileSync(file)).toEqual(original)
    expect(readdirSync(dir)).toEqual(["stats.db"])
  })

  it("can migrate a self-contained staging database without WAL sidecars", () => {
    createVersionOneDatabase()

    const db = openDatabase(file, { ...options, journalMode: "DELETE" })

    expect(db.pragma("journal_mode", { simple: true })).toBe("delete")
    expect(db.pragma("user_version", { simple: true })).toBe(latestSchemaVersion)
    db.close()
    expect(existsSync(`${file}-wal`)).toBe(false)
    expect(existsSync(`${file}-shm`)).toBe(false)
  })

  it("removes a partial brand-new database when setup fails", () => {
    class FailingDatabase {
      open = true

      constructor(target: string) {
        writeFileSync(target, "")
      }

      pragma() {
        throw new Error("near 10_000: syntax error")
      }

      close() {
        this.open = false
      }
    }

    expect(() =>
      openDatabase(file, { DatabaseClass: FailingDatabase as never }),
    ).toThrow("near 10_000")
    expect(existsSync(file)).toBe(false)
  })

  it("also removes a zero-byte setup placeholder when setup fails", () => {
    writeFileSync(file, "")

    class FailingDatabase {
      open = true

      pragma() {
        throw new Error("setup failed")
      }

      close() {
        this.open = false
      }
    }

    expect(() =>
      openDatabase(file, { DatabaseClass: FailingDatabase as never }),
    ).toThrow("setup failed")
    expect(existsSync(file)).toBe(false)
  })
})
