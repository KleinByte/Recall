/**
 * Comparative and conditional skill insights from ordered observations
 */

import type { InsightObservation } from "../database/insights-repo.js"
import {
  bootstrapDifference,
  empiricalPercentile,
  quantile,
  sessionize,
  shrinkRate,
  wilsonInterval,
  type Interval,
} from "./analytics.js"
import { durationBucketsFor } from "./insights.js"

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
  scope: string
  caveat?: string
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

const STRONG_GAME_MIN_GRADED = 32
const STRONG_GAME_MIN_EACH_SIDE = 8
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
    // Determine reference population: same-role if >=20 graded, otherwise all graded
    const role = graded[0]?.role
    const sameRoleGraded = role
      ? graded.filter((obs) => obs.role === role)
      : []

    const reference =
      sameRoleGraded.length >= ROLE_MIN_GRADED ? sameRoleGraded : graded

    const referenceValues = reference
      .map((obs) => obs.metrics[key])
      .filter((v): v is number => v !== undefined)

    if (referenceValues.length === 0) continue

    // Convert to percentiles
    const strongPercentiles = strong
      .map((obs) => obs.metrics[key])
      .filter((v): v is number => v !== undefined)
      .map((v) => empiricalPercentile(referenceValues, v))

    const nonStrongPercentiles = nonStrong
      .map((obs) => obs.metrics[key])
      .filter((v): v is number => v !== undefined)
      .map((v) => empiricalPercentile(referenceValues, v))

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
  const scopeWinRate = graded.filter((s) => s.observation.win).length / Math.max(1, graded.length)

  const sections: InsightSection[] = []

  // Time of day buckets
  sections.push(buildTimeOfDaySection(graded, scopeWinRate))

  // Day of week buckets
  sections.push(buildDayOfWeekSection(graded, scopeWinRate))

  // Session game number buckets
  sections.push(buildSessionGameSection(graded, scopeWinRate))

  // Previous result condition
  sections.push(buildPreviousResultSection(graded, scopeWinRate))

  // Rest time buckets
  sections.push(buildRestTimeSection(graded, scopeWinRate))

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
  scopeWinRate: number,
): InsightSection {
  const buckets = [
    { label: "Night (0-6)", hours: [0, 1, 2, 3, 4, 5] },
    { label: "Morning (6-12)", hours: [6, 7, 8, 9, 10, 11] },
    { label: "Afternoon (12-18)", hours: [12, 13, 14, 15, 16, 17] },
    { label: "Evening (18-24)", hours: [18, 19, 20, 21, 22, 23] },
  ]

  const findings: InsightFinding[] = []

  for (const bucket of buckets) {
    const games = sessions.filter((s) => {
      const hour = new Date(s.observation.playedAt).getHours()
      return bucket.hours.includes(hour)
    })

    if (games.length < BUCKET_MIN_GRADED) continue

    const finding = buildConditionFinding(bucket.label, games, scopeWinRate, sessions.length)
    findings.push(finding)
  }

  return {
    key: "timeOfDay",
    title: "Time of Day",
    method: "Hour-based performance",
    eligible: findings.length > 0,
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

    if (games.length < BUCKET_MIN_GRADED) continue

    const finding = buildConditionFinding(days[dayIndex], games, scopeWinRate, sessions.length)
    findings.push(finding)
  }

  return {
    key: "dayOfWeek",
    title: "Day of Week",
    method: "Weekday performance",
    eligible: findings.length > 0,
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
    { label: "Third+ game", filter: (s: typeof sessions[0]) => s.sessionGame >= 3 },
  ]

  const findings: InsightFinding[] = []

  for (const bucket of buckets) {
    const games = sessions.filter(bucket.filter)

    if (games.length < BUCKET_MIN_GRADED) continue

    const finding = buildConditionFinding(bucket.label, games, scopeWinRate, sessions.length)
    findings.push(finding)
  }

  return {
    key: "sessionGame",
    title: "Session Position",
    method: "Performance by game in session",
    eligible: findings.length > 0,
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
        s.sessionGame > 1 && index > 0 && sessions[index - 1].observation.win,
    },
    {
      label: "After loss",
      filter: (s: typeof sessions[0], index: number) =>
        s.sessionGame > 1 && index > 0 && !sessions[index - 1].observation.win,
    },
  ]

  const findings: InsightFinding[] = []

  for (const bucket of buckets) {
    const games = sessions.filter((s, i) => bucket.filter(s, i))

    if (games.length < BUCKET_MIN_GRADED) continue

    const finding = buildConditionFinding(bucket.label, games, scopeWinRate, sessions.length)
    findings.push(finding)
  }

  return {
    key: "previousResult",
    title: "Previous Game Result",
    method: "Performance after wins vs losses",
    eligible: findings.length > 0,
    neededGames: BUCKET_MIN_GRADED,
    findings,
  }
}

function buildRestTimeSection(
  sessions: ReturnType<typeof sessionize<any>>,
  scopeWinRate: number,
): InsightSection {
  const buckets = [
    { label: "No break", filter: (s: typeof sessions[0]) => !s.restMinutes || s.restMinutes < 10 },
    {
      label: "Short break (10-30 min)",
      filter: (s: typeof sessions[0]) => s.restMinutes && s.restMinutes >= 10 && s.restMinutes < 30,
    },
    {
      label: "Long break (30+ min)",
      filter: (s: typeof sessions[0]) => s.restMinutes && s.restMinutes >= 30,
    },
  ]

  const findings: InsightFinding[] = []

  for (const bucket of buckets) {
    const games = sessions.filter(bucket.filter)

    if (games.length < BUCKET_MIN_GRADED) continue

    const finding = buildConditionFinding(bucket.label, games, scopeWinRate, sessions.length)
    findings.push(finding)
  }

  return {
    key: "restTime",
    title: "Rest Between Games",
    method: "Performance by break duration",
    eligible: findings.length > 0,
    neededGames: BUCKET_MIN_GRADED,
    findings,
  }
}

function buildConditionFinding(
  label: string,
  games: Array<{ observation: InsightObservation }>,
  scopeWinRate: number,
  totalGames: number,
): InsightFinding {
  const wins = games.filter((g) => g.observation.win).length
  const count = games.length
  const rawRate = wins / count
  const interval = wilsonInterval(wins, count)
  const adjustedRate = shrinkRate(wins, count, scopeWinRate)
  const adjustedDelta = adjustedRate - scopeWinRate

  const grades = games
    .filter((g) => g.observation.gradeScore !== undefined)
    .map((g) => g.observation.gradeScore!)

  const avgGrade = grades.length > 0 ? grades.reduce((sum, g) => sum + g, 0) / grades.length : 0

  // Bootstrap comparison would require reference bucket - simplified for conditions
  const includesZero = interval.low <= scopeWinRate && interval.high >= scopeWinRate
  const summary =
    count < BUCKET_MIN_GRADED || includesZero
      ? `${label}: ${count} games, no clear pattern.`
      : `${label} associated with ${adjustedDelta > 0 ? "higher" : "lower"} win rate.`

  return {
    key: label,
    title: label,
    summary,
    evidenceLevel: "descriptive",
    confidence: assessConfidence(count, interval, "probability"),
    games: count,
    eligibleGames: totalGames,
    effect: adjustedRate,
    unit: "probability",
    interval,
    scope: `${count} games`,
  }
}

function assessConfidence(
  games: number,
  interval: Interval | undefined,
  unit: "grade" | "probability" | "percentile",
): EvidenceConfidence {
  if (!interval || games < 10) return "insufficient"

  const width = interval.high - interval.low

  if (unit === "probability") {
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
