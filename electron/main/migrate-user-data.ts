import { copyFileSync, existsSync, mkdirSync } from "node:fs"
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

  for (const file of LEGACY_FILES) {
    const source = path.join(legacyDir, file)
    const target = path.join(currentDir, file)

    if (!existsSync(source) || existsSync(target)) continue

    try {
      copyFileSync(source, target)
      migrated.push(file)
    } catch (error) {
      console.warn(
        `Could not carry over ${file} from the previous install: ` +
          `${(error as Error).message}`,
      )
    }
  }

  return { migrated }
}
