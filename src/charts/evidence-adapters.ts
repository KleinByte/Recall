import type {
  SkillGradeComponent,
  SkillHistoryPoint,
  StyleAxis,
} from "../types/stats"

export interface CalendarDay {
  date: string
  gradeScore: number | null
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
    if (Number.isFinite(game.gradeScore)) day.scores.push(game.gradeScore as number)
    grouped.set(key, day)
  }
  return [...grouped].map(([date, day]) => ({
    date,
    gradeScore: day.scores.length
      ? day.scores.reduce((sum, score) => sum + score, 0) / day.scores.length
      : null,
    games: day.games,
    wins: day.wins,
  }))
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const

export function weekdayGradeGroups(history: readonly SkillHistoryPoint[]) {
  return WEEKDAYS.flatMap((label, index) => {
    const values = history
      .filter((game) => ((new Date(game.playedAt).getDay() + 6) % 7) === index &&
        Number.isFinite(game.gradeScore))
      .map((game) => game.gradeScore as number)
    return values.length ? [{ label, values }] : []
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
): number[] | undefined {
  const values = dimensions.map((dimension) => dimension.recentScore)
  return values.every(Number.isFinite) ? values as number[] : undefined
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
