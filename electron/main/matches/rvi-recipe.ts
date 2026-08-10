import { MATCH_GRADE_RECIPE_ID } from "./match-grade-recipe.js"
import {
  CAREER_RVI_ARM_KEYS,
  PERFORMANCE_ARM_COPY,
} from "../../../src/shared/performance-vocabulary.js"
import {
  METRIC_DEFINITIONS,
  RVI_CAPABILITY_VECTORS,
  RVI_METRIC_POLICIES,
  type RviCapabilityVector,
} from "./match-metric-registry.js"

export const RVI_ALGORITHM_VERSION = 3 as const
export const RVI_RECIPE_DEFINITION_ID =
  "recall.rvi.v3.detail-definition.2026-08-10.r2" as const
export const RVI_METRIC_REGISTRY_VERSION =
  "recall.rvi.v3.metric-registry.2026-08-10.r2" as const
export const RVI_TIMELINE_POLICY_VERSION =
  "recall.rvi.v3.timeline.12s-1200u.2026-08-10.r2" as const
export const RVI_VECTOR_POLICY_VERSION =
  "recall.rvi.v3.seven-match-arms.profile-range.2026-08-10.r2" as const

export interface RviVectorDefinition {
  key: RviCapabilityVector
  label: string
  shortLabel: string
  description: string
  diagnosticOnly: boolean
  profileOnly?: boolean
}

export const RVI_VECTOR_DEFINITIONS: readonly RviVectorDefinition[] = Object.freeze(
  CAREER_RVI_ARM_KEYS.map((key) => Object.freeze({
    key,
    label: PERFORMANCE_ARM_COPY[key].label,
    shortLabel: PERFORMANCE_ARM_COPY[key].label,
    description: PERFORMANCE_ARM_COPY[key].description,
    diagnosticOnly: false,
    ...(key === "consistency_versatility" ? { profileOnly: true } : {}),
  })),
)

if (RVI_VECTOR_DEFINITIONS.map((entry) => entry.key).join("|") !==
    RVI_CAPABILITY_VECTORS.join("|")) {
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
  return `${RVI_RECIPE_DEFINITION_ID}@grade:${grade}@calibration:${calibration}`
}

export function rviRecipeDefinition(
  gradeRecipeId: string,
  calibrationId: string,
) {
  const grade = nonemptyIdentity(gradeRecipeId, "gradeRecipeId")
  const calibration = nonemptyIdentity(calibrationId, "calibrationId")
  return Object.freeze({
    algorithmVersion: RVI_ALGORITHM_VERSION,
    recipeDefinitionId: RVI_RECIPE_DEFINITION_ID,
    recipeId: rviRecipeIdForCalibration(grade, calibration),
    gradeRecipeId: grade,
    calibrationId: calibration,
    identities: Object.freeze({
      metricRegistry: RVI_METRIC_REGISTRY_VERSION,
      vectorPolicy: RVI_VECTOR_POLICY_VERSION,
      timelinePolicy: RVI_TIMELINE_POLICY_VERSION,
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
    vectors: RVI_VECTOR_DEFINITIONS,
    metricPolicies: RVI_METRIC_POLICIES,
    metricDefinitions: Object.freeze(METRIC_DEFINITIONS.map((entry) => Object.freeze({
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
export const RVI_RECIPE = rviRecipeDefinition(
  MATCH_GRADE_RECIPE_ID,
  COMPATIBILITY_CALIBRATION_ID,
)
export const RVI_RECIPE_ID = RVI_RECIPE.recipeId
