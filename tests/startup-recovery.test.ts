import Database from "better-sqlite3-node"
import { createHash } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { DatabaseStartupError } from "../electron/main/database/connection.js"
import {
  classifyDatabaseFailure,
  listRecoveryBackups,
  recoveryStartupState,
  resolveRecoveryBackup,
} from "../electron/main/database/startup-recovery.js"

const roots: string[] = []

function temporaryRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "recall-startup-recovery-"))
  roots.push(root)
  return root
}

function backup(
  directory: string,
  timestamp: number,
  schemaVersion: number,
  matches: number,
) {
  mkdirSync(directory, { recursive: true })
  const fileName = `stats-daily-${timestamp}.db`
  const filePath = path.join(directory, fileName)
  const database = new Database(filePath)
  database.pragma(`user_version = ${schemaVersion}`)
  database.exec("CREATE TABLE matches (id INTEGER PRIMARY KEY)")
  const insert = database.prepare("INSERT INTO matches DEFAULT VALUES")
  for (let index = 0; index < matches; index += 1) insert.run()
  database.close()
  const sha256 = createHash("sha256").update(readFileSync(filePath)).digest("hex")
  writeFileSync(`${filePath}.manifest.json`, JSON.stringify({
    format: "recall-managed-backup",
    manifestVersion: 2,
    fileName,
    createdAt: timestamp,
    sizeBytes: statSync(filePath).size,
    sha256,
  }))
  return fileName
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("database-less startup recovery", () => {
  it("puts the newest verified compatible backup first and labels rejected files", async () => {
    const directory = path.join(temporaryRoot(), "backups")
    const compatible = backup(directory, 1_700_000_000_000, 37, 3)
    backup(directory, 1_800_000_000_000, 38, 9)
    writeFileSync(path.join(directory, "stats-daily-1900000000000.db"), "not sqlite")

    const entries = await listRecoveryBackups(directory, 37, Database as never)

    expect(entries[0]).toMatchObject({
      fileName: compatible,
      status: "restorable",
      schemaVersion: 37,
      matchCount: 3,
    })
    expect(entries.map((entry) => entry.status)).toEqual([
      "restorable",
      "corrupt",
      "newer_schema",
    ])
  })

  it("classifies compatibility, corruption, and environmental failures", () => {
    expect(classifyDatabaseFailure(new DatabaseStartupError(
      "compatibility", true, new Error("newer schema"),
    ))).toBe("newer_schema")
    expect(classifyDatabaseFailure(new DatabaseStartupError(
      "preflight-integrity", true,
      Object.assign(new Error("malformed"), { code: "SQLITE_CORRUPT" }),
    ))).toBe("corrupt")
    expect(classifyDatabaseFailure(new DatabaseStartupError(
      "open", true,
      Object.assign(new Error("locked"), { code: "SQLITE_BUSY" }),
    ))).toBe("permission_or_lock")
    expect(recoveryStartupState(new Error("boom"), "C:\\Recall\\stats.db", 37))
      .toMatchObject({ kind: "recovery_required", reason: "unknown" })
  })

  it("confines managed backup selections to the backup directory", () => {
    const directory = temporaryRoot()
    expect(resolveRecoveryBackup(directory, "stats-daily-1.db"))
      .toBe(path.join(directory, "stats-daily-1.db"))
    expect(() => resolveRecoveryBackup(directory, "..\\stats.db"))
      .toThrow("Invalid backup selection")
  })
})
