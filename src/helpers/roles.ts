import {
  faChessRook,
  faCrosshairs,
  faHandHoldingHeart,
  faShieldHalved,
  faTree,
  faWandMagicSparkles,
} from "@fortawesome/free-solid-svg-icons"
import type { IconDefinition } from "@fortawesome/free-solid-svg-icons"
import {
  POSITIONS,
  resolvePosition,
  type Position,
} from "./position-core"

export { POSITIONS, resolvePosition, type Position } from "./position-core"

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
 * Pairs each player against the enemy who played their position when Riot gave
 * both teams a complete, unambiguous set. If even one position is unresolved,
 * the whole lobby stays in Riot's participant order; partially sorting a team
 * makes the unknown player appear to move to the bottom and invents matchups.
 * Roleless modes always use that original order.
 */
export function laneMatchups<T extends Positioned>(
  left: T[],
  right: T[],
  usePositions = true,
): Matchup<T>[] {
  const take = (players: T[]) => {
    const claimed = new Map<Position, T>()
    const found = players.map((player) =>
      resolvePosition(player.lane, player.role, player.assignedPosition),
    )
    const listed = found.map((position) =>
      position !== undefined && found.indexOf(position) === found.lastIndexOf(position)
        ? position
        : undefined,
    )
    const complete = listed.every((position) => position !== undefined)

    players.forEach((player, index) => {
      const position = listed[index]
      if (position) claimed.set(position, player)
    })

    return { claimed, listed, complete }
  }

  const first = take(left)
  const second = take(right)

  if (!usePositions || !first.complete || !second.complete) {
    return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => {
      const leftPosition = first.listed[index]
      const rightPosition = second.listed[index]
      return {
        key: `listed-${index}`,
        position:
          usePositions && leftPosition === rightPosition
            ? leftPosition
            : undefined,
        left: left[index],
        right: right[index],
      }
    })
  }

  const rows: Matchup<T>[] = []

  for (const position of POSITIONS) {
    const one = first.claimed.get(position)
    const other = second.claimed.get(position)
    if (!one && !other) continue
    rows.push({ key: position, position, left: one, right: other })
  }

  return rows
}
