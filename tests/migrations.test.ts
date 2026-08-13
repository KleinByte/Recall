// The `better-sqlite3` copy is rebuilt against the Electron ABI for the packaged
// app, so it cannot load in the Node-based test runner. `better-sqlite3-node` is
// the same version left at the Node ABI, used only by tests.
import Database from "better-sqlite3-node"
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  applyMigrations,
  executeMigration,
  latestSchemaVersion,
  migrations,
} from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { buildMatchRow } from "./fixtures/matches.js"
import { migrationRehearsalCounts } from "../scripts/migration-rehearsal-contract.js"
import {
  decodeStoredJsonBody,
  type StoredJsonBodyRow,
} from "../electron/main/database/json-body-codec.js"

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
    for (const migration of migrations.slice(0, 11)) executeMigration(db, migration)
    db.pragma("user_version = 11")
    const repo = new MatchesRepository(db)
    repo.insertMany([
      buildMatchRow({ gameId: 1, queueId: 890, isMatched: 1 }),
      buildMatchRow({ gameId: 2, queueId: 450, isMatched: 1 }),
    ])
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

  it("moves already-recorded Jade games into the League Classic family", () => {
    const db = new Database(":memory:")
    for (const migration of migrations.slice(0, 16)) executeMigration(db, migration)
    db.pragma("user_version = 16")
    const repo = new MatchesRepository(db)
    repo.insertMany([
      buildMatchRow({
        gameId: 1,
        queueId: 4300,
        gameMode: "JADE",
        mode: "sr_normal",
        modeFamily: "sr",
        queueName: "5v5 Jade",
      }),
      buildMatchRow({
        gameId: 2,
        queueId: 4320,
        gameMode: "JADE",
        mode: "other",
        modeFamily: "other",
        isMatched: 1,
      }),
    ])

    applyMigrations(db)

    expect(db.prepare(
      `SELECT game_id AS gameId, mode, mode_family AS family,
              is_matched AS isMatched
       FROM matches ORDER BY game_id`,
    ).all()).toEqual([
      { gameId: 1, mode: "league_classic", family: "classic", isMatched: 1 },
      { gameId: 2, mode: "league_classic", family: "classic", isMatched: 0 },
    ])
  })

  it("upgrades every historical schema version to the latest", () => {
    for (let version = 1; version < latestSchemaVersion; version += 1) {
      const db = new Database(":memory:")
      for (const migration of migrations.slice(0, version)) {
        executeMigration(db, migration)
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

  it("compresses v30 snapshot bodies without changing JSON bytes or identity", () => {
    const db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    for (const migration of migrations.slice(0, 30)) executeMigration(db, migration)
    db.pragma("user_version = 30")
    const liveJson = '{"z":"召唤师","activePlayer":{"runes":{"statRuneIds":[5001]}}}'
    const calibrationJson = '{ "clusterIds": [], "z": 1 }'
    db.prepare(`
      INSERT INTO live_game_snapshots
        (game_id, puuid, game_time_ms, captured_at, reason, snapshot_json)
      VALUES (77, 'migration-owner', 1234, 5678, 'state_change', ?)
    `).run(liveJson)
    db.prepare(`
      INSERT INTO grade_calibration_snapshots
        (calibration_id, calibration_hash, reference_population_json,
         sample_count, snapshot_json, created_at)
      VALUES ('calibration:migration', ?, '{"mode":"aram"}', 9, ?, 8765)
    `).run("c".repeat(64), calibrationJson)
    db.prepare(`
      INSERT INTO grade_recipes
        (recipe_id, algorithm_version, recipe_hash, calibration_id,
         definition_json, created_at)
      VALUES ('grade:migration', 3, ?, 'calibration:migration', '{}', 9000)
    `).run("d".repeat(64))

    applyMigrations(db)

    const live = db.prepare(`
      SELECT snapshot_encoding AS snapshotEncoding,
             snapshot_uncompressed_bytes AS snapshotUncompressedBytes,
             snapshot_compressed_bytes AS snapshotCompressedBytes,
             snapshot_sha256 AS snapshotSha256,
             snapshot_payload AS snapshotPayload,
             has_active_player_stat_runes AS hasStatRunes,
             captured_at AS capturedAt, reason
      FROM live_game_snapshots WHERE game_id = 77
    `).get() as StoredJsonBodyRow & {
      hasStatRunes: number
      capturedAt: number
      reason: string
    }
    const calibration = db.prepare(`
      SELECT snapshot_encoding AS snapshotEncoding,
             snapshot_uncompressed_bytes AS snapshotUncompressedBytes,
             snapshot_compressed_bytes AS snapshotCompressedBytes,
             snapshot_sha256 AS snapshotSha256,
             snapshot_payload AS snapshotPayload,
             calibration_hash AS calibrationHash,
             reference_population_json AS referencePopulationJson,
             sample_count AS sampleCount, created_at AS createdAt
      FROM grade_calibration_snapshots WHERE calibration_id = 'calibration:migration'
    `).get() as StoredJsonBodyRow & {
      calibrationHash: string
      referencePopulationJson: string
      sampleCount: number
      createdAt: number
    }

    expect(decodeStoredJsonBody(live).text).toBe(liveJson)
    expect(live).toMatchObject({
      hasStatRunes: 1,
      capturedAt: 5678,
      reason: "state_change",
      snapshotUncompressedBytes: Buffer.byteLength(liveJson),
      snapshotSha256: createHash("sha256").update(liveJson).digest("hex"),
    })
    expect(decodeStoredJsonBody(calibration).text).toBe(calibrationJson)
    expect(calibration).toMatchObject({
      calibrationHash: "c".repeat(64),
      referencePopulationJson: '{"mode":"aram"}',
      sampleCount: 9,
      createdAt: 8765,
      snapshotUncompressedBytes: Buffer.byteLength(calibrationJson),
      snapshotSha256: createHash("sha256").update(calibrationJson).digest("hex"),
    })
    expect(db.pragma("foreign_key_check")).toEqual([])
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1)
    expect(db.prepare(`
      SELECT name FROM sqlite_master
      WHERE name IN ('live_game_snapshots_v31', 'grade_calibration_snapshots_v31')
    `).all()).toEqual([])
    expect(() => db.prepare(`
      UPDATE grade_calibration_snapshots SET sample_count = 10
      WHERE calibration_id = 'calibration:migration'
    `).run()).toThrow("immutable")
    db.close()
  })

  it("rolls v31 back atomically when a legacy live body is invalid JSON", () => {
    const db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    for (const migration of migrations.slice(0, 30)) executeMigration(db, migration)
    db.pragma("user_version = 30")
    db.prepare(`
      INSERT INTO live_game_snapshots
        (game_id, puuid, game_time_ms, captured_at, reason, snapshot_json)
      VALUES (1, 'owner', 1, 1, 'first', 'not-json')
    `).run()

    expect(() => applyMigrations(db)).toThrow("live_game_snapshot_body_invalid")
    expect(db.pragma("user_version", { simple: true })).toBe(30)
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1)
    expect(db.prepare(`
      SELECT snapshot_json AS snapshotJson FROM live_game_snapshots
    `).get()).toEqual({ snapshotJson: "not-json" })
    expect(db.prepare(`
      SELECT name FROM sqlite_master
      WHERE name IN ('live_game_snapshots_v31', 'grade_calibration_snapshots_v31')
    `).all()).toEqual([])
    db.close()
  })

  it("rehearses populated schemas that predate participants and source payloads", () => {
    const db = new Database(":memory:")
    executeMigration(db, migrations[0])
    db.pragma("user_version = 1")
    new MatchesRepository(db).insertMany([buildMatchRow({ gameId: 7 })])

    expect(migrationRehearsalCounts(db)).toEqual({
      matches: 1,
      participants: 0,
      historyPages: 0,
      distinctHistoryBodies: 0,
      historyObservations: 0,
      metricObservations: 0,
      metricRecipeIdentities: 0,
      liveSnapshots: 0,
      gradeCalibrationSnapshots: 0,
      timelineCacheRows: 0,
      timelineCacheRawBodies: 0,
      timelineSourceRows: 0,
      timelineSourceKeys: 0,
      currentTimelineSourceKeys: 0,
      selectedTimelines: 0,
      rawTimelineBodies: 0,
      rawTimelineObservations: 0,
    })
    applyMigrations(db)
    expect(migrationRehearsalCounts(db)).toMatchObject({
      matches: 1,
      participants: 0,
      historyPages: 0,
      historyObservations: 0,
    })
    db.close()
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
      "match_timeline_sources",
      "match_annotations",
      "annotation_tags",
      "practice_experiments",
      "match_experiments",
      "participant_augments",
      "augment_catalog",
      "match_capture_manifests",
      "augment_enrichment_jobs",
      "live_game_snapshots",
      "live_game_events",
      "champ_select_positions",
    ]))
    const participantColumns = (
      db.pragma("table_info(match_participants)") as { name: string }[]
    ).map((column) => column.name)
    expect(participantColumns).toContain("extended_metrics_json")
    expect(participantColumns).toContain("assigned_position")
    expect(db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'match_timeline_cache'
    `).get()).toBeUndefined()
    expect(db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'view' AND name = 'selected_match_timelines'
    `).get()).toEqual({ name: "selected_match_timelines" })
  })

  it("upgrades an existing database without losing recorded games", () => {
    const db = new Database(":memory:")

    // A database created before grading existed.
    executeMigration(db, migrations[0])
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
    executeMigration(db, migrations[0])
    executeMigration(db, migrations[1])
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

  it("creates immutable exact-recipe RVI metric persistence", () => {
    const db = new Database(":memory:")
    applyMigrations(db)

    const tables = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all() as { name: string }[]).map((row) => row.name)
    expect(tables).toEqual(expect.arrayContaining([
      "rvi_recipes",
      "rvi_recipe_storage_keys",
      "rvi_recipe_selections",
      "match_metric_observations",
    ]))

    const indices = (db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'index'
        AND tbl_name = 'match_metric_observations'
    `).all() as { name: string }[]).map((row) => row.name)
    expect(indices).toEqual(expect.arrayContaining([
      "idx_metric_observations_owner_recipe_history",
      "idx_metric_observations_match_recipe_detail",
    ]))

    const observationColumns = (db.pragma(
      "table_info(match_metric_observations)",
    ) as { name: string }[]).map((column) => column.name)
    expect(observationColumns).toEqual(expect.arrayContaining([
      "recipe_key",
      "raw_evidence_state",
      "raw_value",
      "score_evidence_state",
      "score_value",
      "comparison_scope",
      "reference_match_count",
      "source_quality",
      "derivation_id",
    ]))
    expect(observationColumns).not.toEqual(expect.arrayContaining([
      "algorithm_version",
      "recipe_id",
      "calibration_id",
    ]))

    const detailColumns = (db.pragma(
      "table_info(match_metric_observation_details)",
    ) as { name: string }[]).map((column) => column.name)
    expect(detailColumns).toEqual([
      "game_id", "puuid", "participant_id", "algorithm_version", "recipe_id",
      "calibration_id", "metric_key", "raw_evidence_state",
      "raw_evidence_reason", "raw_value", "score_evidence_state",
      "score_evidence_reason", "score_value", "numerator", "denominator",
      "opportunity_count", "unit", "comparison_scope", "reference_match_count",
      "source", "source_quality", "derivation_id", "derived_at",
    ])
  })

  it("compacts populated v29 metric recipes without changing their public rows", () => {
    const db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    for (const migration of migrations.slice(0, 29)) executeMigration(db, migration)
    db.pragma("user_version = 29")

    new MatchesRepository(db).insertMany([
      buildMatchRow({ gameId: 99, puuid: "metric-owner" }),
    ])
    db.prepare(`
      INSERT INTO match_participants
        (game_id, puuid, participant_id, team_id, is_player, champion_id, win,
         kills, deaths, assists, gold_earned, damage_to_champions, damage_taken,
         damage_self_mitigated, total_heal, time_ccing_others,
         total_minions_killed, neutral_minions, vision_score, damage_objectives)
      VALUES (99, 'metric-owner', 1, 100, 1, 84, 1,
              2, 2, 2, 10000, 10000, 10000, 5000, 1000, 5, 50, 0, 10, 1000)
    `).run()
    db.prepare(`
      INSERT INTO grade_calibration_snapshots
        (calibration_id, calibration_hash, reference_population_json,
         sample_count, snapshot_json, created_at)
      VALUES ('calibration:test', ?, '{}', 1, '{}', 1000)
    `).run("c".repeat(64))
    db.prepare(`
      INSERT INTO grade_recipes
        (recipe_id, algorithm_version, recipe_hash, calibration_id,
         definition_json, created_at)
      VALUES ('grade:test', 3, ?, 'calibration:test', '{}', 1000)
    `).run("f".repeat(64))
    db.prepare(`
      INSERT INTO rvi_recipes
        (recipe_id, algorithm_version, recipe_hash, grade_recipe_id,
         calibration_id, definition_json, created_at)
      VALUES ('rvi:test-a', 3, ?, 'grade:test', 'calibration:test', '{}', 1000)
    `).run("a".repeat(64))
    db.prepare(`
      INSERT INTO rvi_recipe_selections
        (algorithm_version, recipe_id, selected_at)
      VALUES (3, 'rvi:test-a', 1000)
    `).run()
    db.prepare(`
      INSERT INTO match_metric_observations
        (game_id, puuid, participant_id, algorithm_version, recipe_id,
         calibration_id, metric_key, raw_evidence_state, raw_evidence_reason,
         raw_value, score_evidence_state, score_evidence_reason, score_value,
         numerator, denominator, opportunity_count, unit, comparison_scope,
         reference_match_count, source, source_quality, derivation_id, derived_at)
      VALUES (99, 'metric-owner', 1, 3, 'rvi:test-a', 'calibration:test',
              'damage_share', 'observed', NULL, 0.4, 'observed', NULL, 0.6,
              4, 10, NULL, 'ratio', 'position', 30, 'scoreboard', 'verified',
              'summary', 1234)
    `).run()

    const before = db.prepare(
      "SELECT * FROM match_metric_observations",
    ).all()
    expect(applyMigrations(db)).toBe(latestSchemaVersion)
    expect(db.prepare(
      "SELECT * FROM match_metric_observation_details",
    ).all()).toEqual(before)
    expect(db.pragma("foreign_key_check")).toEqual([])

    expect(db.prepare(`
      SELECT COUNT(*) AS count,
             COUNT(DISTINCT recipe_key) AS recipeKeys
      FROM match_metric_observations
    `).get()).toEqual({ count: 1, recipeKeys: 1 })

    db.prepare(`
      INSERT INTO rvi_recipes
        (recipe_id, algorithm_version, recipe_hash, grade_recipe_id,
         calibration_id, definition_json, created_at)
      VALUES ('rvi:test-b', 3, ?, 'grade:test', 'calibration:test', '{}', 2000)
    `).run("b".repeat(64))
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM rvi_recipe_storage_keys
      WHERE recipe_id IN ('rvi:test-a', 'rvi:test-b')
    `).get()).toEqual({ count: 2 })

    expect(() => db.prepare(`
      UPDATE rvi_recipe_selections
      SET recipe_id = 'rvi:test-b' WHERE algorithm_version = 3
    `).run()).toThrow("rvi_recipe_purge_required")
    expect(() => db.prepare(`
      INSERT INTO match_metric_observations
        (game_id, puuid, participant_id, recipe_key, metric_key,
         raw_evidence_state, raw_value, score_evidence_state, score_value,
         unit, source, source_quality, derivation_id, derived_at)
      SELECT 99, 'metric-owner', 1, recipe_key, 'time_dead_share',
             'observed', 0.1, 'observed', 0.2, 'ratio', 'scoreboard',
             'verified', 'summary', 2000
      FROM rvi_recipe_storage_keys WHERE recipe_id = 'rvi:test-b'
    `).run()).toThrow("metric_observation_recipe_is_not_selected")
    expect(() => db.prepare(`
      UPDATE match_metric_observations
      SET recipe_key = (
        SELECT recipe_key FROM rvi_recipe_storage_keys
        WHERE recipe_id = 'rvi:test-b'
      )
      WHERE metric_key = 'damage_share'
    `).run()).toThrow("metric_observation_recipe_is_not_selected")
    expect(() => db.prepare(
      "DELETE FROM rvi_recipe_selections WHERE algorithm_version = 3",
    ).run()).toThrow("rvi_recipe_purge_required")
    expect(() => db.prepare(
      "DELETE FROM rvi_recipes WHERE recipe_id = 'rvi:test-a'",
    ).run()).toThrow()

    db.prepare("DELETE FROM match_metric_observations").run()
    db.prepare("DELETE FROM rvi_recipe_selections WHERE algorithm_version = 3").run()
    db.prepare("DELETE FROM rvi_recipes WHERE recipe_id = 'rvi:test-a'").run()
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM rvi_recipe_storage_keys
      WHERE recipe_id = 'rvi:test-a'
    `).get()).toEqual({ count: 0 })
    expect(db.pragma("foreign_key_check")).toEqual([])
    db.close()
  })

  it("does not retain abandoned parallel pipeline tables", () => {
    const db = new Database(":memory:")
    applyMigrations(db)

    const tables = new Set((db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all() as { name: string }[]).map((row) => row.name))
    for (const retired of [
      "riot_history_runs",
      "riot_match_ingestion",
      "riot_history_run_matches",
      "history_remediation_runs",
      "match_enrichment_jobs",
      "match_source_captures",
      "match_source_capture_payloads",
      "match_label_evaluation_versions",
      "match_performance_label_versions",
      "live_capture_compactions",
      "artifact_publish_journal",
      "maintenance_operations",
      "release_cleanup_state",
    ]) {
      expect(tables.has(retired), retired).toBe(false)
    }
  })

  it("rolls repeated history polls up without losing observation provenance", () => {
    const db = new Database(":memory:")
    for (const migration of migrations.slice(0, 27)) executeMigration(db, migration)
    db.pragma("user_version = 27")

    const insert = db.prepare(`
      INSERT INTO match_source_payloads
        (owner_puuid, source, source_match_id, game_id, kind, encoding,
         payload, sha256, data_version, mapper_version,
         serialization_version, mapping_status, mapping_error, mapped_at,
         fetched_at)
      VALUES (?, 'league_client', ?, NULL, 'history_page', 'gzip_json_v1',
              ?, ?, NULL, 11, 1, 'mapped', NULL, ?, ?)
    `)
    const sameHash = "a".repeat(64)
    insert.run("owner", "page:100:first", Buffer.from("same"), sameHash, 100, 100)
    insert.run("owner", "page:200:second", Buffer.from("same"), sameHash, 200, 200)
    insert.run(
      "owner",
      "page:300:changed",
      Buffer.from("changed"),
      "b".repeat(64),
      300,
      300,
    )

    expect(applyMigrations(db)).toBe(latestSchemaVersion)
    expect(db.prepare(`
      SELECT source_match_id AS sourceMatchId, sha256,
             fetched_at AS fetchedAt, first_fetched_at AS firstFetchedAt,
             last_fetched_at AS lastFetchedAt,
             observation_count AS observationCount
      FROM match_source_payloads
      WHERE owner_puuid = 'owner' AND kind = 'history_page'
      ORDER BY sha256
    `).all()).toEqual([
      { sourceMatchId: "recent:0:19", sha256: sameHash, fetchedAt: 200,
        firstFetchedAt: 100, lastFetchedAt: 200, observationCount: 2 },
      { sourceMatchId: "recent:0:19", sha256: "b".repeat(64), fetchedAt: 300,
        firstFetchedAt: 300, lastFetchedAt: 300, observationCount: 1 },
    ])
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
