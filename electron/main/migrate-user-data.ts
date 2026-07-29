import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs"
import path from "node:path"

/**
 * Files carried over when the application was renamed.
 *
 * The write-ahead log files matter: SQLite keeps recent commits there, so
 * copying the database alone can silently drop the newest games.
 */
const LEGACY_FILES = [
  "stats.db",
  "stats.db-wal",
  "stats.db-shm",
  "config.json",
]

export interface MigrationResult {
  migrated: string[]
}

interface FileStamp {
  size: number
  modifiedAt: number
}

function stamp(filePath: string): FileStamp | undefined {
  if (!existsSync(filePath)) return undefined
  const details = statSync(filePath)
  return { size: details.size, modifiedAt: details.mtimeMs }
}

function sameStamp(left: FileStamp | undefined, right: FileStamp | undefined) {
  return left?.size === right?.size && left?.modifiedAt === right?.modifiedAt
}

/**
 * Carries recorded history across the rename from `lol-challenge-tracker` to
 * `recall`.
 *
 * Electron derives the user data directory from the application name, so
 * renaming the app would otherwise point it at an empty folder. The League
 * client can only replay the most recent 20 games, so anything older would be
 * unrecoverable.
 *
 * Files are copied rather than moved, and existing files are never
 * overwritten, so a failure part-way through cannot destroy data.
 */
export function migrateLegacyUserData(
  legacyDir: string,
  currentDir: string,
): MigrationResult {
  const migrated: string[] = []

  if (!existsSync(legacyDir)) return { migrated }

  mkdirSync(currentDir, { recursive: true })

  const currentDatabaseExists = existsSync(path.join(currentDir, "stats.db"))
  const databaseFiles = currentDatabaseExists
    ? []
    : LEGACY_FILES.filter(
        (file) =>
          file.startsWith("stats.db") && existsSync(path.join(legacyDir, file)),
      )
  const configFiles =
    existsSync(path.join(legacyDir, "config.json")) &&
    !existsSync(path.join(currentDir, "config.json"))
      ? ["config.json"]
      : []
  const files = [...databaseFiles, ...configFiles]
  if (files.length === 0) return { migrated }

  // The old and renamed apps can briefly overlap during an update. Copying a
  // database and its WAL one file at a time while the old process is writing
  // can produce a mismatched pair. Stage the whole import, then confirm the
  // source did not change during the copy before making anything visible.
  const sourceStamps = new Map(
    files.map((file) => [file, stamp(path.join(legacyDir, file))]),
  )
  const staging = path.join(currentDir, `.legacy-import-${process.pid}-${Date.now()}`)

  try {
    mkdirSync(staging, { recursive: true })
    for (const file of files) {
      copyFileSync(path.join(legacyDir, file), path.join(staging, file))
    }

    const changed = files.some(
      (file) => !sameStamp(sourceStamps.get(file), stamp(path.join(legacyDir, file))),
    )
    if (changed) {
      console.warn(
        "Previous Recall data changed while it was being imported; it will be retried on the next launch.",
      )
      return { migrated }
    }

    for (const file of files) {
      const target = path.join(currentDir, file)
      if (existsSync(target)) continue
      renameSync(path.join(staging, file), target)
      migrated.push(file)
    }
  } catch (error) {
    console.warn(
      `Could not carry over data from the previous install: ${(error as Error).message}`,
    )
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }

  return { migrated }
}
