import Database from "better-sqlite3-node"
import { describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { ActiveGameRepository } from "../electron/main/database/active-game-repo.js"

describe("ActiveGameRepository", () => {
  it("restores only the small logical-game journal and can clear it idempotently", () => {
    const db = new Database(":memory:")
    applyMigrations(db)
    const repository = new ActiveGameRepository(db)
    repository.save("owner", {
      phase: "InProgress",
      gameId: 42,
      mapId: 11,
      queueId: 420,
      benchChampionIds: [],
      allies: [{ cellId: 0, championId: 154, championPickIntent: 154 }],
      enemies: [],
      game: {
        available: true,
        gameTime: 10,
        allies: [],
        enemies: [],
        events: [],
        updatedAt: 10,
      },
      updatedAt: 10,
    }, {
      stage: "tracking",
      gameId: 42,
      lcuConnected: true,
      portAvailable: true,
      startedAt: 1,
      trackingStartedAt: 2,
      lastLcuSeenAt: 8,
      lastPortSeenAt: 9,
    })

    expect(repository.getLatest()).toMatchObject({
      ownerPuuid: "owner",
      session: { phase: "InProgress", gameId: 42, mapId: 11, queueId: 420 },
      lifecycle: {
        stage: "tracking",
        gameId: 42,
        lcuConnected: false,
        portAvailable: false,
        trackingStartedAt: 2,
        lastLcuSeenAt: 8,
        lastPortSeenAt: 9,
      },
    })
    expect(repository.getLatest()?.session.game).toBeUndefined()

    repository.clear("owner")
    repository.clear("owner")
    expect(repository.getLatest()).toBeUndefined()
    db.close()
  })
})
