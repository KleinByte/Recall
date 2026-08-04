import Database from "better-sqlite3"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs"
import path from "node:path"

interface SnapshotOptions {
  DatabaseClass?: typeof Database
  now?: () => number
}

function checkpoint(db: Database.Database) {
  const [result] = db.pragma("wal_checkpoint(TRUNCATE)") as { busy: number }[]
  if (result?.busy) {
    throw Object.assign(new Error("Database checkpoint is busy"), {
      code: "SQLITE_BUSY",
    })
  }
}

function isHealthySnapshot(filePath: string, DatabaseClass: typeof Database) {
  let db: Database.Database | undefined
  try {
    db = new DatabaseClass(filePath, { readonly: true, fileMustExist: true })
    return db.pragma("quick_check", { simple: true }) === "ok"
  } catch {
    return false
  } finally {
    if (db?.open) db.close()
  }
}

/** Creates a self-contained database snapshot outside Electron's userData. */
export function createUpdateSnapshot(
  db: Database.Database,
  databasePath: string,
  backupDir: string,
  options: SnapshotOptions = {},
) {
  const DatabaseClass = options.DatabaseClass ?? Database
  const now = options.now ?? Date.now
  checkpoint(db)
  mkdirSync(backupDir, { recursive: true })

  const destination = path.join(backupDir, `stats-${now()}.db`)
  const staging = `${destination}.tmp`
  rmSync(staging, { force: true })

  try {
    copyFileSync(databasePath, staging)
    if (!isHealthySnapshot(staging, DatabaseClass)) {
      throw new Error("Update snapshot failed SQLite integrity verification")
    }
    renameSync(staging, destination)
    return destination
  } finally {
    rmSync(staging, { force: true })
  }
}

/**
 * Restores only when the active database is absent or a zero-byte setup
 * placeholder. An existing database with any content is never overwritten.
 */
export function restoreLatestUpdateSnapshot(
  databasePath: string,
  backupDir: string,
  options: SnapshotOptions = {},
) {
  const activeSize = existsSync(databasePath) ? statSync(databasePath).size : 0
  if (activeSize > 0 || !existsSync(backupDir)) return undefined

  const DatabaseClass = options.DatabaseClass ?? Database
  const now = options.now ?? Date.now
  const candidates = readdirSync(backupDir)
    .filter((name) => /^stats-\d+\.db$/.test(name))
    .map((name) => path.join(backupDir, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)

  for (const candidate of candidates) {
    if (!isHealthySnapshot(candidate, DatabaseClass)) continue

    mkdirSync(path.dirname(databasePath), { recursive: true })
    const staging = `${databasePath}.restore-${process.pid}-${now()}`
    rmSync(staging, { force: true })
    try {
      copyFileSync(candidate, staging)
      if (!isHealthySnapshot(staging, DatabaseClass)) continue
      rmSync(databasePath, { force: true })
      renameSync(staging, databasePath)
      return candidate
    } finally {
      rmSync(staging, { force: true })
    }
  }

  return undefined
}
