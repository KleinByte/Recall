/**
 * A transparent, role-aware post-game performance grade.
 *
 * Inspired by the useful part of Mobalytics' GPI approach, this does not let
 * one noisy stat (usually KDA or damage) decide a game. Every player is
 * scored on several contributions, those scores are blended by mode, and the
 * resulting grade is relative to the ten people who played that game.
 *
 * Version 2 fixes the classic weakness of pure rank aggregation (a Borda
 * count discards how far apart players actually were) by blending each
 * component's lobby rank with the size of the lead, smooths KDA with a
 * Bayesian one-death prior, and measures damage and objective shares against
 * each champion class's own ceiling so tanks and supports are not punished
 * for doing their job.
 */

import type { ModeFamily } from "./types.js"
import type { ChampionClass } from "./champion-classes.js"
import { CLASS_SCALE } from "./class-expectations.js"
import type { GradeBreakdown, GradeComponent } from "../review/types.js"

export const GRADE_ALGORITHM_VERSION = 2

export const GRADES = [
  "S+", "S", "S-", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D",
] as const

export type Grade = (typeof GRADES)[number]

export interface GradeInput {
  participantId: number
  teamId: number
  kills: number
  deaths: number
  assists: number
  damageToChampions: number
  damageTaken: number
  goldEarned: number
  csPerMin?: number
  visionScore?: number
  damageObjectives?: number
  /** Self-mitigated damage; folded into frontlining when available. */
  damageMitigated?: number
  /** Primary Riot class tag; scales damage and objective expectations. */
  championClass?: ChampionClass
  role?: string
}

export interface GradeResult {
  grade: Grade
  /** Standard deviations from this lobby's average composite score. */
  score: number
  /** Lobby percentile of the same composite used to derive the letter. */
  percentile: number
  breakdown: GradeBreakdown
}

interface Weights {
  combat: number
  participation: number
  economy: number
  survival: number
  frontlining: number
  farming: number
  vision: number
  objectives: number
}

const ARAM_WEIGHTS: Weights = {
  combat: 0.24,
  participation: 0.26,
  economy: 0.11,
  survival: 0.2,
  frontlining: 0.19,
  farming: 0,
  vision: 0,
  objectives: 0,
}

const RIFT_WEIGHTS: Weights = {
  combat: 0.18,
  participation: 0.18,
  economy: 0.11,
  survival: 0.14,
  frontlining: 0.05,
  farming: 0.12,
  vision: 0.1,
  objectives: 0.12,
}

const THRESHOLDS: [Grade, number][] = [
  ["S+", 1.55], ["S", 1.2], ["S-", 0.9], ["A+", 0.65], ["A", 0.4],
  ["A-", 0.15], ["B+", -0.1], ["B", -0.35], ["B-", -0.6],
  ["C+", -0.9], ["C", -1.15], ["C-", -1.45],
]

const share = (value: number, total: number) => total > 0 ? value / total : 0
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length

/** Percentile rank with ties kept fair: 1 is best and 0 is last. */
function percentile(values: number[], value: number): number {
  if (values.length < 2) return 0.5
  const better = values.filter((entry) => entry > value).length
  const tied = values.filter((entry) => entry === value).length
  return (values.length - 1 - better - (tied - 1) / 2) / (values.length - 1)
}

/**
 * Rank blended with how large the value is against twice the group average.
 * Rank alone (a Borda-style aggregation) treats a 2% damage lead the same as
 * a 20% one and turns two-peer role groups into a coin flip; the magnitude
 * term keeps the size of the lead in the composite.
 */
const RANK_WEIGHT = 0.75
const MAGNITUDE_WEIGHT = 0.25

function scored(values: number[], value: number): number {
  const average = mean(values)
  const size = average <= 0 ? 0.5 : clamp01(value / (2 * average))
  return RANK_WEIGHT * percentile(values, value) + MAGNITUDE_WEIGHT * size
}

/** Lower-is-better variant for deaths. */
function scoredInverse(values: number[], value: number): number {
  const average = mean(values)
  const size = average <= 0 ? 0.5 : clamp01(1 - value / (2 * average))
  return RANK_WEIGHT * percentile(values.map((entry) => -entry), -value) +
    MAGNITUDE_WEIGHT * size
}

/** The class's expected ceiling for a metric; unknown classes stay neutral. */
function ceiling(key: string, championClass?: ChampionClass): number {
  return (championClass ? CLASS_SCALE[key]?.[championClass] : undefined) ?? 1
}

/**
 * Roles are only used for work whose expected output changes radically by
 * lane: farm, vision, and gold. Combat is deliberately measured lobby-wide so
 * a strong support or tank can still stand out. Reports the scope actually
 * used, because a lobby without role data falls back to lobby-wide peers.
 */
function roleScored(
  player: GradeInput,
  lobby: GradeInput[],
  get: (entry: GradeInput) => number,
): { score: number; scope: "role" | "lobby" } {
  const peers = player.role
    ? lobby.filter((entry) => entry.role === player.role)
    : []
  const scoped = peers.length >= 2
  const values = (scoped ? peers : lobby).map(get)
  return { score: scored(values, get(player)), scope: scoped ? "role" : "lobby" }
}

function componentValues(
  player: GradeInput,
  lobby: GradeInput[],
  weights: Weights,
): GradeComponent[] {
  const teamKills = new Map<number, number>()
  const teamDamage = new Map<number, number>()
  const teamObjectives = new Map<number, number>()
  for (const entry of lobby) {
    teamKills.set(entry.teamId, (teamKills.get(entry.teamId) ?? 0) + entry.kills)
    teamDamage.set(entry.teamId, (teamDamage.get(entry.teamId) ?? 0) + entry.damageToChampions)
    teamObjectives.set(entry.teamId, (teamObjectives.get(entry.teamId) ?? 0) + (entry.damageObjectives ?? 0))
  }

  // KDA rewards clean fighting, while kill participation prevents an AFK
  // teammate from grading well after landing a couple of late kills. The
  // one-death prior (a Bayesian average toward a single death) smooths
  // deathless games without the old 0.5-death cliff.
  const kdaOf = (entry: GradeInput) =>
    (entry.kills + entry.assists) / (entry.deaths + 1)
  // Shares are judged against the champion class's own ceiling, so a tank's
  // 15% damage share can rank alongside a marksman's 28%.
  const damageShareOf = (entry: GradeInput) =>
    share(entry.damageToChampions, teamDamage.get(entry.teamId) ?? 0) /
      ceiling("damageShare", entry.championClass)
  const participationOf = (entry: GradeInput) =>
    share(entry.kills + entry.assists, teamKills.get(entry.teamId) ?? 0)
  const objectiveShareOf = (entry: GradeInput) =>
    share(entry.damageObjectives ?? 0, teamObjectives.get(entry.teamId) ?? 0) /
      ceiling("objectivePace", entry.championClass)
  // Pressure absorbed per life: soaking damage only counts while staying
  // alive, so a feeding squishy no longer outranks a disciplined tank.
  const pressureOf = (entry: GradeInput) =>
    (entry.damageTaken + (entry.damageMitigated ?? 0)) / (entry.deaths + 1)

  // KDA and damage share are ranked separately so an unbounded ratio cannot
  // drown out the bounded share, then blended evenly.
  const combat =
    scored(lobby.map(kdaOf), kdaOf(player)) * 0.5 +
    scored(lobby.map(damageShareOf), damageShareOf(player)) * 0.5

  const participation = scored(lobby.map(participationOf), participationOf(player))
  // Support income is intentionally lower than a carry's. On the Rift, assess
  // economy within the job instead of rewarding a support for taking minions
  // that belonged to their laner.
  const economy = weights.farming > 0
    ? roleScored(player, lobby, (entry) => entry.goldEarned)
    : {
        score: scored(lobby.map((entry) => entry.goldEarned), player.goldEarned),
        scope: "lobby" as const,
      }
  const survival = scoredInverse(lobby.map((entry) => entry.deaths), player.deaths)
  const frontlining = scored(lobby.map(pressureOf), pressureOf(player))
  const farming = roleScored(player, lobby, (entry) => entry.csPerMin ?? 0)
  const vision = roleScored(player, lobby, (entry) => entry.visionScore ?? 0)
  const objectives = scored(lobby.map(objectiveShareOf), objectiveShareOf(player))

  const values: Array<[GradeComponent["key"], string, number, GradeComponent["scope"]]> = [
    ["combat", "Combat", combat, "lobby"],
    ["participation", "Participation", participation, "team"],
    ["economy", "Economy", economy.score, economy.scope],
    ["survival", "Survival", survival, "lobby"],
    ["frontlining", "Frontlining", frontlining, "lobby"],
    ["farming", "Farming", farming.score, farming.scope],
    ["vision", "Vision", vision.score, vision.scope],
    ["objectives", "Objectives", objectives, "team"],
  ]

  return values.flatMap(([key, label, value, scope]) => {
    const weight = weights[key]
    return weight === 0
      ? []
      : [{
          key,
          label,
          percentile: value,
          weight,
          contribution: value * weight,
          scope,
        }]
  })
}

function composite(components: GradeComponent[]): number {
  return components.reduce((sum, component) => sum + component.contribution, 0)
}

/** Grades the complete lobby at once so every scoreboard row stays consistent. */
export function gradeLobby(lobby: GradeInput[], family: ModeFamily): Map<number, GradeResult> {
  if (lobby.length < 10) return new Map()

  const weights = family === "sr" || family === "classic" ? RIFT_WEIGHTS : ARAM_WEIGHTS
  const components = lobby.map((player) => componentValues(player, lobby, weights))
  const raw = components.map(composite)
  const mean = raw.reduce((sum, value) => sum + value, 0) / raw.length
  const deviation = Math.sqrt(raw.reduce((sum, value) => sum + (value - mean) ** 2, 0) / raw.length)

  return new Map(lobby.map((player, index) => {
    // Floating-point arithmetic can leave a microscopic spread in a tied
    // lobby. It is still a tie, not a random C/D split.
    const score = deviation < 1e-10 ? 0 : (raw[index] - mean) / deviation
    const grade = THRESHOLDS.find(([, minimum]) => score >= minimum)?.[0] ?? "D"
    const compositePercentile = percentile(raw, raw[index])
    return [player.participantId, {
      grade,
      score,
      percentile: compositePercentile,
      breakdown: {
        algorithmVersion: GRADE_ALGORITHM_VERSION,
        compositePercentile,
        components: components[index],
      },
    }]
  }))
}

export function gradeMatch(lobby: GradeInput[], participantId: number, family: ModeFamily): GradeResult | undefined {
  return gradeLobby(lobby, family).get(participantId)
}
