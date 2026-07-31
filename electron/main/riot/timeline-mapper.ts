export const TIMELINE_MAPPER_VERSION = 3

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
  position?: { x: number; y: number }
}

export interface CompactTimeline {
  frames: CompactTimelineFrame[]
  events: CompactTimelineEvent[]
  turningPoints: {
    timestamp: number
    swing: number
    beforeDifference: number
    afterDifference: number
  }[]
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

export function mapTimeline(
  frames: RawFrame[],
  ownerParticipantId: number,
  participantTeams: ReadonlyMap<number, number>,
): CompactTimeline {
  const compactFrames: CompactTimelineFrame[] = []
  const events: CompactTimelineEvent[] = []

  for (const frame of frames) {
    const timestamp = numberOrZero(frame.timestamp)
    const participantFrames = Object.values(frame.participantFrames ?? {})
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
          position: participant.position &&
            typeof participant.position.x === "number" &&
            typeof participant.position.y === "number"
            ? { x: participant.position.x, y: participant.position.y }
            : undefined,
        }
      }),
    })

    for (const [eventIndex, event] of (frame.events ?? []).entries()) {
      if (!event.type || !KEPT_EVENTS.has(event.type)) continue
      const participantId = event.participantId ?? event.killerId ?? event.creatorId
      const targetId = event.victimId
      const objective = event.monsterSubType ?? event.monsterType ??
        event.towerType ?? event.buildingType
      events.push({
        eventId: `${numberOrZero(event.timestamp ?? timestamp)}:${event.type}:${eventIndex}:${participantId ?? 0}:${targetId ?? 0}`,
        timestamp: numberOrZero(event.timestamp ?? timestamp),
        type: event.type,
        category: categoryFor(event.type),
        participantId,
        assistingParticipantIds: event.assistingParticipantIds,
        teamId: event.teamId ??
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
      })
    }
  }
  return {
    frames: compactFrames,
    events: events.sort((a, b) => a.timestamp - b.timestamp),
    turningPoints: findTurningPoints(compactFrames),
  }
}

export function findTurningPoints(
  frames: CompactTimelineFrame[],
): CompactTimeline["turningPoints"] {
  const candidates = frames.flatMap((frame, index) => {
    const target = frame.timestamp - 120_000
    let previousIndex = index - 1
    while (
      previousIndex > 0 &&
      frames[previousIndex].timestamp > target
    ) previousIndex -= 1
    if (previousIndex < 0) return []
    const previous = frames[previousIndex]
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
