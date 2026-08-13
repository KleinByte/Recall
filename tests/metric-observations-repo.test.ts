import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { GradePersistenceRepository } from
  "../electron/main/database/grade-persistence-repo.js"
import { MetricObservationsRepository } from
  "../electron/main/database/metric-observations-repo.js"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { ParticipantsRepository } from
  "../electron/main/database/participants-repo.js"
import type { MatchMetricObservation } from
  "../electron/main/matches/match-metric-observations.js"
import type { ParticipantRow } from "../electron/main/matches/types.js"
import { buildMatchRow } from "./fixtures/matches.js"

const PUUID = "metric-owner"
const OTHER_PUUID = "other-owner"
const CALIBRATION_ID = "calibration:test"
const GRADE_RECIPE_ID = "grade:test"
const RVI_RECIPE_A = "rvi:test-a"
const RVI_RECIPE_B = "rvi:test-b"

const participant = (overrides: Partial<ParticipantRow> = {}): ParticipantRow => ({
  gameId: 1,
  puuid: PUUID,
  participantId: 1,
  teamId: 100,
  isPlayer: 1,
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

let db: InstanceType<typeof Database>
let metrics: MetricObservationsRepository

const observation = (
  overrides: Partial<MatchMetricObservation> = {},
): MatchMetricObservation => ({
  gameId: 1,
  puuid: PUUID,
  participantId: 1,
  metricKey: "damage_share",
  recipeId: RVI_RECIPE_A,
  calibrationId: CALIBRATION_ID,
  rawEvidence: { state: "observed", value: 0 },
  scoreEvidence: { state: "observed", value: 0 },
  unit: "ratio",
  numerator: 0,
  denominator: 10_000,
  comparisonScope: "position",
  referenceMatchCount: 30,
  source: "scoreboard",
  sourceQuality: "verified",
  derivationId: "summary-v1",
  derivedAt: 2_000,
  ...overrides,
})

function registerRviRecipe(recipeId: string, hashCharacter: string) {
  metrics.registerRecipe({
    recipeId,
    algorithmVersion: 3,
    recipeHash: hashCharacter.repeat(64),
    gradeRecipeId: GRADE_RECIPE_ID,
    calibrationId: CALIBRATION_ID,
    definition: { recipeDefinitionId: recipeId },
    createdAt: 1_500,
  })
}

beforeEach(() => {
  db = new Database(":memory:")
  db.pragma("foreign_keys = ON")
  applyMigrations(db)
  const matches = new MatchesRepository(db)
  const participants = new ParticipantsRepository(db)
  matches.insertMany([
    buildMatchRow({ gameId: 1, puuid: PUUID, playedAt: 100 }),
    buildMatchRow({ gameId: 2, puuid: OTHER_PUUID, playedAt: 200 }),
  ])
  participants.insertMany([
    participant(),
    participant({ gameId: 2, puuid: OTHER_PUUID }),
  ])
  const grades = new GradePersistenceRepository(db, () => 1_000)
  grades.registerCalibration({
    calibrationId: CALIBRATION_ID,
    calibrationHash: "c".repeat(64),
    referencePopulation: { mode: "sr" },
    sampleCount: 2,
    snapshot: { cohorts: [] },
    createdAt: 1_000,
  })
  grades.registerRecipe({
    recipeId: GRADE_RECIPE_ID,
    algorithmVersion: 3,
    recipeHash: "f".repeat(64),
    calibrationId: CALIBRATION_ID,
    definition: { recipeDefinitionId: "grade:test" },
    createdAt: 1_000,
  })
  metrics = new MetricObservationsRepository(db, () => 2_000)
  registerRviRecipe(RVI_RECIPE_A, "a")
  registerRviRecipe(RVI_RECIPE_B, "b")
  metrics.selectRecipe(RVI_RECIPE_A)
})

describe("MetricObservationsRepository", () => {
  it("registers immutable exact recipes and rejects conflicting metadata", () => {
    expect(metrics.getSelectedRecipe(3)).toMatchObject({
      recipeId: RVI_RECIPE_A,
      gradeRecipeId: GRADE_RECIPE_ID,
      calibrationId: CALIBRATION_ID,
      definition: { recipeDefinitionId: RVI_RECIPE_A },
    })
    expect(() => db.prepare(
      "UPDATE rvi_recipes SET definition_json = '{}' WHERE recipe_id = ?",
    ).run(RVI_RECIPE_A)).toThrow("rvi_recipe_is_immutable")
    expect(() => metrics.registerRecipe({
      recipeId: RVI_RECIPE_A,
      algorithmVersion: 3,
      recipeHash: "d".repeat(64),
      gradeRecipeId: GRADE_RECIPE_ID,
      calibrationId: CALIBRATION_ID,
      definition: {},
    })).toThrow("rvi_recipe_registration_conflict")
  })

  it("requires a Grade recipe with the same version and calibration", () => {
    expect(() => db.prepare(`
      INSERT INTO rvi_recipes
        (recipe_id, algorithm_version, recipe_hash, grade_recipe_id,
         calibration_id, definition_json, created_at)
      VALUES ('rvi:bad', 2, ?, ?, ?, '{}', 1)
    `).run("e".repeat(64), GRADE_RECIPE_ID, CALIBRATION_ID))
      .toThrow("rvi_grade_recipe_calibration_mismatch")
  })

  it("round-trips observed zero and unavailable evidence without conflating them", () => {
    expect(metrics.replaceMatchObservations({
      gameId: 1,
      puuid: PUUID,
      algorithmVersion: 3,
      recipeId: RVI_RECIPE_A,
      observations: [
        observation(),
        observation({
          metricKey: "time_dead_share",
          rawEvidence: { state: "unavailable", reason: "source_field_absent" },
          scoreEvidence: { state: "unavailable", reason: "raw_unavailable" },
          numerator: undefined,
          denominator: undefined,
          comparisonScope: undefined,
          referenceMatchCount: undefined,
          source: "extended",
          sourceQuality: "legacy",
        }),
      ],
    })).toBe(2)

    expect(metrics.getMatchObservations(1, PUUID, 1, 3, RVI_RECIPE_A))
      .toEqual([
        { ...observation(), algorithmVersion: 3 },
        { ...observation({
          metricKey: "time_dead_share",
          rawEvidence: { state: "unavailable", reason: "source_field_absent" },
          scoreEvidence: { state: "unavailable", reason: "raw_unavailable" },
          numerator: undefined,
          denominator: undefined,
          comparisonScope: undefined,
          referenceMatchCount: undefined,
          source: "extended",
          sourceQuality: "legacy",
        }), algorithmVersion: 3 },
      ])
    expect(db.prepare(`
      SELECT raw_value AS rawValue, score_value AS scoreValue
      FROM match_metric_observations
      WHERE metric_key = 'time_dead_share'
    `).get()).toEqual({ rawValue: null, scoreValue: null })
  })

  it("replaces a match idempotently and keeps other accounts isolated", () => {
    const first = observation()
    metrics.replaceMatchObservations({
      gameId: 1, puuid: PUUID, algorithmVersion: 3,
      recipeId: RVI_RECIPE_A, observations: [first],
    })
    const other = observation({
      gameId: 2,
      puuid: OTHER_PUUID,
      rawEvidence: { state: "observed", value: 0.4 },
      scoreEvidence: { state: "observed", value: 0.6 },
    })
    metrics.replaceMatchObservations({
      gameId: 2, puuid: OTHER_PUUID, algorithmVersion: 3,
      recipeId: RVI_RECIPE_A, observations: [other],
    })
    const replacement = observation({
      rawEvidence: { state: "observed", value: 0.2 },
      scoreEvidence: { state: "observed", value: 0.7 },
    })
    metrics.replaceMatchObservations({
      gameId: 1, puuid: PUUID, algorithmVersion: 3,
      recipeId: RVI_RECIPE_A, observations: [replacement],
    })

    expect(metrics.getOwnerHistory(PUUID, 3, RVI_RECIPE_A)).toEqual([
      { ...replacement, algorithmVersion: 3, playedAt: 100 },
    ])
    expect(metrics.getOwnerHistory(OTHER_PUUID, 3, RVI_RECIPE_A)).toEqual([
      { ...other, algorithmVersion: 3, playedAt: 200 },
    ])
  })

  it("rejects mixed recipe writes and requires a purge before selection changes", () => {
    metrics.replaceMatchObservations({
      gameId: 1, puuid: PUUID, algorithmVersion: 3,
      recipeId: RVI_RECIPE_A, observations: [observation()],
    })
    expect(() => metrics.selectRecipe(RVI_RECIPE_B))
      .toThrow("rvi_recipe_purge_required")
    expect(() => metrics.replaceMatchObservations({
      gameId: 1, puuid: PUUID, algorithmVersion: 3,
      recipeId: RVI_RECIPE_B,
      observations: [observation({ recipeId: RVI_RECIPE_B })],
    })).toThrow("rvi_recipe_not_selected")

    expect(metrics.purgeObservations({ algorithmVersion: 3 })).toBe(1)
    expect(metrics.selectRecipe(RVI_RECIPE_B).recipeId).toBe(RVI_RECIPE_B)
  })

  it("rolls back composed production writes when a participant is unknown", () => {
    const replaceBoth = db.transaction(() => {
      metrics.replaceMatchObservations({
        gameId: 1, puuid: PUUID, algorithmVersion: 3,
        recipeId: RVI_RECIPE_A, observations: [observation()],
      })
      metrics.replaceMatchObservations({
        gameId: 2, puuid: OTHER_PUUID, algorithmVersion: 3,
        recipeId: RVI_RECIPE_A,
        observations: [observation({
          gameId: 2, puuid: OTHER_PUUID, participantId: 99,
        })],
      })
    })

    expect(() => replaceBoth()).toThrow()
    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM match_metric_observations",
    ).get()).toEqual({ count: 0 })
  })
})
