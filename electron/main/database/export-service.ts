import type { Database } from "better-sqlite3"
import { createHash, randomUUID } from "node:crypto"
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync,
  statSync, writeFileSync,
} from "node:fs"
import path from "node:path"
import { canonicalJson } from "./match-source-repo.js"
import type { RecallSettingsSnapshotV1 } from "../settings-store.js"

export interface RecallExportManifestV1 {
  format: "recall-full-backup"
  version: 1
  schemaVersion: number
  appVersion: string
  createdAt: number
  databaseFilename: "database.sqlite3"
  databaseBytes: number
  databaseSha256: string
  settingsFilename: "settings.json"
  settingsBytes: number
  settingsSha256: string
  includesOtherPlayerIdentities: true
  includesRawSourcePayloads: true
  includesApiKey: false
}

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")

function assertUnusedBundlePath(target: string) {
  if (!target.endsWith(".recall-backup")) throw new Error("full_backup_suffix_required")
  if (existsSync(target)) throw new Error("full_backup_target_exists")
  const parent = path.dirname(path.resolve(target))
  if (!existsSync(parent) || !statSync(parent).isDirectory()) throw new Error("full_backup_parent_missing")
}

export class ExportService {
  constructor(
    private readonly db: Database,
    private readonly databasePath: string,
    private readonly appVersion: string,
    private readonly now: () => number = Date.now,
  ) {}

  createFullBackup(target: string, settings: RecallSettingsSnapshotV1): RecallExportManifestV1 {
    const finalPath = path.resolve(target)
    assertUnusedBundlePath(finalPath)
    const tempPath = path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.tmp-${randomUUID()}`)
    const databaseFile = path.join(tempPath, "database.sqlite3")
    const settingsFile = path.join(tempPath, "settings.json")
    const manifestFile = path.join(tempPath, "manifest.json")
    mkdirSync(tempPath)
    try {
      const [checkpoint] = this.db.pragma("wal_checkpoint(TRUNCATE)") as { busy: number }[]
      if (checkpoint?.busy) throw new Error("database_busy")
      copyFileSync(this.databasePath, databaseFile)
      const databaseBytes = readFileSync(databaseFile)
      const settingsBytes = Buffer.from(canonicalJson(settings), "utf8")
      writeFileSync(settingsFile, settingsBytes, { flag: "wx" })
      const manifest: RecallExportManifestV1 = {
        format: "recall-full-backup",
        version: 1,
        schemaVersion: Number(this.db.pragma("user_version", { simple: true })),
        appVersion: this.appVersion,
        createdAt: this.now(),
        databaseFilename: "database.sqlite3",
        databaseBytes: databaseBytes.length,
        databaseSha256: hash(databaseBytes),
        settingsFilename: "settings.json",
        settingsBytes: settingsBytes.length,
        settingsSha256: hash(settingsBytes),
        includesOtherPlayerIdentities: true,
        includesRawSourcePayloads: true,
        includesApiKey: false,
      }
      writeFileSync(manifestFile, canonicalJson(manifest), { encoding: "utf8", flag: "wx" })
      renameSync(tempPath, finalPath)
      this.db.prepare(
        `INSERT INTO export_artifacts
         (kind, absolute_path, artifact_sha256, status, created_at, last_verified_at)
         VALUES ('full_backup', ?, ?, 'present', ?, ?)
         ON CONFLICT(absolute_path) DO UPDATE SET artifact_sha256=excluded.artifact_sha256,
           status='present', last_verified_at=excluded.last_verified_at`,
      ).run(finalPath, manifest.databaseSha256, manifest.createdAt, manifest.createdAt)
      return manifest
    } catch (error) {
      rmSync(tempPath, { recursive: true, force: true })
      throw error
    }
  }
}

export function validateFullBackupBundle(target: string): {
  manifest: RecallExportManifestV1
  settings: RecallSettingsSnapshotV1
  databasePath: string
} {
  const root = path.resolve(target)
  const names = ["database.sqlite3", "manifest.json", "settings.json"]
  const actual = readdirSync(root).sort()
  if (actual.join("\0") !== [...names].sort().join("\0")) throw new Error("invalid_bundle_members")
  for (const name of names) {
    const file = path.join(root, name)
    if (!statSync(file).isFile()) throw new Error("bundle_member_not_regular_file")
  }
  const manifestText = readFileSync(path.join(root, "manifest.json"), "utf8")
  const manifest = JSON.parse(manifestText) as RecallExportManifestV1
  if (canonicalJson(manifest) !== manifestText || manifest.format !== "recall-full-backup" ||
      manifest.version !== 1 || manifest.includesApiKey !== false ||
      manifest.includesOtherPlayerIdentities !== true || manifest.includesRawSourcePayloads !== true) {
    throw new Error("invalid_full_backup_manifest")
  }
  const database = readFileSync(path.join(root, "database.sqlite3"))
  const settingsBytes = readFileSync(path.join(root, "settings.json"))
  if (database.length !== manifest.databaseBytes || hash(database) !== manifest.databaseSha256 ||
      settingsBytes.length !== manifest.settingsBytes || hash(settingsBytes) !== manifest.settingsSha256) {
    throw new Error("full_backup_checksum_mismatch")
  }
  const settingsText = settingsBytes.toString("utf8")
  const settings = JSON.parse(settingsText) as RecallSettingsSnapshotV1
  if (canonicalJson(settings) !== settingsText || settings.format !== "recall-restorable-settings" ||
      settings.version !== 1) throw new Error("invalid_settings_snapshot")
  return { manifest, settings, databasePath: path.join(root, "database.sqlite3") }
}
