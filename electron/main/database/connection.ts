import Database from "better-sqlite3"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from "node:fs"
import path from "node:path"
import {
  applyMigrations,
  latestSchemaVersion,
} from "./migrations.js"
import { BackupManager } from "./backup-manager.js"

const DATABASE_BUSY_TIMEOUT_PRAGMA = "busy_timeout = 10000"
const SQLITE_COMPANION_SUFFIXES = ["", "-wal", "-shm"]

export interface OpenDatabaseOptions {
  DatabaseClass?: typeof Database
  now?: () => number
  backupDir?: string
}

function assertHealthy(db: Database.Database) {
  const quickCheck = db.pragma("quick_check", { simple: true })
  if (quickCheck !== "ok") {
    throw Object.assign(
      new Error(`SQLite quick_check failed: ${String(quickCheck)}`),
      { code: "SQLITE_CORRUPT" },
    )
  }
}

function removeNewDatabase(filePath: string) {
  for (const suffix of SQLITE_COMPANION_SUFFIXES) {
    rmSync(`${filePath}${suffix}`, { force: true })
  }
}

function backUpBeforeMigration(
  db: Database.Database,
  filePath: string,
  currentVersion: number,
  now: () => number,
  backupDir?: string,
  DatabaseClass: typeof Database = Database,
) {
  // A completed checkpoint makes the main database file a self-contained,
  // consistent snapshot. If another process is still writing, abort the
  // update rather than copying or migrating an incomplete generation.
  const [checkpoint] = db.pragma("wal_checkpoint(TRUNCATE)") as {
    busy: number
    log: number
    checkpointed: number
  }[]
  if (checkpoint?.busy) {
    throw Object.assign(
      new Error("Database is busy; update will be retried after Recall restarts."),
      { code: "SQLITE_BUSY" },
    )
  }

  if (backupDir) {
    return new BackupManager(filePath, backupDir, { DatabaseClass, now })
      .create(db, "pre-migration")
      .fileName
  }

  const backupPath = `${filePath}.pre-migration-v${currentVersion}-${now()}.bak`
  copyFileSync(filePath, backupPath)
  return backupPath
}

/**
 * Opens an existing database or creates one when no user data exists.
 *
 * Migrations run inside the attempt on purpose: a damaged file often opens
 * happily and only fails on the first read, so the check has to touch it.
 */
export function openDatabase(
  filePath: string,
  options: OpenDatabaseOptions = {},
): Database.Database {
  mkdirSync(path.dirname(filePath), { recursive: true })
  // An empty file is only a failed setup placeholder; it contains no SQLite
  // pages or user history and should behave like a brand-new database.
  const hadUserDataBeforeOpen =
    existsSync(filePath) && statSync(filePath).size > 0
  const DatabaseClass = options.DatabaseClass ?? Database
  const now = options.now ?? Date.now
  let db: Database.Database | undefined

  try {
    db = new DatabaseClass(filePath)

    // SQLite does not support JavaScript numeric separators, so keep the SQL
    // literal explicit and cover its execution with a real-database test.
    db.pragma(DATABASE_BUSY_TIMEOUT_PRAGMA)
    db.pragma("foreign_keys = ON")
    assertHealthy(db)

    const currentVersion = db.pragma("user_version", { simple: true }) as number
    if (currentVersion > latestSchemaVersion) {
      throw new Error(
        `Database schema v${currentVersion} is newer than this Recall build (v${latestSchemaVersion}).`,
      )
    }

    if (hadUserDataBeforeOpen && currentVersion < latestSchemaVersion) {
      backUpBeforeMigration(
        db,
        filePath,
        currentVersion,
        now,
        options.backupDir,
        DatabaseClass,
      )
    }

    applyMigrations(db)
    assertHealthy(db)
    db.pragma("journal_mode = WAL")
    return db
  } catch (error) {
    if (db?.open) db.close()

    // A failed attempt to create a brand-new database contains no user data.
    // Remove its partial files so the next corrected build gets a clean retry.
    // Existing databases are never moved, deleted, or replaced automatically.
    if (!hadUserDataBeforeOpen) removeNewDatabase(filePath)
    throw error
  }
}
