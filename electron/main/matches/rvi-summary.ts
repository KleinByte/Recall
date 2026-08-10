import type { Evidence } from "../../../src/shared/measurement.js"
import {
  invalid,
  noOpportunity,
  notApplicable,
  observed,
  unavailable,
} from "../../../src/shared/measurement.js"
import type {
  MetricSourceQuality,
  MetricSource,
  RawMetricObservation,
} from "./match-metric-observations.js"
import type { MatchGradeModeContext } from "./match-grade-taxonomy.js"

export const RVI_SUMMARY_DERIVATION_ID =
  "recall.rvi.v3.summary.2026-08-09.r1" as const

export const SUMMARY_METRIC_KEYS = [
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
  "champion_damage_per_min",
  "damage_per_1000_gold",
  "gold_share",
  "damage_taken_per_min",
  "damage_taken_share",
  "damage_mitigated_per_min",
  "mitigation_share",
  "time_dead_share",
  "wards_placed_per_min",
  "wards_killed_per_min",
  "control_wards_per_min",
  "detector_wards_placed_per_min",
  "team_protection_share",
  "kill_share_of_takedowns",
  "kda_pace",
  "objective_damage_mix",
] as const

export type SummaryMetricKey = typeof SUMMARY_METRIC_KEYS[number]

export interface SummaryMetricParticipant {
  participantId: number
  teamId: number
  kills: number
  deaths: number
  assists: number
  damageToChampions: number
  goldEarned: number
  totalMinionsKilled: number
  neutralMinions: number
  damageObjectives: number
  damageTurrets: number
  damageStructures: number
  visionScore: number
  timeCcingOthers: number
  damageTaken: number
  damageSelfMitigated: number
  wardsPlaced: number
  wardsKilled: number
  /** Verified visionWardsBoughtInGame; absent legacy fields stay unavailable. */
  controlWardsPurchased?: number
  detectorWardsPlaced?: number
  totalTimeSpentDead?: number
  totalHealsOnTeammates?: number
  totalDamageShieldedOnTeammates?: number
}

export interface SummaryMetricDerivationInput {
  participantId: number
  durationSecs: number
  context: MatchGradeModeContext
  /** A complete lobby is required for team-share observations. */
  participants: readonly SummaryMetricParticipant[]
  sourceQuality?: MetricSourceQuality
}

export type SummaryMetricObservation = RawMetricObservation<SummaryMetricKey>

const finiteNonnegative = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0

const riftObjectiveEvidence = (context: MatchGradeModeContext) =>
  context.ruleset !== "howling_abyss"

const pace = (value: number, durationSecs: number, scale = 60) =>
  value * scale / durationSecs

function raw(
  metricKey: SummaryMetricKey,
  unit: string,
  rawEvidence: Evidence<number>,
  source: MetricSource,
  sourceQuality: MetricSourceQuality,
  details: Pick<RawMetricObservation, "numerator" | "denominator" | "opportunityCount"> = {},
): SummaryMetricObservation {
  return {
    metricKey,
    unit,
    rawEvidence,
    source,
    sourceQuality,
    ...details,
  }
}

const derivedObserved = (value: number) => observed(value, { source: "derived" })
const derivedInvalid = (reason: string) => invalid<number>(reason, { source: "derived" })
const derivedUnavailable = (reason: string) => unavailable<number>(reason, { source: "legacy" })
const derivedNoOpportunity = (reason: string) =>
  noOpportunity<number>(reason, { source: "derived" })
const derivedNotApplicable = (reason: string) =>
  notApplicable<number>(reason, { source: "derived" })

function allUnavailable(
  reason: string,
  sourceQuality: MetricSourceQuality,
): SummaryMetricObservation[] {
  return SUMMARY_METRIC_KEYS.map((metricKey) => raw(
    metricKey,
    "unknown",
    derivedUnavailable(reason),
    "derived",
    sourceQuality,
  ))
}

/**
 * Derives all scoreboard/extended RVI observations in one pass. These are raw
 * values; frozen-reference calibration is intentionally a separate step.
 */
export function deriveSummaryMetricObservations(
  input: SummaryMetricDerivationInput,
): SummaryMetricObservation[] {
  const sourceQuality = input.sourceQuality ?? "verified"
  const owner = input.participants.find((entry) => entry.participantId === input.participantId)
  if (!owner) return allUnavailable("participant_not_present_in_scoreboard", sourceQuality)
  if (!Number.isFinite(input.durationSecs) || input.durationSecs <= 0) {
    return SUMMARY_METRIC_KEYS.map((metricKey) => raw(
      metricKey,
      "unknown",
      derivedInvalid("match_duration_must_be_positive"),
      "derived",
      sourceQuality,
    ))
  }

  const output: SummaryMetricObservation[] = []
  const add = (
    key: SummaryMetricKey,
    unit: string,
    evidence: Evidence<number>,
    source: MetricSource = "scoreboard",
    details: Pick<RawMetricObservation, "numerator" | "denominator" | "opportunityCount"> = {},
  ) => output.push(raw(key, unit, evidence, source, sourceQuality, details))
  const nonnegative = (
    key: SummaryMetricKey,
    value: number | undefined,
    unit: string,
    calculate: (value: number) => number,
    source: MetricSource = "scoreboard",
    denominator?: number,
  ) => {
    if (!finiteNonnegative(value)) {
      add(key, unit, value === undefined
        ? derivedUnavailable(`${key}_source_not_captured`)
        : derivedInvalid(`${key}_source_must_be_nonnegative`), source)
      return
    }
    add(key, unit, derivedObserved(calculate(value)), source, {
      numerator: value,
      ...(denominator === undefined ? {} : { denominator }),
    })
  }

  const teamCounts = new Map<number, number>()
  for (const entry of input.participants) {
    teamCounts.set(entry.teamId, (teamCounts.get(entry.teamId) ?? 0) + 1)
  }
  const completeLobby = input.participants.length === 10 &&
    new Set(input.participants.map((entry) => entry.participantId)).size === 10 &&
    teamCounts.size === 2 && [...teamCounts.values()].every((count) => count === 5)
  const team = input.participants.filter((entry) => entry.teamId === owner.teamId)
  const teamShare = (
    key: SummaryMetricKey,
    value: number | undefined,
    select: (entry: SummaryMetricParticipant) => number | undefined,
    zeroReason: string,
    source: MetricSource = "scoreboard",
  ) => {
    const values = team.map(select)
    if (!completeLobby || team.length !== 5 || values.some((entry) => entry === undefined)) {
      add(key, "ratio", derivedUnavailable(`${key}_requires_complete_team_source`), source)
      return
    }
    if (!finiteNonnegative(value) || values.some((entry) => !finiteNonnegative(entry))) {
      add(key, "ratio", derivedInvalid(`${key}_team_values_must_be_nonnegative`), source)
      return
    }
    const denominator = (values as number[]).reduce((sum, entry) => sum + entry, 0)
    add(key, "ratio", denominator === 0
      ? derivedNoOpportunity(zeroReason)
      : derivedObserved(value / denominator), source, {
      numerator: value,
      denominator,
      opportunityCount: denominator === 0 ? 0 : 1,
    })
  }

  const teamKills = completeLobby && team.length === 5 &&
    team.every((entry) => finiteNonnegative(entry.kills))
    ? team.reduce((sum, entry) => sum + entry.kills, 0)
    : null
  const neutralObjectiveDamage = finiteNonnegative(owner.damageObjectives) &&
    finiteNonnegative(owner.damageTurrets)
    ? Math.max(0, owner.damageObjectives - owner.damageTurrets)
    : null
  const ownerProtection = finiteNonnegative(owner.totalHealsOnTeammates) &&
    finiteNonnegative(owner.totalDamageShieldedOnTeammates)
    ? owner.totalHealsOnTeammates + owner.totalDamageShieldedOnTeammates
    : undefined

  teamShare(
    "damage_share",
    owner.damageToChampions,
    (entry) => entry.damageToChampions,
    "team_dealt_no_champion_damage",
  )
  if (!completeLobby || team.length !== 5) {
    add("kill_participation", "ratio",
      derivedUnavailable("kill_participation_requires_complete_team_source"))
  } else if (!finiteNonnegative(owner.kills) || !finiteNonnegative(owner.assists) || teamKills === null) {
    add("kill_participation", "ratio", derivedInvalid("kill_values_must_be_nonnegative"))
  } else {
    add("kill_participation", "ratio", teamKills === 0
      ? derivedNoOpportunity("team_had_no_kills")
      : derivedObserved(Math.min(1, (owner.kills + owner.assists) / teamKills)), "scoreboard", {
      numerator: owner.kills + owner.assists,
      denominator: teamKills,
      opportunityCount: teamKills,
    })
  }
  nonnegative("deaths_per_10", owner.deaths, "deaths_per_10_min",
    (value) => pace(value, input.durationSecs, 600), "scoreboard", input.durationSecs)
  nonnegative("gold_per_min", owner.goldEarned, "gold_per_min",
    (value) => pace(value, input.durationSecs), "scoreboard", input.durationSecs)
  if (!finiteNonnegative(owner.totalMinionsKilled) || !finiteNonnegative(owner.neutralMinions)) {
    add("cs_per_min", "cs_per_min", derivedInvalid("minion_counts_must_be_nonnegative"))
  } else {
    const cs = owner.totalMinionsKilled + owner.neutralMinions
    add("cs_per_min", "cs_per_min", derivedObserved(pace(cs, input.durationSecs)),
      "scoreboard", { numerator: cs, denominator: input.durationSecs })
  }

  if (!riftObjectiveEvidence(input.context)) {
    add("neutral_objective_damage_per_min", "damage_per_min",
      derivedNotApplicable("ruleset_has_no_neutral_objective_duty"))
    add("structure_damage_per_min", "damage_per_min",
      derivedNotApplicable("objective_family_not_graded_in_howling_abyss"))
    add("vision_score_per_min", "vision_score_per_min",
      derivedNotApplicable("ruleset_has_no_warding_duty"))
  } else {
    nonnegative("neutral_objective_damage_per_min", neutralObjectiveDamage ?? undefined,
      "damage_per_min", (value) => pace(value, input.durationSecs), "scoreboard",
      input.durationSecs)
    nonnegative("structure_damage_per_min", owner.damageStructures, "damage_per_min",
      (value) => pace(value, input.durationSecs), "scoreboard", input.durationSecs)
    nonnegative("vision_score_per_min", owner.visionScore, "vision_score_per_min",
      (value) => pace(value, input.durationSecs), "scoreboard", input.durationSecs)
  }
  nonnegative("cc_seconds_per_min", owner.timeCcingOthers, "cc_seconds_per_min",
    (value) => pace(value, input.durationSecs), "scoreboard", input.durationSecs)
  nonnegative("ally_heal_shield_per_min", ownerProtection, "health_per_min",
    (value) => pace(value, input.durationSecs), "extended", input.durationSecs)

  nonnegative("champion_damage_per_min", owner.damageToChampions, "damage_per_min",
    (value) => pace(value, input.durationSecs), "scoreboard", input.durationSecs)
  if (!finiteNonnegative(owner.damageToChampions) || !finiteNonnegative(owner.goldEarned)) {
    add("damage_per_1000_gold", "damage_per_1000_gold",
      derivedInvalid("damage_and_gold_must_be_nonnegative"), "derived")
  } else if (owner.goldEarned === 0) {
    add("damage_per_1000_gold", "damage_per_1000_gold",
      derivedInvalid("gold_denominator_must_be_positive"), "derived", {
      numerator: owner.damageToChampions,
      denominator: 0,
    })
  } else {
    add("damage_per_1000_gold", "damage_per_1000_gold",
      derivedObserved(owner.damageToChampions * 1_000 / owner.goldEarned), "derived", {
      numerator: owner.damageToChampions,
      denominator: owner.goldEarned,
    })
  }
  teamShare("gold_share", owner.goldEarned, (entry) => entry.goldEarned,
    "team_earned_no_gold", "derived")
  nonnegative("damage_taken_per_min", owner.damageTaken, "damage_per_min",
    (value) => pace(value, input.durationSecs), "scoreboard", input.durationSecs)
  teamShare("damage_taken_share", owner.damageTaken, (entry) => entry.damageTaken,
    "team_took_no_damage", "derived")
  nonnegative("damage_mitigated_per_min", owner.damageSelfMitigated, "damage_per_min",
    (value) => pace(value, input.durationSecs), "scoreboard", input.durationSecs)
  if (!finiteNonnegative(owner.damageTaken) || !finiteNonnegative(owner.damageSelfMitigated)) {
    add("mitigation_share", "ratio", derivedInvalid("mitigation_values_must_be_nonnegative"),
      "derived")
  } else {
    const denominator = owner.damageSelfMitigated + owner.damageTaken
    add("mitigation_share", "ratio", denominator === 0
      ? derivedNoOpportunity("no_damage_taken_or_mitigated")
      : derivedObserved(owner.damageSelfMitigated / denominator), "derived", {
      numerator: owner.damageSelfMitigated,
      denominator,
      opportunityCount: denominator === 0 ? 0 : 1,
    })
  }

  if (owner.totalTimeSpentDead === undefined) {
    add("time_dead_share", "ratio", derivedUnavailable("total_time_spent_dead_not_captured"),
      "extended")
  } else if (!finiteNonnegative(owner.totalTimeSpentDead) ||
      owner.totalTimeSpentDead > input.durationSecs) {
    add("time_dead_share", "ratio", derivedInvalid("time_dead_must_be_within_match_duration"),
      "extended")
  } else {
    add("time_dead_share", "ratio", derivedObserved(owner.totalTimeSpentDead / input.durationSecs),
      "extended", { numerator: owner.totalTimeSpentDead, denominator: input.durationSecs })
  }

  if (!riftObjectiveEvidence(input.context)) {
    for (const [key, unit] of [
      ["wards_placed_per_min", "wards_per_min"],
      ["wards_killed_per_min", "wards_per_min"],
      ["control_wards_per_min", "wards_per_min"],
      ["detector_wards_placed_per_min", "wards_per_min"],
    ] as const) {
      add(key, unit, derivedNotApplicable("ruleset_has_no_warding_duty"))
    }
  } else {
    nonnegative("wards_placed_per_min", owner.wardsPlaced, "wards_per_min",
      (value) => pace(value, input.durationSecs), "scoreboard", input.durationSecs)
    nonnegative("wards_killed_per_min", owner.wardsKilled, "wards_per_min",
      (value) => pace(value, input.durationSecs), "scoreboard", input.durationSecs)
    nonnegative("control_wards_per_min", owner.controlWardsPurchased, "wards_per_min",
      (value) => pace(value, input.durationSecs), "extended", input.durationSecs)
    nonnegative("detector_wards_placed_per_min", owner.detectorWardsPlaced, "wards_per_min",
      (value) => pace(value, input.durationSecs), "extended", input.durationSecs)
  }

  const teamProtectionComplete = completeLobby && team.length === 5 && team.every((entry) =>
    finiteNonnegative(entry.totalHealsOnTeammates) &&
    finiteNonnegative(entry.totalDamageShieldedOnTeammates))
  if (!teamProtectionComplete || ownerProtection === undefined) {
    add("team_protection_share", "ratio",
      derivedUnavailable("team_protection_requires_complete_extended_source"), "derived")
  } else {
    teamShare("team_protection_share", ownerProtection, (entry) =>
      entry.totalHealsOnTeammates! + entry.totalDamageShieldedOnTeammates!,
    "team_recorded_no_ally_protection", "derived")
  }

  if (!finiteNonnegative(owner.kills) || !finiteNonnegative(owner.assists)) {
    add("kill_share_of_takedowns", "ratio", derivedInvalid("takedowns_must_be_nonnegative"),
      "derived")
  } else {
    const takedowns = owner.kills + owner.assists
    add("kill_share_of_takedowns", "ratio", takedowns === 0
      ? derivedNoOpportunity("player_had_no_takedowns")
      : derivedObserved(owner.kills / takedowns), "derived", {
      numerator: owner.kills,
      denominator: takedowns,
      opportunityCount: takedowns,
    })
  }
  if (!finiteNonnegative(owner.kills) || !finiteNonnegative(owner.assists) ||
      !finiteNonnegative(owner.deaths)) {
    add("kda_pace", "ratio", derivedInvalid("kda_values_must_be_nonnegative"), "derived")
  } else {
    add("kda_pace", "ratio", derivedObserved(
      (owner.kills + owner.assists) / Math.max(1, owner.deaths),
    ), "derived", {
      numerator: owner.kills + owner.assists,
      denominator: Math.max(1, owner.deaths),
    })
  }
  if (!riftObjectiveEvidence(input.context)) {
    add("objective_damage_mix", "ratio",
      derivedNotApplicable("ruleset_has_no_neutral_objective_duty"), "derived")
  } else if (!finiteNonnegative(owner.damageObjectives) ||
      !finiteNonnegative(owner.damageToChampions)) {
    add("objective_damage_mix", "ratio", derivedInvalid("damage_mix_values_must_be_nonnegative"),
      "derived")
  } else {
    const denominator = owner.damageObjectives + owner.damageToChampions
    add("objective_damage_mix", "ratio", denominator === 0
      ? derivedNoOpportunity("player_dealt_no_champion_or_objective_damage")
      : derivedObserved(owner.damageObjectives / denominator), "derived", {
      numerator: owner.damageObjectives,
      denominator,
      opportunityCount: denominator === 0 ? 0 : 1,
    })
  }

  return output
}

export function summaryMetricEvidenceByKey(
  input: SummaryMetricDerivationInput,
): ReadonlyMap<SummaryMetricKey, SummaryMetricObservation> {
  return new Map(deriveSummaryMetricObservations(input).map((entry) => [
    entry.metricKey,
    entry,
  ]))
}
