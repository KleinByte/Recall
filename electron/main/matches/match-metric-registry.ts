import type { Position } from "./position.js"
import type { MatchGradeModeContext, PrimaryArchetype } from "./match-grade-taxonomy.js"
import { MATCH_GRADE_METRIC_DIRECTIONS, MATCH_GRADE_RECIPE } from "./match-grade-recipe.js"
import type {
  MetricDirection,
  MetricResponsibilityTier,
  MetricSource,
} from "./match-metric-observations.js"
import { SUMMARY_METRIC_KEYS, type SummaryMetricKey } from "./rvi-summary.js"
import {
  CAREER_RVI_ARM_KEYS,
  MATCH_RVI_ARM_KEYS,
} from "../../../src/shared/performance-vocabulary.js"

export { SUMMARY_METRIC_KEYS }

export const RVI_MATCH_ARM_KEYS = MATCH_RVI_ARM_KEYS

export const RVI_PROFILE_ONLY_ARM_KEYS = [
  "consistency_versatility",
] as const

export const RVI_CAPABILITY_VECTORS = CAREER_RVI_ARM_KEYS

export type RviCapabilityVector = typeof RVI_CAPABILITY_VECTORS[number]

export const TIMELINE_METRIC_KEYS = [
  "pick_conversion_rate",
  "duel_outcome_rate",
  "teamfight_participation_rate",
  "teamfight_outcome_rate",
  "skirmish_outcome_rate",
  "recorded_fight_involvement_per_min",
  "isolated_death_rate",
  "outnumbered_death_rate",
  "pre_objective_deaths_per_opportunity",
  "teamfight_survival_rate",
  "forward_death_share",
  "gold_delta_10",
  "gold_delta_15",
  "gold_delta_20",
  "gold_delta_30",
  "cs_delta_10",
  "cs_delta_15",
  "cs_delta_20",
  "cs_delta_30",
  "xp_delta_10",
  "xp_delta_15",
  "objective_participation_rate",
  "dragon_participation_rate",
  "herald_participation_rate",
  "baron_participation_rate",
  "objective_secure_rate",
  "objective_proximity_rate",
  "structure_takedown_participation_rate",
  "baron_conversion_gold_delta",
  "objective_setup_ward_rate",
  "early_takedown_participation",
  "spatial_early_roam_rate",
  "forward_takedown_share",
  "solo_pressure_outcome_rate",
  "early_structure_participation",
  "early_objective_participation",
] as const

export type TimelineMetricKey = typeof TIMELINE_METRIC_KEYS[number]
export type MetricKey = SummaryMetricKey | TimelineMetricKey

export interface MetricContext {
  context: MatchGradeModeContext
  position?: Position | "UNKNOWN"
  archetype?: PrimaryArchetype
}

export interface MetricDefinition<TMetricKey extends string = MetricKey> {
  key: TMetricKey
  label: string
  description: string
  formula: string
  unit: string
  direction: MetricDirection
  source: MetricSource
  applicable(context: MetricContext): boolean
}

export interface RviMetricPolicy<TMetricKey extends string = MetricKey> {
  metricKey: TMetricKey
  vector: RviCapabilityVector
  tier: MetricResponsibilityTier
  /** Fixed metric responsibility inside its match arm, independent of Grade. */
  vectorWeight: number
}

type DefinitionSeed = Omit<MetricDefinition, "applicable"> & {
  applicability?: "all" | "rift" | "rift_position" | "lane" | "non_utility"
}

const isRift = (context: MetricContext) => context.context.ruleset !== "howling_abyss"
const hasRiftPosition = (context: MetricContext) =>
  isRift(context) && context.position !== undefined && context.position !== "UNKNOWN"
const hasLane = (context: MetricContext) =>
  isRift(context) && (context.position === "TOP" ||
    context.position === "MIDDLE" || context.position === "BOTTOM")

const applicableFor = (policy: DefinitionSeed["applicability"]) => {
  if (policy === "rift") return isRift
  if (policy === "rift_position") return hasRiftPosition
  if (policy === "lane") return hasLane
  if (policy === "non_utility") return (context: MetricContext) =>
    context.position !== "UTILITY"
  return () => true
}

const definition = (seed: DefinitionSeed): MetricDefinition => {
  const { applicability, ...values } = seed
  return Object.freeze({ ...values, applicable: applicableFor(applicability) })
}

const DEFINITIONS: readonly MetricDefinition[] = Object.freeze([
  definition({ key: "damage_share", label: "Damage share", description: "Share of the team's champion damage.", formula: "champion damage / team champion damage", unit: "ratio", direction: "higher", source: "scoreboard" }),
  definition({ key: "kill_participation", label: "Kill participation", description: "Share of team kills with a recorded kill or assist.", formula: "(kills + assists) / team kills", unit: "ratio", direction: "higher", source: "scoreboard" }),
  definition({ key: "deaths_per_10", label: "Deaths per 10 minutes", description: "Death pace normalized to ten minutes.", formula: "deaths * 600 / duration seconds", unit: "deaths_per_10_min", direction: "lower", source: "scoreboard" }),
  definition({ key: "gold_per_min", label: "Gold per minute", description: "Gold earned per minute played.", formula: "gold earned * 60 / duration seconds", unit: "gold_per_min", direction: "higher", source: "scoreboard" }),
  definition({ key: "cs_per_min", label: "CS per minute", description: "Lane and neutral minions killed per minute.", formula: "(lane minions + neutral minions) * 60 / duration seconds", unit: "cs_per_min", direction: "higher", source: "scoreboard", applicability: "non_utility" }),
  definition({ key: "neutral_objective_damage_per_min", label: "Neutral-objective damage per minute", description: "Damage to non-structure objectives per minute.", formula: "max(0, objective damage - turret damage) * 60 / duration seconds", unit: "damage_per_min", direction: "higher", source: "scoreboard", applicability: "rift" }),
  definition({ key: "structure_damage_per_min", label: "Structure damage per minute", description: "Damage to structures per minute.", formula: "structure damage * 60 / duration seconds", unit: "damage_per_min", direction: "higher", source: "scoreboard", applicability: "rift" }),
  definition({ key: "vision_score_per_min", label: "Vision score per minute", description: "Recorded vision score per minute.", formula: "vision score * 60 / duration seconds", unit: "vision_score_per_min", direction: "higher", source: "scoreboard", applicability: "rift" }),
  definition({ key: "cc_seconds_per_min", label: "CC seconds per minute", description: "Recorded time crowd-controlling opponents per minute.", formula: "CC seconds * 60 / duration seconds", unit: "cc_seconds_per_min", direction: "higher", source: "scoreboard" }),
  definition({ key: "ally_heal_shield_per_min", label: "Ally healing and shielding per minute", description: "Health restored or shielded on teammates per minute.", formula: "(ally healing + ally shielding) * 60 / duration seconds", unit: "health_per_min", direction: "higher", source: "extended" }),
  definition({ key: "champion_damage_per_min", label: "Champion damage per minute", description: "Damage dealt to champions per minute.", formula: "champion damage * 60 / duration seconds", unit: "damage_per_min", direction: "higher", source: "scoreboard" }),
  definition({ key: "damage_per_1000_gold", label: "Damage per 1,000 gold", description: "Champion damage relative to gold earned.", formula: "champion damage * 1000 / gold earned", unit: "damage_per_1000_gold", direction: "higher", source: "derived" }),
  definition({ key: "gold_share", label: "Team gold share", description: "Share of the team's earned gold.", formula: "gold earned / team gold earned", unit: "ratio", direction: "higher", source: "derived" }),
  definition({ key: "damage_taken_per_min", label: "Damage taken per minute", description: "Literal incoming damage pace; it does not imply good frontlining.", formula: "damage taken * 60 / duration seconds", unit: "damage_per_min", direction: "higher", source: "scoreboard" }),
  definition({ key: "damage_taken_share", label: "Team damage-taken share", description: "Share of the team's recorded incoming damage.", formula: "damage taken / team damage taken", unit: "ratio", direction: "higher", source: "derived" }),
  definition({ key: "damage_mitigated_per_min", label: "Damage mitigated per minute", description: "Self-mitigated damage per minute.", formula: "self-mitigated damage * 60 / duration seconds", unit: "damage_per_min", direction: "higher", source: "scoreboard" }),
  definition({ key: "mitigation_share", label: "Mitigation share", description: "Literal mitigation relative to mitigation plus damage taken.", formula: "mitigated / (mitigated + damage taken)", unit: "ratio", direction: "higher", source: "derived" }),
  definition({ key: "time_dead_share", label: "Time dead share", description: "Share of match duration spent dead.", formula: "time spent dead / duration seconds", unit: "ratio", direction: "lower", source: "extended" }),
  definition({ key: "wards_placed_per_min", label: "Wards placed per minute", description: "Recorded ward placements per minute.", formula: "wards placed * 60 / duration seconds", unit: "wards_per_min", direction: "higher", source: "scoreboard", applicability: "rift" }),
  definition({ key: "wards_killed_per_min", label: "Wards destroyed per minute", description: "Recorded enemy wards destroyed per minute.", formula: "wards killed * 60 / duration seconds", unit: "wards_per_min", direction: "higher", source: "scoreboard", applicability: "rift" }),
  definition({ key: "control_wards_per_min", label: "Control wards per minute", description: "Verified control-ward purchases per minute.", formula: "control wards purchased * 60 / duration seconds", unit: "wards_per_min", direction: "higher", source: "extended", applicability: "rift" }),
  definition({ key: "detector_wards_placed_per_min", label: "Detector wards placed per minute", description: "Verified detector-ward placements per minute.", formula: "detector wards placed * 60 / duration seconds", unit: "wards_per_min", direction: "higher", source: "extended", applicability: "rift" }),
  definition({ key: "team_protection_share", label: "Team protection share", description: "Share of the team's recorded ally healing and shielding.", formula: "ally healing and shielding / team ally healing and shielding", unit: "ratio", direction: "higher", source: "derived" }),
  definition({ key: "kill_share_of_takedowns", label: "Kill share of takedowns", description: "Literal kill share; it is not an aggression grade.", formula: "kills / (kills + assists)", unit: "ratio", direction: "higher", source: "derived" }),
  definition({ key: "kda_pace", label: "KDA pace", description: "Takedowns per recorded death, shown as context only.", formula: "(kills + assists) / max(1, deaths)", unit: "ratio", direction: "higher", source: "derived" }),
  definition({ key: "objective_damage_mix", label: "Objective damage mix", description: "Literal objective-versus-champion damage mix, not objective quality.", formula: "objective damage / (objective damage + champion damage)", unit: "ratio", direction: "higher", source: "derived", applicability: "rift" }),

  definition({ key: "pick_conversion_rate", label: "Recorded pick conversion", description: "Outcome points in involved pick-like takedown clusters.", formula: "mean(win=1, tie=0.5, loss=0) across involved pick clusters", unit: "ratio", direction: "higher", source: "timeline" }),
  definition({ key: "duel_outcome_rate", label: "Recorded duel outcomes", description: "Outcome points in involved two-participant takedown clusters.", formula: "mean(win=1, tie=0.5, loss=0) across involved duel clusters", unit: "ratio", direction: "higher", source: "timeline" }),
  definition({ key: "teamfight_participation_rate", label: "Recorded teamfight participation", description: "Share of teamfight-cluster opportunities containing the player.", formula: "involved teamfight clusters / teamfight clusters involving the team", unit: "ratio", direction: "higher", source: "timeline" }),
  definition({ key: "teamfight_outcome_rate", label: "Recorded teamfight outcomes", description: "Outcome points in involved six-plus-participant takedown clusters.", formula: "mean(win=1, tie=0.5, loss=0) across involved teamfight clusters", unit: "ratio", direction: "higher", source: "timeline" }),
  definition({ key: "skirmish_outcome_rate", label: "Recorded skirmish outcomes", description: "Outcome points in involved three-to-five-participant takedown clusters.", formula: "mean(win=1, tie=0.5, loss=0) across involved skirmish clusters", unit: "ratio", direction: "higher", source: "timeline" }),
  definition({ key: "recorded_fight_involvement_per_min", label: "Recorded fight involvement per minute", description: "Takedown-event clusters involving the player per minute; it is not total fight frequency.", formula: "involved takedown clusters * 60 / duration seconds", unit: "clusters_per_min", direction: "higher", source: "timeline" }),
  definition({ key: "isolated_death_rate", label: "Isolated death rate", description: "Share of clustered deaths with no other allied participant.", formula: "isolated owner-death clusters / owner-death clusters", unit: "ratio", direction: "lower", source: "timeline" }),
  definition({ key: "outnumbered_death_rate", label: "Outnumbered death rate", description: "Share of clustered deaths where opposing participants outnumber allies.", formula: "outnumbered owner-death clusters / owner-death clusters", unit: "ratio", direction: "lower", source: "timeline" }),
  definition({ key: "pre_objective_deaths_per_opportunity", label: "Pre-objective deaths", description: "Deaths shortly before and near retained neutral-objective takedowns.", formula: "qualifying deaths / retained neutral-objective takedowns", unit: "ratio", direction: "lower", source: "timeline", applicability: "rift" }),
  definition({ key: "teamfight_survival_rate", label: "Recorded teamfight survival", description: "Share of involved teamfight clusters without a recorded player death.", formula: "survived involved teamfight clusters / involved teamfight clusters", unit: "ratio", direction: "higher", source: "timeline" }),
  definition({ key: "forward_death_share", label: "Forward death share", description: "Share of deaths occurring on the opponent's side of the Rift.", formula: "forward deaths / recorded deaths", unit: "ratio", direction: "lower", source: "timeline", applicability: "rift" }),

  ...([10, 15, 20, 30] as const).flatMap((minute) => [
    definition({ key: `gold_delta_${minute}` as MetricKey, label: `Gold delta at ${minute}`, description: `Gold difference from the exact opposing role near ${minute}:00.`, formula: `owner gold - opposing-role gold at ${minute}:00 (nearest frame within 30 seconds)`, unit: "gold", direction: "higher", source: "timeline", applicability: "rift_position" }),
    definition({ key: `cs_delta_${minute}` as MetricKey, label: `CS delta at ${minute}`, description: `CS difference from the exact opposing role near ${minute}:00.`, formula: `owner CS - opposing-role CS at ${minute}:00 (nearest frame within 30 seconds)`, unit: "cs", direction: "higher", source: "timeline", applicability: "rift_position" }),
  ]),
  definition({ key: "xp_delta_10", label: "XP delta at 10", description: "XP difference from the exact opposing role near 10:00.", formula: "owner XP - opposing-role XP at 10:00 (nearest frame within 30 seconds)", unit: "xp", direction: "higher", source: "timeline", applicability: "rift_position" }),
  definition({ key: "xp_delta_15", label: "XP delta at 15", description: "XP difference from the exact opposing role near 15:00.", formula: "owner XP - opposing-role XP at 15:00 (nearest frame within 30 seconds)", unit: "xp", direction: "higher", source: "timeline", applicability: "rift_position" }),

  definition({ key: "objective_participation_rate", label: "Objective participation", description: "Direct or proven nearby involvement in team neutral-objective takedowns.", formula: "participated team objectives / team objective takedowns", unit: "ratio", direction: "higher", source: "timeline", applicability: "rift" }),
  definition({ key: "dragon_participation_rate", label: "Dragon participation", description: "Direct or proven nearby involvement in team Dragon takedowns.", formula: "participated team Dragons / team Dragon takedowns", unit: "ratio", direction: "higher", source: "timeline", applicability: "rift" }),
  definition({ key: "herald_participation_rate", label: "Herald participation", description: "Direct or proven nearby involvement in team Herald takedowns.", formula: "participated team Heralds / team Herald takedowns", unit: "ratio", direction: "higher", source: "timeline", applicability: "rift" }),
  definition({ key: "baron_participation_rate", label: "Baron participation", description: "Direct or proven nearby involvement in team Baron takedowns.", formula: "participated team Barons / team Baron takedowns", unit: "ratio", direction: "higher", source: "timeline", applicability: "rift" }),
  definition({ key: "objective_secure_rate", label: "Objective secure rate", description: "Share of team neutral objectives finished by the player.", formula: "player objective finishing hits / team objective takedowns", unit: "ratio", direction: "higher", source: "timeline", applicability: "rift" }),
  definition({ key: "objective_proximity_rate", label: "Objective proximity", description: "Share of team objectives with proven nearby presence.", formula: "team objectives within 1,500 units and 60 seconds / team objectives", unit: "ratio", direction: "higher", source: "timeline", applicability: "rift" }),
  definition({ key: "structure_takedown_participation_rate", label: "Structure takedown participation", description: "Recorded involvement in team structure takedowns.", formula: "involved team structure takedowns / team structure takedowns", unit: "ratio", direction: "higher", source: "timeline", applicability: "rift" }),
  definition({ key: "baron_conversion_gold_delta", label: "Baron conversion gold delta", description: "Team gold-differential change after a team Baron; this is team context, not individual credit.", formula: "team-relative gold differential after 3 minutes - differential at Baron", unit: "gold", direction: "higher", source: "timeline", applicability: "rift" }),
  definition({ key: "objective_setup_ward_rate", label: "Objective setup wards", description: "Share of team objectives preceded by a positioned player ward action.", formula: "team objectives with player ward action 30-90 seconds before within 1,500 units / team objectives", unit: "ratio", direction: "higher", source: "timeline", applicability: "rift" }),

  definition({ key: "early_takedown_participation", label: "Early takedown participation", description: "Share of team kills before 15:00 with a recorded kill or assist.", formula: "player early kill contributions / team early kills", unit: "ratio", direction: "higher", source: "timeline", applicability: "rift" }),
  definition({ key: "spatial_early_roam_rate", label: "Spatial early roam rate", description: "Share of early contributions proven outside lane against a non-lane opponent.", formula: "qualifying spatial roam contributions / early contributions", unit: "ratio", direction: "higher", source: "timeline", applicability: "lane" }),
  definition({ key: "forward_takedown_share", label: "Forward takedown share", description: "Share of takedown contributions occurring on the opponent's side of the Rift.", formula: "forward takedown contributions / takedown contributions", unit: "ratio", direction: "higher", source: "timeline", applicability: "rift" }),
  definition({ key: "solo_pressure_outcome_rate", label: "Solo pressure outcomes", description: "Outcome points in true two-participant clusters involving the player.", formula: "mean(win=1, tie=0.5, loss=0) across involved solo clusters", unit: "ratio", direction: "higher", source: "timeline", applicability: "rift" }),
  definition({ key: "early_structure_participation", label: "Early structure participation", description: "Recorded involvement in team structure takedowns before 15:00.", formula: "involved team early structures / team early structure takedowns", unit: "ratio", direction: "higher", source: "timeline", applicability: "rift" }),
  definition({ key: "early_objective_participation", label: "Early objective participation", description: "Direct or proven nearby involvement in team objectives before 15:00.", formula: "participated team early objectives / team early objective takedowns", unit: "ratio", direction: "higher", source: "timeline", applicability: "rift" }),
])

const core = (
  metricKey: MetricKey,
  vector: RviCapabilityVector,
  vectorWeight = 1,
): RviMetricPolicy => Object.freeze({
  metricKey,
  vector,
  tier: "CORE",
  vectorWeight,
})

const secondary = (
  metricKey: MetricKey,
  vector: RviCapabilityVector,
  vectorWeight: number,
): RviMetricPolicy => Object.freeze({
  metricKey,
  vector,
  tier: "SECONDARY",
  vectorWeight,
})

const diagnostic = (
  metricKey: MetricKey,
  vector: RviCapabilityVector,
): RviMetricPolicy => Object.freeze({
  metricKey,
  vector,
  tier: "DIAGNOSTIC",
  vectorWeight: 0,
})

const POLICIES: readonly RviMetricPolicy[] = Object.freeze([
  core("damage_share", "combat", .3),
  secondary("champion_damage_per_min", "combat", .15),
  secondary("damage_per_1000_gold", "combat", .1),
  diagnostic("pick_conversion_rate", "combat"),
  diagnostic("duel_outcome_rate", "combat"),
  core("kill_participation", "combat", .3),
  secondary("teamfight_participation_rate", "combat", .05),
  secondary("teamfight_outcome_rate", "combat", .05),
  secondary("skirmish_outcome_rate", "combat", .05),
  diagnostic("recorded_fight_involvement_per_min", "combat"),
  diagnostic("kill_share_of_takedowns", "combat"),
  diagnostic("kda_pace", "combat"),

  core("deaths_per_10", "positioning_survival", .6),
  secondary("time_dead_share", "positioning_survival", .15),
  secondary("isolated_death_rate", "positioning_survival", .075),
  secondary("outnumbered_death_rate", "positioning_survival", .075),
  diagnostic("pre_objective_deaths_per_opportunity", "positioning_survival"),
  secondary("teamfight_survival_rate", "positioning_survival", .1),
  diagnostic("forward_death_share", "positioning_survival"),

  core("cc_seconds_per_min", "control_utility", .7),
  secondary("ally_heal_shield_per_min", "control_utility", .2),
  secondary("team_protection_share", "control_utility", .1),
  diagnostic("damage_taken_per_min", "control_utility"),
  diagnostic("damage_taken_share", "control_utility"),
  diagnostic("damage_mitigated_per_min", "control_utility"),
  diagnostic("mitigation_share", "control_utility"),

  core("gold_per_min", "economy", .3),
  core("cs_per_min", "economy", .2),
  diagnostic("gold_share", "economy"),
  ...([10, 15, 20] as const).flatMap((minute) => [
    secondary(`gold_delta_${minute}` as MetricKey, "economy", .1),
    secondary(`cs_delta_${minute}` as MetricKey, "economy", .05),
  ]),
  diagnostic("gold_delta_30", "economy"),
  diagnostic("cs_delta_30", "economy"),
  secondary("xp_delta_10", "economy", .025),
  secondary("xp_delta_15", "economy", .025),

  core("neutral_objective_damage_per_min", "objectives_macro", .25),
  core("structure_damage_per_min", "objectives_macro", .3),
  diagnostic("objective_damage_mix", "objectives_macro"),
  secondary("objective_participation_rate", "objectives_macro", .25),
  diagnostic("dragon_participation_rate", "objectives_macro"),
  diagnostic("herald_participation_rate", "objectives_macro"),
  diagnostic("baron_participation_rate", "objectives_macro"),
  diagnostic("objective_secure_rate", "objectives_macro"),
  diagnostic("objective_proximity_rate", "objectives_macro"),
  secondary("structure_takedown_participation_rate", "objectives_macro", .2),
  diagnostic("baron_conversion_gold_delta", "objectives_macro"),

  core("vision_score_per_min", "vision_setup"),
  diagnostic("wards_placed_per_min", "vision_setup"),
  diagnostic("wards_killed_per_min", "vision_setup"),
  diagnostic("control_wards_per_min", "vision_setup"),
  diagnostic("detector_wards_placed_per_min", "vision_setup"),
  diagnostic("objective_setup_ward_rate", "vision_setup"),

  secondary("early_takedown_participation", "initiative_pressure", .4),
  secondary("spatial_early_roam_rate", "initiative_pressure", .15),
  diagnostic("forward_takedown_share", "initiative_pressure"),
  diagnostic("solo_pressure_outcome_rate", "initiative_pressure"),
  secondary("early_structure_participation", "initiative_pressure", .2),
  secondary("early_objective_participation", "initiative_pressure", .25),
])

const DEFINITION_BY_KEY = new Map(DEFINITIONS.map((entry) => [entry.key, entry]))
const POLICY_BY_KEY = new Map(POLICIES.map((entry) => [entry.metricKey, entry]))

export const METRIC_DEFINITIONS = DEFINITIONS
export const RVI_METRIC_POLICIES = POLICIES

export function metricDefinition(metricKey: string): MetricDefinition | undefined {
  return DEFINITION_BY_KEY.get(metricKey as MetricKey)
}

export function rviMetricPolicy(metricKey: string): RviMetricPolicy | undefined {
  return POLICY_BY_KEY.get(metricKey as MetricKey)
}

export function assertValidMetricRegistry(
  definitions: readonly MetricDefinition[] = DEFINITIONS,
  policies: readonly RviMetricPolicy[] = POLICIES,
): void {
  const definitionKeys = new Set<string>()
  for (const entry of definitions) {
    if (!entry.key.trim() || definitionKeys.has(entry.key)) {
      throw new Error(`metric_definition_key_duplicate_or_empty:${entry.key}`)
    }
    definitionKeys.add(entry.key)
    if (!entry.label.trim() || !entry.description.trim() || !entry.formula.trim() ||
        !entry.unit.trim()) throw new Error(`metric_definition_incomplete:${entry.key}`)
    if (entry.direction !== "higher" && entry.direction !== "lower") {
      throw new Error(`metric_direction_invalid:${entry.key}`)
    }
    if (typeof entry.applicable !== "function") {
      throw new Error(`metric_applicability_missing:${entry.key}`)
    }
  }

  const policyKeys = new Set<string>()
  const vectors = new Set<string>(RVI_CAPABILITY_VECTORS)
  for (const entry of policies) {
    if (policyKeys.has(entry.metricKey)) throw new Error(`metric_policy_duplicate:${entry.metricKey}`)
    policyKeys.add(entry.metricKey)
    if (!definitionKeys.has(entry.metricKey)) throw new Error(`metric_policy_unknown:${entry.metricKey}`)
    if (!vectors.has(entry.vector)) throw new Error(`metric_vector_unknown:${entry.metricKey}`)
    if (!Number.isFinite(entry.vectorWeight) || entry.vectorWeight < 0) {
      throw new Error(`metric_weight_invalid:${entry.metricKey}`)
    }
    if (entry.tier === "DIAGNOSTIC" && entry.vectorWeight !== 0) {
      throw new Error(`diagnostic_vector_weight_nonzero:${entry.metricKey}`)
    }
    if ((entry.tier === "CORE" || entry.tier === "SECONDARY") &&
        entry.vectorWeight <= 0) {
      throw new Error(`scored_metric_weight_missing:${entry.metricKey}`)
    }
  }
  for (const vector of RVI_MATCH_ARM_KEYS) {
    const scoredPolicies = policies.filter((entry) => entry.vector === vector &&
      entry.tier !== "DIAGNOSTIC")
    const total = scoredPolicies.reduce((sum, entry) => sum + entry.vectorWeight, 0)
    if (Math.abs(total - 1) > 1e-12) {
      throw new Error(`metric_vector_weight_total_invalid:${vector}:${total}`)
    }
    const recipeMetrics = MATCH_GRADE_RECIPE.aggregation.familyMetrics[vector]
    if (recipeMetrics.length !== scoredPolicies.length || recipeMetrics.some((metric) => {
      const policy = scoredPolicies.find((entry) => entry.metricKey === metric.key)
      const definition = definitions.find((entry) => entry.key === metric.key)
      return !policy || !definition || policy.vectorWeight !== metric.weight ||
        definition.direction !== metric.direction
    })) throw new Error(`grade_arm_recipe_policy_mismatch:${vector}`)
  }
  const expected = new Set<string>([...SUMMARY_METRIC_KEYS, ...TIMELINE_METRIC_KEYS])
  for (const key of expected) {
    if (!definitionKeys.has(key)) throw new Error(`registered_metric_definition_missing:${key}`)
    if (!policyKeys.has(key)) throw new Error(`registered_metric_policy_missing:${key}`)
  }
  for (const key of definitionKeys) {
    if (!expected.has(key)) throw new Error(`unrecognized_metric_definition:${key}`)
  }
  for (const [key, direction] of Object.entries(MATCH_GRADE_METRIC_DIRECTIONS)) {
    const registered = definitions.find((entry) => entry.key === key)
    if (!registered || registered.direction !== direction) {
      throw new Error(`grade_metric_direction_mismatch:${key}`)
    }
  }
}

assertValidMetricRegistry()
