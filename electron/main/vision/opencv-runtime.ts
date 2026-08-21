import { createRequire } from "node:module"
import type { PixelRect, RgbaFrame } from "../../../src/shared/minimap/contracts.js"
import { boundedRect, assertFrame } from "../minimap/image-ops.js"

export type OpenCv = Record<string, any>
const require = createRequire(import.meta.url)
let cvPromise: Promise<OpenCv> | undefined

export function loadOpenCv(): Promise<OpenCv> {
  if (!cvPromise) {
    cvPromise = (async () => {
      // The package is a UMD/CommonJS Promise-like export. Importing it through
      // ESM makes Vite/Vitest wrap it in a Module namespace whose inherited
      // `then` is invoked with the wrong receiver before any test can run.
      // Loading the CommonJS value directly also matches Electron's worker
      // runtime and keeps OpenCV's own async initialization semantics intact.
      const cvModule = require("@techstark/opencv-js") as unknown
      const imported = cvModule as unknown as OpenCv | Promise<OpenCv>
      const candidate = typeof (imported as Promise<OpenCv>)?.then === "function"
        ? await (imported as Promise<OpenCv>)
        : imported as OpenCv
      if (candidate?.Mat) return candidate
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("opencv_runtime_initialize_timeout")), 30_000)
        const previous = candidate.onRuntimeInitialized
        candidate.onRuntimeInitialized = () => {
          clearTimeout(timeout)
          try { if (typeof previous === "function") previous() } finally { resolve() }
        }
      })
      if (!candidate?.Mat) throw new Error("opencv_runtime_not_ready")
      return candidate
    })()
  }
  return cvPromise
}

export function frameToMat(cv: OpenCv, frame: RgbaFrame) {
  assertFrame(frame)
  return cv.matFromArray(frame.height, frame.width, cv.CV_8UC4, frame.data)
}

export function matToFrame(
  mat: any,
  capturedMonotonicMs: number,
  frameSequence: number,
): RgbaFrame {
  return {
    width: mat.cols,
    height: mat.rows,
    data: Uint8Array.from(mat.data),
    capturedMonotonicMs,
    frameSequence,
  }
}

export function cropAndResize(
  cv: OpenCv,
  source: any,
  requested: PixelRect,
  width: number,
  height: number,
) {
  const rect = boundedRect(requested, source.cols, source.rows)
  const roi = source.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height))
  const output = new cv.Mat()
  try {
    cv.resize(roi, output, new cv.Size(width, height), 0, 0, cv.INTER_LINEAR)
    return output
  } finally {
    roi.delete()
  }
}

export function safeDelete(...values: unknown[]) {
  for (const value of values) {
    const deletable = value as { delete?: () => void } | undefined
    try { deletable?.delete?.() } catch { /* cleanup must not mask detector results */ }
  }
}

export function extractChannel(cv: OpenCv, source: any, destination: any, channel: number) {
  if (typeof cv.extractChannel === "function") {
    cv.extractChannel(source, destination, channel)
    return
  }

  const channels = new cv.MatVector()
  let selected: any
  try {
    cv.split(source, channels)
    selected = channels.get(channel)
    selected.copyTo(destination)
  } finally {
    safeDelete(selected, channels)
  }
}

export function scalarChannel(value: unknown, index = 0) {
  if (Array.isArray(value)) return Number(value[index] ?? 0)
  if (value && typeof value === "object" && index in (value as object)) {
    return Number((value as Record<number, unknown>)[index] ?? 0)
  }
  return Number(value ?? 0)
}

export function matMean(cv: OpenCv, mat: any) {
  return scalarChannel(cv.mean(mat), 0)
}

export function normalizedCorrelation(cv: OpenCv, left: any, right: any) {
  if (left.rows !== right.rows || left.cols !== right.cols || left.empty() || right.empty()) return -1
  const result = new cv.Mat()
  try {
    cv.matchTemplate(left, right, result, cv.TM_CCOEFF_NORMED)
    const correlation = Number(result.floatAt(0, 0))
    return Number.isFinite(correlation) ? Math.max(-1, Math.min(1, correlation)) : -1
  } finally {
    result.delete()
  }
}

export function meanSquaredError(cv: OpenCv, left: any, right: any) {
  if (left.rows !== right.rows || left.cols !== right.cols || left.empty() || right.empty()) {
    return Number.POSITIVE_INFINITY
  }
  const diff = new cv.Mat()
  const floatDiff = new cv.Mat()
  const squared = new cv.Mat()
  try {
    cv.absdiff(left, right, diff)
    diff.convertTo(floatDiff, cv.CV_32F)
    cv.multiply(floatDiff, floatDiff, squared)
    return matMean(cv, squared)
  } finally {
    safeDelete(diff, floatDiff, squared)
  }
}

export function gradientMagnitude(cv: OpenCv, gray: any) {
  const floatGray = new cv.Mat()
  const dx = new cv.Mat()
  const dy = new cv.Mat()
  const magnitude = new cv.Mat()
  try {
    gray.convertTo(floatGray, cv.CV_32F)
    cv.Sobel(floatGray, dx, cv.CV_32F, 1, 0, 3)
    cv.Sobel(floatGray, dy, cv.CV_32F, 0, 1, 3)
    cv.magnitude(dx, dy, magnitude)
    return magnitude.clone()
  } finally {
    safeDelete(floatGray, dx, dy, magnitude)
  }
}
