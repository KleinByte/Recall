/** Summoner's Rift positions in scoreboard order. */
export const POSITIONS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const

export type Position = typeof POSITIONS[number]
export type NormalizedPosition = Position | "UNKNOWN"
export const POSITION_RESOLVER_VERSION = 3
export const SUMMONER_SMITE_ID = 11

const CANONICAL = new Set<string>(POSITIONS)

const ASSIGNED_ALIASES: Record<string, Position> = {
  TOP: "TOP",
  JUNGLE: "JUNGLE",
  JUNGLER: "JUNGLE",
  MID: "MIDDLE",
  MIDDLE: "MIDDLE",
  BOT: "BOTTOM",
  BOTTOM: "BOTTOM",
  ADC: "BOTTOM",
  UTILITY: "UTILITY",
  SUPPORT: "UTILITY",
}

const upper = (value?: string) => value?.trim().toUpperCase() ?? ""

/**
 * Resolves the two incompatible position vocabularies stored by Recall.
 *
 * Match-V5's canonical team/individual position is the best estimate of what
 * was actually played. Champion select says what the queue assigned and is a
 * valuable fallback when post-game data is missing. Old LCU history exposes
 * only a lane plus SOLO/CARRY/SUPPORT-style hints, so it is considered last.
 */
export function resolvePosition(
  lane?: string,
  role?: string,
  assigned?: string,
): Position | undefined {
  const roleKey = upper(role)
  if (CANONICAL.has(roleKey)) return roleKey as Position

  const assignedPosition = ASSIGNED_ALIASES[upper(assigned)]
  if (assignedPosition) return assignedPosition

  const laneKey = upper(lane)
  if (laneKey === "BOTTOM" || laneKey === "BOT") {
    return roleKey === "SUPPORT" || roleKey === "DUO_SUPPORT"
      ? "UTILITY"
      : "BOTTOM"
  }
  if (laneKey === "TOP" || laneKey === "JUNGLE" || laneKey === "MIDDLE") {
    return laneKey
  }

  // A legacy duo hint has no positional meaning without a usable lane. This
  // is common in short games where LCU labels most or all players SUPPORT.
  return undefined
}

export interface PositionFacts {
  matchV5TeamPosition?: string | null
  matchV5IndividualPosition?: string | null
  assignedPosition?: string | null
  lcuLane?: string | null
  lcuRole?: string | null
  legacyLane?: string | null
  legacyRole?: string | null
  spell1Id?: number | null
  spell2Id?: number | null
}

const canonicalPosition = (value?: string | null): Position | undefined =>
  ASSIGNED_ALIASES[upper(value ?? undefined)]

export function normalizePosition(facts: PositionFacts): NormalizedPosition {
  const team = canonicalPosition(facts.matchV5TeamPosition)
  if (team) return team
  const individual = canonicalPosition(facts.matchV5IndividualPosition)
  if (individual) return individual
  const assigned = canonicalPosition(facts.assignedPosition)
  if (assigned) return assigned
  const legacyRole = canonicalPosition(facts.legacyRole)
  if (legacyRole) return legacyRole
  const lcuRole = canonicalPosition(facts.lcuRole)
  if (lcuRole) return lcuRole
  if (facts.spell1Id === SUMMONER_SMITE_ID || facts.spell2Id === SUMMONER_SMITE_ID) {
    return "JUNGLE"
  }
  const legacy = resolvePosition(
    facts.legacyLane ?? undefined,
    facts.legacyRole ?? undefined,
  )
  if (legacy) return legacy
  if ((facts.spell1Id || facts.spell2Id) &&
      upper(facts.lcuLane ?? undefined) === "JUNGLE") return "UNKNOWN"
  return resolvePosition(
    facts.lcuLane ?? undefined,
    facts.lcuRole ?? undefined,
  ) ?? "UNKNOWN"
}

export function exactOpposingPosition<T>(
  participants: readonly T[],
  ownerTeamId: number,
  ownerPosition: NormalizedPosition,
  facts: (participant: T) => { teamId?: number; position?: NormalizedPosition },
): T | undefined {
  if (ownerPosition === "UNKNOWN") return undefined
  const candidates = participants.filter((participant) => {
    const value = facts(participant)
    return value.teamId !== ownerTeamId && value.position === ownerPosition
  })
  return candidates.length === 1 ? candidates[0] : undefined
}
