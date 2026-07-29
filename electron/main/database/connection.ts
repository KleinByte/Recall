import Database from "better-sqlite3"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { applyMigrations } from "./migrations.js"
import { openWithRecovery } from "./recover.js"

/**
 * Opens the database, or starts a new one if the file cannot be read.
 *
 * Migrations run inside the attempt on purpose: a damaged file often opens
 * happily and only fails on the first read, so the check has to touch it.
 */
export function openDatabase(filePath: string): Database.Database {
  mkdirSync(path.dirname(filePath), { recursive: true })

  return openWithRecovery(filePath, (target) => {
    const db = new Database(target)

    try {
      // A short wait turns a hand-off from the previous version into a normal
      // startup instead of a failed update. Crucially, a lock is never a
      // reason to discard a player's history.
      db.pragma("busy_timeout = 10_000")
      db.pragma("journal_mode = WAL")
      db.pragma("foreign_keys = ON")

      // Opening a SQLite file alone does not read every page. Touch it before
      // migrations so genuine corruption is the one case that recovery is
      // allowed to quarantine.
      const quickCheck = db.pragma("quick_check", { simple: true })
      if (quickCheck !== "ok") {
        const corruption = Object.assign(
          new Error(`SQLite quick_check failed: ${String(quickCheck)}`),
          { code: "SQLITE_CORRUPT" },
        )
        throw corruption
      }
      applyMigrations(db)
    } catch (error) {
      // Leave nothing holding the file open, or it cannot be moved aside.
      db.close()
      throw error
    }

    return db
  })
}
