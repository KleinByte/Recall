import Database from "better-sqlite3-node"
import { describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { MinimapTelemetryRepository } from "../electron/main/database/minimap-telemetry-repo.js"
import {
  deriveInitialJungleClear,
  FULL_CLEAR_CAMP_COUNT,
  INITIAL_CLEAR_WINDOW_MS,
} from "../src/shared/minimap/jungle-clear.js"
import type { CampClearEvent, CampKey } from "../src/shared/minimap/contracts.js"
import { buildMatchRow } from "./fixtures/matches.js"

function clear(
  campKey: CampKey,
  clearedAtMs: number,
  overrides: Partial<CampClearEvent> = {},
): CampClearEvent {
  return {
    gameId: 42,
    puuid: "test-puuid",
    campKey,
    clearedAtMs,
    source: "minimap_cv",
    sourceConfidence: .9,
    attribution: "local",
    attributionConfidence: .8,
    evidence: {
      campTransition: true,
      localPositionObserved: true,
      transitionConfidence: .9,
    },
    algorithmVersion: 3,
    ...overrides,
  }
}

describe("initial jungle clear summary", () => {
  it("uses the sixth unique local non-river camp as the full-clear clock time", () => {
    const result = deriveInitialJungleClear([
      clear("west_blue", 102_000),
      clear("west_gromp", 125_000),
      clear("north_scuttle", 185_000),
      clear("west_wolves", 148_000),
      clear("west_raptors", 168_000),
      clear("west_red", 191_000),
      clear("west_krugs", 214_000),
    ])

    expect(result.complete).toBe(true)
    expect(result.camps).toHaveLength(FULL_CLEAR_CAMP_COUNT)
    expect(result.camps.map((event) => event.campKey)).toEqual([
      "west_blue",
      "west_gromp",
      "west_wolves",
      "west_raptors",
      "west_red",
      "west_krugs",
    ])
    expect(result.clearTimeMs).toBe(214_000)
    expect(result.confidence).toBeCloseTo(.8)
  })

  it("keeps partial, duplicate, enemy-attributed, and late routes out of full-clear stats", () => {
    const result = deriveInitialJungleClear([
      clear("west_blue", 100_000),
      clear("west_blue", 240_000),
      clear("west_gromp", 125_000, { attribution: "other" }),
      clear("west_wolves", 150_000),
      clear("west_raptors", 170_000),
      clear("west_red", 195_000),
      clear("west_krugs", INITIAL_CLEAR_WINDOW_MS + 1),
    ])

    expect(result.complete).toBe(false)
    expect(result.clearTimeMs).toBeUndefined()
    expect(result.camps.map((event) => event.campKey)).toEqual([
      "west_blue",
      "west_wolves",
      "west_raptors",
      "west_red",
    ])
  })

  it("aggregates only the selected champion's recorded jungle games", () => {
    const db = new Database(":memory:")
    applyMigrations(db)
    const matches = new MatchesRepository(db)
    const telemetry = new MinimapTelemetryRepository(db)
    matches.insertMany([
      buildMatchRow({
        gameId: 100,
        championId: 103,
        mode: "sr_normal",
        modeFamily: "sr",
        gameMode: "CLASSIC",
        queueId: 400,
        resolvedPosition: "JUNGLE",
        playedAt: 3_000,
      }),
      buildMatchRow({
        gameId: 101,
        championId: 103,
        mode: "sr_normal",
        modeFamily: "sr",
        gameMode: "CLASSIC",
        queueId: 400,
        resolvedPosition: "JUNGLE",
        playedAt: 2_000,
      }),
      buildMatchRow({
        gameId: 102,
        championId: 103,
        mode: "sr_normal",
        modeFamily: "sr",
        gameMode: "CLASSIC",
        queueId: 400,
        resolvedPosition: "TOP",
        playedAt: 1_000,
      }),
    ])

    const route: CampKey[] = [
      "west_blue",
      "west_gromp",
      "west_wolves",
      "west_raptors",
      "west_red",
      "west_krugs",
    ]
    route.forEach((campKey, index) => telemetry.recordCampClear(clear(
      campKey,
      100_000 + index * 20_000,
      { gameId: 100, routeIndex: index },
    )))
    telemetry.recordCampClear(clear("east_blue", 110_000, { gameId: 101, routeIndex: 0 }))
    route.forEach((campKey, index) => telemetry.recordCampClear(clear(
      campKey,
      90_000 + index * 18_000,
      { gameId: 102, routeIndex: index },
    )))

    const stats = telemetry.getChampionJungleClearStats("test-puuid", 103)

    expect(stats).toMatchObject({
      championId: 103,
      jungleGames: 2,
      telemetryGames: 2,
      averageClearTimeMs: 200_000,
    })
    expect(stats.samples).toHaveLength(1)
    expect(stats.fastest?.gameId).toBe(100)
    expect(stats.longest?.gameId).toBe(100)
    db.close()
  })
})
