import type { RankedHistory, RankedPoint } from "../types/stats"

export interface RankedSeason {
  id: string
  label: string
  startMs: number
  endMs?: number
}

const localTime = (
  year: number,
  month: number,
  day: number,
  hour = 12,
) => new Date(year, month - 1, day, hour).getTime()

// Riot publishes ranked-season transitions in local server time. Keep these
// explicit: calendar years are not accurate season boundaries.
export const KNOWN_RANKED_SEASONS: RankedSeason[] = [
  {
    id: "2025-s1",
    label: "2025 Season 1",
    startMs: localTime(2025, 1, 9),
    endMs: localTime(2025, 4, 30),
  },
  {
    id: "2025-s2",
    label: "2025 Season 2",
    startMs: localTime(2025, 4, 30),
    endMs: localTime(2025, 8, 27),
  },
  {
    id: "2025-s3",
    label: "2025 Season 3",
    startMs: localTime(2025, 8, 27),
    endMs: localTime(2026, 1, 8),
  },
  {
    id: "2026-s1",
    label: "2026 Season 1",
    startMs: localTime(2026, 1, 8),
    endMs: localTime(2026, 4, 29),
  },
  {
    id: "2026-s2",
    label: "2026 Season 2",
    startMs: localTime(2026, 4, 29),
    endMs: localTime(2026, 7, 29),
  },
  {
    id: "2026-s3",
    label: "2026 Season 3",
    startMs: localTime(2026, 7, 29),
    endMs: new Date(2027, 0, 1).getTime(),
  },
]

function annualSeason(year: number): RankedSeason {
  return {
    id: `${year}-ranked-year`,
    label: `${year} ranked year`,
    startMs: new Date(year, 0, 1).getTime(),
    endMs: new Date(year + 1, 0, 1).getTime(),
  }
}

export function rankedSeasonAt(timestamp: number): RankedSeason {
  const known = KNOWN_RANKED_SEASONS.find((season) =>
    timestamp >= season.startMs &&
    (season.endMs === undefined || timestamp < season.endMs),
  )
  return known ?? annualSeason(new Date(timestamp).getFullYear())
}

export function currentRankedSeason(now = Date.now()): RankedSeason {
  return rankedSeasonAt(now)
}

export function pointsForSeason(
  points: RankedPoint[],
  season: RankedSeason,
) {
  return points.filter((point) =>
    point.recordedAt >= season.startMs &&
    (season.endMs === undefined || point.recordedAt < season.endMs),
  )
}

export function seasonsWithRankedHistory(
  histories: RankedHistory[],
): RankedSeason[] {
  const byId = new Map<string, RankedSeason>()
  for (const history of histories) {
    for (const point of history.points) {
      const season = rankedSeasonAt(point.recordedAt)
      byId.set(season.id, season)
    }
  }
  return [...byId.values()].sort((left, right) => right.startMs - left.startMs)
}
