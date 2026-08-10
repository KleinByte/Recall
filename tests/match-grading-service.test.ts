import Database from "better-sqlite3-node"
import { describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { ParticipantsRepository } from "../electron/main/database/participants-repo.js"
import { GradePersistenceRepository } from "../electron/main/database/grade-persistence-repo.js"
import { MatchSourceRepository } from "../electron/main/database/match-source-repo.js"
import {
  MatchGradingService,
} from "../electron/main/matches/match-grading-service.js"
import { MATCH_GRADE_RECIPE_DEFINITION_ID } from "../electron/main/matches/match-grade-recipe.js"
import { POSITION_RESOLVER_VERSION } from "../electron/main/matches/position.js"
import {
  TIMELINE_MAPPER_VERSION,
  type CompactTimeline,
} from "../electron/main/riot/timeline-mapper.js"
import type {
  MatchRow,
  ParticipantRow,
} from "../electron/main/matches/types.js"
import { buildMatchRow } from "./fixtures/matches.js"

const PUUID = "recall-v3-owner"
const BACKUP = { path: "verified-test-backup.db", sha256: "b".repeat(64) }
const POSITIONS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const

const participant = (overrides: Partial<ParticipantRow> = {}): ParticipantRow => ({
  gameId: 1,
  puuid: PUUID,
  participantId: 1,
  teamId: 100,
  isPlayer: 0,
  championId: 18,
  win: 1,
  profileIcon: 0,
  spell1Id: 4,
  spell2Id: 7,
  items: [0, 0, 0, 0, 0, 0, 0],
  perkPrimaryStyle: 0,
  perkSubStyle: 0,
  perks: [0, 0, 0, 0, 0, 0],
  champLevel: 15,
  kills: 3,
  deaths: 3,
  assists: 5,
  goldEarned: 10_000,
  goldSpent: 9_000,
  damageToChampions: 15_000,
  totalDamageDealt: 70_000,
  magicDamageToChampions: 0,
  physicalDamageToChampions: 14_000,
  trueDamageToChampions: 1_000,
  damageTaken: 12_000,
  damageSelfMitigated: 4_000,
  totalHeal: 500,
  totalUnitsHealed: 1,
  timeCcingOthers: 8,
  largestKillingSpree: 2,
  largestMultiKill: 1,
  doubleKills: 0,
  tripleKills: 0,
  quadraKills: 0,
  pentaKills: 0,
  totalMinionsKilled: 100,
  neutralMinions: 10,
  visionScore: 15,
  wardsPlaced: 4,
  wardsKilled: 1,
  controlWards: 1,
  damageObjectives: 2_000,
  damageTurrets: 1_000,
  turretKills: 1,
  inhibitorKills: 0,
  longestTimeLiving: 500,
  firstBlood: 0,
  firstTower: 0,
  eligibleForProgression: 1,
  totalHealsOnTeammates: 0,
  totalDamageShieldedOnTeammates: 0,
  damageDealtToBuildings: 1_000,
  gradeCoreComplete: 1,
  gradeCoreSource: "match_v5",
  gradeCoreMissingFields: [],
  gradeCoreContractVersion: 1,
  ...overrides,
})

function lobby(gameId: number, strength = gameId): ParticipantRow[] {
  return Array.from({ length: 10 }, (_, index) => {
    const position = POSITIONS[index % 5]
    return participant({
      gameId,
      participantId: index + 1,
      teamId: index < 5 ? 100 : 200,
      isPlayer: index === 0 ? 1 : 0,
      assignedPosition: position,
      resolvedPosition: position,
      damageToChampions: 10_000 + strength * 100 + index * 1_000,
      goldEarned: 8_000 + strength * 50 + index * 500,
      kills: 1 + (index % 4),
      assists: 2 + (index % 5),
      deaths: 1 + ((strength + index) % 5),
      totalMinionsKilled: 30 + index * 15,
      damageObjectives: strength * 100 + index * 200,
      damageTurrets: strength * 50 + index * 100,
      damageDealtToBuildings: strength * 50 + index * 100,
      visionScore: 5 + index * 3,
      timeCcingOthers: 2 + index,
    })
  })
}

function match(gameId: number, overrides: Partial<MatchRow> = {}): MatchRow {
  return buildMatchRow({
    gameId,
    puuid: PUUID,
    queueId: 430,
    gameMode: "CLASSIC",
    mode: "sr_normal",
    modeFamily: "sr",
    isMatched: 1,
    durationSecs: 1_200,
    playedAt: 1_700_000_000_000 + gameId * 60_000,
    mapId: 11,
    gameType: "MATCHED_GAME",
    ownerEligibleForProgression: 1,
    durationQuality: "verified",
    ...overrides,
  })
}

function databaseWithMatches(count: number) {
  const db = new Database(":memory:")
  db.pragma("foreign_keys = ON")
  applyMigrations(db)
  const matches = new MatchesRepository(db)
  const participants = new ParticipantsRepository(db)
  for (let gameId = 1; gameId <= count; gameId += 1) {
    matches.insertMany([match(gameId)])
    participants.insertMany(lobby(gameId))
  }
  return { db, matches, participants }
}

function aramMatch(gameId: number): MatchRow {
  return match(gameId, {
    queueId: 450,
    gameMode: "ARAM",
    mode: "aram",
    modeFamily: "aram",
    mapId: 12,
  })
}

function rawLcuScoreboard(gameId: number) {
  return {
    gameId,
    gameDuration: 1_200,
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
  }
}

describe("MatchGradingService", () => {
  it("attributes timeline quality and ward completeness to the selected source", () => {
    const { db } = databaseWithMatches(10)
    const service = new MatchGradingService(db, () => 10_000)
    expect(service.ensureFrozenReference(BACKUP)).toMatchObject({ ready: 10 })
    const objective = {
      eventId: "dragon",
      timestamp: 12 * 60_000,
      type: "ELITE_MONSTER_KILL",
      category: "objective" as const,
      participantId: 2,
      assistingParticipantIds: [1],
      teamId: 100,
      objective: "DRAGON",
      position: { x: 5_000, y: 5_000 },
    }
    const matchV5Timeline: CompactTimeline = {
      frames: [],
      events: [{
        eventId: "ward",
        timestamp: 11 * 60_000,
        type: "WARD_PLACED",
        category: "vision",
        participantId: 1,
        teamId: 100,
        position: { x: 5_100, y: 5_100 },
      }, objective],
      turningPoints: [],
    }
    const localTimeline: CompactTimeline = {
      frames: [],
      events: [objective],
      turningPoints: [],
    }
    const sources = new MatchSourceRepository(db)
    sources.persistTimelineSource({
      gameId: 1,
      puuid: PUUID,
      source: "match_v5",
      sourceMatchId: "NA1_1",
      mapperVersion: TIMELINE_MAPPER_VERSION,
      timeline: matchV5Timeline,
      capturedAt: 1,
    })
    sources.persistTimelineSource({
      gameId: 1,
      puuid: PUUID,
      source: "league_client",
      sourceMatchId: "1",
      mapperVersion: TIMELINE_MAPPER_VERSION,
      timeline: localTimeline,
      capturedAt: 2,
    })
    db.prepare(`
      UPDATE match_timeline_sources SET updated_at = CASE source
        WHEN 'league_client' THEN 200 ELSE 100 END
      WHERE game_id = 1 AND puuid = ?
    `).run(PUUID)

    expect(service.gradeStoredMatch(1, PUUID)).toBe("ready")
    expect(db.prepare(`
      SELECT raw_evidence_state AS state, raw_value AS value,
             source_quality AS sourceQuality
      FROM match_metric_observations
      WHERE game_id = 1 AND puuid = ? AND participant_id = 1
        AND metric_key = 'objective_setup_ward_rate'
    `).get(PUUID)).toEqual({ state: "observed", value: 1, sourceQuality: "verified" })
  })

  it("does not derive v3 observations from an old-mapper compact fallback", () => {
    const { db } = databaseWithMatches(10)
    const service = new MatchGradingService(db, () => 10_000)
    expect(service.ensureFrozenReference(BACKUP)).toMatchObject({ ready: 10 })
    const participants = lobby(1)
    const stale: CompactTimeline = {
      frames: [{
        timestamp: 10 * 60_000,
        blueGold: 50_000,
        redGold: 49_000,
        ownerGold: 10_000,
        ownerLevel: 10,
        ownerXp: 5_000,
        ownerCs: 100,
        participants: participants.map((entry) => ({
          participantId: entry.participantId,
          teamId: entry.teamId,
          currentGold: 500,
          totalGold: entry.goldEarned,
          level: 10,
          xp: 5_000,
          minionsKilled: entry.totalMinionsKilled,
          jungleMinionsKilled: entry.neutralMinions,
        })),
      }],
      events: [],
      turningPoints: [],
    }
    db.prepare(`
      INSERT INTO match_timeline_cache
        (game_id, puuid, status, mapper_version, data_json, updated_at)
      VALUES (1, ?, 'ready', ?, ?, 1)
    `).run(PUUID, TIMELINE_MAPPER_VERSION - 1, JSON.stringify(stale))

    expect(service.gradeStoredMatch(1, PUUID)).toBe("ready")
    expect(db.prepare(`
      SELECT raw_evidence_state AS state, raw_evidence_reason AS reason
      FROM match_metric_observations
      WHERE game_id = 1 AND puuid = ? AND participant_id = 1
        AND metric_key = 'gold_delta_10'
    `).get(PUUID)).toEqual({ state: "unavailable", reason: "timeline_not_retained" })
  })

  it("waits for enough complete local matches before freezing a reference", () => {
    const { db } = databaseWithMatches(9)
    const service = new MatchGradingService(db, () => 10_000)

    expect(service.referenceStatus()).toMatchObject({
      state: "calibrating",
      eligibleMatches: 9,
      requiredMatches: 10,
    })
    expect(service.ensureFrozenReference(BACKUP)).toMatchObject({ state: "calibrating" })
    expect(db.prepare("SELECT COUNT(*) AS count FROM grade_calibration_snapshots").get())
      .toEqual({ count: 0 })
  })

  it("does not freeze ten matches split across underfilled scopes", () => {
    const { db, matches, participants } = databaseWithMatches(5)
    for (let gameId = 6; gameId <= 10; gameId += 1) {
      matches.insertMany([aramMatch(gameId)])
      participants.insertMany(lobby(gameId))
    }
    const service = new MatchGradingService(db, () => 10_000)

    expect(service.referenceStatus()).toMatchObject({
      state: "calibrating",
      eligibleMatches: 10,
      largestScopeMatches: 5,
      supportedScopes: [],
      supportedModes: [],
    })
    expect(service.ensureFrozenReference(BACKUP)).toMatchObject({ state: "calibrating" })
    expect(db.prepare("SELECT COUNT(*) AS count FROM grade_calibration_snapshots").get())
      .toEqual({ count: 0 })
  })

  it("discovers recoverable raw scoreboards before the empty-scope startup fast path", () => {
    const { db } = databaseWithMatches(10)
    db.prepare(`
      UPDATE match_participants
      SET grade_core_complete = 0, grade_core_source = 'legacy_unknown',
          grade_core_missing_fields_json = '["source_presence_unknown"]',
          grade_core_contract_version = 1
    `).run()
    const sources = new MatchSourceRepository(db)
    for (let gameId = 1; gameId <= 10; gameId += 1) {
      const identity = sources.persistRawPayload({
        ownerPuuid: PUUID,
        source: "league_client",
        sourceMatchId: String(gameId),
        gameId,
        kind: "scoreboard_detail",
        mapperVersion: 7,
        fetchedAt: gameId,
        body: rawLcuScoreboard(gameId),
      })
      sources.setMappingResult(identity, "mapped", gameId + 100, { gameId })
    }
    const service = new MatchGradingService(db, () => 10_000)

    expect(service.referenceStatus()).toMatchObject({
      state: "calibrating",
      eligibleMatches: 0,
      supportedScopes: [],
    })
    expect(service.hasRecoverableRawReferenceData()).toBe(true)
    expect(service.ensureFrozenReference(BACKUP)).toMatchObject({
      processed: 10,
      ready: 10,
    })
    expect(service.hasRecoverableRawReferenceData()).toBe(false)
    expect(service.referenceStatus()).toMatchObject({
      state: "frozen",
      referenceMatches: 10,
    })
  })

  it("removes legacy grade caches before exposing an underfilled v3 installation", () => {
    const { db } = databaseWithMatches(9)
    db.prepare(`
      UPDATE matches
      SET grade = 'A', grade_score = 0.5, grade_algorithm_version = 2,
          grade_status = 'ready', grade_composite_percentile = 0.7,
          grade_recipe_id = 'legacy:v2'
      WHERE game_id = 1 AND puuid = ?
    `).run(PUUID)
    db.prepare(`
      UPDATE match_participants
      SET grade = 'A', grade_score = 0.5, grade_algorithm_version = 2,
          grade_status = 'ready', grade_composite_percentile = 0.7,
          grade_recipe_id = 'legacy:v2'
      WHERE game_id = 1 AND puuid = ?
    `).run(PUUID)
    const service = new MatchGradingService(db, () => 10_000)

    expect(service.needsDirectCutover()).toBe(true)
    expect(service.ensureFrozenReference(BACKUP)).toMatchObject({ state: "calibrating" })
    expect(service.needsDirectCutover()).toBe(false)
    expect(db.prepare(`
      SELECT grade, grade_score AS gradeScore, grade_algorithm_version AS algorithmVersion,
             grade_recipe_id AS recipeId
      FROM matches WHERE game_id = 1 AND puuid = ?
    `).get(PUUID)).toEqual({
      grade: null,
      gradeScore: null,
      algorithmVersion: null,
      recipeId: null,
    })
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM match_participants
      WHERE game_id = 1 AND puuid = ? AND grade IS NOT NULL
    `).get(PUUID)).toEqual({ count: 0 })
  })

  it("clears pre-versioned grade caches before exposing an underfilled installation", () => {
    const { db } = databaseWithMatches(9)
    // Reproduce a cache written before the algorithm-version columns existed.
    db.exec(`
      DROP TRIGGER matches_grade_pair_update;
      DROP TRIGGER match_participants_grade_pair_update;
    `)
    db.prepare(`
      UPDATE matches
      SET grade = 'A', grade_score = 0.5, grade_algorithm_version = NULL,
          grade_status = NULL, grade_composite_percentile = NULL,
          grade_recipe_id = NULL
      WHERE game_id = 1 AND puuid = ?
    `).run(PUUID)
    db.prepare(`
      UPDATE match_participants
      SET grade = 'A', grade_score = 0.5, grade_algorithm_version = NULL,
          grade_status = NULL, grade_composite_percentile = NULL,
          grade_recipe_id = NULL
      WHERE game_id = 1 AND puuid = ?
    `).run(PUUID)
    const service = new MatchGradingService(db, () => 10_000)

    expect(service.needsDirectCutover()).toBe(true)
    expect(service.ensureFrozenReference(BACKUP)).toMatchObject({ state: "calibrating" })
    expect(service.needsDirectCutover()).toBe(false)
    expect(db.prepare(`
      SELECT grade, grade_score AS gradeScore, grade_algorithm_version AS algorithmVersion,
             grade_recipe_id AS recipeId
      FROM matches WHERE game_id = 1 AND puuid = ?
    `).get(PUUID)).toEqual({
      grade: null,
      gradeScore: null,
      algorithmVersion: null,
      recipeId: null,
    })
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM match_participants
      WHERE game_id = 1 AND puuid = ?
        AND (grade IS NOT NULL OR grade_score IS NOT NULL)
    `).get(PUUID)).toEqual({ count: 0 })
  })

  it("cuts over all stored matches and keeps the snapshot frozen for new games", () => {
    const { db, matches, participants } = databaseWithMatches(12)
    const service = new MatchGradingService(db, () => 10_000)
    const rebuilt = service.ensureFrozenReference(BACKUP)

    expect(rebuilt).toMatchObject({ processed: 12, errors: 0 })
    const frozen = service.referenceStatus()
    expect(frozen).toMatchObject({ state: "frozen", referenceMatches: 12 })
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM match_grade_attempts
      WHERE algorithm_version = 3
    `).get()).toEqual({ count: 12 })
    const selectedRvi = db.prepare(`
      SELECT selection.recipe_id AS recipeId,
             recipe.grade_recipe_id AS gradeRecipeId,
             recipe.calibration_id AS calibrationId
      FROM rvi_recipe_selections selection
      JOIN rvi_recipes recipe
        ON recipe.algorithm_version = selection.algorithm_version
       AND recipe.recipe_id = selection.recipe_id
      WHERE selection.algorithm_version = 3
    `).get() as { recipeId: string; gradeRecipeId: string; calibrationId: string }
    expect(selectedRvi).toMatchObject({
      gradeRecipeId: frozen.recipeId,
      calibrationId: frozen.calibrationId,
    })
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM match_metric_observations observation
      JOIN match_participants participant
        ON participant.game_id = observation.game_id
       AND participant.puuid = observation.puuid
       AND participant.participant_id = observation.participant_id
      WHERE observation.algorithm_version = 3
        AND observation.recipe_id = ? AND participant.is_player = 1
    `).get(selectedRvi.recipeId)).toEqual({ count: 12 * 62 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM matches").get()).toEqual({ count: 12 })

    const originalCalibration = frozen.calibrationId
    matches.insertMany([match(13)])
    participants.insertMany(lobby(13, 500))
    expect(service.gradeStoredMatch(13, PUUID)).toBe("ready")
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM match_metric_observations observation
      JOIN match_participants participant
        ON participant.game_id = observation.game_id
       AND participant.puuid = observation.puuid
       AND participant.participant_id = observation.participant_id
      WHERE observation.game_id = 13 AND observation.puuid = ?
        AND observation.recipe_id = ? AND participant.is_player = 1
    `).get(PUUID, selectedRvi.recipeId)).toEqual({ count: 62 })
    expect(service.referenceStatus()).toMatchObject({
      state: "frozen",
      calibrationId: originalCalibration,
      referenceMatches: 12,
      eligibleMatches: 13,
    })
  })

  it("recomputes a canonical position cached by an older resolver", () => {
    const { db } = databaseWithMatches(10)
    db.prepare(`
      UPDATE match_participants
      SET resolved_position = 'JUNGLE', position_resolver_version = ?
      WHERE game_id = 1 AND puuid = ? AND participant_id = 1
    `).run(POSITION_RESOLVER_VERSION - 1, PUUID)
    const service = new MatchGradingService(db, () => 10_000)

    expect(service.ensureFrozenReference(BACKUP)).toMatchObject({
      processed: 10,
      ready: 10,
    })
    expect(db.prepare(`
      SELECT resolved_position AS position,
             position_resolver_version AS resolverVersion
      FROM match_participants
      WHERE game_id = 1 AND puuid = ? AND participant_id = 1
    `).get(PUUID)).toEqual({
      position: "TOP",
      resolverVersion: POSITION_RESOLVER_VERSION,
    })
  })

  it("reconciles a bad LCU jungle lane for top and grades the match", () => {
    const { db, matches, participants } = databaseWithMatches(10)
    const service = new MatchGradingService(db, () => 10_000)
    expect(service.ensureFrozenReference(BACKUP)).toMatchObject({ ready: 10 })

    const broken = lobby(11)
    broken[0] = participant({
      ...broken[0],
      assignedPosition: undefined,
      resolvedPosition: "JUNGLE",
      positionResolverVersion: POSITION_RESOLVER_VERSION - 1,
      lane: "JUNGLE",
      role: "TOP",
      lcuLane: "JUNGLE",
      lcuRole: "NONE",
      spell1Id: 4,
      spell2Id: 12,
    })
    broken[1] = participant({
      ...broken[1],
      assignedPosition: undefined,
      resolvedPosition: "JUNGLE",
      positionResolverVersion: POSITION_RESOLVER_VERSION - 1,
      lane: "JUNGLE",
      role: "JUNGLE",
      lcuLane: "JUNGLE",
      lcuRole: "NONE",
      spell1Id: 11,
      spell2Id: 4,
    })
    matches.insertMany([match(11)])
    participants.insertMany(broken)

    expect(service.gradeStoredMatch(11, PUUID)).toBe("ready")
    expect(db.prepare(`
      SELECT participant_id AS participantId, resolved_position AS position,
             position_resolver_version AS resolverVersion
      FROM match_participants
      WHERE game_id = 11 AND puuid = ? AND participant_id IN (1, 2)
      ORDER BY participant_id
    `).all(PUUID)).toEqual([
      { participantId: 1, position: "TOP", resolverVersion: POSITION_RESOLVER_VERSION },
      { participantId: 2, position: "JUNGLE", resolverVersion: POSITION_RESOLVER_VERSION },
    ])
  })

  it("withholds a later unrepresented mode until explicit recalibration", () => {
    const { db, matches, participants } = databaseWithMatches(10)
    const service = new MatchGradingService(db, () => 10_000)
    const first = service.ensureFrozenReference(BACKUP)
    expect(first).toMatchObject({ processed: 10, errors: 0 })
    expect(service.referenceStatus()).toMatchObject({
      supportedModes: ["sr_normal"],
      referenceMatches: 10,
    })

    for (let gameId = 101; gameId <= 110; gameId += 1) {
      matches.insertMany([aramMatch(gameId)])
      participants.insertMany(lobby(gameId))
      expect(service.gradeStoredMatch(gameId, PUUID)).toBe("calibrating")
    }
    expect(service.referenceStatus()).toMatchObject({
      state: "frozen",
      eligibleMatches: 20,
      supportedModes: ["sr_normal"],
      referenceMatches: 10,
    })
    expect(db.prepare(`
      SELECT grade_status AS status FROM matches WHERE game_id = 101 AND puuid = ?
    `).get(PUUID)).toEqual({ status: "calibrating" })

    const rebuilt = service.rebuildReference(BACKUP)
    expect(rebuilt).toMatchObject({ processed: 20, ready: 20, errors: 0 })
    expect(service.referenceStatus()).toMatchObject({
      supportedModes: ["aram", "sr_normal"],
      referenceMatches: 20,
    })
    expect(db.prepare(`
      SELECT grade_status AS status FROM matches WHERE game_id = 101 AND puuid = ?
    `).get(PUUID)).toEqual({ status: "ready" })
  })

  it("treats an older v3 recipe definition as a required direct cutover", () => {
    const { db } = databaseWithMatches(12)
    const grades = new GradePersistenceRepository(db, () => 9_000)
    const calibrationId = "recall.grade.v3.calibration.old"
    const recipeId = `recall.grade.v3.definition.old@calibration:${calibrationId}`
    grades.registerCalibration({
      calibrationId,
      calibrationHash: "c".repeat(64),
      referencePopulation: { kind: "old" },
      sampleCount: 12,
      snapshot: { formatVersion: 1 },
    })
    grades.registerRecipe({
      recipeId,
      algorithmVersion: 3,
      recipeHash: "d".repeat(64),
      calibrationId,
      definition: { recipeDefinitionId: "recall.grade.v3.definition.old" },
    })
    grades.selectRecipe(recipeId)
    const service = new MatchGradingService(db, () => 10_000)

    expect(service.referenceStatus().state).toBe("calibrating")
    expect(service.needsDirectCutover()).toBe(true)
    expect(service.gradeStoredMatch(1, PUUID)).toBe("calibrating")
    const rebuilt = service.ensureFrozenReference(BACKUP)
    expect(rebuilt).toMatchObject({ processed: 12, errors: 0 })
    expect(service.referenceStatus().recipeId).toContain(MATCH_GRADE_RECIPE_DEFINITION_ID)
    expect(service.needsDirectCutover()).toBe(false)
  })

  it("rolls a supported direct cutover purge back with a failed rebuild", () => {
    const { db } = databaseWithMatches(12)
    db.prepare(`
      UPDATE matches
      SET grade = 'A', grade_score = 0.5, grade_algorithm_version = 2,
          grade_status = 'ready', grade_composite_percentile = 0.7,
          grade_recipe_id = 'legacy:v2'
      WHERE game_id = 1 AND puuid = ?
    `).run(PUUID)
    db.exec(`
      CREATE TRIGGER fail_direct_cutover_attempt
      BEFORE INSERT ON match_grade_attempts
      WHEN NEW.game_id = 12
      BEGIN
        SELECT RAISE(ABORT, 'simulated_direct_cutover_failure');
      END;
    `)
    const service = new MatchGradingService(db, () => 10_000)

    expect(() => service.ensureFrozenReference(BACKUP))
      .toThrow("simulated_direct_cutover_failure")
    expect(service.referenceStatus().state).toBe("calibrating")
    expect(service.needsDirectCutover()).toBe(true)
    expect(db.prepare(`
      SELECT grade, grade_algorithm_version AS algorithmVersion,
             grade_recipe_id AS recipeId
      FROM matches WHERE game_id = 1 AND puuid = ?
    `).get(PUUID)).toEqual({ grade: "A", algorithmVersion: 2, recipeId: "legacy:v2" })
    expect(db.prepare("SELECT COUNT(*) AS count FROM grade_calibration_snapshots").get())
      .toEqual({ count: 0 })
  })

  it("manual recalibration creates a new snapshot and regrades every match", () => {
    const { db, matches, participants } = databaseWithMatches(12)
    const service = new MatchGradingService(db, () => 10_000)
    service.ensureFrozenReference(BACKUP)
    const first = service.referenceStatus().calibrationId
    matches.insertMany([match(13)])
    participants.insertMany(lobby(13, 500))

    const rebuilt = service.rebuildReference(BACKUP)
    const second = service.referenceStatus()
    expect(rebuilt).toMatchObject({ processed: 13, errors: 0 })
    expect(second.calibrationId).not.toBe(first)
    expect(second.referenceMatches).toBe(13)
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM match_grade_attempts
      WHERE algorithm_version = 3 AND recipe_id = ?
    `).get(second.recipeId)).toEqual({ count: 13 })
  })

  it("rolls the whole rebuild back if recalibration is interrupted", () => {
    const { db, matches, participants } = databaseWithMatches(12)
    const service = new MatchGradingService(db, () => 10_000)
    service.ensureFrozenReference(BACKUP)
    const before = service.referenceStatus()
    matches.insertMany([match(13)])
    participants.insertMany(lobby(13, 500))

    expect(() => service.rebuildReference(BACKUP, () => {
      throw new Error("simulated_interrupt")
    })).toThrow("simulated_interrupt")

    expect(service.referenceStatus()).toMatchObject({
      state: "frozen",
      recipeId: before.recipeId,
      calibrationId: before.calibrationId,
      referenceMatches: 12,
    })
    expect(db.prepare("SELECT COUNT(*) AS count FROM grade_calibration_snapshots").get())
      .toEqual({ count: 1 })
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM match_grade_attempts
      WHERE algorithm_version = 3 AND recipe_id = ?
    `).get(before.recipeId)).toEqual({ count: 12 })
  })

  it("rolls back the selected recipe and all caches on an unexpected write failure", () => {
    const { db, matches, participants } = databaseWithMatches(12)
    const service = new MatchGradingService(db, () => 10_000)
    service.ensureFrozenReference(BACKUP)
    const before = service.referenceStatus()
    matches.insertMany([match(13)])
    participants.insertMany(lobby(13, 500))
    db.exec(`
      CREATE TRIGGER fail_recall_v3_attempt
      BEFORE INSERT ON match_grade_attempts
      WHEN NEW.game_id = 13
      BEGIN
        SELECT RAISE(ABORT, 'simulated_grade_write_failure');
      END;
    `)

    expect(() => service.rebuildReference(BACKUP)).toThrow("simulated_grade_write_failure")
    expect(service.referenceStatus()).toMatchObject({
      state: "frozen",
      recipeId: before.recipeId,
      calibrationId: before.calibrationId,
      referenceMatches: 12,
    })
    expect(db.prepare("SELECT COUNT(*) AS count FROM grade_calibration_snapshots").get())
      .toEqual({ count: 1 })
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM match_grade_attempts
      WHERE algorithm_version = 3 AND recipe_id = ?
    `).get(before.recipeId)).toEqual({ count: 12 })
    expect(db.prepare(`
      SELECT grade_status AS status FROM matches WHERE game_id = 13 AND puuid = ?
    `).get(PUUID)).toEqual({ status: null })
  })

  it("withholds missing source facts, invalid durations, and terminated matches but accepts observed zero", () => {
    const { db, matches, participants } = databaseWithMatches(13)
    db.prepare(`
      UPDATE match_participants
      SET kills = 0, grade_core_complete = 0,
          grade_core_missing_fields_json = '["kills"]'
      WHERE game_id = 11 AND puuid = ? AND participant_id = 1
    `).run(PUUID)
    db.prepare(`
      UPDATE matches SET duration_quality = 'inconsistent'
      WHERE game_id = 12 AND puuid = ?
    `).run(PUUID)
    db.prepare(`
      UPDATE matches SET ended_in_early_surrender = 1
      WHERE game_id = 13 AND puuid = ?
    `).run(PUUID)
    const service = new MatchGradingService(db, () => 10_000)

    expect(service.ensureFrozenReference(BACKUP)).toMatchObject({
      processed: 13,
      ready: 10,
      nonready: 3,
      errors: 0,
    })
    expect(db.prepare(`
      SELECT game_id AS gameId, grade_status AS status
      FROM match_grade_attempts
      WHERE game_id IN (11, 12, 13) AND puuid = ? AND algorithm_version = 3
      ORDER BY game_id
    `).all(PUUID)).toEqual([
      { gameId: 11, status: "missing_source_fact" },
      { gameId: 12, status: "invalid_duration" },
      { gameId: 13, status: "terminated" },
    ])

    matches.insertMany([match(14)])
    participants.insertMany(lobby(14))
    db.prepare(`
      UPDATE match_participants
      SET kills = 0, deaths = 0, assists = 0, gold_earned = 0,
          damage_to_champions = 0, total_minions_killed = 0,
          neutral_minions = 0, damage_objectives = 0, damage_turrets = 0,
          time_ccing_others = 0, vision_score = 0,
          grade_core_complete = 1, grade_core_missing_fields_json = '[]'
      WHERE game_id = 14 AND puuid = ?
    `).run(PUUID)
    expect(service.gradeStoredMatch(14, PUUID)).toBe("ready")
  })

  it("stores an explicit non-ready attempt for unsupported modes", () => {
    const { db, matches, participants } = databaseWithMatches(12)
    const service = new MatchGradingService(db, () => 10_000)
    service.ensureFrozenReference(BACKUP)
    matches.insertMany([match(99, {
      queueId: 900,
      gameMode: "URF",
      mode: "urf",
      modeFamily: "other",
    })])
    participants.insertMany(lobby(99))

    expect(service.gradeStoredMatch(99, PUUID)).toBe("unsupported_mode")
    expect(db.prepare(`
      SELECT grade_status AS status FROM match_grade_attempts
      WHERE game_id = 99 AND puuid = ? AND algorithm_version = 3
    `).get(PUUID)).toEqual({ status: "unsupported_mode" })
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM match_grade_results WHERE game_id = 99
    `).get()).toEqual({ count: 0 })
  })
})
