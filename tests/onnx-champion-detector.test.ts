import { describe, expect, it } from "vitest"
import {
  championModelTensor,
  decodeYoloOutput,
  OnnxChampionDetector,
} from "../electron/main/vision/onnx-champion-detector.js"
import type { RgbaFrame } from "../src/shared/minimap/contracts.js"

function twoByTwoFrame(): RgbaFrame {
  return {
    width: 2,
    height: 2,
    data: new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 255, 255,
    ]),
    capturedMonotonicMs: 0,
    frameSequence: 1,
  }
}

describe("ONNX champion detector", () => {
  it("creates a normalized RGB tensor in channel-first order", () => {
    expect([...championModelTensor(twoByTwoFrame(), 2)]).toEqual([
      1, 0, 0, 1,
      0, 1, 0, 1,
      0, 0, 1, 1,
    ])
  })

  it("decodes only active-roster classes and suppresses duplicate boxes", () => {
    const anchors = 2
    const values = new Float32Array((4 + 2) * anchors)
    // Two nearly identical boxes.
    values.set([128, 130], 0 * anchors)
    values.set([96, 97], 1 * anchors)
    values.set([24, 24], 2 * anchors)
    values.set([24, 24], 3 * anchors)
    // Garen, then Zac class confidence.
    values.set([0.93, 0.82], 4 * anchors)
    values.set([0.08, 0.12], 5 * anchors)

    const decoded = decodeYoloOutput({
      data: values,
      dimensions: [1, 6, anchors],
      labels: ["Garen", "Zac"],
      activeRoster: new Map([["garen", "Garen"]]),
      inputSize: 256,
    })

    expect(decoded).toEqual([expect.objectContaining({
      championKey: "garen",
      championName: "Garen",
      confidence: expect.closeTo(0.93),
      centerX: expect.closeTo(0.5),
      centerY: expect.closeTo(0.375),
    })])
  })

  it("normalizes Data Dragon aliases while filtering to the roster", () => {
    const values = new Float32Array(5)
    values.set([128, 128, 20, 20, 0.9])
    const decoded = decodeYoloOutput({
      data: values,
      dimensions: [1, 5, 1],
      labels: ["MonkeyKing"],
      activeRoster: new Map([["monkeyking", "Wukong"]]),
      inputSize: 256,
    })
    expect(decoded[0]).toMatchObject({ championKey: "monkeyking", championName: "Wukong" })
  })

  it("retains low-confidence roster proposals for portrait corroboration", () => {
    const values = new Float32Array([128, 128, 20, 20, 0.13])
    const input = {
      data: values,
      dimensions: [1, 5, 1],
      labels: ["Garen"],
      activeRoster: new Map([["garen", "Garen"]]),
      inputSize: 256,
    }
    expect(decodeYoloOutput(input)).toEqual([expect.objectContaining({
      championName: "Garen",
      confidence: expect.closeTo(0.13),
    })])

    values[4] = 0.09
    expect(decodeYoloOutput(input)).toEqual([])
  })

  it("loads and executes the checksummed release model locally", async () => {
    const detector = await OnnxChampionDetector.load()
    detector.setTemplates([{
      participantKey: "ally:garen",
      championName: "Garen",
      team: "ally",
      isLocal: true,
      width: 1,
      height: 1,
      rgba: new Uint8Array([0, 0, 0, 255]),
    }])
    try {
      const result = await detector.detect({
        width: 32,
        height: 32,
        data: new Uint8Array(32 * 32 * 4),
        capturedMonotonicMs: 0,
        frameSequence: 1,
      })
      expect(result.detections).toEqual(expect.any(Array))
      expect(result.inferenceMs).toBeGreaterThan(0)
      expect(detector.runtimeStatus).toMatchObject({
        available: true,
        inputSize: 256,
      })
      expect(detector.runtimeStatus.classCount).toBeGreaterThanOrEqual(170)
    } finally {
      await detector.close()
    }
  }, 30_000)
})
