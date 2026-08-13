import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import {
  GradePersistenceRepository,
  type CanonicalGradeResultInput,
} from "../electron/main/database/grade-persistence-repo.js"
import { MatchSourceRepository } from "../electron/main/database/match-source-repo.js"
import {
  decodeStoredJsonBody,
  type StoredJsonBodyRow,
} from "../electron/main/database/json-body-codec.js"
import {
  applyMigrations,
  executeMigration,
  migrations,
} from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { ParticipantsRepository } from "../electron/main/database/participants-repo.js"
import {
  backfillGradeCoreFactsFromRawPayloads,
  hasRecoverableGradeCoreFactsFromRawPayloads,
} from
  "../electron/main/matches/grade-core-backfill.js"
import type { ParticipantRow } from "../electron/main/matches/types.js"
import { buildMatchRow } from "./fixtures/matches.js"

const PUUID = "grade-owner"
const RECIPE_A = "recall-current:test-a"
const RECIPE_B = "recall-current:test-b"
const INPUT_HASH = "1".repeat(64)

let db: InstanceType<typeof Database>
let matches: MatchesRepository
let participants: ParticipantsRepository
let grades: GradePersistenceRepository

function attemptForRecipe(gameId: number, puuid: string, recipeId: string) {
  const row = db.prepare(`
    SELECT game_id AS gameId, puuid, algorithm_version AS algorithmVersion,
           recipe_id AS recipeId, owner_participant_id AS ownerParticipantId,
           grade_status AS status, input_fingerprint AS inputFingerprint,
           role_fit_score AS recallScore, evidence_coverage AS evidenceCoverage,
           reference_sample_count AS referenceSampleCount,
           reference_metadata_json AS referenceMetadataJson,
           status_reason AS statusReason, attempted_at AS attemptedAt
    FROM match_grade_attempts
    WHERE game_id = ? AND puuid = ? AND recipe_id = ?
  `).get(gameId, puuid, recipeId) as (Record<string, unknown> & {
    referenceMetadataJson: string
  }) | undefined
  if (!row) return undefined
  const { referenceMetadataJson, ...attempt } = row
  return { ...attempt, referenceMetadata: JSON.parse(referenceMetadataJson) as unknown }
}

const participant = (overrides: Partial<ParticipantRow> = {}): ParticipantRow => ({
  gameId: 1,
  puuid: PUUID,
  participantId: 1,
  teamId: 100,
  isPlayer: 0,
  championId: 84,
  win: 1,
  summonerName: "Player",
  profileIcon: 0,
  spell1Id: 4,
  spell2Id: 14,
  items: [0, 0, 0, 0, 0, 0, 0],
  perkPrimaryStyle: 0,
  perkSubStyle: 0,
  perks: [0, 0, 0, 0, 0, 0],
  champLevel: 18,
  kills: 2,
  deaths: 2,
  assists: 2,
  goldEarned: 10_000,
  goldSpent: 9_000,
  damageToChampions: 10_000,
  totalDamageDealt: 50_000,
  magicDamageToChampions: 0,
  physicalDamageToChampions: 0,
  trueDamageToChampions: 0,
  damageTaken: 10_000,
  damageSelfMitigated: 5_000,
  totalHeal: 1_000,
  totalUnitsHealed: 1,
  timeCcingOthers: 5,
  largestKillingSpree: 1,
  largestMultiKill: 1,
  doubleKills: 0,
  tripleKills: 0,
  quadraKills: 0,
  pentaKills: 0,
  totalMinionsKilled: 50,
  neutralMinions: 0,
  visionScore: 10,
  wardsPlaced: 1,
  wardsKilled: 0,
  controlWards: 0,
  damageObjectives: 1_000,
  damageTurrets: 500,
  turretKills: 0,
  inhibitorKills: 0,
  longestTimeLiving: 200,
  firstBlood: 0,
  firstTower: 0,
  ...overrides,
})

const lobby = (gameId = 1) => Array.from({ length: 10 }, (_, index) =>
  participant({
    gameId,
    participantId: index + 1,
    teamId: index < 5 ? 100 : 200,
    isPlayer: index === 0 ? 1 : 0,
  }))

const rawScoreboard = (gameId = 1) => ({
  gameId,
  gameDuration: 1200,
  participants: lobby(gameId).map((row) => ({
    participantId: row.participantId,
    teamId: row.teamId,
    championId: row.championId,
    stats: {
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      goldEarned: row.goldEarned,
      totalDamageDealtToChampions: row.damageToChampions,
      totalMinionsKilled: row.totalMinionsKilled,
      neutralMinionsKilled: row.neutralMinions,
      damageDealtToObjectives: row.damageObjectives,
      damageDealtToTurrets: row.damageTurrets,
      timeCCingOthers: row.timeCcingOthers,
      visionScore: row.visionScore,
    },
  })),
})

const resultMap = (): Map<number, CanonicalGradeResultInput> => new Map(
  Array.from({ length: 10 }, (_, index) => {
    const participantId = index + 1
    return [participantId, {
      participantId,
      grade: participantId === 1 ? "A" as const : "B" as const,
      gradeScore: participantId === 1 ? 0.5 : 0,
      recallScore: 70 + participantId,
      lobbyPercentile: participantId / 10,
      evidenceCoverage: 0.8,
      referenceSampleCount: 240,
      referenceMetadata: { cohort: "sr:position" },
      breakdown: { families: [{ key: "combat", score: participantId }] },
    }]
  }),
)

const register = (recipeId: string, hashCharacter: string) => {
  grades.registerRecipe({
    recipeId,
    algorithmVersion: 3,
    recipeHash: hashCharacter.repeat(64),
    definition: { product: "Recall", version: 3, recipeId },
  })
}

const readyWrite = (recipeId = RECIPE_A) => ({
  algorithmVersion: 3,
  recipeId,
  inputFingerprint: INPUT_HASH,
  status: "ready" as const,
  evidenceCoverage: 0.8,
  referenceSampleCount: 240,
  referenceMetadata: { cohort: "sr:position" },
  results: resultMap(),
})

beforeEach(() => {
  db = new Database(":memory:")
  db.pragma("foreign_keys = ON")
  applyMigrations(db)
  matches = new MatchesRepository(db)
  participants = new ParticipantsRepository(db)
  grades = new GradePersistenceRepository(db, () => 1_000)
  matches.insertMany([buildMatchRow({ gameId: 1, puuid: PUUID })])
  participants.insertMany(lobby())
  register(RECIPE_A, "a")
  grades.selectRecipe(RECIPE_A)
})

describe("GradePersistenceRepository canonical writer", () => {
  it("stores calibration bodies once, verifies them, and stays idempotent", () => {
    const registration = {
      calibrationId: "calibration:compressed",
      calibrationHash: "c".repeat(64),
      referencePopulation: { supportedModes: ["aram"] },
      sampleCount: 12,
      snapshot: { z: "召唤师", nested: { b: 2, a: 1 } },
      createdAt: 1234,
    }
    expect(grades.registerCalibration(registration)).toBe(true)
    expect(grades.registerCalibration({
      ...registration,
      snapshot: { nested: { a: 1, b: 2 }, z: "召唤师" },
    })).toBe(false)

    const row = db.prepare(`
      SELECT snapshot_encoding AS snapshotEncoding,
             snapshot_uncompressed_bytes AS snapshotUncompressedBytes,
             snapshot_compressed_bytes AS snapshotCompressedBytes,
             snapshot_sha256 AS snapshotSha256,
             snapshot_payload AS snapshotPayload,
             typeof(snapshot_payload) AS payloadType,
             created_at AS createdAt
      FROM grade_calibration_snapshots
      WHERE calibration_id = 'calibration:compressed'
    `).get() as StoredJsonBodyRow & { payloadType: string; createdAt: number }
    expect(row.payloadType).toBe("blob")
    expect(row.snapshotCompressedBytes).toBe(row.snapshotPayload.length)
    expect(row.createdAt).toBe(1234)
    expect(decodeStoredJsonBody(row).value).toEqual(registration.snapshot)
    expect(() => grades.registerCalibration({
      ...registration,
      snapshot: { different: true },
    })).toThrow("registration_conflict")
    expect(() => db.prepare(`
      UPDATE grade_calibration_snapshots SET sample_count = 13
      WHERE calibration_id = 'calibration:compressed'
    `).run()).toThrow("immutable")
  })

  it("rejects a corrupted stored calibration body before treating it as identical", () => {
    const registration = {
      calibrationId: "calibration:corrupt",
      calibrationHash: "d".repeat(64),
      referencePopulation: {},
      sampleCount: 1,
      snapshot: { valid: true },
    }
    grades.registerCalibration(registration)
    db.exec("DROP TRIGGER grade_calibration_snapshots_immutable_update")
    db.prepare(`
      UPDATE grade_calibration_snapshots SET snapshot_sha256 = ?
      WHERE calibration_id = 'calibration:corrupt'
    `).run("0".repeat(64))

    expect(() => grades.registerCalibration(registration)).toThrow("sha256")
  })

  it("advances mapper metadata for identical raw bytes without replacing the payload", () => {
    const raw = new MatchSourceRepository(db)
    const first = raw.persistRawPayload({
      ownerPuuid: PUUID,
      source: "league_client",
      sourceMatchId: "1",
      gameId: 1,
      kind: "scoreboard_detail",
      mapperVersion: 7,
      fetchedAt: 100,
      body: rawScoreboard(),
    })
    raw.setMappingResult(first, "mapped", 101, { gameId: 1 })
    const before = db.prepare(`
      SELECT payload, sha256 FROM match_source_payloads
      WHERE owner_puuid = ? AND source_match_id = '1'
        AND kind = 'scoreboard_detail'
    `).get(PUUID) as { payload: Buffer; sha256: string }

    const repeated = raw.persistRawPayload({
      ownerPuuid: PUUID,
      source: "league_client",
      sourceMatchId: "1",
      gameId: 1,
      kind: "scoreboard_detail",
      mapperVersion: 8,
      fetchedAt: 200,
      body: rawScoreboard(),
    })
    const upgraded = db.prepare(`
      SELECT payload, sha256, mapper_version AS mapperVersion,
             mapping_status AS mappingStatus, mapped_at AS mappedAt,
             fetched_at AS fetchedAt
      FROM match_source_payloads
      WHERE owner_puuid = ? AND source_match_id = '1'
        AND kind = 'scoreboard_detail'
    `).get(PUUID) as {
      payload: Buffer
      sha256: string
      mapperVersion: number
      mappingStatus: string
      mappedAt: number | null
      fetchedAt: number
    }

    expect(upgraded).toMatchObject({
      sha256: before.sha256,
      mapperVersion: 8,
      mappingStatus: "pending",
      mappedAt: null,
      fetchedAt: 200,
    })
    expect(upgraded.payload.equals(before.payload)).toBe(true)
    expect(raw.hasMappedPayload({
      ownerPuuid: PUUID,
      source: "league_client",
      sourceMatchId: "1",
      kind: "scoreboard_detail",
      mapperVersion: 8,
    })).toBe(false)
    raw.setMappingResult(repeated, "mapped", 201, { gameId: 1 })
    expect(raw.hasMappedPayload({
      ownerPuuid: PUUID,
      source: "league_client",
      sourceMatchId: "1",
      kind: "scoreboard_detail",
      mapperVersion: 8,
    })).toBe(true)
  })

  it("promotes old source facts only after an exact checksummed raw scoreboard proves them", () => {
    const raw = new MatchSourceRepository(db)
    const identity = raw.persistRawPayload({
      ownerPuuid: PUUID,
      source: "league_client",
      sourceMatchId: "1",
      gameId: 1,
      kind: "scoreboard_detail",
      mapperVersion: 7,
      fetchedAt: 100,
      body: rawScoreboard(),
    })
    raw.setMappingResult(identity, "mapped", 101, { gameId: 1 })

    expect(hasRecoverableGradeCoreFactsFromRawPayloads(db)).toBe(true)
    expect(backfillGradeCoreFactsFromRawPayloads(db)).toEqual({
      verifiedLobbies: 1,
      verifiedParticipants: 10,
    })
    expect(hasRecoverableGradeCoreFactsFromRawPayloads(db)).toBe(false)
    expect(db.prepare(`
      SELECT MIN(grade_core_complete) AS complete,
             COUNT(DISTINCT grade_core_source) AS sourceKinds,
             MIN(grade_core_source) AS source,
             MIN(grade_core_missing_fields_json) AS missingFields
      FROM match_participants WHERE game_id = 1 AND puuid = ?
    `).get(PUUID)).toEqual({
      complete: 1,
      sourceKinds: 1,
      source: "league_client",
      missingFields: "[]",
    })
  })

  it("rolls back every raw-source promotion if one participant update fails", () => {
    const raw = new MatchSourceRepository(db)
    const identity = raw.persistRawPayload({
      ownerPuuid: PUUID,
      source: "league_client",
      sourceMatchId: "1",
      gameId: 1,
      kind: "scoreboard_detail",
      mapperVersion: 7,
      fetchedAt: 100,
      body: rawScoreboard(),
    })
    raw.setMappingResult(identity, "mapped", 101, { gameId: 1 })
    db.exec(`
      CREATE TRIGGER fail_fifth_grade_core_promotion
      BEFORE UPDATE OF grade_core_complete ON match_participants
      WHEN NEW.game_id = 1 AND NEW.puuid = '${PUUID}' AND NEW.participant_id = 5
      BEGIN SELECT RAISE(ABORT, 'injected_grade_core_write_failure'); END;
    `)

    expect(() => backfillGradeCoreFactsFromRawPayloads(db))
      .toThrow("injected_grade_core_write_failure")
    expect(db.prepare(`
      SELECT SUM(grade_core_complete) AS promoted
      FROM match_participants WHERE game_id = 1 AND puuid = ?
    `).get(PUUID)).toEqual({ promoted: 0 })
  })

  it("withholds raw source facts when the rate denominator disagrees", () => {
    const raw = new MatchSourceRepository(db)
    const identity = raw.persistRawPayload({
      ownerPuuid: PUUID,
      source: "league_client",
      sourceMatchId: "1",
      gameId: 1,
      kind: "scoreboard_detail",
      mapperVersion: 7,
      fetchedAt: 100,
      body: { ...rawScoreboard(), gameDuration: 1300 },
    })
    raw.setMappingResult(identity, "mapped", 101, { gameId: 1 })

    expect(backfillGradeCoreFactsFromRawPayloads(db)).toEqual({
      verifiedLobbies: 0,
      verifiedParticipants: 0,
    })
    expect(db.prepare(`
      SELECT SUM(grade_core_complete) AS promoted
      FROM match_participants WHERE game_id = 1 AND puuid = ?
    `).get(PUUID)).toEqual({ promoted: 0 })
  })

  it("atomically writes one ready attempt, ten results, and cache-identical values", () => {
    const input = readyWrite()
    const ownerResult = input.results.get(1)!
    ownerResult.breakdown = {
      algorithmVersion: 3,
      recallScore: ownerResult.recallScore,
      recallScoreCalibrationSource: "frozen_composite_ecdf",
      components: [],
    }
    grades.writeCanonicalGrade(1, PUUID, input)

    expect(db.prepare("SELECT COUNT(*) AS count FROM match_grade_attempts")
      .get()).toEqual({ count: 1 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM match_grade_results")
      .get()).toEqual({ count: 10 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM match_grade_breakdown_versions")
      .get()).toEqual({ count: 10 })
    const attempt = attemptForRecipe(1, PUUID, RECIPE_A)
    expect(attempt).toMatchObject({
      recipeId: RECIPE_A,
      inputFingerprint: INPUT_HASH,
      status: "ready",
      recallScore: 71,
      evidenceCoverage: 0.8,
      referenceSampleCount: 240,
    })
    const cachePairs = db.prepare(`
      SELECT p.participant_id AS participantId,
             p.grade = r.grade AS sameGrade,
             p.grade_score = r.grade_score AS sameGradeScore,
             p.role_fit_score = r.role_fit_score AS sameRecallScore,
             p.grade_recipe_id = r.recipe_id AS sameRecipe,
             p.grade_evidence_coverage = r.evidence_coverage AS sameCoverage,
             p.grade_reference_sample_count = r.reference_sample_count AS sameReference
      FROM match_participants p
      JOIN match_grade_results r
        ON r.game_id = p.game_id AND r.puuid = p.puuid
       AND r.participant_id = p.participant_id
      WHERE p.game_id = 1 AND p.puuid = ? AND r.recipe_id = ?
    `).all(PUUID, RECIPE_A) as Array<Record<string, number>>
    expect(cachePairs).toHaveLength(10)
    expect(cachePairs.every((row) => Object.entries(row)
      .filter(([key]) => key !== "participantId")
      .every(([, value]) => value === 1))).toBe(true)
    const ownerCache = db.prepare(`
      SELECT m.grade, m.grade_score AS gradeScore,
             m.role_fit_score AS recallScore, m.grade_recipe_id AS recipeId,
             r.grade AS resultGrade, r.grade_score AS resultGradeScore,
             r.role_fit_score AS resultRecallScore
      FROM matches m
      JOIN match_grade_results r
        ON r.game_id = m.game_id AND r.puuid = m.puuid AND r.participant_id = 1
      WHERE m.game_id = 1 AND m.puuid = ? AND r.recipe_id = ?
    `).get(PUUID, RECIPE_A)
    expect(ownerCache).toEqual({
      grade: "A", gradeScore: 0.5, recallScore: 71, recipeId: RECIPE_A,
      resultGrade: "A", resultGradeScore: 0.5, resultRecallScore: 71,
    })
    const storedBreakdown = JSON.parse((db.prepare(`
      SELECT components_json AS componentsJson
      FROM match_grade_breakdown_versions
      WHERE game_id = 1 AND puuid = ? AND participant_id = 1
    `).get(PUUID) as { componentsJson: string }).componentsJson) as Record<string, unknown>
    expect(storedBreakdown).toMatchObject({
      roleFitScore: 71,
      roleFitCalibrationSource: "frozen_composite_ecdf",
    })
    expect(storedBreakdown).not.toHaveProperty("recallScore")
    expect(storedBreakdown).not.toHaveProperty("recallScoreCalibrationSource")
  })

  it("rejects a ready write unless it has exactly the ten stored participants", () => {
    const input = readyWrite()
    input.results.delete(10)

    expect(() => grades.writeCanonicalGrade(1, PUUID, input))
      .toThrow("ready_grade_requires_exactly_ten_results")
    expect(db.prepare("SELECT COUNT(*) AS count FROM match_grade_attempts")
      .get()).toEqual({ count: 0 })
  })

  it("stores zero results for non-ready attempts and clears every stale cache", () => {
    grades.writeCanonicalGrade(1, PUUID, readyWrite())
    grades.writeCanonicalGrade(1, PUUID, {
      algorithmVersion: 3,
      recipeId: RECIPE_A,
      inputFingerprint: "2".repeat(64),
      status: "short_game",
      statusReason: "duration_under_300_seconds",
      evidenceCoverage: 0.4,
      referenceSampleCount: 0,
      referenceMetadata: { reason: "not_calibrated" },
      results: new Map(),
    })

    expect(db.prepare("SELECT COUNT(*) AS count FROM match_grade_results")
      .get()).toEqual({ count: 0 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM match_grade_breakdown_versions")
      .get()).toEqual({ count: 0 })
    expect(attemptForRecipe(1, PUUID, RECIPE_A)).toMatchObject({
      status: "short_game",
      recallScore: null,
      statusReason: "duration_under_300_seconds",
    })
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM match_participants
      WHERE grade IS NOT NULL OR grade_score IS NOT NULL OR role_fit_score IS NOT NULL
    `).get()).toEqual({ count: 0 })
    expect(db.prepare(`
      SELECT grade, grade_score AS gradeScore, role_fit_score AS recallScore,
             grade_status AS status, grade_recipe_id AS recipeId
      FROM matches WHERE game_id = 1 AND puuid = ?
    `).get(PUUID)).toEqual({
      grade: null,
      gradeScore: null,
      recallScore: null,
      status: "short_game",
      recipeId: RECIPE_A,
    })
  })

  it.each(["calibrating", "position_unresolved"] as const)(
    "persists the explicit %s non-ready state through cache guards",
    (status) => {
      grades.writeCanonicalGrade(1, PUUID, {
        algorithmVersion: 3,
        recipeId: RECIPE_A,
        inputFingerprint: "3".repeat(64),
        status,
        statusReason: status,
        evidenceCoverage: 0,
        referenceSampleCount: 0,
        results: new Map(),
      })

      expect(attemptForRecipe(1, PUUID, RECIPE_A)?.status).toBe(status)
      expect(db.prepare(`
        SELECT grade_status AS status FROM matches
        WHERE game_id = 1 AND puuid = ?
      `).get(PUUID)).toEqual({ status })
      expect(db.prepare(`
        SELECT COUNT(*) AS count FROM match_grade_results
        WHERE game_id = 1 AND puuid = ?
      `).get(PUUID)).toEqual({ count: 0 })
    },
  )
})

describe("recipe selection and derived-only rebuild support", () => {
  it("uses exact recipe reads and requires purge before a same-version recipe switch", () => {
    grades.writeCanonicalGrade(1, PUUID, readyWrite())
    register(RECIPE_B, "b")

    expect(attemptForRecipe(1, PUUID, RECIPE_B)).toBeUndefined()
    expect(() => grades.selectRecipe(RECIPE_B)).toThrow("grade_recipe_purge_required")

    grades.purgeDerivedGrades({ algorithmVersion: 3 })
    expect(() => grades.selectRecipe(RECIPE_B)).not.toThrow()
    expect(attemptForRecipe(1, PUUID, RECIPE_B)).toBeUndefined()
  })

  it("purges idempotently while preserving matches, participants, and timeline evidence", () => {
    grades.writeCanonicalGrade(1, PUUID, readyWrite())
    new MatchSourceRepository(db).persistTimelineSource({
      gameId: 1,
      puuid: PUUID,
      source: "league_client",
      sourceMatchId: "1",
      mapperVersion: 11,
      timeline: { frames: [], events: [], turningPoints: [] },
      capturedAt: 1000,
    })

    const first = grades.purgeDerivedGrades({ algorithmVersion: 3, puuid: PUUID })
    const second = grades.purgeDerivedGrades({ algorithmVersion: 3, puuid: PUUID })

    expect(first).toMatchObject({ attempts: 1, results: 10, versionedBreakdowns: 10 })
    expect(second).toEqual({
      attempts: 0,
      results: 0,
      versionedBreakdowns: 0,
      compatibilityBreakdowns: 0,
      matchCaches: 0,
      participantCaches: 0,
    })
    expect(db.prepare("SELECT COUNT(*) AS count FROM matches").get()).toEqual({ count: 1 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM match_participants").get())
      .toEqual({ count: 10 })
    expect(db.prepare(`
      SELECT data_json AS dataJson FROM selected_match_timelines
      WHERE game_id = 1 AND puuid = ?
    `).get(PUUID)).toEqual({
      dataJson: '{"events":[],"frames":[],"turningPoints":[]}',
    })
  })

  it("tracks a verified, resumable rebuild without mutating recipe metadata", () => {
    const runId = grades.createRebuildRun({
      puuid: PUUID,
      recipeId: RECIPE_A,
      totalMatches: 1,
      verifiedBackup: { path: "C:\\backup\\stats.db", sha256: "c".repeat(64) },
    })
    expect(grades.getRebuildRun(runId)).toMatchObject({
      status: "pending", stage: "preflight", totalMatches: 1,
    })
    grades.purgeDerivedGrades({ algorithmVersion: 3, rebuildRunId: runId })
    expect(grades.getRebuildRun(runId)).toMatchObject({
      status: "running", stage: "recompute",
    })
    expect(grades.updateRebuildRun(runId, {
      status: "complete",
      stage: "complete",
      processedMatches: 1,
      readyMatches: 0,
      nonreadyMatches: 1,
      errorMatches: 0,
    })).toMatchObject({ status: "complete", completedAt: 1_000 })
    expect(() => db.prepare("UPDATE grade_recipes SET recipe_hash = ? WHERE recipe_id = ?")
      .run("d".repeat(64), RECIPE_A)).toThrow("grade_recipe_is_immutable")
  })
})

describe("schema v25 compatibility", () => {
  it("marks legacy artifacts and corrects historical URF classification", () => {
    const legacy = new Database(":memory:")
    legacy.pragma("foreign_keys = ON")
    for (const migration of migrations.slice(0, 24)) executeMigration(legacy, migration)
    legacy.pragma("user_version = 24")
    const legacyMatches = new MatchesRepository(legacy)
    const legacyParticipants = new ParticipantsRepository(legacy)
    legacyMatches.insertMany([buildMatchRow({
      gameId: 9,
      puuid: PUUID,
      queueId: 900,
      gameMode: "ARURF",
      mode: "sr_normal",
      modeFamily: "sr",
      isRanked: 1,
    })])
    legacyParticipants.insertMany(lobby(9))
    // v7 normalized missing numbers to zero. Without its raw payload, even a
    // structurally complete lobby must remain unavailable to canonical calibration.
    legacy.prepare(`
      UPDATE match_participants SET detail_version = 7
      WHERE game_id = 9 AND puuid = ?
    `).run(PUUID)
    legacy.prepare(`
      INSERT INTO match_grade_attempts
        (game_id, puuid, algorithm_version, owner_participant_id,
         grade_status, input_fingerprint, attempted_at)
      VALUES (9, ?, 3, 1, 'ready', ?, 1)
    `).run(PUUID, "e".repeat(64))

    applyMigrations(legacy)

    expect(legacy.prepare(`
      SELECT recipe_id AS recipeId FROM match_grade_attempts
      WHERE game_id = 9 AND puuid = ?
    `).get(PUUID)).toEqual({ recipeId: "legacy:v3" })
    expect(legacy.prepare(`
      SELECT mode, mode_family AS modeFamily, is_ranked AS isRanked
      FROM matches WHERE game_id = 9 AND puuid = ?
    `).get(PUUID)).toEqual({ mode: "urf", modeFamily: "other", isRanked: 0 })
    expect(legacy.prepare(`
      SELECT COUNT(*) AS participants,
             MIN(grade_core_complete) AS allComplete,
             COUNT(DISTINCT grade_core_source) AS sourceKinds,
             MIN(grade_core_source) AS source,
             MIN(grade_core_missing_fields_json) AS missingFields
      FROM match_participants WHERE game_id = 9 AND puuid = ?
    `).get(PUUID)).toEqual({
      participants: 10,
      allComplete: 0,
      sourceKinds: 1,
      source: "legacy_unknown",
      missingFields: JSON.stringify([
        "participant_id", "team_id", "champion_id", "kills", "deaths", "assists",
        "gold_earned", "damage_to_champions", "total_minions_killed", "neutral_minions",
        "damage_objectives", "damage_turrets", "time_ccing_others", "vision_score",
      ]),
    })
    expect(legacy.pragma("integrity_check", { simple: true })).toBe("ok")
  })
})
