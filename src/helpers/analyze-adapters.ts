import type {
  SkillChampionPoint,
  SkillGradeComponentPoint,
  SkillHistoryPoint,
} from "../types/stats"
import { groupTimedGames } from "./time-contract-core"

export const ANALYZE_FORM_WINDOW = 10
export const MIN_ANALYZE_FORM_WINDOW = 3
export const MIN_CHAMPION_SAMPLE = 3

export type MatchOutcome = "win" | "loss" | "unavailable"

export type EnrichedGradeComponentPoint = SkillGradeComponentPoint & {
  win?: boolean
  championId?: number
  role?: string
  recallScore?: number
  session?: number
  sessionGame?: number
}

type HistoryWithSessionIndex = SkillHistoryPoint & { sessionIndex?: number }

export interface MatchInspectorContext {
  outcome: MatchOutcome
  championId?: number
  role?: string
  recallScore: number
}

export interface ArmFormComparison {
  key: string
  label: string
  shortLabel: string
  recentScore: number
  priorScore: number
  delta: number
  recentGames: number
  priorGames: number
}

export interface SessionPositionBucket {
  ordinal: number
  label: string
  games: number
  wins: number
  outcomeGames: number
  gradedGames: number
  averageRecallScore: number | null
  medianRecallScore: number | null
  lowerQuartileRecallScore: number | null
  upperQuartileRecallScore: number | null
  scoreSampleSufficient: boolean
}

export interface SessionAnalysis {
  buckets: SessionPositionBucket[]
  sessions: number
  usesStableOrdinal: boolean
  comparable: boolean
}

export interface ChampionAnalysisPoint extends SkillChampionPoint {
  sampleLabel: "Early sample" | "Developing sample" | "Established sample"
  coverage: number
}

export interface RollingRecallScore {
  gameId: number
  average: number
}

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function quantile(values: readonly number[], probability: number) {
  if (!values.length) return null
  const ordered = [...values].sort((left, right) => left - right)
  const position = (ordered.length - 1) * probability
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return ordered[lower]
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)
}

function summarizeSessionScores(values: readonly number[]) {
  const sufficient = values.length >= 3
  return {
    averageRecallScore: values.length ? mean(values) : null,
    medianRecallScore: sufficient ? quantile(values, .5) : null,
    lowerQuartileRecallScore: sufficient ? quantile(values, .25) : null,
    upperQuartileRecallScore: sufficient ? quantile(values, .75) : null,
    scoreSampleSufficient: sufficient,
  }
}

function finiteScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function shortArmLabel(label: string) {
  return label.replace(/^Positioning\s*&\s*/i, "").replace(/^Objectives\s*&\s*/i, "")
}

/**
 * Builds a truthful match header. Enriched Grade rows win when available; the
 * history join is only a fallback, and a missing join never becomes a loss.
 */
export function matchInspectorContext(
  row: SkillGradeComponentPoint,
  history?: SkillHistoryPoint,
): MatchInspectorContext {
  const enriched = row as EnrichedGradeComponentPoint
  const win = typeof enriched.win === "boolean" ? enriched.win : history?.win
  const rowScore = finiteScore(enriched.recallScore)
    ? enriched.recallScore
    : row.compositePercentile * 100

  return {
    outcome: win === true ? "win" : win === false ? "loss" : "unavailable",
    championId: finiteScore(enriched.championId) ? enriched.championId : history?.championId,
    role: enriched.role ?? history?.role,
    recallScore: Math.max(0, Math.min(100, rowScore)),
  }
}

/**
 * Compares the latest complete arm window with the immediately preceding,
 * equally sized window. The windows never overlap. Career-only Range cannot
 * enter because match Grade breakdowns contain match responsibilities only.
 */
export function armFormComparisons(
  source: readonly SkillGradeComponentPoint[],
  targetWindow = ANALYZE_FORM_WINDOW,
): ArmFormComparison[] {
  const ordered = [...source].sort((left, right) =>
    left.playedAt - right.playedAt || left.gameId - right.gameId)
  const keys = new Map<string, { label: string; values: number[] }>()

  for (const game of ordered) {
    for (const component of game.components) {
      // Defensive guard for future DTOs: Range is career context, never match form.
      if (component.key === ("consistency_versatility" as string) ||
          !finiteScore(component.percentile)) continue
      const entry = keys.get(component.key) ?? { label: component.label, values: [] }
      entry.values.push(component.percentile * 100)
      keys.set(component.key, entry)
    }
  }

  return [...keys].flatMap(([key, entry]) => {
    const window = Math.min(Math.max(1, Math.trunc(targetWindow)), Math.floor(entry.values.length / 2))
    if (window < MIN_ANALYZE_FORM_WINDOW) return []
    const recent = entry.values.slice(-window)
    const prior = entry.values.slice(-window * 2, -window)
    const recentScore = mean(recent)
    const priorScore = mean(prior)
    return [{
      key,
      label: entry.label,
      shortLabel: shortArmLabel(entry.label),
      recentScore,
      priorScore,
      delta: recentScore - priorScore,
      recentGames: recent.length,
      priorGames: prior.length,
    }]
  }).sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) ||
    left.label.localeCompare(right.label))
}

/**
 * Groups selected games into sessions using the app's canonical 90-minute
 * boundary. A stored pre-filter ordinal is used only when it exists on every
 * game; otherwise labels explicitly say they are order within this selection.
 */
export function sessionPositionAnalysis(
  source: readonly SkillHistoryPoint[],
): SessionAnalysis {
  const sessions = groupTimedGames(source)
    .filter((session) => session.kind === "analytical" && session.matches.length >= 2)
  const selected = sessions.flatMap((session) => session.matches) as HistoryWithSessionIndex[]
  const usesStableOrdinal = selected.length > 0 && selected.every((game) =>
    Number.isInteger(game.sessionIndex) && (game.sessionIndex ?? 0) >= 1)
  const buckets = new Map<number, {
    games: number
    wins: number
    grades: number[]
  }>()

  for (const session of sessions) {
    session.matches.forEach((raw, index) => {
      const game = raw as HistoryWithSessionIndex
      const stored = usesStableOrdinal ? game.sessionIndex! : index + 1
      const ordinal = Math.min(5, stored)
      const bucket = buckets.get(ordinal) ?? { games: 0, wins: 0, grades: [] }
      bucket.games += 1
      bucket.wins += Number(game.win)
      if (finiteScore(game.recallScore)) bucket.grades.push(game.recallScore)
      buckets.set(ordinal, bucket)
    })
  }

  const summarized = [...buckets].sort(([left], [right]) => left - right).map(([ordinal, bucket]) => ({
    ordinal,
    label: usesStableOrdinal
      ? `Session game ${ordinal === 5 ? "5+" : ordinal}`
      : `Selected game ${ordinal === 5 ? "5+" : ordinal}`,
    games: bucket.games,
    wins: bucket.wins,
    outcomeGames: bucket.games,
    gradedGames: bucket.grades.length,
    ...summarizeSessionScores(bucket.grades),
  }))

  return {
    sessions: sessions.length,
    usesStableOrdinal,
    comparable: summarized.filter((bucket) => bucket.games >= 3).length >= 2,
    buckets: summarized,
  }
}

/**
 * Uses the selected-recipe Grade row's pre-filter session metadata whenever it
 * is present. Older payloads fall back to selected-game order and say so.
 */
export function gradeSessionPositionAnalysis(
  rows: readonly SkillGradeComponentPoint[],
  history: readonly SkillHistoryPoint[],
): SessionAnalysis {
  const enriched = rows as readonly EnrichedGradeComponentPoint[]
  const hasStableSessions = enriched.length > 0 && enriched.every((game) =>
    Number.isInteger(game.session) && Number.isInteger(game.sessionGame) &&
    (game.sessionGame ?? 0) >= 1)
  if (!hasStableSessions) {
    const measuredIds = new Set(rows.map((row) => row.gameId))
    return sessionPositionAnalysis(history.filter((game) => measuredIds.has(game.gameId)))
  }

  const historyByGame = new Map(history.map((game) => [game.gameId, game]))
  const sessions = new Set<number>()
  const buckets = new Map<number, {
    games: number
    wins: number
    outcomes: number
    grades: number[]
  }>()

  for (const game of enriched) {
    sessions.add(game.session!)
    const ordinal = Math.min(5, game.sessionGame!)
    const bucket = buckets.get(ordinal) ?? { games: 0, wins: 0, outcomes: 0, grades: [] }
    const fallback = historyByGame.get(game.gameId)
    const win = typeof game.win === "boolean" ? game.win : fallback?.win
    const score = finiteScore(game.recallScore)
      ? game.recallScore
      : game.compositePercentile * 100
    bucket.games += 1
    if (typeof win === "boolean") {
      bucket.outcomes += 1
      bucket.wins += Number(win)
    }
    if (finiteScore(score)) bucket.grades.push(score)
    buckets.set(ordinal, bucket)
  }

  const summarized = [...buckets].sort(([left], [right]) => left - right).map(([ordinal, bucket]) => ({
    ordinal,
    label: `Session game ${ordinal === 5 ? "5+" : ordinal}`,
    games: bucket.games,
    wins: bucket.wins,
    outcomeGames: bucket.outcomes,
    gradedGames: bucket.grades.length,
    ...summarizeSessionScores(bucket.grades),
  }))

  return {
    sessions: sessions.size,
    usesStableOrdinal: true,
    comparable: summarized.filter((bucket) => bucket.games >= 3).length >= 2,
    buckets: summarized,
  }
}

export function championAnalysisPoints(
  source: readonly SkillChampionPoint[],
  minimum = MIN_CHAMPION_SAMPLE,
): ChampionAnalysisPoint[] {
  return source.flatMap((champion) => {
    if (champion.gradedGames < minimum || !finiteScore(champion.averageRecallScore)) return []
    return [{
      ...champion,
      coverage: champion.games > 0 ? champion.gradedGames / champion.games : 0,
      sampleLabel: champion.gradedGames >= 10
        ? "Established sample"
        : champion.gradedGames >= 5 ? "Developing sample" : "Early sample",
    } satisfies ChampionAnalysisPoint]
  })
}

export function rollingRecallScores(
  source: readonly Pick<SkillHistoryPoint, "gameId" | "recallScore">[],
  windowSize = 5,
): RollingRecallScore[] {
  const window = Math.max(1, Math.trunc(windowSize))
  return source.flatMap((game, index) => {
    if (index + 1 < window) return []
    const values = source.slice(index + 1 - window, index + 1)
      .map((entry) => entry.recallScore)
    if (!values.every(finiteScore)) return []
    return [{ gameId: game.gameId, average: mean(values as number[]) }]
  })
}
