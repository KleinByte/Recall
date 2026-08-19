import { describe, expect, it } from "vitest"
import { CAMP_BY_KEY } from "../electron/main/jungle/camp-map.js"
import { CampStateMachine } from "../electron/main/jungle/camp-state-machine.js"
import { AdaptiveCampBaselineDetector } from
  "../electron/main/jungle/camp-visual-detector.js"
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
    providerVersion: 3_001,
  }
}

describe("adaptive camp visual accuracy", () => {
  it("learns an early alive baseline across irregular healthy capture intervals", () => {
    const detector = new AdaptiveCampBaselineDetector()
    const patch = campPatch(true)

    expect(detector.classify(patch, CAMP, 91_100).state).toBe("unknown")
    expect(detector.classify(patch, CAMP, 94_600).state).toBe("unknown")
    expect(detector.classify(patch, CAMP, 98_100)).toMatchObject({
      state: "alive",
      method: "adaptive_alive_baseline",
    })
  })

  it("never restarts baseline learning after the early appearance changes", () => {
    const detector = new AdaptiveCampBaselineDetector()

    expect(detector.classify(campPatch(true), CAMP, 91_100).state).toBe("unknown")
    expect(detector.classify(campPatch(false), CAMP, 94_600).state).toBe("unknown")
    expect(detector.classify(campPatch(false), CAMP, 97_200).state).toBe("unknown")
    expect(detector.classify(campPatch(false), CAMP, 99_800).state).toBe("unknown")
    expect(detector.classify(campPatch(false), CAMP, 104_000).state).toBe("unknown")
  })

  it("preserves first localized absence while state confirmation remains multi-frame", () => {
    const detector = new AdaptiveCampBaselineDetector()
    const machine = new CampStateMachine()
    const alive = campPatch(true)
    const absent = campPatch(false)

    detector.classify(alive, CAMP, 91_100)
    detector.classify(alive, CAMP, 94_600)
    expect(detector.classify(alive, CAMP, 98_100).state).toBe("alive")
    machine.observe(observation("alive", 98_100, 1))
    machine.observe(observation("alive", 98_600, 2))
    machine.observe(observation("alive", 99_100, 3))

    const first = detector.classify(absent, CAMP, 104_000)
    const second = detector.classify(absent, CAMP, 104_500)
    const third = detector.classify(absent, CAMP, 105_000)
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
    detector.classify(alive, CAMP, 91_100)
    detector.classify(alive, CAMP, 94_600)
    detector.classify(alive, CAMP, 98_100)
    expect(detector.classify(broadOcclusion(), CAMP, 104_000).state).toBe("unknown")
    expect(detector.classify(broadOcclusion(), CAMP, 107_500).state).toBe("unknown")
    expect(detector.classify(broadOcclusion(), CAMP, 111_000).state).toBe("unknown")
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
