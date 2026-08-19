import { describe, expect, it, vi } from "vitest"
import {
  MINIMAP_CALIBRATION_VERSION,
  MinimapLocator,
  calibrationMatchesHints,
  createCalibration,
  createCalibrationContextSignature,
  evaluateMinimapVisual,
  expectedMinimapFraction,
  validateCalibration,
} from "../electron/main/minimap/calibration.js"
import {
  calibrationHintsFromLeagueSettings,
  parseLeagueGameConfig,
  readLeagueMinimapSettings,
} from "../electron/main/minimap/league-minimap-settings.js"
import type { RgbaFrame } from "../src/shared/minimap/contracts.js"

function frame(width: number, height: number, rgba: [number, number, number, number]) {
  const data = new Uint8Array(width * height * 4)
  for (let index = 0; index < width * height; index += 1) data.set(rgba, index * 4)
  return { width, height, data, capturedMonotonicMs: 1, frameSequence: 1 }
}

function pixel(target: RgbaFrame, x: number, y: number, rgba: readonly number[]) {
  target.data.set(rgba, (y * target.width + x) * 4)
}

function drawMap(target: RgbaFrame, placement: "left" | "right", size: number) {
  const originX = placement === "left" ? 0 : target.width - size
  const originY = target.height - size
  const palette = [
    [15, 23, 25, 255],
    [27, 54, 47, 255],
    [35, 69, 66, 255],
    [49, 74, 58, 255],
    [25, 42, 61, 255],
  ] as const
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (x < 11 || y < 11 || x >= size - 11 || y >= size - 11) {
        const gold = (x + y) % 9 < 3
        pixel(target, originX + x, originY + y, gold
          ? [104, 83, 42, 255]
          : [8, 19, 22, 255])
        continue
      }
      const cellX = Math.floor(x / 13)
      const cellY = Math.floor(y / 11)
      const road = Math.abs((y - 22) - x * 0.73) < 7 ||
        Math.abs((size - y - 26) - x * 0.54) < 6
      const color = road
        ? [60, 67, 59, 255] as const
        : palette[(cellX * 7 + cellY * 11 + Math.floor((x + y) / 29)) % palette.length]
      pixel(target, originX + x, originY + y, color)
    }
  }
  const markers = [
    [0.23, 0.31, [225, 40, 39, 255]],
    [0.69, 0.25, [47, 116, 235, 255]],
    [0.46, 0.72, [211, 50, 45, 255]],
    [0.78, 0.61, [42, 138, 235, 255]],
  ] as const
  for (const [fractionX, fractionY, color] of markers) {
    const centerX = Math.round(originX + fractionX * size)
    const centerY = Math.round(originY + fractionY * size)
    for (let y = -7; y <= 7; y += 1) {
      for (let x = -7; x <= 7; x += 1) {
        if (Math.hypot(x, y) <= 7) pixel(target, centerX + x, centerY + y, color)
      }
    }
  }
}

function drawHudPanel(target: RgbaFrame, placement: "left" | "right", size: number) {
  const originX = placement === "left" ? 0 : target.width - size
  const originY = target.height - size
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const separator = y % 34 <= 2
      const textDash = y % 34 >= 9 && y % 34 <= 12 && x % 51 < 31
      pixel(target, originX + x, originY + y, separator
        ? [82, 72, 41, 255]
        : textDash ? [125, 130, 125, 255] : [10, 15, 18, 255])
    }
  }
}

describe("minimap calibration", () => {
  it("uses League's 1.5 scale as a roughly 600 px 4K geometry prior", () => {
    expect(expectedMinimapFraction(1.5)).toBeCloseTo(0.285)
    expect(2_160 * expectedMinimapFraction(1.5)).toBeCloseTo(615.6)
  })

  it("finds a bottom-right map at the configured side and scale", () => {
    const screenshot = frame(1_920, 1_080, [11, 13, 16, 255])
    drawHudPanel(screenshot, "left", 308)
    drawMap(screenshot, "right", 308)
    const calibration = new MinimapLocator({
      placement: "right",
      minimapScale: 1.5,
    }).locate(screenshot)

    expect(calibration).toBeDefined()
    expect(calibration?.placement).toBe("right")
    expect(calibration?.calibrationVersion).toBe(MINIMAP_CALIBRATION_VERSION)
    expect(calibration?.minimapRect.x).toBeGreaterThan(1_580)
    expect(calibration?.minimapRect.width).toBeGreaterThanOrEqual(275)
    expect(calibration?.minimapRect.width).toBeLessThanOrEqual(330)
    expect(calibration?.innerMapRect.width).toBeGreaterThan(
      (calibration?.minimapRect.width ?? 0) * 0.9,
    )
  })

  it("rejects a generic striped HUD panel as a minimap", () => {
    const screenshot = frame(1_280, 720, [8, 10, 12, 255])
    drawHudPanel(screenshot, "right", 205)
    expect(new MinimapLocator({
      placement: "right",
      minimapScale: 1.5,
    }).locate(screenshot)).toBeUndefined()

    const panel = frame(160, 160, [10, 15, 18, 255])
    drawHudPanel(panel, "right", 160)
    expect(evaluateMinimapVisual(panel).valid).toBe(false)
  })

  it("invalidates version-one and wrong-scale persisted calibrations", () => {
    const current = createCalibration({
      sourceWidth: 3_840,
      sourceHeight: 2_160,
      minimapRect: { x: 3_224, y: 1_544, width: 616, height: 616 },
      placement: "right",
    })
    expect(validateCalibration({ ...current, calibrationVersion: 1 })).toBe(false)
    expect(calibrationMatchesHints(current, {
      placement: "right",
      minimapScale: 1.5,
    })).toBe(true)

    const staleSmall = createCalibration({
      sourceWidth: 3_840,
      sourceHeight: 2_160,
      minimapRect: { x: 3_494, y: 1_814, width: 346, height: 346 },
      placement: "right",
    })
    expect(calibrationMatchesHints(staleSmall, {
      placement: "right",
      minimapScale: 1.5,
    })).toBe(false)
  })

  it("changes the persistence signature with placement, scale, and version", () => {
    const right = createCalibrationContextSignature({
      sourceWidth: 3_840,
      sourceHeight: 2_160,
      hints: { placement: "right", minimapScale: 1.5, displayScaleFactor: 1 },
    })
    const left = createCalibrationContextSignature({
      sourceWidth: 3_840,
      sourceHeight: 2_160,
      hints: { placement: "left", minimapScale: 1.5, displayScaleFactor: 1 },
    })
    expect(right).toContain(`recall-minimap-v${MINIMAP_CALIBRATION_VERSION}`)
    expect(right).not.toBe(left)
  })
})

describe("League minimap settings", () => {
  const gameConfig = `
    [General]
    Width=3840
    Height=2160
    WindowMode=2

    [HUD]
    MinimapScale=1.5000
    FlipMiniMap=0
  `

  it("parses placement, scale, resolution, and window mode", () => {
    expect(parseLeagueGameConfig(gameConfig)).toEqual({
      placement: "right",
      minimapScale: 1.5,
      resolutionWidth: 3_840,
      resolutionHeight: 2_160,
      windowMode: 2,
    })
    expect(calibrationHintsFromLeagueSettings(parseLeagueGameConfig(gameConfig), 1.25))
      .toEqual({ placement: "right", minimapScale: 1.5, displayScaleFactor: 1.25 })
  })

  it("uses an injectable reader and ignores malformed values", async () => {
    const reader = vi.fn(async () => `[General]\nWidth=nope\n[HUD]\nMinimapScale=99\nFlipMiniMap=1`)
    await expect(readLeagueMinimapSettings("virtual/game.cfg", reader)).resolves.toEqual({
      placement: "left",
      minimapScale: undefined,
      resolutionWidth: undefined,
      resolutionHeight: undefined,
      windowMode: undefined,
    })
    expect(reader).toHaveBeenCalledWith("virtual/game.cfg")
  })
})
