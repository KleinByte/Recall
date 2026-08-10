/**
 * Judgements drawn from recorded games.
 *
 * Everything here is pure: the same numbers in, the same answer out, with no
 * database and no Electron. The queries that feed it live in
 * `database/insights-repo.ts`.
 */

import type { ChampionStatRow } from "../database/matches-repo.js"
import { buildStyleProfile, type StyleAxis } from "./style.js"
import type { ModeFamily, ParticipantRow } from "./types.js"

/**
 * How many games of evidence the player's own average is worth.
 *
 * A champion played once has said almost nothing, and treating its result as
 * fact puts a single lucky game at the top of the list. Weighting the player's
 * overall average as though it were three games means one game moves the
 * needle a quarter of the way, while five games mostly speak for themselves.
 */
export const PRIOR_WEIGHT = 3

export type Confidence = "thin" | "fair" | "solid"

export function shrinkToward(
  value: number,
  games: number,
  baseline: number,
): number {
  return (games * value + PRIOR_WEIGHT * baseline) / (games + PRIOR_WEIGHT)
}

export function confidenceOf(games: number): Confidence {
  if (games >= 12) return "solid"
  if (games >= 5) return "fair"
  return "thin"
}

export interface RankedChampion {
  championId: number
  games: number
  gradedGames: number
  winRate: number
  kda: number
  rawGrade?: number
  adjustedGrade: number
  /** Visible authoritative Recall average; never reliability-shrunk. */
  recallScore?: number
  confidence: Confidence
}

/**
 * Orders champions by how well the player actually performs on them.
 *
 * A champion with no graded games sits at the baseline rather than at either
 * extreme, because absence of evidence is not evidence of skill.
 */
export function rankChampions(
  rows: ChampionStatRow[],
  baseline: number,
): RankedChampion[] {
  return rows
    .filter((row) => row.gradedGames >= 5 && Number.isFinite(row.avgGradeScore))
    .map((row) => ({
      championId: row.championId,
      games: row.games,
      gradedGames: row.gradedGames,
      winRate: row.winRate,
      kda: row.kda,
      rawGrade: row.avgGradeScore,
      recallScore: row.averageRecallScore,
      adjustedGrade: shrinkToward(
        row.avgGradeScore!,
        row.gradedGames,
        baseline,
      ),
      confidence: confidenceOf(row.gradedGames),
    }))
    .sort((a, b) =>
      b.adjustedGrade - a.adjustedGrade ||
      b.gradedGames - a.gradedGames ||
      a.championId - b.championId)
}

export function splitChampionSignals(
  rows: ChampionStatRow[],
  baseline: number,
): { main: RankedChampion[]; earlySignals: RankedChampion[] } {
  const earlySignals = rows
    .filter((row) => row.gradedGames >= 1 && row.gradedGames <= 4 &&
      Number.isFinite(row.avgGradeScore))
    .map((row) => ({
      championId: row.championId,
      games: row.games,
      gradedGames: row.gradedGames,
      winRate: row.winRate,
      kda: row.kda,
      rawGrade: row.avgGradeScore,
      recallScore: row.averageRecallScore,
      adjustedGrade: shrinkToward(row.avgGradeScore!, row.gradedGames, baseline),
      confidence: confidenceOf(row.gradedGames),
    }))
    .sort((a, b) =>
      b.adjustedGrade - a.adjustedGrade ||
      b.gradedGames - a.gradedGames ||
      a.championId - b.championId)
  return { main: rankChampions(rows, baseline), earlySignals }
}

/**
 * The strongest and weakest champions, taken from one ordered list.
 *
 * Slicing the head and the tail independently overlaps as soon as there are
 * fewer than twice `count` champions, which put the same champion in both
 * lists. Taking the worst from what the best did not claim cannot.
 */
export function pickBestAndWorst(
  ranked: RankedChampion[],
  count: number,
): { best: RankedChampion[]; worst: RankedChampion[] } {
  const best = ranked.slice(0, count)
  const remainder = ranked.slice(count)

  return { best, worst: remainder.slice(-count).reverse() }
}

export interface DurationBucket {
  label: string
  /** Upper bound in seconds; everything below the previous bound is excluded. */
  maxSecs: number
}

/**
 * Bands of game length.
 *
 * A twenty minute ARAM is a long game and a twenty minute Rift game is a
 * surrender, so the two families cannot share bands.
 */
export function durationBucketsFor(family: ModeFamily): DurationBucket[] {
  if (family === "sr" || family === "classic") {
    return [
      { label: "Under 22 min", maxSecs: 1320 },
      { label: "22–28 min", maxSecs: 1680 },
      { label: "28–34 min", maxSecs: 2040 },
      { label: "34 min +", maxSecs: Number.MAX_SAFE_INTEGER },
    ]
  }

  return [
    { label: "Under 12 min", maxSecs: 720 },
    { label: "12–16 min", maxSecs: 960 },
    { label: "16–20 min", maxSecs: 1200 },
    { label: "20 min +", maxSecs: Number.MAX_SAFE_INTEGER },
  ]
}

/**
 * One game's shape, on the same axes as the career web.
 *
 * The averages a career profile is built from are, for a single game, simply
 * that game's own ratios. Reusing the profile builder rather than repeating
 * six formulas keeps a game and a career directly comparable, and stops the
 * two definitions drifting apart.
 */
export function matchAxes(
  row: ParticipantRow,
  durationSecs: number,
  family: ModeFamily,
): StyleAxis[] {
  const minutes = Math.max(1, durationSecs / 60)
  const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : 0)

  const profile = buildStyleProfile(
    {
      games: 1,
      aggression: ratio(row.kills, row.kills + row.assists),
      damage: ratio(
        row.damageToChampions,
        row.damageToChampions + row.damageTaken,
      ),
      durability: ratio(
        row.damageSelfMitigated,
        row.damageSelfMitigated + row.damageTaken,
      ),
      farming: 0,
      objectives: ratio(
        row.damageObjectives,
        row.damageObjectives + row.damageToChampions,
      ),
      sustain: ratio(row.totalHeal, row.totalHeal + row.damageTaken),
      visionPerMin: row.visionScore / minutes,
      ccPerMin: row.timeCcingOthers / minutes,
      damagePerMin: row.damageToChampions / minutes,
      goldPerMin: row.goldEarned / minutes,
      csPerMin: (row.totalMinionsKilled + row.neutralMinions) / minutes,
      avgDeaths: row.deaths,
      avgLargestSpree: row.largestKillingSpree,
      doubleKills: row.doubleKills,
      tripleKills: row.tripleKills,
      quadraKills: row.quadraKills,
      pentaKills: row.pentaKills,
    },
    family,
  )

  return profile?.axes ?? []
}
