import { describe, expect, it } from "vitest"
import { CAMP_BY_KEY } from "../electron/main/jungle/camp-map.js"
import { CampStateMachine } from "../electron/main/jungle/camp-state-machine.js"
import { CampTemplateBank } from "../electron/main/jungle/camp-visual-detector.js"
import { OpenCvCampDetector } from "../electron/main/vision/opencv-camp-detector.js"
import { loadOpenCv } from "../electron/main/vision/opencv-runtime.js"
import type {
  CampStateObservation,
  CampVisualState,
  RgbaFrame,
} from "../src/shared/minimap/contracts.js"

const CAMP = CAMP_BY_KEY.get("west_blue")!

function campPatch(alive: boolean): RgbaFrame {
  const width = 24
  const height = 24
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 42 + ((x * 11 + y * 7 + Math.floor(x / 3) * 5) % 54)
      if (alive && x >= 5 && x <= 18 && y >= 5 && y <= 18) {
        value = (x + y) % 2 === 0 ? 238 : 18
      }
      const index = (y * width + x) * 4
      data.set([value, value, value, 255], index)
    }
  }
  return { width, height, data, capturedMonotonicMs: 0, frameSequence: 1 }
}

function broadOcclusion(): RgbaFrame {
  const patch = campPatch(false)
  for (let index = 0; index < patch.data.length; index += 4) {
    const value = 255 - patch.data[index]
    patch.data.set([value, value, value, 255], index)
  }
  return patch
}

function lateAliveCampPatch(): RgbaFrame {
  const patch = campPatch(false)
  for (let y = 5; y <= 18; y += 1) {
    for (let x = 5; x <= 18; x += 1) {
      if ((x + y) % 3 !== 0) continue
      patch.data.set([205, 155, 58, 255], (y * patch.width + x) * 4)
    }
  }
  return patch
}


function minimapFrameWithAliveCamp(frameSequence: number): RgbaFrame {
  const width = 240
  const height = 240
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 48 + ((x * 7 + y * 11 + Math.floor(x / 5) * 3) % 42)
      const dx = x - CAMP.center.x * width
      const dy = y - CAMP.center.y * height
      if (Math.hypot(dx, dy) <= width * CAMP.patchRadius * 0.7) {
        value = (x + y) % 2 === 0 ? 236 : 16
      }
      const index = (y * width + x) * 4
      data.set([value, value, value, 255], index)
    }
  }
  return { width, height, data, capturedMonotonicMs: 0, frameSequence }
}

function observation(
  state: CampVisualState,
  gameTimeMs: number,
  frameSequence: number,
  sourceConfidence = 0.9,
): CampStateObservation {
  return {
    gameId: 7,
    campKey: "west_blue",
    gameTimeMs,
    state,
    source: "minimap_cv",
    sourceConfidence,
    frameSequence,
    providerVersion: 4_001,
  }
}

describe("adaptive camp visual accuracy", () => {
  it("recovers an alive baseline after capture starts late, but only with camp-icon color evidence", async () => {
    const detector = new OpenCvCampDetector(await loadOpenCv())
    const visible = lateAliveCampPatch()
    const absent = campPatch(false)
    try {
      expect(detector.classifyPatch(absent, CAMP, 600_000).state).toBe("unknown")
      expect(detector.classifyPatch(absent, CAMP, 604_000).state).toBe("unknown")
      expect(detector.classifyPatch(absent, CAMP, 608_000).state).toBe("unknown")

      expect(detector.classifyPatch(visible, CAMP, 612_000).state).toBe("unknown")
      expect(detector.classifyPatch(visible, CAMP, 616_000).state).toBe("unknown")
      expect(detector.classifyPatch(visible, CAMP, 620_000)).toMatchObject({
        state: "alive",
        method: "adaptive_alive_baseline",
      })
    } finally { detector.close() }
  })

  it("learns an early alive baseline across irregular healthy capture intervals", async () => {
    const detector = new OpenCvCampDetector(await loadOpenCv())
    const patch = campPatch(true)
    try {
      expect(detector.classifyPatch(patch, CAMP, 91_100).state).toBe("unknown")
      expect(detector.classifyPatch(patch, CAMP, 94_600).state).toBe("unknown")
      expect(detector.classifyPatch(patch, CAMP, 98_100)).toMatchObject({
        state: "alive",
        method: "adaptive_alive_baseline",
      })
    } finally { detector.close() }
  })


  it("does not mutate an adaptive baseline while a champion marker occludes the camp", async () => {
    const bank = new CampTemplateBank()
    const detector = new OpenCvCampDetector(await loadOpenCv())
    detector.setTemplates(bank.snapshot())
    const occluded = new Set(["west_blue" as const])

    for (const [index, gameTimeMs] of [91_000, 94_500, 98_000].entries()) {
      const result = detector.observeAll({
        frame: minimapFrameWithAliveCamp(index + 1),
        gameId: 7,
        gameTimeMs,
        occludedCampKeys: occluded,
      }).find((entry) => entry.campKey === "west_blue")
      expect(result?.state).toBe("unknown")
    }

    const learned = [98_100, 99_100, 100_100].map((gameTimeMs, index) =>
      detector.observeAll({
        frame: minimapFrameWithAliveCamp(index + 4),
        gameId: 7,
        gameTimeMs,
      }).find((entry) => entry.campKey === "west_blue")?.state,
    )
    expect(learned).toEqual(["unknown", "unknown", "alive"])
    detector.close()
  })

  it("never restarts baseline learning after the early appearance changes", async () => {
    const detector = new OpenCvCampDetector(await loadOpenCv())
    try {
      expect(detector.classifyPatch(campPatch(true), CAMP, 91_100).state).toBe("unknown")
      expect(detector.classifyPatch(campPatch(false), CAMP, 94_600).state).toBe("unknown")
      expect(detector.classifyPatch(campPatch(false), CAMP, 97_200).state).toBe("unknown")
      expect(detector.classifyPatch(campPatch(false), CAMP, 99_800).state).toBe("unknown")
      expect(detector.classifyPatch(campPatch(false), CAMP, 104_000).state).toBe("unknown")
    } finally { detector.close() }
  })

  it("preserves first localized absence while state confirmation remains multi-frame", async () => {
    const detector = new OpenCvCampDetector(await loadOpenCv())
    const machine = new CampStateMachine()
    const alive = campPatch(true)
    const absent = campPatch(false)

    detector.classifyPatch(alive, CAMP, 91_100)
    detector.classifyPatch(alive, CAMP, 94_600)
    expect(detector.classifyPatch(alive, CAMP, 98_100).state).toBe("alive")
    machine.observe(observation("alive", 98_100, 1))
    machine.observe(observation("alive", 98_600, 2))
    machine.observe(observation("alive", 99_100, 3))

    const first = detector.classifyPatch(absent, CAMP, 104_000)
    const second = detector.classifyPatch(absent, CAMP, 104_500)
    const third = detector.classifyPatch(absent, CAMP, 105_000)
    expect([first.state, second.state, third.state]).toEqual(["dead", "dead", "dead"])
    expect(machine.observe(observation(first.state, 104_000, 4, first.confidence)))
      .toBeUndefined()
    expect(machine.observe(observation(second.state, 104_500, 5, second.confidence)))
      .toBeUndefined()
    expect(machine.observe(observation(third.state, 105_000, 6, third.confidence)))
      .toMatchObject({
        previousState: "alive",
        state: "dead",
        observedAtMs: 104_000,
        confirmedAtMs: 105_000,
      })

    detector.reset()
    detector.classifyPatch(alive, CAMP, 91_100)
    detector.classifyPatch(alive, CAMP, 94_600)
    detector.classifyPatch(alive, CAMP, 98_100)
    expect(detector.classifyPatch(broadOcclusion(), CAMP, 104_000).state).toBe("unknown")
    expect(detector.classifyPatch(broadOcclusion(), CAMP, 107_500).state).toBe("unknown")
    expect(detector.classifyPatch(broadOcclusion(), CAMP, 111_000).state).toBe("unknown")
    detector.close()
  })
})

describe("camp state transition accuracy", () => {
  it("confirms present then absent across irregular cadence, never from one frame", () => {
    const machine = new CampStateMachine()

    expect(machine.observe(observation("alive", 91_000, 1))).toBeUndefined()
    expect(machine.observe(observation("alive", 94_600, 2))).toBeUndefined()
    expect(machine.observe(observation("alive", 98_200, 3))).toMatchObject({
      previousState: "unknown",
      state: "alive",
      observedAtMs: 91_000,
      confirmedAtMs: 98_200,
    })

    expect(machine.observe(observation("dead", 105_000, 4))).toBeUndefined()
    expect(machine.state("west_blue")?.state).toBe("alive")
    expect(machine.observe(observation("unknown", 106_000, 5, 0))).toBeUndefined()
    expect(machine.observe(observation("dead", 110_000, 6))).toBeUndefined()
    expect(machine.observe(observation("dead", 113_600, 7))).toBeUndefined()
    expect(machine.observe(observation("dead", 117_200, 8))).toMatchObject({
      previousState: "alive",
      state: "dead",
      observedAtMs: 110_000,
      confirmedAtMs: 117_200,
    })
  })

  it("will not confirm absence without previously confirmed presence", () => {
    const machine = new CampStateMachine()

    expect(machine.observe(observation("dead", 100_000, 1))).toBeUndefined()
    expect(machine.observe(observation("dead", 103_000, 2))).toBeUndefined()
    expect(machine.observe(observation("dead", 106_000, 3))).toBeUndefined()
    expect(machine.state("west_blue")).toBeUndefined()
  })

  it("does not count the same captured frame more than once", () => {
    const machine = new CampStateMachine()

    expect(machine.observe(observation("alive", 1_000, 1))).toBeUndefined()
    expect(machine.observe(observation("alive", 1_000, 1))).toBeUndefined()
    expect(machine.observe(observation("alive", 1_400, 2))).toBeUndefined()
    expect(machine.observe(observation("alive", 1_800, 3))).toMatchObject({
      state: "alive",
      confirmedAtMs: 1_800,
    })
  })
})
