import { existsSync, renameSync } from "node:fs"

/**
 * The files SQLite keeps alongside a database in write-ahead logging mode.
 *
 * A log left behind after the database it belongs to has been moved would be
 * replayed into whatever takes its place, so they travel together.
 */
const COMPANION_SUFFIXES = ["", "-wal", "-shm"]

/**
 * SQLite reports a number of perfectly recoverable startup problems through
 * the same error channel as corruption: a second Recall process may still be
 * shutting down, an antivirus scan can briefly lock the file, or a migration
 * can need attention. Starting over in any of those cases loses history.
 *
 * Only errors that SQLite explicitly identifies as a corrupt/non-database
 * file are eligible for quarantine. Everything else is surfaced to the app,
 * leaving the existing database entirely untouched.
 */
export function isDatabaseCorruptionError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown }
  const code = typeof candidate?.code === "string" ? candidate.code : ""
  const message =
    typeof candidate?.message === "string" ? candidate.message.toLowerCase() : ""

  return (
    code === "SQLITE_CORRUPT" ||
    code === "SQLITE_NOTADB" ||
    /database disk image is malformed|file is not a database|file is encrypted or is not a database/.test(
      message,
    )
  )
}

/**
 * Moves a database that cannot be opened out of the way.
 *
 * The file is kept rather than deleted: it is the only copy of whatever it
 * held, and a later version of the app — or a person with a recovery tool —
 * may be able to read more out of it than we can.
 *
 * @returns the path the damaged database was moved to.
 */
export function quarantineDamaged(filePath: string, now = Date.now()): string {
  const destination = `${filePath}.damaged-${now}`

  for (const suffix of COMPANION_SUFFIXES) {
    const from = `${filePath}${suffix}`
    if (existsSync(from)) renameSync(from, `${destination}${suffix}`)
  }

  return destination
}

/**
 * Opens a database, starting a new one if the existing file is unreadable.
 *
 * A corrupt database must not stop Recall from starting. Losing recorded
 * history is bad; being unable to open the app at all, with no way to record
 * anything further or even read the error, is worse.
 *
 * Only one retry is attempted. If a freshly created database also fails to
 * open then the problem is not the file, and the error belongs to the caller.
 */
export function openWithRecovery<T>(
  filePath: string,
  open: (path: string) => T,
): T {
  try {
    return open(filePath)
  } catch (error) {
    if (!existsSync(filePath) || !isDatabaseCorruptionError(error)) throw error

    const moved = quarantineDamaged(filePath)

    console.error(
      `Could not open ${filePath}: ${(error as Error).message}\n` +
        `It has been moved to ${moved} and a new database started. ` +
        `Recorded history in the damaged file is not readable.`,
    )

    return open(filePath)
  }
}
