import Database from "better-sqlite3-node"
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
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
import { GradePersistenceRepository } from
  "../electron/main/database/grade-persistence-repo.js"
import {
  decodeStoredJsonBody,
  gzipJsonTextV1,
  type StoredJsonBodyRow,
} from "../electron/main/database/json-body-codec.js"
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

type ManagerOptions = NonNullable<ConstructorParameters<typeof BackupManager>[2]>

function inspectBackup(filePath: string) {
  const backup = new Database(filePath, { readonly: true, fileMustExist: true })
  try {
    const integrity = backup.pragma("quick_check", { simple: true })
    if (integrity !== "ok") throw new Error("Backup failed SQLite integrity verification")
    return Promise.resolve({
      schemaVersion: backup.pragma("user_version", { simple: true }) as number,
      matchCount: (backup.prepare("SELECT COUNT(*) AS count FROM matches").get() as {
        count: number
      }).count,
    })
  } finally {
    backup.close()
  }
}

function manager(options: ManagerOptions = {}) {
  return new BackupManager(databasePath, backupDir, {
    DatabaseClass: Database as never,
    now: () => 1_700_000_000_000,
    inspectAsync: inspectBackup,
    ...options,
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

  it("lists backup metadata without reading every backup body", () => {
    const selected = manager().create(db as never, "manual")
    const listings = manager({
      hashFile: () => {
        throw new Error("routine listings must not hash backup files")
      },
    }).list()

    expect(listings).toEqual([selected])
  })

  it("creates and verifies backups asynchronously without leaving SQLite sidecars", async () => {
    const selected = await manager().createAsync(db as never, "manual")
    const backupPath = path.join(backupDir, selected.fileName)

    expect(selected).toMatchObject({ integrity: "ok", matchCount: 1 })
    expect(existsSync(backupPath)).toBe(true)
    expect(existsSync(`${backupPath}-wal`)).toBe(false)
    expect(existsSync(`${backupPath}-shm`)).toBe(false)
  })

  it("previews retention and applies it only after creating a cleanup anchor", async () => {
    let timestamp = 1_700_000_000_000
    const backups = manager({ now: () => timestamp++ })

    await backups.createAsync(db as never, "daily")
    await backups.createAsync(db as never, "daily")
    await backups.createAsync(db as never, "daily")

    expect(backups.list()).toHaveLength(3)
    expect(backups.previewCleanup().items).toHaveLength(2)

    const result = await backups.applyCleanupAsync(db as never)
    expect(result.deleted).toBe(2)
    expect(backups.list().map((backup) => backup.reason).sort()).toEqual([
      "daily",
      "pre-cleanup",
    ])
  })

  it("creates a pre-restore generation and restores after restart", async () => {
    const live = gzipJsonTextV1('{"captured":"召唤师"}')
    db.prepare(`
      INSERT INTO live_game_snapshots
        (game_id, puuid, game_time_ms, captured_at, reason,
         has_active_player_stat_runes, snapshot_encoding,
         snapshot_uncompressed_bytes, snapshot_compressed_bytes,
         snapshot_sha256, snapshot_payload)
      VALUES (1, 'test-puuid', 1000, 2000, 'first', 0, ?, ?, ?, ?, ?)
    `).run(live.encoding, live.uncompressedBytes, live.compressedBytes,
      live.sha256, live.payload)
    new GradePersistenceRepository(db).registerCalibration({
      calibrationId: "backup-calibration",
      calibrationHash: "a".repeat(64),
      referencePopulation: { mode: "aram" },
      sampleCount: 1,
      snapshot: { frozen: true },
      createdAt: 3000,
    })
    const selected = await manager().createAsync(db as never, "manual")
    db.prepare("DELETE FROM matches").run()
    await manager().prepareRestoreAsync(db as never, selected.fileName)
    db.close()
    expect(manager().applyRestoreIntent(latestSchemaVersion)).toBe(true)
    db = new Database(databasePath)
    expect(db.prepare("SELECT COUNT(*) AS count FROM matches").get())
      .toEqual({ count: 1 })
    const restoredLive = db.prepare(`
      SELECT snapshot_encoding AS snapshotEncoding,
             snapshot_uncompressed_bytes AS snapshotUncompressedBytes,
             snapshot_compressed_bytes AS snapshotCompressedBytes,
             snapshot_sha256 AS snapshotSha256,
             snapshot_payload AS snapshotPayload,
             captured_at AS capturedAt
      FROM live_game_snapshots
    `).get() as StoredJsonBodyRow & { capturedAt: number }
    const restoredCalibration = db.prepare(`
      SELECT snapshot_encoding AS snapshotEncoding,
             snapshot_uncompressed_bytes AS snapshotUncompressedBytes,
             snapshot_compressed_bytes AS snapshotCompressedBytes,
             snapshot_sha256 AS snapshotSha256,
             snapshot_payload AS snapshotPayload,
             created_at AS createdAt
      FROM grade_calibration_snapshots
      WHERE calibration_id = 'backup-calibration'
    `).get() as StoredJsonBodyRow & { createdAt: number }
    expect(decodeStoredJsonBody(restoredLive).text).toBe('{"captured":"召唤师"}')
    expect(restoredLive.capturedAt).toBe(2000)
    expect(decodeStoredJsonBody(restoredCalibration).value).toEqual({ frozen: true })
    expect(restoredCalibration.createdAt).toBe(3000)
    expect(manager().list().some((backup) => backup.reason === "pre-restore"))
      .toBe(true)
  })

  it("rejects a changed backup and path traversal without touching the active database", async () => {
    const selected = await manager().createAsync(db as never, "manual")
    const original = readFileSync(databasePath)
    appendFileSync(path.join(backupDir, selected.fileName), "changed")
    await expect(manager().prepareRestoreAsync(db as never, selected.fileName))
      .rejects.toThrow("Backup")
    expect(() => manager().delete("../stats.db")).toThrow("Invalid backup path")
    expect(readFileSync(databasePath)).toEqual(original)
  })

  it("previews and removes only allowlisted stale artifacts", async () => {
    const now = 1_700_000_000_000
    const backups = manager({ now: () => now })
    await backups.createAsync(db as never, "manual")
    const oldTime = new Date(now - 40 * 24 * 60 * 60 * 1_000)
    const staleTemp = path.join(backupDir, "stats-daily-1.db.tmp-99")
    const orphanSidecar = path.join(backupDir, "stats-daily-2.db-wal")
    const unknownDatabase = path.join(backupDir, "stats-legacy-3.db")
    writeFileSync(staleTemp, "temporary")
    writeFileSync(orphanSidecar, "sidecar")
    writeFileSync(unknownDatabase, "unknown but retained")
    for (const filePath of [staleTemp, orphanSidecar, unknownDatabase]) {
      utimesSync(filePath, oldTime, oldTime)
    }
    const olderRecovery = `${databasePath}.recovery-original-${now - 50 * 24 * 60 * 60 * 1_000}`
    const newestRecovery = `${databasePath}.recovery-original-${now - 40 * 24 * 60 * 60 * 1_000}`
    writeFileSync(olderRecovery, "older")
    writeFileSync(newestRecovery, "newest")

    const preview = backups.previewCleanup()
    expect(preview.items.map((item) => item.reason).sort()).toEqual([
      "old_recovery_original",
      "orphan_sidecar",
      "stale_temporary",
    ])
    expect(preview.items.some((item) => item.fileName === path.basename(unknownDatabase)))
      .toBe(false)

    await backups.applyCleanupAsync(
      db as never,
      preview.items.map((item) => item.id),
    )
    expect(existsSync(staleTemp)).toBe(false)
    expect(existsSync(orphanSidecar)).toBe(false)
    expect(existsSync(olderRecovery)).toBe(false)
    expect(existsSync(newestRecovery)).toBe(true)
    expect(existsSync(unknownDatabase)).toBe(true)
  })
})
