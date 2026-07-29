/**
 * A transparent, role-aware post-game performance grade.
 *
 * Inspired by the useful part of Mobalytics' GPI approach, this does not let
 * one noisy stat (usually KDA or damage) decide a game. Every player is
 * ranked on several contributions, those ranks are blended by mode, and the
 * resulting grade is relative to the ten people who played that game.
 */

import type { ModeFamily } from "./types.js"

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
  role?: string
}

export interface GradeResult {
  grade: Grade
  /** Standard deviations from this lobby's average composite score. */
  score: number
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
  combat: 0.22,
  participation: 0.23,
  economy: 0.1,
  survival: 0.18,
  frontlining: 0.17,
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

/** Percentile rank with ties kept fair: 1 is best and 0 is last. */
function percentile(values: number[], value: number): number {
  if (values.length < 2) return 0.5
  const better = values.filter((entry) => entry > value).length
  const tied = values.filter((entry) => entry === value).length
  return (values.length - 1 - better - (tied - 1) / 2) / (values.length - 1)
}

/**
 * Roles are only used for work whose expected output changes radically by
 * lane: farm and vision. Combat is deliberately measured lobby-wide so a
 * strong support or tank can still stand out.
 */
function rolePercentile(
  player: GradeInput,
  lobby: GradeInput[],
  get: (entry: GradeInput) => number,
): number {
  const peers = player.role
    ? lobby.filter((entry) => entry.role === player.role)
    : lobby
  return percentile(peers.length >= 2 ? peers.map(get) : lobby.map(get), get(player))
}

function composite(player: GradeInput, lobby: GradeInput[], weights: Weights): number {
  const team = lobby.filter((entry) => entry.teamId === player.teamId)
  const teamKills = team.reduce((sum, entry) => sum + entry.kills, 0)
  const teamDamage = team.reduce((sum, entry) => sum + entry.damageToChampions, 0)
  const teamObjectives = team.reduce((sum, entry) => sum + (entry.damageObjectives ?? 0), 0)

  // KDA rewards clean fighting, while kill participation prevents an AFK
  // teammate from grading well after landing a couple of late kills.
  const kda = (player.kills + player.assists) / Math.max(0.5, player.deaths)
  const participation = share(player.kills + player.assists, teamKills)
  const damageShare = share(player.damageToChampions, teamDamage)
  const objectiveShare = share(player.damageObjectives ?? 0, teamObjectives)

  const combat = percentile(lobby.map((entry) =>
    (entry.kills + entry.assists) / Math.max(0.5, entry.deaths) +
      share(entry.damageToChampions, entry.teamId === player.teamId ? teamDamage : lobby.filter((p) => p.teamId === entry.teamId).reduce((sum, p) => sum + p.damageToChampions, 0)) * 4,
  ), kda + damageShare * 4)

  return (
    weights.combat * combat +
    weights.participation * percentile(lobby.map((entry) => {
      const kills = lobby.filter((p) => p.teamId === entry.teamId).reduce((sum, p) => sum + p.kills, 0)
      return share(entry.kills + entry.assists, kills)
    }), participation) +
    // Support income is intentionally lower than a carry's. On the Rift,
    // assess economy within the job instead of rewarding a support for taking
    // minions that belonged to their laner.
    weights.economy * (weights.farming > 0
      ? rolePercentile(player, lobby, (entry) => entry.goldEarned)
      : percentile(lobby.map((entry) => entry.goldEarned), player.goldEarned)) +
    weights.survival * percentile(lobby.map((entry) => -entry.deaths), -player.deaths) +
    weights.frontlining * percentile(lobby.map((entry) => entry.damageTaken), player.damageTaken) +
    weights.farming * rolePercentile(player, lobby, (entry) => entry.csPerMin ?? 0) +
    weights.vision * rolePercentile(player, lobby, (entry) => entry.visionScore ?? 0) +
    weights.objectives * percentile(lobby.map((entry) => {
      const total = lobby.filter((p) => p.teamId === entry.teamId).reduce((sum, p) => sum + (p.damageObjectives ?? 0), 0)
      return share(entry.damageObjectives ?? 0, total)
    }), objectiveShare)
  )
}

/** Grades the complete lobby at once so every scoreboard row stays consistent. */
export function gradeLobby(lobby: GradeInput[], family: ModeFamily): Map<number, GradeResult> {
  if (lobby.length < 10) return new Map()

  const weights = family === "sr" ? RIFT_WEIGHTS : ARAM_WEIGHTS
  const raw = lobby.map((player) => composite(player, lobby, weights))
  const mean = raw.reduce((sum, value) => sum + value, 0) / raw.length
  const deviation = Math.sqrt(raw.reduce((sum, value) => sum + (value - mean) ** 2, 0) / raw.length)

  return new Map(lobby.map((player, index) => {
    // Floating-point arithmetic can leave a microscopic spread in a tied
    // lobby. It is still a tie, not a random C/D split.
    const score = deviation < 1e-10 ? 0 : (raw[index] - mean) / deviation
    const grade = THRESHOLDS.find(([, minimum]) => score >= minimum)?.[0] ?? "D"
    return [player.participantId, { grade, score }]
  }))
}

export function gradeMatch(lobby: GradeInput[], participantId: number, family: ModeFamily): GradeResult | undefined {
  return gradeLobby(lobby, family).get(participantId)
}
