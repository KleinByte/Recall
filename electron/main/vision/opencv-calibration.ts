import type { MinimapCalibration, MinimapPlacement, PixelRect, RgbaFrame } from "../../../src/shared/minimap/contracts.js"
import { clamp } from "../../../src/shared/minimap/contracts.js"
import {
  calibrationMatchesHints,
  createCalibration,
  expectedMinimapFraction,
  type MinimapCalibrationHints,
  type MinimapLocatorDiagnostics,
  type MinimapVisualEvidence,
} from "../minimap/calibration.js"
import { assertFrame } from "../minimap/image-ops.js"
import {
  cropAndResize,
  extractChannel,
  frameToMat,
  matToFrame,
  safeDelete,
  type OpenCv,
} from "./opencv-runtime.js"

function countMask(cv: OpenCv, mask: any) {
  return Number(cv.countNonZero(mask))
}

function meanVariance(cv: OpenCv, gray: any) {
  const mean = new cv.Mat()
  const stddev = new cv.Mat()
  try {
    cv.meanStdDev(gray, mean, stddev)
    const sigma = Number(stddev.doubleAt(0, 0))
    return { mean: Number(mean.doubleAt(0, 0)), variance: sigma * sigma }
  } finally { safeDelete(mean, stddev) }
}

function thresholdCount(cv: OpenCv, source: any, threshold: number, inverse = false) {
  const mask = new cv.Mat()
  try {
    cv.threshold(source, mask, threshold, 255, inverse ? cv.THRESH_BINARY_INV : cv.THRESH_BINARY)
    return countMask(cv, mask)
  } finally { mask.delete() }
}

function inRangeCount(cv: OpenCv, source: any, low: number[], high: number[]) {
  const lower = new cv.Mat(source.rows, source.cols, source.type(), new cv.Scalar(...low))
  const upper = new cv.Mat(source.rows, source.cols, source.type(), new cv.Scalar(...high))
  const mask = new cv.Mat()
  try {
    cv.inRange(source, lower, upper, mask)
    return countMask(cv, mask)
  } finally { safeDelete(lower, upper, mask) }
}

function quadrantTexture(cv: OpenCv, gray: any, x: number, y: number, width: number, height: number) {
  const roi = gray.roi(new cv.Rect(x, y, width, height))
  const dx = new cv.Mat()
  const dy = new cv.Mat()
  const absX = new cv.Mat()
  const absY = new cv.Mat()
  const edge = new cv.Mat()
  try {
    const stats = meanVariance(cv, roi)
    cv.Sobel(roi, dx, cv.CV_16S, 1, 0, 3)
    cv.Sobel(roi, dy, cv.CV_16S, 0, 1, 3)
    cv.convertScaleAbs(dx, absX)
    cv.convertScaleAbs(dy, absY)
    cv.addWeighted(absX, 0.5, absY, 0.5, 0, edge)
    const edgeDensity = thresholdCount(cv, edge, 24) / Math.max(1, roi.rows * roi.cols)
    return { variance: stats.variance, edgeDensity }
  } finally { safeDelete(roi, dx, dy, absX, absY, edge) }
}

export function evaluateMinimapVisualCv(cv: OpenCv, input: RgbaFrame | any): MinimapVisualEvidence {
  const owns = !(input && typeof input === "object" && "rows" in input && "cols" in input)
  const rgba = owns ? frameToMat(cv, input as RgbaFrame) : input
  const rgb = new cv.Mat()
  const gray = new cv.Mat()
  const hsv = new cv.Mat()
  const saturation = new cv.Mat()
  const dx = new cv.Mat()
  const dy = new cv.Mat()
  const absX = new cv.Mat()
  const absY = new cv.Mat()
  const combined = new cv.Mat()
  const saturatedMask = new cv.Mat()
  const brightMask = new cv.Mat()
  const coloredMask = new cv.Mat()
  try {
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB)
    cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY)
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV)
    extractChannel(cv, hsv, saturation, 1)
    const total = Math.max(1, gray.rows * gray.cols)
    const stats = meanVariance(cv, gray)
    cv.Sobel(gray, dx, cv.CV_16S, 1, 0, 3)
    cv.Sobel(gray, dy, cv.CV_16S, 0, 1, 3)
    cv.convertScaleAbs(dx, absX)
    cv.convertScaleAbs(dy, absY)
    cv.addWeighted(absX, 0.5, absY, 0.5, 0, combined)
    const edgeDensity = thresholdCount(cv, combined, 24) / total
    const horizontalDensity = thresholdCount(cv, absX, 54) / total
    const verticalDensity = thresholdCount(cv, absY, 54) / total
    const axisBalance = Math.min(horizontalDensity, verticalDensity) /
      Math.max(0.001, Math.max(horizontalDensity, verticalDensity))
    const darkRatio = thresholdCount(cv, gray, 58, true) / total
    cv.threshold(saturation, saturatedMask, 28, 255, cv.THRESH_BINARY)
    cv.threshold(gray, brightMask, 22, 255, cv.THRESH_BINARY)
    cv.bitwise_and(saturatedMask, brightMask, coloredMask)
    const coloredRatio = cv.countNonZero(coloredMask) / total
    // OpenCV HSV hue is 0..179. Count strongly red and blue/cyan marker-like pixels.
    const redA = inRangeCount(cv, hsv, [0, 110, 90, 0], [15, 255, 255, 255])
    const redB = inRangeCount(cv, hsv, [165, 110, 90, 0], [179, 255, 255, 255])
    const blue = inRangeCount(cv, hsv, [80, 90, 80, 0], [120, 255, 255, 255])
    const markerColorRatio = Math.min(1, (redA + redB + blue) / total)

    const halfW = Math.floor(gray.cols / 2)
    const halfH = Math.floor(gray.rows / 2)
    const quadrants = [
      quadrantTexture(cv, gray, 0, 0, halfW, halfH),
      quadrantTexture(cv, gray, halfW, 0, gray.cols - halfW, halfH),
      quadrantTexture(cv, gray, 0, halfH, halfW, gray.rows - halfH),
      quadrantTexture(cv, gray, halfW, halfH, gray.cols - halfW, gray.rows - halfH),
    ]
    const texturedQuadrants = quadrants.filter((entry) =>
      entry.variance >= 120 && entry.edgeDensity >= 0.025).length
    const textureScore = clamp(stats.variance / 1_600)
    const edgeScore = clamp(edgeDensity / 0.18)
    const distributionScore = clamp((texturedQuadrants - 1) / 3)
    const colorScore = clamp(coloredRatio / 0.22)
    const markerScore = clamp(markerColorRatio / 0.018)
    const axisScore = clamp((axisBalance - 0.18) / 0.62)
    const tonalScore = darkRatio >= 0.06 && darkRatio <= 0.94 ? 1 : 0
    const score = clamp(textureScore * 0.2 + edgeScore * 0.16 + distributionScore * 0.24 +
      colorScore * 0.16 + markerScore * 0.08 + axisScore * 0.1 + tonalScore * 0.06)
    return {
      score,
      valid: score >= 0.46 && texturedQuadrants >= 2 && stats.variance >= 145 &&
        edgeDensity >= 0.028 && axisBalance >= 0.16 && markerColorRatio >= 0.0003 &&
        darkRatio >= 0.04 && darkRatio <= 0.97,
      texturedQuadrants,
      darkRatio,
      coloredRatio,
      markerColorRatio,
      axisBalance,
      edgeDensity,
      variance: stats.variance,
    }
  } finally {
    safeDelete(
      rgb, gray, hsv, saturation, dx, dy, absX, absY, combined,
      saturatedMask, brightMask, coloredMask,
    )
    if (owns) safeDelete(rgba)
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
  const expected = clamp(hints.expectedMinimapFraction ?? expectedMinimapFraction(hints.minimapScale), 0.11, 0.4)
  const fractions = new Set<number>()
  const hasScaleHint = hints.expectedMinimapFraction !== undefined || hints.minimapScale !== undefined
  const searchRadius = hasScaleHint ? 0.06 : 0.12
  for (let offset = -searchRadius; offset <= searchRadius + 0.001; offset += 0.01) {
    fractions.add(Number(clamp(expected + offset, 0.11, 0.4).toFixed(3)))
  }
  if (!hasScaleHint) {
    for (const fraction of [0.11, 0.13, 0.15, 0.17, 0.19, 0.21, 0.23, 0.25,
      0.27, 0.29, 0.31, 0.33, 0.35, 0.37, 0.39]) fractions.add(fraction)
  }
  return { expected, fractions: [...fractions].sort((a, b) => a - b) }
}

export class OpenCvMinimapLocator {
  private diagnostics: MinimapLocatorDiagnostics = { evaluatedCandidates: 0, visuallyValidCandidates: 0 }
  constructor(private readonly cv: OpenCv, private readonly canonicalSize = 320) {}
  getDiagnostics(): MinimapLocatorDiagnostics { return structuredClone(this.diagnostics) }

  locate(frame: RgbaFrame, inputHints: MinimapCalibrationHints = {}): {
    calibration?: MinimapCalibration
    minimap?: RgbaFrame
    visual?: MinimapVisualEvidence
  } {
    assertFrame(frame)
    const hints = { ...inputHints }
    const source = frameToMat(this.cv, frame)
    try {
      const shortest = Math.min(frame.width, frame.height)
      const { expected, fractions } = candidateFractions(hints)
      const placements: MinimapPlacement[] = hints.placement ? [hints.placement] : ["left", "right"]
      const candidates: Candidate[] = []
      let evaluatedCandidates = 0
      for (const fraction of fractions) {
        const size = Math.round(shortest * fraction)
        if (size < 96) continue
        for (const placement of placements) {
          for (const marginFraction of [0, 0.004, 0.008, 0.012, 0.016, 0.02, 0.025]) {
            evaluatedCandidates += 1
            const margin = Math.round(shortest * marginFraction)
            const rect = {
              x: placement === "left" ? margin : frame.width - size - margin,
              y: frame.height - size - margin,
              width: size,
              height: size,
            }
            const sample = cropAndResize(this.cv, source, rect, 80, 80)
            try {
              const visual = evaluateMinimapVisualCv(this.cv, sample)
              if (!visual.valid) continue
              const sizeDifference = Math.abs(fraction - expected)
              const score = visual.score * 0.7 + clamp(1 - sizeDifference / 0.15) * 0.25 +
                clamp(1 - marginFraction / 0.03) * 0.05
              candidates.push({ rect, placement, score, visual, sizeDifference })
            } finally { sample.delete() }
          }
        }
      }
      candidates.sort((a, b) => b.score - a.score || a.sizeDifference - b.sizeDifference)
      const best = candidates[0]
      this.diagnostics = {
        evaluatedCandidates,
        visuallyValidCandidates: candidates.length,
        expectedFraction: expected,
        bestScore: best?.score,
        bestPlacement: best?.placement,
        bestFraction: best ? best.rect.width / shortest : undefined,
        bestVisual: best?.visual,
      }
      if (!best) { this.diagnostics.failureReason = "no_visual_candidate"; return {} }
      if (best.score < 0.49) { this.diagnostics.failureReason = "low_score"; return {} }
      if (!hints.placement) {
        const other = candidates.find((entry) => entry.placement !== best.placement)
        if (other && best.score - other.score < 0.035) {
          this.diagnostics.failureReason = "ambiguous_corner"
          return {}
        }
      }
      const confidence = clamp(0.36 + best.visual.score * 0.42 +
        clamp(1 - best.sizeDifference / 0.08) * 0.18 + (hints.placement ? 0.04 : 0))
      if (confidence < 0.57) { this.diagnostics.failureReason = "low_confidence"; return {} }
      const calibration = createCalibration({
        sourceWidth: frame.width,
        sourceHeight: frame.height,
        minimapRect: best.rect,
        placement: best.placement,
        displayScaleFactor: hints.displayScaleFactor,
        confidence,
      })
      if (!calibrationMatchesHints(calibration, hints)) {
        this.diagnostics.failureReason = "hint_mismatch"
        return {}
      }
      const minimapMat = cropAndResize(this.cv, source, calibration.innerMapRect, this.canonicalSize, this.canonicalSize)
      try {
        this.diagnostics.failureReason = undefined
        const minimap = matToFrame(minimapMat, frame.capturedMonotonicMs, frame.frameSequence)
        return { calibration, minimap, visual: evaluateMinimapVisualCv(this.cv, minimapMat) }
      } finally { minimapMat.delete() }
    } finally { source.delete() }
  }
}
