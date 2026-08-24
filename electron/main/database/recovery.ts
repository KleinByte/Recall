import Database from "better-sqlite3"
import {
  copyFileSync,
  existsSync,
  renameSync,
  rmSync,
} from "node:fs"
import {
  catalogRecoveryBackups,
  type RecoveryBackupRejection,
} from "./backup-manager.js"
import {
  DatabaseStartupError,
  isRecoverableDatabaseStartupError,
  openDatabase,
  type DatabaseStartupPhase,
  type OpenDatabaseOptions,
} from "./connection.js"
import { latestSchemaVersion } from "./migrations.js"

export { isDatabaseCorruptionError } from "./connection.js"

const SQLITE_COMPANION_SUFFIXES = ["", "-wal", "-shm"] as const

export interface DatabaseRecoveryAttempt {
  sourcePath: string
  phase: "catalog" | "validation" | DatabaseStartupPhase
  message: string
}

export interface DatabaseRecovery {
  sourcePath: string
  quarantinedPath: string
  recoveredAt: number
  sourceSchemaVersion: number
  targetSchemaVersion: number
  triggerPhase?: DatabaseStartupPhase
  rejectedCandidates: DatabaseRecoveryAttempt[]
}

export interface RecoveredDatabase {
  database: Database.Database
  recovery?: DatabaseRecovery
}

export interface DatabaseRecoveryOptions extends OpenDatabaseOptions {
  backupDir: string
  /** Test seam for validating promotion rollback without changing production I/O. */
  renameFile?: (source: string, destination: string) => void
  onAttempt?: (attempt: DatabaseRecoveryAttempt) => void
}

export class DatabaseRecoveryExhaustedError extends Error {
  readonly code: string | undefined
  readonly phase: DatabaseStartupPhase | undefined

  constructor(
    readonly startupError: unknown,
    readonly attempts: readonly DatabaseRecoveryAttempt[],
  ) {
    super(startupError instanceof Error ? startupError.message : String(startupError), {
      cause: startupError,
    })
    this.name = "DatabaseRecoveryExhaustedError"
    this.code = startupError instanceof DatabaseStartupError
      ? startupError.code
      : undefined
    this.phase = startupError instanceof DatabaseStartupError
      ? startupError.phase
      : undefined
  }
}

interface PublishedRecovery {
  recovery: DatabaseRecovery
  rollback(): void
}

interface RecoverySearch {
  publication?: PublishedRecovery
  attempts: DatabaseRecoveryAttempt[]
}

class DatabaseRecoveryPromotionError extends Error {
  constructor(cause: unknown) {
    super(
      `A verified backup could not replace the active database: ${errorMessage(cause)}`,
      { cause },
    )
    this.name = "DatabaseRecoveryPromotionError"
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function removeGeneration(filePath: string) {
  for (const suffix of SQLITE_COMPANION_SUFFIXES) {
    rmSync(`${filePath}${suffix}`, { force: true })
  }
}

function uniqueQuarantinePath(databasePath: string, now: number) {
  const first = `${databasePath}.recovery-original-${now}`
  if (!SQLITE_COMPANION_SUFFIXES.some((suffix) => existsSync(`${first}${suffix}`))) {
    return first
  }
  let sequence = 1
  while (SQLITE_COMPANION_SUFFIXES.some(
    (suffix) => existsSync(`${first}-${sequence}${suffix}`),
  )) sequence += 1
  return `${first}-${sequence}`
}

function restoreMovedGeneration(
  moved: Array<{ source: string; destination: string }>,
  renameFile: (source: string, destination: string) => void,
) {
  const failures: unknown[] = []
  for (const entry of [...moved].reverse()) {
    try {
      if (existsSync(entry.destination) && !existsSync(entry.source)) {
        renameFile(entry.destination, entry.source)
      }
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Could not restore the original database generation")
  }
}

function replaceFailedGeneration(
  databasePath: string,
  stagingPath: string,
  now: number,
  renameFile: (source: string, destination: string) => void,
): { quarantinedPath: string; rollback(): void } {
  const quarantinedPath = uniqueQuarantinePath(databasePath, now)
  const moved: Array<{ source: string; destination: string }> = []
  try {
    for (const suffix of SQLITE_COMPANION_SUFFIXES) {
      const source = `${databasePath}${suffix}`
      if (!existsSync(source)) continue
      const destination = `${quarantinedPath}${suffix}`
      renameFile(source, destination)
      moved.push({ source, destination })
    }
    renameFile(stagingPath, databasePath)
  } catch (error) {
    try {
      restoreMovedGeneration(moved, renameFile)
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Database recovery promotion and rollback both failed",
      )
    }
    throw error
  }

  let rolledBack = false
  return {
    quarantinedPath,
    rollback() {
      if (rolledBack) return
      rolledBack = true
      removeGeneration(databasePath)
      restoreMovedGeneration(moved, renameFile)
    },
  }
}

function readSchemaVersion(filePath: string, DatabaseClass: typeof Database) {
  const db = new DatabaseClass(filePath, { fileMustExist: true })
  try {
    return Number(db.pragma("user_version", { simple: true }))
  } finally {
    db.close()
  }
}

function verifyMigratedCandidate(filePath: string, DatabaseClass: typeof Database) {
  const db = new DatabaseClass(filePath, { readonly: true, fileMustExist: true })
  try {
    const version = Number(db.pragma("user_version", { simple: true }))
    if (version !== latestSchemaVersion) {
      throw new Error(
        `Recovered database stopped at schema v${version}; expected v${latestSchemaVersion}`,
      )
    }
    const quickCheck = db.pragma("quick_check", { simple: true })
    if (quickCheck !== "ok") {
      throw new Error(`Recovered database quick_check failed: ${String(quickCheck)}`)
    }
    const foreignKeyViolations = (db.pragma("foreign_key_check") as unknown[]).length
    if (foreignKeyViolations > 0) {
      throw new Error(
        `Recovered database has ${foreignKeyViolations} foreign-key violation(s)`,
      )
    }
  } finally {
    db.close()
  }
}

function reportAttempt(
  options: DatabaseRecoveryOptions,
  attempts: DatabaseRecoveryAttempt[],
  attempt: DatabaseRecoveryAttempt,
) {
  attempts.push(attempt)
  if (options.onAttempt) options.onAttempt(attempt)
  else console.warn(
    `[database-recovery] skipped ${attempt.sourcePath} during ${attempt.phase}: ` +
      attempt.message,
  )
}

function catalogRejectionAttempt(
  rejection: RecoveryBackupRejection,
): DatabaseRecoveryAttempt {
  return {
    sourcePath: rejection.filePath,
    phase: "catalog",
    message: rejection.reason,
  }
}

/**
 * Finds the newest independently verified backup that this build can open.
 * Each candidate is migrated in a disposable, self-contained copy before the
 * failed active generation is preserved and atomically replaced.
 */
function recoverDatabase(
  databasePath: string,
  options: DatabaseRecoveryOptions,
  triggerError?: unknown,
): RecoverySearch {
  const DatabaseClass = options.DatabaseClass ?? Database
  const now = options.now ?? Date.now
  const renameFile = options.renameFile ?? renameSync
  const attempts: DatabaseRecoveryAttempt[] = []
  const catalog = catalogRecoveryBackups(options.backupDir)

  for (const rejection of catalog.rejected) {
    reportAttempt(options, attempts, catalogRejectionAttempt(rejection))
  }

  for (const candidate of catalog.candidates) {
    const stagingPath = `${databasePath}.recovery-${process.pid}-${now()}`
    removeGeneration(stagingPath)
    let sourceSchemaVersion = candidate.schemaVersion
    try {
      copyFileSync(candidate.filePath, stagingPath)
      sourceSchemaVersion = readSchemaVersion(stagingPath, DatabaseClass)
      const staged = openDatabase(stagingPath, {
        DatabaseClass,
        now,
        backupBeforeMigration: false,
        journalMode: "DELETE",
      })
      staged.close()
      verifyMigratedCandidate(stagingPath, DatabaseClass)

      const recoveredAt = now()
      let replacement: { quarantinedPath: string; rollback(): void }
      try {
        replacement = replaceFailedGeneration(
          databasePath,
          stagingPath,
          recoveredAt,
          renameFile,
        )
      } catch (error) {
        throw new DatabaseRecoveryPromotionError(error)
      }

      return {
        publication: {
          recovery: {
            sourcePath: candidate.filePath,
            quarantinedPath: replacement.quarantinedPath,
            recoveredAt,
            sourceSchemaVersion: sourceSchemaVersion ?? latestSchemaVersion,
            targetSchemaVersion: latestSchemaVersion,
            triggerPhase: triggerError instanceof DatabaseStartupError
              ? triggerError.phase
              : undefined,
            rejectedCandidates: [...attempts],
          },
          rollback: replacement.rollback,
        },
        attempts,
      }
    } catch (error) {
      // Promotion failures are environmental and affect every candidate. The
      // original generation has already been rolled back, so stop immediately.
      if (error instanceof DatabaseRecoveryPromotionError) throw error
      if (error instanceof DatabaseStartupError && !error.recoverable &&
          error.phase !== "compatibility") {
        throw new Error(
          `Backup recovery could not continue during ${error.phase}: ${error.message}`,
          { cause: error },
        )
      }
      reportAttempt(options, attempts, {
        sourcePath: candidate.filePath,
        phase: error instanceof DatabaseStartupError ? error.phase : "validation",
        message: errorMessage(error),
      })
    } finally {
      removeGeneration(stagingPath)
    }
  }
  return { attempts }
}

/** Retained for callers that explicitly request a recovery attempt. */
export function recoverCorruptDatabase(
  databasePath: string,
  backupDir: string,
  options: OpenDatabaseOptions & Pick<
    DatabaseRecoveryOptions,
    "renameFile" | "onAttempt"
  > = {},
): DatabaseRecovery | undefined {
  return recoverDatabase(databasePath, { ...options, backupDir }).publication?.recovery
}

export function openDatabaseWithRecovery(
  databasePath: string,
  options: DatabaseRecoveryOptions,
): RecoveredDatabase {
  try {
    return { database: openDatabase(databasePath, options) }
  } catch (error) {
    if (!isRecoverableDatabaseStartupError(error)) throw error
    const search = recoverDatabase(databasePath, options, error)
    if (!search.publication) {
      throw new DatabaseRecoveryExhaustedError(error, search.attempts)
    }

    try {
      return {
        database: openDatabase(databasePath, options),
        recovery: search.publication.recovery,
      }
    } catch (reopenError) {
      try {
        search.publication.rollback()
      } catch (rollbackError) {
        throw new AggregateError(
          [reopenError, rollbackError],
          "The recovered database could not be opened and the original could not be restored",
        )
      }
      throw new Error(
        `The recovered database could not be reopened; the original was restored: ` +
          errorMessage(reopenError),
        { cause: reopenError },
      )
    }
  }
}
