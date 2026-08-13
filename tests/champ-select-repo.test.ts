import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { ChampSelectRepository } from "../electron/main/database/champ-select-repo.js"

const PUUID = "test-puuid"

let repo: ChampSelectRepository

beforeEach(() => {
  const db = new Database(":memory:")
  applyMigrations(db)
  repo = new ChampSelectRepository(db)
})

describe("ChampSelectRepository", () => {
  it("reads assignments back by champion", () => {
    repo.record(7, PUUID, [
      { championId: 64, position: "JUNGLE" },
      { championId: 412, position: "UTILITY" },
    ])

    const positions = repo.positionsFor(7, PUUID)

    expect(positions.get(64)).toBe("JUNGLE")
    expect(positions.get(412)).toBe("UTILITY")
    expect(positions.size).toBe(2)
  })

  it("ignores players who never locked a champion", () => {
    expect(repo.record(7, PUUID, [
      { championId: 0, position: "TOP" },
      { championId: 64, position: "" },
    ])).toBe(0)
    expect(repo.positionsFor(7, PUUID).size).toBe(0)
  })

  it("keeps the latest assignment for a champion", () => {
    repo.record(7, PUUID, [{ championId: 64, position: "JUNGLE" }])
    repo.record(7, PUUID, [{ championId: 64, position: "TOP" }])

    expect(repo.positionsFor(7, PUUID).get(64)).toBe("TOP")
  })

  it("replaces an abandoned pick intent with the latest draft snapshot", () => {
    repo.record(7, PUUID, [
      { championId: 64, position: "JUNGLE" },
      { championId: 17, position: "TOP" },
    ])
    repo.record(7, PUUID, [
      { championId: 64, position: "JUNGLE" },
      { championId: 84, position: "TOP" },
    ])

    expect([...repo.positionsFor(7, PUUID)]).toEqual([
      [64, "JUNGLE"],
      [84, "TOP"],
    ])
  })

  it("keeps games and accounts apart", () => {
    repo.record(7, PUUID, [{ championId: 64, position: "JUNGLE" }])
    repo.record(8, PUUID, [{ championId: 64, position: "TOP" }])
    repo.record(7, "other", [{ championId: 64, position: "MIDDLE" }])

    expect(repo.positionsFor(7, PUUID).get(64)).toBe("JUNGLE")
    expect(repo.positionsFor(7, "other").get(64)).toBe("MIDDLE")
  })
})
