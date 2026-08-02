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

const CANONICAL = new Set<string>(POSITIONS)

/**
 * Riot reports the position differently per source: Match-V5 states a canonical
 * team position in `role`, while League Client history stores a lane plus a duo
 * hint. Both are folded into one value here so the two can be compared.
 *
 * Order matters and mirrors `normalizedRole` in the matches repository. Match-V5
 * is taken at its word; the client's lane is only consulted after, because it
 * reports the whole team as JUNGLE often enough to hide the real top laner.
 * A duo hint on its own means nothing without a lane to place it in: short games
 * come back with every player marked SUPPORT and no lane at all.
 *
 * Champion select, where we have it, beats both.
 */
export function resolvePosition(
  lane?: string,
  role?: string,
  assigned?: string,
): Position | undefined {
  const assignedKey = ALIASES[assigned?.toUpperCase() ?? ""]
  if (assignedKey) return assignedKey

  const roleKey = role?.toUpperCase() ?? ""
  if (CANONICAL.has(roleKey)) return roleKey as Position

  const laneName = ALIASES[lane?.toUpperCase() ?? ""]
  if (!laneName) return undefined
  if (laneName === "BOTTOM") return ALIASES[roleKey] === "UTILITY" ? "UTILITY" : "BOTTOM"

  return laneName
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
 * contested inside a team keeps their listed order in the leftover rows.
 */
export function laneMatchups<T extends Positioned>(
  left: T[],
  right: T[],
): Matchup<T>[] {
  const take = (players: T[]) => {
    const claimed = new Map<Position, T>()
    const rest: T[] = []
    const found = players.map((player) =>
      resolvePosition(player.lane, player.role, player.assignedPosition),
    )

    players.forEach((player, index) => {
      const position = found[index]
      // One player holds a position per team, so a contested one is a misread.
      const sole = position && found.indexOf(position) === found.lastIndexOf(position)
      if (sole) claimed.set(position, player)
      else rest.push(player)
    })

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
