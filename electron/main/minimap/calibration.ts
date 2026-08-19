import type {
  MinimapCalibration,
  MinimapPlacement,
  NormalizedPoint,
  PixelRect,
  RgbaFrame,
} from "../../../src/shared/minimap/contracts.js"
import { clamp, normalizedPoint } from "../../../src/shared/minimap/contracts.js"
import { assertFrame, sampleStatistics } from "./image-ops.js"

/**
 * Version 2 invalidates the original texture-only calibration. That locator
 * could accept an arbitrary lower HUD/gameplay crop and did not bind saved
 * results to the configured minimap side or scale.
 */
export const MINIMAP_CALIBRATION_VERSION = 2

export interface MinimapCalibrationHints {
  /** FlipMiniMap=1 is left; FlipMiniMap=0 is right. */
  placement?: MinimapPlacement
  /** League's MinimapScale value, normally between 0.5 and 2. */
  minimapScale?: number
  displayScaleFactor?: number
  /** Advanced/manual override, expressed relative to the shorter frame side. */
  expectedMinimapFraction?: number
}

export interface MinimapVisualEvidence {
  score: number
  valid: boolean
  texturedQuadrants: number
  darkRatio: number
  coloredRatio: number
  markerColorRatio: number
  axisBalance: number
  edgeDensity: number
  variance: number
}

function finitePositive(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) && value > 0
}

function rectContains(outer: PixelRect, inner: PixelRect) {
  const tolerance = 0.01
  return inner.x + tolerance >= outer.x && inner.y + tolerance >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
}

/**
 * Returns the expected outer minimap/HUD fraction. The relationship is based
 * on League's current UI geometry and intentionally remains a broad prior,
 * not a hard-coded pixel size. At MinimapScale=1.5 it predicts 28.5%, matching
 * the supplied 3840x2160 frame (roughly a 600-620 px outer region).
 */
export function expectedMinimapFraction(minimapScale = 1) {
  const scale = clamp(minimapScale, 0.5, 2)
  return clamp(0.21 + scale * 0.05, 0.2, 0.32)
}

/**
 * Stable, human-readable context key. Append this to the capture source
 * fingerprint when looking up persisted calibrations so changes to side,
 * scale, DPI, resolution, or locator version cannot reuse stale geometry.
 */
export function createCalibrationContextSignature(input: {
  sourceWidth: number
  sourceHeight: number
  hints?: MinimapCalibrationHints
}) {
  const hints = input.hints ?? {}
  const number = (value: number | undefined) => finitePositive(value)
    ? value!.toFixed(3)
    : "auto"
  return [
    `recall-minimap-v${MINIMAP_CALIBRATION_VERSION}`,
    `${Math.round(input.sourceWidth)}x${Math.round(input.sourceHeight)}`,
    hints.placement ?? "auto",
    `scale-${number(hints.minimapScale)}`,
    `dpi-${number(hints.displayScaleFactor)}`,
    `fraction-${number(hints.expectedMinimapFraction)}`,
  ].join(":")
}

export function calibrationMatchesHints(
  calibration: MinimapCalibration,
  hints: MinimapCalibrationHints = {},
) {
  if (!validateCalibration(calibration)) return false
  if (hints.placement && calibration.placement !== hints.placement) return false
  if (finitePositive(hints.displayScaleFactor) &&
      Math.abs(calibration.displayScaleFactor - hints.displayScaleFactor!) > 0.02) {
    return false
  }
  if (finitePositive(hints.minimapScale) || finitePositive(hints.expectedMinimapFraction)) {
    const shortest = Math.min(calibration.sourceWidth, calibration.sourceHeight)
    const actual = Math.max(calibration.minimapRect.width, calibration.minimapRect.height) /
      shortest
    const expected = hints.expectedMinimapFraction ??
      expectedMinimapFraction(hints.minimapScale)
    // UI borders and window scaling vary slightly by League patch. This is
    // narrow enough to reject the old 16% crop for a 1.5-scale (28.5%) map.
    if (Math.abs(actual - expected) > 0.055) return false
  }
  return true
}

export function validateCalibration(
  calibration: MinimapCalibration,
  sourceWidth = calibration.sourceWidth,
  sourceHeight = calibration.sourceHeight,
) {
  const rectangles = [calibration.minimapRect, calibration.innerMapRect]
  if (sourceWidth <= 0 || sourceHeight <= 0 ||
      calibration.sourceWidth !== sourceWidth || calibration.sourceHeight !== sourceHeight ||
      calibration.calibrationVersion !== MINIMAP_CALIBRATION_VERSION) {
    return false
  }
  if (!Number.isFinite(calibration.confidence) || calibration.confidence < 0 ||
      calibration.confidence > 1 || !finitePositive(calibration.displayScaleFactor)) return false
  if (!rectangles.every((rect) =>
    Number.isFinite(rect.x) && Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) && Number.isFinite(rect.height) &&
    rect.width > 8 && rect.height > 8 &&
    rect.x >= 0 && rect.y >= 0 &&
    rect.x + rect.width <= sourceWidth &&
    rect.y + rect.height <= sourceHeight)) return false

  const outer = calibration.minimapRect
  const shortest = Math.min(sourceWidth, sourceHeight)
  const sizeFraction = Math.max(outer.width, outer.height) / shortest
  const aspect = outer.width / outer.height
  if (sizeFraction < 0.14 || sizeFraction > 0.4 || aspect < 0.82 || aspect > 1.18) return false
  if (!rectContains(outer, calibration.innerMapRect)) return false
  const innerFraction = Math.min(
    calibration.innerMapRect.width / outer.width,
    calibration.innerMapRect.height / outer.height,
  )
  if (innerFraction < 0.72 || innerFraction > 0.98) return false

  // A League minimap is attached to one lower corner. These checks prevent a
  // geometrically valid crop on scoreboard/chat or the center HUD from being
  // accepted as a calibration.
  if (outer.y + outer.height < sourceHeight * 0.92) return false
  if (calibration.placement === "right" && outer.x + outer.width < sourceWidth * 0.94) {
    return false
  }
  if (calibration.placement === "left" && outer.x > sourceWidth * 0.06) return false
  return true
}

export function createCalibration(input: {
  sourceWidth: number
  sourceHeight: number
  minimapRect: PixelRect
  placement: MinimapPlacement
  displayScaleFactor?: number
  confidence?: number
  borderInsetFraction?: number
  borderInsets?: Partial<Record<"left" | "top" | "right" | "bottom", number>>
}): MinimapCalibration {
  const fallbackInset = clamp(input.borderInsetFraction ?? 0.042, 0, 0.1)
  const left = clamp(input.borderInsets?.left ?? fallbackInset, 0, 0.14)
  const top = clamp(input.borderInsets?.top ?? fallbackInset, 0, 0.14)
  const right = clamp(input.borderInsets?.right ?? fallbackInset, 0, 0.14)
  const bottom = clamp(input.borderInsets?.bottom ?? fallbackInset, 0, 0.14)
  const innerMapRect = {
    x: input.minimapRect.x + input.minimapRect.width * left,
    y: input.minimapRect.y + input.minimapRect.height * top,
    width: input.minimapRect.width * (1 - left - right),
    height: input.minimapRect.height * (1 - top - bottom),
  }
  const calibration: MinimapCalibration = {
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    minimapRect: { ...input.minimapRect },
    innerMapRect,
    placement: input.placement,
    displayScaleFactor: input.displayScaleFactor ?? 1,
    confidence: clamp(input.confidence ?? 1),
    calibrationVersion: MINIMAP_CALIBRATION_VERSION,
  }
  if (!validateCalibration(calibration)) throw new Error("invalid_minimap_calibration")
  return calibration
}

export function sourceToNormalized(
  x: number,
  y: number,
  calibration: MinimapCalibration,
): NormalizedPoint {
  return normalizedPoint(
    (x - calibration.innerMapRect.x) / calibration.innerMapRect.width,
    (y - calibration.innerMapRect.y) / calibration.innerMapRect.height,
  )
}

export function normalizedToSource(
  point: NormalizedPoint,
  calibration: MinimapCalibration,
): { x: number; y: number } {
  return {
    x: calibration.innerMapRect.x + clamp(point.x) * calibration.innerMapRect.width,
    y: calibration.innerMapRect.y + clamp(point.y) * calibration.innerMapRect.height,
  }
}

export function minimapLocalToNormalized(
  x: number,
  y: number,
  width: number,
  height: number,
): NormalizedPoint {
  return normalizedPoint(x / Math.max(1, width - 1), y / Math.max(1, height - 1))
}

function sampleRect(frame: RgbaFrame, rect: PixelRect, size = 80): RgbaFrame {
  const output = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    const sourceY = Math.max(0, Math.min(
      frame.height - 1,
      Math.round(rect.y + ((y + 0.5) / size) * rect.height - 0.5),
    ))
    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.max(0, Math.min(
        frame.width - 1,
        Math.round(rect.x + ((x + 0.5) / size) * rect.width - 0.5),
      ))
      const source = (sourceY * frame.width + sourceX) * 4
      const target = (y * size + x) * 4
      output[target] = frame.data[source]
      output[target + 1] = frame.data[source + 1]
      output[target + 2] = frame.data[source + 2]
      output[target + 3] = frame.data[source + 3]
    }
  }
  return {
    width: size,
    height: size,
    data: output,
    capturedMonotonicMs: frame.capturedMonotonicMs,
    frameSequence: frame.frameSequence,
  }
}

function quadrantTexture(sample: RgbaFrame, startX: number, startY: number) {
  const halfWidth = Math.floor(sample.width / 2)
  const halfHeight = Math.floor(sample.height / 2)
  const width = startX === 0 ? halfWidth : sample.width - halfWidth
  const height = startY === 0 ? halfHeight : sample.height - halfHeight
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const from = ((startY + y) * sample.width + startX) * 4
    data.set(sample.data.subarray(from, from + width * 4), y * width * 4)
  }
  return sampleStatistics({ ...sample, width, height, data })
}

/**
 * Tests for minimap-specific, two-dimensional evidence. Generic chat and HUD
 * panels tend to have horizontal text/bars concentrated in a small number of
 * rows; a map has terrain contrast and edges distributed across all quadrants,
 * plus a modest amount of colored terrain/team-marker evidence.
 */
export function evaluateMinimapVisual(sample: RgbaFrame): MinimapVisualEvidence {
  assertFrame(sample)
  const stats = sampleStatistics(sample)
  const quadrants = [
    quadrantTexture(sample, 0, 0),
    quadrantTexture(sample, Math.floor(sample.width / 2), 0),
    quadrantTexture(sample, 0, Math.floor(sample.height / 2)),
    quadrantTexture(sample, Math.floor(sample.width / 2), Math.floor(sample.height / 2)),
  ]
  const texturedQuadrants = quadrants.filter((entry) =>
    entry.variance >= 180 && entry.edgeDensity >= 0.035).length

  let darkPixels = 0
  let coloredPixels = 0
  let markerPixels = 0
  let horizontalEdges = 0
  let verticalEdges = 0
  let interiorPixels = 0
  for (let y = 2; y < sample.height - 2; y += 1) {
    for (let x = 2; x < sample.width - 2; x += 1) {
      const index = (y * sample.width + x) * 4
      const red = sample.data[index]
      const green = sample.data[index + 1]
      const blue = sample.data[index + 2]
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
      if (luminance < 58) darkPixels += 1
      if (Math.max(red, green, blue) - Math.min(red, green, blue) >= 22 &&
          luminance >= 22) coloredPixels += 1
      const redMarker = red >= 105 && red > green * 1.32 && red > blue * 1.22
      const blueMarker = blue >= 95 && blue > red * 1.2 && blue > green * 1.08
      if (redMarker || blueMarker) markerPixels += 1

      const left = index - 4
      const above = index - sample.width * 4
      const dx = Math.abs(red - sample.data[left]) +
        Math.abs(green - sample.data[left + 1]) + Math.abs(blue - sample.data[left + 2])
      const dy = Math.abs(red - sample.data[above]) +
        Math.abs(green - sample.data[above + 1]) + Math.abs(blue - sample.data[above + 2])
      if (dx >= 54) horizontalEdges += 1
      if (dy >= 54) verticalEdges += 1
      interiorPixels += 1
    }
  }
  const darkRatio = darkPixels / Math.max(1, interiorPixels)
  const coloredRatio = coloredPixels / Math.max(1, interiorPixels)
  const markerColorRatio = markerPixels / Math.max(1, interiorPixels)
  const horizontalDensity = horizontalEdges / Math.max(1, interiorPixels)
  const verticalDensity = verticalEdges / Math.max(1, interiorPixels)
  const axisBalance = Math.min(horizontalDensity, verticalDensity) /
    Math.max(0.001, Math.max(horizontalDensity, verticalDensity))

  const textureScore = clamp(stats.variance / 1_600)
  const edgeScore = clamp(stats.edgeDensity / 0.18)
  const distributionScore = clamp((texturedQuadrants - 1) / 3)
  const colorScore = clamp(coloredRatio / 0.22)
  const markerScore = clamp(markerColorRatio / 0.018)
  const axisScore = clamp((axisBalance - 0.18) / 0.62)
  const tonalScore = darkRatio >= 0.1 && darkRatio <= 0.9 ? 1 : 0
  const score = clamp(
    textureScore * 0.2 +
    edgeScore * 0.16 +
    distributionScore * 0.24 +
    colorScore * 0.16 +
    markerScore * 0.08 +
    axisScore * 0.1 +
    tonalScore * 0.06,
  )
  const valid = score >= 0.53 && texturedQuadrants >= 3 &&
    stats.variance >= 240 && stats.edgeDensity >= 0.045 &&
    coloredRatio >= 0.025 && axisBalance >= 0.22 &&
    darkRatio >= 0.08 && darkRatio <= 0.94
  return {
    score,
    valid,
    texturedQuadrants,
    darkRatio,
    coloredRatio,
    markerColorRatio,
    axisBalance,
    edgeDensity: stats.edgeDensity,
    variance: stats.variance,
  }
}

interface Candidate {
  rect: PixelRect
  placement: MinimapPlacement
  score: number
  visual: MinimapVisualEvidence
  sizeDifference: number
}

function candidateFractions(hints: MinimapCalibrationHints) {
  const expected = clamp(
    hints.expectedMinimapFraction ?? expectedMinimapFraction(hints.minimapScale),
    0.18,
    0.36,
  )
  const fractions = new Set<number>()
  for (let offset = -0.06; offset <= 0.061; offset += 0.01) {
    fractions.add(Number(clamp(expected + offset, 0.18, 0.36).toFixed(3)))
  }
  // Keep automatic calibration useful if game.cfg is temporarily unavailable.
  for (const fraction of [0.2, 0.22, 0.24, 0.26, 0.28, 0.3, 0.32, 0.34]) {
    fractions.add(fraction)
  }
  return { expected, fractions: [...fractions].sort((left, right) => left - right) }
}

/**
 * Locates a lower-corner League minimap. It uses settings as placement/size
 * evidence and refuses visually ambiguous regions instead of guessing.
 */
export class MinimapLocator {
  constructor(private readonly defaultHints: MinimapCalibrationHints = {}) {}

  locate(
    frame: RgbaFrame,
    inputHints: MinimapCalibrationHints = {},
  ): MinimapCalibration | undefined {
    assertFrame(frame)
    const hints = { ...this.defaultHints, ...inputHints }
    const shortest = Math.min(frame.width, frame.height)
    const candidates: Candidate[] = []
    const { expected, fractions } = candidateFractions(hints)
    const placements: MinimapPlacement[] = hints.placement
      ? [hints.placement]
      : ["left", "right"]
    for (const fraction of fractions) {
      const size = Math.round(shortest * fraction)
      if (size < 96) continue
      for (const placement of placements) {
        for (const marginFraction of [0, 0.004, 0.008, 0.012, 0.016]) {
          const margin = Math.round(shortest * marginFraction)
          const rect: PixelRect = {
            x: placement === "left" ? margin : frame.width - size - margin,
            y: frame.height - size - margin,
            width: size,
            height: size,
          }
          const visual = evaluateMinimapVisual(sampleRect(frame, rect))
          if (!visual.valid) continue
          const sizeDifference = Math.abs(fraction - expected)
          const sizePrior = clamp(1 - sizeDifference / 0.075)
          const edgePrior = clamp(1 - marginFraction / 0.02)
          const score = visual.score * 0.75 + sizePrior * 0.2 + edgePrior * 0.05
          candidates.push({ rect, placement, score, visual, sizeDifference })
        }
      }
    }
    candidates.sort((left, right) =>
      right.score - left.score || left.sizeDifference - right.sizeDifference)
    const best = candidates[0]
    if (!best || best.score < 0.58) return undefined

    // With no configured side, require the winning corner to contain materially
    // stronger map evidence. With a side hint, adjacent nested size candidates
    // are expected and should not be treated as independent ambiguity.
    if (!hints.placement) {
      const otherCorner = candidates.find((entry) => entry.placement !== best.placement)
      if (otherCorner && best.score - otherCorner.score < 0.045) return undefined
    }
    const confidence = clamp(
      0.36 + best.visual.score * 0.42 +
      clamp(1 - best.sizeDifference / 0.08) * 0.18 +
      (hints.placement ? 0.04 : 0),
    )
    if (confidence < 0.65) return undefined
    const calibration = createCalibration({
      sourceWidth: frame.width,
      sourceHeight: frame.height,
      minimapRect: best.rect,
      placement: best.placement,
      displayScaleFactor: hints.displayScaleFactor,
      confidence,
    })
    return calibrationMatchesHints(calibration, hints) ? calibration : undefined
  }
}
