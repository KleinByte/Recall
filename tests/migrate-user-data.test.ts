import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { migrateLegacyUserData } from "../electron/main/migrate-user-data.js"

let root: string
let legacyDir: string
let currentDir: string

beforeEach(() => {
  root = path.join(tmpdir(), `recall-migration-${Date.now()}-${Math.random()}`)
  legacyDir = path.join(root, "lol-challenge-tracker")
  currentDir = path.join(root, "recall")
  mkdirSync(currentDir, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const seedLegacy = () => {
  mkdirSync(legacyDir, { recursive: true })
  writeFileSync(path.join(legacyDir, "stats.db"), "recorded-history")
  writeFileSync(path.join(legacyDir, "config.json"), '{"settings":"kept"}')
}

describe("migrateLegacyUserData", () => {
  it("moves recorded history from the previous app name", () => {
    seedLegacy()

    const result = migrateLegacyUserData(legacyDir, currentDir)

    expect(result.migrated).toEqual(["stats.db", "config.json"])
    expect(readFileSync(path.join(currentDir, "stats.db"), "utf8")).toBe(
      "recorded-history",
    )
    expect(readFileSync(path.join(currentDir, "config.json"), "utf8")).toBe(
      '{"settings":"kept"}',
    )
  })

  it("leaves the original files in place so nothing is lost if it fails later", () => {
    seedLegacy()

    migrateLegacyUserData(legacyDir, currentDir)

    expect(existsSync(path.join(legacyDir, "stats.db"))).toBe(true)
  })

  it("never overwrites data already recorded under the new name", () => {
    seedLegacy()
    writeFileSync(path.join(currentDir, "stats.db"), "newer-history")

    const result = migrateLegacyUserData(legacyDir, currentDir)

    expect(result.migrated).toEqual(["config.json"])
    expect(readFileSync(path.join(currentDir, "stats.db"), "utf8")).toBe(
      "newer-history",
    )
  })

  it("never attaches a legacy WAL to an existing current database", () => {
    seedLegacy()
    writeFileSync(path.join(legacyDir, "stats.db-wal"), "legacy-wal")
    writeFileSync(path.join(legacyDir, "stats.db-shm"), "legacy-shm")
    writeFileSync(path.join(currentDir, "stats.db"), "current-database")

    const result = migrateLegacyUserData(legacyDir, currentDir)

    expect(result.migrated).toEqual(["config.json"])
    expect(existsSync(path.join(currentDir, "stats.db-wal"))).toBe(false)
    expect(existsSync(path.join(currentDir, "stats.db-shm"))).toBe(false)
    expect(readFileSync(path.join(currentDir, "stats.db"), "utf8")).toBe(
      "current-database",
    )
  })

  it("does nothing when there is no previous installation", () => {
    const result = migrateLegacyUserData(legacyDir, currentDir)

    expect(result.migrated).toEqual([])
  })

  it("also carries across the write-ahead log files", () => {
    seedLegacy()
    writeFileSync(path.join(legacyDir, "stats.db-wal"), "wal")

    const result = migrateLegacyUserData(legacyDir, currentDir)

    expect(result.migrated).toContain("stats.db-wal")
  })

  it("replaces a zero-byte setup placeholder with valid previous data", () => {
    seedLegacy()
    writeFileSync(path.join(currentDir, "stats.db"), "")

    const result = migrateLegacyUserData(legacyDir, currentDir)

    expect(result.migrated).toContain("stats.db")
    expect(readFileSync(path.join(currentDir, "stats.db"), "utf8")).toBe(
      "recorded-history",
    )
  })

  it("ignores a zero-byte previous database", () => {
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(path.join(legacyDir, "stats.db"), "")

    const result = migrateLegacyUserData(legacyDir, currentDir)

    expect(result.migrated).toEqual([])
    expect(existsSync(path.join(currentDir, "stats.db"))).toBe(false)
  })
})
