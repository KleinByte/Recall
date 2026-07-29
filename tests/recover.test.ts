import { beforeEach, describe, expect, it } from "vitest"
import path from "node:path"
import os from "node:os"
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from "node:fs"
import {
  isDatabaseCorruptionError,
  openWithRecovery,
} from "../electron/main/database/recover.js"

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "recall-recover-test-"))
  file = path.join(dir, "stats.db")
})

const damagedFiles = () =>
  readdirSync(dir).filter((name) => name.includes(".damaged-"))

describe("openWithRecovery", () => {
  it("opens a healthy database untouched", () => {
    writeFileSync(file, "pretend database")

    const result = openWithRecovery(file, () => "opened")

    expect(result).toBe("opened")
    expect(damagedFiles()).toEqual([])
    expect(existsSync(file)).toBe(true)
  })

  it("starts fresh when the database cannot be opened", () => {
    writeFileSync(file, "corrupt bytes")

    let attempt = 0
    const result = openWithRecovery(file, () => {
      attempt += 1
      if (attempt === 1) throw new Error("database disk image is malformed")
      return "opened"
    })

    expect(result).toBe("opened")
    expect(attempt).toBe(2)
  })

  it("keeps the damaged file rather than deleting it", () => {
    writeFileSync(file, "corrupt bytes")

    let attempt = 0
    openWithRecovery(file, () => {
      attempt += 1
      if (attempt === 1) throw new Error("database disk image is malformed")
      return "opened"
    })

    expect(damagedFiles()).toHaveLength(1)
    expect(existsSync(file)).toBe(false)
  })

  it("moves the write-ahead log aside with it", () => {
    // A stale log left behind would be replayed into the fresh database and
    // corrupt that one too.
    writeFileSync(file, "corrupt bytes")
    writeFileSync(`${file}-wal`, "log")
    writeFileSync(`${file}-shm`, "index")

    let attempt = 0
    openWithRecovery(file, () => {
      attempt += 1
      if (attempt === 1) throw new Error("database disk image is malformed")
      return "opened"
    })

    expect(existsSync(`${file}-wal`)).toBe(false)
    expect(existsSync(`${file}-shm`)).toBe(false)
    expect(damagedFiles()).toHaveLength(3)
  })

  it("gives up rather than looping when a fresh database also fails", () => {
    writeFileSync(file, "corrupt bytes")

    expect(() =>
      openWithRecovery(file, () => {
        throw new Error("disk is full")
      }),
    ).toThrow("disk is full")
  })

  it("does not discard history when the database is temporarily locked", () => {
    writeFileSync(file, "healthy history")
    const locked = Object.assign(new Error("database is locked"), {
      code: "SQLITE_BUSY",
    })

    expect(() => openWithRecovery(file, () => { throw locked })).toThrow(locked)
    expect(existsSync(file)).toBe(true)
    expect(damagedFiles()).toEqual([])
  })

  it("does not mistake a migration error for file corruption", () => {
    writeFileSync(file, "healthy history")

    expect(() =>
      openWithRecovery(file, () => {
        throw new Error("duplicate column name: grade")
      }),
    ).toThrow("duplicate column name")

    expect(existsSync(file)).toBe(true)
    expect(damagedFiles()).toEqual([])
  })

  it("only recognizes explicit SQLite corruption errors", () => {
    expect(isDatabaseCorruptionError({ code: "SQLITE_CORRUPT" })).toBe(true)
    expect(isDatabaseCorruptionError({ code: "SQLITE_NOTADB" })).toBe(true)
    expect(isDatabaseCorruptionError(new Error("database disk image is malformed"))).toBe(
      true,
    )
    expect(isDatabaseCorruptionError({ code: "SQLITE_BUSY" })).toBe(false)
    expect(isDatabaseCorruptionError(new Error("duplicate column name"))).toBe(false)
  })
})
