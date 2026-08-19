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

  it("does not invent a route across missing visibility", () => {
    const start = observation()
    const end = observation({
      gameTimeMs: 16_000,
      frameSequence: 30,
      position: { x: 0.75, y: 0.25 },
    })
    const segment = new PathReconstructor().reconstructGap({
      policy,
      gameId: 9,
      participantKey: start.participantKey,
      start,
      end,
    })
    expect(segment.kind).toBe("unknown")
    expect(segment.confidence).toBe(0)
    expect(segment.points).toEqual([start.position, end.position])
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
