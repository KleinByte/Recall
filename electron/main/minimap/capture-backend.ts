import type { PixelRect, RgbaFrame } from "../../../src/shared/minimap/contracts.js"

export interface CaptureBackendHealth {
  state: "idle" | "starting" | "healthy" | "unavailable" | "failed"
  sourceId?: string
  sourceName?: string
  lastFrameAt?: number
  lastErrorCode?: string
  /** Number of desktopCapturer window sources returned by the last scan. */
  discoveredWindowCount?: number
  /** Number of sources that passed Recall's League game-window policy. */
  candidateSourceCount?: number
  /** Bounded League/Riot-related titles only; arbitrary desktop titles are never exposed. */
  candidateSourceNames?: string[]
  sourceDiscoveryAttempts?: number
  lastSourceScanAt?: number
  nextRetryAt?: number
  /** Active stream implementation. Windows prefers source-id getUserMedia. */
  captureMode?: "display" | "legacy"
  /** Last completed or attempted bootstrap stage. */
  captureStage?: string
  /** How frames are transferred out of the hidden capture renderer. */
  frameDeliveryMode?: "paint" | "snapshot"
  paintEventCount?: number
  paintSizeMismatchCount?: number
  snapshotCaptureCount?: number
  lastPaintSize?: string
  rendererFrameSerial?: number
  /** Bounded local diagnostic; no desktop pixels or arbitrary window titles. */
  lastErrorDetail?: string
}

export interface CaptureStartInput {
  preferredSourceId?: string
  sourceNamePattern?: RegExp
  requestedWidth?: number
  requestedHeight?: number
}

export interface CaptureRegionInput {
  /** Region in the full captured-frame coordinate space. */
  sourceRect: PixelRect
  /** Optional output dimensions. Defaults to the source-region dimensions. */
  outputWidth?: number
  outputHeight?: number
}

export interface MinimapCaptureBackend {
  readonly id: "electron_desktop_capture" | "windows_graphics_capture"
  start(input?: CaptureStartInput): Promise<void>
  captureFrame(): Promise<RgbaFrame>
  /**
   * Optional low-overhead ROI path. Implementations should avoid reading the
   * entire desktop frame back to the CPU when only the minimap is required.
   */
  captureRegion?(input: CaptureRegionInput): Promise<RgbaFrame>
  stop(): Promise<void>
  getHealth(): CaptureBackendHealth
}
