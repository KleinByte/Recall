import { REVIEW_MAP_DOMAINS, type ReviewMapId } from "./map-coordinate"
import type {
  TimelineEvent,
  TimelineFrame,
} from "../types/review"

export const MAX_PLAYBACK_GAP_MS = 90_000

export interface PlaybackPosition {
  participantId: number
  position: { x: number; y: number }
  fromTimestamp: number
  toTimestamp: number
  progress: number
  exact: boolean
}

export interface PlaybackCoverage {
  positionedFrames: number
  totalFrames: number
  positionedParticipants: number
  expectedParticipants: number
  positionedSamples: number
  expectedSamples: number
  percent: number
}

export interface PlaybackWorldMarker {
  id: string
  kind: "tower" | "inhibitor" | "nexus" | "camp" | "dragon" | "elder" | "baron" | "herald" | "void-grub"
  state: "alive" | "destroyed" | "dormant" | "respawning" | "location"
  label: string
  position: { x: number; y: number }
  teamId?: number
}

export interface OverlapMapPoint {
  id: number
  left: number
  top: number
}

export interface SpreadMapPoint extends OverlapMapPoint {
  sourceLeft: number
  sourceTop: number
  overlapping: boolean
  clusterId: string
  clusterIndex: number
  clusterSize: number
  expanded: boolean
}

interface PositionSample {
  timestamp: number
  position: { x: number; y: number }
}

function between(value: number, minimum: number, maximum: number) {
  return value >= minimum && value <= maximum
}

export function isUsableMapPosition(
  position: { x: number; y: number } | undefined,
  mapId: ReviewMapId,
) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return false
  const domain = REVIEW_MAP_DOMAINS[mapId]
  return between(position.x, domain.min.x, domain.max.x) &&
    between(position.y, domain.min.y, domain.max.y)
}

function samplesFor(
  frames: TimelineFrame[],
  participantId: number,
  mapId: ReviewMapId,
) {
  return frames.flatMap((frame): PositionSample[] => {
    const participant = frame.participants.find((entry) => entry.participantId === participantId)
    return isUsableMapPosition(participant?.position, mapId)
      ? [{ timestamp: frame.timestamp, position: participant!.position! }]
      : []
  }).sort((left, right) => left.timestamp - right.timestamp)
}

function interpolate(
  from: PositionSample,
  to: PositionSample,
  timestamp: number,
  participantId: number,
): PlaybackPosition {
  const duration = Math.max(1, to.timestamp - from.timestamp)
  const progress = Math.max(0, Math.min(1, (timestamp - from.timestamp) / duration))
  return {
    participantId,
    position: {
      x: from.position.x + (to.position.x - from.position.x) * progress,
      y: from.position.y + (to.position.y - from.position.y) * progress,
    },
    fromTimestamp: from.timestamp,
    toTimestamp: to.timestamp,
    progress,
    exact: from.timestamp === to.timestamp || progress === 0 || progress === 1,
  }
}

const objectiveToken = (event: TimelineEvent) =>
  (event.objective ?? "").toUpperCase().replaceAll("_", "")

/** Chooses whether an event belongs on the moving map, in its world state, or only on the scrubber. */
export function playbackMapEventLayer(event: TimelineEvent, mapId: ReviewMapId) {
  if (event.category === "kill") return "transient" as const
  if (mapId === 11 && event.category === "objective" && event.type === "ELITE_MONSTER_KILL") {
    const token = objectiveToken(event)
    if (
      token.includes("BARON") || token.includes("DRAGON") || token.includes("ELDER") ||
      token.includes("HERALD") || token.includes("HORDE") || token.includes("GRUB")
    ) {
      return "persistent" as const
    }
  }
  return "timeline-only" as const
}

type StaticStructure = Omit<PlaybackWorldMarker, "state">

const SUMMONERS_RIFT_STRUCTURES: StaticStructure[] = [
  // Blue side: eleven turrets, three inhibitors, and the Nexus.
  { id: "blue:top:outer", kind: "tower", label: "Blue top outer turret", position: { x: 981, y: 10_441 }, teamId: 100 },
  { id: "blue:top:inner", kind: "tower", label: "Blue top inner turret", position: { x: 1_512, y: 6_699 }, teamId: 100 },
  { id: "blue:top:inhib-turret", kind: "tower", label: "Blue top inhibitor turret", position: { x: 1_169, y: 4_287 }, teamId: 100 },
  { id: "blue:mid:outer", kind: "tower", label: "Blue mid outer turret", position: { x: 5_846, y: 6_396 }, teamId: 100 },
  { id: "blue:mid:inner", kind: "tower", label: "Blue mid inner turret", position: { x: 5_048, y: 4_812 }, teamId: 100 },
  { id: "blue:mid:inhib-turret", kind: "tower", label: "Blue mid inhibitor turret", position: { x: 3_651, y: 3_696 }, teamId: 100 },
  { id: "blue:bot:outer", kind: "tower", label: "Blue bottom outer turret", position: { x: 10_504, y: 1_029 }, teamId: 100 },
  { id: "blue:bot:inner", kind: "tower", label: "Blue bottom inner turret", position: { x: 6_919, y: 1_483 }, teamId: 100 },
  { id: "blue:bot:inhib-turret", kind: "tower", label: "Blue bottom inhibitor turret", position: { x: 4_281, y: 1_253 }, teamId: 100 },
  { id: "blue:nexus:top-turret", kind: "tower", label: "Blue Nexus turret", position: { x: 1_748, y: 2_270 }, teamId: 100 },
  { id: "blue:nexus:bot-turret", kind: "tower", label: "Blue Nexus turret", position: { x: 2_177, y: 1_807 }, teamId: 100 },
  { id: "blue:top:inhibitor", kind: "inhibitor", label: "Blue top inhibitor", position: { x: 1_169, y: 3_573 }, teamId: 100 },
  { id: "blue:mid:inhibitor", kind: "inhibitor", label: "Blue mid inhibitor", position: { x: 3_203, y: 3_208 }, teamId: 100 },
  { id: "blue:bot:inhibitor", kind: "inhibitor", label: "Blue bottom inhibitor", position: { x: 3_452, y: 1_236 }, teamId: 100 },
  { id: "blue:nexus", kind: "nexus", label: "Blue Nexus", position: { x: 1_200, y: 1_200 }, teamId: 100 },

  // Red side.
  { id: "red:top:outer", kind: "tower", label: "Red top outer turret", position: { x: 4_318, y: 13_875 }, teamId: 200 },
  { id: "red:top:inner", kind: "tower", label: "Red top inner turret", position: { x: 7_943, y: 13_411 }, teamId: 200 },
  { id: "red:top:inhib-turret", kind: "tower", label: "Red top inhibitor turret", position: { x: 10_481, y: 13_650 }, teamId: 200 },
  { id: "red:mid:outer", kind: "tower", label: "Red mid outer turret", position: { x: 8_955, y: 8_510 }, teamId: 200 },
  { id: "red:mid:inner", kind: "tower", label: "Red mid inner turret", position: { x: 9_767, y: 10_113 }, teamId: 200 },
  { id: "red:mid:inhib-turret", kind: "tower", label: "Red mid inhibitor turret", position: { x: 11_134, y: 11_207 }, teamId: 200 },
  { id: "red:bot:outer", kind: "tower", label: "Red bottom outer turret", position: { x: 13_866, y: 4_505 }, teamId: 200 },
  { id: "red:bot:inner", kind: "tower", label: "Red bottom inner turret", position: { x: 13_327, y: 8_226 }, teamId: 200 },
  { id: "red:bot:inhib-turret", kind: "tower", label: "Red bottom inhibitor turret", position: { x: 13_624, y: 10_572 }, teamId: 200 },
  { id: "red:nexus:top-turret", kind: "tower", label: "Red Nexus turret", position: { x: 13_052, y: 12_612 }, teamId: 200 },
  { id: "red:nexus:bot-turret", kind: "tower", label: "Red Nexus turret", position: { x: 12_611, y: 13_084 }, teamId: 200 },
  { id: "red:top:inhibitor", kind: "inhibitor", label: "Red top inhibitor", position: { x: 11_261, y: 13_676 }, teamId: 200 },
  { id: "red:mid:inhibitor", kind: "inhibitor", label: "Red mid inhibitor", position: { x: 11_598, y: 11_667 }, teamId: 200 },
  { id: "red:bot:inhibitor", kind: "inhibitor", label: "Red bottom inhibitor", position: { x: 13_604, y: 11_316 }, teamId: 200 },
  { id: "red:nexus", kind: "nexus", label: "Red Nexus", position: { x: 13_620, y: 13_620 }, teamId: 200 },
]

const SUMMONERS_RIFT_CAMPS: StaticStructure[] = [
  { id: "camp:blue:gromp", kind: "camp", label: "Blue-side Gromp camp", position: { x: 2_100, y: 8_450 } },
  { id: "camp:blue:blue", kind: "camp", label: "Blue-side Blue Sentinel camp", position: { x: 3_850, y: 7_900 } },
  { id: "camp:blue:wolves", kind: "camp", label: "Blue-side Murk Wolf camp", position: { x: 3_800, y: 6_500 } },
  { id: "camp:blue:raptors", kind: "camp", label: "Blue-side Raptor camp", position: { x: 6_500, y: 5_500 } },
  { id: "camp:blue:red", kind: "camp", label: "Blue-side Red Brambleback camp", position: { x: 7_200, y: 4_000 } },
  { id: "camp:blue:krugs", kind: "camp", label: "Blue-side Krug camp", position: { x: 8_350, y: 2_700 } },
  { id: "camp:red:gromp", kind: "camp", label: "Red-side Gromp camp", position: { x: 12_700, y: 6_450 } },
  { id: "camp:red:blue", kind: "camp", label: "Red-side Blue Sentinel camp", position: { x: 10_970, y: 7_000 } },
  { id: "camp:red:wolves", kind: "camp", label: "Red-side Murk Wolf camp", position: { x: 11_020, y: 8_350 } },
  { id: "camp:red:raptors", kind: "camp", label: "Red-side Raptor camp", position: { x: 8_320, y: 9_380 } },
  { id: "camp:red:red", kind: "camp", label: "Red-side Red Brambleback camp", position: { x: 7_620, y: 10_880 } },
  { id: "camp:red:krugs", kind: "camp", label: "Red-side Krug camp", position: { x: 6_470, y: 12_180 } },
  { id: "camp:scuttle:top", kind: "camp", label: "Top Rift Scuttler route", position: { x: 5_750, y: 9_700 } },
  { id: "camp:scuttle:bottom", kind: "camp", label: "Bottom Rift Scuttler route", position: { x: 9_070, y: 5_150 } },
]

function buildingKind(event: TimelineEvent): "tower" | "inhibitor" | "nexus" {
  const token = objectiveToken(event)
  if (token.includes("INHIBITOR")) return "inhibitor"
  if (token.includes("NEXUS") && !token.includes("TURRET")) return "nexus"
  return "tower"
}

function squaredDistance(left: { x: number; y: number }, right: { x: number; y: number }) {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2
}

function destroyedStructureTimes(events: TimelineEvent[]) {
  const destroyed = new Map<string, number>()
  for (const event of events.filter((entry) =>
    entry.type === "BUILDING_KILL" && isUsableMapPosition(entry.position, 11),
  ).sort((left, right) => left.timestamp - right.timestamp)) {
    const candidates = SUMMONERS_RIFT_STRUCTURES.filter((structure) => structure.kind === buildingKind(event))
    const nearest = candidates.sort((left, right) =>
      squaredDistance(left.position, event.position!) - squaredDistance(right.position, event.position!),
    )[0]
    if (nearest && squaredDistance(nearest.position, event.position!) <= 1_800 ** 2) {
      destroyed.set(nearest.id, event.timestamp)
    }
  }
  return destroyed
}

interface WorldEventIndex {
  destroyedAt: Map<string, number>
  epicKills: TimelineEvent[]
}

const worldEventIndexCache = new WeakMap<TimelineEvent[], WorldEventIndex>()

function indexedWorldEvents(events: TimelineEvent[]) {
  const cached = worldEventIndexCache.get(events)
  if (cached) return cached
  const index = {
    destroyedAt: destroyedStructureTimes(events),
    epicKills: events.filter((event) => event.type === "ELITE_MONSTER_KILL")
      .sort((left, right) => left.timestamp - right.timestamp),
  }
  worldEventIndexCache.set(events, index)
  return index
}

function epicState(timestamp: number, kills: TimelineEvent[], spawnAt: number, respawnAfter: number) {
  if (timestamp < spawnAt) return "dormant" as const
  const lastKill = kills.filter((event) => event.timestamp <= timestamp).at(-1)
  return lastKill && timestamp < lastKill.timestamp + respawnAfter ? "respawning" as const : "alive" as const
}

const MINUTE = 60_000

interface TopPitRules {
  grubSpawnAt?: number
  grubsRespawn: boolean
  heraldSpawnAt?: number
  heraldRespawns: boolean
  baronSpawnAt: number
}

function gamePatch(gameVersion: string) {
  const match = gameVersion.match(/^(\d+)(?:\D+)(\d+)/)
  let major = Number(match?.[1] ?? 16)
  const minor = Number(match?.[2] ?? 1)
  if (major >= 2020) major -= 2010
  return major >= 10 ? { major, minor } : { major: 16, minor: 1 }
}

/** Patch-aware top-pit schedule. Empty versions intentionally use current rules. */
function topPitRules(mode: string, gameVersion: string): TopPitRules {
  const patch = gamePatch(gameVersion)
  const swiftplay = mode.includes("swiftplay")
  if (swiftplay && patch.major >= 16) {
    return { grubsRespawn: false, heraldRespawns: false, baronSpawnAt: 12 * MINUTE }
  }

  if (patch.major < 14) {
    return {
      grubsRespawn: false,
      heraldSpawnAt: 8 * MINUTE,
      heraldRespawns: true,
      baronSpawnAt: 20 * MINUTE,
    }
  }

  const modernGrubs = patch.major > 15 || patch.major === 15 && patch.minor >= 9
  const grubSpawnAt = modernGrubs
    ? 8 * MINUTE
    : patch.major === 14 && patch.minor < 8 ? 5 * MINUTE : 6 * MINUTE
  if (swiftplay) {
    return {
      grubSpawnAt,
      grubsRespawn: !modernGrubs,
      heraldSpawnAt: (patch.major === 15 && patch.minor >= 3 ? 11.5 : 10) * MINUTE,
      heraldRespawns: false,
      baronSpawnAt: patch.major === 15 ? 25 * MINUTE : 20 * MINUTE,
    }
  }
  if (patch.major === 15) {
    return {
      grubSpawnAt,
      grubsRespawn: !modernGrubs,
      heraldSpawnAt: (modernGrubs ? 15 : 16) * MINUTE,
      heraldRespawns: false,
      baronSpawnAt: 25 * MINUTE,
    }
  }
  return {
    grubSpawnAt,
    grubsRespawn: patch.major === 14,
    heraldSpawnAt: patch.major === 14 ? 14 * MINUTE : 15 * MINUTE,
    heraldRespawns: false,
    baronSpawnAt: 20 * MINUTE,
  }
}

function spawnAtOrFirstKill(scheduled: number, kills: TimelineEvent[]) {
  return Math.min(scheduled, kills[0]?.timestamp ?? Number.POSITIVE_INFINITY)
}

const VOID_GRUB_POSITIONS = [
  { x: 4_500, y: 10_150 },
  { x: 5_000, y: 10_850 },
  { x: 5_500, y: 10_150 },
] as const

function topPitMarkers(
  epicKills: TimelineEvent[],
  timestamp: number,
  mode: string,
  gameVersion: string,
): PlaybackWorldMarker[] {
  const rules = topPitRules(mode, gameVersion)
  const grubKills = epicKills.filter((event) => {
    const token = objectiveToken(event)
    return token.includes("HORDE") || token.includes("GRUB")
  })
  const heraldKills = epicKills.filter((event) => objectiveToken(event).includes("HERALD"))
  const baronKills = epicKills.filter((event) => objectiveToken(event).includes("BARON"))
  const baronSpawnAt = spawnAtOrFirstKill(rules.baronSpawnAt, baronKills)
  const heraldSpawnAt = rules.heraldSpawnAt === undefined
    ? Number.POSITIVE_INFINITY
    : spawnAtOrFirstKill(rules.heraldSpawnAt, heraldKills)

  if (rules.grubSpawnAt !== undefined) {
    const grubSpawnAt = spawnAtOrFirstKill(rules.grubSpawnAt, grubKills)
    if (timestamp >= grubSpawnAt && timestamp < heraldSpawnAt) {
      const killsSoFar = grubKills.filter((event) =>
        event.timestamp >= grubSpawnAt && event.timestamp <= timestamp)
      let killedSlots = Math.min(3, killsSoFar.length)
      if (rules.grubsRespawn && killsSoFar.length >= 3) {
        const secondSpawnAt = killsSoFar[2].timestamp + 4 * MINUTE
        if (secondSpawnAt < heraldSpawnAt && timestamp >= secondSpawnAt) {
          killedSlots = Math.min(3, grubKills.filter((event) =>
            event.timestamp >= secondSpawnAt && event.timestamp <= timestamp).length)
        } else {
          killedSlots = 3
        }
      }
      return VOID_GRUB_POSITIONS.map((position, index): PlaybackWorldMarker => ({
        id: `objective:void-grub:${index + 1}`,
        kind: "void-grub",
        state: index < killedSlots ? "destroyed" : "alive",
        label: `Void Grub ${index + 1}`,
        position,
      }))
    }
  }

  if (rules.heraldSpawnAt !== undefined && timestamp >= heraldSpawnAt && timestamp < baronSpawnAt) {
    const state = rules.heraldRespawns
      ? epicState(timestamp, heraldKills, heraldSpawnAt, 6 * MINUTE)
      : heraldKills.some((event) => event.timestamp <= timestamp) ? "destroyed" : "alive"
    return [{
      id: "objective:herald-pit",
      kind: "herald",
      state,
      label: "Rift Herald",
      position: { x: 5_000, y: 10_450 },
    }]
  }

  if (timestamp < baronSpawnAt) return []
  return [{
    id: "objective:baron-pit",
    kind: "baron",
    state: epicState(timestamp, baronKills, baronSpawnAt, 6 * MINUTE),
    label: "Baron Nashor",
    position: { x: 5_000, y: 10_450 },
  }]
}

/** Returns the fixed Summoner's Rift world model, with timeline events applied as state changes. */
export function playbackWorldMarkers(
  events: TimelineEvent[],
  timestamp: number,
  mapId: ReviewMapId,
  mode = "",
  gameVersion = "",
): PlaybackWorldMarker[] {
  if (mapId !== 11) return []

  const eventIndex = indexedWorldEvents(events)
  const destroyedAt = eventIndex.destroyedAt
  const structures = SUMMONERS_RIFT_STRUCTURES.map((structure): PlaybackWorldMarker => {
    const destruction = destroyedAt.get(structure.id)
    const destroyed = destruction !== undefined && timestamp >= destruction
    const inhibitorRespawned = structure.kind === "inhibitor" &&
      destruction !== undefined && timestamp >= destruction + 5 * 60_000
    return {
      ...structure,
      state: destroyed && !inhibitorRespawned ? "destroyed" : "alive",
    }
  })

  const camps = SUMMONERS_RIFT_CAMPS.map((camp): PlaybackWorldMarker => ({
    ...camp,
    state: "location",
  }))

  const epicKills = eventIndex.epicKills
  const elementalKills = epicKills.filter((event) => {
    const token = objectiveToken(event)
    return token.includes("DRAGON") && !token.includes("ELDER")
  })
  const elderKills = epicKills.filter((event) => objectiveToken(event).includes("ELDER"))
  const swiftplay = mode.includes("swiftplay")
  const dragonSoulThreshold = swiftplay ? 2 : 4
  const dragonKillsByTeam = new Map<number, number>()
  let soulKill: TimelineEvent | undefined
  for (const event of elementalKills) {
    if (event.teamId !== 100 && event.teamId !== 200) continue
    const count = (dragonKillsByTeam.get(event.teamId) ?? 0) + 1
    dragonKillsByTeam.set(event.teamId, count)
    if (!soulKill && count >= dragonSoulThreshold) soulKill = event
  }

  const elderSpawn = swiftplay
    ? 15 * 60_000
    : soulKill ? soulKill.timestamp + 6 * 60_000 : elderKills[0]?.timestamp ?? Number.POSITIVE_INFINITY
  const elderActive = timestamp >= elderSpawn || elderKills.some((event) => event.timestamp <= timestamp)
  const dragonSpawnAt = spawnAtOrFirstKill(5 * MINUTE, elementalKills)
  const dragonMarkers: PlaybackWorldMarker[] = timestamp < dragonSpawnAt ? [] : [{
    id: "objective:dragon-pit",
    kind: elderActive ? "elder" : "dragon",
    state: elderActive
      ? epicState(timestamp, elderKills, elderSpawn, 6 * MINUTE)
      : soulKill && timestamp >= soulKill.timestamp ? "respawning" : epicState(timestamp, elementalKills, dragonSpawnAt, 5 * MINUTE),
    label: elderActive ? "Elder Dragon" : "Elemental Dragon",
    position: { x: 9_860, y: 4_410 },
  }]
  const topMarkers = topPitMarkers(epicKills, timestamp, mode, gameVersion)

  return [...structures, ...camps, ...dragonMarkers, ...topMarkers]
}

/**
 * Finds overlapping token clusters while leaving every token at its measured
 * map coordinate. Passing a participant id temporarily fans only that
 * participant's cluster; connected clusters and id sorting keep the result
 * deterministic as playback advances.
 */
export function spreadOverlappingMapPoints(
  points: OverlapMapPoint[],
  threshold = 4,
  expandedParticipantId?: number,
): SpreadMapPoint[] {
  const remaining = new Set(points.map((point) => point.id))
  const byId = new Map(points.map((point) => [point.id, point]))
  const result = new Map<number, SpreadMapPoint>()

  while (remaining.size) {
    const seed = remaining.values().next().value as number
    const clusterIds = new Set([seed])
    const queue = [seed]
    remaining.delete(seed)
    while (queue.length) {
      const current = byId.get(queue.shift()!)!
      for (const candidateId of [...remaining]) {
        const candidate = byId.get(candidateId)!
        if (Math.hypot(current.left - candidate.left, current.top - candidate.top) > threshold) continue
        remaining.delete(candidateId)
        clusterIds.add(candidateId)
        queue.push(candidateId)
      }
    }

    const cluster = [...clusterIds].map((id) => byId.get(id)!).sort((left, right) => left.id - right.id)
    const clusterId = cluster.map((point) => point.id).join(":")
    const anchor = cluster.find((point) => point.id === expandedParticipantId)
    const expanded = cluster.length > 1 && Boolean(anchor)
    const fanned = anchor ? cluster.filter((point) => point.id !== anchor.id) : []
    // Champion portraits need more room than point markers, especially when a
    // full teamfight resolves to one periodic timeline sample.
    const radius = Math.min(12, 3 + cluster.length * 1.15)
    cluster.forEach((point, index) => {
      const overlapping = cluster.length > 1
      const fanIndex = fanned.findIndex((candidate) => candidate.id === point.id)
      const angle = fanIndex < 0
        ? 0
        : -Math.PI / 2 + fanIndex * Math.PI * 2 / Math.max(1, fanned.length)
      result.set(point.id, {
        id: point.id,
        sourceLeft: point.left,
        sourceTop: point.top,
        left: expanded && point.id !== anchor!.id
          ? Math.max(1.5, Math.min(98.5, anchor!.left + Math.cos(angle) * radius))
          : point.left,
        top: expanded && point.id !== anchor!.id
          ? Math.max(1.5, Math.min(98.5, anchor!.top + Math.sin(angle) * radius))
          : point.top,
        overlapping,
        clusterId,
        clusterIndex: index,
        clusterSize: cluster.length,
        expanded,
      })
    })
  }

  return points.map((point) => result.get(point.id)!)
}

function deathBetween(
  events: TimelineEvent[],
  participantId: number,
  from: PositionSample,
  to: PositionSample,
  mapId: ReviewMapId,
) {
  return events.find((event) =>
    event.type === "CHAMPION_KILL" &&
    event.targetId === participantId &&
    event.timestamp > from.timestamp &&
    event.timestamp < to.timestamp &&
    isUsableMapPosition(event.position, mapId),
  )
}

export function playbackPositionAt(
  frames: TimelineFrame[],
  events: TimelineEvent[],
  participantId: number,
  timestamp: number,
  mapId: ReviewMapId,
  maximumGapMs = MAX_PLAYBACK_GAP_MS,
): PlaybackPosition | undefined {
  const samples = samplesFor(frames, participantId, mapId)
  const exact = samples.find((sample) => sample.timestamp === timestamp)
  if (exact) return interpolate(exact, exact, timestamp, participantId)

  const afterIndex = samples.findIndex((sample) => sample.timestamp > timestamp)
  const before = afterIndex > 0 ? samples[afterIndex - 1] : undefined
  const after = afterIndex >= 0 ? samples[afterIndex] : undefined
  if (!before || !after || after.timestamp - before.timestamp > maximumGapMs) return undefined

  const death = deathBetween(events, participantId, before, after, mapId)
  if (death) {
    if (timestamp > death.timestamp) return undefined
    return interpolate(before, {
      timestamp: death.timestamp,
      position: death.position!,
    }, timestamp, participantId)
  }
  // Timeline positions are sparse observations, not a recorded route. Linear
  // interpolation keeps elapsed time proportional to travel between anchors;
  // a spline would invent both a path and uneven movement speed.
  return interpolate(before, after, timestamp, participantId)
}

export function playbackPositionsAt(
  frames: TimelineFrame[],
  events: TimelineEvent[],
  timestamp: number,
  mapId: ReviewMapId,
) {
  const participantIds = new Set(frames.flatMap((frame) =>
    frame.participants.map((participant) => participant.participantId),
  ))
  return [...participantIds].flatMap((participantId) => {
    const position = playbackPositionAt(frames, events, participantId, timestamp, mapId)
    return position ? [position] : []
  })
}

export function playbackCoverage(
  frames: TimelineFrame[],
  participantIds: number[],
  mapId: ReviewMapId,
): PlaybackCoverage {
  const expectedParticipants = new Set(participantIds).size
  const expectedSamples = frames.length * expectedParticipants
  const observedParticipants = new Set<number>()
  let positionedFrames = 0
  let positionedSamples = 0

  for (const frame of frames) {
    let frameHasPosition = false
    for (const participant of frame.participants) {
      if (!participantIds.includes(participant.participantId) ||
        !isUsableMapPosition(participant.position, mapId)) continue
      positionedSamples += 1
      frameHasPosition = true
      observedParticipants.add(participant.participantId)
    }
    if (frameHasPosition) positionedFrames += 1
  }

  return {
    positionedFrames,
    totalFrames: frames.length,
    positionedParticipants: observedParticipants.size,
    expectedParticipants,
    positionedSamples,
    expectedSamples,
    percent: expectedSamples > 0 ? Math.round(positionedSamples / expectedSamples * 100) : 0,
  }
}

export function playbackTrailSamples(
  frames: TimelineFrame[],
  participantId: number,
  timestamp: number,
  mapId: ReviewMapId,
  lookbackMs = 5 * 60_000,
) {
  return samplesFor(frames, participantId, mapId)
    .filter((sample) => sample.timestamp >= timestamp - lookbackMs && sample.timestamp <= timestamp)
}
