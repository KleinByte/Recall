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
export { buildPredictiveSection, type PredictiveSection, type PredictiveSignal } from "./predictive-insights.js"

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
    // Normalize each observation's metric using its own role's history when that role has >=20 graded
    const strongPercentiles: number[] = []
    const nonStrongPercentiles: number[] = []

    for (const obs of strong) {
      const sameRoleGraded = graded.filter((o) => o.role === obs.role)
      const reference = sameRoleGraded.length >= ROLE_MIN_GRADED ? sameRoleGraded : graded
      const referenceValues = reference
        .map((o) => o.metrics[key])
        .filter((v): v is number => v !== undefined)

      const metricValue = obs.metrics[key]
      if (metricValue !== undefined && referenceValues.length > 0) {
        strongPercentiles.push(empiricalPercentile(referenceValues, metricValue))
      }
    }

    for (const obs of nonStrong) {
      const sameRoleGraded = graded.filter((o) => o.role === obs.role)
      const reference = sameRoleGraded.length >= ROLE_MIN_GRADED ? sameRoleGraded : graded
      const referenceValues = reference
        .map((o) => o.metrics[key])
        .filter((v): v is number => v !== undefined)

      const metricValue = obs.metrics[key]
      if (metricValue !== undefined && referenceValues.length > 0) {
        nonStrongPercentiles.push(empiricalPercentile(referenceValues, metricValue))
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
