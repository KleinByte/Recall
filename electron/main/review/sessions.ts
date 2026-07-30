import type { MatchRow, TrackedMode } from "../matches/types.js"

export type SessionBoundaryAction = "split" | "join"

export interface ReviewSession {
  id: string
  startAt: number
  endAt: number
  playTimeSecs: number
  games: number
  wins: number
  losses: number
  winRate: number
  avgGradeScore?: number
  championCount: number
  bestMatch?: MatchRow
  lowestMatch?: MatchRow
  trend?: "improved" | "declined" | "stable"
  trendDelta?: number
  modes: { mode: TrackedMode; games: number; wins: number }[]
  champions: { championId: number; games: number; wins: number }[]
  matches: MatchRow[]
}

const SESSION_GAP_MS = 90 * 60 * 1000

export function buildSessions(
  matches: MatchRow[],
  overrides: ReadonlyMap<number, SessionBoundaryAction> = new Map(),
): ReviewSession[] {
  const ordered = [...matches].sort((a, b) =>
    a.playedAt - b.playedAt || a.gameId - b.gameId,
  )
  const groups: MatchRow[][] = []
  for (const match of ordered) {
    const group = groups.at(-1)
    if (!group) {
      groups.push([match])
      continue
    }
    const previous = group.at(-1)!
    const action = overrides.get(match.gameId)
    const gap = match.playedAt - (
      previous.playedAt + previous.durationSecs * 1000
    )
    if (action === "split" || (action !== "join" && gap > SESSION_GAP_MS)) {
      groups.push([match])
    } else {
      group.push(match)
    }
  }
  return groups.reverse().map(summarizeSession)
}

function summarizeSession(matches: MatchRow[]): ReviewSession {
  const eligible = matches.filter((match) => match.durationSecs >= 300)
  const graded = eligible.filter((match) => match.gradeScore !== undefined)
  const modes = new Map<TrackedMode, { games: number; wins: number }>()
  const champions = new Map<number, { games: number; wins: number }>()
  for (const match of matches) {
    const mode = modes.get(match.mode) ?? { games: 0, wins: 0 }
    mode.games += 1
    mode.wins += match.win
    modes.set(match.mode, mode)
    const champion = champions.get(match.championId) ?? { games: 0, wins: 0 }
    champion.games += 1
    champion.wins += match.win
    champions.set(match.championId, champion)
  }
  const sortedGraded = [...graded].sort(
    (a, b) => (b.gradeScore ?? 0) - (a.gradeScore ?? 0),
  )
  let trend: ReviewSession["trend"]
  let trendDelta: number | undefined
  if (graded.length >= 4) {
    const half = Math.floor(graded.length / 2)
    const average = (rows: MatchRow[]) =>
      rows.reduce((sum, match) => sum + (match.gradeScore ?? 0), 0) / rows.length
    trendDelta = average(graded.slice(half)) - average(graded.slice(0, half))
    trend = trendDelta >= .25
      ? "improved"
      : trendDelta <= -.25
        ? "declined"
        : "stable"
  }
  const wins = eligible.reduce((sum, match) => sum + match.win, 0)
  const first = matches[0]
  const last = matches.at(-1)!
  return {
    id: `${first.gameId}`,
    startAt: first.playedAt,
    endAt: last.playedAt + last.durationSecs * 1000,
    playTimeSecs: matches.reduce((sum, match) => sum + match.durationSecs, 0),
    games: eligible.length,
    wins,
    losses: eligible.length - wins,
    winRate: eligible.length ? wins / eligible.length : 0,
    avgGradeScore: graded.length
      ? graded.reduce((sum, match) => sum + (match.gradeScore ?? 0), 0) / graded.length
      : undefined,
    championCount: champions.size,
    bestMatch: sortedGraded[0],
    lowestMatch: sortedGraded.at(-1),
    trend,
    trendDelta,
    modes: [...modes].map(([mode, value]) => ({ mode, ...value })),
    champions: [...champions].map(([championId, value]) => ({ championId, ...value })),
    matches,
  }
}
