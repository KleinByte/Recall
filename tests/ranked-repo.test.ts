import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { RankedRepository } from "../electron/main/database/ranked-repo.js"
import { rankToPoints, formatRank } from "../electron/main/ranked/rank.js"
import type { RankedSnapshot } from "../electron/main/ranked/rank.js"

const PUUID = "test-puuid"

let repo: RankedRepository

beforeEach(() => {
  const db = new Database(":memory:")
  applyMigrations(db)
  repo = new RankedRepository(db)
})

const snapshot = (overrides: Partial<RankedSnapshot> = {}): RankedSnapshot => ({
  puuid: PUUID,
  queue: "RANKED_SOLO_5x5",
  recordedAt: 1_000,
  tier: "GOLD",
  division: "II",
  leaguePoints: 40,
  wins: 20,
  losses: 15,
  ...overrides,
})

describe("rankToPoints", () => {
  it("climbs with league points", () => {
    expect(rankToPoints("GOLD", "II", 40)).toBeGreaterThan(
      rankToPoints("GOLD", "II", 10),
    )
  })

  it("climbs with divisions", () => {
    expect(rankToPoints("GOLD", "I", 0)).toBeGreaterThan(
      rankToPoints("GOLD", "II", 99),
    )
  })

  it("climbs with tiers", () => {
    expect(rankToPoints("PLATINUM", "IV", 0)).toBeGreaterThan(
      rankToPoints("GOLD", "I", 99),
    )
  })

  it("keeps the apex tiers above diamond", () => {
    expect(rankToPoints("MASTER", "I", 0)).toBeGreaterThan(
      rankToPoints("DIAMOND", "I", 99),
    )
    expect(rankToPoints("CHALLENGER", "I", 500)).toBeGreaterThan(
      rankToPoints("GRANDMASTER", "I", 500),
    )
  })

  it("treats an unranked player as zero", () => {
    expect(rankToPoints("NONE", "", 0)).toBe(0)
    expect(rankToPoints("", "", 0)).toBe(0)
  })
})

describe("formatRank", () => {
  it("reads as the client shows it", () => {
    expect(formatRank("GOLD", "II")).toBe("Gold II")
  })

  it("leaves out the division for the apex tiers", () => {
    expect(formatRank("MASTER", "I")).toBe("Master")
  })
})

describe("RankedRepository", () => {
  it("records a snapshot", () => {
    expect(repo.recordSnapshot(snapshot())).toBe(true)
    expect(repo.getHistory(PUUID, "RANKED_SOLO_5x5")).toHaveLength(1)
  })

  it("ignores a snapshot that has not moved", () => {
    repo.recordSnapshot(snapshot())

    expect(repo.recordSnapshot(snapshot({ recordedAt: 2_000 }))).toBe(false)
    expect(repo.getHistory(PUUID, "RANKED_SOLO_5x5")).toHaveLength(1)
  })

  it("records a snapshot once the league points move", () => {
    repo.recordSnapshot(snapshot())

    expect(
      repo.recordSnapshot(snapshot({ recordedAt: 2_000, leaguePoints: 62 })),
    ).toBe(true)
    expect(repo.getHistory(PUUID, "RANKED_SOLO_5x5")).toHaveLength(2)
  })

  it("records a demotion as readily as a promotion", () => {
    repo.recordSnapshot(snapshot({ tier: "GOLD", division: "I" }))

    expect(
      repo.recordSnapshot(
        snapshot({ recordedAt: 2_000, tier: "GOLD", division: "II" }),
      ),
    ).toBe(true)
  })

  it("keeps the queues apart", () => {
    repo.recordSnapshot(snapshot())
    repo.recordSnapshot(snapshot({ queue: "RANKED_FLEX_SR" }))

    expect(repo.getHistory(PUUID, "RANKED_SOLO_5x5")).toHaveLength(1)
    expect(repo.getHistory(PUUID, "RANKED_FLEX_SR")).toHaveLength(1)
  })

  it("returns history oldest first, for a graph", () => {
    repo.recordSnapshot(snapshot({ recordedAt: 5_000, leaguePoints: 10 }))
    repo.recordSnapshot(snapshot({ recordedAt: 1_000, leaguePoints: 40 }))

    const history = repo.getHistory(PUUID, "RANKED_SOLO_5x5")

    expect(history.map((row) => row.recordedAt)).toEqual([1_000, 5_000])
  })

  it("lists the queues it holds history for", () => {
    repo.recordSnapshot(snapshot())
    repo.recordSnapshot(snapshot({ queue: "RANKED_FLEX_SR" }))

    expect(repo.getQueues(PUUID).sort()).toEqual([
      "RANKED_FLEX_SR",
      "RANKED_SOLO_5x5",
    ])
  })

  it("reports the latest standing per queue", () => {
    repo.recordSnapshot(snapshot({ recordedAt: 1_000, leaguePoints: 10 }))
    repo.recordSnapshot(snapshot({ recordedAt: 9_000, leaguePoints: 80 }))

    expect(repo.getLatest(PUUID, "RANKED_SOLO_5x5")!.leaguePoints).toBe(80)
  })
})
