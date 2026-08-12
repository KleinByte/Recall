import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import {
  GradePersistenceRepository,
  type CanonicalGradeResultInput,
} from "../electron/main/database/grade-persistence-repo.js"
import { InsightsRepository } from "../electron/main/database/insights-repo.js"
import { MetricObservationsRepository } from
  "../electron/main/database/metric-observations-repo.js"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { ParticipantsRepository } from "../electron/main/database/participants-repo.js"
import { ReviewRepository } from "../electron/main/database/review-repo.js"
import type { ParticipantRow } from "../electron/main/matches/types.js"
import {
  MATCH_GRADE_ARM_KEYS,
  MATCH_GRADE_RECIPE_DEFINITION_ID,
} from "../electron/main/matches/match-grade-recipe.js"
import type { PrimaryArchetype } from "../electron/main/matches/match-grade-taxonomy.js"
import { RVI_VECTOR_KEYS } from "../electron/main/matches/rvi-contract.js"
import {
  rviRecipeDefinition,
  rviRecipeIdForCalibration,
} from "../electron/main/matches/rvi-recipe.js"
import { buildMatchRow } from "./fixtures/matches.js"

const PUUID = "rvi-owner"
const CALIBRATION_ID = "recall.grade.v3.calibration.test"
const RECIPE_ID = `${MATCH_GRADE_RECIPE_DEFINITION_ID}@calibration:${CALIBRATION_ID}`
const OTHER_RECIPE_ID = "recall.grade.v3.definition.other@calibration:test"
const STALE_RECIPE_DEFINITION_ID = "recall.grade.v3.definition.2026-08-08.r1"
const STALE_RECIPE_ID = `${STALE_RECIPE_DEFINITION_ID}@calibration:${CALIBRATION_ID}`
const INPUT_HASH = "1".repeat(64)

let db: InstanceType<typeof Database>
let matches: MatchesRepository
let participants: ParticipantsRepository
let insights: InsightsRepository
let grades: GradePersistenceRepository
let reviews: ReviewRepository

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

function addLobby(
  gameId: number,
  playedAt: number,
  championId: number,
  position: string,
  mode: "sr_normal" | "aram" = "sr_normal",
) {
  matches.insertMany([buildMatchRow({
    gameId,
    playedAt,
    puuid: PUUID,
    championId,
    mode,
    modeFamily: mode === "aram" ? "aram" : "sr",
    role: position,
  })])
  participants.insertMany(Array.from({ length: 10 }, (_, index) => participant({
    gameId,
    participantId: index + 1,
    teamId: index < 5 ? 100 : 200,
    isPlayer: index === 0 ? 1 : 0,
    championId: index === 0 ? championId : 1_000 + index,
    role: index === 0 ? position : undefined,
  })))
  db.prepare(
    `UPDATE match_participants SET resolved_position = ?
     WHERE game_id = ? AND puuid = ? AND is_player = 1`,
  ).run(position, gameId, PUUID)
}

function selectRecipe() {
  grades.registerCalibration({
    calibrationId: CALIBRATION_ID,
    calibrationHash: "a".repeat(64),
    referencePopulation: { population: "local_recall_installation" },
    sampleCount: 50,
    snapshot: { matchIds: [1, 2, 3] },
  })
  grades.registerRecipe({
    recipeId: RECIPE_ID,
    algorithmVersion: 3,
    recipeHash: "b".repeat(64),
    calibrationId: CALIBRATION_ID,
    definition: {
      recipeDefinitionId: MATCH_GRADE_RECIPE_DEFINITION_ID,
      familyKeys: MATCH_GRADE_ARM_KEYS,
    },
  })
  grades.registerRecipe({
    recipeId: OTHER_RECIPE_ID,
    algorithmVersion: 3,
    recipeHash: "c".repeat(64),
    calibrationId: CALIBRATION_ID,
    definition: {
      recipeDefinitionId: "recall.grade.v3.definition.other",
      familyKeys: MATCH_GRADE_ARM_KEYS,
      other: true,
    },
  })
  grades.selectRecipe(RECIPE_ID)
}

function selectStaleRecipe() {
  grades.registerCalibration({
    calibrationId: CALIBRATION_ID,
    calibrationHash: "d".repeat(64),
    referencePopulation: { population: "local_recall_installation" },
    sampleCount: 50,
    snapshot: { matchIds: [1, 2, 3] },
  })
  grades.registerRecipe({
    recipeId: STALE_RECIPE_ID,
    algorithmVersion: 3,
    recipeHash: "e".repeat(64),
    calibrationId: CALIBRATION_ID,
    definition: {
      recipeDefinitionId: STALE_RECIPE_DEFINITION_ID,
      familyKeys: MATCH_GRADE_ARM_KEYS,
    },
  })
  grades.selectRecipe(STALE_RECIPE_ID)
}

function selectRviRecipe() {
  const repository = new MetricObservationsRepository(db, () => 10_000)
  const definition = rviRecipeDefinition(RECIPE_ID, CALIBRATION_ID)
  repository.registerRecipe({
    recipeId: definition.recipeId,
    algorithmVersion: 3,
    recipeHash: "f".repeat(64),
    gradeRecipeId: RECIPE_ID,
    calibrationId: CALIBRATION_ID,
    definition,
  })
  repository.selectRecipe(definition.recipeId)
  return repository
}

interface ReadyOptions {
  recipeId?: string
  recipeDefinitionId?: string
  primaryArchetype?: PrimaryArchetype
  protection?:
    | { evidenceState: "observed"; percentile: number }
    | { evidenceState: "unavailable" | "missing" }
}

function writeReady(
  gameId: number,
  ownerRecallScore: number,
  ownerComponents: Array<{ key: string; componentScore: number }>,
  options: ReadyOptions = {},
) {
  const recipeId = options.recipeId ?? RECIPE_ID
  const recipeDefinitionId = options.recipeDefinitionId ?? MATCH_GRADE_RECIPE_DEFINITION_ID
  const primaryArchetype = options.primaryArchetype ?? "assassin"
  const familySignals: Record<string, string[]> = {
    combat: ["damage_share", "kill_participation"],
    positioning_survival: ["deaths_per_10"],
    economy: ["gold_per_min", "cs_per_min"],
    objectives_macro: ["neutral_objective_damage_per_min", "structure_damage_per_min"],
    vision_setup: ["vision_score_per_min"],
    control_utility: ["cc_seconds_per_min"],
  }
  const storedComponents = (components: Array<{ key: string; componentScore: number }>) =>
    components.map((component) => {
      const signalKeys = familySignals[component.key] ?? []
      return {
        ...component,
        label: component.key[0].toUpperCase() + component.key.slice(1),
        weight: 1 / components.length,
        contribution: component.componentScore / components.length,
        comparisonScope: "role" as const,
        responsibilityTier: 2,
        signals: signalKeys.map((key) => ({
          key,
          percentile: component.componentScore,
          weight: 1 / signalKeys.length,
          evidenceState: "observed",
          sourceEvidenceState: "observed",
        })),
      }
    })
  const results = new Map<number, CanonicalGradeResultInput>()
  for (let participantId = 1; participantId <= 10; participantId += 1) {
    const recallScore = participantId === 1 ? ownerRecallScore : 50
    results.set(participantId, {
      participantId,
      grade: participantId === 1 ? "A" : "B",
      gradeScore: participantId === 1 ? 0.5 : 0,
      recallScore,
      lobbyPercentile: participantId / 10,
      evidenceCoverage: 1,
      referenceSampleCount: 50,
      breakdown: {
        algorithmVersion: 3,
        recipeDefinitionId,
        recipeId,
        primaryArchetype: participantId === 1 ? primaryArchetype : "specialist",
        recallScore,
        components: participantId === 1
          ? storedComponents(ownerComponents)
          : storedComponents([{ key: "combat", componentScore: 0.5 }]),
        diagnosticMetrics: participantId === 1 && options.protection
          ? [{
            key: "ally_heal_shield_per_min",
            sourceEvidenceState: options.protection.evidenceState,
            ...options.protection,
          }]
          : [],
      },
    })
  }
  grades.writeCanonicalGrade(gameId, PUUID, {
    algorithmVersion: 3,
    recipeId,
    inputFingerprint: INPUT_HASH,
    status: "ready",
    evidenceCoverage: 1,
    referenceSampleCount: 50,
    results,
  })
}

beforeEach(() => {
  db = new Database(":memory:")
  db.pragma("foreign_keys = ON")
  applyMigrations(db)
  matches = new MatchesRepository(db)
  participants = new ParticipantsRepository(db)
  insights = new InsightsRepository(db)
  grades = new GradePersistenceRepository(db, () => 10_000)
  reviews = new ReviewRepository(db)
})

describe("ReviewRepository.getGradeBreakdown", () => {
  it("returns a zero percentile only when the selected v3 artifact observed zero", () => {
    selectRecipe()
    addLobby(1, 1_000, 84, "MIDDLE")
    writeReady(1, 40, [
      { key: "combat", componentScore: 0 },
      { key: "economy", componentScore: 0.8 },
    ])

    expect(reviews.getGradeBreakdown(1, PUUID, 1)).toMatchObject({
      algorithmVersion: 3,
      recipeId: RECIPE_ID,
      recallScore: 40,
      compositePercentile: 0.4,
      components: [
        expect.objectContaining({ key: "combat", percentile: 0 }),
        expect.objectContaining({ key: "economy", percentile: 0.8 }),
      ],
    })
  })

  it("withholds missing component evidence and disagreeing ready artifacts", () => {
    selectRecipe()
    for (let gameId = 1; gameId <= 4; gameId += 1) {
      addLobby(gameId, gameId * 1_000, 84 + gameId, "MIDDLE")
      writeReady(gameId, 70 + gameId, [{ key: "combat", componentScore: 0.7 }])
    }

    const malformed = db.prepare(`
      SELECT components_json AS componentsJson
      FROM match_grade_breakdown_versions
      WHERE game_id = 1 AND puuid = ? AND participant_id = 1 AND algorithm_version = 3
    `).get(PUUID) as { componentsJson: string }
    const missingPercentile = JSON.parse(malformed.componentsJson) as {
      components: Array<Record<string, unknown>>
    }
    delete missingPercentile.components[0].componentScore
    db.prepare(`
      UPDATE match_grade_breakdown_versions SET components_json = ?
      WHERE game_id = 1 AND puuid = ? AND participant_id = 1 AND algorithm_version = 3
    `).run(JSON.stringify(missingPercentile), PUUID)

    db.prepare(`
      UPDATE match_grade_breakdown_versions SET role_fit_score = role_fit_score + 1
      WHERE game_id = 2 AND puuid = ? AND participant_id = 1 AND algorithm_version = 3
    `).run(PUUID)
    db.prepare(`
      UPDATE match_grade_attempts SET owner_participant_id = 2
      WHERE game_id = 3 AND puuid = ? AND algorithm_version = 3
    `).run(PUUID)
    db.prepare(`
      UPDATE match_grade_attempts SET grade_status = 'calibrating'
      WHERE game_id = 4 AND puuid = ? AND algorithm_version = 3
    `).run(PUUID)

    for (let gameId = 1; gameId <= 4; gameId += 1) {
      expect(reviews.getGradeBreakdown(gameId, PUUID, 1)).toBeUndefined()
    }
  })

  it("never promotes selected legacy:v3 artifacts into current Review", () => {
    addLobby(1, 1_000, 84, "MIDDLE")
    db.prepare(`
      INSERT INTO grade_recipe_selections (algorithm_version, recipe_id, selected_at)
      VALUES (3, 'legacy:v3', 1)
    `).run()
    db.prepare(`
      INSERT INTO match_grade_attempts
        (game_id, puuid, algorithm_version, owner_participant_id, grade_status,
         input_fingerprint, attempted_at, recipe_id, role_fit_score)
      VALUES (1, ?, 3, 1, 'ready', ?, 1, 'legacy:v3', 50)
    `).run(PUUID, INPUT_HASH)
    db.prepare(`
      INSERT INTO match_grade_results
        (game_id, puuid, participant_id, algorithm_version, grade, grade_score,
         composite_percentile, grade_status, created_at, recipe_id, role_fit_score)
      VALUES (1, ?, 1, 3, 'B', 0, .5, 'ready', 1, 'legacy:v3', 50)
    `).run(PUUID)
    db.prepare(`
      INSERT INTO match_grade_breakdown_versions
        (game_id, puuid, participant_id, algorithm_version, composite_percentile,
         components_json, created_at, recipe_id, role_fit_score)
      VALUES (1, ?, 1, 3, .5, ?, 1, 'legacy:v3', 50)
    `).run(PUUID, JSON.stringify({
      algorithmVersion: 3,
      recipeId: "legacy:v3",
      recallScore: 50,
      components: [{
        key: "combat",
        label: "Fighting",
        componentScore: 0.5,
        weight: 1,
        contribution: 0.5,
        comparisonScope: "role",
      }],
    }))

    expect(reviews.getGradeBreakdown(1, PUUID, 1)).toBeUndefined()
  })
})

describe("compiled match Grade recipe identity", () => {
  it("withholds a calibrated nonlegacy recipe from a prior code definition", () => {
    selectStaleRecipe()
    addLobby(1, 1_000, 84, "MIDDLE")
    writeReady(
      1,
      75,
      [{ key: "combat", componentScore: 0.75 }],
      {
        recipeId: STALE_RECIPE_ID,
        recipeDefinitionId: STALE_RECIPE_DEFINITION_ID,
      },
    )

    expect(insights.getRviObservations({ puuid: PUUID })).toBeUndefined()
    expect(insights.getGradeComponentHistory({ puuid: PUUID })).toEqual([])
    expect(reviews.getGradeBreakdown(1, PUUID, 1)).toBeUndefined()
  })
})

describe("InsightsRepository.getRviObservations", () => {
  it("uses the entire selected-recipe history unless a caller explicitly requests a window", () => {
    selectRecipe()
    for (let gameId = 1; gameId <= 241; gameId += 1) {
      addLobby(gameId, gameId * 1_000, 84, "MIDDLE")
      writeReady(gameId, 50, [{ key: "combat", componentScore: 0.5 }])
    }

    expect(insights.getRviObservations({ puuid: PUUID })!.observations).toHaveLength(241)
    expect(insights.getRviObservations({ puuid: PUUID }, 12)!.observations)
      .toHaveLength(12)
  })

  it("returns selected-recipe Recall Score and 0-100 capability vectors chronologically", () => {
    selectRecipe()
    addLobby(2, 2_000, 222, "BOTTOM")
    addLobby(1, 1_000, 84, "MIDDLE")
    writeReady(2, 84.5, [
      { key: "combat", componentScore: 0.83 },
      { key: "positioning_survival", componentScore: 0 },
      { key: "economy", componentScore: 0.6 },
      { key: "objectives_macro", componentScore: 0.5 },
      { key: "vision_setup", componentScore: 0.4 },
      { key: "control_utility", componentScore: 0.3 },
    ], { primaryArchetype: "marksman" })
    writeReady(1, 42, [{ key: "economy", componentScore: 0.45 }])

    const result = insights.getRviObservations({ puuid: PUUID, modes: ["sr_normal"] })!

    expect(result).toMatchObject({
      algorithmVersion: 3,
      recipeId: RECIPE_ID,
      calibrationId: CALIBRATION_ID,
      familyKeys: RVI_VECTOR_KEYS,
    })
    expect(result.observations.map((row) => row.matchId)).toEqual([1, 2])
    expect(result.observations[0]).toMatchObject({
      recipeId: RECIPE_ID,
      playedAt: 1_000,
      recallScore: 42,
      championId: 84,
      position: "MIDDLE",
      primaryArchetype: "assassin",
      familyPercentiles: { economy: 45, combat: null },
      familyResponsibilityWeights: { economy: 1, combat: null },
    })
    expect(result.observations[1]).toMatchObject({
      recallScore: 84.5,
      championId: 222,
      position: "BOTTOM",
      primaryArchetype: "marksman",
      familyPercentiles: {
        combat: 83,
        positioning_survival: 0,
        economy: 60,
        objectives_macro: 50,
        vision_setup: 40,
        control_utility: 30,
        initiative_pressure: null,
      },
      familyResponsibilityWeights: {
        combat: 1 / 6,
        positioning_survival: 1 / 6,
        economy: 1 / 6,
        objectives_macro: 1 / 6,
        vision_setup: 1 / 6,
        control_utility: 1 / 6,
        initiative_pressure: null,
      },
    })
    expect(insights.getRviObservations({ puuid: PUUID, roles: ["bottom"] })!
      .observations.map((row) => row.matchId)).toEqual([2])

    const gradeHistory = insights.getGradeComponentHistory({ puuid: PUUID })
    expect(gradeHistory.map((row) => row.gameId)).toEqual([1, 2])
    expect(gradeHistory[1]).toMatchObject({
      win: true,
      championId: 222,
      role: "BOTTOM",
      grade: "A",
      gradeScore: 0.5,
      recallScore: 84.5,
      sessionGame: 2,
      compositePercentile: 0.845,
    })
    expect(gradeHistory[1].components.map((component) => component.key)).toEqual([
      "combat",
      "positioning_survival",
      "economy",
      "objectives_macro",
      "vision_setup",
      "control_utility",
    ])
    expect(gradeHistory[1].components[0]).toMatchObject({
      key: "combat",
      label: "Combat",
      percentile: 0.83,
      weight: 1 / 6,
      contribution: 0.83 / 6,
      scope: "role",
    })

    // Analyses read the selected immutable results, not a possibly interrupted
    // denormalized display cache.
    db.prepare("UPDATE matches SET role_fit_score = 1, grade_score = -3 WHERE puuid = ?")
      .run(PUUID)
    const analyticHistory = insights.getObservations({ puuid: PUUID })
    expect(analyticHistory.map((row) => row.recallScore)).toEqual([42, 84.5])
    expect(analyticHistory.map((row) => row.sessionGame)).toEqual([1, 2])
    expect(insights.getFinalItemObservations({ puuid: PUUID })
      .map((row) => row.recallScore)).toEqual([42, 84.5])
    expect(matches.getSummary({ puuid: PUUID })).toMatchObject({
      gradedGames: 2,
      avgGradeScore: 0.5,
      averageRecallScore: 63.25,
    })
    expect(matches.getChampionStats({ puuid: PUUID }).map((row) => ({
      championId: row.championId,
      gradedGames: row.gradedGames,
      averageRecallScore: row.averageRecallScore,
    })).sort((left, right) => left.championId - right.championId)).toEqual([
      { championId: 84, gradedGames: 1, averageRecallScore: 42 },
      { championId: 222, gradedGames: 1, averageRecallScore: 84.5 },
    ])
    expect(matches.getGradeDistribution({ puuid: PUUID })).toEqual([
      { grade: "A", count: 2 },
    ])
  })

  it("keeps exact raw observations while Grade components authoritatively explain arm scores", () => {
    selectRecipe()
    const metricRepository = selectRviRecipe()
    addLobby(1, 1_000, 84, "MIDDLE")
    writeReady(1, 72, [{ key: "combat", componentScore: .25 }])
    const recipeId = rviRecipeIdForCalibration(RECIPE_ID, CALIBRATION_ID)
    const base = {
      gameId: 1,
      puuid: PUUID,
      participantId: 1,
      recipeId,
      calibrationId: CALIBRATION_ID,
      comparisonScope: "position" as const,
      referenceMatchCount: 44,
      derivationId: "rvi-insights-test",
      derivedAt: 10_000,
    }
    metricRepository.replaceMatchObservations({
      gameId: 1,
      puuid: PUUID,
      algorithmVersion: 3,
      recipeId,
      observations: [
        {
          ...base,
          metricKey: "damage_share",
          rawEvidence: { state: "observed", value: .31 },
          scoreEvidence: { state: "observed", value: .88 },
          unit: "ratio",
          numerator: 3_100,
          denominator: 10_000,
          source: "scoreboard",
          sourceQuality: "verified",
        },
        {
          ...base,
          metricKey: "champion_damage_per_min",
          rawEvidence: { state: "observed", value: 515 },
          scoreEvidence: { state: "observed", value: .99 },
          unit: "damage_per_min",
          source: "scoreboard",
          sourceQuality: "verified",
        },
        {
          ...base,
          metricKey: "cs_per_min",
          rawEvidence: { state: "observed", value: 8.2 },
          scoreEvidence: { state: "observed", value: .91 },
          unit: "cs_per_min",
          source: "scoreboard",
          sourceQuality: "verified",
        },
      ],
    })

    const result = insights.getRviObservations({ puuid: PUUID })!
    expect(result.recipeId).toBe(recipeId)
    expect(result.observations[0].familyPercentiles.combat).toBe(25)
    expect(result.observations[0].familyResponsibilityWeights.combat).toBe(1)
    expect(result.observations[0].metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "damage_share",
        label: "Damage share",
        formula: "champion damage / team champion damage",
        tier: "CORE",
        vector: "combat",
        vectorWeight: .3,
        gradeWeight: .5,
        rawEvidence: { state: "observed", value: .31 },
        scoreEvidence: { state: "observed", value: 25, source: "derived" },
        comparisonScope: "position",
        referenceMatchCount: 44,
      }),
      expect.objectContaining({
        key: "champion_damage_per_min",
        tier: "SECONDARY",
        vectorWeight: .15,
        gradeWeight: 0,
        scoreEvidence: { state: "observed", value: 99 },
      }),
      expect.objectContaining({
        key: "cs_per_min",
        tier: "CORE",
        vectorWeight: .2,
        gradeWeight: 0,
        rawEvidence: { state: "observed", value: 8.2 },
      }),
    ]))
  })

  it("exposes Enchanter protection as optional arm evidence and preserves zero versus missing", () => {
    selectRecipe()
    addLobby(1, 1_000, 16, "UTILITY")
    addLobby(2, 2_000, 16, "UTILITY")
    addLobby(3, 3_000, 16, "UTILITY")
    writeReady(1, 70, [{ key: "vision_setup", componentScore: .7 }], {
      primaryArchetype: "enchanter",
      protection: { evidenceState: "observed", percentile: .92 },
    })
    writeReady(2, 60, [{ key: "vision_setup", componentScore: .6 }], {
      primaryArchetype: "enchanter",
      protection: { evidenceState: "observed", percentile: 0 },
    })
    writeReady(3, 50, [{ key: "vision_setup", componentScore: .5 }], {
      primaryArchetype: "enchanter",
      protection: { evidenceState: "unavailable" },
    })

    const result = insights.getRviObservations({ puuid: PUUID })!
    expect(result.familyKeys).toEqual(RVI_VECTOR_KEYS)
    expect(result.observations.map((row) => ({
      archetype: row.primaryArchetype,
      protection: row.metrics?.find((metric) =>
        metric.key === "ally_heal_shield_per_min")?.scoreEvidence,
      tier: row.metrics?.find((metric) =>
        metric.key === "ally_heal_shield_per_min")?.tier,
      influence: row.metrics?.find((metric) =>
        metric.key === "ally_heal_shield_per_min")?.gradeWeight,
      utilityVector: row.familyPercentiles.control_utility,
      responsibility: row.familyResponsibilityWeights.control_utility,
    }))).toEqual([
      {
        archetype: "enchanter",
        protection: { state: "observed", value: 92, source: "derived" },
        tier: "SECONDARY",
        influence: 0,
        utilityVector: null,
        responsibility: null,
      },
      {
        archetype: "enchanter",
        protection: { state: "observed", value: 0, source: "derived" },
        tier: "SECONDARY",
        influence: 0,
        utilityVector: null,
        responsibility: null,
      },
      {
        archetype: "enchanter",
        protection: { state: "unavailable" },
        tier: "SECONDARY",
        influence: 0,
        utilityVector: null,
        responsibility: null,
      },
    ])
  })

  it("takes primary archetype only from a validated current breakdown", () => {
    selectRecipe()
    addLobby(1, 1_000, 154, "JUNGLE")
    addLobby(2, 2_000, 18, "BOTTOM")
    writeReady(1, 70, [{ key: "combat", componentScore: .7 }], {
      primaryArchetype: "marksman",
    })
    writeReady(2, 60, [{ key: "combat", componentScore: .6 }], {
      primaryArchetype: "marksman",
    })

    const stored = db.prepare(`
      SELECT components_json AS componentsJson
      FROM match_grade_breakdown_versions
      WHERE game_id = 2 AND puuid = ? AND participant_id = 1 AND algorithm_version = 3
    `).get(PUUID) as { componentsJson: string }
    const missingArchetype = JSON.parse(stored.componentsJson) as Record<string, unknown>
    delete missingArchetype.primaryArchetype
    db.prepare(`
      UPDATE match_grade_breakdown_versions SET components_json = ?
      WHERE game_id = 2 AND puuid = ? AND participant_id = 1 AND algorithm_version = 3
    `).run(JSON.stringify(missingArchetype), PUUID)

    expect(insights.getRviObservations({ puuid: PUUID })!.observations).toEqual([
      expect.objectContaining({
        matchId: 1,
        championId: 154,
        position: "JUNGLE",
        primaryArchetype: "marksman",
      }),
    ])
  })

  it("rejects malformed, mismatched, legacy, and non-ready grade artifacts", () => {
    selectRecipe()
    for (let gameId = 1; gameId <= 5; gameId += 1) {
      addLobby(gameId, gameId * 1_000, 84 + gameId, "MIDDLE")
    }
    writeReady(1, 71, [{ key: "combat", componentScore: 0.71 }])

    writeReady(2, 72, [{ key: "combat", componentScore: 0.72 }])
    db.prepare(
      `UPDATE match_grade_breakdown_versions SET components_json = ?
       WHERE game_id = 2 AND puuid = ? AND participant_id = 1 AND algorithm_version = 3`,
    ).run(JSON.stringify({
      algorithmVersion: 3,
      recipeId: OTHER_RECIPE_ID,
      recallScore: 72,
      components: [{ key: "combat", componentScore: 0.72 }],
    }), PUUID)

    // Simulate a database copied from an older/partially repaired build. The
    // v25 trigger normally prevents this corruption; the read path still must
    // never trust a recipe merely because its algorithm version is 3.
    db.exec("DROP TRIGGER grade_attempt_selected_recipe_update")
    writeReady(3, 73, [{ key: "combat", componentScore: 0.73 }])
    for (const table of [
      "match_grade_attempts",
      "match_grade_results",
      "match_grade_breakdown_versions",
    ]) {
      db.prepare(`UPDATE ${table} SET recipe_id = ? WHERE game_id = 3 AND puuid = ?`)
        .run(OTHER_RECIPE_ID, PUUID)
    }

    writeReady(4, 74, [{ key: "combat", componentScore: 0.74 }])
    for (const table of [
      "match_grade_attempts",
      "match_grade_results",
      "match_grade_breakdown_versions",
    ]) {
      db.prepare(`UPDATE ${table} SET recipe_id = 'legacy:v3' WHERE game_id = 4 AND puuid = ?`)
        .run(PUUID)
    }

    grades.writeCanonicalGrade(5, PUUID, {
      algorithmVersion: 3,
      recipeId: RECIPE_ID,
      inputFingerprint: INPUT_HASH,
      status: "calibrating",
      evidenceCoverage: 0,
      referenceSampleCount: 0,
      results: new Map(),
    })

    expect(insights.getRviObservations({ puuid: PUUID })!.observations).toEqual([
      expect.objectContaining({ matchId: 1, recallScore: 71 }),
    ])
    expect(insights.getGradeComponentHistory({ puuid: PUUID })).toEqual([
      expect.objectContaining({
        gameId: 1,
        compositePercentile: 0.71,
        components: [expect.objectContaining({ key: "combat", percentile: 0.71 })],
      }),
    ])
  })

  it("returns no observation set without a current non-legacy calibrated recipe", () => {
    expect(insights.getRviObservations({ puuid: PUUID })).toBeUndefined()

    db.prepare(
      `INSERT INTO grade_recipe_selections (algorithm_version, recipe_id, selected_at)
       VALUES (3, 'legacy:v3', 1)`,
    ).run()

    expect(insights.getRviObservations({ puuid: PUUID })).toBeUndefined()
  })
})
