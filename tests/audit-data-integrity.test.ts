import Database from "better-sqlite3-node"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  applyMigrations,
  latestSchemaVersion,
} from "../electron/main/database/migrations.js"

let root: string
let databasePath: string

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "recall-integrity-audit-"))
  databasePath = path.join(root, "stats.db")
  const db = new Database(databasePath)
  applyMigrations(db)
  db.close()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("data-integrity audit", () => {
  it("audits a current-schema database using storage-partition terminology", () => {
    const result = spawnSync(
      process.execPath,
      [path.resolve("scripts/audit-data-integrity.mjs"), "--db", databasePath],
      { cwd: process.cwd(), encoding: "utf8" },
    )

    expect(result.status, result.stderr).toBe(0)
    const report = JSON.parse(result.stdout) as Record<string, unknown>
    expect(report).toMatchObject({
      schemaRevision: latestSchemaVersion,
      quickCheck: "ok",
      foreignKeyViolations: 0,
      orphanGradeResults: 0,
      partialGradePairs: 0,
      readyGradeResultsWithoutBreakdown: 0,
      gradeBreakdownsWithoutResult: 0,
      gradeStoragePartitionDistribution: [],
      rviStoragePartitionDistribution: [],
    })
    expect(report).not.toHaveProperty("schemaVersion")
    expect(report).not.toHaveProperty("invalidJsonRows")
    expect(report).not.toHaveProperty("gradeVersionDistribution")
  })
})
