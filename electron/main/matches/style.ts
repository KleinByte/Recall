/**
 * Playstyle fingerprint for a set of recorded games.
 *
 * Recall stores only the local player's row per match, so nothing in history
 * can be scored against real opponents. Rather than invent benchmarks, each
 * axis is a proportion between two things the player actually did: how much of
 * their damage went into champions rather than being absorbed, how much of
 * their gold came from farming, and so on. The result describes how someone
 * plays, not how good they are — the grade already covers that.
 */

import type { ModeFamily } from "./types.js"

/** A minion is worth roughly this much gold, so farm income can be separated. */
export const GOLD_PER_MINION = 21

/** Vision score per minute that fills the vision ring. */
const VISION_PER_MINUTE_FULL = 2

/** Seconds of crowd control per minute that fill the teamfighting ring. */
const CC_SECONDS_PER_MINUTE_FULL = 20

/**
 * Averages of per-game values.
 *
 * Ratios are averaged per game rather than computed from career totals, so one
 * very long or very extreme game cannot dominate the shape.
 */
export interface StyleAverages {
  games: number
  aggression: number
  damage: number
  durability: number
  farming: number
  objectives: number
  sustain: number
  visionPerMin: number
  ccPerMin: number
  damagePerMin: number
  goldPerMin: number
  csPerMin: number
  avgDeaths: number
  avgLargestSpree: number
  doubleKills: number
  tripleKills: number
  quadraKills: number
  pentaKills: number
}

export interface StyleAxis {
  key: string
  label: string
  /** Fraction of the ring, always between 0 and 1. */
  value: number
  description: string
}

export interface StyleDetail {
  damagePerMin: number
  goldPerMin: number
  csPerMin: number
  visionPerMin: number
  avgDeaths: number
  avgLargestSpree: number
  doubleKills: number
  tripleKills: number
  quadraKills: number
  pentaKills: number
}

export interface StyleProfile {
  games: number
  axes: StyleAxis[]
  detail: StyleDetail
}

const clamp = (value: number) => Math.min(1, Math.max(0, value))

const rate = (value: number, full: number) => clamp(value / full)

/**
 * The axes each mode family is judged on.
 *
 * Wards and objectives barely exist on the Howling Abyss, so scoring them there
 * would leave two spokes permanently flat and squash the rest of the shape.
 */
function axesFor(averages: StyleAverages, family: ModeFamily): StyleAxis[] {
  const shared: StyleAxis[] = [
    {
      key: "aggression",
      label: "Aggression",
      value: clamp(averages.aggression),
      description: "Share of your kill involvement that is kills, not assists",
    },
    {
      key: "damage",
      label: "Damage",
      value: clamp(averages.damage),
      description: "Damage dealt against damage taken",
    },
    {
      key: "durability",
      label: "Durability",
      value: clamp(averages.durability),
      description: "Damage you shrugged off against damage that landed",
    },
    {
      key: "farming",
      label: "Farming",
      value: clamp(averages.farming),
      description: "Share of your gold earned from minions",
    },
  ]

  if (family === "sr") {
    return [
      ...shared,
      {
        key: "objectives",
        label: "Objectives",
        value: clamp(averages.objectives),
        description: "Damage into objectives against damage into champions",
      },
      {
        key: "vision",
        label: "Vision",
        value: rate(averages.visionPerMin, VISION_PER_MINUTE_FULL),
        description: `Vision score per minute, full at ${VISION_PER_MINUTE_FULL}`,
      },
    ]
  }

  return [
    ...shared,
    {
      key: "sustain",
      label: "Sustain",
      value: clamp(averages.sustain),
      description: "Healing against damage taken",
    },
    {
      key: "teamfighting",
      label: "Teamfighting",
      value: rate(averages.ccPerMin, CC_SECONDS_PER_MINUTE_FULL),
      description: `Crowd control per minute, full at ${CC_SECONDS_PER_MINUTE_FULL}s`,
    },
  ]
}

/**
 * Builds the shape for one mode family.
 *
 * Returns `undefined` when nothing has been recorded, so callers show an empty
 * state rather than a web of zeroes that looks like a terrible player.
 */
export function buildStyleProfile(
  averages: StyleAverages | undefined,
  family: ModeFamily,
): StyleProfile | undefined {
  if (!averages || averages.games === 0) return undefined

  return {
    games: averages.games,
    axes: axesFor(averages, family),
    detail: {
      damagePerMin: averages.damagePerMin,
      goldPerMin: averages.goldPerMin,
      csPerMin: averages.csPerMin,
      visionPerMin: averages.visionPerMin,
      avgDeaths: averages.avgDeaths,
      avgLargestSpree: averages.avgLargestSpree,
      doubleKills: averages.doubleKills,
      tripleKills: averages.tripleKills,
      quadraKills: averages.quadraKills,
      pentaKills: averages.pentaKills,
    },
  }
}
