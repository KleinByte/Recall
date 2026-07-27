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
      db.pragma("journal_mode = WAL")
      db.pragma("foreign_keys = ON")
      applyMigrations(db)
    } catch (error) {
      // Leave nothing holding the file open, or it cannot be moved aside.
      db.close()
      throw error
    }

    return db
  })
}
