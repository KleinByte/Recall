export const TIMELINE_MAPPER_VERSION = 1

export interface CompactTimelineFrame {
  timestamp: number
  blueGold: number
  redGold: number
  ownerGold: number
  ownerLevel: number
  ownerXp: number
  ownerCs: number
}

export interface CompactTimelineEvent {
  timestamp: number
  type: string
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
  totalGold?: number
  level?: number
  xp?: number
  minionsKilled?: number
  jungleMinionsKilled?: number
}

interface RawEvent {
  timestamp?: number
  type?: string
  participantId?: number
  killerId?: number
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
  "GAME_END",
])

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
    })

    for (const event of frame.events ?? []) {
      if (!event.type || !KEPT_EVENTS.has(event.type)) continue
      const participantId = event.participantId ?? event.killerId
      const targetId = event.victimId
      const objective = event.monsterSubType ?? event.monsterType ??
        event.towerType ?? event.buildingType
      events.push({
        timestamp: numberOrZero(event.timestamp ?? timestamp),
        type: event.type,
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
