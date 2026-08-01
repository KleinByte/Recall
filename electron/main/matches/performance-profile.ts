import type {
  GradeComponentObservation,
  InsightObservation,
  RviTimelineObservation,
} from "../database/insights-repo.js"
import type { ModeFamily } from "./types.js"

export const RVI_ALGORITHM_VERSION = 1
export const PERFORMANCE_PROFILE_VERSION = RVI_ALGORITHM_VERSION
export const PERFORMANCE_RECENT_GAMES = 20

export type PerformanceConfidence = "learning" | "provisional" | "established"

export interface PerformanceMetricScore {
  key: string
  label: string
  score: number
  weight: number
  games: number
  description: string
  comparison: string
}

export interface PerformanceDimensionScore {
  key: string
  label: string
  shortLabel: string
  description: string
  score: number
  recentScore?: number
  delta?: number
  games: number
  confidence: PerformanceConfidence
  metrics: PerformanceMetricScore[]
}

export interface PerformanceProfile {
  algorithmVersion: number
  score: number
  games: number
  recentGames: number
  measuredGames: number
  coverage: number
  confidence: PerformanceConfidence
  comparison: string
  dimensions: PerformanceDimensionScore[]
  strongestKey?: string
  growthKey?: string
}

interface MetricDefinition {
  key: string
  sourceKey?: string
  label: string
  weight: number
  description: string
  kind?: "grade" | "style" | "observation" | "timeline"
}

interface DimensionDefinition {
  key: string
  label: string
  shortLabel: string
  description: string
  metrics: MetricDefinition[]
}

const RIFT_DIMENSIONS: DimensionDefinition[] = [
  {
    key: "fighting",
    label: "Fighting",
    shortLabel: "Fighting",
    description: "Your output and results in fights.",
    metrics: [
      { key: "combat", label: "Fight output", weight: .24, description: "KDA and damage compared with the lobby." },
      { key: "participation", label: "Fight presence", weight: .14, description: "Takedown participation compared with both teams." },
      { key: "damageShare", label: "Damage share", weight: .14, kind: "observation", description: "Your share of team champion damage." },
      { key: "kdaPace", label: "KDA pace", weight: .12, kind: "observation", description: "Kills and assists relative to deaths." },
      { key: "duels", label: "Duels", weight: .12, kind: "timeline", description: "Solo kill outcomes visible in cached timelines." },
      { key: "skirmishes", label: "Skirmishes", weight: .12, kind: "timeline", description: "Small-fight outcomes visible in cached timelines." },
      { key: "teamfights", label: "Teamfights", weight: .08, kind: "timeline", description: "Large-fight participation and survival." },
      { key: "picks", label: "Picks", weight: .04, kind: "timeline", description: "Results when one player is collapsed on by multiple opponents." },
    ],
  },
  {
    key: "survivability",
    label: "Survivability",
    shortLabel: "Survival",
    description: "How well you stay available while absorbing useful pressure.",
    metrics: [
      { key: "survival", label: "Death control", weight: .38, description: "Deaths compared with the lobby." },
      { key: "frontlining", label: "Pressure absorbed", weight: .18, description: "Damage taken while remaining useful." },
      { key: "deathRate", label: "Deaths per game", weight: .16, kind: "observation", description: "A transparent inverse deaths scale." },
      { key: "durability", label: "Mitigation", weight: .12, kind: "style", description: "Damage mitigated relative to damage taken." },
      { key: "deathRisk", label: "Death risk", weight: .08, kind: "timeline", description: "How often deaths happen deep on the enemy side." },
      { key: "pickSafety", label: "Pick safety", weight: .08, kind: "timeline", description: "Avoiding isolated multi-enemy deaths." },
      { key: "soloSafety", label: "Solo safety", weight: .08, kind: "timeline", description: "Avoiding deaths to a single opponent." },
      { key: "teamfightSafety", label: "Teamfight safety", weight: .08, kind: "timeline", description: "Staying alive when three or more enemies contribute to a death." },
      { key: "gankSafety", label: "Early collapse safety", weight: .10, kind: "timeline", description: "Avoiding early deaths involving someone other than your lane opponent." },
    ],
  },
  {
    key: "objectives",
    label: "Objectives",
    shortLabel: "Objectives",
    description: "How much pressure you convert into map progress.",
    metrics: [
      { key: "objectives", label: "Objective share", weight: .48, description: "Objective damage compared with the lobby." },
      { key: "objectivePace", label: "Objective pace", weight: .22, kind: "observation", description: "Objective damage per minute." },
      { key: "objectiveFocus", sourceKey: "objectives", label: "Objective focus", weight: .14, kind: "style", description: "Objective damage relative to champion damage." },
      { key: "objectiveParticipation", label: "Objective participation", weight: .10, kind: "timeline", description: "Neutral-objective involvement when the client supplies the events." },
      { key: "structures", label: "Structure pressure", weight: .06, kind: "timeline", description: "Participation in structure takedowns." },
      { key: "dragons", label: "Dragon control", weight: .08, kind: "timeline", description: "Participation in Dragon takedowns available to your team." },
      { key: "barons", label: "Baron control", weight: .08, kind: "timeline", description: "Participation in Baron takedowns available to your team." },
      { key: "heralds", label: "Herald control", weight: .08, kind: "timeline", description: "Participation in Rift Herald takedowns available to your team." },
      { key: "objectiveSecure", label: "Objective secure", weight: .06, kind: "timeline", description: "How often you land the finishing hit on your team's neutral objectives." },
      { key: "objectiveVision", label: "Objective setup", weight: .06, kind: "timeline", description: "Vision placed or denied before a neutral objective falls." },
      { key: "baronConversion", label: "Baron conversion", weight: .06, kind: "timeline", description: "Gold swing created after your team secures Baron." },
    ],
  },
  {
    key: "farming",
    label: "Farming",
    shortLabel: "Farming",
    description: "How efficiently you build and maintain resources.",
    metrics: [
      { key: "economy", label: "Gold pace", weight: .30, description: "Gold earned compared with the same role." },
      { key: "farming", label: "Farm pace", weight: .28, description: "CS pace compared with the same role." },
      { key: "goldPace", label: "Gold per minute", weight: .16, kind: "observation", description: "Gold generation on a visible pace scale." },
      { key: "csPace", label: "CS per minute", weight: .14, kind: "observation", description: "Lane and jungle farm on a visible pace scale." },
      { key: "laneLead", label: "Lane lead", weight: .12, kind: "timeline", description: "Gold against the opposing role near 15 minutes." },
      { key: "earlyFarm", label: "Early farm", weight: .10, kind: "timeline", description: "CS against the opposing role near 10 minutes." },
      { key: "midFarm", label: "Mid-game farm", weight: .08, kind: "timeline", description: "CS against the opposing role near 20 minutes." },
      { key: "lateFarm", label: "Late farm", weight: .06, kind: "timeline", description: "CS against the opposing role near 30 minutes when reached." },
    ],
  },
  {
    key: "vision",
    label: "Vision",
    shortLabel: "Vision",
    description: "How much useful map information you create and deny.",
    metrics: [
      { key: "vision", label: "Vision impact", weight: .60, description: "Vision score compared with the same role." },
      { key: "visionPace", label: "Vision pace", weight: .20, kind: "observation", description: "Vision score per minute." },
      { key: "visionPlacement", label: "Ward placement", weight: .10, kind: "timeline", description: "Wards placed when the client supplies vision events." },
      { key: "visionDenial", label: "Vision denial", weight: .10, kind: "timeline", description: "Enemy wards removed when the client supplies vision events." },
    ],
  },
  {
    key: "initiative",
    label: "Initiative",
    shortLabel: "Initiative",
    description: "How often you create or join proactive plays.",
    metrics: [
      { key: "participation", label: "Takedown presence", weight: .25, description: "Kill participation compared with both teams." },
      { key: "combat", label: "Successful pressure", weight: .20, description: "The results of proactive fighting." },
      { key: "aggression", label: "Kill initiative", weight: .12, kind: "style", description: "Kills as a share of kill involvement." },
      { key: "earlyActivity", label: "Early activity", weight: .16, kind: "timeline", description: "Kill involvement in the first 15 minutes." },
      { key: "forwardKills", label: "Forward kills", weight: .12, kind: "timeline", description: "Successful kills on the enemy side of the map." },
      { key: "fightFrequency", label: "Fight frequency", weight: .15, kind: "timeline", description: "Fight involvement per minute." },
      { key: "earlyRoams", label: "Early roams", weight: .12, kind: "timeline", description: "Early takedowns involving someone other than your lane opponent." },
      { key: "soloPressure", label: "Solo pressure", weight: .08, kind: "timeline", description: "How well proactive one-on-one fights resolve." },
      { key: "laneSnowball", label: "Lane snowball", weight: .09, kind: "timeline", description: "Your gold position against the opposing role around 15 minutes." },
    ],
  },
]

const ABYSS_DIMENSIONS: DimensionDefinition[] = [
  {
    key: "fighting",
    label: "Fighting",
    shortLabel: "Combat",
    description: "Your output and results in repeated team fights.",
    metrics: [
      { key: "combat", label: "Fight output", weight: .34, description: "KDA and damage compared with the lobby." },
      { key: "participation", label: "Fight presence", weight: .22, description: "Takedown participation." },
      { key: "damageShare", label: "Damage share", weight: .18, kind: "observation", description: "Your share of team champion damage." },
      { key: "kdaPace", label: "KDA pace", weight: .12, kind: "observation", description: "Kills and assists relative to deaths." },
      { key: "teamfights", label: "Teamfight results", weight: .14, kind: "timeline", description: "Large-fight participation and survival." },
    ],
  },
  {
    key: "survivability",
    label: "Survivability",
    shortLabel: "Survival",
    description: "How well you stay available while spending health usefully.",
    metrics: [
      { key: "survival", label: "Death control", weight: .46, description: "Deaths compared with the lobby." },
      { key: "frontlining", label: "Pressure absorbed", weight: .22, description: "Damage taken while remaining useful." },
      { key: "deathRate", label: "Deaths per game", weight: .18, kind: "observation", description: "A transparent inverse deaths scale." },
      { key: "durability", label: "Mitigation", weight: .14, kind: "style", description: "Damage mitigated relative to damage taken." },
    ],
  },
  {
    key: "farming",
    label: "Resources",
    shortLabel: "Resources",
    description: "How efficiently you keep pace in shared gold and waves.",
    metrics: [
      { key: "economy", label: "Gold pace", weight: .55, description: "Gold earned compared with the lobby." },
      { key: "goldPace", label: "Gold per minute", weight: .25, kind: "observation", description: "Gold generation on a visible pace scale." },
      { key: "csPace", label: "CS per minute", weight: .20, kind: "observation", description: "Shared-wave farm on a mode-adjusted scale." },
    ],
  },
  {
    key: "teamPresence",
    label: "Team Presence",
    shortLabel: "Teamplay",
    description: "How often you are present for the actions that decide the match.",
    metrics: [
      { key: "participation", label: "Takedown presence", weight: .42, description: "Kill participation compared with both teams." },
      { key: "frontlining", label: "Shared pressure", weight: .18, description: "Damage absorbed compared with the lobby." },
      { key: "killParticipation", label: "Team involvement", weight: .20, kind: "observation", description: "Your share of team takedowns." },
      { key: "allySupport", label: "Ally support", weight: .20, kind: "observation", description: "Healing and shielding supplied to teammates." },
    ],
  },
  {
    key: "sustain",
    label: "Sustain",
    shortLabel: "Sustain",
    description: "How effectively you recover health and support allies.",
    metrics: [
      { key: "sustain", label: "Recovery share", weight: .55, kind: "style", description: "Healing relative to healing plus damage taken." },
      { key: "allySupport", label: "Ally sustain", weight: .25, kind: "observation", description: "Healing and shielding supplied to teammates." },
      { key: "survival", label: "Sustain outcome", weight: .20, description: "Whether sustain translates into availability." },
    ],
  },
  {
    key: "fightControl",
    label: "Fight Control",
    shortLabel: "Control",
    description: "How strongly your crowd control shapes repeated fights.",
    metrics: [
      { key: "teamfighting", label: "Control uptime", weight: .50, kind: "style", description: "Crowd-control time per minute." },
      { key: "ccPace", label: "CC pace", weight: .25, kind: "observation", description: "Seconds of crowd control per minute." },
      { key: "participation", label: "Control presence", weight: .25, description: "Takedown presence while fights unfold." },
    ],
  },
]

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const roundScore = (value: number) => Math.round(Math.min(100, Math.max(0, value)))
const mean = (values: number[]) => values.length
  ? values.reduce((total, value) => total + value, 0) / values.length
  : undefined

function confidenceFor(games: number): PerformanceConfidence {
  if (games >= 30) return "established"
  if (games >= 10) return "provisional"
  return "learning"
}

function stabilized(raw: number, games: number, priorGames = 12) {
  const reliability = games / (games + priorGames)
  return roundScore(50 + (raw - 50) * reliability)
}

function componentValues(rows: GradeComponentObservation[], key: string) {
  return rows.flatMap((row) => {
    const component = row.components.find((entry) => entry.key === key)
    return component ? [clamp01(component.percentile)] : []
  })
}

function styleValues(
  rows: GradeComponentObservation[],
  observations: ReadonlyMap<number, InsightObservation>,
  key: string,
) {
  return rows.flatMap((row) => {
    const value = observations.get(row.gameId)?.styleAxes[key]
    return typeof value === "number" && Number.isFinite(value) ? [clamp01(value)] : []
  })
}

function observationMetric(observation: InsightObservation, key: string): number | undefined {
  const metric = observation.metrics
  const scales: Record<string, number | undefined> = {
    damageShare: metric.teamDamageShare === undefined ? undefined : metric.teamDamageShare / .35,
    kdaPace: metric.kda / 5,
    damagePace: metric.damagePerMinute / 900,
    ccPace: metric.ccPerMinute / 12,
    deathRate: 1 - metric.deaths / 10,
    goldPace: metric.goldPerMinute / (observation.family === "sr" ? 550 : 650),
    csPace: metric.csPerMinute / (observation.family === "sr" ? 10 : 5),
    objectivePace: metric.objectiveDamagePerMinute === undefined
      ? undefined
      : metric.objectiveDamagePerMinute / 350,
    visionPace: metric.visionPerMinute === undefined ? undefined : metric.visionPerMinute / 2,
    killParticipation: metric.killParticipation === undefined ? undefined : metric.killParticipation / .75,
    allySupport: metric.allyHealShieldPerMinute === undefined
      ? undefined
      : metric.allyHealShieldPerMinute / 300,
  }
  const value = scales[key]
  return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : undefined
}

function observationValues(
  rows: GradeComponentObservation[],
  observations: ReadonlyMap<number, InsightObservation>,
  key: string,
) {
  return rows.flatMap((row) => {
    const observation = observations.get(row.gameId)
    if (!observation) return []
    const value = observationMetric(observation, key)
    return value === undefined ? [] : [value]
  })
}

function eventParticipation(event: RviTimelineObservation["summary"]["events"][number], participantId: number) {
  return event.participantId === participantId ||
    event.assistingParticipantIds?.includes(participantId) === true
}

function isEnemySide(position: { x: number; y: number } | undefined, teamId: number) {
  if (!position) return false
  return teamId === 100
    ? position.x + position.y > 16_000
    : position.x + position.y < 14_000
}

function nearestFrame(row: RviTimelineObservation, timestamp: number) {
  return row.summary.frames.reduce<typeof row.summary.frames[number] | undefined>((best, frame) =>
    !best || Math.abs(frame.timestamp - timestamp) < Math.abs(best.timestamp - timestamp)
      ? frame
      : best, undefined)
}

function timelineMetric(row: RviTimelineObservation, key: string): number | undefined {
  const kills = row.summary.events.filter((event) => event.type === "CHAMPION_KILL")
  const contributions = kills.filter((event) => eventParticipation(event, row.participantId))
  const deaths = kills.filter((event) => event.targetId === row.participantId)
  const ownedKills = kills.filter((event) => event.participantId === row.participantId)
  const attackers = (event: typeof kills[number]) => 1 + (event.assistingParticipantIds?.length ?? 0)
  const rate = (wins: number, losses: number) => wins + losses > 0
    ? clamp01(.5 + (wins - losses) / (2 * (wins + losses)))
    : undefined

  if (key === "duels") {
    return rate(
      ownedKills.filter((event) => attackers(event) === 1).length,
      deaths.filter((event) => attackers(event) === 1).length,
    )
  }
  if (key === "skirmishes") {
    return rate(
      contributions.filter((event) => attackers(event) === 2).length,
      deaths.filter((event) => attackers(event) === 2).length,
    )
  }
  if (key === "teamfights") {
    return rate(
      contributions.filter((event) => attackers(event) >= 3).length,
      deaths.filter((event) => attackers(event) >= 3).length,
    )
  }
  if (key === "picks") {
    return rate(
      contributions.filter((event) => attackers(event) >= 2).length,
      deaths.filter((event) => attackers(event) >= 2).length,
    )
  }
  if (key === "pickSafety") {
    const picked = deaths.filter((event) => attackers(event) >= 2).length
    return deaths.length ? clamp01(1 - picked / deaths.length) : 1
  }
  if (key === "deathRisk") {
    if (!deaths.length) return 1
    const risky = deaths.filter((event) => isEnemySide(event.position, row.teamId)).length
    return clamp01(1 - risky / deaths.length)
  }
  if (key === "soloSafety") {
    return clamp01(1 - deaths.filter((event) => attackers(event) === 1).length / 2)
  }
  if (key === "teamfightSafety") {
    return clamp01(1 - deaths.filter((event) => attackers(event) >= 3).length / 3)
  }
  if (key === "gankSafety") {
    const earlyDeaths = deaths.filter((event) => event.timestamp < 15 * 60_000)
    const collapses = earlyDeaths.filter((event) =>
      event.participantId !== row.opponentParticipantId ||
      event.assistingParticipantIds?.some((id) => id !== row.opponentParticipantId))
    return clamp01(1 - collapses.length / 2)
  }
  if (key === "earlyActivity") {
    return clamp01(contributions.filter((event) => event.timestamp < 15 * 60_000).length / 4)
  }
  if (key === "forwardKills") {
    if (!ownedKills.length) return undefined
    return clamp01(ownedKills.filter((event) => isEnemySide(event.position, row.teamId)).length / ownedKills.length)
  }
  if (key === "fightFrequency") {
    return clamp01(contributions.length / Math.max(1, row.durationSecs / 60) / .45)
  }
  if (key === "earlyRoams") {
    const early = contributions.filter((event) => event.timestamp < 15 * 60_000)
    const roams = early.filter((event) => event.targetId !== row.opponentParticipantId)
    return clamp01(roams.length / 3)
  }
  if (key === "soloPressure") {
    return rate(
      ownedKills.filter((event) => attackers(event) === 1).length,
      deaths.filter((event) => attackers(event) === 1).length,
    )
  }
  if (key === "structures") {
    const structures = row.summary.events.filter((event) =>
      event.type === "BUILDING_KILL" && eventParticipation(event, row.participantId))
    return clamp01(structures.length / 3)
  }
  if (key === "objectiveParticipation") {
    const objectives = row.summary.events.filter((event) => event.type === "ELITE_MONSTER_KILL")
    if (!objectives.length) return undefined
    return clamp01(objectives.filter((event) => eventParticipation(event, row.participantId)).length / 4)
  }
  if (key === "dragons" || key === "barons" || key === "heralds") {
    const token = key === "dragons" ? "DRAGON" : key === "barons" ? "BARON" : "RIFTHERALD"
    const objectives = row.summary.events.filter((event) =>
      event.type === "ELITE_MONSTER_KILL" && event.objective?.toUpperCase().replaceAll("_", "").includes(token))
    if (!objectives.length) return undefined
    const teamObjectives = objectives.filter((event) => event.teamId === row.teamId)
    if (!teamObjectives.length) return 0
    return clamp01(teamObjectives.filter((event) => eventParticipation(event, row.participantId)).length / teamObjectives.length)
  }
  if (key === "objectiveSecure") {
    const objectives = row.summary.events.filter((event) =>
      event.type === "ELITE_MONSTER_KILL" && event.teamId === row.teamId)
    if (!objectives.length) return undefined
    return clamp01(objectives.filter((event) => event.participantId === row.participantId).length / objectives.length)
  }
  if (key === "objectiveVision") {
    const objectives = row.summary.events.filter((event) => event.type === "ELITE_MONSTER_KILL")
    const vision = row.summary.events.filter((event) =>
      (event.type === "WARD_PLACED" || event.type === "WARD_KILL") &&
      event.participantId === row.participantId)
    if (!objectives.length || !row.summary.events.some((event) => event.type.startsWith("WARD_"))) return undefined
    const prepared = objectives.filter((objective) => vision.some((event) => {
      const lead = objective.timestamp - event.timestamp
      return lead >= 30_000 && lead <= 90_000
    })).length
    return clamp01(prepared / objectives.length)
  }
  if (key === "baronConversion") {
    const barons = row.summary.events.filter((event) =>
      event.type === "ELITE_MONSTER_KILL" &&
      event.teamId === row.teamId &&
      event.objective?.toUpperCase().includes("BARON"))
    if (!barons.length) return undefined
    const conversions = barons.flatMap((event) => {
      const start = nearestFrame(row, event.timestamp)
      const end = nearestFrame(row, Math.min(row.durationSecs * 1_000, event.timestamp + 180_000))
      if (!start || !end) return []
      const signed = row.teamId === 100 ? 1 : -1
      const before = signed * (start.blueGold - start.redGold)
      const after = signed * (end.blueGold - end.redGold)
      return [clamp01(.5 + (after - before) / 8_000)]
    })
    return mean(conversions)
  }
  if (key === "visionPlacement" || key === "visionDenial") {
    const type = key === "visionPlacement" ? "WARD_PLACED" : "WARD_KILL"
    if (!row.summary.events.some((event) => event.type === type)) return undefined
    const events = row.summary.events.filter((event) =>
      event.type === type && event.participantId === row.participantId)
    return clamp01(events.length / (key === "visionPlacement" ? 12 : 6))
  }
  if (key === "laneLead" || key === "laneSnowball" || key === "phaseProficiency" ||
    key === "earlyFarm" || key === "midFarm" || key === "lateFarm") {
    if (!row.opponentParticipantId) return undefined
    const at = (timestamp: number, field: "totalGold" | "cs" = "totalGold") => {
      const frame = nearestFrame(row, timestamp)
      if (!frame || Math.abs(frame.timestamp - timestamp) > 90_000) return undefined
      const mine = frame.participants.find((entry) => entry.participantId === row.participantId)
      const theirs = frame.participants.find((entry) => entry.participantId === row.opponentParticipantId)
      if (!mine || !theirs) return undefined
      if (field === "cs") {
        const mineCs = mine.minionsKilled + mine.jungleMinionsKilled
        const theirCs = theirs.minionsKilled + theirs.jungleMinionsKilled
        return clamp01(.5 + (mineCs - theirCs) / 100)
      }
      return clamp01(.5 + (mine.totalGold - theirs.totalGold) / 5_000)
    }
    if (key === "laneLead" || key === "laneSnowball") return at(15 * 60_000)
    if (key === "earlyFarm") return at(10 * 60_000, "cs")
    if (key === "midFarm") return at(20 * 60_000, "cs")
    if (key === "lateFarm") return at(30 * 60_000, "cs")
    const phases = [10, 20, 30].flatMap((minute) => {
      const value = at(minute * 60_000)
      return value === undefined ? [] : [value]
    })
    return mean(phases)
  }
  return undefined
}

function timelineValues(
  rows: GradeComponentObservation[],
  timelines: ReadonlyMap<number, RviTimelineObservation>,
  key: string,
) {
  return rows.flatMap((row) => {
    const timeline = timelines.get(row.gameId)
    if (!timeline) return []
    const value = timelineMetric(timeline, key)
    return value === undefined ? [] : [value]
  })
}

function comparisonFor(rows: GradeComponentObservation[], key: string) {
  const scope = rows
    .flatMap((row) => row.components.filter((entry) => entry.key === key))
    .map((entry) => entry.scope)[0]
  if (scope === "role") return "Same role"
  if (scope === "team") return "Team contribution"
  if (scope === "lobby") return "Recorded lobby"
  return "Recall display scale"
}

function buildMeasuredDimension(
  definition: DimensionDefinition,
  rows: GradeComponentObservation[],
  recentRows: GradeComponentObservation[],
  observations: ReadonlyMap<number, InsightObservation>,
  timelines: ReadonlyMap<number, RviTimelineObservation>,
): PerformanceDimensionScore | undefined {
  const measured = definition.metrics.flatMap((metric) => {
    const sourceKey = metric.sourceKey ?? metric.key
    const collect = (sourceRows: GradeComponentObservation[]) => {
      if (metric.kind === "style") return styleValues(sourceRows, observations, sourceKey)
      if (metric.kind === "observation") return observationValues(sourceRows, observations, sourceKey)
      if (metric.kind === "timeline") return timelineValues(sourceRows, timelines, sourceKey)
      return componentValues(sourceRows, sourceKey)
    }
    const values = collect(rows)
    const recentValues = collect(recentRows)
    const score = mean(values)
    if (score === undefined) return []
    const coverage = values.length / Math.max(1, rows.length)
    return [{ metric, values, recentValues, score: score * 100, effectiveWeight: metric.weight * coverage }]
  })
  if (!measured.length) return undefined

  const availableWeight = measured.reduce((total, entry) => total + entry.effectiveWeight, 0)
  const metrics = measured.map((entry) => ({
    key: entry.metric.key,
    label: entry.metric.label,
    score: roundScore(entry.score),
    weight: entry.effectiveWeight / availableWeight,
    games: entry.values.length,
    description: entry.metric.description,
    comparison: entry.metric.kind === "style" || entry.metric.kind === "observation"
      ? "Recall display scale"
      : entry.metric.kind === "timeline"
        ? "Cached timeline evidence"
      : comparisonFor(rows, entry.metric.sourceKey ?? entry.metric.key),
  }))
  const raw = metrics.reduce((total, metric) => total + metric.score * metric.weight, 0)
  const recentMeasured = measured.filter((entry) => entry.recentValues.length)
  const recentWeight = recentMeasured.reduce((total, entry) =>
    total + entry.metric.weight * entry.recentValues.length / Math.max(1, recentRows.length), 0)
  const recentRaw = recentWeight > 0
    ? recentMeasured.reduce((total, entry) =>
        total + mean(entry.recentValues)! * 100 *
          (entry.metric.weight * entry.recentValues.length / Math.max(1, recentRows.length)) / recentWeight, 0)
    : undefined
  const games = Math.max(...measured.map((entry) => entry.values.length))
  const score = stabilized(raw, games)
  const recentScore = recentRaw === undefined
    ? undefined
    : stabilized(recentRaw, Math.max(...recentMeasured.map((entry) => entry.recentValues.length)), 8)

  return {
    key: definition.key,
    label: definition.label,
    shortLabel: definition.shortLabel,
    description: definition.description,
    score,
    recentScore,
    delta: recentScore === undefined ? undefined : recentScore - score,
    games,
    confidence: confidenceFor(games),
    metrics,
  }
}

function quantile(values: number[], percentile: number) {
  if (!values.length) return 0
  const ordered = [...values].sort((left, right) => left - right)
  const index = (ordered.length - 1) * percentile
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return ordered[lower]
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower)
}

function fatigueResistance(
  rows: GradeComponentObservation[],
  observations: ReadonlyMap<number, InsightObservation>,
) {
  const sessions: GradeComponentObservation[][] = []
  for (const row of rows) {
    const current = sessions.at(-1)
    const previous = current?.at(-1)
    const gap = previous
      ? row.playedAt - (observations.get(previous.gameId)?.endedAt ?? previous.playedAt)
      : Infinity
    if (!current || gap > 90 * 60_000) sessions.push([row])
    else current.push(row)
  }
  const changes = sessions.flatMap((session) => session.length >= 2
    ? [session.at(-1)!.compositePercentile - session[0].compositePercentile]
    : [])
  if (!changes.length) return undefined
  const drop = Math.max(0, -(mean(changes) ?? 0))
  return clamp01(1 - drop / .25) * 100
}

function stabilityDimension(
  rows: GradeComponentObservation[],
  observations: ReadonlyMap<number, InsightObservation>,
): PerformanceDimensionScore | undefined {
  const values = rows.map((row) => clamp01(row.compositePercentile))
  if (!values.length) return undefined
  const average = mean(values) ?? .5
  const deviation = Math.sqrt(mean(values.map((value) => (value - average) ** 2)) ?? 0)
  const floor = quantile(values, .25) * 100
  const repeatability = (1 - clamp01(deviation / .35)) * 100
  const games = values.length
  const fatigue = fatigueResistance(rows, observations)
  const available = fatigue === undefined ? 1 : 1.2
  const floorWeight = .56 / available
  const repeatWeight = .44 / available
  const fatigueWeight = fatigue === undefined ? 0 : .20 / available
  const raw = floor * floorWeight + repeatability * repeatWeight + (fatigue ?? 0) * fatigueWeight
  const score = stabilized(raw, games)
  const recent = rows.slice(-PERFORMANCE_RECENT_GAMES)
  const recentValues = recent.map((row) => clamp01(row.compositePercentile))
  const recentAverage = mean(recentValues) ?? .5
  const recentDeviation = Math.sqrt(mean(recentValues.map((value) => (value - recentAverage) ** 2)) ?? 0)
  const recentRaw = quantile(recentValues, .25) * 66 + (1 - clamp01(recentDeviation / .35)) * 34
  const recentScore = stabilized(recentRaw, recent.length, 8)

  return {
    key: "consistency",
    label: "Consistency",
    shortLabel: "Consistency",
    description: "How reliably your performance holds across games and sessions.",
    score,
    recentScore,
    delta: recentScore - score,
    games,
    confidence: confidenceFor(games),
    metrics: [
      { key: "performanceFloor", label: "Performance floor", score: roundScore(floor), weight: floorWeight, games, description: "The lower quartile of your lobby-relative performance.", comparison: "Your recorded games" },
      { key: "repeatability", label: "Repeatability", score: roundScore(repeatability), weight: repeatWeight, games, description: "How tightly your results cluster from game to game.", comparison: "Your recorded games" },
      ...(fatigue === undefined ? [] : [{ key: "fatigue", label: "Fatigue resistance", score: roundScore(fatigue), weight: fatigueWeight, games, description: "How well performance holds from the first to last game of a session.", comparison: "Your recorded sessions" }]),
    ],
  }
}

function effectiveChampionCount(rows: GradeComponentObservation[], observations: ReadonlyMap<number, InsightObservation>) {
  const counts = new Map<number, number>()
  for (const row of rows) {
    const championId = observations.get(row.gameId)?.championId
    if (championId === undefined) continue
    counts.set(championId, (counts.get(championId) ?? 0) + 1)
  }
  const games = [...counts.values()].reduce((total, count) => total + count, 0)
  if (!games) return 1
  const entropy = [...counts.values()].reduce((total, count) => {
    const share = count / games
    return total - share * Math.log(share)
  }, 0)
  return Math.exp(entropy)
}

function adaptabilityDimension(
  rows: GradeComponentObservation[],
  observations: ReadonlyMap<number, InsightObservation>,
  primary: PerformanceDimensionScore[],
  timelines: ReadonlyMap<number, RviTimelineObservation>,
): PerformanceDimensionScore | undefined {
  if (!rows.length || !primary.length) return undefined
  const games = rows.length
  const effective = effectiveChampionCount(rows, observations)
  const target = Math.min(8, Math.max(3, Math.sqrt(games)))
  const breadth = clamp01((effective - 1) / Math.max(1, target - 1)) * 100
  const performance = (mean(rows.map((row) => clamp01(row.compositePercentile))) ?? .5) * 100
  const balance = quantile(primary.map((dimension) => dimension.score / 100), .25) * 100
  const steadinessRows = rows.filter((row) => observations.get(row.gameId)?.win === false)
  const steadiness = steadinessRows.length
    ? (mean(steadinessRows.map((row) => clamp01(row.compositePercentile))) ?? .5) * 100
    : undefined
  const phaseValues = timelineValues(rows, timelines, "phaseProficiency")
  const phase = mean(phaseValues)
  const inputs = [
    { score: breadth, weight: .25 },
    { score: performance, weight: .25 },
    { score: balance, weight: .20 },
    ...(steadiness === undefined ? [] : [{ score: steadiness, weight: .15 }]),
    ...(phase === undefined ? [] : [{ score: phase * 100, weight: .15 }]),
  ]
  const totalWeight = inputs.reduce((total, entry) => total + entry.weight, 0)
  const raw = inputs.reduce((total, entry) => total + entry.score * entry.weight / totalWeight, 0)
  const score = stabilized(raw, games)

  const recentRows = rows.slice(-PERFORMANCE_RECENT_GAMES)
  const recentEffective = effectiveChampionCount(recentRows, observations)
  const recentTarget = Math.min(6, Math.max(3, Math.sqrt(recentRows.length)))
  const recentBreadth = clamp01((recentEffective - 1) / Math.max(1, recentTarget - 1)) * 100
  const recentPerformance = (mean(recentRows.map((row) => clamp01(row.compositePercentile))) ?? .5) * 100
  const recentPrimary = primary.flatMap((dimension) =>
    dimension.recentScore === undefined ? [] : [dimension.recentScore / 100])
  const recentBalance = quantile(recentPrimary, .25) * 100
  const recentRaw = recentBreadth * .32 + recentPerformance * .36 + recentBalance * .32
  const recentScore = stabilized(recentRaw, recentRows.length, 8)

  return {
    key: "versatility",
    label: "Versatility",
    shortLabel: "Versatility",
    description: "How well your performance holds across champions and match states.",
    score,
    recentScore,
    delta: recentScore - score,
    games,
    confidence: confidenceFor(games),
    metrics: [
      { key: "championBreadth", label: "Champion pool", score: roundScore(breadth), weight: .25 / totalWeight, games, description: "Effective champion variety adjusted for sample size.", comparison: "Your recorded pool" },
      { key: "contextPerformance", label: "Context performance", score: roundScore(performance), weight: .25 / totalWeight, games, description: "Average lobby-relative performance across the selected scope.", comparison: "Recorded lobbies" },
      { key: "dimensionBalance", label: "Vector depth", score: roundScore(balance), weight: .20 / totalWeight, games, description: "The lower quartile of your other RVI vectors.", comparison: "Your RVI" },
      ...(steadiness === undefined ? [] : [{ key: "steadiness", label: "Losing-game steadiness", score: roundScore(steadiness), weight: .15 / totalWeight, games: steadinessRows.length, description: "Performance that remains in losing games.", comparison: "Your recorded losses" }]),
      ...(phase === undefined ? [] : [{ key: "phaseProficiency", label: "Phase proficiency", score: roundScore(phase * 100), weight: .15 / totalWeight, games: phaseValues.length, description: "Gold against the opposing role across early, mid, and late snapshots.", comparison: "Cached timeline evidence" }]),
    ],
  }
}

export function buildPerformanceProfile(input: {
  family: ModeFamily
  observations: InsightObservation[]
  gradeComponentHistory: GradeComponentObservation[]
  timelineHistory?: RviTimelineObservation[]
}): PerformanceProfile | undefined {
  const rows = [...input.gradeComponentHistory]
    .sort((left, right) => left.playedAt - right.playedAt || left.gameId - right.gameId)
  if (!rows.length) return undefined

  const recentRows = rows.slice(-PERFORMANCE_RECENT_GAMES)
  const observations = new Map(input.observations.map((observation) => [observation.gameId, observation]))
  const timelines = new Map((input.timelineHistory ?? []).map((timeline) => [timeline.gameId, timeline]))
  const definitions = input.family === "sr" ? RIFT_DIMENSIONS : ABYSS_DIMENSIONS
  const primary = definitions.flatMap((definition) => {
    const dimension = buildMeasuredDimension(definition, rows, recentRows, observations, timelines)
    return dimension ? [dimension] : []
  })
  const stability = stabilityDimension(rows, observations)
  const adaptability = adaptabilityDimension(rows, observations, primary, timelines)
  const dimensions = [
    ...primary,
    ...(stability ? [stability] : []),
    ...(adaptability ? [adaptability] : []),
  ]
  const strongest = [...dimensions].sort((left, right) => right.score - left.score)[0]
  const growth = [...dimensions]
    .filter((dimension) => dimension.delta !== undefined && dimension.delta > 0)
    .sort((left, right) => right.delta! - left.delta!)[0]
  const measuredGames = rows.length
  const consideredGames = Math.min(input.observations.length, 240)

  return {
    algorithmVersion: PERFORMANCE_PROFILE_VERSION,
    score: roundScore(mean(dimensions.map((dimension) => dimension.score)) ?? 50),
    games: input.observations.length,
    recentGames: recentRows.length,
    measuredGames,
    coverage: Math.min(1, measuredGames / Math.max(1, consideredGames)),
    confidence: confidenceFor(measuredGames),
    comparison: "Role-, team-, and lobby-aware measurements from your recorded games",
    dimensions,
    strongestKey: strongest?.key,
    growthKey: growth?.key,
  }
}
