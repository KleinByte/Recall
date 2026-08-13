import Database from "better-sqlite3-node"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  readFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import {
  applyMigrations,
  latestSchemaVersion,
} from "../electron/main/database/migrations.js"
import {
  migrationRehearsalCounts,
  migrationStorageProfile,
} from "./migration-rehearsal-contract.js"

function explicitDatabasePath(): string {
  const argument = process.argv.indexOf("--db")
  const value = argument >= 0 ? process.argv[argument + 1] : undefined
  if (!value) {
    throw new TypeError(
      "Usage: vite-node --root scripts scripts/rehearse-database-migration.ts " +
        "--db <explicit-database-path>",
    )
  }
  const databasePath = path.resolve(value)
  if (!existsSync(databasePath) || !statSync(databasePath).isFile()) {
    throw new TypeError("The explicit database path is not a regular file")
  }
  return databasePath
}

const databasePath = explicitDatabasePath()
const temporaryRoot = path.resolve(os.tmpdir())
const rehearsalDirectory = mkdtempSync(
  path.join(temporaryRoot, "recall-migration-rehearsal-"),
)
const rehearsalPath = path.join(rehearsalDirectory, "stats.db")

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

if (path.normalize(rehearsalPath) === path.normalize(databasePath)) {
  throw new Error("Rehearsal target must be separate from the source database")
}

try {
  const sourceHashBefore = sha256File(databasePath)
  const source = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  })
  const sourceVersion = Number(source.pragma("user_version", { simple: true }))
  const before = migrationRehearsalCounts(source)
  const beforeStorage = migrationStorageProfile(source)
  try {
    if (source.pragma("quick_check", { simple: true }) !== "ok") {
      throw new Error("Source database quick_check failed")
    }
    await source.backup(rehearsalPath)
  } finally {
    source.close()
  }

  const rehearsal = new Database(rehearsalPath)
  try {
    const copiedVersion = Number(rehearsal.pragma("user_version", { simple: true }))
    const copied = migrationRehearsalCounts(rehearsal)
    const sourceHashAfterCopy = sha256File(databasePath)
    if (copiedVersion !== sourceVersion ||
        JSON.stringify(copied) !== JSON.stringify(before) ||
        sourceHashAfterCopy !== sourceHashBefore) {
      throw new Error("Rehearsal copy does not match source invariants")
    }
    rehearsal.pragma("foreign_keys = ON")
    const migratedVersion = applyMigrations(rehearsal)
    const after = migrationRehearsalCounts(rehearsal)
    const afterStorage = migrationStorageProfile(rehearsal)
    const quickCheck = String(rehearsal.pragma("quick_check", { simple: true }))
    const foreignKeyViolations = rehearsal.pragma("foreign_key_check").length
    const promotedRawTimelines = after.rawTimelineBodies - before.rawTimelineBodies
    const sourceHashAfterMigration = sha256File(databasePath)

    if (migratedVersion !== latestSchemaVersion || quickCheck !== "ok" ||
        foreignKeyViolations !== 0 || before.matches !== after.matches ||
        before.participants !== after.participants ||
        before.metricObservations !== after.metricObservations ||
        before.metricRecipeIdentities !== after.metricRecipeIdentities ||
        before.liveSnapshots !== after.liveSnapshots ||
        before.gradeCalibrationSnapshots !== after.gradeCalibrationSnapshots ||
        after.historyPages !== before.distinctHistoryBodies ||
        after.historyObservations !== before.historyObservations ||
        after.timelineCacheRows !== 0 ||
        after.timelineSourceRows < before.currentTimelineSourceKeys ||
        after.timelineSourceRows >
          before.currentTimelineSourceKeys + before.timelineCacheRows ||
        after.selectedTimelines !== before.selectedTimelines ||
        promotedRawTimelines < 0 ||
        promotedRawTimelines > before.timelineCacheRawBodies ||
        after.rawTimelineObservations !==
          before.rawTimelineObservations + promotedRawTimelines ||
        sourceHashAfterMigration !== sourceHashBefore) {
      throw new Error("Migration rehearsal invariants failed")
    }

    process.stdout.write(`${JSON.stringify({
      sourceVersion,
      sourcePath: databasePath,
      sourceHashBefore,
      sourceHashAfterCopy,
      sourceHashAfterMigration,
      migratedVersion,
      quickCheck,
      foreignKeyViolations,
      before,
      after,
      beforeStorage,
      afterStorage,
    })}\n`)
  } finally {
    rehearsal.close()
  }
} finally {
  // Only remove the directory returned directly by mkdtemp in the OS temp
  // root. The explicit source database is opened read-only and never removed.
  if (path.dirname(rehearsalDirectory) === temporaryRoot) {
    rmSync(rehearsalDirectory, { recursive: true, force: true })
  }
}
