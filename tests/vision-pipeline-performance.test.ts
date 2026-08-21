import { describe, expect, it } from "vitest"
import { OpenCvChampionDetector } from "../electron/main/vision/opencv-champion-detector.js"
import { VisionPipeline } from "../electron/main/vision/vision-pipeline.js"
import { loadOpenCv } from "../electron/main/vision/opencv-runtime.js"
import type { RgbaFrame } from "../src/shared/minimap/contracts.js"

function solidFrame(size: number, frameSequence = 1): RgbaFrame {
  const data = new Uint8Array(size * size * 4)
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set([8, 10, 12, 255], offset)
  }
  return {
    width: size,
    height: size,
    data,
    capturedMonotonicMs: frameSequence * 250,
    frameSequence,
  }
}

describe("vision pipeline performance contracts", () => {
  it("uploads a canonical frame to OpenCV only once for all detectors", async () => {
    const cv = await loadOpenCv()
    const original = cv.matFromArray
    let uploads = 0
    cv.matFromArray = (...args: unknown[]) => {
      uploads += 1
      return Reflect.apply(original, cv, args)
    }
    const pipeline = new VisionPipeline(cv, 64)
    pipeline.setRoster("session", 7, [])
    pipeline.setCampTemplates([])
    try {
      const result = pipeline.processFrame({
        sessionId: "session",
        gameId: 7,
        gameTimeMs: 200_000,
        frame: solidFrame(64),
        includeCamps: true,
        includeVisualValidation: true,
      })
      expect(result.visual).toBeDefined()
      expect(uploads).toBe(1)
    } finally {
      pipeline.close()
      cv.matFromArray = original
    }
  })

  it("does no visual-validation work between validation intervals", async () => {
    const pipeline = new VisionPipeline(await loadOpenCv(), 64)
    pipeline.setRoster("session", 7, [])
    try {
      const result = pipeline.processFrame({
        sessionId: "session",
        gameId: 7,
        gameTimeMs: 1_000,
        frame: solidFrame(64),
        includeCamps: false,
        includeVisualValidation: false,
      })
      expect(result.visual).toBeUndefined()
      expect(result.metrics.visualValidationMs).toBe(0)
    } finally {
      pipeline.close()
    }
  })

  it("runs the Hough fallback on alternating detector frames", async () => {
    const cv = await loadOpenCv()
    const original = cv.HoughCircles
    let houghCalls = 0
    cv.HoughCircles = () => {
      houghCalls += 1
    }
    const detector = new OpenCvChampionDetector(cv)
    try {
      for (let sequence = 1; sequence <= 3; sequence += 1) {
        detector.detect({
          frame: solidFrame(64, sequence),
          gameId: 7,
          gameTimeMs: sequence * 250,
        })
      }
      // Both teams are scanned on detector calls one and three only.
      expect(houghCalls).toBe(4)
    } finally {
      detector.close()
      cv.HoughCircles = original
    }
  })
})
