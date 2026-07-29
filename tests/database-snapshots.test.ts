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
import {
  createUpdateSnapshot,
  restoreLatestUpdateSnapshot,
} from "../electron/main/database/snapshots.js"

let root: string
let active: string
let backups: string

const options = {
  DatabaseClass: Database as never,
  now: () => 123,
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "recall-snapshot-test-"))
  active = path.join(root, "user-data", "stats.db")
  backups = path.join(root, "update-backups")
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function seedDatabase(filePath = active) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const db = new Database(filePath)
  db.pragma("journal_mode = WAL")
  db.exec("CREATE TABLE history (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
  db.prepare("INSERT INTO history VALUES (?, ?)").run(1, "kept")
  return db
}

describe("database update snapshots", () => {
  it("checkpoints and verifies a self-contained snapshot before install", () => {
    const db = seedDatabase()

    const snapshot = createUpdateSnapshot(db, active, backups, options)
    db.close()

    expect(snapshot).toBe(path.join(backups, "stats-123.db"))
    const copy = new Database(snapshot, { readonly: true })
    expect(copy.pragma("integrity_check", { simple: true })).toBe("ok")
    expect(copy.prepare("SELECT value FROM history WHERE id = 1").get()).toEqual({
      value: "kept",
    })
    copy.close()
  })

  it("restores the latest verified snapshot when userData is missing", () => {
    const db = seedDatabase()
    const snapshot = createUpdateSnapshot(db, active, backups, options)
    db.close()
    rmSync(path.dirname(active), { recursive: true, force: true })

    const restored = restoreLatestUpdateSnapshot(active, backups, options)

    expect(restored).toBe(snapshot)
    const recovered = new Database(active, { readonly: true })
    expect(recovered.prepare("SELECT count(*) AS n FROM history").get()).toEqual({
      n: 1,
    })
    recovered.close()
  })

  it("replaces only a zero-byte setup placeholder", () => {
    const db = seedDatabase()
    createUpdateSnapshot(db, active, backups, options)
    db.close()
    writeFileSync(active, "")

    expect(restoreLatestUpdateSnapshot(active, backups, options)).toBeDefined()
    const recovered = new Database(active, { readonly: true })
    expect(recovered.pragma("integrity_check", { simple: true })).toBe("ok")
    recovered.close()
  })

  it("never overwrites an existing database with content", () => {
    const db = seedDatabase()
    createUpdateSnapshot(db, active, backups, options)
    db.close()
    writeFileSync(active, "do not replace")
    const original = readFileSync(active)

    expect(restoreLatestUpdateSnapshot(active, backups, options)).toBeUndefined()
    expect(readFileSync(active)).toEqual(original)
  })

  it("does not restore an invalid snapshot", () => {
    mkdirSync(backups, { recursive: true })
    writeFileSync(path.join(backups, "stats-999.db"), "not sqlite")

    expect(restoreLatestUpdateSnapshot(active, backups, options)).toBeUndefined()
    expect(existsSync(active)).toBe(false)
  })
})
