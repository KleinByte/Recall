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
  /** A disposable recovery staging copy already has an immutable source. */
  backupBeforeMigration?: boolean
  /** Recovery staging uses DELETE so the promoted file is self-contained. */
  journalMode?: "WAL" | "DELETE"
}

export type DatabaseStartupPhase =
  | "open"
  | "configure"
  | "preflight-integrity"
  | "compatibility"
  | "pre-migration-backup"
  | "migration"
  | "post-migration-integrity"
  | "journal-mode"

const NON_RECOVERABLE_SQLITE_CODE_PREFIXES = [
  "SQLITE_AUTH",
  "SQLITE_BUSY",
  "SQLITE_CANTOPEN",
  "SQLITE_FULL",
  "SQLITE_INTERRUPT",
  "SQLITE_IOERR",
  "SQLITE_LOCKED",
  "SQLITE_MISUSE",
  "SQLITE_NOMEM",
  "SQLITE_PERM",
  "SQLITE_PROTOCOL",
  "SQLITE_READONLY",
] as const

function directErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || !error || !("code" in error)) return undefined
  const code = String((error as { code?: unknown }).code ?? "").trim()
  return code || undefined
}

function nestedErrorCode(error: unknown): string | undefined {
  const direct = directErrorCode(error)
  if (direct) return direct
  return error instanceof Error && error.cause !== undefined
    ? nestedErrorCode(error.cause)
    : undefined
}

function nestedErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isDatabaseCorruptionError(error: unknown): boolean {
  const code = nestedErrorCode(error)
  const message = nestedErrorMessage(error)
  return code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB" ||
    /(?:database disk image is malformed|file is not a database|quick_check failed)/i
      .test(message) ||
    (error instanceof Error && error.cause !== undefined &&
      isDatabaseCorruptionError(error.cause))
}

function isEnvironmentalDatabaseError(error: unknown): boolean {
  const code = nestedErrorCode(error)
  return Boolean(code && NON_RECOVERABLE_SQLITE_CODE_PREFIXES.some((prefix) =>
    code === prefix || code.startsWith(`${prefix}_`)))
}

function isRecoverableStartupFailure(
  phase: DatabaseStartupPhase,
  cause: unknown,
  hadUserData: boolean,
) {
  if (!hadUserData) return false
  if (isDatabaseCorruptionError(cause)) return true
  if (isEnvironmentalDatabaseError(cause)) return false
  return phase === "preflight-integrity" || phase === "migration" ||
    phase === "post-migration-integrity"
}

export class DatabaseStartupError extends Error {
  readonly code: string | undefined
  readonly recoverable: boolean

  constructor(
    readonly phase: DatabaseStartupPhase,
    readonly hadUserData: boolean,
    cause: unknown,
  ) {
    super(nestedErrorMessage(cause), { cause })
    this.name = "DatabaseStartupError"
    this.code = nestedErrorCode(cause)
    this.recoverable = isRecoverableStartupFailure(phase, cause, hadUserData)
  }
}

export function isRecoverableDatabaseStartupError(error: unknown): boolean {
  return error instanceof DatabaseStartupError
    ? error.recoverable
    : isDatabaseCorruptionError(error)
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

function assertForeignKeysHealthy(db: Database.Database) {
  const violations = db.pragma("foreign_key_check") as unknown[]
  if (violations.length > 0) {
    throw Object.assign(
      new Error(`SQLite foreign_key_check failed with ${violations.length} violation(s)`),
      { code: "SQLITE_CONSTRAINT_FOREIGNKEY" },
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
  const journalMode = options.journalMode ?? "WAL"
  let db: Database.Database | undefined
  let phase: DatabaseStartupPhase = "open"

  try {
    db = new DatabaseClass(filePath)

    phase = "configure"
    // SQLite does not support JavaScript numeric separators, so keep the SQL
    // literal explicit and cover its execution with a real-database test.
    db.pragma(DATABASE_BUSY_TIMEOUT_PRAGMA)
    db.pragma("foreign_keys = ON")

    phase = "preflight-integrity"
    assertHealthy(db)

    phase = "compatibility"
    const currentVersion = db.pragma("user_version", { simple: true }) as number
    if (currentVersion > latestSchemaVersion) {
      throw new Error(
        `Database schema v${currentVersion} is newer than this Recall build (v${latestSchemaVersion}).`,
      )
    }

    if (journalMode === "DELETE") {
      phase = "journal-mode"
      db.pragma("journal_mode = DELETE")
    }

    if (
      hadUserDataBeforeOpen &&
      currentVersion < latestSchemaVersion &&
      options.backupBeforeMigration !== false
    ) {
      phase = "pre-migration-backup"
      backUpBeforeMigration(
        db,
        filePath,
        currentVersion,
        now,
        options.backupDir,
        DatabaseClass,
      )
    }

    phase = "migration"
    applyMigrations(db)

    phase = "post-migration-integrity"
    assertHealthy(db)
    assertForeignKeysHealthy(db)

    if (journalMode === "WAL") {
      phase = "journal-mode"
      db.pragma("journal_mode = WAL")
    }
    return db
  } catch (error) {
    if (db?.open) db.close()

    // A failed attempt to create a brand-new database contains no user data.
    // Remove its partial files so the next corrected build gets a clean retry.
    // Existing databases are never moved, deleted, or replaced automatically.
    if (!hadUserDataBeforeOpen) removeNewDatabase(filePath)
    throw error instanceof DatabaseStartupError
      ? error
      : new DatabaseStartupError(phase, hadUserDataBeforeOpen, error)
  }
}
