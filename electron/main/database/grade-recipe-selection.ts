import type { Database } from "better-sqlite3"
import {
  CANONICAL_GRADE_STORAGE_PARTITION,
  canonicalCalibrationIdentity,
  gradeRecipeIdentityKind,
  recipeIdForCalibration,
  type GradeRecipeIdentityKind,
} from "../matches/match-grade-recipe.js"
import {
  CANONICAL_RVI_STORAGE_PARTITION,
  rviRecipeIdForCalibration,
  rviRecipeIdentityKind,
  type RviRecipeIdentityKind,
} from "../matches/rvi-recipe.js"

export interface CompatibleGradeRecipeSelection {
  algorithmVersion: typeof CANONICAL_GRADE_STORAGE_PARTITION
  recipeId: string
  calibrationId: string
  /** Canonical renderer identity; storage may retain an exact historical alias. */
  publicRecipeId: string
  publicCalibrationId: string
  recipeHash: string
  definition: Record<string, unknown>
  identity: GradeRecipeIdentityKind
}

export interface CompatibleRviRecipeSelection {
  algorithmVersion: typeof CANONICAL_RVI_STORAGE_PARTITION
  recipeId: string
  gradeRecipeId: string
  calibrationId: string
  /** Canonical renderer identity; storage may retain an exact historical alias. */
  publicRecipeId: string
  publicCalibrationId: string
  recipeHash: string
  definition: Record<string, unknown>
  identity: RviRecipeIdentityKind
}

const parseDefinition = (value: string): Record<string, unknown> | undefined => {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Single compatibility boundary for every Grade reader. The legacy identity
 * is accepted only as an exact alias of the currently bundled arithmetic and
 * retains its original frozen calibration; arbitrary partition-3 rows are not.
 */
export function getCompatibleGradeRecipeSelection(
  db: Database,
): CompatibleGradeRecipeSelection | undefined {
  const row = db.prepare(`
    SELECT recipe.recipe_id AS recipeId,
           recipe.algorithm_version AS algorithmVersion,
           recipe.recipe_hash AS recipeHash,
           recipe.calibration_id AS calibrationId,
           recipe.definition_json AS definitionJson,
           calibration.calibration_hash AS calibrationHash,
           calibration.reference_population_json AS referencePopulationJson
    FROM grade_recipe_selections selection
    JOIN grade_recipes recipe
      ON recipe.algorithm_version = selection.algorithm_version
     AND recipe.recipe_id = selection.recipe_id
    JOIN grade_calibration_snapshots calibration
      ON calibration.calibration_id = recipe.calibration_id
    WHERE selection.algorithm_version = ?
  `).get(CANONICAL_GRADE_STORAGE_PARTITION) as {
    recipeId: string
    algorithmVersion: number
    recipeHash: string
    calibrationId: string
    definitionJson: string
    calibrationHash: string
    referencePopulationJson: string
  } | undefined
  if (!row) return undefined
  const definition = parseDefinition(row.definitionJson)
  if (!definition) return undefined
  if (definition.calibrationId !== row.calibrationId ||
      definition.calibrationHash !== row.calibrationHash ||
      JSON.stringify(definition.referencePopulation) !== row.referencePopulationJson) {
    return undefined
  }
  const identity = gradeRecipeIdentityKind({
    algorithmVersion: row.algorithmVersion,
    recipeId: row.recipeId,
    calibrationId: row.calibrationId,
    definition,
  })
  if (!identity) return undefined
  return {
    algorithmVersion: CANONICAL_GRADE_STORAGE_PARTITION,
    recipeId: row.recipeId,
    calibrationId: row.calibrationId,
    publicRecipeId: recipeIdForCalibration(row.calibrationId),
    publicCalibrationId: canonicalCalibrationIdentity(row.calibrationId),
    recipeHash: row.recipeHash,
    definition,
    identity,
  }
}

/** Linked RVI selection using the same exact Grade identity alias. */
export function getCompatibleRviRecipeSelection(
  db: Database,
  grade?: CompatibleGradeRecipeSelection,
): CompatibleRviRecipeSelection | undefined {
  const selectedGrade = grade ?? getCompatibleGradeRecipeSelection(db)
  if (!selectedGrade) return undefined
  const row = db.prepare(`
    SELECT recipe.recipe_id AS recipeId,
           recipe.algorithm_version AS algorithmVersion,
           recipe.recipe_hash AS recipeHash,
           recipe.grade_recipe_id AS gradeRecipeId,
           recipe.calibration_id AS calibrationId,
           recipe.definition_json AS definitionJson
    FROM rvi_recipe_selections selection
    JOIN rvi_recipes recipe
      ON recipe.algorithm_version = selection.algorithm_version
     AND recipe.recipe_id = selection.recipe_id
    WHERE selection.algorithm_version = ?
  `).get(CANONICAL_RVI_STORAGE_PARTITION) as {
    recipeId: string
    algorithmVersion: number
    recipeHash: string
    gradeRecipeId: string
    calibrationId: string
    definitionJson: string
  } | undefined
  if (!row) return undefined
  const definition = parseDefinition(row.definitionJson)
  if (!definition) return undefined
  const identity = rviRecipeIdentityKind(
    { ...row, definition },
    selectedGrade.recipeId,
    selectedGrade.calibrationId,
    selectedGrade.identity,
  )
  if (!identity) return undefined
  return {
    algorithmVersion: CANONICAL_RVI_STORAGE_PARTITION,
    recipeId: row.recipeId,
    gradeRecipeId: row.gradeRecipeId,
    calibrationId: row.calibrationId,
    publicRecipeId: rviRecipeIdForCalibration(
      selectedGrade.publicRecipeId,
      row.calibrationId,
    ),
    publicCalibrationId: canonicalCalibrationIdentity(row.calibrationId),
    recipeHash: row.recipeHash,
    definition,
    identity,
  }
}
