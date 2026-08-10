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
import { buildMatchRow } from "./fixtures/matches.js"

const RECIPE_ID = "recall-v3:clear-history-test"
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

function gradeResults(): Map<number, CanonicalGradeResultInput> {
  return new Map(Array.from({ length: 10 }, (_, index) => {
    const participantId = index + 1
    return [participantId, {
      participantId,
      grade: "A" as const,
      gradeScore: 0.2,
      roleFitScore: 70,
      lobbyPercentile: participantId / 10,
      evidenceCoverage: 0.8,
      referenceSampleCount: 2,
      breakdown: { families: [] },
    }]
  }))
}

describe("ClearHistoryService Recall v3 lifecycle", () => {
  it("removes frozen v3 state while preserving unrelated-account raw evidence", () => {
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
    db.prepare(`
      INSERT INTO match_timeline_cache
        (game_id, puuid, status, mapper_version, data_json, raw_json, updated_at)
      VALUES (2, 'keep-me', 'ready', 1, '{"events":[]}',
              '{"frames":[{"timestamp":0}]}', 1)
    `).run()
    db.prepare(`
      INSERT INTO match_source_payloads
        (owner_puuid, source, source_match_id, game_id, kind, encoding,
         payload, sha256, mapper_version, serialization_version,
         mapping_status, mapped_at, fetched_at)
      VALUES ('keep-me', 'league_client', '2', 2, 'timeline', 'gzip_json_v1',
              ?, ?, 1, 1, 'mapped', 1, 1)
    `).run(Buffer.from([1, 2, 3]), "f".repeat(64))

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
      SELECT data_json AS dataJson, raw_json AS rawJson
      FROM match_timeline_cache WHERE puuid = 'keep-me'
    `).get()).toEqual({
      dataJson: '{"events":[]}',
      rawJson: '{"frames":[{"timestamp":0}]}',
    })
    expect(db.prepare(`
      SELECT sha256, hex(payload) AS payloadHex
      FROM match_source_payloads WHERE owner_puuid = 'keep-me'
    `).get()).toEqual({ sha256: "f".repeat(64), payloadHex: "010203" })

    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM grade_recipe_selections WHERE algorithm_version = 3",
    ).get()).toEqual({ count: 0 })
    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM match_metric_observations WHERE algorithm_version = 3",
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
