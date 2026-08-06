import { describe, expect, it } from "vitest"
import {
  isUsableMapPosition,
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

  it("uses a continuous curved path across adjacent positioned frames", () => {
    const curved = [
      frame(0, { 1: { x: 1_000, y: 1_000 } }),
      frame(60_000, { 1: { x: 3_000, y: 2_000 } }),
      frame(120_000, { 1: { x: 4_000, y: 6_000 } }),
      frame(180_000, { 1: { x: 8_000, y: 7_000 } }),
    ]
    const position = playbackPositionAt(curved, [], 1, 90_000, 11)?.position

    expect(position?.x).toBeGreaterThan(3_000)
    expect(position?.x).toBeLessThan(4_000)
    expect(position?.y).toBeGreaterThan(2_000)
    expect(position?.y).toBeLessThan(6_000)
  })

  it("does not extrapolate or bridge gaps larger than the supported interval", () => {
    expect(playbackPositionAt(frames, [], 1, 30_000, 11)).toBeUndefined()
    expect(playbackPositionAt(frames, [], 1, 180_000, 11)).toBeUndefined()
    const sparse = [frame(0, { 1: { x: 1_000, y: 1_000 } }), frame(120_000, { 1: { x: 2_000, y: 2_000 } })]
    expect(playbackPositionAt(sparse, [], 1, 60_000, 11)).toBeUndefined()
  })

  it("uses a positioned death as the final anchor and hides the victim afterward", () => {
    const events: TimelineEvent[] = [{
      eventId: "death",
      timestamp: 90_000,
      type: "CHAMPION_KILL",
      category: "kill",
      targetId: 1,
      position: { x: 2_000, y: 3_000 },
    }]
    expect(playbackPositionAt(frames, events, 1, 75_000, 11)?.position).toEqual({ x: 1_500, y: 2_500 })
    expect(playbackPositionAt(frames, events, 1, 90_000, 11)?.position).toEqual({ x: 2_000, y: 3_000 })
    expect(playbackPositionAt(frames, events, 1, 100_000, 11)).toBeUndefined()
    expect(playbackPositionAt(frames, events, 1, 120_000, 11)?.position).toEqual({ x: 3_000, y: 6_000 })
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
    expect(markers.find((marker) => marker.kind === "dragon")?.state).toBe("dormant")
    expect(markers.find((marker) => marker.kind === "baron")?.state).toBe("dormant")
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

  it("derives Dragon and Baron state without requiring a kill event to show their pits", () => {
    const dragon: TimelineEvent = {
      eventId: "dragon",
      timestamp: 8 * 60_000,
      type: "ELITE_MONSTER_KILL",
      category: "objective",
      teamId: 100,
      objective: "FIRE_DRAGON",
      position: { x: 9_860, y: 4_410 },
    }
    const baron: TimelineEvent = {
      eventId: "baron",
      timestamp: 22 * 60_000,
      type: "ELITE_MONSTER_KILL",
      category: "objective",
      teamId: 200,
      objective: "BARON_NASHOR",
      position: { x: 5_000, y: 10_450 },
    }

    const statesAt = (timestamp: number) => Object.fromEntries(playbackWorldMarkers([dragon, baron], timestamp, 11)
      .filter((marker) => marker.kind === "dragon" || marker.kind === "baron")
      .map((marker) => [marker.kind, marker.state]))

    expect(statesAt(6 * 60_000)).toMatchObject({ dragon: "alive", baron: "dormant" })
    expect(statesAt(9 * 60_000)).toMatchObject({ dragon: "respawning", baron: "dormant" })
    expect(statesAt(14 * 60_000)).toMatchObject({ dragon: "alive", baron: "dormant" })
    expect(statesAt(21 * 60_000)).toMatchObject({ dragon: "alive", baron: "alive" })
    expect(statesAt(23 * 60_000)).toMatchObject({ dragon: "alive", baron: "respawning" })
  })

  it("spreads overlapping champions deterministically and keeps their source positions", () => {
    const spread = spreadOverlappingMapPoints([
      { id: 3, left: 50, top: 50 },
      { id: 1, left: 50, top: 50 },
      { id: 2, left: 80, top: 80 },
    ])

    expect(spread.find((point) => point.id === 2)).toEqual({
      id: 2,
      left: 80,
      top: 80,
      sourceLeft: 80,
      sourceTop: 80,
      overlapping: false,
    })
    const clustered = spread.filter((point) => point.id !== 2)
    expect(clustered.every((point) => point.overlapping)).toBe(true)
    expect(new Set(clustered.map((point) => `${point.left}:${point.top}`)).size).toBe(2)
    expect(clustered.every((point) => point.sourceLeft === 50 && point.sourceTop === 50)).toBe(true)
  })
})
