import { recallGradeFromScore, type RecallGrade } from "../../../src/shared/recall-grade.js"
import { subtractCalendarDays } from "./time-contract.js"

export const CHAMPION_FORM_VERSION = 2
export const FORM_WINDOW_DAYS = 90
export const FORM_PRIOR_GAMES = 8
export const FORM_MAIN_MIN_GAMES = 5
export const FORM_EARLY_MAX_GAMES = 4
export const FORM_Z80 = 0.8416212336

export type ChampionFormFamily = "sr" | "aram" | "classic"

export interface ChampionFormGame {
  championId: number
  family: "sr" | "aram" | "classic" | "other"
  playedAt: number
  gradeScore?: number | null
  gradeEligible: boolean
  analyticsEligible: boolean
  win: boolean
  kills: number
  deaths: number
  assists: number
}

export interface ChampionFormRowV2 {
  version: 2
  championId: number
  gradedGames: number
  totalEligibleGames: number
  posteriorMean: number
  posteriorSE: number
  lower80: number
  upper80: number
  rankScore: number
  confidence: "thin" | "fair" | "solid"
  displayGrade: RecallGrade
  lastEligiblePlayedAt: number
  winRate: number
  kda: number
}

export interface ChampionFormV2 {
  version: 2
  activeFamily: ChampionFormFamily | null
  reason?: "no_supported_grade_history"
  window: { lowerMs: number; asOfMs: number; timeZone: string }
  baselineMean: number | null
  baselineSampleSd: number
  main: ChampionFormRowV2[]
  earlySignals: ChampionFormRowV2[]
  gameWeightedMean: number | null
}

const finiteGrade = (game: ChampionFormGame): game is ChampionFormGame & { gradeScore: number } =>
  typeof game.gradeScore === "number" && Number.isFinite(game.gradeScore)

const average = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length

const sampleSd = (values: readonly number[]) => {
  if (values.length < 2) return 1
  const center = average(values)
  const value = Math.sqrt(values.reduce((sum, entry) => sum + (entry - center) ** 2, 0) /
    (values.length - 1))
  return Number.isFinite(value) ? value : 1
}

const confidence = (games: number): ChampionFormRowV2["confidence"] =>
  games >= 12 ? "solid" : games >= 5 ? "fair" : "thin"

const compareRows = (left: ChampionFormRowV2, right: ChampionFormRowV2) =>
  right.rankScore - left.rankScore || right.gradedGames - left.gradedGames ||
  right.lastEligiblePlayedAt - left.lastEligiblePlayedAt || left.championId - right.championId

export function buildChampionFormV2(
  games: readonly ChampionFormGame[],
  options: {
    asOfMs: number
    timeZone: string
    family?: ChampionFormFamily
  },
): ChampionFormV2 {
  const lowerMs = subtractCalendarDays(options.asOfMs, FORM_WINDOW_DAYS, options.timeZone)
  const supported = games.filter((game): game is ChampionFormGame & { family: ChampionFormFamily } =>
    game.gradeEligible && game.family !== "other")
    .sort((left, right) => right.playedAt - left.playedAt)
  const activeFamily = options.family ?? supported[0]?.family ?? null
  const base = {
    version: 2 as const,
    activeFamily,
    window: { lowerMs, asOfMs: options.asOfMs, timeZone: options.timeZone },
  }
  if (!activeFamily) {
    return {
      ...base, reason: "no_supported_grade_history",
      baselineMean: null, baselineSampleSd: 1,
      main: [], earlySignals: [], gameWeightedMean: null,
    }
  }

  const career = games.filter((game) => game.family === activeFamily && game.gradeEligible && finiteGrade(game))
  const careerGrades = career.flatMap((game) => finiteGrade(game) ? [game.gradeScore] : [])
  const baselineMean = careerGrades.length ? average(careerGrades) : 0
  const baselineSampleSd = sampleSd(careerGrades)
  const recent = games.filter((game) => game.family === activeFamily && game.analyticsEligible &&
    game.playedAt >= lowerMs && game.playedAt <= options.asOfMs)
  const byChampion = new Map<number, ChampionFormGame[]>()
  recent.forEach((game) => {
    const rows = byChampion.get(game.championId) ?? []
    rows.push(game)
    byChampion.set(game.championId, rows)
  })

  const rows: ChampionFormRowV2[] = []
  for (const [championId, eligible] of byChampion) {
    const graded = eligible.filter((game) => game.gradeEligible && finiteGrade(game))
    if (graded.length === 0) continue
    const n = graded.length
    const m = average(graded.flatMap((game) => finiteGrade(game) ? [game.gradeScore] : []))
    const posteriorMean = (n * m + FORM_PRIOR_GAMES * baselineMean) /
      (n + FORM_PRIOR_GAMES)
    const posteriorSE = baselineSampleSd / Math.sqrt(n + FORM_PRIOR_GAMES)
    const lower80 = posteriorMean - FORM_Z80 * posteriorSE
    const upper80 = posteriorMean + FORM_Z80 * posteriorSE
    const wins = eligible.filter((game) => game.win).length
    const killsAndAssists = eligible.reduce((sum, game) => sum + game.kills + game.assists, 0)
    const deaths = eligible.reduce((sum, game) => sum + game.deaths, 0)
    rows.push({
      version: 2,
      championId,
      gradedGames: n,
      totalEligibleGames: eligible.length,
      posteriorMean,
      posteriorSE,
      lower80,
      upper80,
      rankScore: lower80,
      confidence: confidence(n),
      displayGrade: recallGradeFromScore(posteriorMean)!,
      lastEligiblePlayedAt: Math.max(...eligible.map((game) => game.playedAt)),
      winRate: wins / eligible.length,
      kda: deaths === 0 ? killsAndAssists : killsAndAssists / deaths,
    })
  }
  rows.sort(compareRows)
  const recentGrades = recent.flatMap((game) =>
    game.gradeEligible && finiteGrade(game) ? [game.gradeScore] : [])
  return {
    ...base,
    baselineMean: careerGrades.length ? baselineMean : null,
    baselineSampleSd,
    main: rows.filter((row) => row.gradedGames >= FORM_MAIN_MIN_GAMES),
    earlySignals: rows.filter((row) => row.gradedGames >= 1 && row.gradedGames <= FORM_EARLY_MAX_GAMES),
    gameWeightedMean: recentGrades.length ? average(recentGrades) : null,
  }
}
