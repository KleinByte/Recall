import Database from "better-sqlite3-node"
import { describe, expect, it } from "vitest"
import type { BackupManifest } from "../electron/main/database/backup-manager.js"
import { ClearHistoryService } from "../electron/main/database/clear-history-service.js"
import {
  GradePersistenceRepository,
  type CanonicalGradeResultInput,
} from "../electron/main/database/grade-persistence-repo.js"
import { MetricObservationsRepository } from
  "../electron/main/database/metric-observations-repo.js"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { MatchSourceRepository } from "../electron/main/database/match-source-repo.js"
import { buildMatchRow } from "./fixtures/matches.js"
import {
  decodeStoredJsonBody,
  gzipJsonTextV1,
  type StoredJsonBodyRow,
} from "../electron/main/database/json-body-codec.js"

const RECIPE_ID = "recall-current:clear-history-test"
const CALIBRATION_ID = "calibration:clear-history-test"

const verifiedBackup = {
  format: "recall-managed-backup",
  manifestVersion: 2,
  fileName: "stats-pre-clear-1.db",
  createdAt: 1,
  reason: "pre-clear",
  protection: { kind: "until_user_deletes" },
  appVersion: "3.0.0",
  releaseSequence: 1,
  sha256: "d".repeat(64),
  schemaVersion: 26,
  sizeBytes: 1,
  matchCount: 2,
  integrity: "ok",
} satisfies BackupManifest

function insertLobby(db: InstanceType<typeof Database>, gameId: number, puuid: string) {
  for (let participantId = 1; participantId <= 10; participantId += 1) {
    db.prepare(`
      INSERT INTO match_participants
        (game_id, puuid, participant_id, team_id, is_player, champion_id, win,
         kills, deaths, assists, gold_earned, damage_to_champions, damage_taken,
         damage_self_mitigated, total_heal, time_ccing_others,
         total_minions_killed, neutral_minions, vision_score, damage_objectives)
      VALUES (?, ?, ?, ?, ?, 84, 1, 1, 1, 1, 1000, 100, 100, 100, 10, 1,
              10, 0, 1, 0)
    `).run(gameId, puuid, participantId, participantId <= 5 ? 100 : 200,
      participantId === 1 ? 1 : 0)
  }
}

function insertMinimapTelemetry(
  db: InstanceType<typeof Database>,
  gameId: number,
  puuid: string,
) {
  const suffix = `${gameId}-${puuid}`
  db.prepare(`
    INSERT INTO minimap_capture_sessions
      (session_id, game_id, puuid, capture_backend, started_at,
       detector_version, status)
    VALUES (?, ?, ?, 'electron_desktop_capture', 1, 1, 'complete')
  `).run(`capture-${suffix}`, gameId, puuid)
  db.prepare(`
    INSERT INTO champion_track_chunks
      (game_id, puuid, participant_key, champion_name, team, is_local,
       chunk_start_ms, chunk_end_ms, point_count, encoding,
       uncompressed_bytes, compressed_bytes, payload_sha256, payload,
       detector_version)
    VALUES (?, ?, 'ally:local', 'Ahri', 'ally', 1, 1000, 1000, 1,
            'gzip_delta_json_v1', 1, 18, ?, ?, 1)
  `).run(gameId, puuid, "a".repeat(64), Buffer.alloc(18))
  db.prepare(`
    INSERT INTO camp_state_events
      (game_id, puuid, camp_key, game_time_ms, state, source,
       confidence, provider_version, created_at)
    VALUES (?, ?, 'west_blue', 1000, 'alive', 'minimap_cv', 1, 1, 1)
  `).run(gameId, puuid)
  db.prepare(`
    INSERT INTO camp_clear_events
      (game_id, puuid, camp_key, cleared_at_ms, source, source_confidence,
       attribution, attribution_confidence, evidence_json,
       algorithm_version, created_at)
    VALUES (?, ?, 'west_blue', 2000, 'minimap_cv', 1, 'local', 1, '{}', 1, 1)
  `).run(gameId, puuid)
  db.prepare(`
    INSERT INTO pathing_analysis_runs
      (analysis_id, game_id, puuid, input_hash, graph_version, model_version,
       mode, status, coverage_json, created_at)
    VALUES (?, ?, ?, ?, 1, 1, 'postgame_smoothed', 'complete', '{}', 1)
  `).run(`analysis-${suffix}`, gameId, puuid, String(gameId).repeat(64).slice(0, 64))
  db.prepare(`
    INSERT INTO path_segments
      (analysis_id, participant_key, start_time_ms, end_time_ms, kind,
       points_json, confidence, model_version)
    VALUES (?, 'ally:local', 1000, 2000, 'observed', '[]', 1, 1)
  `).run(`analysis-${suffix}`)
}

function gradeResults(): Map<number, CanonicalGradeResultInput> {
  return new Map(Array.from({ length: 10 }, (_, index) => {
    const participantId = index + 1
    return [participantId, {
      participantId,
      grade: "A" as const,
      gradeScore: 0.2,
      recallScore: 70,
      lobbyPercentile: participantId / 10,
      evidenceCoverage: 0.8,
      referenceSampleCount: 2,
      breakdown: { families: [] },
    }]
  }))
}

describe("ClearHistoryService Recall lifecycle", () => {
  it("removes frozen derived state while preserving unrelated-account raw evidence", () => {
    const db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    applyMigrations(db)
    const matches = new MatchesRepository(db)
    matches.insertMany([
      buildMatchRow({ gameId: 1, puuid: "remove-me", kills: 5 }),
      buildMatchRow({ gameId: 2, puuid: "keep-me", kills: 17 }),
    ])
    insertLobby(db, 1, "remove-me")
    insertLobby(db, 2, "keep-me")
    insertMinimapTelemetry(db, 1, "remove-me")
    insertMinimapTelemetry(db, 2, "keep-me")
    const timelineSources = new MatchSourceRepository(db)
    const retainedRaw = timelineSources.persistRawPayload({
      ownerPuuid: "keep-me",
      source: "league_client",
      sourceMatchId: "2",
      gameId: 2,
      kind: "timeline",
      body: { frames: [{ timestamp: 0 }] },
      mapperVersion: 11,
      fetchedAt: 1,
    })
    timelineSources.setMappingResult(retainedRaw, "mapped", 1, { gameId: 2 })
    timelineSources.persistTimelineSource({
      gameId: 2,
      puuid: "keep-me",
      source: "league_client",
      sourceMatchId: "2",
      mapperVersion: 11,
      timeline: { frames: [], events: [], turningPoints: [] },
      sourcePayload: retainedRaw,
      capturedAt: 1,
    })
    const insertLiveSnapshot = db.prepare(`
      INSERT INTO live_game_snapshots
        (game_id, puuid, game_time_ms, captured_at, reason,
         has_active_player_stat_runes, snapshot_encoding,
         snapshot_uncompressed_bytes, snapshot_compressed_bytes,
         snapshot_sha256, snapshot_payload)
      VALUES (?, ?, 1000, ?, 'first', 0, ?, ?, ?, ?, ?)
    `)
    for (const [gameId, puuid] of [[1, "remove-me"], [2, "keep-me"]] as const) {
      const encoded = gzipJsonTextV1(JSON.stringify({ gameId, puuid }))
      insertLiveSnapshot.run(gameId, puuid, gameId, encoded.encoding,
        encoded.uncompressedBytes, encoded.compressedBytes, encoded.sha256,
        encoded.payload)
    }

    const grades = new GradePersistenceRepository(db, () => 1)
    grades.registerCalibration({
      calibrationId: CALIBRATION_ID,
      calibrationHash: "a".repeat(64),
      referencePopulation: { accounts: ["remove-me", "keep-me"] },
      sampleCount: 2,
      snapshot: { observations: [1, 2] },
    })
    grades.registerRecipe({
      recipeId: RECIPE_ID,
      algorithmVersion: 3,
      recipeHash: "b".repeat(64),
      calibrationId: CALIBRATION_ID,
      definition: { version: 3 },
    })
    grades.selectRecipe(RECIPE_ID)
    for (const [gameId, puuid] of [[1, "remove-me"], [2, "keep-me"]] as const) {
      grades.writeCanonicalGrade(gameId, puuid, {
        algorithmVersion: 3,
        recipeId: RECIPE_ID,
        inputFingerprint: String(gameId).repeat(64),
        status: "ready",
        evidenceCoverage: 0.8,
        referenceSampleCount: 2,
        results: gradeResults(),
      })
      grades.createRebuildRun({
        puuid,
        recipeId: RECIPE_ID,
        totalMatches: 1,
        verifiedBackup: { path: `C:\\backup\\${puuid}.db`, sha256: "c".repeat(64) },
      })
    }
    const metrics = new MetricObservationsRepository(db, () => 1)
    metrics.registerRecipe({
      recipeId: "rvi:clear-history-test",
      algorithmVersion: 3,
      recipeHash: "e".repeat(64),
      gradeRecipeId: RECIPE_ID,
      calibrationId: CALIBRATION_ID,
      definition: { version: 3, vectors: [] },
    })
    metrics.selectRecipe("rvi:clear-history-test")
    for (const [gameId, puuid] of [[1, "remove-me"], [2, "keep-me"]] as const) {
      metrics.replaceMatchObservations({
        gameId,
        puuid,
        algorithmVersion: 3,
        recipeId: "rvi:clear-history-test",
        observations: [{
          gameId,
          puuid,
          participantId: 1,
          metricKey: "damage_share",
          recipeId: "rvi:clear-history-test",
          calibrationId: CALIBRATION_ID,
          rawEvidence: { state: "observed", value: 0 },
          scoreEvidence: { state: "observed", value: 0 },
          unit: "ratio",
          source: "scoreboard",
          sourceQuality: "verified",
          derivationId: "summary-v1",
          derivedAt: 1,
        }],
      })
    }

    const result = new ClearHistoryService(db).clear("remove-me", verifiedBackup)

    expect(result.deleted).toBe(1)
    expect(result.recoveryPoint).toBe(verifiedBackup.fileName)
    expect(db.prepare("SELECT COUNT(*) AS count FROM matches WHERE puuid = 'remove-me'").get())
      .toEqual({ count: 0 })
    expect(db.prepare(`
      SELECT game_id AS gameId, kills, grade, grade_algorithm_version AS version,
             grade_recipe_id AS recipeId
      FROM matches WHERE puuid = 'keep-me'
    `).get()).toEqual({ gameId: 2, kills: 17, grade: null, version: null, recipeId: null })
    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM match_participants WHERE puuid = 'keep-me'",
    ).get()).toEqual({ count: 10 })
    expect(db.prepare(`
      SELECT data_json AS dataJson FROM selected_match_timelines
      WHERE puuid = 'keep-me'
    `).get()).toEqual({
      dataJson: '{"events":[],"frames":[],"turningPoints":[]}',
    })
    expect(db.prepare(`
      SELECT sha256, encoding
      FROM match_source_payloads WHERE owner_puuid = 'keep-me'
    `).get()).toEqual({ sha256: retainedRaw.sha256, encoding: "gzip_json_v1" })
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM live_game_snapshots WHERE puuid = 'remove-me'
    `).get()).toEqual({ count: 0 })
    for (const table of [
      "minimap_capture_sessions",
      "champion_track_chunks",
      "camp_state_events",
      "camp_clear_events",
      "pathing_analysis_runs",
    ]) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE puuid = ?`)
        .get("remove-me"), table).toEqual({ count: 0 })
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE puuid = ?`)
        .get("keep-me"), table).toEqual({ count: 1 })
    }
    expect(db.prepare("SELECT COUNT(*) AS count FROM path_segments").get())
      .toEqual({ count: 1 })
    const retainedLive = db.prepare(`
      SELECT snapshot_encoding AS snapshotEncoding,
             snapshot_uncompressed_bytes AS snapshotUncompressedBytes,
             snapshot_compressed_bytes AS snapshotCompressedBytes,
             snapshot_sha256 AS snapshotSha256,
             snapshot_payload AS snapshotPayload
      FROM live_game_snapshots WHERE puuid = 'keep-me'
    `).get() as StoredJsonBodyRow
    expect(decodeStoredJsonBody(retainedLive).value)
      .toEqual({ gameId: 2, puuid: "keep-me" })

    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM grade_recipe_selections WHERE algorithm_version = 3",
    ).get()).toEqual({ count: 0 })
    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM match_metric_observation_details WHERE algorithm_version = 3",
    ).get()).toEqual({ count: 0 })
    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM rvi_recipe_selections WHERE algorithm_version = 3",
    ).get()).toEqual({ count: 0 })
    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM rvi_recipes WHERE algorithm_version = 3",
    ).get()).toEqual({ count: 0 })
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM grade_recipes
      WHERE algorithm_version = 3 AND recipe_id NOT LIKE 'legacy:%'
    `).get()).toEqual({ count: 0 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM grade_calibration_snapshots").get())
      .toEqual({ count: 0 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM grade_rebuild_runs").get())
      .toEqual({ count: 0 })
    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM match_grade_attempts WHERE algorithm_version = 3",
    ).get()).toEqual({ count: 0 })
    expect(db.pragma("foreign_key_check")).toEqual([])
    db.close()
  })
})
