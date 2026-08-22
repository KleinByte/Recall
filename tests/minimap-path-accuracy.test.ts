import { describe, expect, it } from "vitest"
import type { ChampionPositionObservation } from "../src/shared/minimap/contracts.js"
import { PathReconstructor } from "../electron/main/pathing/path-reconstructor.js"

const policy = { gameId: 9, livePhase: "PostGame" as const, matchCompleted: true }

function observation(input: Partial<ChampionPositionObservation> = {}): ChampionPositionObservation {
  return {
    gameId: 9,
    participantKey: "ally:zac",
    championName: "Zac",
    team: "ally",
    isLocal: true,
    gameTimeMs: 10_000,
    position: { x: 0.1, y: 0.1 },
    source: "minimap_cv",
    identityConfidence: 0.9,
    positionConfidence: 0.9,
    frameSequence: 10,
    detectorVersion: 2,
    continuity: "continuous",
    ...input,
  }
}

describe("accuracy-first minimap paths", () => {
  it("accepts a large observed displacement without a champion speed cap", () => {
    const start = observation()
    const end = observation({
      gameTimeMs: 10_125,
      frameSequence: 11,
      position: { x: 0.82, y: 0.76 },
    })
    const segment = new PathReconstructor().reconstructGap({
      policy,
      gameId: 9,
      participantKey: start.participantKey,
      start,
      end,
    })
    expect(segment.kind).toBe("observed")
    expect(segment.points).toEqual([start.position, end.position])
  })

  it("estimates a graph-backed route across feasible missing visibility", () => {
    const start = observation({ position: { x: 0.266, y: 0.468 } })
    const end = observation({
      gameTimeMs: 30_000,
      frameSequence: 80,
      position: { x: 0.535, y: 0.733 },
      continuity: "relocation",
    })
    const segment = new PathReconstructor().reconstructGap({
      policy,
      gameId: 9,
      participantKey: start.participantKey,
      start,
      end,
    })
    expect(segment.kind).toBe("inferred")
    expect(segment.confidence).toBeGreaterThan(0)
    expect(segment.points[0]).toEqual(start.position)
    expect(segment.points.at(-1)).toEqual(end.position)
    expect(segment.points.length).toBeGreaterThan(2)
    expect(segment.inferenceMode).toBe("smoothed_postgame")
    expect(segment.uncertaintyRadius).toHaveLength(segment.points.length)
  })

  it("does not connect low-confidence detections", () => {
    const start = observation({ identityConfidence: 0.55 })
    const end = observation({ gameTimeMs: 10_125, frameSequence: 11 })
    const segments = new PathReconstructor().buildSegments({
      policy,
      gameId: 9,
      participantKey: start.participantKey,
      observations: [start, end],
    })
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe("unknown")
  })

  it("keeps a confirmed relocation as two sightings without a route", () => {
    const start = observation()
    const end = observation({
      gameTimeMs: 10_125,
      frameSequence: 11,
      position: { x: 0.8, y: 0.8 },
      continuity: "relocation",
    })
    const segment = new PathReconstructor().reconstructGap({
      policy,
      gameId: 9,
      participantKey: start.participantKey,
      start,
      end,
    })
    expect(segment.kind).toBe("unknown")
  })

  it("uses a brief sighting to split and refine the hidden route", () => {
    const start = observation({
      position: { x: 0.266, y: 0.468 },
    })
    const brief = observation({
      gameTimeMs: 20_000,
      frameSequence: 50,
      position: { x: 0.267, y: 0.563 },
      continuity: "relocation",
    })
    const end = observation({
      gameTimeMs: 30_000,
      frameSequence: 90,
      position: { x: 0.481, y: 0.638 },
      continuity: "relocation",
    })
    const segments = new PathReconstructor().buildSegments({
      policy,
      gameId: 9,
      participantKey: start.participantKey,
      observations: [start, brief, end],
    })

    expect(segments.map((segment) => segment.kind)).toEqual(["inferred", "inferred"])
    expect(segments[0].points.at(-1)).toEqual(brief.position)
    expect(segments[1].points[0]).toEqual(brief.position)
  })

  it("never connects legacy observations without explicit continuity", () => {
    const start = observation({ continuity: undefined })
    const end = observation({
      gameTimeMs: 10_125,
      frameSequence: 11,
      position: { x: 0.8, y: 0.8 },
      continuity: undefined,
    })
    const segment = new PathReconstructor().reconstructGap({
      policy,
      gameId: 9,
      participantKey: start.participantKey,
      start,
      end,
    })
    expect(segment.kind).toBe("unknown")
  })
})
