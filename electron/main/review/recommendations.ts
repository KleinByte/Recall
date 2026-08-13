import type { ChampionChoiceObjective, ChoiceSignal } from "./types.js"
import { confidenceForGames } from "./types.js"
import { groupTimedGames } from "../../../src/helpers/time-contract-core.js"
import { interpolatedQuantile, keyedRandom, type ConfidenceInterval } from "../matches/statistics.js"

export interface RecommendationGame {
  gameId?: number
  championId: number
  championName: string
  playedAt: number
  win: boolean
  kills: number
  deaths: number
  assists: number
  gradeScore?: number
  recallScore?: number
  durationSecs?: number
}

export interface RecommendationCandidate {
  championId: number
  championName: string
  games: RecommendationGame[]
  incompleteChallengeNames?: string[]
}

export interface ChampionRecommendation {
  championId: number
  championName: string
  rank: number
  score: number
  games: number
  wins: number
  losses: number
  adjustedWinRate: number
  /** Legacy/internal compatibility normal score. */
  averageGrade?: number
  /** Visible authoritative Recall average (0-100). */
  averageRecallScore?: number
  kda: number
  confidence: ReturnType<typeof confidenceForGames>
  recentDirection: "up" | "down" | "stable" | "unknown"
  recentInterval?: ConfidenceInterval
  challengeNames: string[]
  signals: ChoiceSignal[]
}

export interface RecommendationDirection {
  direction: "up" | "down" | "stable" | "unknown"
  delta: number | null
  interval: ConfidenceInterval | null
  latestGames: number
  precedingGames: number
  draws: number
}

/** Fixed latest-ten versus preceding-ten Grade posterior comparison. */
export function recommendationDirection(
  input: readonly RecommendationGame[],
  family: string,
  championId: number,
  careerPriorMean: number,
): RecommendationDirection {
  const ordered = [...input].sort((left, right) =>
    right.playedAt - left.playedAt || (right.gameId ?? 0) - (left.gameId ?? 0))
  const labelled = ordered.slice(0, 20).map((game, index) => ({
    ...game,
    period: index < 10 ? "latest" as const : "preceding" as const,
    syntheticId: game.gameId ?? index,
  }))
  const latest = labelled.slice(0, 10).filter((game) => Number.isFinite(game.gradeScore))
  const preceding = labelled.slice(10, 20).filter((game) => Number.isFinite(game.gradeScore))
  const base = { latestGames: latest.length, precedingGames: preceding.length }
  if (latest.length < 5 || preceding.length < 5) {
    return { ...base, direction: "unknown", delta: null, interval: null, draws: 0 }
  }
  const sessions = groupTimedGames(labelled.map((game) => ({
    ...game,
    gameId: game.syntheticId,
    playedAt: game.playedAt,
    durationSecs: game.durationSecs,
  }))).map((group) => group.matches)
  const posterior = (games: typeof labelled) => (
    games.reduce((sum, game) => sum + game.gradeScore!, 0) + 5 * careerPriorMean
  ) / (games.length + 5)
  const delta = posterior(latest) - posterior(preceding)
  const rng = keyedRandom(`recommendation:v3:${family}:${championId}`)
  const samples: number[] = []
  for (let attempt = 0; attempt < 10_000 && samples.length < 2_000; attempt += 1) {
    const latestDraw: typeof labelled = []
    const precedingDraw: typeof labelled = []
    for (let index = 0; index < sessions.length; index += 1) {
      for (const game of sessions[Math.floor(rng() * sessions.length)]) {
        if (!Number.isFinite(game.gradeScore)) continue
        ;(game.period === "latest" ? latestDraw : precedingDraw).push(game)
      }
    }
    if (!latestDraw.length || !precedingDraw.length) continue
    samples.push(posterior(latestDraw) - posterior(precedingDraw))
  }
  if (samples.length < 2_000) {
    return { ...base, direction: "unknown", delta, interval: null, draws: samples.length }
  }
  const interval = { low: interpolatedQuantile(samples, .025)!,
    high: interpolatedQuantile(samples, .975)!, level: .95 as const }
  return { ...base, delta, interval, draws: samples.length,
    direction: interval.low > 0 ? "up" : interval.high < 0 ? "down" : "stable" }
}

const OBJECTIVE_WEIGHTS: Record<
  ChampionChoiceObjective,
  Partial<Record<ChoiceSignal["key"], number>>
> = {
  best_overall: { long_term: .45, recent: .25, reliability: .2, challenges: .1 },
  recent_form: { long_term: .25, recent: .55, reliability: .1, challenges: .1 },
  challenges: { long_term: .25, recent: .15, reliability: .1, challenges: .5 },
  practice: { long_term: .2, recent: .1, novelty: .6, challenges: .1 },
  most_reliable: { long_term: .35, recent: .15, reliability: .5 },
}

const SIGNAL_LABELS: Record<ChoiceSignal["key"], string> = {
  long_term: "Long-term performance",
  recent: "Recent form",
  reliability: "Reliability",
  novelty: "Practice value",
  challenges: "Pinned challenges",
}

function candidatePercentiles(values: number[]): number[] {
  if (values.length <= 1) return values.map(() => 50)
  return values.map((value) => {
    const lower = values.filter((entry) => entry < value).length
    const tied = values.filter((entry) => entry === value).length
    return 100 * (lower + (tied - 1) / 2) / (values.length - 1)
  })
}

function performance(
  games: RecommendationGame[],
  modeWinRate: number,
  modeGrade: number,
) {
  const wins = games.filter((game) => game.win).length
  const graded = games.filter((game) => game.gradeScore !== undefined)
  return {
    winRate: (wins + 6 * modeWinRate) / (games.length + 6),
    grade: (
      graded.reduce((sum, game) => sum + (game.gradeScore ?? 0), 0) +
      5 * modeGrade
    ) / (graded.length + 5),
  }
}

export function recommendChampions(
  candidates: RecommendationCandidate[],
  objective: ChampionChoiceObjective,
  now = Date.now(),
): ChampionRecommendation[] {
  if (candidates.length === 0) return []
  const allGames = candidates.flatMap((candidate) => candidate.games)
  const modeWinRate = allGames.length
    ? allGames.filter((game) => game.win).length / allGames.length
    : .5
  const allGraded = allGames.filter((game) => game.gradeScore !== undefined)
  const modeGrade = allGraded.length
    ? allGraded.reduce((sum, game) => sum + (game.gradeScore ?? 0), 0) / allGraded.length
    : 0

  const raw = candidates.map((candidate) => {
    const games = [...candidate.games].sort((a, b) => b.playedAt - a.playedAt)
    const long = performance(games, modeWinRate, modeGrade)
    const recent = performance(games.slice(0, 10), modeWinRate, modeGrade)
    return { candidate, games, long, recent }
  })
  const longGrade = candidatePercentiles(raw.map((entry) => entry.long.grade))
  const longWin = candidatePercentiles(raw.map((entry) => entry.long.winRate))
  const recentGrade = candidatePercentiles(raw.map((entry) => entry.recent.grade))
  const recentWin = candidatePercentiles(raw.map((entry) => entry.recent.winRate))
  const weights = OBJECTIVE_WEIGHTS[objective]

  const ranked = raw.map((entry, index) => {
    const { candidate, games } = entry
    const reliability = 100 * Math.min(games.length / 20, 1)
    const daysSince = games.length
      ? Math.min(90, Math.max(0, (now - games[0].playedAt) / 86_400_000))
      : 90
    const novelty = .6 * (100 - reliability) + .4 * (100 * daysSince / 90)
    const challenges = candidate.incompleteChallengeNames ?? []
    const values: Record<ChoiceSignal["key"], number> = {
      long_term: .55 * longGrade[index] + .45 * longWin[index],
      recent: .55 * recentGrade[index] + .45 * recentWin[index],
      reliability,
      novelty,
      challenges: challenges.length >= 2 ? 100 : challenges.length === 1 ? 75 : 0,
    }
    const signals = (Object.entries(weights) as [ChoiceSignal["key"], number][])
      .filter(([, weight]) => weight > 0)
      .map(([key, weight]) => ({
        key,
        label: SIGNAL_LABELS[key],
        score: values[key],
        weight,
        contribution: values[key] * weight,
      }))
    const kills = games.reduce((sum, game) => sum + game.kills, 0)
    const deaths = games.reduce((sum, game) => sum + game.deaths, 0)
    const assists = games.reduce((sum, game) => sum + game.assists, 0)
    const direction = recommendationDirection(
      games,
      "active",
      candidate.championId,
      modeGrade,
    )
    return {
      championId: candidate.championId,
      championName: candidate.championName,
      rank: 0,
      score: signals.reduce((sum, signal) => sum + signal.contribution, 0),
      games: games.length,
      wins: games.filter((game) => game.win).length,
      losses: games.filter((game) => !game.win).length,
      adjustedWinRate: entry.long.winRate,
      averageGrade: games.some((game) => game.gradeScore !== undefined)
        ? games.filter((game) => game.gradeScore !== undefined)
          .reduce((sum, game) => sum + (game.gradeScore ?? 0), 0) /
          games.filter((game) => game.gradeScore !== undefined).length
        : undefined,
      averageRecallScore: games.some((game) => game.recallScore !== undefined)
        ? games.filter((game) => game.recallScore !== undefined)
          .reduce((sum, game) => sum + (game.recallScore ?? 0), 0) /
          games.filter((game) => game.recallScore !== undefined).length
        : undefined,
      kda: deaths ? (kills + assists) / deaths : kills + assists,
      confidence: confidenceForGames(games.length),
      recentDirection: direction.direction,
      recentInterval: direction.interval ?? undefined,
      challengeNames: challenges,
      signals,
    }
  })

  const confidenceRank = { solid: 3, fair: 2, thin: 1 }
  ranked.sort((a, b) =>
    b.score - a.score ||
    confidenceRank[b.confidence] - confidenceRank[a.confidence] ||
    b.games - a.games ||
    a.championName.localeCompare(b.championName),
  )
  return ranked.map((entry, index) => ({ ...entry, rank: index + 1 }))
}
