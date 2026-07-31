/**
 * Comparative and conditional skill insights from ordered observations
 */

import type { InsightObservation, FinalItemObservation, ChampionPool, BuiltItem, ContributionShare } from "../database/insights-repo.js"
import type { ChampionStatRow, StatsSummary, GradeCount } from "../database/matches-repo.js"
import type { LobbyComparison } from "../database/participants-repo.js"
import {
  bootstrapDifference,
  quantile,
  seededRandom,
  sessionize,
  shrinkRate,
  wilsonInterval,
  type Interval,
} from "./analytics.js"
import { durationBucketsFor, rankChampions } from "./insights.js"
import { STYLE_AXIS_LABELS } from "./style.js"
import type { StyleProfile } from "./style.js"
import type { TrackedMode, ModeFamily } from "./types.js"
import { buildPredictiveSection, type PredictiveSection, type PredictiveSignal } from "./predictive-insights.js"
export { buildPredictiveSection, type PredictiveSection, type PredictiveSignal }

export type EvidenceLevel = "descriptive" | "comparative" | "experimental"
export type EvidenceConfidence = "insufficient" | "low" | "medium" | "high"

export interface InsightFinding {
  key: string
  title: string
  summary: string
  evidenceLevel: EvidenceLevel
  confidence: EvidenceConfidence
  games: number
  eligibleGames: number
  effect: number
  unit: "grade" | "probability" | "percentile" | "rate"
  interval?: Interval
  rateInterval?: Interval
  scope: string
  caveat?: string
  values?: Record<string, number>
}

export interface InsightSection {
  key: string
  title: string
  method: string
  eligible: boolean
  neededGames: number
  findings: InsightFinding[]
}

export interface BestGamePatternReport {
  eligible: boolean
  definition?: string
  strongGames?: number
  nonStrongGames?: number
  findings: InsightFinding[]
}

export interface PlayingConditionsReport {
  sections: InsightSection[]
}

export interface DurationInsightsReport extends InsightSection {}

const STRONG_GAME_MIN_GRADED = 30
const STRONG_GAME_MIN_EACH_SIDE = 8
const CONDITIONS_MIN_GRADED = 30
const ROLE_MIN_GRADED = 20
const BUCKET_MIN_GRADED = 8

/**
 * Identify performance patterns in strong games
 */
export function buildBestGamePattern(
  observations: InsightObservation[],
): BestGamePatternReport {
  const graded = observations.filter((obs) => obs.gradeScore !== undefined)

  if (graded.length < STRONG_GAME_MIN_GRADED) {
    return { eligible: false, findings: [] }
  }

  // Find top quartile threshold (inclusive)
  const scores = graded.map((obs) => obs.gradeScore!)
  const threshold = quantile(scores, 0.75)

  if (threshold === undefined) {
    return { eligible: false, findings: [] }
  }

  const strong = graded.filter((obs) => obs.gradeScore! >= threshold)
  const nonStrong = graded.filter((obs) => obs.gradeScore! < threshold)

  if (strong.length < STRONG_GAME_MIN_EACH_SIDE || nonStrong.length < STRONG_GAME_MIN_EACH_SIDE) {
    return { eligible: false, findings: [] }
  }

  const findings: InsightFinding[] = []
  const observationsByRole = new Map<string | undefined, InsightObservation[]>()
  for (const observation of graded) {
    const roleObservations = observationsByRole.get(observation.role) ?? []
    roleObservations.push(observation)
    observationsByRole.set(observation.role, roleObservations)
  }

  // Normalize metrics to percentiles and compare
  const metricKeys: Array<keyof InsightObservation["metrics"]> = [
    "damagePerMinute",
    "damageTakenPerMinute",
    "goldPerMinute",
    "csPerMinute",
    "visionPerMinute",
    "objectiveDamagePerMinute",
    "ccPerMinute",
    "killParticipation",
    "teamDamageShare",
    "deaths",
    "kda",
  ]

  for (const key of metricKeys) {
    const allReferenceValues = sortedMetricValues(graded, key)
    const referenceValuesByRole = new Map<string | undefined, number[]>()
    for (const [role, roleObservations] of observationsByRole) {
      if (roleObservations.length >= ROLE_MIN_GRADED) {
        referenceValuesByRole.set(role, sortedMetricValues(roleObservations, key))
      }
    }

    const strongPercentiles: number[] = []
    const nonStrongPercentiles: number[] = []

    for (const obs of strong) {
      const metricValue = obs.metrics[key]
      const referenceValues = referenceValuesByRole.get(obs.role) ?? allReferenceValues
      if (metricValue !== undefined && referenceValues.length > 0) {
        strongPercentiles.push(empiricalPercentileSorted(referenceValues, metricValue))
      }
    }

    for (const obs of nonStrong) {
      const metricValue = obs.metrics[key]
      const referenceValues = referenceValuesByRole.get(obs.role) ?? allReferenceValues
      if (metricValue !== undefined && referenceValues.length > 0) {
        nonStrongPercentiles.push(empiricalPercentileSorted(referenceValues, metricValue))
      }
    }

    if (strongPercentiles.length === 0 || nonStrongPercentiles.length === 0) {
      continue
    }

    // Bootstrap median difference
    const seed = `strong:${key}`
    const interval = bootstrapDifference(strongPercentiles, nonStrongPercentiles, seed)

    const strongMedian = quantile(strongPercentiles, 0.5) ?? 0
    const nonStrongMedian = quantile(nonStrongPercentiles, 0.5) ?? 0
    const effect = strongMedian - nonStrongMedian

    // Confidence based on sample size and interval width
    const confidence = assessConfidence(strong.length, interval, "percentile")

    // Generate summary (association language only, no directional if interval includes zero)
    const includesZero = interval.low <= 0 && interval.high >= 0
    const summary = includesZero
      ? `No clear association detected for ${formatMetricName(key)}.`
      : `Strong games show ${effect > 0 ? "more" : "less"} ${formatMetricName(key)}.`

    findings.push({
      key: key.toString(),
      title: formatMetricName(key),
      summary,
      evidenceLevel: "comparative",
      confidence,
      games: strong.length,
      eligibleGames: graded.length,
      effect,
      unit: "percentile",
      interval,
      scope: `Best ${strong.length} of ${graded.length} graded games`,
      caveat: includesZero ? "Difference may be due to chance" : undefined,
    })
  }

  return {
    eligible: true,
    definition: `Strong games are the top 25% of your Recall grades`,
    strongGames: strong.length,
    nonStrongGames: nonStrong.length,
    findings,
  }
}

function sortedMetricValues(
  observations: InsightObservation[],
  key: keyof InsightObservation["metrics"],
): number[] {
  return observations
    .map((observation) => observation.metrics[key])
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => left - right)
}

function empiricalPercentileSorted(values: number[], value: number): number {
  let lowerStart = 0
  let lowerEnd = values.length
  while (lowerStart < lowerEnd) {
    const middle = Math.floor((lowerStart + lowerEnd) / 2)
    if (values[middle] < value) lowerStart = middle + 1
    else lowerEnd = middle
  }

  let upperStart = lowerStart
  let upperEnd = values.length
  while (upperStart < upperEnd) {
    const middle = Math.floor((upperStart + upperEnd) / 2)
    if (values[middle] <= value) upperStart = middle + 1
    else upperEnd = middle
  }

  return (lowerStart + (upperStart - lowerStart) / 2) / values.length
}

/**
 * Analyze performance across playing conditions
 */
export function buildPlayingConditions(
  observations: InsightObservation[],
): PlayingConditionsReport {
  // Sessionize first
  const sessions = sessionize(
    observations.map((obs) => ({
      gameId: obs.gameId,
      startedAt: obs.playedAt,
      endedAt: obs.endedAt,
      observation: obs,
    })),
  )

  const graded = sessions.filter((s) => s.observation.gradeScore !== undefined)
  
  // Require at least 30 graded games overall
  if (graded.length < CONDITIONS_MIN_GRADED) {
    return {
      sections: [
        {
          key: "timeOfDay",
          title: "Time of Day (device local time)",
          method: "Hour-based performance",
          eligible: false,
          neededGames: CONDITIONS_MIN_GRADED,
          findings: [],
        },
        {
          key: "dayOfWeek",
          title: "Day of Week",
          method: "Weekday performance",
          eligible: false,
          neededGames: CONDITIONS_MIN_GRADED,
          findings: [],
        },
        {
          key: "sessionGame",
          title: "Session Position",
          method: "Performance by game in session",
          eligible: false,
          neededGames: CONDITIONS_MIN_GRADED,
          findings: [],
        },
        {
          key: "previousResult",
          title: "Previous Game Result",
          method: "Performance after wins vs losses",
          eligible: false,
          neededGames: CONDITIONS_MIN_GRADED,
          findings: [],
        },
        {
          key: "restTime",
          title: "Rest Between Games",
          method: "Performance by break duration",
          eligible: false,
          neededGames: CONDITIONS_MIN_GRADED,
          findings: [],
        },
      ],
    }
  }

  const scopeGradeBaseline = graded.reduce((sum, s) => sum + s.observation.gradeScore!, 0) / graded.length
  const scopeWinRate = graded.filter((s) => s.observation.win).length / graded.length

  const sections: InsightSection[] = []

  // Time of day buckets (8 three-hour blocks)
  sections.push(buildTimeOfDaySection(graded, scopeGradeBaseline, scopeWinRate))

  // Day of week buckets
  sections.push(buildDayOfWeekSection(graded, scopeGradeBaseline, scopeWinRate))

  // Session game number buckets (1, 2, 3, 4+)
  sections.push(buildSessionGameSection(graded, scopeGradeBaseline, scopeWinRate))

  // Previous result condition
  sections.push(buildPreviousResultSection(graded, scopeGradeBaseline, scopeWinRate))

  // Rest time buckets (<15, 15-45, 45-90, new session)
  sections.push(buildRestTimeSection(graded, scopeGradeBaseline, scopeWinRate))

  return { sections }
}

/**
 * Analyze performance across game duration ranges
 */
export function buildDurationInsights(
  observations: InsightObservation[],
): DurationInsightsReport {
  const graded = observations.filter((obs) => obs.gradeScore !== undefined)
  
  if (graded.length === 0) {
    return {
      key: "duration",
      title: "Game Duration",
      method: "Duration-based grade comparison",
      eligible: false,
      neededGames: BUCKET_MIN_GRADED,
      findings: [],
    }
  }

  const family = graded[0]?.family ?? "sr"
  const buckets = durationBucketsFor(family)
  const scopeBaseline = graded.reduce((sum, obs) => sum + obs.gradeScore!, 0) / graded.length

  const bucketData: Array<{ label: string; games: typeof graded }> = buckets.map((bucket, index) => {
    const previousMax = index > 0 ? buckets[index - 1].maxSecs : 0
    const games = graded.filter(
      (obs) => obs.durationSecs > previousMax && obs.durationSecs <= bucket.maxSecs
    )
    return { label: bucket.label, games }
  })

  const eligibleBuckets = bucketData.filter((b) => b.games.length >= BUCKET_MIN_GRADED)

  if (eligibleBuckets.length < 2) {
    return {
      key: "duration",
      title: "Game Duration",
      method: "Duration-based grade comparison",
      eligible: false,
      neededGames: BUCKET_MIN_GRADED * 2,
      findings: [],
    }
  }

  const findings: InsightFinding[] = []

  for (const bucket of eligibleBuckets) {
    const wins = bucket.games.filter((g) => g.win).length
    const games = bucket.games.length
    const grades = bucket.games.map((g) => g.gradeScore!)
    const avgGrade = grades.reduce((sum, g) => sum + g, 0) / grades.length

    const interval = wilsonInterval(wins, games)
    const adjustedRate = shrinkRate(wins, games, scopeBaseline / 100)
    const gradeDelta = avgGrade - scopeBaseline

    // Bootstrap grade comparison if we have other buckets
    const otherGames = eligibleBuckets
      .filter((b) => b.label !== bucket.label)
      .flatMap((b) => b.games)
    
    const otherGrades = otherGames.map((g) => g.gradeScore!)
    const gradeInterval = otherGrades.length > 0
      ? bootstrapDifference(grades, otherGrades, `duration:${bucket.label}`)
      : undefined

    const includesZero = gradeInterval && gradeInterval.low <= 0 && gradeInterval.high >= 0
    const summary = includesZero || !gradeInterval
      ? `${bucket.label} games show no clear grade association.`
      : `${bucket.label} games associated with ${gradeDelta > 0 ? "higher" : "lower"} grades.`

    findings.push({
      key: bucket.label,
      title: bucket.label,
      summary,
      evidenceLevel: "comparative",
      confidence: assessConfidence(games, gradeInterval, "grade"),
      games,
      eligibleGames: graded.length,
      effect: gradeDelta,
      unit: "grade",
      interval: gradeInterval,
      scope: `${games} games`,
    })
  }

  return {
    key: "duration",
    title: "Game Duration",
    method: "Duration-based grade comparison",
    eligible: true,
    neededGames: 0,
    findings,
  }
}

// Helper functions

function buildTimeOfDaySection(
  sessions: ReturnType<typeof sessionize<any>>,
  scopeGradeBaseline: number,
  scopeWinRate: number,
): InsightSection {
  // 8 three-hour blocks using device local time
  const buckets = [
    { label: "0-3", hours: [0, 1, 2] },
    { label: "3-6", hours: [3, 4, 5] },
    { label: "6-9", hours: [6, 7, 8] },
    { label: "9-12", hours: [9, 10, 11] },
    { label: "12-15", hours: [12, 13, 14] },
    { label: "15-18", hours: [15, 16, 17] },
    { label: "18-21", hours: [18, 19, 20] },
    { label: "21-24", hours: [21, 22, 23] },
  ]

  const findings: InsightFinding[] = []

  for (const bucket of buckets) {
    const games = sessions.filter((s) => {
      const hour = new Date(s.observation.playedAt).getHours()
      return bucket.hours.includes(hour)
    })

    // Include all buckets, even sparse ones (<8 games)
    const finding = buildConditionFinding(bucket.label, games, scopeGradeBaseline, scopeWinRate, sessions)
    findings.push(finding)
  }

  // Section is eligible if at least one bucket has >=8 graded games
  const eligible = findings.some((f) => f.games >= BUCKET_MIN_GRADED)

  return {
    key: "timeOfDay",
    title: "Time of Day (device local time)",
    method: "Hour-based performance using device local time",
    eligible,
    neededGames: BUCKET_MIN_GRADED,
    findings,
  }
}

function buildDayOfWeekSection(
  sessions: ReturnType<typeof sessionize<any>>,
  scopeGradeBaseline: number,
  scopeWinRate: number,
): InsightSection {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  const findings: InsightFinding[] = []

  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const games = sessions.filter((s) => new Date(s.observation.playedAt).getDay() === dayIndex)

    // Include all fixed buckets, even sparse ones (<8 games)
    const finding = buildConditionFinding(days[dayIndex], games, scopeGradeBaseline, scopeWinRate, sessions)
    findings.push(finding)
  }

  // Section is eligible if at least one bucket has >=8 graded games
  const eligible = findings.some((f) => f.games >= BUCKET_MIN_GRADED)

  return {
    key: "dayOfWeek",
    title: "Day of Week",
    method: "Weekday performance",
    eligible,
    neededGames: BUCKET_MIN_GRADED,
    findings,
  }
}

function buildSessionGameSection(
  sessions: ReturnType<typeof sessionize<any>>,
  scopeGradeBaseline: number,
  scopeWinRate: number,
): InsightSection {
  const buckets = [
    { label: "First game", filter: (s: typeof sessions[0]) => s.sessionGame === 1 },
    { label: "Second game", filter: (s: typeof sessions[0]) => s.sessionGame === 2 },
    { label: "Third game", filter: (s: typeof sessions[0]) => s.sessionGame === 3 },
    { label: "Fourth+ game", filter: (s: typeof sessions[0]) => s.sessionGame >= 4 },
  ]

  const findings: InsightFinding[] = []

  for (const bucket of buckets) {
    const games = sessions.filter(bucket.filter)

    // Include all fixed buckets, even sparse ones (<8 games)
    const finding = buildConditionFinding(bucket.label, games, scopeGradeBaseline, scopeWinRate, sessions)
    findings.push(finding)
  }

  // Section is eligible if at least one bucket has >=8 graded games
  const eligible = findings.some((f) => f.games >= BUCKET_MIN_GRADED)

  return {
    key: "sessionGame",
    title: "Session Position",
    method: "Performance by game in session",
    eligible,
    neededGames: BUCKET_MIN_GRADED,
    findings,
  }
}

function buildPreviousResultSection(
  sessions: ReturnType<typeof sessionize<any>>,
  scopeGradeBaseline: number,
  scopeWinRate: number,
): InsightSection {
  const buckets = [
    {
      label: "After win",
      filter: (s: typeof sessions[0], index: number) =>
        s.sessionGame > 1 && index > 0 && sessions[index - 1].observation.win && sessions[index - 1].session === s.session,
    },
    {
      label: "After loss",
      filter: (s: typeof sessions[0], index: number) =>
        s.sessionGame > 1 && index > 0 && !sessions[index - 1].observation.win && sessions[index - 1].session === s.session,
    },
  ]

  const findings: InsightFinding[] = []

  for (const bucket of buckets) {
    const games = sessions.filter((s, i) => bucket.filter(s, i))

    // Include all fixed buckets, even sparse ones (<8 games)
    const finding = buildConditionFinding(bucket.label, games, scopeGradeBaseline, scopeWinRate, sessions)
    findings.push(finding)
  }

  // Section is eligible if at least one bucket has >=8 graded games
  const eligible = findings.some((f) => f.games >= BUCKET_MIN_GRADED)

  return {
    key: "previousResult",
    title: "Previous Game Result",
    method: "Performance after wins vs losses within same session",
    eligible,
    neededGames: BUCKET_MIN_GRADED,
    findings,
  }
}

function buildRestTimeSection(
  sessions: ReturnType<typeof sessionize<any>>,
  scopeGradeBaseline: number,
  scopeWinRate: number,
): InsightSection {
  const buckets = [
    { label: "Rest <15 min", filter: (s: typeof sessions[0]) => s.restMinutes !== undefined && s.restMinutes < 15 },
    {
      label: "Rest 15-45 min",
      filter: (s: typeof sessions[0]) => s.restMinutes !== undefined && s.restMinutes >= 15 && s.restMinutes < 45,
    },
    {
      label: "Rest 45-90 min",
      filter: (s: typeof sessions[0]) => s.restMinutes !== undefined && s.restMinutes >= 45 && s.restMinutes <= 90,
    },
    {
      label: "New session",
      filter: (s: typeof sessions[0]) => s.sessionGame === 1,
    },
  ]

  const findings: InsightFinding[] = []

  for (const bucket of buckets) {
    const games = sessions.filter(bucket.filter)

    // Include all fixed buckets, even sparse ones (<8 games)
    const finding = buildConditionFinding(bucket.label, games, scopeGradeBaseline, scopeWinRate, sessions)
    findings.push(finding)
  }

  // Section is eligible if at least one bucket has >=8 graded games
  const eligible = findings.some((f) => f.games >= BUCKET_MIN_GRADED)

  return {
    key: "restTime",
    title: "Rest Between Games",
    method: "Performance by break duration (>90 min or missing end time starts new session)",
    eligible,
    neededGames: BUCKET_MIN_GRADED,
    findings,
  }
}

function buildConditionFinding(
  label: string,
  games: Array<{ observation: InsightObservation }>,
  scopeGradeBaseline: number,
  scopeWinRate: number,
  allSessions: Array<{ observation: InsightObservation }>,
): InsightFinding {
  const wins = games.filter((g) => g.observation.win).length
  const count = games.length
  
  // Handle count=0 safely: rawRate 0, Wilson [0,1], adjusted rate baseline, delta 0
  const rawRate = count === 0 ? 0 : wins / count
  const rateInterval = wilsonInterval(wins, count)
  const adjustedRate = count === 0 ? scopeWinRate : shrinkRate(wins, count, scopeWinRate)
  const adjustedRateDelta = adjustedRate - scopeWinRate

  const grades = games
    .filter((g) => g.observation.gradeScore !== undefined)
    .map((g) => g.observation.gradeScore!)
  
  const bucketMean = grades.length > 0 ? grades.reduce((sum, g) => sum + g, 0) / grades.length : scopeGradeBaseline
  
  // Adjusted grade formula: (n * bucketMean + 12 * scopeMean) / (n + 12)
  // For 0 games: (0 * x + 12 * baseline) / 12 = baseline, delta = 0
  const adjustedGrade = (grades.length * bucketMean + 12 * scopeGradeBaseline) / (grades.length + 12)
  const adjustedGradeDelta = adjustedGrade - scopeGradeBaseline

  // Bootstrap grade delta against selected-scope graded history
  // Only if bucket has >=8 graded games
  const allGrades = allSessions
    .filter((s) => s.observation.gradeScore !== undefined)
    .map((s) => s.observation.gradeScore!)
  
  const gradeInterval = grades.length >= BUCKET_MIN_GRADED && allGrades.length > grades.length
    ? bootstrapDifference(grades, allGrades, `condition:${label}`)
    : undefined

  // Directional copy only if bucket has >=8 graded games and grade interval excludes zero
  const includesZero = !gradeInterval || (gradeInterval.low <= 0 && gradeInterval.high >= 0)
  const hasEnoughGames = grades.length >= BUCKET_MIN_GRADED
  
  const summary =
    !hasEnoughGames || includesZero
      ? `${label}: ${count} games, insufficient data for grade comparison.`
      : `${label} associated with ${adjustedGradeDelta > 0 ? "higher" : "lower"} grades.`

  return {
    key: label,
    title: label,
    summary,
    evidenceLevel: "descriptive",
    confidence: assessConfidence(count, gradeInterval, "grade"),
    games: count,
    eligibleGames: allSessions.length,
    effect: adjustedGradeDelta,
    unit: "grade",
    interval: gradeInterval,
    rateInterval,
    scope: `${count} games (raw rate ${(rawRate * 100).toFixed(1)}%, adjusted rate ${(adjustedRate * 100).toFixed(1)}%)`,
    caveat: hasEnoughGames && includesZero ? "Grade difference may be due to chance" : undefined,
  }
}

function assessConfidence(
  games: number,
  interval: Interval | undefined,
  unit: "grade" | "probability" | "percentile" | "rate",
): EvidenceConfidence {
  if (!interval || games < 10) return "insufficient"

  const width = interval.high - interval.low

  if (unit === "probability" || unit === "rate") {
    if (games >= 50 && width < 0.15) return "high"
    if (games >= 30 && width < 0.25) return "medium"
    return "low"
  } else if (unit === "grade") {
    if (games >= 50 && width < 1.5) return "high"
    if (games >= 30 && width < 2.5) return "medium"
    return "low"
  } else {
    // percentile
    if (games >= 50 && width < 0.2) return "high"
    if (games >= 30 && width < 0.3) return "medium"
    return "low"
  }
}

function formatMetricName(key: string): string {
  const names: Record<string, string> = {
    damagePerMinute: "damage per minute",
    damageTakenPerMinute: "damage taken per minute",
    goldPerMinute: "gold per minute",
    csPerMinute: "CS per minute",
    visionPerMinute: "vision score per minute",
    objectiveDamagePerMinute: "objective damage per minute",
    ccPerMinute: "crowd control per minute",
    killParticipation: "kill participation",
    teamDamageShare: "team damage share",
    deaths: "deaths",
    kda: "KDA",
  }
  return names[key] ?? key
}

// --- Champion findings ---

const CHAMP_MIN_GRADED = 8
const RANDOM_CHAMPION_CAVEAT =
  "Champions are randomly assigned in this mode; performance reflects games played, not choice."
const CORE_POOL_SIZE = 5

export function buildChampionFindings(
  observations: InsightObservation[],
  championStats: ChampionStatRow[],
  baseline: number,
  family: ModeFamily,
): InsightSection {
  const graded = observations.filter((o) => o.gradeScore !== undefined)
  const ranked = rankChampions(championStats, baseline)
  const eligible = ranked.filter((c) => c.gradedGames >= CHAMP_MIN_GRADED)
  const isRandom = family === "aram" || family === "other"

  if (eligible.length === 0) {
    return {
      key: "champions",
      title: "Champion Performance",
      method: "Adjusted grade with bootstrap interval",
      eligible: false,
      neededGames: CHAMP_MIN_GRADED,
      findings: [],
    }
  }

  const totalGames = championStats.reduce((s, c) => s + c.games, 0)
  const coreIds = new Set(
    [...championStats]
      .sort((a, b) => b.games - a.games)
      .slice(0, CORE_POOL_SIZE)
      .map((c) => c.championId),
  )

  const findings: InsightFinding[] = []

  for (const champ of eligible) {
    const champGrades = graded
      .filter((o) => o.championId === champ.championId)
      .map((o) => o.gradeScore!)

    if (champGrades.length < CHAMP_MIN_GRADED) continue

    const otherGrades = graded
      .filter((o) => o.championId !== champ.championId && o.gradeScore !== undefined)
      .map((o) => o.gradeScore!)

    if (otherGrades.length === 0) continue

    const interval = bootstrapDifference(champGrades, otherGrades, `champion:${champ.championId}`)
    const includesZero = interval.low <= 0 && interval.high >= 0
    const isCore = coreIds.has(champ.championId)
    const share = totalGames > 0 ? champ.games / totalGames : 0

    let summary: string
    if (!includesZero && interval.low > 0) {
      summary = `Champion ${champ.championId} associated with higher grades.`
    } else if (!includesZero && interval.high < 0) {
      summary = `Champion ${champ.championId} associated with lower grades.`
    } else {
      summary = `No clear grade association for champion ${champ.championId}.`
    }

    findings.push({
      key: `champion:${champ.championId}`,
      title: `Champion ${champ.championId}`,
      summary,
      evidenceLevel: "comparative",
      confidence: assessConfidence(champGrades.length, interval, "grade"),
      games: champ.games,
      eligibleGames: graded.length,
      effect: champ.adjustedGrade - baseline,
      unit: "grade",
      interval,
      scope: `${champGrades.length} graded games, ${(share * 100).toFixed(0)}% of pool${isCore ? " (core)" : ""}`,
      caveat: isRandom ? RANDOM_CHAMPION_CAVEAT : undefined,
    })
  }

  return {
    key: "champions",
    title: "Champion Performance",
    method: "Adjusted grade with bootstrap interval",
    eligible: true,
    neededGames: 0,
    findings,
  }
}

// --- Item findings ---

const ITEM_MIN_GAMES = 10
const ITEM_CAVEAT =
  "Based on final inventory; item purchase order and game state at purchase are unknown. Correlation does not imply the item caused the outcome."

function bootstrapStratifiedEffect(
  strata: Array<{ withGrades: number[]; withoutGrades: number[] }>,
  seed: string,
  resamples = 2_000,
): Interval {
  const rng = seededRandom(seed)
  const effects: number[] = []

  for (let r = 0; r < resamples; r++) {
    let totalWeight = 0
    let weightedSum = 0

    for (const s of strata) {
      const resampledWith: number[] = []
      for (let j = 0; j < s.withGrades.length; j++) {
        resampledWith.push(s.withGrades[Math.floor(rng() * s.withGrades.length)])
      }
      const resampledWithout: number[] = []
      for (let j = 0; j < s.withoutGrades.length; j++) {
        resampledWithout.push(s.withoutGrades[Math.floor(rng() * s.withoutGrades.length)])
      }

      const wMean = resampledWith.reduce((a, b) => a + b, 0) / resampledWith.length
      const woMean = resampledWithout.reduce((a, b) => a + b, 0) / resampledWithout.length
      const weight = Math.min(s.withGrades.length, s.withoutGrades.length)
      weightedSum += weight * (wMean - woMean)
      totalWeight += weight
    }

    effects.push(totalWeight > 0 ? weightedSum / totalWeight : 0)
  }

  const low = quantile(effects, 0.025) ?? 0
  const high = quantile(effects, 0.975) ?? 0
  return { low, high, level: 0.95 }
}

export function buildItemFindings(
  itemObservations: FinalItemObservation[],
): InsightSection {
  const graded = itemObservations.filter((o) => o.gradeScore !== undefined)

  if (graded.length === 0) {
    return {
      key: "items",
      title: "Item Associations",
      method: "Stratified weighted bootstrap by champion and role",
      eligible: false,
      neededGames: ITEM_MIN_GAMES,
      findings: [],
    }
  }

  const itemCounts = new Map<number, number>()
  for (const obs of graded) {
    for (const id of obs.itemIds) {
      itemCounts.set(id, (itemCounts.get(id) ?? 0) + 1)
    }
  }

  const candidates = [...itemCounts.entries()]
    .filter(([, count]) => count >= ITEM_MIN_GAMES)
    .sort((a, b) => b[1] - a[1])

  if (candidates.length === 0) {
    return {
      key: "items",
      title: "Item Associations",
      method: "Stratified weighted bootstrap by champion and role",
      eligible: false,
      neededGames: ITEM_MIN_GAMES,
      findings: [],
    }
  }

  const findings: InsightFinding[] = []

  for (const [itemId, totalGames] of candidates) {
    const strataMap = new Map<string, { withGrades: number[]; withoutGrades: number[] }>()

    for (const obs of graded) {
      const key = `${obs.championId}:${obs.role ?? "unknown"}`
      if (!strataMap.has(key)) strataMap.set(key, { withGrades: [], withoutGrades: [] })
      const s = strataMap.get(key)!
      if (obs.itemIds.includes(itemId)) {
        s.withGrades.push(obs.gradeScore!)
      } else {
        s.withoutGrades.push(obs.gradeScore!)
      }
    }

    const validStrata = [...strataMap.values()].filter(
      (s) => s.withGrades.length > 0 && s.withoutGrades.length > 0,
    )

    if (validStrata.length === 0) {
      findings.push({
        key: `item:${itemId}`,
        title: `Item ${itemId}`,
        summary: `Item ${itemId} found in ${totalGames} games; insufficient stratified data.`,
        evidenceLevel: "comparative",
        confidence: "insufficient",
        games: totalGames,
        eligibleGames: graded.length,
        effect: 0,
        unit: "grade",
        scope: `${totalGames} games`,
        caveat: ITEM_CAVEAT,
      })
      continue
    }

    let totalWeight = 0
    let weightedSum = 0
    for (const s of validStrata) {
      const wMean = s.withGrades.reduce((a, b) => a + b, 0) / s.withGrades.length
      const woMean = s.withoutGrades.reduce((a, b) => a + b, 0) / s.withoutGrades.length
      const w = Math.min(s.withGrades.length, s.withoutGrades.length)
      weightedSum += w * (wMean - woMean)
      totalWeight += w
    }
    const effect = totalWeight > 0 ? weightedSum / totalWeight : 0

    const interval = bootstrapStratifiedEffect(validStrata, `item:${itemId}`)
    const includesZero = interval.low <= 0 && interval.high >= 0

    const summary = includesZero
      ? `No clear grade association for item ${itemId}.`
      : `Item ${itemId} associated with ${effect > 0 ? "higher" : "lower"} grades.`

    findings.push({
      key: `item:${itemId}`,
      title: `Item ${itemId}`,
      summary,
      evidenceLevel: "comparative",
      confidence: assessConfidence(totalGames, interval, "grade"),
      games: totalGames,
      eligibleGames: graded.length,
      effect,
      unit: "grade",
      interval,
      scope: `${totalGames} games across ${validStrata.length} champion-role strata`,
      caveat: ITEM_CAVEAT,
    })
  }

  return {
    key: "items",
    title: "Item Associations",
    method: "Stratified weighted bootstrap by champion and role",
    eligible: true,
    neededGames: 0,
    findings,
  }
}

// --- Trend findings ---

const TREND_WINDOW_SIZE = 10
const TREND_MIN_WINDOWS = 3

function bootstrapMeanDifference(
  left: number[],
  right: number[],
  seed: string,
  resamples = 2_000,
): Interval {
  const rng = seededRandom(seed)
  const diffs: number[] = []
  for (let r = 0; r < resamples; r++) {
    let lSum = 0
    for (let j = 0; j < left.length; j++) lSum += left[Math.floor(rng() * left.length)]
    let rSum = 0
    for (let j = 0; j < right.length; j++) rSum += right[Math.floor(rng() * right.length)]
    diffs.push(lSum / left.length - rSum / right.length)
  }
  const low = quantile(diffs, 0.025) ?? 0
  const high = quantile(diffs, 0.975) ?? 0
  return { low, high, level: 0.95 }
}

function axisKeysFor(family: ModeFamily): string[] {
  return family === "sr"
    ? ["aggression", "damage", "durability", "farming", "objectives", "vision"]
    : ["aggression", "damage", "durability", "farming", "sustain", "teamfighting"]
}

export function buildTrendFindings(
  observations: InsightObservation[],
  family: ModeFamily,
): InsightSection {
  const graded = observations.filter((o) => o.gradeScore !== undefined)
  const sorted = [...graded].sort((a, b) => b.playedAt - a.playedAt || b.gameId - a.gameId)

  const axisKeys = axisKeysFor(family)

  const windows: Array<{
    index: number
    grades: number[]
    axisValues: Record<string, number[]>
  }> = []

  for (let i = 0; i < sorted.length; i += TREND_WINDOW_SIZE) {
    const slice = sorted.slice(i, i + TREND_WINDOW_SIZE)
    if (slice.length < TREND_WINDOW_SIZE) break

    const axisValues: Record<string, number[]> = {}
    for (const key of axisKeys) {
      axisValues[key] = slice.map((o) => o.styleAxes[key] ?? 0)
    }

    windows.push({
      index: windows.length,
      grades: slice.map((o) => o.gradeScore!),
      axisValues,
    })
  }

  const findings: InsightFinding[] = []

  for (const w of windows) {
    const avg = w.grades.reduce((s, g) => s + g, 0) / w.grades.length
    const values: Record<string, number> = {}
    for (const key of axisKeys) {
      const vals = w.axisValues[key]
      values[key] = vals.reduce((s, v) => s + v, 0) / vals.length
    }

    findings.push({
      key: `window:${w.index}`,
      title: `Games ${w.index * TREND_WINDOW_SIZE + 1}\u2013${(w.index + 1) * TREND_WINDOW_SIZE}`,
      summary: `Average grade: ${avg.toFixed(1)}`,
      evidenceLevel: "descriptive",
      confidence: "insufficient",
      games: w.grades.length,
      eligibleGames: graded.length,
      effect: avg,
      unit: "grade",
      scope: `${w.grades.length} games`,
      values,
    })
  }

  if (windows.length >= TREND_MIN_WINDOWS) {
    const latest = windows[0].grades
    const prior = [...windows[1].grades, ...windows[2].grades]

    const interval = bootstrapDifference(latest, prior, "trend:grade")
    const latestAvg = latest.reduce((s, g) => s + g, 0) / latest.length
    const priorAvg = prior.reduce((s, g) => s + g, 0) / prior.length
    const delta = latestAvg - priorAvg
    const includesZero = interval.low <= 0 && interval.high >= 0

    const gradeSummary = includesZero
      ? "No clear trend in recent grades."
      : `Recent games associated with ${delta > 0 ? "higher" : "lower"} grades.`

    findings.push({
      key: "trend:grade",
      title: "Grade Trend",
      summary: gradeSummary,
      evidenceLevel: "comparative",
      confidence: assessConfidence(latest.length + prior.length, interval, "grade"),
      games: latest.length,
      eligibleGames: latest.length + prior.length,
      effect: delta,
      unit: "grade",
      interval,
      scope: `Latest ${latest.length} vs prior ${prior.length} games`,
    })

    for (const key of axisKeys) {
      const latestAxis = windows[0].axisValues[key]
      const priorAxis = [...windows[1].axisValues[key], ...windows[2].axisValues[key]]

      const axisInterval = bootstrapMeanDifference(latestAxis, priorAxis, `trend:${key}`)
      const latestMean = latestAxis.reduce((s, v) => s + v, 0) / latestAxis.length
      const priorMean = priorAxis.reduce((s, v) => s + v, 0) / priorAxis.length
      const axisDelta = latestMean - priorMean
      const axisIncludesZero = axisInterval.low <= 0 && axisInterval.high >= 0

      const axisLabel = STYLE_AXIS_LABELS[key] ?? key
      const axisSummary = axisIncludesZero
        ? `No clear trend in ${axisLabel}.`
        : `Recent games show ${axisDelta > 0 ? "more" : "less"} ${axisLabel}.`

      findings.push({
        key: `trend:${key}`,
        title: axisLabel,
        summary: axisSummary,
        evidenceLevel: "comparative",
        confidence: assessConfidence(latestAxis.length + priorAxis.length, axisInterval, "rate"),
        games: latestAxis.length,
        eligibleGames: latestAxis.length + priorAxis.length,
        effect: axisDelta,
        unit: "rate",
        interval: axisInterval,
        scope: `Latest ${latestAxis.length} vs prior ${priorAxis.length} games`,
      })
    }
  }

  return {
    key: "trends",
    title: "Performance Trends",
    method: "10-game window comparison with bootstrap",
    eligible: windows.length >= TREND_MIN_WINDOWS,
    neededGames: TREND_WINDOW_SIZE * TREND_MIN_WINDOWS,
    findings,
  }
}

// --- Report composition ---

export interface SkillReportInput {
  modes: TrackedMode[]
  family: ModeFamily
  generatedAt: number
  summary: StatsSummary
  style?: StyleProfile
  grades: GradeCount[]
  lobby?: LobbyComparison
  contribution?: ContributionShare
  pool?: ChampionPool
  builds: BuiltItem[]
  observations: InsightObservation[]
  championStats: ChampionStatRow[]
  itemObservations: FinalItemObservation[]
}

export interface SkillReportV2 {
  version: 2
  generatedAt: number
  scope: { modes: TrackedMode[]; family: ModeFamily }
  overview: {
    summary: StatsSummary
    style?: StyleProfile
    grades: GradeCount[]
    lobby?: LobbyComparison
    contribution?: ContributionShare
    pool?: { champions: number; games: number; coreShare: number }
    builds: Array<{ itemId: number; games: number }>
  }
  insights: {
    bestGamePattern: InsightSection
    conditions: InsightSection
    predictive: PredictiveSection
    duration: InsightSection
    trends: InsightSection
    champions: InsightSection
    items: InsightSection
  }
}

export function buildSkillReport(input: SkillReportInput): SkillReportV2 {
  const {
    modes, family, generatedAt, summary, style, grades, lobby, contribution,
    pool, builds, observations, championStats, itemObservations,
  } = input

  const baseline = summary.avgGradeScore ?? 0

  const bgp = buildBestGamePattern(observations)
  const bestGamePattern: InsightSection = {
    key: "bestGamePattern",
    title: "Strong Game Pattern",
    method: "Top quartile comparison with bootstrap",
    eligible: bgp.eligible,
    neededGames: bgp.eligible ? 0 : STRONG_GAME_MIN_GRADED,
    findings: bgp.findings,
  }

  const conds = buildPlayingConditions(observations)
  const conditions: InsightSection = {
    key: "conditions",
    title: "Playing Conditions",
    method: "Condition-based grade comparison",
    eligible: conds.sections.some((s) => s.eligible),
    neededGames: conds.sections.some((s) => s.eligible) ? 0 : CONDITIONS_MIN_GRADED,
    findings: conds.sections.flatMap((s) => s.findings),
  }

  return {
    version: 2,
    generatedAt,
    scope: { modes, family },
    overview: {
      summary,
      style,
      grades,
      lobby,
      contribution,
      pool: pool
        ? { champions: pool.champions, games: pool.games, coreShare: pool.coreShare }
        : undefined,
      builds: builds.map((b) => ({ itemId: b.itemId, games: b.games })),
    },
    insights: {
      bestGamePattern,
      conditions,
      predictive: buildPredictiveSection(observations),
      duration: buildDurationInsights(observations),
      trends: buildTrendFindings(observations, family),
      champions: buildChampionFindings(observations, championStats, baseline, family),
      items: buildItemFindings(itemObservations),
    },
  }
}
