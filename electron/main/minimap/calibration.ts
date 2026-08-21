import type {
  MinimapCalibration,
  MinimapPlacement,
  NormalizedPoint,
  PixelRect,
} from "../../../src/shared/minimap/contracts.js"
import { clamp, normalizedPoint } from "../../../src/shared/minimap/contracts.js"

/** OpenCV-backed locator/calibration generation. Historical v3 rows remain valid history. */
export const MINIMAP_CALIBRATION_VERSION = 7

export interface MinimapCalibrationHints {
  placement?: MinimapPlacement
  minimapScale?: number
  displayScaleFactor?: number
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

export interface MinimapLocatorDiagnostics {
  evaluatedCandidates: number
  visuallyValidCandidates: number
  expectedFraction?: number
  bestScore?: number
  bestPlacement?: MinimapPlacement
  bestFraction?: number
  bestVisual?: MinimapVisualEvidence
  failureReason?: "no_visual_candidate" | "low_score" | "ambiguous_corner" |
    "low_confidence" | "hint_mismatch"
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

export function expectedMinimapFraction(minimapScale = 1) {
  const scale = clamp(minimapScale, 0.5, 3)
  return clamp(0.18 + scale * 0.07, 0.2, 0.4)
}

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
  const expectedFraction = finitePositive(hints.expectedMinimapFraction)
    ? clamp(hints.expectedMinimapFraction!, 0.11, 0.4)
    : finitePositive(hints.minimapScale)
      ? expectedMinimapFraction(hints.minimapScale)
      : undefined
  if (expectedFraction !== undefined) {
    const shortest = Math.min(calibration.sourceWidth, calibration.sourceHeight)
    const actual = Math.max(calibration.minimapRect.width, calibration.minimapRect.height) / shortest
    if (Math.abs(actual - expectedFraction) > 0.075) return false
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
      calibration.calibrationVersion !== MINIMAP_CALIBRATION_VERSION) return false
  if (!Number.isFinite(calibration.confidence) || calibration.confidence < 0 ||
      calibration.confidence > 1 || !finitePositive(calibration.displayScaleFactor)) return false
  if (!rectangles.every((rect) =>
    Number.isFinite(rect.x) && Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) && Number.isFinite(rect.height) &&
    rect.width > 8 && rect.height > 8 && rect.x >= 0 && rect.y >= 0 &&
    rect.x + rect.width <= sourceWidth && rect.y + rect.height <= sourceHeight)) return false
  const outer = calibration.minimapRect
  const shortest = Math.min(sourceWidth, sourceHeight)
  const sizeFraction = Math.max(outer.width, outer.height) / shortest
  const aspect = outer.width / outer.height
  if (sizeFraction < 0.1 || sizeFraction > 0.42 || aspect < 0.82 || aspect > 1.18) return false
  if (!rectContains(outer, calibration.innerMapRect)) return false
  const innerFraction = Math.min(
    calibration.innerMapRect.width / outer.width,
    calibration.innerMapRect.height / outer.height,
  )
  if (innerFraction < 0.72 || innerFraction > 0.98) return false
  if (outer.y + outer.height < sourceHeight * 0.92) return false
  if (calibration.placement === "right" && outer.x + outer.width < sourceWidth * 0.94) return false
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
  const calibration: MinimapCalibration = {
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    minimapRect: { ...input.minimapRect },
    innerMapRect: {
      x: input.minimapRect.x + input.minimapRect.width * left,
      y: input.minimapRect.y + input.minimapRect.height * top,
      width: input.minimapRect.width * (1 - left - right),
      height: input.minimapRect.height * (1 - top - bottom),
    },
    placement: input.placement,
    displayScaleFactor: input.displayScaleFactor ?? 1,
    confidence: clamp(input.confidence ?? 1),
    calibrationVersion: MINIMAP_CALIBRATION_VERSION,
  }
  if (!validateCalibration(calibration)) throw new Error("invalid_minimap_calibration")
  return calibration
}

export function sourceToNormalized(x: number, y: number, calibration: MinimapCalibration): NormalizedPoint {
  return normalizedPoint(
    (x - calibration.innerMapRect.x) / calibration.innerMapRect.width,
    (y - calibration.innerMapRect.y) / calibration.innerMapRect.height,
  )
}

export function normalizedToSource(point: NormalizedPoint, calibration: MinimapCalibration) {
  return {
    x: calibration.innerMapRect.x + clamp(point.x) * calibration.innerMapRect.width,
    y: calibration.innerMapRect.y + clamp(point.y) * calibration.innerMapRect.height,
  }
}

export function minimapLocalToNormalized(x: number, y: number, width: number, height: number) {
  return normalizedPoint(x / Math.max(1, width - 1), y / Math.max(1, height - 1))
}
