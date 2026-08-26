import { describe, expect, it } from "vitest"
import {
  assignRosterIdentities,
  CHAMPION_MARKER_DETECTOR_VERSION,
  createChampionMarkerTemplate,
} from "../electron/main/minimap/champion-marker-detector.js"
import {
  filterOverlayStormProposals,
  modelIdentityScore,
  OpenCvChampionDetector,
  temporalIdentityContinuityBonus,
} from "../electron/main/vision/opencv-champion-detector.js"
import { loadOpenCv } from "../electron/main/vision/opencv-runtime.js"
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

function equalLuminanceChromaIcon(size: number, inverted = false) {
  const result = frame(size, size, [0, 0, 0, 255])
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const luminance = ((x * 3 + y * 5) % 9) < 4 ? 72 : 34
      const useGreen = (((x + Math.floor(y / 2)) % 4) < 2) !== inverted
      const colour = useGreen
        ? [0, Math.round(luminance / .587), 0, 255]
        : [Math.round(luminance / .413), 0, Math.round(luminance / .413), 255]
      setPixel(result, x, y, colour)
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
    detectorVersion: CHAMPION_MARKER_DETECTOR_VERSION,
  }
}

describe("champion marker precision", () => {
  it("requires portrait corroboration for weak model identities", () => {
    expect(modelIdentityScore(0.73, 0.14)).toBeGreaterThan(0.72)
    expect(modelIdentityScore(0.5, 0.14)).toBeLessThan(0.72)
    expect(modelIdentityScore(0.2, 0.91)).toBeGreaterThan(0.9)
  })

  it("removes a Blitz-sized Hough circle storm while retaining component markers", () => {
    const component = { footprint: { proposalSource: "component" as const }, id: "champion" }
    const hough = Array.from({ length: 8 }, (_, index) => ({
      footprint: { proposalSource: "hough_circle" as const },
      id: `route-${index}`,
    }))

    expect(filterOverlayStormProposals([component, ...hough], 5)).toEqual([component])
    expect(filterOverlayStormProposals([component, ...hough.slice(0, 6)], 5))
      .toHaveLength(7)
    expect(filterOverlayStormProposals(
      [component, ...hough],
      5,
      (proposal) => proposal.id === "route-3",
    )).toEqual([component, hough[3]])
  })

  it("uses only fresh, nearby positions as an identity continuity hint", () => {
    expect(temporalIdentityContinuityBonus({
      previous: { x: .5, y: .5 },
      current: { x: .505, y: .503 },
      ageMs: 250,
    })).toBeGreaterThan(.05)
    expect(temporalIdentityContinuityBonus({
      previous: { x: .5, y: .5 },
      current: { x: .7, y: .7 },
      ageMs: 250,
    })).toBe(0)
    expect(temporalIdentityContinuityBonus({
      previous: { x: .5, y: .5 },
      current: { x: .505, y: .503 },
      ageMs: 2_000,
    })).toBe(0)
  })

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

  it("keeps touching ally and enemy rings as separate proposals", async () => {
    const canvas = frame(100, 80, [8, 10, 12, 255])
    const enemyIcon = patternedIcon(15)
    const allyIcon = patternedIcon(15, 2)
    drawMarker(canvas, enemyIcon, 35, 35, [255, 20, 20, 255])
    drawMarker(canvas, allyIcon, 56, 35, [20, 185, 250, 255])
    const detector = new OpenCvChampionDetector(await loadOpenCv())
    detector.setTemplates([
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
    ])
    try {
      const found = detector.detect({ frame: canvas, gameId: 7, gameTimeMs: 12_345 })
      expect(found.observations.map((item) => item.participantKey)).toEqual([
        "ally:zac",
        "enemy:ahri",
      ])
      expect(found.proposals).toHaveLength(2)
    } finally { detector.close() }
  })

  it("retains identity detail for the screenshot's 1.5-scale champion rings", async () => {
    const canvas = frame(120, 100, [8, 10, 12, 255])
    const icon = patternedIcon(23, 3)
    drawMarker(canvas, icon, 60, 50, [255, 20, 20, 255], 11, 15)
    const detector = new OpenCvChampionDetector(await loadOpenCv())
    detector.setTemplates([createChampionMarkerTemplate({
      participantKey: "enemy:ahri",
      championName: "Ahri",
      team: "enemy",
      isLocal: false,
    }, icon)])
    try {
      const found = detector.detect({ frame: canvas, gameId: 7, gameTimeMs: 12_345 })
      expect(found.observations).toHaveLength(1)
      expect(found.observations[0]).toMatchObject({
        participantKey: "enemy:ahri",
        detectorVersion: CHAMPION_MARKER_DETECTOR_VERSION,
      })
    } finally { detector.close() }
  })

  it("finds an ally ring whose blue component merges into blue terrain", async () => {
    const canvas = frame(100, 90, [24, 92, 120, 255])
    const icon = patternedIcon(15, 2)
    drawMarker(canvas, icon, 50, 45, [20, 185, 250, 255])
    const detector = new OpenCvChampionDetector(await loadOpenCv())
    detector.setTemplates([createChampionMarkerTemplate({
      participantKey: "ally:zac",
      championName: "Zac",
      team: "ally",
      isLocal: true,
    }, icon)])
    try {
      const found = detector.detect({ frame: canvas, gameId: 7, gameTimeMs: 12_345 })
      expect(found.observations).toEqual([expect.objectContaining({
        participantKey: "ally:zac",
      })])
      expect(found.proposals).toContainEqual(expect.objectContaining({
        proposalSource: "edge_circle",
        identityAccepted: true,
      }))
    } finally { detector.close() }
  })

  it("uses a roster-conditioned model detection when no coloured ring is visible", async () => {
    const canvas = frame(100, 90, [24, 92, 120, 255])
    const icon = patternedIcon(15, 4)
    const centerX = 62
    const centerY = 48
    const left = centerX - Math.floor(icon.width / 2)
    const top = centerY - Math.floor(icon.height / 2)
    for (let y = 0; y < icon.height; y += 1) {
      for (let x = 0; x < icon.width; x += 1) {
        const source = (y * icon.width + x) * 4
        setPixel(canvas, left + x, top + y, icon.data.subarray(source, source + 4))
      }
    }
    const detector = new OpenCvChampionDetector(await loadOpenCv())
    detector.setTemplates([createChampionMarkerTemplate({
      participantKey: "ally:garen",
      championName: "Garen",
      team: "ally",
      isLocal: false,
    }, icon)])
    try {
      const found = detector.detect({
        frame: canvas,
        gameId: 7,
        gameTimeMs: 12_345,
        learnedDetections: [{
          championKey: "garen",
          championName: "Garen",
          confidence: 0.91,
          centerX: centerX / (canvas.width - 1),
          centerY: centerY / (canvas.height - 1),
          width: 22 / canvas.width,
          height: 22 / canvas.height,
        }],
      })
      expect(found.observations).toEqual([expect.objectContaining({
        participantKey: "ally:garen",
      })])
      expect(found.proposals).toContainEqual(expect.objectContaining({
        proposalSource: "model",
        modelConfidence: expect.closeTo(0.91),
        identityAccepted: true,
      }))
    } finally { detector.close() }
  })

  it("uses portrait colour when two roster icons have the same luminance", async () => {
    const canvas = frame(90, 80, [8, 10, 12, 255])
    const garenLike = equalLuminanceChromaIcon(15)
    const other = equalLuminanceChromaIcon(15, true)
    drawMarker(canvas, garenLike, 45, 40, [20, 185, 250, 255])
    const detector = new OpenCvChampionDetector(await loadOpenCv())
    detector.setTemplates([
      createChampionMarkerTemplate({
        participantKey: "ally:garen",
        championName: "Garen",
        team: "ally",
        isLocal: false,
      }, garenLike),
      createChampionMarkerTemplate({
        participantKey: "ally:other",
        championName: "Other",
        team: "ally",
        isLocal: false,
      }, other),
    ])
    try {
      const found = detector.detect({ frame: canvas, gameId: 7, gameTimeMs: 12_345 })
      expect(found.observations).toHaveLength(1)
      expect(found.observations[0].participantKey).toBe("ally:garen")
    } finally { detector.close() }
  })

  it("rejects a coloured ring whose portrait has no roster match", async () => {
    const canvas = frame(80, 80, [8, 10, 12, 255])
    const unrelated = frame(15, 15, [127, 127, 127, 255])
    drawMarker(canvas, unrelated, 40, 40, [255, 20, 20, 255])
    const detector = new OpenCvChampionDetector(await loadOpenCv())
    detector.setTemplates([createChampionMarkerTemplate({
      participantKey: "enemy:ahri",
      championName: "Ahri",
      team: "enemy",
      isLocal: false,
    }, patternedIcon(15))])
    try {
      const found = detector.detect({ frame: canvas, gameId: 7, gameTimeMs: 12_345 })
      expect(found.observations).toEqual([])
      expect(found.proposals).toEqual([expect.objectContaining({
        team: "enemy",
        center: {
          x: expect.closeTo(40 / 79),
          y: expect.closeTo(40 / 79),
        },
        radius: expect.closeTo(21 / 79 / 2),
      })])

      const empty = detector.detect({
        frame: frame(80, 80, [8, 10, 12, 255]),
        gameId: 7,
        gameTimeMs: 12_470,
      })
      expect(empty.proposals).toEqual([])
    } finally { detector.close() }
  })

  it("bounds the identity-free proposal snapshot", async () => {
    const canvas = frame(240, 120, [8, 10, 12, 255])
    const icon = frame(9, 9, [127, 127, 127, 255])
    for (let y = 12; y <= 108; y += 24) {
      for (let x = 12; x <= 228; x += 24) {
        drawMarker(canvas, icon, x, y, [255, 20, 20, 255], 6, 9)
      }
    }
    const detector = new OpenCvChampionDetector(await loadOpenCv())
    try {
      const found = detector.detect({ frame: canvas, gameId: 7, gameTimeMs: 12_345 })
      expect(found.observations).toEqual([])
      expect(found.proposals).toHaveLength(32)
    } finally { detector.close() }
  })
})

describe("champion tracker precision", () => {
  it("discards pending initial confirmation while a participant is dead", () => {
    const tracker = new ChampionTracker()

    tracker.update({
      gameTimeMs: 1_000,
      observations: [observation(1_000, 1, 0.1, 0.1)],
    })
    tracker.update({
      gameTimeMs: 1_150,
      observations: [observation(1_150, 2, 0.11, 0.1)],
    })

    expect(tracker.update({
      gameTimeMs: 1_300,
      observations: [observation(1_300, 3, 0.12, 0.1)],
      deadParticipantKeys: ["ally:zac"],
    })).toEqual([])
    expect(tracker.getConfirmedObservations()).toEqual([])

    expect(tracker.update({
      gameTimeMs: 1_450,
      observations: [observation(1_450, 4, 0.13, 0.1)],
    })).toEqual([])
    expect(tracker.getConfirmedObservations()).toEqual([])
  })

  it("keeps the last track dead without confirming dead relocation observations", () => {
    const tracker = new ChampionTracker()
    tracker.update({
      gameTimeMs: 1_000,
      observations: [observation(1_000, 1, 0.1, 0.1)],
    })
    tracker.update({
      gameTimeMs: 1_150,
      observations: [observation(1_150, 2, 0.11, 0.1)],
    })
    tracker.update({
      gameTimeMs: 1_300,
      observations: [observation(1_300, 3, 0.12, 0.1)],
    })
    for (const [gameTimeMs, frameSequence, x] of [
      [1_500, 4, .8],
      [1_750, 5, .805],
      [2_000, 6, .81],
    ] as const) {
      tracker.update({
        gameTimeMs,
        observations: [observation(gameTimeMs, frameSequence, x, .8)],
      })
    }

    const dead = tracker.update({
      gameTimeMs: 2_250,
      observations: [observation(2_250, 7, .815, .8)],
      deadParticipantKeys: ["ally:zac"],
    })
    expect(dead[0]).toMatchObject({
      participantKey: "ally:zac",
      state: "dead",
      lastObservedPosition: { x: .12, y: .1 },
      lastObservedGameTimeMs: 1_300,
    })
    expect(dead[0].position).toBeUndefined()
    expect(tracker.getConfirmedObservations()).toEqual([])

    const firstAfterRespawn = tracker.update({
      gameTimeMs: 2_400,
      observations: [observation(2_400, 8, .82, .8)],
    })
    expect(firstAfterRespawn[0]).toMatchObject({
      state: "not_visible",
      lastObservedPosition: { x: .12, y: .1 },
      lastObservedGameTimeMs: 1_300,
    })
    expect(tracker.getConfirmedObservations()).toEqual([])
  })

  it("confirms identity over time and accepts a corroborated long relocation", () => {
    const tracker = new ChampionTracker()

    expect(tracker.update({
      gameTimeMs: 1_000,
      observations: [observation(1_000, 1, 0.1, 0.1)],
    })).toEqual([])
    expect(tracker.getConfirmedObservations()).toEqual([])

    expect(tracker.update({
      gameTimeMs: 1_150,
      observations: [observation(1_150, 2, 0.11, 0.1)],
    })).toEqual([])

    const confirmed = tracker.update({
      gameTimeMs: 1_300,
      observations: [observation(1_300, 3, 0.12, 0.1)],
    })
    expect(confirmed[0]).toMatchObject({
      participantKey: "ally:zac",
      state: "visible",
      position: { x: 0.12, y: 0.1 },
    })
    expect(tracker.getConfirmedObservations().map((item) => item.continuity))
      .toEqual(["continuous", "continuous", "continuous"])

    const pendingRelocation = tracker.update({
      gameTimeMs: 1_500,
      observations: [observation(1_500, 4, 0.8, 0.8)],
    })
    expect(pendingRelocation[0].state).toBe("temporarily_occluded")
    expect(pendingRelocation[0].position).toBeUndefined()
    expect(tracker.getConfirmedObservations()).toEqual([])

    tracker.update({
      gameTimeMs: 1_750,
      observations: [observation(1_750, 5, 0.805, 0.8)],
    })
    tracker.update({
      gameTimeMs: 2_000,
      observations: [observation(2_000, 6, 0.81, 0.8)],
    })
    const relocated = tracker.update({
      gameTimeMs: 2_250,
      observations: [observation(2_250, 7, 0.815, 0.8)],
    })
    expect(relocated[0]).toMatchObject({
      state: "visible",
      position: { x: 0.815, y: 0.8 },
    })
    expect(tracker.getConfirmedObservations().map((item) => ({
      gameTimeMs: item.gameTimeMs,
      continuity: item.continuity,
    }))).toEqual([
      { gameTimeMs: 1_500, continuity: "relocation" },
      { gameTimeMs: 1_750, continuity: "continuous" },
      { gameTimeMs: 2_000, continuity: "continuous" },
      { gameTimeMs: 2_250, continuity: "continuous" },
    ])
  })

  it("does not publish a two-frame overlay jump before the real track returns", () => {
    const tracker = new ChampionTracker()
    tracker.update({
      gameTimeMs: 1_000,
      observations: [observation(1_000, 1, 0.1, 0.1)],
    })
    tracker.update({
      gameTimeMs: 1_150,
      observations: [observation(1_150, 2, 0.11, 0.1)],
    })
    tracker.update({
      gameTimeMs: 1_300,
      observations: [observation(1_300, 3, 0.12, 0.1)],
    })

    for (const [gameTimeMs, frameSequence, x] of [
      [1_450, 4, .88],
      [1_600, 5, .89],
    ] as const) {
      const snapshots = tracker.update({
        gameTimeMs,
        observations: [observation(gameTimeMs, frameSequence, x, .84)],
      })
      expect(snapshots[0]).toMatchObject({ state: "temporarily_occluded" })
      expect(snapshots[0].position).toBeUndefined()
      expect(tracker.getConfirmedObservations()).toEqual([])
    }

    const returned = tracker.update({
      gameTimeMs: 1_750,
      observations: [observation(1_750, 6, .13, .1)],
    })
    expect(returned[0]).toMatchObject({
      state: "visible",
      position: { x: .13, y: .1 },
    })
    expect(tracker.getConfirmedObservations()).toEqual([
      expect.objectContaining({
        gameTimeMs: 1_750,
        position: { x: .13, y: .1 },
        continuity: "continuous",
      }),
    ])
  })

  it("abstains when a participant key suddenly claims a different identity", () => {
    const tracker = new ChampionTracker()
    tracker.update({
      gameTimeMs: 1_000,
      observations: [observation(1_000, 1, 0.1, 0.1)],
    })
    tracker.update({
      gameTimeMs: 1_150,
      observations: [observation(1_150, 2, 0.11, 0.1)],
    })
    tracker.update({
      gameTimeMs: 1_300,
      observations: [observation(1_300, 3, 0.12, 0.1)],
    })

    const snapshots = tracker.update({
      gameTimeMs: 1_450,
      observations: [observation(1_450, 4, 0.13, 0.1, "Not Zac")],
    })

    expect(snapshots[0]).toMatchObject({
      championName: "Zac",
      state: "temporarily_occluded",
    })
    expect(tracker.getConfirmedObservations()).toEqual([])
  })
})
