import { describe, expect, it } from "vitest"
import {
  assignRosterIdentities,
  ChampionMarkerDetector,
  createChampionMarkerTemplate,
} from "../electron/main/minimap/champion-marker-detector.js"
import { ChampionTracker } from "../electron/main/minimap/champion-tracker.js"
import type {
  ChampionPositionObservation,
  RgbaFrame,
} from "../src/shared/minimap/contracts.js"

function frame(width: number, height: number, fill: [number, number, number, number]) {
  const data = new Uint8Array(width * height * 4)
  for (let index = 0; index < width * height; index += 1) data.set(fill, index * 4)
  return { width, height, data, capturedMonotonicMs: 0, frameSequence: 1 }
}

function setPixel(target: RgbaFrame, x: number, y: number, rgba: ArrayLike<number>) {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height) return
  target.data.set(rgba, (y * target.width + x) * 4)
}

function patternedIcon(size: number, offset = 0) {
  const result = frame(size, size, [25, 25, 25, 255])
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const on = ((x * (3 + offset) + y * 5 + Math.floor(x / 3)) % 11) < 5
      const value = on ? 220 : 48
      setPixel(result, x, y, [value, value, value, 255])
    }
  }
  return result
}

function drawMarker(
  target: RgbaFrame,
  icon: RgbaFrame,
  centerX: number,
  centerY: number,
  ring: [number, number, number, number],
  innerRadius = 7,
  outerRadius = 10,
) {
  const iconLeft = centerX - Math.floor(icon.width / 2)
  const iconTop = centerY - Math.floor(icon.height / 2)
  for (let y = 0; y < icon.height; y += 1) {
    for (let x = 0; x < icon.width; x += 1) {
      const source = (y * icon.width + x) * 4
      setPixel(
        target,
        iconLeft + x,
        iconTop + y,
        icon.data.subarray(source, source + 4),
      )
    }
  }
  for (let y = centerY - outerRadius; y <= centerY + outerRadius; y += 1) {
    for (let x = centerX - outerRadius; x <= centerX + outerRadius; x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY)
      if (distance >= innerRadius && distance <= outerRadius) {
        setPixel(target, x, y, ring)
      }
    }
  }
}

function observation(
  gameTimeMs: number,
  frameSequence: number,
  x: number,
  y: number,
  championName = "Zac",
): ChampionPositionObservation {
  return {
    gameId: 7,
    participantKey: "ally:zac",
    championName,
    team: "ally",
    isLocal: true,
    gameTimeMs,
    position: { x, y },
    source: "minimap_cv",
    identityConfidence: 0.95,
    positionConfidence: 0.92,
    frameSequence,
    detectorVersion: 2,
  }
}

describe("champion marker precision", () => {
  it("uses a global one-to-one roster assignment when greedy matching would fail", () => {
    const assignments = assignRosterIdentities([
      [0.93, 0.91],
      [0.90, 0.71],
    ], 0.70, 0.05)

    expect(assignments.map(({ proposalIndex, templateIndex }) => [
      proposalIndex,
      templateIndex,
    ])).toEqual([
      [0, 1],
      [1, 0],
    ])
  })

  it("chooses no match when evidence is too close to the correlation floor", () => {
    expect(assignRosterIdentities([[0.73, 0.72]], 0.72, 0.06)).toEqual([])
  })

  it("abstains when two global roster mappings are nearly tied", () => {
    expect(assignRosterIdentities([
      [0.93, 0.92],
      [0.92, 0.93],
    ], 0.70, 0.06)).toEqual([])
  })

  it("abstains when the same identity has two equally supported positions", () => {
    expect(assignRosterIdentities([
      [0.95],
      [0.95],
    ], 0.70, 0.06)).toEqual([])
  })

  it("keeps touching ally and enemy rings as separate proposals", () => {
    const canvas = frame(100, 80, [8, 10, 12, 255])
    const enemyIcon = patternedIcon(15)
    const allyIcon = patternedIcon(15, 2)
    drawMarker(canvas, enemyIcon, 35, 35, [255, 20, 20, 255])
    drawMarker(canvas, allyIcon, 56, 35, [20, 185, 250, 255])
    const detector = new ChampionMarkerDetector()

    const found = detector.detect({
      frame: canvas,
      templates: [
        createChampionMarkerTemplate({
          participantKey: "enemy:ahri",
          championName: "Ahri",
          team: "enemy",
          isLocal: false,
        }, enemyIcon),
        createChampionMarkerTemplate({
          participantKey: "ally:zac",
          championName: "Zac",
          team: "ally",
          isLocal: true,
        }, allyIcon),
      ],
      gameId: 7,
      gameTimeMs: 12_345,
    })

    expect(found.map((item) => item.participantKey)).toEqual([
      "ally:zac",
      "enemy:ahri",
    ])
  })

  it("retains identity detail for the screenshot's 1.5-scale champion rings", () => {
    const canvas = frame(120, 100, [8, 10, 12, 255])
    const icon = patternedIcon(23, 3)
    drawMarker(canvas, icon, 60, 50, [255, 20, 20, 255], 11, 15)
    const detector = new ChampionMarkerDetector()

    const found = detector.detect({
      frame: canvas,
      templates: [
        createChampionMarkerTemplate({
          participantKey: "enemy:ahri",
          championName: "Ahri",
          team: "enemy",
          isLocal: false,
        }, icon),
      ],
      gameId: 7,
      gameTimeMs: 12_345,
    })

    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      participantKey: "enemy:ahri",
      detectorVersion: 2,
    })
  })

  it("rejects a coloured ring whose portrait has no roster match", () => {
    const canvas = frame(80, 80, [8, 10, 12, 255])
    const unrelated = frame(15, 15, [127, 127, 127, 255])
    drawMarker(canvas, unrelated, 40, 40, [255, 20, 20, 255])
    const detector = new ChampionMarkerDetector()

    const found = detector.detect({
      frame: canvas,
      templates: [
        createChampionMarkerTemplate({
          participantKey: "enemy:ahri",
          championName: "Ahri",
          team: "enemy",
          isLocal: false,
        }, patternedIcon(15)),
      ],
      gameId: 7,
      gameTimeMs: 12_345,
    })

    expect(found).toEqual([])
    expect(detector.getProposalFootprints()).toEqual([expect.objectContaining({
      team: "enemy",
      center: {
        x: expect.closeTo(40 / 79),
        y: expect.closeTo(40 / 79),
      },
      radius: expect.closeTo(21 / 79 / 2),
    })])

    detector.detect({
      frame: frame(80, 80, [8, 10, 12, 255]),
      templates: [],
      gameId: 7,
      gameTimeMs: 12_470,
    })
    expect(detector.getProposalFootprints()).toEqual([])
  })

  it("bounds the identity-free proposal snapshot", () => {
    const canvas = frame(240, 120, [8, 10, 12, 255])
    const icon = frame(9, 9, [127, 127, 127, 255])
    for (let y = 12; y <= 108; y += 24) {
      for (let x = 12; x <= 228; x += 24) {
        drawMarker(canvas, icon, x, y, [255, 20, 20, 255], 6, 9)
      }
    }
    const detector = new ChampionMarkerDetector()

    expect(detector.detect({
      frame: canvas,
      templates: [],
      gameId: 7,
      gameTimeMs: 12_345,
    })).toEqual([])
    expect(detector.getProposalFootprints()).toHaveLength(32)
  })
})

describe("champion tracker precision", () => {
  it("confirms identity over time and accepts a corroborated long relocation", () => {
    const tracker = new ChampionTracker()

    expect(tracker.update({
      gameTimeMs: 1_000,
      observations: [observation(1_000, 1, 0.1, 0.1)],
    })).toEqual([])
    expect(tracker.getConfirmedObservations()).toEqual([])

    const confirmed = tracker.update({
      gameTimeMs: 1_125,
      observations: [observation(1_125, 2, 0.11, 0.1)],
    })
    expect(confirmed[0]).toMatchObject({
      participantKey: "ally:zac",
      state: "visible",
      position: { x: 0.11, y: 0.1 },
    })
    expect(tracker.getConfirmedObservations().map((item) => item.continuity))
      .toEqual(["continuous", "continuous"])

    const pendingRelocation = tracker.update({
      gameTimeMs: 1_250,
      observations: [observation(1_250, 3, 0.8, 0.8)],
    })
    expect(pendingRelocation[0].state).toBe("temporarily_occluded")
    expect(pendingRelocation[0].position).toBeUndefined()
    expect(tracker.getConfirmedObservations()).toEqual([])

    const relocated = tracker.update({
      gameTimeMs: 1_375,
      observations: [observation(1_375, 4, 0.81, 0.8)],
    })
    expect(relocated[0]).toMatchObject({
      state: "visible",
      position: { x: 0.81, y: 0.8 },
    })
    expect(tracker.getConfirmedObservations().map((item) => ({
      gameTimeMs: item.gameTimeMs,
      continuity: item.continuity,
    }))).toEqual([
      { gameTimeMs: 1_250, continuity: "relocation" },
      { gameTimeMs: 1_375, continuity: "continuous" },
    ])
  })

  it("abstains when a participant key suddenly claims a different identity", () => {
    const tracker = new ChampionTracker()
    tracker.update({
      gameTimeMs: 1_000,
      observations: [observation(1_000, 1, 0.1, 0.1)],
    })
    tracker.update({
      gameTimeMs: 1_125,
      observations: [observation(1_125, 2, 0.11, 0.1)],
    })

    const snapshots = tracker.update({
      gameTimeMs: 1_250,
      observations: [observation(1_250, 3, 0.12, 0.1, "Not Zac")],
    })

    expect(snapshots[0]).toMatchObject({
      championName: "Zac",
      state: "temporarily_occluded",
    })
    expect(tracker.getConfirmedObservations()).toEqual([])
  })
})
