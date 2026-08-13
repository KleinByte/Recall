import Database from "better-sqlite3-node"
import { describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { buildSkillReportFromDatabase } from "../electron/main/background/skill-report-database.js"

describe("background skill report database composition", () => {
  it("builds an empty report from one current-schema read snapshot", () => {
    const database = new Database(":memory:")
    applyMigrations(database)

    const report = buildSkillReportFromDatabase(database, {
      filter: { puuid: "owner" },
      family: "sr",
      generatedAt: 123,
    })

    expect(report).toMatchObject({
      generatedAt: 123,
      scope: { modes: [], family: "sr" },
      overview: { summary: { games: 0, wins: 0, losses: 0 } },
    })
    expect(database.inTransaction).toBe(false)
    database.close()
  })
})
