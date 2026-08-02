import {
  faChessRook,
  faCrosshairs,
  faHandHoldingHeart,
  faShieldHalved,
  faTree,
  faWandMagicSparkles,
} from "@fortawesome/free-solid-svg-icons"
import type { IconDefinition } from "@fortawesome/free-solid-svg-icons"

/** Rift positions in the order a scoreboard reads from top to bottom. */
export const POSITIONS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const

export type Position = typeof POSITIONS[number]

export interface PositionInfo {
  label: string
  icon: IconDefinition
}

const INFO: Record<Position, PositionInfo> = {
  TOP: { label: "Top", icon: faShieldHalved },
  JUNGLE: { label: "Jungle", icon: faTree },
  MIDDLE: { label: "Mid", icon: faWandMagicSparkles },
  BOTTOM: { label: "Bot", icon: faCrosshairs },
  UTILITY: { label: "Support", icon: faHandHoldingHeart },
}

const ALIASES: Record<string, Position> = {
  TOP: "TOP",
  SOLO_TOP: "TOP",
  JUNGLE: "JUNGLE",
  JUNGLER: "JUNGLE",
  MID: "MIDDLE",
  MIDDLE: "MIDDLE",
  BOT: "BOTTOM",
  BOTTOM: "BOTTOM",
  ADC: "BOTTOM",
  CARRY: "BOTTOM",
  DUO_CARRY: "BOTTOM",
  UTILITY: "UTILITY",
  SUPPORT: "UTILITY",
  DUO_SUPPORT: "UTILITY",
}

/**
 * Riot reports the position differently per source: Match-V5 stores a canonical
 * team position in `role`, while League Client history stores a lane plus a
 * duo hint. Both are folded into one value here so the two can be compared.
 *
 * Champion select, where we have it, wins: lane and role are classified after
 * the game and misread swaps, double junglers and other off-meta setups.
 */
export function resolvePosition(
  lane?: string,
  role?: string,
  assigned?: string,
): Position | undefined {
  const assignedKey = ALIASES[assigned?.toUpperCase() ?? ""]
  if (assignedKey) return assignedKey

  const laneKey = lane?.toUpperCase() ?? ""
  const roleKey = role?.toUpperCase() ?? ""
  const direct = ALIASES[roleKey]

  if (laneKey === "BOTTOM" || laneKey === "BOT") {
    return direct === "UTILITY" ? "UTILITY" : "BOTTOM"
  }

  return ALIASES[laneKey] ?? direct
}

export const positionLabel = (position?: Position) =>
  position ? INFO[position].label : "Unknown"

export const positionIcon = (position?: Position) =>
  position ? INFO[position].icon : faChessRook

export interface Matchup<T> {
  key: string
  position?: Position
  left?: T
  right?: T
}

interface Positioned {
  lane?: string
  role?: string
  assignedPosition?: string
}

/**
 * Pairs each player against the enemy who played their position, so a lane can
 * be read straight across the row. Anyone whose position is unknown, missing or
 * duplicated inside a team keeps their listed order in the leftover rows.
 */
export function laneMatchups<T extends Positioned>(
  left: T[],
  right: T[],
): Matchup<T>[] {
  const take = (players: T[]) => {
    const claimed = new Map<Position, T>()
    const rest: T[] = []

    for (const player of players) {
      const position = resolvePosition(player.lane, player.role, player.assignedPosition)
      if (position && !claimed.has(position)) claimed.set(position, player)
      else rest.push(player)
    }

    return { claimed, rest }
  }

  const first = take(left)
  const second = take(right)
  const rows: Matchup<T>[] = []

  for (const position of POSITIONS) {
    const one = first.claimed.get(position)
    const other = second.claimed.get(position)
    if (!one && !other) continue
    rows.push({ key: position, position, left: one, right: other })
  }

  const leftovers = Math.max(first.rest.length, second.rest.length)
  for (let index = 0; index < leftovers; index += 1) {
    rows.push({
      key: `unpaired-${index}`,
      left: first.rest[index],
      right: second.rest[index],
    })
  }

  return rows
}
