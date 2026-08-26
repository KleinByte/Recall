import Database from "better-sqlite3-node"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { restoreDatabaseFromSelectedBackup } from
  "../electron/main/database/recovery.js"
import { listRecoveryBackups } from
  "../electron/main/database/startup-recovery.js"
import { latestSchemaVersion } from "../electron/main/database/migrations.js"

const configuredRoot = process.env.RECALL_TEST_DATABASE_ROOT?.trim()
const root = configuredRoot
  ? path.resolve(configuredRoot, `run-${process.pid}`)
  : path.join(os.tmpdir(), `recall-docker-db-${process.pid}`)
const userData = path.join(root, "user-data")
const backupDir = path.join(root, "Recall Database Backups")
const activePath = path.join(userData, "stats.db")

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe("Docker-volume database recovery", () => {
  it("opens without v38, chooses a healthy backup, migrates it, and preserves v38", async () => {
    mkdirSync(userData, { recursive: true })
    mkdirSync(backupDir, { recursive: true })

    const active = new Database(activePath)
    active.pragma(`user_version = ${latestSchemaVersion + 1}`)
    active.exec("CREATE TABLE future_history (proof TEXT NOT NULL)")
    active.prepare("INSERT INTO future_history VALUES (?)").run("preserve-me")
    active.close()
    const originalBytes = readFileSync(activePath)

    const healthyPath = path.join(backupDir, "stats-1700000000000.db")
    const healthy = new Database(healthyPath)
    healthy.pragma("user_version = 0")
    healthy.close()
    writeFileSync(path.join(backupDir, "stats-1800000000000.db"), "damaged")

    const catalog = await listRecoveryBackups(
      backupDir,
      latestSchemaVersion,
      Database as never,
    )
    expect(catalog.map((entry) => entry.status)).toEqual(["restorable", "corrupt"])
    expect(catalog[0].fileName).toBe(path.basename(healthyPath))

    const restored = restoreDatabaseFromSelectedBackup(activePath, healthyPath, {
      backupDir,
      DatabaseClass: Database as never,
      now: () => 1_900_000_000_000,
    })
    restored.database.close()

    const reopened = new Database(activePath, { readonly: true })
    expect(reopened.pragma("quick_check", { simple: true })).toBe("ok")
    expect(reopened.pragma("user_version", { simple: true })).toBe(latestSchemaVersion)
    reopened.close()
    expect(existsSync(restored.recovery.quarantinedPath)).toBe(true)
    expect(readFileSync(restored.recovery.quarantinedPath)).toEqual(originalBytes)
  })
})
