import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MasteryRepository } from "../electron/main/database/mastery-repo.js"

describe("MasteryRepository", () => {
  let db: Database.Database
  let repo: MasteryRepository

  beforeEach(() => {
    db = new Database(":memory:")
    applyMigrations(db)
    repo = new MasteryRepository(db)
  })

  it("caches a participant's champion mastery within the history owner", () => {
    repo.upsert("owner", "player", {
      championId: 103,
      championLevel: 12,
      championPoints: 345_678,
      championPointsSinceLastLevel: 9_000,
      championPointsUntilNextLevel: 1_000,
      tokensEarned: 2,
      highestGrade: "S+",
      updatedAt: 10_000,
    })

    expect(repo.get("owner", "player", 103)).toEqual({
      championId: 103,
      championLevel: 12,
      championPoints: 345_678,
      championPointsSinceLastLevel: 9_000,
      championPointsUntilNextLevel: 1_000,
      tokensEarned: 2,
      highestGrade: "S+",
      updatedAt: 10_000,
    })
    expect(repo.get("another-owner", "player", 103)).toBeUndefined()
  })

  it("updates snapshots and removes all cache rows for one owner", () => {
    const snapshot = {
      championId: 1,
      championLevel: 4,
      championPoints: 12_000,
      championPointsSinceLastLevel: 0,
      championPointsUntilNextLevel: 0,
      tokensEarned: 0,
      updatedAt: 1,
    }
    repo.upsert("owner", "player", snapshot)
    repo.upsert("owner", "player", { ...snapshot, championPoints: 13_000, updatedAt: 2 })

    expect(repo.get("owner", "player", 1)?.championPoints).toBe(13_000)
    expect(db.prepare("DELETE FROM champion_mastery_cache WHERE owner_puuid = ?")
      .run("owner").changes).toBe(1)
    expect(repo.get("owner", "player", 1)).toBeUndefined()
  })
})
