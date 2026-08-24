import Database from "better-sqlite3"
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import {
  mkdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import path from "node:path"
import { Worker } from "node:worker_threads"
import {
  BACKUP_RELEASE_SEQUENCE,
  proposeBackupRetention,
  protectionForReason,
  type ManagedBackupManifestLegacy,
  type ManagedBackupReason,
} from "./retention-service.js"

export type BackupReason = ManagedBackupReason

export type BackupManifest = Omit<ManagedBackupManifestLegacy, "integrity"> & {
  integrity: "ok" | "failed" | "unknown"
}

interface BackupDetails {
  schemaVersion: number
  matchCount: number
}

interface RestoreIntent {
  sourcePath: string
  databasePath: string
  expectedHash: string
}

const MANIFEST_SUFFIX = ".manifest.json"
const RESTORE_INTENT = "restore-intent.json"

export interface RecoveryBackupCandidate {
  fileName: string
  filePath: string
  createdAt: number
  schemaVersion?: number
  managed: boolean
}

export interface RecoveryBackupRejection {
  filePath: string
  reason: string
}

export interface RecoveryBackupCatalog {
  candidates: RecoveryBackupCandidate[]
  rejected: RecoveryBackupRejection[]
}

function sha256(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

function parseManagedManifest(filePath: string): BackupManifest | undefined {
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>
    if (raw.format !== "recall-managed-backup" || raw.manifestVersion !== 2 ||
        typeof raw.fileName !== "string" || typeof raw.createdAt !== "number" ||
        !Number.isFinite(raw.createdAt) || typeof raw.reason !== "string" ||
        typeof raw.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.sha256) ||
        typeof raw.schemaVersion !== "number" || !Number.isInteger(raw.schemaVersion) ||
        raw.schemaVersion < 0 || typeof raw.sizeBytes !== "number" ||
        !Number.isInteger(raw.sizeBytes) || raw.sizeBytes < 0 ||
        typeof raw.matchCount !== "number" || !Number.isInteger(raw.matchCount) ||
        raw.matchCount < 0 || raw.integrity !== "ok") {
      return undefined
    }
    return raw as unknown as BackupManifest
  } catch {
    return undefined
  }
}

function timestampFromBackupName(fileName: string): number {
  const match = /-(\d+)\.db$/.exec(fileName)
  return match ? Number(match[1]) : 0
}

/**
 * Builds the startup recovery catalog. Managed backups must match their
 * immutable manifest and SHA-256; legacy update snapshots remain eligible for
 * the same full SQLite and migration rehearsal performed by recovery.
 */
export function catalogRecoveryBackups(backupDir: string): RecoveryBackupCatalog {
  const candidates: RecoveryBackupCandidate[] = []
  const rejected: RecoveryBackupRejection[] = []
  if (!existsSync(backupDir)) return { candidates, rejected }

  let names: string[]
  try {
    names = readdirSync(backupDir)
  } catch (error) {
    rejected.push({
      filePath: backupDir,
      reason: `backup_catalog_unreadable:${error instanceof Error ? error.message : String(error)}`,
    })
    return { candidates, rejected }
  }

  for (const fileName of names.filter((name) =>
    /^stats-(?:\d+|[a-z-]+-\d+)\.db$/.test(name))) {
    const filePath = resolvedChild(backupDir, fileName)
    try {
      const fileStats = statSync(filePath)
      if (!fileStats.isFile()) {
        rejected.push({ filePath, reason: "backup_not_regular_file" })
        continue
      }

      const manifestPath = `${filePath}${MANIFEST_SUFFIX}`
      if (!existsSync(manifestPath)) {
        candidates.push({
          fileName,
          filePath,
          createdAt: timestampFromBackupName(fileName) || fileStats.mtimeMs,
          managed: false,
        })
        continue
      }

      const manifest = parseManagedManifest(manifestPath)
      if (!manifest || manifest.fileName !== fileName) {
        rejected.push({ filePath, reason: "backup_manifest_invalid" })
        continue
      }
      if (manifest.sizeBytes !== fileStats.size) {
        rejected.push({ filePath, reason: "backup_size_mismatch" })
        continue
      }
      if (sha256(filePath) !== manifest.sha256) {
        rejected.push({ filePath, reason: "backup_hash_mismatch" })
        continue
      }
      candidates.push({
        fileName,
        filePath,
        createdAt: manifest.createdAt,
        schemaVersion: manifest.schemaVersion,
        managed: true,
      })
    } catch (error) {
      rejected.push({
        filePath,
        reason: `backup_inspection_failed:${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  candidates.sort((left, right) => right.createdAt - left.createdAt ||
    right.fileName.localeCompare(left.fileName))
  return { candidates, rejected }
}

function sha256Async(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    const input = createReadStream(filePath)
    input.on("data", (chunk) => hash.update(chunk))
    input.once("error", reject)
    input.once("end", () => resolve(hash.digest("hex")))
  })
}

function inspect(filePath: string, DatabaseClass: typeof Database): BackupDetails {
  const db = new DatabaseClass(filePath, { readonly: true, fileMustExist: true })
  try {
    const integrity = db.pragma("quick_check", { simple: true })
    if (integrity !== "ok") throw new Error("Backup failed SQLite integrity verification")
    return {
      schemaVersion: db.pragma("user_version", { simple: true }) as number,
      matchCount: (
        db.prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='matches'",
        ).get() as { count: number }
      ).count
        ? (db.prepare("SELECT COUNT(*) AS count FROM matches").get() as { count: number }).count
        : 0,
    }
  } finally {
    db.close()
    rmSync(`${filePath}-wal`, { force: true })
    rmSync(`${filePath}-shm`, { force: true })
  }
}

const inspectWorkerSource = String.raw`
  const { parentPort, workerData } = require("node:worker_threads")
  const { rmSync } = require("node:fs")
  try {
    const Database = require(workerData.databaseModulePath)
    const db = new Database(workerData.filePath, { readonly: true, fileMustExist: true })
    try {
      const integrity = db.pragma("quick_check", { simple: true })
      if (integrity !== "ok") throw new Error("Backup failed SQLite integrity verification")
      const hasMatches = db.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='matches'",
      ).get().count
      parentPort.postMessage({
        schemaVersion: db.pragma("user_version", { simple: true }),
        matchCount: hasMatches
          ? db.prepare("SELECT COUNT(*) AS count FROM matches").get().count
          : 0,
      })
    } finally {
      db.close()
      rmSync(workerData.filePath + "-wal", { force: true })
      rmSync(workerData.filePath + "-shm", { force: true })
    }
  } catch (error) {
    throw error
  }
`

function inspectAsync(filePath: string): Promise<BackupDetails> {
  const databaseModulePath = createRequire(import.meta.url).resolve("better-sqlite3")
  return new Promise((resolve, reject) => {
    const worker = new Worker(inspectWorkerSource, {
      eval: true,
      workerData: { databaseModulePath, filePath },
    })
    worker.once("message", (details: BackupDetails) => resolve(details))
    worker.once("error", reject)
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Backup verification worker exited with code ${code}`))
    })
  })
}

function resolvedChild(root: string, fileName: string) {
  if (path.basename(fileName) !== fileName) throw new Error("Invalid backup path")
  const resolvedRoot = path.resolve(root)
  const candidate = path.resolve(root, fileName)
  if (path.dirname(candidate) !== resolvedRoot) throw new Error("Invalid backup path")
  return candidate
}

export class BackupManager {
  constructor(
    private readonly databasePath: string,
    private readonly backupDir: string,
    private readonly options: {
      DatabaseClass?: typeof Database
      now?: () => number
      appVersion?: string
      releaseSequence?: number
      hashFile?: (filePath: string) => string
      hashFileAsync?: (filePath: string) => Promise<string>
      inspectAsync?: (filePath: string) => Promise<BackupDetails>
    } = {},
  ) {}

  private asyncQueue: Promise<void> = Promise.resolve()

  private get DatabaseClass() {
    return this.options.DatabaseClass ?? Database
  }

  private get now() {
    return this.options.now ?? Date.now
  }

  private get hashFile() {
    return this.options.hashFile ?? sha256
  }

  private get hashFileAsync() {
    return this.options.hashFileAsync ?? sha256Async
  }

  private get inspectAsync() {
    return this.options.inspectAsync ?? inspectAsync
  }

  get intentPath() {
    return path.join(this.backupDir, RESTORE_INTENT)
  }

  create(db: Database.Database, reason: BackupReason): BackupManifest {
    const createdAt = this.now()
    mkdirSync(this.backupDir, { recursive: true })
    const checkpoint = db.pragma("wal_checkpoint(TRUNCATE)") as { busy: number }[]
    if (checkpoint[0]?.busy) throw new Error("Database is busy; backup was not created")
    const fileName = `stats-${reason}-${createdAt}.db`
    const destination = resolvedChild(this.backupDir, fileName)
    const staging = `${destination}.tmp-${process.pid}`
    const manifestPath = `${destination}${MANIFEST_SUFFIX}`
    const manifestStaging = `${manifestPath}.tmp-${process.pid}`
    try {
      copyFileSync(this.databasePath, staging)
      const details = inspect(staging, this.DatabaseClass)
      const manifest: BackupManifest = {
        format: "recall-managed-backup",
        manifestVersion: 2,
        fileName,
        createdAt,
        reason,
        protection: protectionForReason(reason,
          this.options.releaseSequence ?? BACKUP_RELEASE_SEQUENCE),
        appVersion: this.options.appVersion ?? "development",
        releaseSequence: this.options.releaseSequence ?? BACKUP_RELEASE_SEQUENCE,
        sha256: this.hashFile(staging),
        schemaVersion: details.schemaVersion,
        sizeBytes: statSync(staging).size,
        matchCount: details.matchCount,
        integrity: "ok",
      }
      writeFileSync(manifestStaging, JSON.stringify(manifest, null, 2), "utf8")
      renameSync(staging, destination)
      renameSync(manifestStaging, manifestPath)
      this.applyRetentionSafely()
      return manifest
    } finally {
      rmSync(staging, { force: true })
      rmSync(manifestStaging, { force: true })
    }
  }

  createAsync(db: Database.Database, reason: BackupReason): Promise<BackupManifest> {
    const task = this.asyncQueue.then(() => this.createAsyncNow(db, reason))
    this.asyncQueue = task.then(() => undefined, () => undefined)
    return task
  }

  private async createAsyncNow(
    db: Database.Database,
    reason: BackupReason,
  ): Promise<BackupManifest> {
    const createdAt = this.now()
    await mkdir(this.backupDir, { recursive: true })
    const fileName = `stats-${reason}-${createdAt}.db`
    const destination = resolvedChild(this.backupDir, fileName)
    const staging = `${destination}.tmp-${process.pid}`
    const manifestPath = `${destination}${MANIFEST_SUFFIX}`
    const manifestStaging = `${manifestPath}.tmp-${process.pid}`
    try {
      await db.backup(staging)
      const [details, digest, fileStats] = await Promise.all([
        this.inspectAsync(staging),
        this.hashFileAsync(staging),
        stat(staging),
      ])
      const manifest: BackupManifest = {
        format: "recall-managed-backup",
        manifestVersion: 2,
        fileName,
        createdAt,
        reason,
        protection: protectionForReason(reason,
          this.options.releaseSequence ?? BACKUP_RELEASE_SEQUENCE),
        appVersion: this.options.appVersion ?? "development",
        releaseSequence: this.options.releaseSequence ?? BACKUP_RELEASE_SEQUENCE,
        sha256: digest,
        schemaVersion: details.schemaVersion,
        sizeBytes: fileStats.size,
        matchCount: details.matchCount,
        integrity: "ok",
      }
      await writeFile(manifestStaging, JSON.stringify(manifest, null, 2), "utf8")
      await rename(staging, destination)
      await rename(manifestStaging, manifestPath)
      await this.applyRetentionSafelyAsync()
      return manifest
    } finally {
      await rm(staging, { force: true })
      await rm(`${staging}-wal`, { force: true })
      await rm(`${staging}-shm`, { force: true })
      await rm(manifestStaging, { force: true })
    }
  }

  list(): BackupManifest[] {
    if (!existsSync(this.backupDir)) return []
    return readdirSync(this.backupDir)
      .filter((name) => name.endsWith(MANIFEST_SUFFIX))
      .flatMap((name) => {
        try {
          const raw = parseManagedManifest(path.join(this.backupDir, name))
          if (!raw) return []
          const database = resolvedChild(this.backupDir, raw.fileName)
          if (!existsSync(database)) return []
          const sizeMatches = statSync(database).size === raw.sizeBytes
          const entry: BackupManifest = {
            ...raw,
            // Creation verifies both SQLite and SHA-256. Routine listings use
            // immutable manifest metadata plus a cheap size check; restore
            // re-hashes and re-inspects the selected file before it is trusted.
            integrity: sizeMatches && raw.integrity === "ok" ? "ok" : "failed",
          }
          return [entry]
        } catch {
          return []
        }
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  delete(fileName: string): boolean {
    const filePath = resolvedChild(this.backupDir, fileName)
    if (!existsSync(filePath)) return false
    rmSync(filePath)
    rmSync(`${filePath}${MANIFEST_SUFFIX}`, { force: true })
    return true
  }

  async prepareRestoreAsync(db: Database.Database, fileName: string): Promise<void> {
    const sourcePath = resolvedChild(this.backupDir, fileName)
    const manifest = this.list().find((entry) => entry.fileName === fileName)
    if (!manifest || !existsSync(sourcePath)) throw new Error("Backup not found")
    if (manifest.integrity !== "ok") throw new Error("Backup integrity check failed")
    const [digest] = await Promise.all([
      this.hashFileAsync(sourcePath),
      this.inspectAsync(sourcePath),
    ])
    if (digest !== manifest.sha256) throw new Error("Backup hash mismatch")
    await this.createAsync(db, "pre-restore")
    const intent: RestoreIntent = {
      sourcePath,
      databasePath: path.resolve(this.databasePath),
      expectedHash: manifest.sha256,
    }
    await writeFile(this.intentPath, JSON.stringify(intent), "utf8")
  }

  applyRestoreIntent(latestSupportedSchema: number): boolean {
    if (!existsSync(this.intentPath)) return false
    const raw = JSON.parse(readFileSync(this.intentPath, "utf8")) as RestoreIntent
    const sourcePath = resolvedChild(this.backupDir, path.basename(raw.sourcePath))
    if (
      sourcePath !== path.resolve(raw.sourcePath) ||
      path.resolve(raw.databasePath) !== path.resolve(this.databasePath) ||
      sha256(sourcePath) !== raw.expectedHash
    ) throw new Error("Restore intent validation failed")
    const details = inspect(sourcePath, this.DatabaseClass)
    if (details.schemaVersion > latestSupportedSchema) {
      throw new Error("This backup was created by a newer version of Recall")
    }
    const staging = `${this.databasePath}.restore-${process.pid}`
    const previous = `${this.databasePath}.restore-previous-${process.pid}`
    try {
      copyFileSync(sourcePath, staging)
      inspect(staging, this.DatabaseClass)
      // The live database is not open at startup. Keep the previous generation
      // alongside it until the replacement has been published, so a failed
      // rename can always be rolled back.
      if (existsSync(this.databasePath)) renameSync(this.databasePath, previous)
      try {
        renameSync(staging, this.databasePath)
      } catch (error) {
        if (existsSync(previous)) renameSync(previous, this.databasePath)
        throw error
      }
      rmSync(`${this.databasePath}-wal`, { force: true })
      rmSync(`${this.databasePath}-shm`, { force: true })
      rmSync(previous, { force: true })
      rmSync(this.intentPath, { force: true })
      return true
    } finally {
      rmSync(staging, { force: true })
    }
  }

  private applyRetention() {
    for (const backup of this.retentionProposal().delete) this.delete(backup.fileName)
  }

  private retentionProposal() {
    const all = this.list()
    const currentDatabaseBytes = existsSync(this.databasePath)
      ? statSync(this.databasePath).size
      : 0
    return proposeBackupRetention(
      all,
      currentDatabaseBytes,
      this.options.releaseSequence ?? BACKUP_RELEASE_SEQUENCE,
    )
  }

  private applyRetentionSafely() {
    try {
      this.applyRetention()
    } catch (error) {
      // A verified backup has already been published. Retention failure must
      // never make that successful recovery point appear to have failed.
      console.warn("Could not apply backup retention", error)
    }
  }

  private async applyRetentionSafelyAsync() {
    try {
      await Promise.all(this.retentionProposal().delete.flatMap((backup) => {
        const database = resolvedChild(this.backupDir, backup.fileName)
        return [
          rm(database, { force: true }),
          rm(`${database}${MANIFEST_SUFFIX}`, { force: true }),
        ]
      }))
    } catch (error) {
      console.warn("Could not apply backup retention", error)
    }
  }
}
