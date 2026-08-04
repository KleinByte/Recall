import { describe, expect, it } from "vitest"
import {
  isUsableMapPosition,
  playbackCoverage,
  playbackPositionAt,
  playbackTrailSamples,
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
})
