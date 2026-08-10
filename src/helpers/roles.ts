import {
  POSITION_RESOLVER_VERSION,
  POSITIONS,
  resolvePosition,
  type Position,
} from "./position-core"

export { POSITION_RESOLVER_VERSION, POSITIONS, resolvePosition, type Position } from "./position-core"

export interface PositionInfo {
  label: string
  asset: string
}

const INFO: Record<Position, PositionInfo> = {
  TOP: { label: "Top", asset: "top" },
  JUNGLE: { label: "Jungle", asset: "jungle" },
  MIDDLE: { label: "Mid", asset: "middle" },
  BOTTOM: { label: "Bot", asset: "bottom" },
  UTILITY: { label: "Support", asset: "utility" },
}

const POSITION_ASSET_ROOT =
  "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-champ-select/global/default/svg"

export const positionLabel = (position?: Position) =>
  position ? INFO[position].label : "Unknown"

/** Riot's own champ-select position art, exported through CommunityDragon. */
export const positionIconUrl = (position?: Position) =>
  `${POSITION_ASSET_ROOT}/position-${position ? INFO[position].asset : "lane"}.svg`

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
  resolvedPosition?: string
  positionResolverVersion?: number
}

/** Uses the persisted resolver result only when it was produced by this build. */
export const positionForPlayer = (player: Positioned) =>
  player.positionResolverVersion === POSITION_RESOLVER_VERSION
    ? resolvePosition(undefined, player.resolvedPosition) ??
      resolvePosition(player.lane, player.role, player.assignedPosition)
    : resolvePosition(player.lane, player.role, player.assignedPosition)

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
    const found = players.map(positionForPlayer)
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
