/**
 * Performance grading for a single game.
 *
 * Riot does not expose a grade through the local client API, so Recall derives
 * one by comparing a player against the others in the same game. Grading within
 * the lobby keeps the result meaningful without inventing absolute thresholds,
 * and it adapts automatically to short games, stomps and the inflated numbers
 * that ARAM produces.
 */

import type { ModeFamily } from "./types.js"

export const GRADES = [
  "S+",
  "S",
  "S-",
  "A+",
  "A",
  "A-",
  "B+",
  "B",
  "B-",
  "C+",
  "C",
  "C-",
  "D",
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
  /** Summoner's Rift only; ignored for ARAM. */
  csPerMin?: number
  visionScore?: number
  damageObjectives?: number
  role?: string
}

export interface GradeResult {
  grade: Grade
  /** Standard deviations from the comparison group's average. */
  score: number
}

/**
 * Cut-offs in standard deviations above the comparison group's average.
 *
 * An average game lands on B+, which matches how players read these letters:
 * B is unremarkable, A is good, S is exceptional.
 */
const THRESHOLDS: [Grade, number][] = [
  ["S+", 1.6],
  ["S", 1.25],
  ["S-", 0.95],
  ["A+", 0.7],
  ["A", 0.45],
  ["A-", 0.2],
  ["B+", -0.05],
  ["B", -0.3],
  ["B-", -0.55],
  ["C+", -0.85],
  ["C", -1.15],
  ["C-", -1.5],
]

interface Weights {
  kda: number
  killParticipation: number
  damage: number
  damageTaken: number
  goldEfficiency: number
  csPerMin: number
  vision: number
  objectives: number
}

/**
 * ARAM is a continuous teamfight with no farming or vision game, so the
 * meaningful axes are fight participation, damage output, and how much
 * punishment a player absorbs for the team.
 */
const ARAM_WEIGHTS: Weights = {
  kda: 0.3,
  killParticipation: 0.25,
  damage: 0.25,
  damageTaken: 0.1,
  goldEfficiency: 0.1,
  csPerMin: 0,
  vision: 0,
  objectives: 0,
}

/**
 * Summoner's Rift rewards farming, vision and objectives, so those carry real
 * weight and combat is proportionally less dominant.
 */
const RIFT_WEIGHTS: Weights = {
  kda: 0.25,
  killParticipation: 0.2,
  damage: 0.2,
  damageTaken: 0.05,
  goldEfficiency: 0.1,
  csPerMin: 0.1,
  vision: 0.05,
  objectives: 0.05,
}

/**
 * Roles come in pairs in a standard lobby — one per team — so a role group is
 * usually just the player and their opposite number.
 */
const MIN_ROLE_GROUP = 2

const share = (value: number, total: number) => (total <= 0 ? 0 : value / total)

/**
 * Expresses a role-sensitive statistic relative to others in the same role.
 *
 * A support farms a fraction of what a mid laner does, so scoring raw creep
 * score would mark every support down for playing their role correctly.
 * Dividing by the role's own average asks the only fair question: how did this
 * player do compared to others doing the same job?
 *
 * Falls back to the raw value when the payload carries no usable role data.
 */
function roleRelative(
  player: GradeInput,
  lobby: GradeInput[],
  select: (entry: GradeInput) => number,
): number {
  const value = select(player)

  if (!player.role) return value

  const peers = lobby.filter((entry) => entry.role === player.role)
  if (peers.length < MIN_ROLE_GROUP) return value

  const mean =
    peers.reduce((sum, entry) => sum + select(entry), 0) / peers.length

  // A role that produced nothing at all gives no basis for comparison.
  return mean <= 0 ? 0 : value / mean
}

function rawScore(
  player: GradeInput,
  lobby: GradeInput[],
  weights: Weights,
): number {
  const team = lobby.filter((entry) => entry.teamId === player.teamId)

  const teamKills = team.reduce((sum, entry) => sum + entry.kills, 0)
  const teamDamage = team.reduce(
    (sum, entry) => sum + entry.damageToChampions,
    0,
  )
  const teamDamageTaken = team.reduce((sum, entry) => sum + entry.damageTaken, 0)
  const teamObjectives = team.reduce(
    (sum, entry) => sum + (entry.damageObjectives ?? 0),
    0,
  )

  // Deaths of zero would divide by zero, and treating them as a full death
  // understates a flawless game, so half a death is used instead.
  const kda = (player.kills + player.assists) / Math.max(0.5, player.deaths)

  const killParticipation = share(player.kills + player.assists, teamKills)
  const goldEfficiency = share(player.damageToChampions, player.goldEarned)

  // Farming and warding are judged against the same role; combat and
  // objectives are compared across the whole team.
  const relativeCs = roleRelative(player, lobby, (e) => e.csPerMin ?? 0)
  const relativeVision = roleRelative(player, lobby, (e) => e.visionScore ?? 0)

  return (
    weights.kda * kda +
    weights.killParticipation * killParticipation * 10 +
    weights.damage * share(player.damageToChampions, teamDamage) * 10 +
    weights.damageTaken * share(player.damageTaken, teamDamageTaken) * 10 +
    weights.goldEfficiency * goldEfficiency +
    weights.csPerMin * relativeCs * 5 +
    weights.vision * relativeVision * 5 +
    weights.objectives * share(player.damageObjectives ?? 0, teamObjectives) * 10
  )
}

/**
 * Grades one participant against the rest of their game.
 *
 * The whole lobby is always the statistical baseline; role only affects how
 * role-sensitive statistics are normalised. Restricting the baseline itself to
 * a role would leave two players in most groups, which is too few to produce a
 * meaningful spread.
 *
 * Returns `undefined` when the lobby is incomplete or the player is absent,
 * so callers can store no grade rather than a misleading one.
 */
export function gradeMatch(
  lobby: GradeInput[],
  participantId: number,
  family: ModeFamily,
): GradeResult | undefined {
  if (lobby.length < 10) return undefined

  const player = lobby.find((entry) => entry.participantId === participantId)
  if (!player) return undefined

  const weights = family === "sr" ? RIFT_WEIGHTS : ARAM_WEIGHTS

  const scores = lobby.map((entry) => rawScore(entry, lobby, weights))
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length

  const variance =
    scores.reduce((sum, value) => sum + (value - mean) ** 2, 0) / scores.length
  const deviation = Math.sqrt(variance)

  const index = lobby.findIndex(
    (entry) => entry.participantId === participantId,
  )

  // With no spread at all every player performed identically, which is an
  // average game by definition.
  const score = deviation === 0 ? 0 : (scores[index] - mean) / deviation

  const matched = THRESHOLDS.find(([, minimum]) => score >= minimum)

  return { grade: matched ? matched[0] : "D", score }
}
