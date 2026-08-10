import { GRADE_V3_RECIPE_ID } from "./grade-v3-recipe.js"
import {
  METRIC_DEFINITIONS_V3,
  RVI_CAPABILITY_VECTORS_V3,
  RVI_V3_METRIC_POLICIES,
  type RviCapabilityVectorV3,
} from "./metric-registry-v3.js"

export const RVI_V3_ALGORITHM_VERSION = 3 as const
export const RVI_V3_RECIPE_DEFINITION_ID =
  "recall.rvi.v3.detail-definition.2026-08-10.r2" as const
export const RVI_V3_METRIC_REGISTRY_VERSION =
  "recall.rvi.v3.metric-registry.2026-08-10.r2" as const
export const RVI_V3_TIMELINE_POLICY_VERSION =
  "recall.rvi.v3.timeline.12s-1200u.2026-08-10.r2" as const
export const RVI_V3_VECTOR_POLICY_VERSION =
  "recall.rvi.v3.seven-match-arms.profile-range.2026-08-10.r2" as const

export interface RviVectorDefinitionV3 {
  key: RviCapabilityVectorV3
  label: string
  shortLabel: string
  description: string
  diagnosticOnly: boolean
  profileOnly?: boolean
}

export const RVI_V3_VECTOR_DEFINITIONS: readonly RviVectorDefinitionV3[] = Object.freeze([
  Object.freeze({ key: "combat", label: "Combat", shortLabel: "Combat", description: "Damage pressure, takedown contribution, and recorded fight outcomes.", diagnosticOnly: false }),
  Object.freeze({ key: "positioning_survival", label: "Positioning & Survival", shortLabel: "Survival", description: "Availability and the context of recorded deaths.", diagnosticOnly: false }),
  Object.freeze({ key: "control_utility", label: "Control & Utility", shortLabel: "Utility", description: "Crowd control, ally protection, and literal pressure absorbed.", diagnosticOnly: false }),
  Object.freeze({ key: "economy", label: "Economy", shortLabel: "Economy", description: "Resource pace, share, and opposing-role phase deltas.", diagnosticOnly: false }),
  Object.freeze({ key: "objectives_macro", label: "Objectives & Macro", shortLabel: "Macro", description: "Objective, structure, and map conversion evidence.", diagnosticOnly: false }),
  Object.freeze({ key: "vision_setup", label: "Vision & Setup", shortLabel: "Vision", description: "Vision pace, denial, and spatial objective setup.", diagnosticOnly: false }),
  Object.freeze({ key: "initiative_pressure", label: "Initiative & Pressure", shortLabel: "Initiative", description: "Early movement and pressure from retained event evidence.", diagnosticOnly: false }),
  Object.freeze({ key: "consistency_versatility", label: "Consistency & Versatility", shortLabel: "Range", description: "Career-only performance floor, repeatability, and demonstrated breadth.", diagnosticOnly: false, profileOnly: true }),
])

if (RVI_V3_VECTOR_DEFINITIONS.map((entry) => entry.key).join("|") !==
    RVI_CAPABILITY_VECTORS_V3.join("|")) {
  throw new Error("rvi_vector_definition_order_mismatch")
}

function nonemptyIdentity(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${name} must be a non-empty immutable identifier`)
  return normalized
}

export function rviRecipeIdForCalibration(
  gradeRecipeId: string,
  calibrationId: string,
): string {
  const grade = nonemptyIdentity(gradeRecipeId, "gradeRecipeId")
  const calibration = nonemptyIdentity(calibrationId, "calibrationId")
  return `${RVI_V3_RECIPE_DEFINITION_ID}@grade:${grade}@calibration:${calibration}`
}

export function rviRecipeDefinitionV3(
  gradeRecipeId: string,
  calibrationId: string,
) {
  const grade = nonemptyIdentity(gradeRecipeId, "gradeRecipeId")
  const calibration = nonemptyIdentity(calibrationId, "calibrationId")
  return Object.freeze({
    algorithmVersion: RVI_V3_ALGORITHM_VERSION,
    recipeDefinitionId: RVI_V3_RECIPE_DEFINITION_ID,
    recipeId: rviRecipeIdForCalibration(grade, calibration),
    gradeRecipeId: grade,
    calibrationId: calibration,
    identities: Object.freeze({
      metricRegistry: RVI_V3_METRIC_REGISTRY_VERSION,
      vectorPolicy: RVI_V3_VECTOR_POLICY_VERSION,
      timelinePolicy: RVI_V3_TIMELINE_POLICY_VERSION,
    }),
    aggregation: Object.freeze({
      matchVectorMethod: "fixed_denominator_core_bundle_neutral_imputation" as const,
      longitudinalMethod: "weighted_mean_no_score_shrinkage" as const,
      matchHeadlineSource: "stored_exact_recipe_role_fit" as const,
      careerHeadlineMethod: "equal_mean_of_available_career_arms" as const,
      missingCoreEvidence: "withhold_vector" as const,
      missingSecondaryEvidence:
        "retain_missing_state_and_impute_observed_core_bundle_for_arithmetic" as const,
      missingOptionalOnlyArm:
        "retain_unavailable_and_neutralize_against_resolved_composite" as const,
      optionalDetailEvidence: "score_when_observed_without_blocking_core" as const,
      armMetricWeightsIndependentOfGradeResponsibility: true as const,
      profileOnlyRangeMinimumGames: 20 as const,
    }),
    vectors: RVI_V3_VECTOR_DEFINITIONS,
    metricPolicies: RVI_V3_METRIC_POLICIES,
    metricDefinitions: Object.freeze(METRIC_DEFINITIONS_V3.map((entry) => Object.freeze({
      key: entry.key,
      label: entry.label,
      description: entry.description,
      formula: entry.formula,
      unit: entry.unit,
      direction: entry.direction,
      source: entry.source,
    }))),
  })
}

const COMPATIBILITY_CALIBRATION_ID = "compatibility-lobby-rank-r1"

/** Compatibility definition for pure callers; persisted builds use the selected frozen id. */
export const RVI_V3_RECIPE = rviRecipeDefinitionV3(
  GRADE_V3_RECIPE_ID,
  COMPATIBILITY_CALIBRATION_ID,
)
export const RVI_V3_RECIPE_ID = RVI_V3_RECIPE.recipeId
