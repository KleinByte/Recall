import type { ModeFamily } from "./types.js"
import type { Grade, GradeInput } from "./grade.js"
import { CLASS_SCALE } from "./class-expectations.js"
import type { ChampionClass } from "./champion-classes.js"

export const GRADE_V3_ALGORITHM_VERSION = 3

export interface GradeComponentV3 {
  key: string
  label: string
  componentScore: number
  rankPercentile: number
  magnitudeScore: number
  peerCount: number
  comparisonScope: "role" | "lobby"
  metricBasis: "individual" | "team_share"
  weight: number
  contribution: number
}

export interface GradeResultV3 {
  grade: Grade
  gradeScore: number
  compositePercentile: number
  breakdown: {
    algorithmVersion: 3
    compositePercentile: number
    components: GradeComponentV3[]
    omittedComponents: { key: string; reason: string }[]
  }
}

export interface GradeLobbyV3Outcome {
  status: "ready" | "incomplete_lobby" | "missing_core_metric" |
    "unsupported_mode" | "short_game" | "invalid_duration" |
    "terminated" | "ineligible_for_progression" | "unmatched" |
    "bot_or_tutorial" | "missing_source_fact" | "legacy_unknown"
  results: Map<number, GradeResultV3>
  reason?: string
}

const GRADE_WEIGHTS = {
  aram: { combat: .24, participation: .26, economy: .11, survival: .20,
    frontlining: .19, farming: 0, vision: 0, objectives: 0 },
  sr: { combat: .18, participation: .18, economy: .11, survival: .14,
    frontlining: .05, farming: .12, vision: .10, objectives: .12 },
} as const

const THRESHOLDS: [Grade, number][] = [
  ["S+", 1.55], ["S", 1.20], ["S-", .90], ["A+", .65], ["A", .40],
  ["A-", .15], ["B+", -.10], ["B", -.35], ["B-", -.60],
  ["C+", -.90], ["C", -1.15], ["C-", -1.45],
]

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length

export function rankPercentile(values: readonly number[], value: number): number {
  if (values.length < 2) return .5
  const better = values.filter((entry) => entry > value).length
  const tied = values.filter((entry) => entry === value).length
  return (values.length - 1 - better - (tied - 1) / 2) / (values.length - 1)
}

export function magnitudeScore(
  values: readonly number[],
  value: number,
  direction: "normal" | "inverse" = "normal",
): number {
  const average = mean(values)
  if (average <= 0) return .5
  return direction === "normal"
    ? clamp01(value / (2 * average))
    : clamp01(1 - value / (2 * average))
}

export function componentScore(
  values: readonly number[],
  value: number,
  direction: "normal" | "inverse" = "normal",
) {
  const rankedValues = direction === "inverse" ? values.map((entry) => -entry) : values
  const rankedValue = direction === "inverse" ? -value : value
  const rank = rankPercentile(rankedValues, rankedValue)
  const magnitude = magnitudeScore(values, value, direction)
  const reliability = (values.length - 1) / (values.length + 1)
  const adjustedRank = .5 + (rank - .5) * reliability
  return {
    componentScore: .75 * adjustedRank + .25 * magnitude,
    rankPercentile: rank,
    magnitudeScore: magnitude,
    peerCount: values.length,
  }
}

const coreValid = (player: GradeInput) =>
  Number.isSafeInteger(player.participantId) && player.participantId > 0 &&
  Number.isSafeInteger(player.teamId) && player.teamId > 0 &&
  [player.kills, player.deaths, player.assists, player.damageToChampions,
    player.damageTaken, player.goldEarned]
    .every((value) => Number.isSafeInteger(value) && value >= 0)

function lobbyShape(lobby: readonly GradeInput[]) {
  if (lobby.length !== 10 || new Set(lobby.map((player) => player.participantId)).size !== 10) {
    return false
  }
  const teams = new Map<number, number>()
  lobby.forEach((player) => teams.set(player.teamId, (teams.get(player.teamId) ?? 0) + 1))
  return teams.size === 2 && [...teams.values()].every((count) => count === 5) &&
    lobby.filter((player) => player.isPlayer).length === 1
}

const ceiling = (key: string, championClass?: ChampionClass) =>
  (championClass ? CLASS_SCALE[key]?.[championClass] : undefined) ?? 1

type ComponentKey = keyof typeof GRADE_WEIGHTS.sr
interface Metric {
  key: ComponentKey
  label: string
  values: number[]
  direction?: "normal" | "inverse"
  metricBasis?: "individual" | "team_share"
  roleScoped?: boolean
}

function scopeFor(player: GradeInput, lobby: readonly GradeInput[], metric: Metric) {
  if (!metric.roleScoped || !player.role) return { peers: [...lobby], scope: "lobby" as const }
  const opponents = lobby.filter((entry) =>
    entry.teamId !== player.teamId && entry.role === player.role)
  return opponents.length === 1
    ? { peers: [player, opponents[0]], scope: "role" as const }
    : { peers: [...lobby], scope: "lobby" as const }
}

export function gradeLobbyV3(
  lobby: readonly GradeInput[],
  family: ModeFamily,
  forcedStatus?: Exclude<GradeLobbyV3Outcome["status"], "ready">,
): GradeLobbyV3Outcome {
  if (forcedStatus) return { status: forcedStatus, results: new Map() }
  if (family !== "sr" && family !== "aram" && family !== "classic") {
    return { status: "unsupported_mode", results: new Map() }
  }
  if (!lobbyShape(lobby)) return { status: "incomplete_lobby", results: new Map() }
  if (!lobby.every(coreValid)) {
    return { status: "missing_core_metric", results: new Map(), reason: "required_core_field" }
  }

  const baseWeights = family === "sr" || family === "classic"
    ? GRADE_WEIGHTS.sr : GRADE_WEIGHTS.aram
  const teamKills = new Map<number, number>()
  const teamDamage = new Map<number, number>()
  const teamObjectives = new Map<number, number>()
  lobby.forEach((player) => {
    teamKills.set(player.teamId, (teamKills.get(player.teamId) ?? 0) + player.kills)
    teamDamage.set(player.teamId, (teamDamage.get(player.teamId) ?? 0) + player.damageToChampions)
    teamObjectives.set(player.teamId, (teamObjectives.get(player.teamId) ?? 0) + (player.damageObjectives ?? 0))
  })
  const teamValues = <T>(map: Map<number, T>) => [...map.values()]
  const omitted: { key: string; reason: string }[] = []
  const optionalComplete = (key: keyof GradeInput, component: ComponentKey) => {
    const complete = lobby.every((player) =>
      typeof player[key] === "number" && Number.isFinite(player[key]) && (player[key] as number) >= 0)
    if (!complete && baseWeights[component] > 0) omitted.push({ key: component, reason: "unavailable_input" })
    return complete
  }
  const mitigated = optionalComplete("damageMitigated", "frontlining")
  const farming = optionalComplete("csPerMin", "farming")
  const vision = optionalComplete("visionScore", "vision")
  const objectives = optionalComplete("damageObjectives", "objectives")
  const participation = teamValues(teamKills).every((value) => value > 0)
  if (!participation) omitted.push({ key: "participation", reason: "no_opportunity" })
  const damageShare = teamValues(teamDamage).every((value) => value > 0)
  const objectiveOpportunity = objectives && teamValues(teamObjectives).every((value) => value > 0)
  if (objectives && !objectiveOpportunity && baseWeights.objectives > 0) {
    omitted.push({ key: "objectives", reason: "no_opportunity" })
  }

  const kda = lobby.map((player) => (player.kills + player.assists) / (player.deaths + 1))
  const damage = lobby.map((player) => player.damageToChampions /
    (teamDamage.get(player.teamId) ?? 1) / ceiling("damageShare", player.championClass))
  const metrics: Metric[] = [
    { key: "participation", label: "Participation", values: lobby.map((player) =>
      (player.kills + player.assists) / (teamKills.get(player.teamId) ?? 1)), metricBasis: "team_share" },
    { key: "economy", label: "Economy", values: lobby.map((player) => player.goldEarned), roleScoped: baseWeights.farming > 0 },
    { key: "survival", label: "Survival", values: lobby.map((player) => player.deaths), direction: "inverse" },
    { key: "frontlining", label: "Frontlining", values: lobby.map((player) =>
      (player.damageTaken + (player.damageMitigated ?? 0)) / (player.deaths + 1)) },
    { key: "farming", label: "Farming", values: lobby.map((player) => player.csPerMin ?? 0), roleScoped: true },
    { key: "vision", label: "Vision", values: lobby.map((player) => player.visionScore ?? 0), roleScoped: true },
    { key: "objectives", label: "Objectives", values: lobby.map((player) =>
      (player.damageObjectives ?? 0) / (teamObjectives.get(player.teamId) ?? 1) /
      ceiling("objectivePace", player.championClass)), metricBasis: "team_share" },
  ]
  const omitKeys = new Set(omitted.map((entry) => entry.key))
  if (!mitigated) omitKeys.add("frontlining")
  if (!farming) omitKeys.add("farming")
  if (!vision) omitKeys.add("vision")
  if (!objectiveOpportunity) omitKeys.add("objectives")
  if (!participation) omitKeys.add("participation")
  const activeWeight = (Object.keys(baseWeights) as ComponentKey[])
    .filter((key) => baseWeights[key] > 0 && !omitKeys.has(key))
    .reduce((sum, key) => sum + baseWeights[key], 0)

  const allComponents = lobby.map((player, playerIndex) => {
    const combatKda = componentScore(kda, kda[playerIndex])
    const combatDamage = damageShare ? componentScore(damage, damage[playerIndex]) : undefined
    const combatParts = combatDamage ? [combatKda, combatDamage] : [combatKda]
    const combat = {
      key: "combat", label: "Combat",
      componentScore: mean(combatParts.map((part) => part.componentScore)),
      rankPercentile: mean(combatParts.map((part) => part.rankPercentile)),
      magnitudeScore: mean(combatParts.map((part) => part.magnitudeScore)),
      peerCount: 10, comparisonScope: "lobby" as const,
      metricBasis: "individual" as const,
    }
    const resolved = metrics.filter((metric) => !omitKeys.has(metric.key))
      .map((metric) => {
        const scoped = scopeFor(player, lobby, metric)
        const indices = scoped.peers.map((peer) => lobby.indexOf(peer))
        const values = indices.map((index) => metric.values[index])
        const score = componentScore(values, metric.values[playerIndex], metric.direction)
        return {
          key: metric.key, label: metric.label, ...score,
          comparisonScope: scoped.scope,
          metricBasis: metric.metricBasis ?? "individual" as const,
        }
      })
    return [combat, ...resolved].map((component) => {
      const weight = baseWeights[component.key as ComponentKey] / activeWeight
      return { ...component, weight, contribution: component.componentScore * weight }
    }) as GradeComponentV3[]
  })

  const composites = allComponents.map((components) =>
    components.reduce((sum, component) => sum + component.contribution, 0))
  const average = mean(composites)
  const deviation = Math.sqrt(mean(composites.map((value) => (value - average) ** 2)))
  const results = new Map<number, GradeResultV3>()
  lobby.forEach((player, index) => {
    const gradeScore = deviation < 1e-10 ? 0 : (composites[index] - average) / deviation
    const grade = THRESHOLDS.find(([, minimum]) => gradeScore >= minimum)?.[0] ?? "D"
    const compositePercentile = rankPercentile(composites, composites[index])
    results.set(player.participantId, {
      grade, gradeScore, compositePercentile,
      breakdown: {
        algorithmVersion: 3,
        compositePercentile,
        components: allComponents[index],
        omittedComponents: omitted,
      },
    })
  })
  return { status: "ready", results }
}

export function gradeLobbyBoth(lobby: GradeInput[], family: ModeFamily) {
  // Imported lazily by the orchestrator's callers to make both versions explicit.
  return { v3: gradeLobbyV3(lobby, family) }
}
