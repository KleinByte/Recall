/**
 * Comparative and conditional skill insights from ordered observations
 */

import type {
  InsightObservation,
  FinalItemObservation,
  GradeComponentObservation,
  RviTimelineObservation,
  RviObservationSet,
  ChampionPool,
  BuiltItem,
  BucketRow,
  ContributionShare,
  TimeBucketRow,
} from "../database/insights-repo.js"
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
import { durationBucketsFor } from "./insights.js"
import { durationBucketFor } from "../../../src/helpers/time-contract-core.js"
import { STYLE_AXIS_LABELS } from "./style.js"
import type { StyleAxis, StyleProfile } from "./style.js"
import {
  buildPerformanceProfile,
  type PerformanceProfile,
} from "./performance-profile.js"
import type { TrackedMode, ModeFamily } from "./types.js"
import { buildPredictiveSection, type PredictiveSection, type PredictiveSignal } from "./predictive-insights.js"
export { buildPredictiveSection, type PredictiveSection, type PredictiveSignal }
export { conditionFinding, benjaminiHochberg } from "./statistical-contract.js"

export const SKILL_REPORT_VERSION = 3

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
  /** `grade` is retained as a wire token and means 0-100 Recall Score points. */
  unit: "grade" | "probability" | "percentile" | "rate"
  scoreScale?: "recall_score_0_100"
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
  observedGames?: number
  window?: {
    label: string
    limit?: number
    recentGames?: number
    priorGames?: number
  }
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
  const graded = observations.filter((obs) => obs.recallScore !== undefined)

  if (graded.length < STRONG_GAME_MIN_GRADED) {
    return { eligible: false, findings: [] }
  }

  // Find top quartile threshold (inclusive)
  const scores = graded.map((obs) => obs.recallScore!)
  const threshold = quantile(scores, 0.75)

  if (threshold === undefined) {
    return { eligible: false, findings: [] }
  }

  const strong = graded.filter((obs) => obs.recallScore! >= threshold)
  const nonStrong = graded.filter((obs) => obs.recallScore! < threshold)

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
    const confidence = assessConfidence(
      Math.min(strongPercentiles.length, nonStrongPercentiles.length),
      interval,
      "percentile",
    )

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
      games: strongPercentiles.length,
      eligibleGames: strongPercentiles.length + nonStrongPercentiles.length,
      effect,
      unit: "percentile",
      interval,
      scope: `${strongPercentiles.length} strong-game measurements vs ${nonStrongPercentiles.length} other-game measurements`,
      caveat: includesZero ? "Difference may be due to chance" : undefined,
    })
  }

  return {
    eligible: true,
    definition: `Strong games are the top 25% of your frozen-reference Recall Scores`,
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
function sessionizedInsightObservations(observations: InsightObservation[]) {
  const sorted = [...observations].sort(
    (left, right) => left.playedAt - right.playedAt || left.gameId - right.gameId,
  )
  if (sorted.every((observation) =>
    Number.isSafeInteger(observation.session) && Number.isSafeInteger(observation.sessionGame))) {
    return sorted.map((observation) => ({
      gameId: observation.gameId,
      startedAt: observation.playedAt,
      durationSecs: observation.durationSecs,
      observation,
      session: observation.session!,
      sessionGame: observation.sessionGame!,
      restMinutes: observation.restMinutes,
    }))
  }
  return sessionize(sorted.map((observation) => ({
    gameId: observation.gameId,
    startedAt: observation.playedAt,
    durationSecs: observation.durationSecs,
    observation,
  })))
}

export function buildPlayingConditions(
  observations: InsightObservation[],
): PlayingConditionsReport {
  // Repository observations already carry account-wide session ordinals. Pure
  // callers without that context still get deterministic local sessionization.
  const sessions = sessionizedInsightObservations(observations)

  const graded = sessions.filter((s) => s.observation.recallScore !== undefined)

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

  const scopeWinRate = graded.filter((s) => s.observation.win).length / graded.length

  const sections: InsightSection[] = []

  // Time of day buckets (8 three-hour blocks)
  sections.push(buildTimeOfDaySection(graded, scopeWinRate))

  // Day of week buckets
  sections.push(buildDayOfWeekSection(graded, scopeWinRate))

  // Session game number buckets (1, 2, 3, 4+)
  sections.push(buildSessionGameSection(graded, scopeWinRate))

  // Previous result condition
  sections.push(buildPreviousResultSection(graded, scopeWinRate))

  // Rest time buckets (<15, 15-45, 45-90, new session)
  sections.push(buildRestTimeSection(graded, scopeWinRate))

  return { sections }
}

/**
 * Analyze performance across game duration ranges
 */
export function buildDurationInsights(
  observations: InsightObservation[],
): DurationInsightsReport {
  const graded = observations.filter((obs) => obs.recallScore !== undefined)

  if (graded.length === 0) {
    return {
      key: "duration",
      title: "Game Duration",
      method: "Duration-based Recall Score comparison",
      eligible: false,
      neededGames: BUCKET_MIN_GRADED,
      findings: [],
    }
  }

  const family = graded[0]?.family ?? "sr"
  const buckets = durationBucketsFor(family)
  const bucketData: Array<{ label: string; games: typeof graded }> = buckets.map((bucket, index) => {
    const games = graded.filter(
      (obs) => durationBucketFor(family, obs.durationSecs)?.index === index,
    )
    return { label: bucket.label, games }
  })

  const eligibleBuckets = bucketData.filter((b) => b.games.length >= BUCKET_MIN_GRADED)

  if (eligibleBuckets.length < 2) {
    return {
      key: "duration",
      title: "Game Duration",
      method: "Duration-based Recall Score comparison",
      eligible: false,
      neededGames: BUCKET_MIN_GRADED * 2,
      findings: [],
    }
  }

  const findings: InsightFinding[] = []

  for (const bucket of eligibleBuckets) {
    const games = bucket.games.length
    const grades = bucket.games.map((g) => g.recallScore!)

    // Compare the bucket median with the median of the other eligible buckets.
    // The point estimate and bootstrap interval intentionally use the exact
    // same robust median-difference estimand.
    const otherGames = eligibleBuckets
      .filter((b) => b.label !== bucket.label)
      .flatMap((b) => b.games)

    const otherGrades = otherGames.map((g) => g.recallScore!)
    const gradeDelta = (quantile(grades, 0.5) ?? 0) - (quantile(otherGrades, 0.5) ?? 0)
    const gradeInterval = otherGrades.length > 0
      ? bootstrapDifference(grades, otherGrades, `duration:${bucket.label}`)
      : undefined

    const includesZero = gradeInterval && gradeInterval.low <= 0 && gradeInterval.high >= 0
    const summary = includesZero || !gradeInterval
      ? `${bucket.label} games show no clear Recall Score association.`
      : `${bucket.label} games associated with ${gradeDelta > 0 ? "higher" : "lower"} Recall Scores.`

    findings.push({
      key: bucket.label,
      title: bucket.label,
      summary,
      evidenceLevel: "comparative",
      confidence: assessConfidence(Math.min(games, otherGrades.length), gradeInterval, "grade"),
      games,
      eligibleGames: games + otherGrades.length,
      effect: gradeDelta,
      unit: "grade",
      scoreScale: "recall_score_0_100",
      interval: gradeInterval,
      scope: `${games} games vs ${otherGrades.length} games in the other measured duration bands`,
    })
  }

  return {
    key: "duration",
    title: "Game Duration",
    method: "Duration-based Recall Score comparison",
    eligible: true,
    neededGames: 0,
    findings,
  }
}

// Helper functions

function buildTimeOfDaySection(
  sessions: ReturnType<typeof sessionize<any>>,
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
    const finding = buildConditionFinding(bucket.label, games, scopeWinRate, sessions)
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
  scopeWinRate: number,
): InsightSection {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  const findings: InsightFinding[] = []

  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const games = sessions.filter((s) => new Date(s.observation.playedAt).getDay() === dayIndex)

    // Include all fixed buckets, even sparse ones (<8 games)
    const finding = buildConditionFinding(days[dayIndex], games, scopeWinRate, sessions)
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
    const finding = buildConditionFinding(bucket.label, games, scopeWinRate, sessions)
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
  scopeWinRate: number,
): InsightSection {
  const buckets = [
    {
      label: "After win",
      filter: (s: typeof sessions[0], index: number) =>
        s.sessionGame > 1 && (s.observation.previousWin === true ||
          (s.observation.previousWin === undefined && index > 0 &&
            sessions[index - 1].observation.win && sessions[index - 1].session === s.session)),
    },
    {
      label: "After loss",
      filter: (s: typeof sessions[0], index: number) =>
        s.sessionGame > 1 && (s.observation.previousWin === false ||
          (s.observation.previousWin === undefined && index > 0 &&
            !sessions[index - 1].observation.win && sessions[index - 1].session === s.session)),
    },
  ]

  const findings: InsightFinding[] = []

  for (const bucket of buckets) {
    const games = sessions.filter((s, i) => bucket.filter(s, i))

    // Include all fixed buckets, even sparse ones (<8 games)
    const finding = buildConditionFinding(bucket.label, games, scopeWinRate, sessions)
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
      filter: (s: typeof sessions[0]) => s.restMinutes !== undefined && s.restMinutes >= 45 && s.restMinutes < 90,
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
    const finding = buildConditionFinding(bucket.label, games, scopeWinRate, sessions)
    findings.push(finding)
  }

  // Section is eligible if at least one bucket has >=8 graded games
  const eligible = findings.some((f) => f.games >= BUCKET_MIN_GRADED)

  return {
    key: "restTime",
    title: "Rest Between Games",
    method: "Performance by break duration (90+ min or missing end time starts new session)",
    eligible,
    neededGames: BUCKET_MIN_GRADED,
    findings,
  }
}

function buildConditionFinding(
  label: string,
  games: Array<{ observation: InsightObservation }>,
  scopeWinRate: number,
  allSessions: Array<{ observation: InsightObservation }>,
): InsightFinding {
  const wins = games.filter((g) => g.observation.win).length
  const count = games.length

  // Handle count=0 safely: rawRate 0, Wilson [0,1], adjusted rate baseline, delta 0
  const rawRate = count === 0 ? 0 : wins / count
  const rateInterval = wilsonInterval(wins, count)
  const adjustedRate = count === 0 ? scopeWinRate : shrinkRate(wins, count, scopeWinRate)

  const grades = games
    .filter((g) => g.observation.recallScore !== undefined)
    .map((g) => g.observation.recallScore!)

  const bucketGameIds = new Set(games.map((game) => game.observation.gameId))
  const complementGrades = allSessions
    .filter((session) => !bucketGameIds.has(session.observation.gameId))
    .flatMap((session) => session.observation.recallScore === undefined
      ? [] : [session.observation.recallScore])
  const gradeDelta = grades.length && complementGrades.length
    ? (quantile(grades, 0.5) ?? 0) - (quantile(complementGrades, 0.5) ?? 0)
    : 0

  // Only infer with at least eight bucket games. Both the point and interval
  // compare the bucket median with the non-overlapping complement median.
  const gradeInterval = grades.length >= BUCKET_MIN_GRADED && complementGrades.length > 0
    ? bootstrapDifference(grades, complementGrades, `condition:${label}`)
    : undefined

  // Directional copy only if bucket has >=8 graded games and grade interval excludes zero
  const includesZero = !gradeInterval || (gradeInterval.low <= 0 && gradeInterval.high >= 0)
  const hasEnoughGames = grades.length >= BUCKET_MIN_GRADED

  const summary =
    !hasEnoughGames || includesZero
      ? `${label}: ${count} games, insufficient data for Recall Score comparison.`
      : `${label} associated with ${gradeDelta > 0 ? "higher" : "lower"} Recall Scores.`

  return {
    key: label,
    title: label,
    summary,
    evidenceLevel: "descriptive",
    confidence: assessConfidence(count, gradeInterval, "grade"),
    games: count,
    eligibleGames: allSessions.length,
    effect: gradeDelta,
    unit: "grade",
    scoreScale: "recall_score_0_100",
    interval: gradeInterval,
    rateInterval,
    scope: `${count} games (raw rate ${(rawRate * 100).toFixed(1)}%, adjusted rate ${(adjustedRate * 100).toFixed(1)}%)`,
    caveat: hasEnoughGames && includesZero ? "Recall Score difference may be due to chance" : undefined,
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
    // Public grade effects are measured in 0-100 Recall Score points.
    if (games >= 50 && width < 8) return "high"
    if (games >= 30 && width < 14) return "medium"
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
  _baseline: number,
  family: ModeFamily,
): InsightSection {
  const graded = observations.filter((o) => o.recallScore !== undefined)
  const gradedByChampion = new Map<number, number[]>()
  for (const observation of graded) {
    const scores = gradedByChampion.get(observation.championId) ?? []
    scores.push(observation.recallScore!)
    gradedByChampion.set(observation.championId, scores)
  }
  const eligible = championStats.filter((champion) =>
    (gradedByChampion.get(champion.championId)?.length ?? 0) >= CHAMP_MIN_GRADED)
  const isRandom = family === "aram" || family === "other"

  if (eligible.length === 0) {
    return {
      key: "champions",
      title: "Champion Performance",
      method: "Median Recall Score difference with bootstrap interval",
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
    const champGrades = gradedByChampion.get(champ.championId) ?? []

    if (champGrades.length < CHAMP_MIN_GRADED) continue

    const otherGrades = graded
      .filter((o) => o.championId !== champ.championId && o.recallScore !== undefined)
      .map((o) => o.recallScore!)

    if (otherGrades.length === 0) continue

    const interval = bootstrapDifference(champGrades, otherGrades, `champion:${champ.championId}`)
    const includesZero = interval.low <= 0 && interval.high >= 0
    const isCore = coreIds.has(champ.championId)
    const share = totalGames > 0 ? champ.games / totalGames : 0
    const medianDifference = (quantile(champGrades, 0.5) ?? 0) -
      (quantile(otherGrades, 0.5) ?? 0)

    let summary: string
    if (!includesZero && interval.low > 0) {
      summary = `Champion ${champ.championId} associated with higher Recall Scores.`
    } else if (!includesZero && interval.high < 0) {
      summary = `Champion ${champ.championId} associated with lower Recall Scores.`
    } else {
      summary = `No clear Recall Score association for champion ${champ.championId}.`
    }

    findings.push({
      key: `champion:${champ.championId}`,
      title: `Champion ${champ.championId}`,
      summary,
      evidenceLevel: "comparative",
      confidence: assessConfidence(Math.min(champGrades.length, otherGrades.length), interval, "grade"),
      // Forest plots and confidence labels use this as the analyzed sample.
      // Only selected-recipe graded games enter the Recall Score estimate.
      games: champGrades.length,
      eligibleGames: champGrades.length + otherGrades.length,
      effect: medianDifference,
      unit: "grade",
      scoreScale: "recall_score_0_100",
      interval,
      scope: `${champGrades.length} graded games vs ${otherGrades.length} on other champions, ${(share * 100).toFixed(0)}% of pool${isCore ? " (core)" : ""}`,
      caveat: isRandom ? RANDOM_CHAMPION_CAVEAT : undefined,
    })
  }

  return {
    key: "champions",
    title: "Champion Performance",
    method: "Median Recall Score difference with bootstrap interval",
    eligible: findings.length > 0,
    neededGames: findings.length > 0 ? 0 : CHAMP_MIN_GRADED,
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
  const graded = itemObservations.filter((o) => o.recallScore !== undefined)

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
        s.withGrades.push(obs.recallScore!)
      } else {
        s.withoutGrades.push(obs.recallScore!)
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
        games: 0,
        eligibleGames: 0,
        effect: 0,
        unit: "grade",
        scoreScale: "recall_score_0_100",
        scope: `${totalGames} games with the item, but no comparable games in the same champion-position group`,
        values: { recordedItemGames: totalGames },
        caveat: ITEM_CAVEAT,
      })
      continue
    }

    let totalWeight = 0
    let weightedSum = 0
    let withItemGames = 0
    let withoutItemGames = 0
    for (const s of validStrata) {
      const wMean = s.withGrades.reduce((a, b) => a + b, 0) / s.withGrades.length
      const woMean = s.withoutGrades.reduce((a, b) => a + b, 0) / s.withoutGrades.length
      const w = Math.min(s.withGrades.length, s.withoutGrades.length)
      weightedSum += w * (wMean - woMean)
      totalWeight += w
      withItemGames += s.withGrades.length
      withoutItemGames += s.withoutGrades.length
    }
    const effect = totalWeight > 0 ? weightedSum / totalWeight : 0

    const interval = bootstrapStratifiedEffect(validStrata, `item:${itemId}`)
    const includesZero = interval.low <= 0 && interval.high >= 0

    const summary = includesZero
      ? `No clear Recall Score association for item ${itemId}.`
      : `Item ${itemId} associated with ${effect > 0 ? "higher" : "lower"} Recall Scores.`

    findings.push({
      key: `item:${itemId}`,
      title: `Item ${itemId}`,
      summary,
      evidenceLevel: "comparative",
      confidence: assessConfidence(Math.min(withItemGames, withoutItemGames), interval, "grade"),
      games: withItemGames,
      eligibleGames: withItemGames + withoutItemGames,
      effect,
      unit: "grade",
      scoreScale: "recall_score_0_100",
      interval,
      scope: `${withItemGames} games with the item vs ${withoutItemGames} without across ${validStrata.length} champion-position groups`,
      caveat: ITEM_CAVEAT,
    })
  }

  const hasComparison = findings.some((finding) => finding.interval !== undefined)
  return {
    key: "items",
    title: "Item Associations",
    method: "Stratified weighted bootstrap by champion and role",
    eligible: hasComparison,
    neededGames: hasComparison ? 0 : ITEM_MIN_GAMES,
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
  return family === "sr" || family === "classic"
    ? ["aggression", "damage", "durability", "farming", "objectives", "vision"]
    : ["aggression", "damage", "durability", "farming", "sustain", "teamfighting"]
}

export function buildTrendFindings(
  observations: InsightObservation[],
  family: ModeFamily,
): InsightSection {
  const graded = observations.filter((o) => o.recallScore !== undefined)
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
      axisValues[key] = slice.flatMap((observation) => {
        const value = observation.styleAxes[key]
        return Number.isFinite(value) ? [value] : []
      })
    }

    windows.push({
      index: windows.length,
      grades: slice.map((o) => o.recallScore!),
      axisValues,
    })
  }

  const findings: InsightFinding[] = []

  for (const w of windows) {
    const avg = w.grades.reduce((s, g) => s + g, 0) / w.grades.length
    const values: Record<string, number> = {}
    for (const key of axisKeys) {
      const vals = w.axisValues[key]
      if (vals.length) values[key] = vals.reduce((s, v) => s + v, 0) / vals.length
    }

    findings.push({
      key: `window:${w.index}`,
      title: `Games ${w.index * TREND_WINDOW_SIZE + 1}\u2013${(w.index + 1) * TREND_WINDOW_SIZE}`,
      summary: `Average Recall Score: ${avg.toFixed(1)}`,
      evidenceLevel: "descriptive",
      confidence: "insufficient",
      games: w.grades.length,
      eligibleGames: graded.length,
      effect: avg,
      unit: "grade",
      scoreScale: "recall_score_0_100",
      scope: `${w.grades.length} games`,
      values,
    })
  }

  if (windows.length >= TREND_MIN_WINDOWS) {
    const latest = windows[0].grades
    const prior = [...windows[1].grades, ...windows[2].grades]

    const interval = bootstrapDifference(latest, prior, "trend:grade")
    const delta = (quantile(latest, 0.5) ?? 0) - (quantile(prior, 0.5) ?? 0)
    const includesZero = interval.low <= 0 && interval.high >= 0

    const gradeSummary = includesZero
      ? "No clear trend in recent Recall Scores."
      : `Recent games associated with ${delta > 0 ? "higher" : "lower"} Recall Scores.`

    findings.push({
      key: "trend:grade",
      title: "Recall Score trend",
      summary: gradeSummary,
      evidenceLevel: "comparative",
      confidence: assessConfidence(latest.length + prior.length, interval, "grade"),
      games: latest.length,
      eligibleGames: latest.length + prior.length,
      effect: delta,
      unit: "grade",
      scoreScale: "recall_score_0_100",
      interval,
      scope: `Latest ${latest.length} vs prior ${prior.length} games`,
    })

    for (const key of axisKeys) {
      const latestAxis = windows[0].axisValues[key]
      const priorAxis = [...windows[1].axisValues[key], ...windows[2].axisValues[key]]
      if (latestAxis.length === 0 || priorAxis.length === 0) continue

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
  style?: Omit<SkillStyleReport, "drift">
  grades: GradeCount[]
  lobby?: LobbyComparison
  contribution?: ContributionShare
  duration: BucketRow[]
  hours: TimeBucketRow[]
  weekdays: TimeBucketRow[]
  pool?: ChampionPool
  builds: BuiltItem[]
  observations: InsightObservation[]
  championStats: ChampionStatRow[]
  itemObservations: FinalItemObservation[]
  gradeComponentHistory: GradeComponentObservation[]
  /** Exact selected-recipe match Grade observations; the only source for RVI. */
  rvi?: RviObservationSet
  /** Timeline data remains a separate map diagnostic and never enters RVI. */
  performanceTimelineHistory?: RviTimelineObservation[]
}

export interface SkillStyleReport {
  career: StyleProfile
  recent?: StyleProfile
  earlier?: StyleProfile
  drift: Array<{ label: string; axes: StyleAxis[] }>
}

export interface SkillDeathPoint {
  gameId: number
  playedAt: number
  timestamp: number
  x: number
  y: number
}

export interface SkillDeathMap {
  timelineGames: number
  deaths: SkillDeathPoint[]
}

export function buildDeathMap(
  family: ModeFamily,
  timelineHistory: RviTimelineObservation[] = [],
): SkillDeathMap | undefined {
  if ((family !== "sr" && family !== "classic") || timelineHistory.length === 0) return undefined

  const deaths = timelineHistory.flatMap((game) => game.summary.events.flatMap((event) => {
    const position = event.position
    if (
      event.type !== "CHAMPION_KILL" ||
      event.targetId !== game.participantId ||
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      position.x < 0 || position.x > 15_000 ||
      position.y < 0 || position.y > 15_000
    ) return []

    return [{
      gameId: game.gameId,
      playedAt: game.playedAt,
      timestamp: event.timestamp,
      x: position.x,
      y: position.y,
    }]
  }))

  return { timelineGames: timelineHistory.length, deaths }
}

function buildStyleDrift(
  observations: InsightObservation[],
  axes: StyleAxis[],
): Array<{ label: string; axes: StyleAxis[] }> {
  const ordered = observations
    .filter((observation) => observation.recallScore !== undefined)
    .sort((left, right) => left.playedAt - right.playedAt || left.gameId - right.gameId)
    .slice(-60)

  const windows: Array<{ label: string; axes: StyleAxis[] }> = []
  for (let start = 0; start + TREND_WINDOW_SIZE <= ordered.length; start += TREND_WINDOW_SIZE) {
    const games = ordered.slice(start, start + TREND_WINDOW_SIZE)
    windows.push({
      label: `Games ${start + 1}-${start + games.length}`,
      axes: axes.flatMap((axis) => {
        const values = games.flatMap((game) => {
          const value = game.styleAxes[axis.key]
          return Number.isFinite(value) ? [value] : []
        })
        return values.length ? [{
          ...axis,
          value: values.reduce((total, value) => total + value, 0) / values.length,
        }] : []
      }),
    })
  }
  return windows
}

export interface SkillReport {
  version: 3
  generatedAt: number
  scope: { modes: TrackedMode[]; family: ModeFamily }
  overview: {
    summary: StatsSummary
    style?: SkillStyleReport
    performance?: PerformanceProfile
    deathMap?: SkillDeathMap
    grades: GradeCount[]
    lobby?: LobbyComparison
    contribution?: ContributionShare
    outcomes: { duration: BucketRow[]; hours: TimeBucketRow[]; weekdays: TimeBucketRow[] }
    pool?: { champions: number; games: number; coreShare: number; top: Array<{ championId: number; games: number; wins: number }> }
    builds: Array<{ itemId: number; games: number }>
  }
  visuals: {
    history: Array<{
      gameId: number
      playedAt: number
      championId: number
      role?: string
      win: boolean
      grade?: string
      /** Legacy/internal compatibility normal score. */
      gradeScore?: number
      /** Authoritative Recall score on a fixed 0-100 scale. */
      recallScore?: number
      durationSecs: number
      session?: number
      sessionGame?: number
      restMinutes?: number
    }>
    gradeComponents: GradeComponentObservation[]
    windows: {
      history: { label: string; shownGames: number; totalGames: number; limit: number }
      gradeComponents: { label: string; shownGames: number; limit: number }
    }
    champions: Array<{
      championId: number
      games: number
      wins: number
      winRate: number
      kda: number
      /** Legacy/internal compatibility normal score. */
      avgGradeScore?: number
      /** Average authoritative Recall score (0-100). */
      averageRecallScore?: number
      gradedGames: number
    }>
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

export function buildSkillReport(input: SkillReportInput): SkillReport {
  const {
    modes, family, generatedAt, summary, style, grades, lobby, contribution,
    pool, builds, observations, championStats, itemObservations, gradeComponentHistory,
    rvi, performanceTimelineHistory, duration, hours, weekdays,
  } = input

  const authoritativeScores = observations.flatMap((observation) =>
    observation.recallScore === undefined ? [] : [observation.recallScore])
  const componentHistory = gradeComponentHistory ?? []
  const baseline = authoritativeScores.length
    ? authoritativeScores.reduce((sum, score) => sum + score, 0) / authoritativeScores.length
    : summary.averageRecallScore ?? 50

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
    method: "Condition-based Recall Score comparison",
    eligible: conds.sections.some((s) => s.eligible),
    neededGames: conds.sections.some((s) => s.eligible) ? 0 : CONDITIONS_MIN_GRADED,
    findings: conds.sections.flatMap((s) => s.findings),
  }

  const trends = buildTrendFindings(observations, family)
  const gradedObservationCount = observations.filter(
    (observation) => observation.recallScore !== undefined,
  ).length
  const itemObservationCount = itemObservations.filter(
    (observation) => observation.recallScore !== undefined,
  ).length
  const durationInsights = buildDurationInsights(observations)
  const championInsights = buildChampionFindings(observations, championStats, baseline, family)
  const itemInsights = buildItemFindings(itemObservations)
  const overviewStyle = input.style && {
    ...input.style,
    drift: buildStyleDrift(observations, input.style.career.axes),
  }

  return {
    version: SKILL_REPORT_VERSION,
    generatedAt,
    scope: { modes, family },
    overview: {
      summary,
      style: overviewStyle,
      performance: rvi ? buildPerformanceProfile({
        recipeId: rvi.recipeId,
        rviObservations: rvi.observations,
        family,
      }) : undefined,
      deathMap: buildDeathMap(family, performanceTimelineHistory),
      grades,
      lobby,
      contribution,
      outcomes: { duration, hours, weekdays },
      pool: pool
        ? { champions: pool.champions, games: pool.games, coreShare: pool.coreShare, top: pool.top }
        : undefined,
      builds: builds.map((b) => ({ itemId: b.itemId, games: b.games })),
    },
    visuals: {
      history: observations.slice(-180).map((observation) => ({
        gameId: observation.gameId,
        playedAt: observation.playedAt,
        championId: observation.championId,
        role: observation.role,
        win: observation.win,
        grade: observation.grade,
        gradeScore: observation.gradeScore,
        recallScore: observation.recallScore,
        durationSecs: observation.durationSecs,
        session: observation.session,
        sessionGame: observation.sessionGame,
        restMinutes: observation.restMinutes,
      })),
      gradeComponents: componentHistory,
      windows: {
        history: {
          label: `Latest ${Math.min(180, observations.length)} of ${observations.length} selected matches`,
          shownGames: Math.min(180, observations.length),
          totalGames: observations.length,
          limit: 180,
        },
        gradeComponents: {
          label: `Latest ${componentHistory.length} selected-recipe graded matches`,
          shownGames: componentHistory.length,
          limit: 60,
        },
      },
      champions: championStats.map((champion) => ({
        championId: champion.championId,
        games: champion.games,
        wins: champion.wins,
        winRate: champion.winRate,
        kda: champion.kda,
        avgGradeScore: champion.avgGradeScore,
        averageRecallScore: champion.averageRecallScore,
        gradedGames: champion.gradedGames,
      })),
    },
    insights: {
      bestGamePattern: {
        ...bestGamePattern,
        observedGames: gradedObservationCount,
        window: { label: "All selected-recipe graded matches" },
      },
      conditions: {
        ...conditions,
        observedGames: gradedObservationCount,
        window: { label: "All selected-recipe graded matches" },
      },
      predictive: {
        ...buildPredictiveSection(observations),
        observedGames: gradedObservationCount,
        window: {
          label: "Oldest 80% training · latest 20% holdout",
          trainingGames: gradedObservationCount - Math.floor(gradedObservationCount * 0.2),
          holdoutGames: Math.floor(gradedObservationCount * 0.2),
        },
      },
      duration: {
        ...durationInsights,
        observedGames: gradedObservationCount,
        window: { label: "All selected-recipe graded matches" },
      },
      trends: {
        ...trends,
        observedGames: gradedObservationCount,
        window: { label: "Latest 10 vs prior 20 graded matches", recentGames: 10, priorGames: 20 },
      },
      champions: {
        ...championInsights,
        observedGames: gradedObservationCount,
        window: { label: "All selected-recipe graded matches" },
      },
      items: {
        ...itemInsights,
        observedGames: itemObservationCount,
        window: { label: "All selected final inventories with a current Grade" },
      },
    },
  }
}
