/**
 * The ranked ladder, expressed as a single number.
 *
 * A tier, a division and a league point total are three separate things, which
 * makes progress impossible to draw. Folding them into one running total means
 * a climb reads as a line going up, and a demotion as one going down.
 */

export interface RankedSnapshot {
  puuid: string
  queue: string
  recordedAt: number
  tier: string
  division: string
  leaguePoints: number
  wins: number
  losses: number
}

const TIERS = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
]

/** Divisions count downwards, so IV is the entry point and I the exit. */
const DIVISIONS = ["IV", "III", "II", "I"]

/** Master and above have no divisions; league points run without limit. */
const APEX_TIERS = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"])

const POINTS_PER_DIVISION = 100
const POINTS_PER_TIER = POINTS_PER_DIVISION * DIVISIONS.length

export function rankToPoints(
  tier: string,
  division: string,
  leaguePoints: number,
): number {
  const tierIndex = TIERS.indexOf(tier?.toUpperCase())
  if (tierIndex < 0) return 0

  const divisionIndex = Math.max(0, DIVISIONS.indexOf(division?.toUpperCase()))

  return (
    tierIndex * POINTS_PER_TIER +
    divisionIndex * POINTS_PER_DIVISION +
    leaguePoints
  )
}

export function formatRank(tier: string, division: string): string {
  if (!tier || tier === "NONE") return "Unranked"

  const name = tier.charAt(0) + tier.slice(1).toLowerCase()

  return APEX_TIERS.has(tier.toUpperCase()) ? name : `${name} ${division}`
}
