import type { Grade } from "./grade.js"
import { GRADE_CORE_FACT_CONTRACT_VERSION } from "./grade-core-facts.js"
import { POSITION_RESOLVER_VERSION } from "./position.js"

export const GRADE_V3_ALGORITHM_VERSION = 3 as const

/**
 * Product version and scoring recipe are deliberately separate identities.
 * Never reuse this value after changing a weight, threshold, taxonomy, or
 * calibration rule: stored Grade v3 artifacts use it as their recipe key.
 */
export const GRADE_V3_RECIPE_DEFINITION_ID =
  "recall.grade.v3.radar-arms.2026-08-10.r2" as const

/**
 * Version of the missing/zero/no-opportunity semantics consumed by Grade v3.
 * Bump this whenever an Evidence state changes how a metric is calibrated or
 * aggregated, even when the raw field contract itself is unchanged.
 */
export const GRADE_V3_EVIDENCE_POLICY_VERSION =
  "recall.grade.v3.evidence.2026-08-10.r2" as const
export const GRADE_V3_CLUSTER_ID_POLICY_VERSION =
  "canonical_platform_game_id.r1" as const

/**
 * A persisted recipe id includes the immutable calibration snapshot identity.
 * The snapshot id should be a content hash (or another immutable id) supplied
 * by the calibration store, not a mutable label such as "current".
 */
export function recipeIdForCalibration(calibrationSnapshotId: string): string {
  const snapshot = calibrationSnapshotId.trim()
  if (!snapshot || !/^[A-Za-z0-9._:-]+$/.test(snapshot)) {
    throw new TypeError("calibrationSnapshotId must be a non-empty immutable identifier")
  }
  return `${GRADE_V3_RECIPE_DEFINITION_ID}@calibration:${snapshot}`
}

/** Only for old gradeLobbyV3 callers while they migrate to a real snapshot. */
export const GRADE_V3_RECIPE_ID = recipeIdForCalibration("compatibility-lobby-rank-r1")

export const GRADE_V3_TAXONOMY_VERSION = "recall.archetypes.2026-08-10.r3" as const

export const GRADE_FAMILIES = [
  "combat",
  "positioning_survival",
  "control_utility",
  "economy",
  "objectives_macro",
  "vision_setup",
  "initiative_pressure",
] as const

export type GradeFamilyV3 = typeof GRADE_FAMILIES[number]

export const GRADE_FAMILY_LABELS: Readonly<Record<GradeFamilyV3, string>> = Object.freeze({
  combat: "Combat",
  positioning_survival: "Positioning & Survival",
  control_utility: "Control & Utility",
  economy: "Economy",
  objectives_macro: "Objectives & Macro",
  vision_setup: "Vision & Setup",
  initiative_pressure: "Initiative & Pressure",
})

export const GRADE_METRICS = [
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

export type GradeMetricV3 = typeof GRADE_METRICS[number]

export const GRADE_V3_METRIC_DIRECTIONS: Readonly<
  Record<GradeMetricV3, "higher" | "lower">
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
export const GRADE_V3_DIAGNOSTIC_METRICS: readonly GradeMetricV3[] = Object.freeze([])

export const RESPONSIBILITY_TIERS = {
  DIAGNOSTIC: 0,
  SECONDARY: 1,
  CORE: 2,
} as const

export type ResponsibilityTierName = keyof typeof RESPONSIBILITY_TIERS
export type ResponsibilityTier = typeof RESPONSIBILITY_TIERS[ResponsibilityTierName]

export interface FamilyMetricRecipeV3 {
  key: string
  weight: number
  direction: "higher" | "lower"
}

const FAMILY_METRICS: Readonly<Record<GradeFamilyV3, readonly FamilyMetricRecipeV3[]>> =
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
 * User-facing letters are direct bands on the frozen-reference RoleFit score.
 * The values preserve the former letter boundaries while making the actual
 * grading contract explicit in its native 0-100 score space.
 */
export const GRADE_V3_ROLE_FIT_THRESHOLDS: readonly (readonly [Grade, number])[] =
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

export const GRADE_V3_RECIPE = Object.freeze({
  algorithmVersion: GRADE_V3_ALGORITHM_VERSION,
  recipeDefinitionId: GRADE_V3_RECIPE_DEFINITION_ID,
  taxonomyVersion: GRADE_V3_TAXONOMY_VERSION,
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
    clusterIdentity: GRADE_V3_CLUSTER_ID_POLICY_VERSION,
    scope: "tracked_mode_and_ruleset_key" as const,
    minimumScopeMatches: 10,
  }),
  sourceContracts: Object.freeze({
    positionResolverVersion: POSITION_RESOLVER_VERSION,
    gradeCoreFactContractVersion: GRADE_CORE_FACT_CONTRACT_VERSION,
    evidencePolicyVersion: GRADE_V3_EVIDENCE_POLICY_VERSION,
  }),
  aggregation: Object.freeze({
    method: "fixed_denominator_core_bundle_neutral_imputation" as const,
    missingSecondaryEvidence:
      "retain_missing_state_and_impute_observed_core_bundle_for_arithmetic" as const,
    missingOptionalOnlyArm:
      "retain_unavailable_and_neutralize_against_resolved_composite" as const,
    familyMetrics: FAMILY_METRICS,
    diagnosticMetrics: GRADE_V3_DIAGNOSTIC_METRICS,
    responsibilityTiers: Object.freeze({ ...RESPONSIBILITY_TIERS }),
  }),
  roleFitLetterThresholds: GRADE_V3_ROLE_FIT_THRESHOLDS,
  compatibilityScore: Object.freeze({
    transform: "inverse_normal_of_role_fit" as const,
    usedForLetters: false,
  }),
})

export function gradeForRoleFitScore(score: number): Grade {
  return GRADE_V3_ROLE_FIT_THRESHOLDS.find(([, minimum]) => score >= minimum)?.[0] ?? "D"
}
