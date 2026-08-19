import type { PixelRect, RgbaFrame } from "../../../src/shared/minimap/contracts.js"
import { clamp } from "../../../src/shared/minimap/contracts.js"

export interface HsvPixel {
  h: number
  s: number
  v: number
}

export function assertFrame(frame: RgbaFrame) {
  if (!Number.isSafeInteger(frame.width) || frame.width <= 0 ||
      !Number.isSafeInteger(frame.height) || frame.height <= 0 ||
      frame.data.length !== frame.width * frame.height * 4) {
    throw new Error("invalid_rgba_frame")
  }
}

export function boundedRect(rect: PixelRect, width: number, height: number): PixelRect {
  const x = Math.max(0, Math.min(width - 1, Math.floor(rect.x)))
  const y = Math.max(0, Math.min(height - 1, Math.floor(rect.y)))
  const right = Math.max(x + 1, Math.min(width, Math.ceil(rect.x + rect.width)))
  const bottom = Math.max(y + 1, Math.min(height, Math.ceil(rect.y + rect.height)))
  return { x, y, width: right - x, height: bottom - y }
}

export function cropFrame(frame: RgbaFrame, requested: PixelRect): RgbaFrame {
  assertFrame(frame)
  const rect = boundedRect(requested, frame.width, frame.height)
  const output = new Uint8Array(rect.width * rect.height * 4)
  for (let row = 0; row < rect.height; row += 1) {
    const sourceStart = ((rect.y + row) * frame.width + rect.x) * 4
    const targetStart = row * rect.width * 4
    output.set(
      frame.data.subarray(sourceStart, sourceStart + rect.width * 4),
      targetStart,
    )
  }
  return {
    width: rect.width,
    height: rect.height,
    data: output,
    capturedMonotonicMs: frame.capturedMonotonicMs,
    frameSequence: frame.frameSequence,
  }
}

export function resizeFrameBilinear(
  frame: RgbaFrame,
  targetWidth: number,
  targetHeight: number,
): RgbaFrame {
  assertFrame(frame)
  if (!Number.isSafeInteger(targetWidth) || targetWidth <= 0 ||
      !Number.isSafeInteger(targetHeight) || targetHeight <= 0) {
    throw new Error("invalid_resize_target")
  }
  if (frame.width === targetWidth && frame.height === targetHeight) {
    return { ...frame, data: frame.data.slice() }
  }
  const output = new Uint8Array(targetWidth * targetHeight * 4)
  const xScale = frame.width / targetWidth
  const yScale = frame.height / targetHeight
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = (y + 0.5) * yScale - 0.5
    const y0 = Math.max(0, Math.floor(sourceY))
    const y1 = Math.min(frame.height - 1, y0 + 1)
    const fy = clamp(sourceY - y0)
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = (x + 0.5) * xScale - 0.5
      const x0 = Math.max(0, Math.floor(sourceX))
      const x1 = Math.min(frame.width - 1, x0 + 1)
      const fx = clamp(sourceX - x0)
      const target = (y * targetWidth + x) * 4
      const p00 = (y0 * frame.width + x0) * 4
      const p10 = (y0 * frame.width + x1) * 4
      const p01 = (y1 * frame.width + x0) * 4
      const p11 = (y1 * frame.width + x1) * 4
      for (let channel = 0; channel < 4; channel += 1) {
        const top = frame.data[p00 + channel] * (1 - fx) + frame.data[p10 + channel] * fx
        const bottom = frame.data[p01 + channel] * (1 - fx) + frame.data[p11 + channel] * fx
        output[target + channel] = Math.round(top * (1 - fy) + bottom * fy)
      }
    }
  }
  return {
    width: targetWidth,
    height: targetHeight,
    data: output,
    capturedMonotonicMs: frame.capturedMonotonicMs,
    frameSequence: frame.frameSequence,
  }
}

export function grayscale(frame: RgbaFrame): Float32Array {
  assertFrame(frame)
  const result = new Float32Array(frame.width * frame.height)
  for (let index = 0; index < result.length; index += 1) {
    const source = index * 4
    result[index] =
      frame.data[source] * 0.2126 +
      frame.data[source + 1] * 0.7152 +
      frame.data[source + 2] * 0.0722
  }
  return result
}

export function gradientMagnitude(gray: Float32Array, width: number, height: number) {
  if (gray.length !== width * height) throw new Error("invalid_gray_buffer")
  const result = new Float32Array(gray.length)
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      const gx = gray[index + 1] - gray[index - 1]
      const gy = gray[index + width] - gray[index - width]
      result[index] = Math.hypot(gx, gy)
    }
  }
  return result
}

export function normalizedCorrelation(left: ArrayLike<number>, right: ArrayLike<number>) {
  if (left.length !== right.length || left.length === 0) return -1
  let leftMean = 0
  let rightMean = 0
  for (let index = 0; index < left.length; index += 1) {
    leftMean += left[index]
    rightMean += right[index]
  }
  leftMean /= left.length
  rightMean /= right.length
  let numerator = 0
  let leftVariance = 0
  let rightVariance = 0
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] - leftMean
    const r = right[index] - rightMean
    numerator += l * r
    leftVariance += l * l
    rightVariance += r * r
  }
  const denominator = Math.sqrt(leftVariance * rightVariance)
  if (denominator < 1e-8) return Math.abs(leftMean - rightMean) < 1e-6 ? 1 : 0
  return clamp(numerator / denominator, -1, 1)
}

export function meanSquaredError(left: ArrayLike<number>, right: ArrayLike<number>) {
  if (left.length !== right.length || left.length === 0) return Number.POSITIVE_INFINITY
  let sum = 0
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index]
    sum += difference * difference
  }
  return sum / left.length
}

export function rgbToHsv(red: number, green: number, blue: number): HsvPixel {
  const r = clamp(red / 255)
  const g = clamp(green / 255)
  const b = clamp(blue / 255)
  const maximum = Math.max(r, g, b)
  const minimum = Math.min(r, g, b)
  const delta = maximum - minimum
  let hue = 0
  if (delta > 0) {
    if (maximum === r) hue = ((g - b) / delta) % 6
    else if (maximum === g) hue = (b - r) / delta + 2
    else hue = (r - g) / delta + 4
    hue *= 60
    if (hue < 0) hue += 360
  }
  return {
    h: hue,
    s: maximum === 0 ? 0 : delta / maximum,
    v: maximum,
  }
}

export function hueDistance(left: number, right: number) {
  const direct = Math.abs(left - right) % 360
  return Math.min(direct, 360 - direct)
}

export function hsvSimilarity(
  pixel: HsvPixel,
  target: HsvPixel,
  tolerance: { hue: number; saturation: number; value: number },
) {
  const hue = Math.max(0, 1 - hueDistance(pixel.h, target.h) / Math.max(1, tolerance.hue))
  const saturation = Math.max(
    0,
    1 - Math.abs(pixel.s - target.s) / Math.max(0.01, tolerance.saturation),
  )
  const value = Math.max(
    0,
    1 - Math.abs(pixel.v - target.v) / Math.max(0.01, tolerance.value),
  )
  return hue * 0.55 + saturation * 0.25 + value * 0.2
}

export function sampleStatistics(frame: RgbaFrame) {
  assertFrame(frame)
  let luminanceSum = 0
  let luminanceSquared = 0
  let saturationSum = 0
  const gray = grayscale(frame)
  for (let index = 0; index < gray.length; index += 1) {
    luminanceSum += gray[index]
    luminanceSquared += gray[index] * gray[index]
    const source = index * 4
    saturationSum += rgbToHsv(
      frame.data[source],
      frame.data[source + 1],
      frame.data[source + 2],
    ).s
  }
  const mean = luminanceSum / gray.length
  const variance = Math.max(0, luminanceSquared / gray.length - mean * mean)
  const gradient = gradientMagnitude(gray, frame.width, frame.height)
  let edgePixels = 0
  for (const value of gradient) if (value >= 24) edgePixels += 1
  return {
    meanLuminance: mean,
    variance,
    saturation: saturationSum / gray.length,
    edgeDensity: edgePixels / gray.length,
  }
}

export function maskedGray(
  frame: RgbaFrame,
  include: (x: number, y: number) => boolean,
): Float32Array {
  assertFrame(frame)
  const values: number[] = []
  const gray = grayscale(frame)
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      if (include(x, y)) values.push(gray[y * frame.width + x])
    }
  }
  return Float32Array.from(values)
}

export function circularInteriorGray(frame: RgbaFrame, radiusFraction = 0.72) {
  const centerX = (frame.width - 1) / 2
  const centerY = (frame.height - 1) / 2
  const radius = Math.min(frame.width, frame.height) * 0.5 * radiusFraction
  return maskedGray(frame, (x, y) => Math.hypot(x - centerX, y - centerY) <= radius)
}
