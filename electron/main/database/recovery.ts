import Database from "better-sqlite3"
import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs"
import path from "node:path"
import {
  openDatabase,
  type OpenDatabaseOptions,
} from "./connection.js"

const SQLITE_COMPANION_SUFFIXES = ["", "-wal", "-shm"] as const

interface RecoveryManifest {
  format: "recall-managed-backup"
  fileName: string
  sha256: string
  sizeBytes: number
  integrity: "ok"
}

export interface DatabaseRecovery {
  sourcePath: string
  quarantinedPath: string
}

export interface RecoveredDatabase {
  database: Database.Database
  recovery?: DatabaseRecovery
}

export function isDatabaseCorruptionError(error: unknown): boolean {
  const code = typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : ""
  const message = error instanceof Error ? error.message : String(error)
  return code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB" ||
    /(?:database disk image is malformed|file is not a database|quick_check failed)/i
      .test(message)
}

function timestampFromName(fileName: string): number {
  const match = /-(\d+)\.db$/.exec(fileName)
  return match ? Number(match[1]) : 0
}

function digest(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

function hasTrustedManifest(filePath: string): boolean {
  const manifestPath = `${filePath}.manifest.json`
  if (!existsSync(manifestPath)) return true

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as RecoveryManifest
    return manifest.format === "recall-managed-backup" &&
      manifest.fileName === path.basename(filePath) &&
      manifest.integrity === "ok" &&
      manifest.sizeBytes === statSync(filePath).size &&
      manifest.sha256 === digest(filePath)
  } catch {
    return false
  }
}

function recoveryCandidates(backupDir: string) {
  if (!existsSync(backupDir)) return []
  return readdirSync(backupDir)
    .filter((name) => /^stats-(?:\d+|[a-z-]+-\d+)\.db$/.test(name))
    .map((name) => {
      const filePath = path.join(backupDir, name)
      return {
        filePath,
        createdAt: timestampFromName(name) || statSync(filePath).mtimeMs,
      }
    })
    .sort((left, right) => right.createdAt - left.createdAt ||
      right.filePath.localeCompare(left.filePath))
}

function uniqueQuarantinePath(databasePath: string, now: number) {
  const first = `${databasePath}.corrupt-${now}`
  if (!SQLITE_COMPANION_SUFFIXES.some((suffix) => existsSync(`${first}${suffix}`))) {
    return first
  }
  let sequence = 1
  while (SQLITE_COMPANION_SUFFIXES.some(
    (suffix) => existsSync(`${first}-${sequence}${suffix}`),
  )) sequence += 1
  return `${first}-${sequence}`
}

function replaceCorruptGeneration(
  databasePath: string,
  stagingPath: string,
  now: number,
) {
  const quarantinePath = uniqueQuarantinePath(databasePath, now)
  const moved: Array<{ source: string; destination: string }> = []
  try {
    for (const suffix of SQLITE_COMPANION_SUFFIXES) {
      const source = `${databasePath}${suffix}`
      if (!existsSync(source)) continue
      const destination = `${quarantinePath}${suffix}`
      renameSync(source, destination)
      moved.push({ source, destination })
    }
    renameSync(stagingPath, databasePath)
    return quarantinePath
  } catch (error) {
    for (const entry of moved.reverse()) {
      if (existsSync(entry.destination) && !existsSync(entry.source)) {
        renameSync(entry.destination, entry.source)
      }
    }
    throw error
  }
}

/**
 * Finds the newest independently verified backup that this build can open.
 * Each candidate is migrated in a disposable copy before the damaged active
 * generation is preserved and atomically replaced.
 */
export function recoverCorruptDatabase(
  databasePath: string,
  backupDir: string,
  options: OpenDatabaseOptions = {},
): DatabaseRecovery | undefined {
  const DatabaseClass = options.DatabaseClass ?? Database
  const now = options.now ?? Date.now

  for (const candidate of recoveryCandidates(backupDir)) {
    if (!hasTrustedManifest(candidate.filePath)) continue
    const stagingPath = `${databasePath}.recovery-${process.pid}-${now()}`
    rmSync(stagingPath, { force: true })
    try {
      copyFileSync(candidate.filePath, stagingPath)
      const staged = openDatabase(stagingPath, {
        DatabaseClass,
        now,
        backupBeforeMigration: false,
      })
      staged.close()
      const quarantinedPath = replaceCorruptGeneration(
        databasePath,
        stagingPath,
        now(),
      )
      return { sourcePath: candidate.filePath, quarantinedPath }
    } catch {
      // A corrupt, incompatible, or unmigratable candidate is not last-known-good.
    } finally {
      for (const suffix of SQLITE_COMPANION_SUFFIXES) {
        rmSync(`${stagingPath}${suffix}`, { force: true })
      }
    }
  }
  return undefined
}

export function openDatabaseWithRecovery(
  databasePath: string,
  options: OpenDatabaseOptions & { backupDir: string },
): RecoveredDatabase {
  try {
    return { database: openDatabase(databasePath, options) }
  } catch (error) {
    if (!isDatabaseCorruptionError(error)) throw error
    const recovery = recoverCorruptDatabase(databasePath, options.backupDir, options)
    if (!recovery) throw error
    return {
      database: openDatabase(databasePath, options),
      recovery,
    }
  }
}
