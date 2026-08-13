import { createHash } from "node:crypto"
import Database from "better-sqlite3-node"
import { describe, expect, it } from "vitest"
import {
  GradePersistenceRepository,
} from "../electron/main/database/grade-persistence-repo.js"
import {
  getCompatibleGradeRecipeSelection,
  getCompatibleRviRecipeSelection,
} from "../electron/main/database/grade-recipe-selection.js"
import { canonicalJson } from "../electron/main/database/match-source-repo.js"
import { MetricObservationsRepository } from
  "../electron/main/database/metric-observations-repo.js"
import { applyMigrations } from "../electron/main/database/migrations.js"
import {
  buildGradeCalibrationSnapshot,
  prepareGradeLobbyFromSnapshot,
} from "../electron/main/matches/match-grade-observations.js"
import {
  gradeRecipeContractForIdentity,
  recipeIdForIdentity,
} from "../electron/main/matches/match-grade-recipe.js"
import { scoreMatchLobby } from "../electron/main/matches/match-grade.js"
import { MatchGradingService } from
  "../electron/main/matches/match-grading-service.js"
import {
  rviRecipeDefinitionForIdentity,
} from "../electron/main/matches/rvi-recipe.js"
import {
  characterizationReferenceLobbies,
  characterizationSubjectLobby,
} from "./fixtures/grade-rvi-characterization.js"

const sha256 = (value: unknown) => createHash("sha256")
  .update(canonicalJson(value))
  .digest("hex")

describe("Grade/RVI identity upgrade compatibility", () => {
  it("keeps a legacy frozen epoch and post-freeze outputs byte-exact", () => {
    const db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    applyMigrations(db)
    const grades = new GradePersistenceRepository(db, () => 1_800_000_000_000)
    const metrics = new MetricObservationsRepository(db, () => 1_800_000_000_000)
    const referenceLobbies = characterizationReferenceLobbies()
    const snapshot = buildGradeCalibrationSnapshot(referenceLobbies)
    const calibrationHash = sha256(snapshot)
    // This FK is intentionally opaque historical storage. New identities do
    // not copy it or recompute its frozen cohort.
    const calibrationId = `recall.grade.v3.calibration.${calibrationHash}`
    const gradeRecipeId = recipeIdForIdentity(
      calibrationId,
      "legacy_identity_alias",
    )
    const gradeDefinition = {
      ...gradeRecipeContractForIdentity("legacy_identity_alias"),
      calibrationId,
      calibrationHash,
      referencePopulation: snapshot.referencePopulation,
    }
    const rviDefinition = rviRecipeDefinitionForIdentity(
      gradeRecipeId,
      calibrationId,
      "legacy_identity_alias",
    )

    grades.registerCalibration({
      calibrationId,
      calibrationHash,
      referencePopulation: snapshot.referencePopulation,
      sampleCount: snapshot.clusterIds.length,
      snapshot,
      createdAt: 1_700_000_800_000,
    })
    grades.registerRecipe({
      recipeId: gradeRecipeId,
      algorithmVersion: 3,
      recipeHash: sha256(gradeDefinition),
      calibrationId,
      definition: gradeDefinition,
      createdAt: 1_700_000_800_000,
    })
    metrics.registerRecipe({
      recipeId: rviDefinition.recipeId,
      algorithmVersion: 3,
      recipeHash: sha256(rviDefinition),
      gradeRecipeId,
      calibrationId,
      definition: rviDefinition,
      createdAt: 1_700_000_800_000,
    })
    grades.selectRecipe(gradeRecipeId)
    metrics.selectRecipe(rviDefinition.recipeId)

    const subject = characterizationSubjectLobby()
    expect(subject.playedAt).toBeGreaterThan(
      Math.max(...referenceLobbies.map((lobby) => lobby.playedAt ?? 0)),
    )
    const scorePostFreeze = () => scoreMatchLobby({
      players: prepareGradeLobbyFromSnapshot(subject, snapshot).players,
      context: subject.context,
      calibrationSnapshotId: calibrationId,
      recipeIdentity: "legacy_identity_alias",
    })
    const serializeOutcome = (outcome: ReturnType<typeof scoreMatchLobby>) =>
      canonicalJson({ ...outcome, results: [...outcome.results] })
    const beforeOutcome = scorePostFreeze()
    const beforeStorage = canonicalJson({
      calibration: db.prepare(`
        SELECT * FROM grade_calibration_snapshots WHERE calibration_id = ?
      `).get(calibrationId),
      gradeSelection: db.prepare(`
        SELECT * FROM grade_recipe_selections WHERE algorithm_version = 3
      `).get(),
      rviSelection: db.prepare(`
        SELECT * FROM rvi_recipe_selections WHERE algorithm_version = 3
      `).get(),
    })

    const service = new MatchGradingService(db, () => 1_800_000_100_000)
    expect(getCompatibleGradeRecipeSelection(db)).toMatchObject({
      recipeId: gradeRecipeId,
      calibrationId,
      identity: "legacy_identity_alias",
    })
    expect(getCompatibleRviRecipeSelection(db)).toMatchObject({
      recipeId: rviDefinition.recipeId,
      gradeRecipeId,
      calibrationId,
      identity: "legacy_identity_alias",
    })
    expect(service.referenceStatus()).toMatchObject({
      state: "frozen",
      recipeId: getCompatibleGradeRecipeSelection(db)?.publicRecipeId,
      calibrationId: getCompatibleGradeRecipeSelection(db)?.publicCalibrationId,
      referenceMatches: 12,
    })
    expect(service.referenceStatus().recipeId).not.toContain(".v3")
    expect(service.referenceStatus().calibrationId).not.toContain(".v3")
    expect(service.needsDirectCutover()).toBe(false)
    service.ensureFrozenReference({ path: "unused", sha256: "f".repeat(64) })

    const afterOutcome = scorePostFreeze()
    const afterStorage = canonicalJson({
      calibration: db.prepare(`
        SELECT * FROM grade_calibration_snapshots WHERE calibration_id = ?
      `).get(calibrationId),
      gradeSelection: db.prepare(`
        SELECT * FROM grade_recipe_selections WHERE algorithm_version = 3
      `).get(),
      rviSelection: db.prepare(`
        SELECT * FROM rvi_recipe_selections WHERE algorithm_version = 3
      `).get(),
    })

    expect(afterStorage).toBe(beforeStorage)
    expect(serializeOutcome(afterOutcome)).toBe(serializeOutcome(beforeOutcome))
    expect(afterOutcome).toMatchObject({
      status: "ready",
      recipeId: gradeRecipeId,
      recipeDefinitionId: "recall.grade.v3.radar-arms.2026-08-10.r2",
    })
    expect(afterOutcome.results.get(1)).toMatchObject({
      grade: "S+",
      recallScore: 99,
      gradeScore: 2.326347874388028,
      breakdown: {
        evidencePolicyVersion: "recall.grade.v3.evidence.2026-08-10.r2",
      },
    })
    db.close()
  })
})
