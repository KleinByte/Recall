import {
  canonicalCalibrationIdentity,
  CURRENT_GRADE_RECIPE_DEFINITION_ID,
  DEFAULT_GRADE_RECIPE_ID,
  LEGACY_GRADE_RECIPE_DEFINITION_ID,
  type GradeRecipeIdentityKind,
} from "./match-grade-recipe.js"
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

/** Legacy database partition used by the current RVI recipe. */
export const CANONICAL_RVI_STORAGE_PARTITION = 3 as const

export const CURRENT_RVI_RECIPE_DEFINITION_ID =
  "recall.rvi.definition.dcd9eb30fa637a870a44d3c48dc458149b9892687a476992c3a7dc95be743b1b" as const
export const LEGACY_RVI_RECIPE_DEFINITION_ID =
  "recall.rvi.v3.detail-definition.2026-08-10.r2" as const
const LEGACY_RVI_METRIC_REGISTRY_ID =
  "recall.rvi.v3.metric-registry.2026-08-10.r2" as const
const LEGACY_RVI_TIMELINE_POLICY_ID =
  "recall.rvi.v3.timeline.12s-1200u.2026-08-10.r2" as const
const LEGACY_RVI_VECTOR_POLICY_ID =
  "recall.rvi.v3.seven-match-arms.profile-range.2026-08-10.r2" as const
export const CURRENT_RVI_METRIC_REGISTRY_ID =
  "recall.rvi.metric-registry.dfd1db11fa32b401ad54b2dc565620b71b3ed6b45520db7d955ab318fcb20088" as const
export const CURRENT_RVI_TIMELINE_POLICY_ID =
  "recall.rvi.timeline-policy.c9fae4966da7e965e076d6e4cb6a1a1d05a01a4141d9cab1a871ed8ab1d4a245" as const
export const CURRENT_RVI_VECTOR_POLICY_ID =
  "recall.rvi.vector-policy.77dcf16b09b2ade5469bfc058da241a3c6e2f1a28ec7f35ab9ea5acb3f613c72" as const

export type RviRecipeIdentityKind = GradeRecipeIdentityKind

export interface RviRecipeIdentityCandidate {
  algorithmVersion: number
  recipeId: string
  gradeRecipeId: string
  calibrationId: string
  definition: unknown
}

const stableContractValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableContractValue)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableContractValue(entry)]))
  }
  return value
}

const sameContractValue = (left: unknown, right: unknown) =>
  JSON.stringify(stableContractValue(left)) === JSON.stringify(stableContractValue(right))

const LEGACY_DEFAULT_GRADE_RECIPE_ID =
  `${LEGACY_GRADE_RECIPE_DEFINITION_ID}@calibration:compatibility-lobby-rank-r1`

/**
 * Recipe names used to participate in the deterministic bootstrap seed. Map
 * the canonical identity back to that frozen seed namespace so this naming
 * cleanup cannot alter confidence intervals for an existing match sample.
 */
export function stableRviBootstrapSeedIdentity(recipeId: string): string {
  if (recipeId === DEFAULT_GRADE_RECIPE_ID) return LEGACY_DEFAULT_GRADE_RECIPE_ID
  return recipeId
    .replace(
      CURRENT_RVI_RECIPE_DEFINITION_ID,
      LEGACY_RVI_RECIPE_DEFINITION_ID,
    )
    .replace(
      CURRENT_GRADE_RECIPE_DEFINITION_ID,
      LEGACY_GRADE_RECIPE_DEFINITION_ID,
    )
    .replaceAll("recall.grade.calibration.", "recall.grade.v3.calibration.")
}

function rviRecipeIdForDefinition(
  definitionId: string,
  gradeRecipeId: string,
  calibrationId: string,
) {
  const grade = nonemptyIdentity(gradeRecipeId, "gradeRecipeId")
  const calibration = nonemptyIdentity(calibrationId, "calibrationId")
  return `${definitionId}@grade:${grade}@calibration:${calibration}`
}

export function rviRecipeIdForIdentity(
  gradeRecipeId: string,
  calibrationId: string,
  identity: RviRecipeIdentityKind,
): string {
  return rviRecipeIdForDefinition(
    identity === "canonical"
      ? CURRENT_RVI_RECIPE_DEFINITION_ID
      : LEGACY_RVI_RECIPE_DEFINITION_ID,
    gradeRecipeId,
    identity === "canonical" ? canonicalCalibrationIdentity(calibrationId) : calibrationId,
  )
}

export function rviRecipeIdentityKind(
  recipe: RviRecipeIdentityCandidate | undefined,
  gradeRecipeId: string,
  calibrationId: string,
  gradeIdentity: GradeRecipeIdentityKind,
): RviRecipeIdentityKind | undefined {
  if (!recipe || recipe.algorithmVersion !== CANONICAL_RVI_STORAGE_PARTITION ||
      recipe.gradeRecipeId !== gradeRecipeId || recipe.calibrationId !== calibrationId ||
      !recipe.definition || typeof recipe.definition !== "object" ||
      Array.isArray(recipe.definition)) return undefined
  const expectedDefinition = gradeIdentity === "canonical"
    ? CURRENT_RVI_RECIPE_DEFINITION_ID
    : LEGACY_RVI_RECIPE_DEFINITION_ID
  const definition = recipe.definition as Record<string, unknown>
  const expected = rviRecipeDefinitionForIdentity(
    gradeRecipeId,
    calibrationId,
    gradeIdentity,
  )
  return definition.recipeDefinitionId === expectedDefinition &&
      sameContractValue(Object.keys(definition).sort(), Object.keys(expected).sort()) &&
      Object.entries(expected).every(([key, value]) =>
        sameContractValue(definition[key], value),
      ) &&
      recipe.recipeId === rviRecipeIdForIdentity(
        gradeRecipeId,
        calibrationId,
        gradeIdentity,
      )
    ? gradeIdentity
    : undefined
}

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
  return rviRecipeIdForIdentity(gradeRecipeId, calibrationId, "canonical")
}

export function rviRecipeDefinition(
  gradeRecipeId: string,
  calibrationId: string,
) {
  return rviRecipeDefinitionForIdentity(gradeRecipeId, calibrationId, "canonical")
}

/** Exact persisted contract for a supported canonical or storage-alias identity. */
export function rviRecipeDefinitionForIdentity(
  gradeRecipeId: string,
  calibrationId: string,
  identity: RviRecipeIdentityKind,
) {
  const grade = nonemptyIdentity(gradeRecipeId, "gradeRecipeId")
  const calibration = nonemptyIdentity(calibrationId, "calibrationId")
  return Object.freeze({
    algorithmVersion: CANONICAL_RVI_STORAGE_PARTITION,
    recipeDefinitionId: identity === "canonical"
      ? CURRENT_RVI_RECIPE_DEFINITION_ID
      : LEGACY_RVI_RECIPE_DEFINITION_ID,
    recipeId: rviRecipeIdForIdentity(grade, calibration, identity),
    gradeRecipeId: grade,
    calibrationId: calibration,
    identities: Object.freeze({
      metricRegistry: identity === "canonical"
        ? CURRENT_RVI_METRIC_REGISTRY_ID
        : LEGACY_RVI_METRIC_REGISTRY_ID,
      vectorPolicy: identity === "canonical"
        ? CURRENT_RVI_VECTOR_POLICY_ID
        : LEGACY_RVI_VECTOR_POLICY_ID,
      timelinePolicy: identity === "canonical"
        ? CURRENT_RVI_TIMELINE_POLICY_ID
        : LEGACY_RVI_TIMELINE_POLICY_ID,
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

const DEFAULT_CALIBRATION_ID = "default-lobby-rank"

/** Default definition for pure callers; persisted builds use the selected frozen id. */
export const DEFAULT_RVI_RECIPE = rviRecipeDefinition(
  DEFAULT_GRADE_RECIPE_ID,
  DEFAULT_CALIBRATION_ID,
)
export const DEFAULT_RVI_RECIPE_ID = DEFAULT_RVI_RECIPE.recipeId
