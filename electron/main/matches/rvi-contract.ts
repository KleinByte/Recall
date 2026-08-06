import type { Evidence } from "../../../src/shared/measurement.js"

export const RVI_ALGORITHM_VERSION = 3
export const RVI_HEADLINE_COVERAGE_GATE = .80
export const RVI_STABILIZATION_GAMES = 12

export const RVI_RAW_SCALES = {
  damageShare: .35,
  kdaPace: 5,
  ccPace: 12,
  goldPace: { sr: 550, classic: 550, aram: 650 },
  csPace: { sr: 10, classic: 10, aram: 5 },
  objectivePace: 350,
  visionPace: 2,
  killParticipation: .75,
  allySupport: 300,
} as const

export const RVI_CLASS_SCALE = {
  damageShare: { assassin: .9, fighter: .85, tank: .65, support: .55 },
  kdaPace: { fighter: .9, tank: .8 },
  deathRate: { fighter: 1.1, tank: 1.2 },
  goldPace: { tank: .9, support: .7 },
  csPace: { tank: .85, support: .4 },
  objectivePace: { marksman: 1.15, assassin: .9, mage: .8, tank: .75, support: .5 },
  visionPace: { support: 1.25, mage: .85, marksman: .75, assassin: .75 },
  ccPace: { tank: 1.15, fighter: .75, mage: .65, assassin: .45, marksman: .35 },
  allySupport: { support: 1, tank: .5, mage: .5, fighter: .4, assassin: .4, marksman: .4 },
} as const

export const RVI_DIMENSION_WEIGHTS = {
  rift: {
    Fighting: { combat: .24, participation: .14, damageShare: .14, kdaPace: .12,
      duels: .12, skirmishes: .12, teamfights: .08, picks: .04 },
    Survivability: { survival: .38, frontlining: .18, deathRate: .16, durability: .12,
      deathRisk: .08, pickSafety: .08, soloSafety: .08, teamfightSafety: .08, gankSafety: .10 },
    Objectives: { objectives: .48, objectivePace: .22, objectiveFocus: .14,
      objectiveParticipation: .10, structures: .06, dragons: .08, barons: .08,
      heralds: .08, objectiveSecure: .06, objectiveVision: .06, baronConversion: .06 },
    Farming: { economy: .30, farming: .28, goldPace: .16, csPace: .14,
      laneLead: .12, earlyFarm: .10, midFarm: .08, lateFarm: .06 },
    Vision: { vision: .60, visionPace: .20, visionPlacement: .10, visionDenial: .10 },
    Initiative: { participation: .25, combat: .20, aggression: .12, earlyActivity: .16,
      forwardKills: .12, fightFrequency: .15, earlyRoams: .12,
      soloPressure: .08, laneSnowball: .09 },
  },
  aram: {
    Fighting: { combat: .34, participation: .22, damageShare: .18, kdaPace: .12, teamfights: .14 },
    Survivability: { survival: .46, frontlining: .22, deathRate: .18, durability: .14 },
    Resources: { economy: .55, goldPace: .25, csPace: .20 },
    "Team Presence": { participation: .42, frontlining: .18, killParticipation: .20, allySupport: .20 },
    Sustain: { sustain: .55, allySupport: .25, survival: .20 },
    "Fight Control": { teamfighting: .50, ccPace: .25, participation: .25 },
  },
} as const

export type RviFamily = "sr" | "classic" | "aram"

export const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

export function scaleRviMetric(
  value: number,
  base: number,
  classMultiplier = 1,
): number {
  return clamp01(value / (base * classMultiplier))
}

export interface RviMetricAggregate {
  state: "observed" | "unavailable" | "invalid" | "unknown" |
    "not_applicable" | "no_opportunity"
  mean: number | null
  observedGames: number
  applicableEligibleGames: number
  metricCoverage: number | null
}

export function aggregateRviMetric(values: readonly Evidence<number>[]): RviMetricAggregate {
  const applicable = values.filter((value) =>
    value.state !== "not_applicable" && value.state !== "no_opportunity")
  const observed = applicable.filter((value): value is Evidence<number> & { state: "observed"; value: number } =>
    value.state === "observed" && Number.isFinite(value.value))
  if (applicable.length === 0) {
    const state = values.some((value) => value.state === "no_opportunity")
      ? "no_opportunity" : "not_applicable"
    return { state, mean: null, observedGames: 0, applicableEligibleGames: 0, metricCoverage: null }
  }
  const fallback = applicable.find((value) => value.state !== "observed")?.state
  return {
    state: observed.length ? "observed" : fallback === "invalid" ? "invalid" :
      fallback === "unknown" ? "unknown" : "unavailable",
    mean: observed.length
      ? observed.reduce((sum, value) => sum + value.value, 0) / observed.length
      : null,
    observedGames: observed.length,
    applicableEligibleGames: applicable.length,
    metricCoverage: observed.length / applicable.length,
  }
}

export interface RviDimensionMetric extends RviMetricAggregate {
  key: string
  baseWeight: number
}

export interface RviDimensionAggregate {
  dimensionCoverage: number
  availableWeight: number
  dimensionRaw: number | null
  nEff: number | null
  displayScore: number | null
  confidence: "learning" | "provisional" | "established" | null
}

export function aggregateRviDimension(metrics: readonly RviDimensionMetric[]): RviDimensionAggregate {
  const coverageMetrics = metrics.filter((metric) => metric.metricCoverage !== null)
  const coverageWeight = coverageMetrics.reduce((sum, metric) => sum + metric.baseWeight, 0)
  const dimensionCoverage = coverageWeight === 0 ? 0 : coverageMetrics.reduce(
    (sum, metric) => sum + metric.baseWeight * metric.metricCoverage!, 0) / coverageWeight
  const effective = metrics.map((metric) => ({
    ...metric,
    effectiveWeight: metric.mean === null || metric.metricCoverage === null
      ? 0 : metric.baseWeight * metric.metricCoverage,
  }))
  const availableWeight = effective.reduce((sum, metric) => sum + metric.effectiveWeight, 0)
  if (availableWeight === 0) {
    return { dimensionCoverage, availableWeight, dimensionRaw: null, nEff: null,
      displayScore: null, confidence: null }
  }
  const dimensionRaw = effective.reduce((sum, metric) =>
    sum + (metric.mean ?? 0) * metric.effectiveWeight, 0) / availableWeight
  const nEff = effective.reduce((sum, metric) =>
    sum + metric.effectiveWeight / availableWeight * metric.observedGames, 0)
  const displayScore = 50 + (dimensionRaw * 100 - 50) * nEff /
    (nEff + RVI_STABILIZATION_GAMES)
  return {
    dimensionCoverage, availableWeight, dimensionRaw, nEff, displayScore,
    confidence: nEff >= 30 ? "established" : nEff >= 10 ? "provisional" : "learning",
  }
}

export function aggregateRviHeadline(dimensions: readonly RviDimensionAggregate[]) {
  const overallCoverage = dimensions.reduce((sum, value) => sum + value.dimensionCoverage, 0) /
    dimensions.length
  const complete = dimensions.length === 6 && dimensions.every((value) => value.displayScore !== null)
  const headlineNEff = complete ? Math.min(...dimensions.map((value) => value.nEff!)) : null
  // Decimal coverage values such as six exact 0.8 dimensions can sum to the
  // immediately-adjacent floating-point value below 0.8. Treat only that
  // representation artifact as the inclusive boundary promised by the
  // contract; materially lower values remain gated.
  const meetsCoverageGate = overallCoverage + Number.EPSILON >= RVI_HEADLINE_COVERAGE_GATE
  const score = complete && meetsCoverageGate
    ? dimensions.reduce((sum, value) => sum + value.displayScore!, 0) / 6
    : null
  return { score, overallCoverage, headlineNEff, label: score === null ? "Building profile" : "Recall heuristic" }
}

export interface FightKillEvent {
  timestamp: number
  originalEventIndex: number
  killerId: number
  victimId: number
  assistingParticipantIds: number[]
  victimPosition?: { x: number; y: number }
}

export interface FightCluster {
  events: FightKillEvent[]
  participants: number[]
  classification: "duel" | "skirmish" | "teamfight"
  pick: boolean
}

export type RiftLane = "TOP" | "MIDDLE" | "BOTTOM"
export type Point = { x: number; y: number }

/** Frozen map-11 lane regions used by the existing timeline label mapper. */
export function riftLaneAt(point: Point): RiftLane | undefined {
  const { x, y } = point
  if ((x <= 3_000 && y >= 4_000) || (y >= 12_000 && x <= 11_000)) return "TOP"
  if ((y <= 3_000 && x >= 4_000) || (x >= 12_000 && y <= 11_000)) return "BOTTOM"
  if (x >= 2_000 && x <= 13_000 && y >= 2_000 && y <= 13_000 && Math.abs(x - y) <= 1_600) {
    return "MIDDLE"
  }
  return undefined
}

export interface RoamProxyInput {
  timestamp: number
  ownerPosition?: Point
  ownerRole: RiftLane
  opponentParticipantId: number
  enemyParticipantIds: readonly number[]
}

export function qualifiesAsEarlyRoam(input: RoamProxyInput): Evidence<boolean> {
  if (!input.ownerPosition || !Number.isFinite(input.timestamp) ||
      !Number.isSafeInteger(input.opponentParticipantId) ||
      input.enemyParticipantIds.some((id) => !Number.isSafeInteger(id))) {
    return { state: "unavailable", reason: "incomplete_roam_evidence" }
  }
  if (input.timestamp >= 15 * 60_000) return { state: "not_applicable" }
  const outsideLane = riftLaneAt(input.ownerPosition) !== input.ownerRole
  const nonLaneOpponent = input.enemyParticipantIds.some((id) => id !== input.opponentParticipantId)
  return { state: "observed", value: outsideLane && nonLaneOpponent, source: "derived" }
}

export function isWithinObjectiveProximity(
  ownerPosition: Point | undefined,
  objectivePosition: Point | undefined,
  frameTimestamp: number,
  objectiveTimestamp: number,
): Evidence<boolean> {
  if (!ownerPosition || !objectivePosition || !Number.isFinite(frameTimestamp) ||
      !Number.isFinite(objectiveTimestamp)) {
    return { state: "unavailable", reason: "incomplete_objective_position_evidence" }
  }
  return { state: "observed", value:
    Math.abs(frameTimestamp - objectiveTimestamp) <= 60_000 &&
    Math.hypot(ownerPosition.x - objectivePosition.x, ownerPosition.y - objectivePosition.y) <= 1_500,
    source: "derived" }
}

export interface SetupWardInput {
  objectiveTimestamp: number
  objectiveTeamId: number
  ownerTeamId: number
  objectivePosition?: Point
  wardTimestamp: number
  wardPosition?: Point
  wardAction: "placed" | "killed" | "purchased"
}

export function qualifiesAsObjectiveSetupWard(input: SetupWardInput): Evidence<boolean> {
  if (!input.objectivePosition || !input.wardPosition ||
      !Number.isFinite(input.objectiveTimestamp) || !Number.isFinite(input.wardTimestamp)) {
    return { state: "unavailable", reason: "incomplete_setup_ward_position_evidence" }
  }
  const lead = input.objectiveTimestamp - input.wardTimestamp
  const distance = Math.hypot(
    input.objectivePosition.x - input.wardPosition.x,
    input.objectivePosition.y - input.wardPosition.y,
  )
  return { state: "observed", value:
    input.objectiveTeamId === input.ownerTeamId &&
    input.wardAction !== "purchased" && lead >= 30_000 && lead <= 90_000 && distance <= 1_500,
    source: "derived" }
}

export function clusterFights(events: readonly FightKillEvent[]): Evidence<FightCluster[]> {
  if (events.some((event) => !Number.isFinite(event.timestamp) || !event.victimPosition ||
      !Number.isSafeInteger(event.killerId) || !Number.isSafeInteger(event.victimId) ||
      !Array.isArray(event.assistingParticipantIds))) {
    return { state: "unavailable", reason: "incomplete_spatial_fight_evidence" }
  }
  const ordered = [...events].sort((left, right) =>
    left.timestamp - right.timestamp || left.originalEventIndex - right.originalEventIndex)
  const parent = ordered.map((_, index) => index)
  const root = (index: number): number => parent[index] === index ? index : (parent[index] = root(parent[index]))
  for (let left = 0; left < ordered.length; left += 1) {
    for (let right = left + 1; right < ordered.length; right += 1) {
      if (ordered[right].timestamp - ordered[left].timestamp > 12_000) break
      const dx = ordered[right].victimPosition!.x - ordered[left].victimPosition!.x
      const dy = ordered[right].victimPosition!.y - ordered[left].victimPosition!.y
      if (Math.hypot(dx, dy) <= 1_200) parent[root(right)] = root(left)
    }
  }
  const groups = new Map<number, FightKillEvent[]>()
  ordered.forEach((event, index) => {
    const key = root(index)
    groups.set(key, [...(groups.get(key) ?? []), event])
  })
  const clusters = [...groups.values()].map((cluster): FightCluster => {
    const participants = [...new Set(cluster.flatMap((event) =>
      [event.killerId, event.victimId, ...event.assistingParticipantIds]))].sort((a, b) => a - b)
    const classification = participants.length === 2 ? "duel" :
      participants.length <= 5 ? "skirmish" : "teamfight"
    const pick = participants.length <= 5 && cluster.some((event) =>
      new Set([event.killerId, ...event.assistingParticipantIds]).size >= 2)
    return { events: cluster, participants, classification, pick }
  })
  return { state: "observed", value: clusters, source: "derived" }
}
