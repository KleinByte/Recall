import { describe, expect, it } from "vitest"
import type { PathSegment } from "../src/shared/minimap/contracts.js"
import {
  compactObservedPathSegments,
  preparePathRuns,
  simplifyTimedPath,
  smoothTimedPath,
  visibleTimedPath,
  type TimedPathPoint,
} from "../src/shared/minimap/path-processing.js"

function length(samples: TimedPathPoint[]) {
  return samples.slice(1).reduce((total, sample, index) =>
    total + Math.hypot(
      sample.point.x - samples[index].point.x,
      sample.point.y - samples[index].point.y,
    ), 0)
}

describe("playback path processing", () => {
  it("suppresses micro-reversals while preserving evidence endpoints", () => {
    const samples: TimedPathPoint[] = [
      { timestamp: 0, point: { x: .2, y: .8 } },
      { timestamp: 250, point: { x: .215, y: .79 } },
      { timestamp: 500, point: { x: .205, y: .798 } },
      { timestamp: 750, point: { x: .228, y: .78 } },
      { timestamp: 1_000, point: { x: .24, y: .77 } },
    ]
    const smoothed = smoothTimedPath(samples, { strength: .72 })

    expect(smoothed[0]).toEqual(samples[0])
    expect(smoothed.at(-1)).toEqual(samples.at(-1))
    expect(length(smoothed)).toBeLessThan(length(samples))
  })

  it("keeps material corners while bounding the SVG point payload", () => {
    const samples = Array.from({ length: 1_001 }, (_value, index) => ({
      timestamp: index * 250,
      point: {
        x: index <= 500 ? index / 1_000 : .5,
        y: index <= 500 ? .2 : .2 + (index - 500) / 1_000,
      },
    }))
    const simplified = simplifyTimedPath(samples, .0005, 64)

    expect(simplified.length).toBeLessThanOrEqual(64)
    expect(simplified.some((sample) => sample.point.x === .5 && sample.point.y === .2)).toBe(true)
    expect(simplified[0]).toEqual(samples[0])
    expect(simplified.at(-1)).toEqual(samples.at(-1))
  })

  it("groups continuous evidence but leaves rejected gaps disconnected", () => {
    const base = {
      gameId: 1,
      participantKey: "ally:test",
      confidence: .9,
      modelVersion: 4,
    }
    const segments: PathSegment[] = [{
      ...base,
      startTimeMs: 0,
      endTimeMs: 250,
      kind: "observed",
      points: [{ x: .1, y: .8 }, { x: .12, y: .78 }],
      pointTimesMs: [0, 250],
    }, {
      ...base,
      startTimeMs: 250,
      endTimeMs: 500,
      kind: "observed",
      points: [{ x: .12, y: .78 }, { x: .14, y: .76 }],
      pointTimesMs: [250, 500],
    }, {
      ...base,
      startTimeMs: 500,
      endTimeMs: 2_000,
      kind: "unknown",
      points: [{ x: .14, y: .76 }, { x: .5, y: .5 }],
      pointTimesMs: [500, 2_000],
    }, {
      ...base,
      startTimeMs: 2_000,
      endTimeMs: 2_250,
      kind: "observed",
      points: [{ x: .5, y: .5 }, { x: .52, y: .48 }],
      pointTimesMs: [2_000, 2_250],
    }]
    const runs = preparePathRuns(segments)

    expect(runs).toHaveLength(2)
    expect(runs[0].points[0].timestamp).toBe(0)
    expect(runs[0].points.at(-1)!.timestamp).toBe(500)
    expect(runs[1].points[0].timestamp).toBe(2_000)
    expect(visibleTimedPath(runs[1].points, 1_999)).toEqual([])
  })

  it("prepares an eight-thousand-sample track within a bounded review payload", () => {
    const points = Array.from({ length: 8_001 }, (_value, index) => ({
      x: .15 + index / 8_000 * .7,
      y: .8 - index / 8_000 * .6 + (index % 2 === 0 ? .0015 : -.0015),
    }))
    const segments: PathSegment[] = Array.from({ length: 8_000 }, (_value, index) => ({
      gameId: 1,
      participantKey: "ally:stress",
      startTimeMs: index * 250,
      endTimeMs: (index + 1) * 250,
      kind: "observed",
      points: [points[index], points[index + 1]],
      pointTimesMs: [index * 250, (index + 1) * 250],
      confidence: .9,
      modelVersion: 4,
    }))
    const startedAt = performance.now()
    const compacted = compactObservedPathSegments(segments)
    const runs = preparePathRuns(compacted)
    const elapsed = performance.now() - startedAt

    expect(compacted).toHaveLength(1)
    expect(compacted[0].points).toHaveLength(8_001)
    expect(runs).toHaveLength(1)
    expect(runs[0].points.length).toBeLessThanOrEqual(320)
    expect(elapsed).toBeLessThan(750)
  })
})
