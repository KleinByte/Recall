import Database from "better-sqlite3-node"
import { describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { buildPerformanceProfileFromDatabase } from "../electron/main/background/performance-profile-database.js"

describe("background performance profile database composition", () => {
  it("returns no profile for an empty current-schema RVI snapshot", () => {
    const database = new Database(":memory:")
    applyMigrations(database)

    expect(buildPerformanceProfileFromDatabase(database, {
      filter: { puuid: "owner" },
      family: "sr",
    })).toBeUndefined()
    expect(database.inTransaction).toBe(false)
    database.close()
  })
})
