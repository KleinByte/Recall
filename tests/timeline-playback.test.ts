import { describe, expect, it } from "vitest"
import {
  isUsableMapPosition,
  playbackMapEventLayer,
  playbackCoverage,
  playbackPositionAt,
  spreadOverlappingMapPoints,
  playbackTrailSamples,
  playbackWorldMarkers,
} from "../src/helpers/timeline-playback"
import type { TimelineEvent, TimelineFrame } from "../src/types/review"

function frame(timestamp: number, positions: Record<number, { x: number; y: number } | undefined>): TimelineFrame {
  return {
    timestamp,
    blueGold: 0,
    redGold: 0,
    ownerGold: 0,
    ownerLevel: 0,
    ownerXp: 0,
    ownerCs: 0,
    participants: Object.entries(positions).map(([participantId, position]) => ({
      participantId: Number(participantId),
      currentGold: 0,
      totalGold: 0,
      level: 1,
      xp: 0,
      minionsKilled: 0,
      jungleMinionsKilled: 0,
      position,
    })),
  }
}

const frames = [
  frame(60_000, { 1: { x: 1_000, y: 2_000 }, 2: { x: 3_000, y: 4_000 } }),
  frame(120_000, { 1: { x: 3_000, y: 6_000 }, 2: undefined }),
]

describe("timeline map playback", () => {
  it("returns exact samples and interpolates between minute frames", () => {
    expect(playbackPositionAt(frames, [], 1, 60_000, 11)?.position).toEqual({ x: 1_000, y: 2_000 })
    expect(playbackPositionAt(frames, [], 1, 90_000, 11)?.position).toEqual({ x: 2_000, y: 4_000 })
    expect(playbackPositionAt(frames, [], 1, 90_000, 11)?.exact).toBe(false)
  })

  it("moves at a timestamp-linear pace regardless of neighboring observations", () => {
    const observed = [
      frame(0, { 1: { x: 1_000, y: 1_000 } }),
      frame(60_000, { 1: { x: 3_000, y: 2_000 } }),
      frame(120_000, { 1: { x: 4_000, y: 6_000 } }),
      frame(180_000, { 1: { x: 8_000, y: 7_000 } }),
    ]
    expect(playbackPositionAt(observed, [], 1, 75_000, 11)?.position).toEqual({ x: 3_250, y: 3_000 })
    expect(playbackPositionAt(observed, [], 1, 90_000, 11)?.position).toEqual({ x: 3_500, y: 4_000 })
    expect(playbackPositionAt(observed, [], 1, 105_000, 11)?.position).toEqual({ x: 3_750, y: 5_000 })
    expect(playbackPositionAt(observed, [], 1, 75_000, 11)?.progress).toBe(.25)
  })

  it("does not extrapolate or bridge gaps larger than the supported interval", () => {
    expect(playbackPositionAt(frames, [], 1, 30_000, 11)).toBeUndefined()
    expect(playbackPositionAt(frames, [], 1, 180_000, 11)).toBeUndefined()
    const sparse = [frame(0, { 1: { x: 1_000, y: 1_000 } }), frame(120_000, { 1: { x: 2_000, y: 2_000 } })]
    expect(playbackPositionAt(sparse, [], 1, 60_000, 11)).toBeUndefined()
  })

  it("anchors movement at death, then waits for a changed post-death sample", () => {
    const events: TimelineEvent[] = [{
      eventId: "death",
      timestamp: 90_000,
      type: "CHAMPION_KILL",
      category: "kill",
      targetId: 1,
      position: { x: 2_000, y: 3_000 },
    }]
    expect(playbackPositionAt(frames, events, 1, 75_000, 11)?.position).toEqual({ x: 1_500, y: 2_500 })
    expect(playbackPositionAt(frames, events, 1, 90_000, 11)).toBeUndefined()
    expect(playbackPositionAt(frames, events, 1, 100_000, 11)).toBeUndefined()
    expect(playbackPositionAt(frames, events, 1, 119_999, 11)).toBeUndefined()
    expect(playbackPositionAt(frames, events, 1, 120_000, 11)?.position).toEqual({ x: 3_000, y: 6_000 })
  })

  it("ignores implausibly early route changes when inferring a respawn", () => {
    const observed = [
      frame(0, { 1: { x: 1_000, y: 2_000 } }),
      frame(21_000, { 1: { x: 3_000, y: 6_000 } }),
      frame(40_000, { 1: { x: 4_000, y: 7_000 } }),
    ]
    const events: TimelineEvent[] = [{
      eventId: "death-with-stale-sample",
      timestamp: 20_000,
      type: "CHAMPION_KILL",
      category: "kill",
      targetId: 1,
      position: { x: 2_000, y: 3_000 },
    }]

    expect(playbackPositionAt(observed, events, 1, 21_000, 11)).toBeUndefined()
    expect(playbackPositionAt(observed, events, 1, 29_999, 11)).toBeUndefined()
    expect(playbackPositionAt(observed, events, 1, 40_000, 11)?.position)
      .toEqual({ x: 4_000, y: 7_000 })
  })

  it("rejects out-of-map telemetry instead of clamping it to an edge", () => {
    expect(isUsableMapPosition({ x: 10_000, y: 10_000 }, 11)).toBe(true)
    expect(isUsableMapPosition({ x: 20_000, y: 10_000 }, 11)).toBe(false)
    expect(isUsableMapPosition({ x: Number.NaN, y: 10_000 }, 11)).toBe(false)
  })

  it("reports coverage against the expected roster", () => {
    expect(playbackCoverage(frames, [1, 2], 11)).toEqual({
      positionedFrames: 2,
      totalFrames: 2,
      positionedParticipants: 2,
      expectedParticipants: 2,
      positionedSamples: 3,
      expectedSamples: 4,
      percent: 75,
    })
  })

  it("returns only recent, observed trail samples", () => {
    const trailFrames = [
      frame(0, { 1: { x: 100, y: 100 } }),
      frame(60_000, { 1: { x: 200, y: 200 } }),
      frame(120_000, { 1: { x: 300, y: 300 } }),
    ]
    expect(playbackTrailSamples(trailFrames, 1, 120_000, 11, 60_000).map((sample) => sample.timestamp))
      .toEqual([60_000, 120_000])
  })

  it("starts with the complete Summoner's Rift structure and camp layout", () => {
    const markers = playbackWorldMarkers([], 0, 11)

    expect(markers.filter((marker) => marker.kind === "tower")).toHaveLength(22)
    expect(markers.filter((marker) => marker.kind === "inhibitor")).toHaveLength(6)
    expect(markers.filter((marker) => marker.kind === "nexus")).toHaveLength(2)
    expect(markers.filter((marker) => marker.kind === "camp")).toHaveLength(14)
    expect(markers.some((marker) => marker.id.startsWith("objective:"))).toBe(false)
  })

  it("applies a recorded destruction to the nearest canonical tower", () => {
    const tower: TimelineEvent = {
      eventId: "tower",
      timestamp: 10 * 60_000,
      type: "BUILDING_KILL",
      category: "objective",
      teamId: 100,
      objective: "OUTER_TURRET",
      laneType: "TOP_LANE",
      position: { x: 981, y: 10_441 },
    }

    const before = playbackWorldMarkers([tower], 9 * 60_000, 11)
      .find((marker) => marker.id === "blue:top:outer")
    const after = playbackWorldMarkers([tower], 10 * 60_000, 11)
      .find((marker) => marker.id === "blue:top:outer")
    expect(before?.state).toBe("alive")
    expect(after?.state).toBe("destroyed")
  })

  it("shows Dragon only after spawn and grays it during the respawn window", () => {
    const dragon: TimelineEvent = {
      eventId: "dragon",
      timestamp: 8 * 60_000,
      type: "ELITE_MONSTER_KILL",
      category: "objective",
      teamId: 100,
      objective: "FIRE_DRAGON",
      position: { x: 9_860, y: 4_410 },
    }
    const stateAt = (timestamp: number) => playbackWorldMarkers([dragon], timestamp, 11)
      .find((marker) => marker.id === "objective:dragon-pit")?.state

    expect(stateAt(5 * 60_000 - 1)).toBeUndefined()
    expect(stateAt(5 * 60_000)).toBe("alive")
    expect(stateAt(8 * 60_000)).toBe("respawning")
    expect(stateAt(13 * 60_000 - 1)).toBe("respawning")
    expect(stateAt(13 * 60_000)).toBe("alive")
  })

  it("moves the current standard top pit from Grubs to Herald to Baron", () => {
    const objective = (eventId: string, timestamp: number, name: string): TimelineEvent => ({
      eventId,
      timestamp,
      type: "ELITE_MONSTER_KILL",
      category: "objective",
      objective: name,
    })
    const events = [
      objective("grub-1", 8.5 * 60_000, "HORDE"),
      objective("grub-2", 9 * 60_000, "HORDE"),
      objective("grub-3", 9.5 * 60_000, "HORDE"),
      objective("herald", 16 * 60_000, "RIFTHERALD"),
      objective("baron", 22 * 60_000, "BARON_NASHOR"),
    ]
    const objectivesAt = (timestamp: number) => playbackWorldMarkers(
      events, timestamp, 11, "sr_ranked_solo", "16.14.1",
    ).filter((marker) => marker.id.startsWith("objective:") && marker.id !== "objective:dragon-pit")

    expect(objectivesAt(8 * 60_000 - 1)).toEqual([])
    expect(objectivesAt(8 * 60_000)).toHaveLength(3)
    expect(objectivesAt(8 * 60_000).every((marker) => marker.kind === "void-grub" && marker.state === "alive")).toBe(true)
    expect(objectivesAt(9 * 60_000).map((marker) => marker.state)).toEqual(["destroyed", "destroyed", "alive"])
    expect(objectivesAt(15 * 60_000)).toMatchObject([{ kind: "herald", state: "alive" }])
    expect(objectivesAt(17 * 60_000)).toMatchObject([{ kind: "herald", state: "destroyed" }])
    expect(objectivesAt(20 * 60_000)).toMatchObject([{ kind: "baron", state: "alive" }])
    expect(objectivesAt(23 * 60_000)).toMatchObject([{ kind: "baron", state: "respawning" }])
    expect(objectivesAt(28 * 60_000)).toMatchObject([{ kind: "baron", state: "alive" }])
  })

  it("uses current Swiftplay's empty early pit and 12-minute Baron", () => {
    const topAt = (timestamp: number) => playbackWorldMarkers(
      [], timestamp, 11, "sr_swiftplay", "16.14.1",
    ).filter((marker) => ["void-grub", "herald", "baron"].includes(marker.kind))

    expect(topAt(8 * 60_000)).toEqual([])
    expect(topAt(11.99 * 60_000)).toEqual([])
    expect(topAt(12 * 60_000)).toMatchObject([{ kind: "baron", state: "alive" }])
  })

  it("uses the stored patch for historical top-pit schedules", () => {
    const kindsAt = (timestamp: number, version: string) => playbackWorldMarkers(
      [], timestamp, 11, "sr_ranked_solo", version,
    ).filter((marker) => ["void-grub", "herald", "baron"].includes(marker.kind))
      .map((marker) => marker.kind)

    expect(kindsAt(5 * 60_000, "14.7.1")).toEqual(["void-grub", "void-grub", "void-grub"])
    expect(kindsAt(5 * 60_000, "14.8.1")).toEqual([])
    expect(kindsAt(15 * 60_000, "15.8.1")).toEqual(["void-grub", "void-grub", "void-grub"])
    expect(kindsAt(16 * 60_000, "15.8.1")).toEqual(["herald"])
    expect(kindsAt(15 * 60_000, "15.9.1")).toEqual(["herald"])
    expect(kindsAt(20 * 60_000, "15.9.1")).toEqual(["herald"])
    expect(kindsAt(25 * 60_000, "15.9.1")).toEqual(["baron"])
    expect(kindsAt(20 * 60_000, "unknown")).toEqual(["baron"])
  })

  it("keeps map events on one deliberate render layer", () => {
    const objectiveLayer = (objective: string, mapId: 11 | 12 = 11) => playbackMapEventLayer({
      eventId: objective,
      timestamp: 10 * 60_000,
      type: "ELITE_MONSTER_KILL",
      category: "objective",
      objective,
    }, mapId)

    expect(objectiveLayer("FIRE_DRAGON")).toBe("persistent")
    expect(objectiveLayer("ELDER_DRAGON")).toBe("persistent")
    expect(objectiveLayer("BARON_NASHOR")).toBe("persistent")
    expect(objectiveLayer("RIFTHERALD")).toBe("persistent")
    expect(objectiveLayer("HORDE")).toBe("persistent")
    expect(objectiveLayer("BARON_NASHOR", 12)).toBe("timeline-only")
    expect(playbackMapEventLayer({
      eventId: "kill",
      timestamp: 10 * 60_000,
      type: "CHAMPION_KILL",
      category: "kill",
    }, 11)).toBe("transient")
  })

  it("keeps one stable Dragon marker while the top-pit occupant changes", () => {
    const events: TimelineEvent[] = [{
      eventId: "dragon",
      timestamp: 8 * 60_000,
      type: "ELITE_MONSTER_KILL",
      category: "objective",
      objective: "FIRE_DRAGON",
    }, {
      eventId: "baron",
      timestamp: 22 * 60_000,
      type: "ELITE_MONSTER_KILL",
      category: "objective",
      objective: "BARON_NASHOR",
    }]

    expect(playbackWorldMarkers(events, 4 * 60_000, 11).filter((marker) => marker.id.startsWith("objective:"))).toEqual([])
    expect(playbackWorldMarkers(events, 10 * 60_000, 11).filter((marker) => marker.id === "objective:dragon-pit")).toHaveLength(1)
    expect(playbackWorldMarkers(events, 22 * 60_000, 11).filter((marker) => marker.id === "objective:baron-pit")).toHaveLength(1)
    expect(playbackWorldMarkers(events, 28 * 60_000, 11).filter((marker) => marker.id === "objective:baron-pit")).toHaveLength(1)
  })

  it("uses event time order when objective events arrive shuffled", () => {
    const first: TimelineEvent = {
      eventId: "first",
      timestamp: 8 * 60_000,
      type: "ELITE_MONSTER_KILL",
      category: "objective",
      teamId: 100,
      objective: "FIRE_DRAGON",
    }
    const second: TimelineEvent = {
      ...first,
      eventId: "second",
      timestamp: 14 * 60_000,
      teamId: 200,
    }
    const dragonState = (events: TimelineEvent[]) => playbackWorldMarkers(events, 15 * 60_000, 11)
      .find((marker) => marker.id === "objective:dragon-pit")?.state

    expect(dragonState([first, second])).toBe("respawning")
    expect(dragonState([second, first])).toBe("respawning")
  })

  it("stacks overlapping champions at their true positions until their cluster is expanded", () => {
    const points = [
      { id: 3, left: 50, top: 50 },
      { id: 1, left: 50, top: 50 },
      { id: 2, left: 80, top: 80 },
    ]
    const stacked = spreadOverlappingMapPoints(points)

    expect(stacked.find((point) => point.id === 2)).toEqual({
      id: 2,
      left: 80,
      top: 80,
      sourceLeft: 80,
      sourceTop: 80,
      overlapping: false,
      clusterId: "2",
      clusterIndex: 0,
      clusterSize: 1,
      expanded: false,
    })
    const clustered = stacked.filter((point) => point.id !== 2)
    expect(clustered.every((point) => point.overlapping)).toBe(true)
    expect(clustered.every((point) => point.clusterId === "1:3" && point.clusterSize === 2)).toBe(true)
    expect(clustered.every((point) => point.left === 50 && point.top === 50)).toBe(true)
    expect(clustered.every((point) => point.sourceLeft === 50 && point.sourceTop === 50)).toBe(true)

    const expanded = spreadOverlappingMapPoints(points, 4, 3)
    const anchor = expanded.find((point) => point.id === 3)!
    const fanned = expanded.find((point) => point.id === 1)!
    expect(anchor).toMatchObject({ left: 50, top: 50, expanded: true, clusterId: "1:3" })
    expect(fanned.expanded).toBe(true)
    expect({ left: fanned.left, top: fanned.top }).not.toEqual({ left: 50, top: 50 })
  })

  it("assigns stable overlap clusters independent of input order", () => {
    const points = [
      { id: 3, left: 51, top: 50 },
      { id: 1, left: 50, top: 50 },
      { id: 2, left: 80, top: 80 },
    ]
    const byId = (entries: ReturnType<typeof spreadOverlappingMapPoints>) =>
      [...entries].sort((left, right) => left.id - right.id)

    expect(byId(spreadOverlappingMapPoints(points, 4, 1)))
      .toEqual(byId(spreadOverlappingMapPoints([...points].reverse(), 4, 1)))
  })
})
