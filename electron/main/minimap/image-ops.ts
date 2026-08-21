import type { PixelRect, RgbaFrame } from "../../../src/shared/minimap/contracts.js"

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
