import type { RgbaFrame } from "../../../src/shared/minimap/contracts.js"

export interface CaptureBackendHealth {
  state: "idle" | "starting" | "healthy" | "unavailable" | "failed"
  sourceId?: string
  sourceName?: string
  lastFrameAt?: number
  lastErrorCode?: string
}

export interface CaptureStartInput {
  preferredSourceId?: string
  sourceNamePattern?: RegExp
  requestedWidth?: number
  requestedHeight?: number
}

export interface MinimapCaptureBackend {
  readonly id: "electron_desktop_capture" | "windows_graphics_capture"
  start(input?: CaptureStartInput): Promise<void>
  captureFrame(): Promise<RgbaFrame>
  stop(): Promise<void>
  getHealth(): CaptureBackendHealth
}
