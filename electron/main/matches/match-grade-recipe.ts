import {
  MATCH_RVI_ARM_KEYS,
  PERFORMANCE_ARM_LABELS,
  type MatchRviArmKey,
} from "../../../src/shared/performance-vocabulary.js"
import type { RecallGrade } from "../../../src/shared/recall-grade.js"
import { GRADE_CORE_FACT_CONTRACT_VERSION } from "./grade-core-facts.js"
import { POSITION_RESOLVER_VERSION } from "./position.js"

/**
 * Legacy database partition used by the current Grade recipe. Recipe identity,
 * rather than this schema key, determines whether a derived artifact is current.
 */
export const CANONICAL_GRADE_STORAGE_PARTITION = 3 as const

/**
 * Product releases and scoring recipes deliberately have separate identities.
 * Never reuse this value after changing a weight, threshold, taxonomy, or
 * calibration rule: stored match Grade artifacts use it as their recipe key.
 */
export const CURRENT_GRADE_RECIPE_DEFINITION_ID =
  "recall.grade.definition.2fdb9b4846e7ce0eeda3e425f0dc021a43f9f475776f01e7f0f58bd1857f8ec3" as const

/**
 * Exact identity emitted by the immediately preceding release. Existing
 * installations may keep this immutable recipe selected: it describes the
 * same arithmetic and, more importantly, points at their original frozen
 * calibration. This is a storage alias, never a new-recipe default.
 */
export const LEGACY_GRADE_RECIPE_DEFINITION_ID =
  "recall.grade.v3.radar-arms.2026-08-10.r2" as const

/**
 * Immutable identity of the missing/zero/no-opportunity semantics consumed by
 * match Grade. Allocate a new identity whenever those semantics change.
 */
export const CURRENT_GRADE_EVIDENCE_POLICY_ID =
  "recall.grade.evidence-policy.74c7d442902b1b59fb31522517a10948889d123f1626173ee51d9a4111911f72" as const
export const LEGACY_GRADE_EVIDENCE_POLICY_ID =
  "recall.grade.v3.evidence.2026-08-10.r2" as const
export const CURRENT_GRADE_CLUSTER_POLICY_ID =
  "canonical_platform_game_id.r1" as const

export type GradeRecipeIdentityKind = "canonical" | "legacy_identity_alias"

export const gradeRecipeDefinitionId = (identity: GradeRecipeIdentityKind) =>
  identity === "canonical"
    ? CURRENT_GRADE_RECIPE_DEFINITION_ID
    : LEGACY_GRADE_RECIPE_DEFINITION_ID

export const gradeEvidencePolicyId = (identity: GradeRecipeIdentityKind) =>
  identity === "canonical"
    ? CURRENT_GRADE_EVIDENCE_POLICY_ID
    : LEGACY_GRADE_EVIDENCE_POLICY_ID

export interface GradeRecipeIdentityCandidate {
  algorithmVersion: number
  recipeId: string
  calibrationId: string | null
  definition: unknown
}

const definitionIdentity = (definition: unknown): string | undefined =>
  definition && typeof definition === "object" && !Array.isArray(definition)
    ? (definition as Record<string, unknown>).recipeDefinitionId as string | undefined
    : undefined

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

function definitionMatchesIdentity(
  definition: Record<string, unknown>,
  identity: GradeRecipeIdentityKind,
): boolean {
  const expected = gradeRecipeContractForIdentity(identity)
  const expectedKeys = [
    ...Object.keys(expected),
    "calibrationHash",
    "calibrationId",
    "referencePopulation",
  ].sort()
  return sameContractValue(Object.keys(definition).sort(), expectedKeys) &&
    Object.entries(expected).every(([key, value]) =>
    sameContractValue(definition[key], value),
    )
}

/** Classifies only the two exact recipe identities supported by this build. */
export function gradeRecipeIdentityKind(
  recipe: GradeRecipeIdentityCandidate | undefined,
): GradeRecipeIdentityKind | undefined {
  if (!recipe?.calibrationId ||
      recipe.algorithmVersion !== CANONICAL_GRADE_STORAGE_PARTITION) return undefined
  const definitionId = definitionIdentity(recipe.definition)
  const definition = recipe.definition as Record<string, unknown>
  if (definitionId === CURRENT_GRADE_RECIPE_DEFINITION_ID &&
      recipe.recipeId === recipeIdForCalibration(recipe.calibrationId) &&
      definitionMatchesIdentity(definition, "canonical")) return "canonical"
  if (definitionId === LEGACY_GRADE_RECIPE_DEFINITION_ID &&
      recipe.calibrationId.startsWith("recall.grade.v3.calibration.") &&
      recipe.recipeId === recipeIdForDefinition(
        LEGACY_GRADE_RECIPE_DEFINITION_ID,
        recipe.calibrationId,
      ) && definitionMatchesIdentity(definition, "legacy_identity_alias")) {
    return "legacy_identity_alias"
  }
  return undefined
}

/**
 * A persisted recipe id includes the immutable calibration snapshot identity.
 * The snapshot id should be a content hash (or another immutable id) supplied
 * by the calibration store, not a mutable label such as "current".
 */
function recipeIdForDefinition(
  definitionId: string,
  calibrationSnapshotId: string,
): string {
  const snapshot = calibrationSnapshotId.trim()
  if (!snapshot || !/^[A-Za-z0-9._:-]+$/.test(snapshot)) {
    throw new TypeError("calibrationSnapshotId must be a non-empty immutable identifier")
  }
  return `${definitionId}@calibration:${snapshot}`
}

/** Keeps an old snapshot FK opaque while removing its retired label from new ids. */
export function canonicalCalibrationIdentity(calibrationSnapshotId: string): string {
  return calibrationSnapshotId.replace(
    /^recall\.grade\.v3\.calibration\./,
    "recall.grade.calibration.",
  )
}

export function recipeIdForCalibration(calibrationSnapshotId: string): string {
  return recipeIdForDefinition(
    CURRENT_GRADE_RECIPE_DEFINITION_ID,
    canonicalCalibrationIdentity(calibrationSnapshotId),
  )
}

export function recipeIdForIdentity(
  calibrationSnapshotId: string,
  identity: GradeRecipeIdentityKind,
): string {
  return recipeIdForDefinition(
    gradeRecipeDefinitionId(identity),
    identity === "canonical"
      ? canonicalCalibrationIdentity(calibrationSnapshotId)
      : calibrationSnapshotId,
  )
}

/** Default identity for pure callers; persisted builds use the selected frozen snapshot. */
export const DEFAULT_GRADE_RECIPE_ID = recipeIdForCalibration("default-lobby-rank")

export const CURRENT_GRADE_TAXONOMY_ID = "recall.archetypes.2026-08-10.r3" as const

export const MATCH_GRADE_ARM_KEYS = MATCH_RVI_ARM_KEYS
export type MatchGradeArmKey = MatchRviArmKey
export const MATCH_GRADE_ARM_LABELS: Readonly<Record<MatchGradeArmKey, string>> =
  PERFORMANCE_ARM_LABELS

export const MATCH_GRADE_METRIC_KEYS = [
  "damage_share",
  "kill_participation",
  "deaths_per_10",
  "gold_per_min",
  "cs_per_min",
  "neutral_objective_damage_per_min",
  "structure_damage_per_min",
  "vision_score_per_min",
  "cc_seconds_per_min",
  "ally_heal_shield_per_min",
] as const

export type MatchGradeMetricKey = typeof MATCH_GRADE_METRIC_KEYS[number]

export const MATCH_GRADE_METRIC_DIRECTIONS: Readonly<
  Record<MatchGradeMetricKey, "higher" | "lower">
> = Object.freeze({
  damage_share: "higher",
  kill_participation: "higher",
  deaths_per_10: "lower",
  gold_per_min: "higher",
  cs_per_min: "higher",
  neutral_objective_damage_per_min: "higher",
  structure_damage_per_min: "higher",
  vision_score_per_min: "higher",
  cc_seconds_per_min: "higher",
  ally_heal_shield_per_min: "higher",
})

/** Detail-only diagnostics are owned by the linked RVI recipe. */
export const MATCH_GRADE_DIAGNOSTIC_METRIC_KEYS: readonly MatchGradeMetricKey[] = Object.freeze([])

export const RESPONSIBILITY_TIERS = {
  DIAGNOSTIC: 0,
  SECONDARY: 1,
  CORE: 2,
} as const

export type ResponsibilityTierName = keyof typeof RESPONSIBILITY_TIERS
export type ResponsibilityTier = typeof RESPONSIBILITY_TIERS[ResponsibilityTierName]

export interface MatchGradeMetricRecipe {
  key: string
  weight: number
  direction: "higher" | "lower"
}

const FAMILY_METRICS: Readonly<Record<MatchGradeArmKey, readonly MatchGradeMetricRecipe[]>> =
  Object.freeze({
    combat: Object.freeze([
      Object.freeze({ key: "damage_share", weight: .3, direction: "higher" as const }),
      Object.freeze({ key: "kill_participation", weight: .3, direction: "higher" as const }),
      Object.freeze({ key: "champion_damage_per_min", weight: .15, direction: "higher" as const }),
      Object.freeze({ key: "damage_per_1000_gold", weight: .1, direction: "higher" as const }),
      Object.freeze({ key: "teamfight_participation_rate", weight: .05, direction: "higher" as const }),
      Object.freeze({ key: "teamfight_outcome_rate", weight: .05, direction: "higher" as const }),
      Object.freeze({ key: "skirmish_outcome_rate", weight: .05, direction: "higher" as const }),
    ]),
    positioning_survival: Object.freeze([
      Object.freeze({ key: "deaths_per_10", weight: .6, direction: "lower" as const }),
      Object.freeze({ key: "time_dead_share", weight: .15, direction: "lower" as const }),
      Object.freeze({ key: "isolated_death_rate", weight: .075, direction: "lower" as const }),
      Object.freeze({ key: "outnumbered_death_rate", weight: .075, direction: "lower" as const }),
      Object.freeze({ key: "teamfight_survival_rate", weight: .1, direction: "higher" as const }),
    ]),
    control_utility: Object.freeze([
      Object.freeze({ key: "cc_seconds_per_min", weight: .7, direction: "higher" as const }),
      Object.freeze({ key: "ally_heal_shield_per_min", weight: .2, direction: "higher" as const }),
      Object.freeze({ key: "team_protection_share", weight: .1, direction: "higher" as const }),
    ]),
    economy: Object.freeze([
      Object.freeze({ key: "gold_per_min", weight: .3, direction: "higher" as const }),
      Object.freeze({ key: "cs_per_min", weight: .2, direction: "higher" as const }),
      Object.freeze({ key: "gold_delta_10", weight: .1, direction: "higher" as const }),
      Object.freeze({ key: "gold_delta_15", weight: .1, direction: "higher" as const }),
      Object.freeze({ key: "gold_delta_20", weight: .1, direction: "higher" as const }),
      Object.freeze({ key: "cs_delta_10", weight: .05, direction: "higher" as const }),
      Object.freeze({ key: "cs_delta_15", weight: .05, direction: "higher" as const }),
      Object.freeze({ key: "cs_delta_20", weight: .05, direction: "higher" as const }),
      Object.freeze({ key: "xp_delta_10", weight: .025, direction: "higher" as const }),
      Object.freeze({ key: "xp_delta_15", weight: .025, direction: "higher" as const }),
    ]),
    objectives_macro: Object.freeze([
      Object.freeze({
        key: "neutral_objective_damage_per_min",
        weight: .25,
        direction: "higher" as const,
      }),
      Object.freeze({ key: "structure_damage_per_min", weight: .3, direction: "higher" as const }),
      Object.freeze({ key: "objective_participation_rate", weight: .25, direction: "higher" as const }),
      Object.freeze({ key: "structure_takedown_participation_rate", weight: .2, direction: "higher" as const }),
    ]),
    vision_setup: Object.freeze([
      Object.freeze({ key: "vision_score_per_min", weight: 1, direction: "higher" as const }),
    ]),
    initiative_pressure: Object.freeze([
      Object.freeze({ key: "early_takedown_participation", weight: .4, direction: "higher" as const }),
      Object.freeze({ key: "spatial_early_roam_rate", weight: .15, direction: "higher" as const }),
      Object.freeze({ key: "early_structure_participation", weight: .2, direction: "higher" as const }),
      Object.freeze({ key: "early_objective_participation", weight: .25, direction: "higher" as const }),
    ]),
  })

/**
 * User-facing letters are direct bands on the frozen-reference Recall Score.
 * The values preserve the former letter boundaries while making the actual
 * grading contract explicit in its native 0-100 score space.
 */
export const MATCH_GRADE_SCORE_THRESHOLDS: readonly (readonly [RecallGrade, number])[] =
  Object.freeze([
    Object.freeze(["S+", 93.94] as const),
    Object.freeze(["S", 88.49] as const),
    Object.freeze(["S-", 81.59] as const),
    Object.freeze(["A+", 74.22] as const),
    Object.freeze(["A", 65.54] as const),
    Object.freeze(["A-", 55.96] as const),
    Object.freeze(["B+", 46.02] as const),
    Object.freeze(["B", 36.32] as const),
    Object.freeze(["B-", 27.43] as const),
    Object.freeze(["C+", 18.41] as const),
    Object.freeze(["C", 12.51] as const),
    Object.freeze(["C-", 7.35] as const),
  ])

export const CURRENT_GRADE_RECIPE = Object.freeze({
  algorithmVersion: CANONICAL_GRADE_STORAGE_PARTITION,
  recipeDefinitionId: CURRENT_GRADE_RECIPE_DEFINITION_ID,
  taxonomyVersion: CURRENT_GRADE_TAXONOMY_ID,
  calibration: Object.freeze({
    method: "shrunk_mid_ecdf" as const,
    stages: Object.freeze([
      "metric_percentile",
      "responsibility_composite_percentile",
    ] as const),
    defaultKappa: 20,
    /** The final root cohort is an ECDF, not a shrinkage-to-50 prior. */
    finalCompositeRootKappa: 0,
    percentileClamp: Object.freeze([.01, .99] as const),
    clusterUnit: "match" as const,
    clusterIdentity: CURRENT_GRADE_CLUSTER_POLICY_ID,
    scope: "tracked_mode_and_ruleset_key" as const,
    minimumScopeMatches: 10,
  }),
  sourceContracts: Object.freeze({
    positionResolverVersion: POSITION_RESOLVER_VERSION,
    gradeCoreFactContractVersion: GRADE_CORE_FACT_CONTRACT_VERSION,
    evidencePolicyVersion: CURRENT_GRADE_EVIDENCE_POLICY_ID,
  }),
  aggregation: Object.freeze({
    method: "fixed_denominator_core_bundle_neutral_imputation" as const,
    missingSecondaryEvidence:
      "retain_missing_state_and_impute_observed_core_bundle_for_arithmetic" as const,
    missingOptionalOnlyArm:
      "retain_unavailable_and_neutralize_against_resolved_composite" as const,
    familyMetrics: FAMILY_METRICS,
    diagnosticMetrics: MATCH_GRADE_DIAGNOSTIC_METRIC_KEYS,
    responsibilityTiers: Object.freeze({ ...RESPONSIBILITY_TIERS }),
  }),
  // This property name is part of the persisted recipe definition. Keep it
  // stable so a recipe identity continues to hash deterministically.
  roleFitLetterThresholds: MATCH_GRADE_SCORE_THRESHOLDS,
  compatibilityScore: Object.freeze({
    transform: "inverse_normal_of_role_fit" as const,
    usedForLetters: false,
  }),
})

/** Exact persisted contract for a supported identity, excluding snapshot metadata. */
export function gradeRecipeContractForIdentity(identity: GradeRecipeIdentityKind) {
  if (identity === "canonical") return CURRENT_GRADE_RECIPE
  return {
    ...CURRENT_GRADE_RECIPE,
    recipeDefinitionId: LEGACY_GRADE_RECIPE_DEFINITION_ID,
    sourceContracts: {
      ...CURRENT_GRADE_RECIPE.sourceContracts,
      evidencePolicyVersion: LEGACY_GRADE_EVIDENCE_POLICY_ID,
    },
  }
}

export function gradeForRecallScore(score: number): RecallGrade {
  return MATCH_GRADE_SCORE_THRESHOLDS.find(([, minimum]) => score >= minimum)?.[0] ?? "D"
}
