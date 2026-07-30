import Database from "better-sqlite3"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"

export type BackupReason =
  | "daily"
  | "manual"
  | "pre-update"
  | "pre-migration"
  | "pre-restore"

export interface BackupManifest {
  fileName: string
  createdAt: number
  reason: BackupReason
  sha256: string
  schemaVersion: number
  sizeBytes: number
  matchCount: number
  integrity: "ok" | "failed"
}

interface RestoreIntent {
  sourcePath: string
  databasePath: string
  expectedHash: string
}

const MANIFEST_SUFFIX = ".manifest.json"
const RESTORE_INTENT = "restore-intent.json"

function sha256(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

function inspect(filePath: string, DatabaseClass: typeof Database) {
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
  }
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
    } = {},
  ) {}

  private get DatabaseClass() {
    return this.options.DatabaseClass ?? Database
  }

  private get now() {
    return this.options.now ?? Date.now
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
        fileName,
        createdAt,
        reason,
        sha256: sha256(staging),
        schemaVersion: details.schemaVersion,
        sizeBytes: statSync(staging).size,
        matchCount: details.matchCount,
        integrity: "ok",
      }
      writeFileSync(manifestStaging, JSON.stringify(manifest, null, 2), "utf8")
      renameSync(staging, destination)
      renameSync(manifestStaging, manifestPath)
      this.applyRetention()
      return manifest
    } finally {
      rmSync(staging, { force: true })
      rmSync(manifestStaging, { force: true })
    }
  }

  list(): BackupManifest[] {
    if (!existsSync(this.backupDir)) return []
    return readdirSync(this.backupDir)
      .filter((name) => name.endsWith(MANIFEST_SUFFIX))
      .flatMap((name) => {
        try {
          const raw = JSON.parse(
            readFileSync(path.join(this.backupDir, name), "utf8"),
          ) as BackupManifest
          const database = resolvedChild(this.backupDir, raw.fileName)
          if (!existsSync(database)) return []
          const entry: BackupManifest = {
            ...raw,
            integrity: sha256(database) === raw.sha256 ? "ok" : "failed",
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

  prepareRestore(db: Database.Database, fileName: string) {
    const sourcePath = resolvedChild(this.backupDir, fileName)
    const manifest = this.list().find((entry) => entry.fileName === fileName)
    if (!manifest || !existsSync(sourcePath)) throw new Error("Backup not found")
    if (manifest.integrity !== "ok") throw new Error("Backup integrity check failed")
    if (sha256(sourcePath) !== manifest.sha256) throw new Error("Backup hash mismatch")
    inspect(sourcePath, this.DatabaseClass)
    this.create(db, "pre-restore")
    const intent: RestoreIntent = {
      sourcePath,
      databasePath: path.resolve(this.databasePath),
      expectedHash: manifest.sha256,
    }
    writeFileSync(this.intentPath, JSON.stringify(intent), "utf8")
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
    const all = this.list()
    const keep = new Set(
      all.filter((backup) => backup.reason === "manual").map((backup) => backup.fileName),
    )
    const daily = new Set<string>()
    const monthly = new Set<string>()
    const now = this.now()
    const current = new Date(now)
    const allowedMonths = new Set(
      Array.from({ length: 6 }, (_, index) =>
        new Date(Date.UTC(
          current.getUTCFullYear(),
          current.getUTCMonth() - index - 1,
          1,
        )).toISOString().slice(0, 7),
      ),
    )
    for (const backup of all.filter((entry) => entry.reason === "daily")) {
      const date = new Date(backup.createdAt)
      const dayKey = date.toISOString().slice(0, 10)
      const monthKey = date.toISOString().slice(0, 7)
      const ageDays = (now - backup.createdAt) / 86_400_000
      if (ageDays <= 14 && !daily.has(dayKey)) {
        daily.add(dayKey)
        keep.add(backup.fileName)
      } else if (allowedMonths.has(monthKey) && !monthly.has(monthKey)) {
        monthly.add(monthKey)
        keep.add(backup.fileName)
      }
    }
    for (const reason of ["pre-update", "pre-migration", "pre-restore"] as const) {
      all.filter((backup) => backup.reason === reason)
        .slice(0, 3)
        .forEach((backup) => keep.add(backup.fileName))
    }
    for (const backup of all) {
      if (!keep.has(backup.fileName)) this.delete(backup.fileName)
    }
  }
}
