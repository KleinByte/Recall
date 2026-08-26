export const TIMELINE_MAPPER_VERSION = 11

export type CompactTimelineParticipantField =
  | "currentGold"
  | "totalGold"
  | "level"
  | "xp"
  | "minionsKilled"
  | "jungleMinionsKilled"

export type TimelineEventCategory =
  | "kill"
  | "item"
  | "objective"
  | "level"
  | "vision"
  | "game"

export interface CompactTimelineFrame {
  timestamp: number
  blueGold: number
  redGold: number
  ownerGold: number
  ownerLevel: number
  ownerXp: number
  ownerCs: number
  /** False when any expected participant lacks total-gold evidence. */
  teamGoldComplete?: boolean
  participants: CompactTimelineParticipantFrame[]
}

export interface CompactTimelineParticipantFrame {
  participantId: number
  teamId?: number
  currentGold: number
  totalGold: number
  level: number
  xp: number
  minionsKilled: number
  jungleMinionsKilled: number
  /** Explicitly distinguishes an absent source field from an observed zero. */
  missingFields?: CompactTimelineParticipantField[]
  position?: { x: number; y: number }
}

export interface CompactTimelineEvent {
  eventId: string
  timestamp: number
  type: string
  category: TimelineEventCategory
  participantId?: number
  assistingParticipantIds?: number[]
  teamId?: number
  targetId?: number
  itemId?: number
  beforeId?: number
  afterId?: number
  skillSlot?: number
  level?: number
  objective?: string
  killType?: string
  multiKillLength?: number
  bounty?: number
  shutdownBounty?: number
  wardType?: string
  laneType?: string
  actorName?: string
  targetName?: string
  position?: { x: number; y: number }
  approximate?: boolean
}

export interface CompactParticipantLifeInterval {
  participantId: number
  /** Exact joined kill time when available, otherwise the first dead observation. */
  diedAtMs: number
  /** Expected timer completion or the first subsequent alive observation. */
  respawnAtMs?: number
}

export interface CompactTimeline {
  frames: CompactTimelineFrame[]
  events: CompactTimelineEvent[]
  /** Optional because post-game-only and historical timelines lack live state. */
  participantLifeIntervals?: CompactParticipantLifeInterval[]
  turningPoints: {
    timestamp: number
    swing: number
    beforeDifference: number
    afterDifference: number
  }[]
  evidenceCoverage?: {
    /** Live kill-feed rows that could not be joined to post-game events. */
    incompleteSupplementalKillEvents?: number
  }
}

interface RawParticipantFrame {
  participantId?: number
  currentGold?: number
  totalGold?: number
  level?: number
  xp?: number
  minionsKilled?: number
  jungleMinionsKilled?: number
  position?: { x?: number; y?: number }
}

interface RawEvent {
  timestamp?: number
  type?: string
  participantId?: number
  killerId?: number
  creatorId?: number
  victimId?: number
  assistingParticipantIds?: number[]
  teamId?: number
  itemId?: number
  beforeId?: number
  afterId?: number
  monsterType?: string
  monsterSubType?: string
  buildingType?: string
  towerType?: string
  position?: { x?: number; y?: number }
  skillSlot?: number
  level?: number
  killType?: string
  multiKillLength?: number
  bounty?: number
  shutdownBounty?: number
  wardType?: string
  laneType?: string
}

interface RawFrame {
  timestamp?: number
  participantFrames?: Record<string, RawParticipantFrame>
  events?: RawEvent[]
}

const KEPT_EVENTS = new Set([
  "CHAMPION_KILL",
  "ITEM_PURCHASED",
  "ITEM_SOLD",
  "ITEM_UNDO",
  "ITEM_DESTROYED",
  "ITEM_TRANSFORM",
  "ITEM_TRANSFORMED",
  "LEVEL_UP",
  "SKILL_LEVEL_UP",
  "ELITE_MONSTER_KILL",
  "BUILDING_KILL",
  "TURRET_PLATE_DESTROYED",
  "WARD_PLACED",
  "WARD_KILL",
  "GAME_END",
])

function categoryFor(type: string): TimelineEventCategory {
  if (type.includes("CHAMPION") && type.includes("KILL")) return "kill"
  if (type.startsWith("ITEM_")) return "item"
  if (
    type === "ELITE_MONSTER_KILL" ||
    type === "BUILDING_KILL" ||
    type === "TURRET_PLATE_DESTROYED"
  ) return "objective"
  if (type.includes("LEVEL_UP")) return "level"
  if (type.startsWith("WARD_")) return "vision"
  return "game"
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function hasFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function participantMissingFields(
  participant: RawParticipantFrame,
): CompactTimelineParticipantField[] {
  return ([
    "currentGold",
    "totalGold",
    "level",
    "xp",
    "minionsKilled",
    "jungleMinionsKilled",
  ] as const).filter((field) => !hasFiniteNumber(participant[field]))
}

/** Riot timeline payloads sometimes include participantId: 0 alongside the
 * real killerId/creatorId. Zero is a sentinel, not an actor identity. */
function firstPositiveId(...values: unknown[]) {
  return values.find((value): value is number =>
    Number.isSafeInteger(value) && Number(value) > 0)
}

/** Riot's local timeline frequently sends an empty monsterSubType for Baron
 * and Herald while retaining the authoritative monsterType. Empty strings are
 * absent evidence, so they must not mask the useful fallback field. */
function firstNonEmptyToken(...values: unknown[]) {
  return values.find((value): value is string =>
    typeof value === "string" && value.trim().length > 0)?.trim()
}

/**
 * The local match-history endpoint can repeat the same event many times in a
 * single frame. Event indexes are therefore not identities; use the event's
 * observable payload so every placement, purchase, and takedown is counted
 * once across all timeline consumers.
 */
function eventIdentity(event: Omit<CompactTimelineEvent, "eventId">) {
  return JSON.stringify([
    event.timestamp,
    event.type,
    event.participantId ?? null,
    event.targetId ?? null,
    event.assistingParticipantIds ?? null,
    event.teamId ?? null,
    event.itemId ?? null,
    event.beforeId ?? null,
    event.afterId ?? null,
    event.skillSlot ?? null,
    event.level ?? null,
    event.objective ?? null,
    event.killType ?? null,
    event.multiKillLength ?? null,
    event.bounty ?? null,
    event.shutdownBounty ?? null,
    event.wardType ?? null,
    event.laneType ?? null,
    event.actorName ?? null,
    event.targetName ?? null,
    event.position?.x ?? null,
    event.position?.y ?? null,
  ])
}

/**
 * The League Client's local timeline route currently omits LEVEL_UP events,
 * even though every periodic participant frame still contains the champion's
 * level. Reconstruct the missing milestones at the first frame that proves a
 * participant reached them. These timestamps are therefore approximate.
 */
function inferLevelEvents(
  frames: CompactTimelineFrame[],
  events: CompactTimelineEvent[],
): CompactTimelineEvent[] {
  const previousLevels = new Map<number, number>()
  const recordedLevels = new Set(events.flatMap((event) =>
    event.type === "LEVEL_UP" && event.participantId && event.level
      ? [`${event.participantId}:${event.level}`]
      : [],
  ))
  const inferred: CompactTimelineEvent[] = []

  for (const frame of frames) {
    for (const participant of frame.participants) {
      if (participant.missingFields?.includes("level")) continue
      const previous = previousLevels.get(participant.participantId)
      const current = participant.level
      previousLevels.set(participant.participantId, current)
      if (previous === undefined || current <= previous) continue

      for (let level = previous + 1; level <= current; level += 1) {
        const key = `${participant.participantId}:${level}`
        if (recordedLevels.has(key)) continue
        recordedLevels.add(key)
        inferred.push({
          eventId: `inferred-level:${frame.timestamp}:${participant.participantId}:${level}`,
          timestamp: frame.timestamp,
          type: "LEVEL_UP",
          category: "level",
          participantId: participant.participantId,
          teamId: participant.teamId,
          level,
          approximate: true,
        })
      }
    }
  }

  return inferred
}

export function mapTimeline(
  frames: RawFrame[],
  ownerParticipantId: number,
  participantTeams: ReadonlyMap<number, number>,
): CompactTimeline {
  const compactFrames: CompactTimelineFrame[] = []
  const events: CompactTimelineEvent[] = []
  const seenEvents = new Set<string>()

  for (const frame of frames) {
    const timestamp = numberOrZero(frame.timestamp)
    const participantFrames = Object.entries(frame.participantFrames ?? {})
      .map(([key, participant]) => ({
        ...participant,
        participantId: participant.participantId ?? Number(key),
      }))
    const participantsById = new Map(participantFrames.map((participant) => [
      numberOrZero(participant.participantId),
      participant,
    ]))
    const expectedTeamParticipants = [...participantTeams.entries()]
      .filter(([, teamId]) => teamId === 100 || teamId === 200)
    const teamGoldComplete = expectedTeamParticipants.length > 0 &&
      expectedTeamParticipants.every(([participantId]) =>
        hasFiniteNumber(participantsById.get(participantId)?.totalGold))
    let blueGold = 0
    let redGold = 0
    for (const participant of participantFrames) {
      const gold = numberOrZero(participant.totalGold)
      const teamId = participantTeams.get(numberOrZero(participant.participantId))
      if (teamId === 100) blueGold += gold
      if (teamId === 200) redGold += gold
    }
    const owner = participantFrames.find(
      (participant) => participant.participantId === ownerParticipantId,
    )
    compactFrames.push({
      timestamp,
      blueGold,
      redGold,
      ownerGold: numberOrZero(owner?.totalGold),
      ownerLevel: numberOrZero(owner?.level),
      ownerXp: numberOrZero(owner?.xp),
      ownerCs:
        numberOrZero(owner?.minionsKilled) +
        numberOrZero(owner?.jungleMinionsKilled),
      participants: participantFrames.map((participant) => {
        const participantId = numberOrZero(participant.participantId)
        return {
          participantId,
          teamId: participantTeams.get(participantId),
          currentGold: numberOrZero(participant.currentGold),
          totalGold: numberOrZero(participant.totalGold),
          level: numberOrZero(participant.level),
          xp: numberOrZero(participant.xp),
          minionsKilled: numberOrZero(participant.minionsKilled),
          jungleMinionsKilled: numberOrZero(participant.jungleMinionsKilled),
          missingFields: participantMissingFields(participant),
          position: participant.position &&
            typeof participant.position.x === "number" &&
            typeof participant.position.y === "number"
            ? { x: participant.position.x, y: participant.position.y }
            : undefined,
        }
      }),
      teamGoldComplete,
    })

    for (const [eventIndex, event] of (frame.events ?? []).entries()) {
      if (!event.type || !KEPT_EVENTS.has(event.type)) continue
      // LCU emits large batches of duplicated, synthetic WARD_PLACED events
      // with this sentinel type. Real placements carry their actual ward type.
      if (event.type === "WARD_PLACED" && event.wardType?.toUpperCase() === "UNDEFINED") continue
      const participantId = firstPositiveId(
        event.participantId,
        event.killerId,
        event.creatorId,
      )
      const targetId = firstPositiveId(event.victimId)
      const objective = firstNonEmptyToken(
        event.monsterSubType,
        event.monsterType,
        event.towerType,
        event.buildingType,
      )
      const mappedEvent: Omit<CompactTimelineEvent, "eventId"> = {
        timestamp: numberOrZero(event.timestamp ?? timestamp),
        type: event.type,
        category: categoryFor(event.type),
        participantId,
        assistingParticipantIds: event.assistingParticipantIds,
        teamId: firstPositiveId(event.teamId) ??
          (participantId ? participantTeams.get(participantId) : undefined),
        targetId,
        itemId: event.itemId,
        beforeId: event.beforeId,
        afterId: event.afterId,
        skillSlot: event.skillSlot,
        level: event.level,
        objective,
        killType: event.killType,
        multiKillLength: event.multiKillLength,
        bounty: event.bounty,
        shutdownBounty: event.shutdownBounty,
        wardType: event.wardType,
        laneType: event.laneType,
        position: event.position &&
          typeof event.position.x === "number" &&
          typeof event.position.y === "number"
          ? { x: event.position.x, y: event.position.y }
          : undefined,
      }
      const identity = eventIdentity(mappedEvent)
      if (seenEvents.has(identity)) continue
      seenEvents.add(identity)
      events.push({
        ...mappedEvent,
        eventId: `${mappedEvent.timestamp}:${event.type}:${eventIndex}:${participantId ?? 0}:${targetId ?? 0}`,
      })
    }
  }
  return {
    frames: compactFrames,
    events: [...events, ...inferLevelEvents(compactFrames, events)]
      .sort((a, b) => a.timestamp - b.timestamp),
    turningPoints: findTurningPoints(compactFrames),
  }
}

export function findTurningPoints(
  frames: CompactTimelineFrame[],
): CompactTimeline["turningPoints"] {
  const completeFrames = frames.filter((frame) => frame.teamGoldComplete !== false)
  const candidates = completeFrames.flatMap((frame, index) => {
    const target = frame.timestamp - 120_000
    let previousIndex = index - 1
    while (
      previousIndex > 0 &&
      completeFrames[previousIndex].timestamp > target
    ) previousIndex -= 1
    if (previousIndex < 0) return []
    const previous = completeFrames[previousIndex]
    const before = previous.blueGold - previous.redGold
    const after = frame.blueGold - frame.redGold
    const swing = after - before
    return Math.abs(swing) >= 1_000
      ? [{ timestamp: frame.timestamp, swing, beforeDifference: before, afterDifference: after }]
      : []
  }).sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing))

  const selected: CompactTimeline["turningPoints"] = []
  for (const candidate of candidates) {
    if (selected.every((entry) =>
      Math.abs(entry.timestamp - candidate.timestamp) >= 180_000
    )) selected.push(candidate)
    if (selected.length === 3) break
  }
  return selected.sort((a, b) => a.timestamp - b.timestamp)
}
