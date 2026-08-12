import type {
  SkillGradeComponent,
  SkillHistoryPoint,
  StyleAxis,
} from "../types/stats"
import { quantile } from "./statistics"

export interface CalendarDay {
  date: string
  recallScore: number | null
  games: number
  wins: number
}

const localDateKey = (playedAt: number) => {
  const date = new Date(playedAt)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function calendarDays(history: readonly SkillHistoryPoint[]): CalendarDay[] {
  const grouped = new Map<string, { games: number; wins: number; scores: number[] }>()
  for (const game of history.slice(-365)) {
    const key = localDateKey(game.playedAt)
    const day = grouped.get(key) ?? { games: 0, wins: 0, scores: [] }
    day.games += 1
    day.wins += Number(game.win)
    if (Number.isFinite(game.recallScore)) day.scores.push(game.recallScore as number)
    grouped.set(key, day)
  }
  return [...grouped].map(([date, day]) => ({
    date,
    recallScore: day.scores.length
      ? day.scores.reduce((sum, score) => sum + score, 0) / day.scores.length
      : null,
    games: day.games,
    wins: day.wins,
  }))
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
export const MIN_WEEKDAY_DISTRIBUTION_GAMES = 3
export const MIN_DURATION_TREND_GAMES = 5

export function weekdayRecallScoreGroups(history: readonly SkillHistoryPoint[]) {
  return WEEKDAYS.flatMap((label, index) => {
    const values = history
      .filter((game) => ((new Date(game.playedAt).getDay() + 6) % 7) === index &&
        Number.isFinite(game.recallScore))
      .map((game) => game.recallScore as number)
    return values.length ? [{
      label,
      values,
      eligible: values.length >= MIN_WEEKDAY_DISTRIBUTION_GAMES,
    }] : []
  })
}

export interface DurationRecallScoreBin {
  minute: number
  label: string
  games: number
  median: number | null
}

/**
 * Five-minute duration bins for a descriptive trend. Every observed bin is
 * retained so an ineligible gap cannot be visually connected across.
 */
export function durationRecallScoreBins(
  history: readonly SkillHistoryPoint[],
): DurationRecallScoreBin[] {
  const grouped = new Map<number, number[]>()
  for (const game of history) {
    if (!Number.isFinite(game.recallScore)) continue
    const startMinute = Math.floor(game.durationSecs / 300) * 5
    const values = grouped.get(startMinute) ?? []
    values.push(game.recallScore as number)
    grouped.set(startMinute, values)
  }

  const observedStarts = [...grouped.keys()].sort((left, right) => left - right)
  if (!observedStarts.length) return []

  const starts: number[] = []
  for (
    let startMinute = observedStarts[0];
    startMinute <= observedStarts.at(-1)!;
    startMinute += 5
  ) starts.push(startMinute)

  return starts.map((startMinute) => {
    const values = grouped.get(startMinute) ?? []
    return {
      minute: startMinute + 2.5,
      label: `${startMinute}–${startMinute + 5} min`,
      games: values.length,
      median: values.length >= MIN_DURATION_TREND_GAMES
        ? quantile(values, 0.5)
        : null,
    }
  })
}

interface ComponentRow {
  components: readonly Pick<SkillGradeComponent, "key" | "label">[]
}

export function commonSignatureAxes(rows: readonly ComponentRow[]) {
  if (rows.length === 0) return []
  return rows[0].components
    .filter((component) => rows.every((row) =>
      row.components.some((candidate) => candidate.key === component.key)))
    .map(({ key, label }) => ({ key, label }))
}

export function completeRecentRadar(
  dimensions: readonly { key: string; recentScore?: number }[],
): Array<number | null> | undefined {
  const values = dimensions.map((dimension) =>
    Number.isFinite(dimension.recentScore) ? dimension.recentScore as number : null)
  return values.filter((value) => value !== null).length >= 3 ? values : undefined
}

export function driftSeries(
  windows: readonly { label: string; axes: readonly Pick<StyleAxis, "key" | "value">[] }[],
  key: string,
): Array<number | null> {
  return windows.map((window) => {
    const value = window.axes.find((entry) => entry.key === key)?.value
    return Number.isFinite(value) ? Math.round((value as number) * 100) : null
  })
}
