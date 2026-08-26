import Database from "better-sqlite3"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import type {
  DatabaseFailureReason,
  RecoveryBackupSummary,
  StartupState,
} from "../../../src/types/recovery.js"
import { DatabaseStartupError, isDatabaseCorruptionError } from "./connection.js"
import { inspectRecoveryBackupAsync } from "./backup-manager.js"

const MANIFEST_SUFFIX = ".manifest.json"

function nestedCode(error: unknown): string {
  if (!error || typeof error !== "object") return ""
  if ("code" in error && typeof error.code === "string") return error.code
  return error instanceof Error && error.cause ? nestedCode(error.cause) : ""
}

export function classifyDatabaseFailure(error: unknown): DatabaseFailureReason {
  const phase = error instanceof DatabaseStartupError ? error.phase : undefined
  const code = nestedCode(error)
  if (phase === "compatibility") return "newer_schema"
  if (isDatabaseCorruptionError(error)) return "corrupt"
  if (phase === "migration" || phase === "post-migration-integrity") {
    return "migration_failed"
  }
  if (/^(SQLITE_BUSY|SQLITE_LOCKED|SQLITE_PERM|SQLITE_READONLY|SQLITE_CANTOPEN)/.test(code)) {
    return "permission_or_lock"
  }
  if (/^(SQLITE_FULL|SQLITE_IOERR)/.test(code)) return "disk_or_io_error"
  return "unknown"
}

export function recoveryStartupState(
  error: unknown,
  databasePath: string,
  supportedSchemaVersion: number,
): StartupState {
  const reason = classifyDatabaseFailure(error)
  const messages: Record<DatabaseFailureReason, string> = {
    newer_schema: "This Recall build cannot open history written by a newer version.",
    corrupt: "Recall found damage in the active history database.",
    migration_failed: "Recall could not safely bring the active history database up to date.",
    permission_or_lock: "Recall cannot access the active history database right now.",
    disk_or_io_error: "Recall encountered a storage error while opening history.",
    unknown: "Recall could not safely open the active history database.",
  }
  return {
    kind: "recovery_required",
    reason,
    message: messages[reason],
    databasePath,
    supportedSchemaVersion,
  }
}

function digest(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    const input = createReadStream(filePath)
    input.on("data", (chunk) => hash.update(chunk))
    input.once("error", reject)
    input.once("end", () => resolve(hash.digest("hex")))
  })
}

function inspect(filePath: string, DatabaseClass: typeof Database) {
  const database = new DatabaseClass(filePath, { readonly: true, fileMustExist: true })
  try {
    const integrity = database.pragma("quick_check", { simple: true })
    if (integrity !== "ok") throw new Error(`SQLite quick_check failed: ${String(integrity)}`)
    const schemaVersion = Number(database.pragma("user_version", { simple: true }))
    const hasMatches = (database.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='matches'",
    ).get() as { count: number }).count > 0
    const matchCount = hasMatches
      ? (database.prepare("SELECT COUNT(*) AS count FROM matches").get() as { count: number }).count
      : 0
    return { schemaVersion, matchCount }
  } finally {
    database.close()
  }
}

interface RecoveryManifest {
  fileName: string
  createdAt: number
  sizeBytes: number
  sha256: string
}

function parseManifest(raw: unknown, fileName: string): RecoveryManifest | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const value = raw as Record<string, unknown>
  if (value.format !== "recall-managed-backup" || value.manifestVersion !== 2 ||
      value.fileName !== fileName || typeof value.createdAt !== "number" ||
      typeof value.sizeBytes !== "number" || typeof value.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.sha256)) return undefined
  return value as unknown as RecoveryManifest
}

function timestampFromName(fileName: string) {
  const match = /-(\d+)\.(?:db|bak)$/.exec(fileName)
  return match ? Number(match[1]) : 0
}

/**
 * Verifies backup files without blocking Electron's event loop on hashing.
 * Results are newest-first, with usable backups ahead of rejected entries at
 * the same timestamp so the default choice is always the latest safe point.
 */
export async function listRecoveryBackups(
  backupDir: string,
  supportedSchemaVersion: number,
  DatabaseClass: typeof Database = Database,
): Promise<RecoveryBackupSummary[]> {
  let names: string[]
  try {
    names = await readdir(backupDir)
  } catch {
    return []
  }
  const databaseNames = names.filter((name) =>
    /^stats-(?:\d+|[a-z-]+-\d+)\.(?:db|bak)$/.test(name))
  const entries: RecoveryBackupSummary[] = []

  for (const fileName of databaseNames) {
    const filePath = path.join(backupDir, fileName)
    let fileStats
    try {
      fileStats = await stat(filePath)
    } catch {
      entries.push({
        id: fileName, fileName, createdAt: timestampFromName(fileName), sizeBytes: 0,
        managed: false, status: "missing", detail: "The backup file is missing.",
      })
      continue
    }
    if (!fileStats.isFile()) continue

    const manifestPath = `${filePath}${MANIFEST_SUFFIX}`
    let manifest: RecoveryManifest | undefined
    const hasManifest = names.includes(`${fileName}${MANIFEST_SUFFIX}`)
    if (hasManifest) {
      try {
        manifest = parseManifest(JSON.parse(await readFile(manifestPath, "utf8")), fileName)
      } catch {
        manifest = undefined
      }
    }
    const createdAt = manifest?.createdAt ?? timestampFromName(fileName) ?? fileStats.mtimeMs
    try {
      if (hasManifest && !manifest) throw new Error("The backup manifest is invalid.")
      if (manifest) {
        if (manifest.sizeBytes !== fileStats.size) throw new Error("The backup size does not match its manifest.")
        if (await digest(filePath) !== manifest.sha256) throw new Error("The backup hash does not match its manifest.")
      }
      const details = DatabaseClass === Database
        ? await inspectRecoveryBackupAsync(filePath)
        : inspect(filePath, DatabaseClass)
      entries.push({
        id: fileName,
        fileName,
        createdAt,
        sizeBytes: fileStats.size,
        managed: Boolean(manifest),
        schemaVersion: details.schemaVersion,
        matchCount: details.matchCount,
        status: details.schemaVersion > supportedSchemaVersion ? "newer_schema" : "restorable",
        detail: details.schemaVersion > supportedSchemaVersion
          ? `Schema v${details.schemaVersion} requires a newer Recall build.`
          : undefined,
      })
    } catch (error) {
      entries.push({
        id: fileName, fileName, createdAt, sizeBytes: fileStats.size,
        managed: Boolean(manifest), status: "corrupt",
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return entries.sort((left, right) =>
    Number(right.status === "restorable") - Number(left.status === "restorable") ||
    right.createdAt - left.createdAt ||
    left.fileName.localeCompare(right.fileName))
}

export function resolveRecoveryBackup(backupDir: string, id: string) {
  if (id.includes("/") || id.includes("\\") || path.basename(id) !== id) {
    throw new Error("Invalid backup selection")
  }
  const root = path.resolve(backupDir)
  const selected = path.resolve(root, id)
  if (path.dirname(selected) !== root) throw new Error("Invalid backup selection")
  return selected
}
