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

/** Main-process twin of the renderer's pure position resolver. */
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
  return canonicalPosition(facts.matchV5TeamPosition) ??
    canonicalPosition(facts.matchV5IndividualPosition) ??
    canonicalPosition(facts.assignedPosition) ??
    canonicalPosition(facts.legacyRole) ??
    canonicalPosition(facts.lcuRole) ??
    (facts.spell1Id === SUMMONER_SMITE_ID || facts.spell2Id === SUMMONER_SMITE_ID
      ? "JUNGLE"
      : undefined) ??
    resolvePosition(facts.legacyLane ?? undefined, facts.legacyRole ?? undefined) ??
    // Some LCU history payloads label both top and jungle as lane=JUNGLE.
    // Once summoner spells are present, only Smite is allowed to make that
    // weak lane value authoritative.
    ((facts.spell1Id || facts.spell2Id) &&
      upper(facts.lcuLane ?? undefined) === "JUNGLE"
      ? undefined
      : resolvePosition(facts.lcuLane ?? undefined, facts.lcuRole ?? undefined)) ??
    "UNKNOWN"
}

export interface TeamPositionFacts extends PositionFacts {
  participantId: number
  teamId: number
}

const addScore = (
  scores: Record<Position, number>,
  value: string | null | undefined,
  weight: number,
) => {
  const position = canonicalPosition(value)
  if (position) scores[position] += weight
}

const permutations = <T>(values: readonly T[]): T[][] => {
  if (values.length <= 1) return [Array.from(values)]
  return values.flatMap((value, index) => permutations([
    ...values.slice(0, index),
    ...values.slice(index + 1),
  ]).map((tail) => [value, ...tail]))
}

const POSITION_PERMUTATIONS = permutations(POSITIONS)

/**
 * Reconciles the five mutually-exclusive Summoner's Rift positions.
 *
 * Riot/LCU history occasionally reports lane=JUNGLE for both the top laner
 * and the jungler. Strong source fields win first, Smite anchors the jungler,
 * and the one-of-each team shape resolves only the remaining ambiguity. The
 * participant order is a final deterministic tie-breaker, never primary
 * evidence.
 */
export function normalizeTeamPositions<T extends TeamPositionFacts>(
  participants: readonly T[],
): Map<number, Position> | undefined {
  if (participants.length !== POSITIONS.length) return undefined
  const smiters = participants.filter((participant) =>
    participant.spell1Id === SUMMONER_SMITE_ID ||
    participant.spell2Id === SUMMONER_SMITE_ID)
  const oneSmiter = smiters.length === 1
  const ordered = [...participants].sort((left, right) =>
    left.participantId - right.participantId)
  const matrices = ordered.map((participant, orderIndex) => {
    const scores = Object.fromEntries(POSITIONS.map((position) => [position, 0])) as
      Record<Position, number>
    addScore(scores, participant.matchV5TeamPosition, 10_000)
    addScore(scores, participant.matchV5IndividualPosition, 9_000)
    addScore(scores, participant.assignedPosition, 8_000)
    addScore(scores, participant.legacyRole, 7_000)
    addScore(scores, participant.lcuRole, 6_000)
    addScore(scores, resolvePosition(
      participant.legacyLane ?? undefined,
      participant.legacyRole ?? undefined,
    ), 4_000)
    addScore(scores, resolvePosition(
      participant.lcuLane ?? undefined,
      participant.lcuRole ?? undefined,
    ), 3_000)
    const hasSmite = participant.spell1Id === SUMMONER_SMITE_ID ||
      participant.spell2Id === SUMMONER_SMITE_ID
    if (hasSmite) scores.JUNGLE += 7_500
    else if (oneSmiter) scores.JUNGLE -= 9_000
    scores[POSITIONS[orderIndex]] += 1
    return scores
  })

  let best = POSITION_PERMUTATIONS[0]
  let bestScore = Number.NEGATIVE_INFINITY
  for (const candidate of POSITION_PERMUTATIONS) {
    const score = candidate.reduce((total, position, index) =>
      total + matrices[index][position], 0)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return new Map(ordered.map((participant, index) => [
    participant.participantId,
    best[index],
  ]))
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
