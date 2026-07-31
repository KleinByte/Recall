// The `better-sqlite3` copy is rebuilt against the Electron ABI for the packaged
// app, so it cannot load in the Node-based test runner. `better-sqlite3-node` is
// the same version left at the Node ABI, used only by tests.
import Database from "better-sqlite3-node"
import { describe, expect, it } from "vitest"
import {
  applyMigrations,
  latestSchemaVersion,
  migrations,
} from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { buildMatchRow } from "./fixtures/matches.js"

describe("applyMigrations", () => {
  it("keeps migration versions unique, ordered, and contiguous", () => {
    expect(migrations.map((migration) => migration.version)).toEqual(
      Array.from({ length: latestSchemaVersion }, (_, index) => index + 1),
    )
  })

  it("creates the matches table and sets the schema version", () => {
    const db = new Database(":memory:")
    const version = applyMigrations(db)

    expect(version).toBeGreaterThan(0)
    expect(db.pragma("user_version", { simple: true })).toBe(version)

    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'matches'",
      )
      .get()

    expect(table).toBeDefined()
  })

  it("is a no-op when run a second time", () => {
    const db = new Database(":memory:")
    const first = applyMigrations(db)
    const second = applyMigrations(db)

    expect(second).toBe(first)
  })

  it("marks already-recorded bot queues as ineligible without deleting them", () => {
    const db = new Database(":memory:")
    applyMigrations(db)
    const repo = new MatchesRepository(db)
    repo.insertMany([
      buildMatchRow({ gameId: 1, queueId: 890, isMatched: 1 }),
      buildMatchRow({ gameId: 2, queueId: 450, isMatched: 1 }),
    ])

    db.pragma("user_version = 11")
    applyMigrations(db)

    expect(
      db.prepare(
        `SELECT game_id AS gameId, is_matched AS isMatched
         FROM matches ORDER BY game_id`,
      ).all(),
    ).toEqual([
      { gameId: 1, isMatched: 0 },
      { gameId: 2, isMatched: 1 },
    ])
  })

  it("upgrades every historical schema version to the latest", () => {
    for (let version = 1; version < latestSchemaVersion; version += 1) {
      const db = new Database(":memory:")
      for (const migration of migrations.slice(0, version)) {
        db.exec(migration.up)
      }
      db.pragma(`user_version = ${version}`)

      expect(() => applyMigrations(db)).not.toThrow()
      expect(db.pragma("user_version", { simple: true })).toBe(
        latestSchemaVersion,
      )
      expect(db.pragma("integrity_check", { simple: true })).toBe("ok")
      db.close()
    }
  })

  it("adds grade columns", () => {
    const db = new Database(":memory:")
    applyMigrations(db)

    const columns = (
      db.pragma("table_info(matches)") as { name: string }[]
    ).map((column) => column.name)

    expect(columns).toContain("grade")
    expect(columns).toContain("grade_score")
  })

  it("adds account-scoped review tables and canonical Riot match ids", () => {
    const db = new Database(":memory:")
    applyMigrations(db)
    const matchColumns = (
      db.pragma("table_info(matches)") as { name: string }[]
    ).map((column) => column.name)
    expect(matchColumns).toContain("riot_match_id")
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string
      }[]
    ).map((row) => row.name)
    expect(tables).toEqual(expect.arrayContaining([
      "riot_accounts",
      "sync_health",
      "match_grade_breakdowns",
      "session_boundary_overrides",
      "match_timeline_cache",
      "match_annotations",
      "annotation_tags",
      "practice_experiments",
      "match_experiments",
      "participant_augments",
      "augment_catalog",
      "match_capture_manifests",
      "augment_enrichment_jobs",
    ]))
    const participantColumns = (
      db.pragma("table_info(match_participants)") as { name: string }[]
    ).map((column) => column.name)
    expect(participantColumns).toContain("extended_metrics_json")
  })

  it("upgrades an existing database without losing recorded games", () => {
    const db = new Database(":memory:")

    // A database created before grading existed.
    db.exec(migrations[0].up)
    db.pragma("user_version = 1")
    db.prepare(
      `INSERT INTO matches (
         game_id, puuid, queue_id, game_mode, mode, is_matched, played_at,
         duration_secs, game_version, champion_id, win, kills, deaths, assists,
         champ_level, gold_earned, damage_to_champions, damage_taken,
         damage_self_mitigated, total_heal, total_units_healed,
         time_ccing_others, largest_killing_spree, largest_multi_kill,
         double_kills, triple_kills, quadra_kills, penta_kills,
         total_minions_killed, vision_score, ended_in_surrender,
         ended_in_early_surrender
       ) VALUES (1, 'p', 450, 'ARAM', 'aram', 1, 1, 1, 'v', 84, 1,
                 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0)`,
    ).run()

    applyMigrations(db)

    const row = db
      .prepare("SELECT game_id, grade FROM matches WHERE game_id = 1")
      .get() as { game_id: number; grade: string | null }

    expect(row.game_id).toBe(1)
    expect(row.grade).toBeNull()
  })

  it("preserves recorded ARAM games when upgrading to multi-mode", () => {
    const db = new Database(":memory:")

    // A database from before Summoner's Rift was tracked.
    db.exec(migrations[0].up)
    db.exec(migrations[1].up)
    db.pragma("user_version = 2")
    db.prepare(
      `INSERT INTO matches (
         game_id, puuid, queue_id, game_mode, mode, is_matched, played_at,
         duration_secs, game_version, champion_id, win, kills, deaths, assists,
         champ_level, gold_earned, damage_to_champions, damage_taken,
         damage_self_mitigated, total_heal, total_units_healed,
         time_ccing_others, largest_killing_spree, largest_multi_kill,
         double_kills, triple_kills, quadra_kills, penta_kills,
         total_minions_killed, vision_score, ended_in_surrender,
         ended_in_early_surrender, grade, grade_score
       ) VALUES (7, 'p', 2400, 'KIWI', 'mayhem', 1, 99, 1200, 'v', 84, 1,
                 10, 5, 15, 18, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
                 0, 0, 'S+', 1.8)`,
    ).run()

    applyMigrations(db)

    const row = db
      .prepare(
        "SELECT mode, mode_family, is_ranked, grade, kills FROM matches WHERE game_id = 7",
      )
      .get() as Record<string, unknown>

    expect(row.mode).toBe("mayhem")
    expect(row.mode_family).toBe("aram")
    expect(row.is_ranked).toBe(0)
    // The grade and stats recorded earlier must survive untouched.
    expect(row.grade).toBe("S+")
    expect(row.kills).toBe(10)
  })

  it("creates the challenge and profile tables", () => {
    const db = new Database(":memory:")
    applyMigrations(db)

    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((row) => row.name)

    expect(tables).toContain("challenges")
    expect(tables).toContain("challenge_history")
    expect(tables).toContain("profile_snapshots")
    expect(tables).toContain("riot_history_backfill")
  })

  it("fills in per-minute rates for games recorded before those columns existed", () => {
    const db = new Database(":memory:")

    // A database from before multi-mode tracking, where cs and gold per minute
    // were added as empty columns and never worked out for existing games.
    db.exec(migrations[0].up)
    db.exec(migrations[1].up)
    db.pragma("user_version = 2")
    db.prepare(
      `INSERT INTO matches (
         game_id, puuid, queue_id, game_mode, mode, is_matched, played_at,
         duration_secs, game_version, champion_id, win, kills, deaths, assists,
         champ_level, gold_earned, damage_to_champions, damage_taken,
         damage_self_mitigated, total_heal, total_units_healed,
         time_ccing_others, largest_killing_spree, largest_multi_kill,
         double_kills, triple_kills, quadra_kills, penta_kills,
         total_minions_killed, vision_score, ended_in_surrender,
         ended_in_early_surrender, grade, grade_score
       ) VALUES (7, 'p', 2400, 'KIWI', 'mayhem', 1, 99, 1200, 'v', 84, 1,
                 10, 5, 15, 18, 12000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 60,
                 1, 0, 0, 'S+', 1.8)`,
    ).run()

    applyMigrations(db)

    const row = db
      .prepare(
        "SELECT cs_per_min AS cs, gold_per_min AS gold FROM matches WHERE game_id = 7",
      )
      .get() as { cs: number; gold: number }

    // 60 minions and 12,000 gold across a 20 minute game.
    expect(row.cs).toBeCloseTo(3)
    expect(row.gold).toBeCloseTo(600)
  })

  it("leaves a game of no length alone rather than dividing by zero", () => {
    const db = new Database(":memory:")

    db.exec(migrations[0].up)
    db.exec(migrations[1].up)
    db.pragma("user_version = 2")
    db.prepare(
      `INSERT INTO matches (
         game_id, puuid, queue_id, game_mode, mode, is_matched, played_at,
         duration_secs, game_version, champion_id, win, kills, deaths, assists,
         champ_level, gold_earned, damage_to_champions, damage_taken,
         damage_self_mitigated, total_heal, total_units_healed,
         time_ccing_others, largest_killing_spree, largest_multi_kill,
         double_kills, triple_kills, quadra_kills, penta_kills,
         total_minions_killed, vision_score, ended_in_surrender,
         ended_in_early_surrender
       ) VALUES (8, 'p', 450, 'ARAM', 'aram', 1, 1, 0, 'v', 84, 1,
                 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)`,
    ).run()

    expect(() => applyMigrations(db)).not.toThrow()

    const row = db
      .prepare("SELECT cs_per_min AS cs FROM matches WHERE game_id = 8")
      .get() as { cs: number | null }

    // Nothing sensible to record for a game that never started.
    expect(row.cs).toBeNull()
  })
})
