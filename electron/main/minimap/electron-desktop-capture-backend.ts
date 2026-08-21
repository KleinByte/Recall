import { randomUUID } from "node:crypto"
import { BrowserWindow, desktopCapturer } from "electron"
import type { DesktopCapturerSource, NativeImage } from "electron"
import type { RgbaFrame } from "../../../src/shared/minimap/contracts.js"
import type {
  CaptureBackendHealth,
  CaptureRegionInput,
  CaptureStartInput,
  MinimapCaptureBackend,
} from "./capture-backend.js"

const DEFAULT_CAPTURE_WIDTH = 1600
const DEFAULT_CAPTURE_HEIGHT = 900
const MIN_CAPTURE_WIDTH = 320
const MIN_CAPTURE_HEIGHT = 180
const MAX_CAPTURE_WIDTH = 4096
const MAX_CAPTURE_HEIGHT = 2160
const STREAM_START_TIMEOUT_MS = 5_000
const FRESH_FRAME_TIMEOUT_MS = 1_500
const OFFSCREEN_PAINT_BOOTSTRAP_TIMEOUT_MS = 750
const CAPTURE_PAGE_TIMEOUT_MS = 1_500
const SNAPSHOT_RETRY_DELAY_MS = 75
const CAPTURE_SURFACE_RESIZE_SETTLE_MS = 16
const STARTUP_PROBE_WIDTH = 320
const STARTUP_PROBE_HEIGHT = 180
const SOURCE_REVALIDATION_INTERVAL_MS = 10_000
const CAPTURE_FRAME_RATE = 5
// A WGC start can fail while the game HWND is being recreated (for example
// when the client changes from the loading window to the in-game window).  A
// single retry is enough to pick up the new HWND; more retries just create a
// storm of short-lived Chromium capture sessions.
const MAX_STREAM_START_ATTEMPTS = 2
const STREAM_START_RETRY_DELAY_MS = 250
const STREAM_START_FAILURE_COOLDOWN_MS = 3_000
const SOURCE_NOT_FOUND_COOLDOWN_MS = 750
const PERMISSION_FAILURE_COOLDOWN_MS = 30_000

const GAME_WINDOW_PATTERNS = [
  /^League of Legends \(TM\) Client(?:\s*[-—:]\s*.+)?$/i,
  /^League of Legends(?:\s*[-—:]\s*.+)?$/i,
]
const NON_GAME_WINDOW_PATTERN = /LeagueClientUx|LeagueClient(?:\.exe)?|Riot Client|Recall/i

const CAPTURE_PAGE_URL = "https://recall-capture.invalid/"
const CAPTURE_PAGE_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src blob:; style-src 'unsafe-inline'">
    <title>Recall minimap capture</title>
    <style>
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #000; }
      canvas { display: block; width: 100vw; height: 100vh; background: #000; }
      /* Keep the MediaStream decoding without allowing Chromium's video-overlay
         path to bypass the offscreen compositor. Pixels are copied into the
         visible canvas below on every delivered video frame. */
      video { position: fixed; left: 0; top: 0; width: 2px; height: 2px; opacity: .001; pointer-events: none; }
    </style>
  </head>
  <body>
    <canvas id="capture-canvas"></canvas>
    <video id="capture" autoplay muted playsinline></video>
  </body>
</html>`

interface CaptureSourceIdentity {
  id: string
  name: string
}

interface CapturedPaint {
  image: NativeImage
  serial: number
  capturedMonotonicMs: number
}

interface FrameWaiter {
  afterSerial: number
  resolve: (paint: CapturedPaint) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

type CaptureStreamMode = "display" | "legacy"
export type CaptureFrameDeliveryMode = "paint" | "snapshot"

interface CaptureVideoInfo {
  width: number
  height: number
  trackState: string
  frameSerial: number
}

interface CaptureRendererDiagnostics {
  mode: CaptureStreamMode
  secureContext: boolean
  href: string
  mediaDevicesAvailable: boolean
  getUserMediaAvailable: boolean
  getDisplayMediaAvailable: boolean
  userActivationIsActive?: boolean
  userActivationHasBeenActive?: boolean
}

interface CaptureRendererFrameRequest {
  sourceRect?: { x: number; y: number; width: number; height: number }
  outputWidth?: number
  outputHeight?: number
}

interface CaptureRendererFrameResult {
  drawn: boolean
  frameSerial: number
  width: number
  height: number
}

interface CaptureRendererFailure {
  name: string
  message: string
  stack?: string
  constraint?: string
  nativeCode?: string | number
  stage: string
  diagnostics: CaptureRendererDiagnostics
}

type CaptureVideoResult =
  | { ok: true; info: CaptureVideoInfo; diagnostics: CaptureRendererDiagnostics }
  | { ok: false; error: CaptureRendererFailure }

class CaptureBackendError extends Error {
  constructor(readonly code: string, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause })
    this.name = "CaptureBackendError"
  }
}

function regexMatches(pattern: RegExp, value: string) {
  pattern.lastIndex = 0
  const matches = pattern.test(value)
  pattern.lastIndex = 0
  return matches
}

interface CapturePermissionDetails {
  mediaType?: unknown
  mediaTypes?: unknown
}

/**
 * Grants only the two permission classes needed by the isolated capture
 * renderer. Electron/Chromium do not guarantee that preliminary permission
 * checks include a WebContents, origin, or a precise media type. In Electron
 * 43 on Windows the desktop stream check can arrive as `mediaType: "unknown"`
 * (or with no type fields), so rejecting incomplete metadata causes
 * getUserMedia and getDisplayMedia to both fail with NotAllowedError.
 *
 * The capture renderer has a unique, non-persistent session partition; its
 * HTTPS protocol handler serves exactly one internal page; microphone access
 * is separately disabled by Permissions-Policy; and the renderer always asks
 * for audio: false. That makes permission type—not optional callback metadata—
 * the stable security boundary.
 */
export function shouldGrantCaptureSessionPermission(
  permission: string,
  rawDetails: unknown = {},
) {
  const details = rawDetails && typeof rawDetails === "object"
    ? rawDetails as CapturePermissionDetails
    : {}
  if (permission === "display-capture") return true
  if (permission !== "media") return false

  // Preserve an explicit audio-only denial, while allowing Electron's
  // incomplete/unknown desktop-video metadata.
  if (details.mediaType === "audio") return false
  if (Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0) {
    return details.mediaTypes.includes("video")
  }
  return true
}

function isWindowSource(source: CaptureSourceIdentity) {
  return source.id.startsWith("window:")
}

/** Normalizes title variants produced by Windows, Wine, and Electron. */
export function normalizeLeagueWindowTitle(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/\u2122/g, "(TM)")
    .replace(/\s+/g, " ")
    .trim()
}

function isAllowedGameWindow(source: CaptureSourceIdentity, customPattern?: RegExp) {
  const normalizedName = normalizeLeagueWindowTitle(source.name)
  if (!isWindowSource(source) || NON_GAME_WINDOW_PATTERN.test(normalizedName)) return false
  if (customPattern) {
    return regexMatches(customPattern, source.name) ||
      (normalizedName !== source.name && regexMatches(customPattern, normalizedName))
  }
  return GAME_WINDOW_PATTERNS.some((pattern) => regexMatches(pattern, normalizedName))
}

function leagueGameSourceScore(name: string) {
  const normalizedName = normalizeLeagueWindowTitle(name)
  if (/^League of Legends \(TM\) Client$/i.test(normalizedName)) return 400
  if (/^League of Legends \(TM\) Client\s*[-—:]\s*.+$/i.test(normalizedName)) return 350
  if (/^League of Legends$/i.test(normalizedName)) return 200
  if (/^League of Legends\s*[-—:]\s*.+$/i.test(normalizedName)) return 150
  return 0
}

function retryCooldownMs(code: string) {
  if (code === "league_game_window_not_found" ||
      code === "capture_source_enumeration_failed") return SOURCE_NOT_FOUND_COOLDOWN_MS
  if (code === "capture_stream_permission_denied") return PERMISSION_FAILURE_COOLDOWN_MS
  return STREAM_START_FAILURE_COOLDOWN_MS
}

/**
 * Chooses only a real League game HWND. Launcher/client windows and screen
 * sources are intentionally ineligible, even when supplied as the preference.
 */
export function selectLeagueGameWindowSource<T extends CaptureSourceIdentity>(
  sources: readonly T[],
  preferredSourceId?: string,
  sourceNamePattern?: RegExp,
) {
  const candidates = sources
    .filter((source) => isAllowedGameWindow(source, sourceNamePattern))
    .sort((left, right) => {
      const preferredDifference = Number(right.id === preferredSourceId) -
        Number(left.id === preferredSourceId)
      if (preferredDifference !== 0) return preferredDifference
      const scoreDifference = leagueGameSourceScore(right.name) - leagueGameSourceScore(left.name)
      if (scoreDifference !== 0) return scoreDifference
      const nameDifference = left.name.localeCompare(right.name)
      return nameDifference !== 0 ? nameDifference : left.id.localeCompare(right.id)
    })
  return candidates[0]
}

function normalizedDimension(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === undefined) return fallback
  if (!Number.isFinite(value)) throw new CaptureBackendError("capture_dimensions_invalid")
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

function evenFloor(value: number) {
  const floored = Math.max(2, Math.floor(value))
  return floored - (floored % 2)
}

/** Preserves the captured window's aspect ratio inside the requested bounds. */
export function fitCaptureSize(
  sourceWidth: number,
  sourceHeight: number,
  maximumWidth: number,
  maximumHeight: number,
) {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new CaptureBackendError("capture_stream_dimensions_invalid")
  }
  const scale = Math.min(1, maximumWidth / sourceWidth, maximumHeight / sourceHeight)
  return {
    width: evenFloor(sourceWidth * scale),
    height: evenFloor(sourceHeight * scale),
  }
}

/** Returns a stable error code instead of allowing malformed native buffers downstream. */
export function capturedBitmapValidationError(
  width: number,
  height: number,
  byteLength: number,
) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < MIN_CAPTURE_WIDTH ||
    height < MIN_CAPTURE_HEIGHT ||
    width > MAX_CAPTURE_WIDTH ||
    height > MAX_CAPTURE_HEIGHT
  ) {
    return "capture_frame_dimensions_invalid"
  }
  const expectedLength = width * height * 4
  if (!Number.isSafeInteger(byteLength) || byteLength !== expectedLength) {
    return "capture_frame_bitmap_invalid"
  }
  return undefined
}

/**
 * NativeImage returns BGRA. Swizzle the already-copied bitmap in place instead
 * of allocating and writing a second full-frame buffer. A 32-bit pass performs
 * one read and one write per pixel; the byte fallback handles an unlikely
 * unaligned native buffer.
 */
function bgraToRgba(bitmap: Buffer) {
  if (bitmap.byteOffset % 4 === 0 && bitmap.byteLength % 4 === 0) {
    const pixels = new Uint32Array(
      bitmap.buffer,
      bitmap.byteOffset,
      bitmap.byteLength / 4,
    )
    for (let index = 0; index < pixels.length; index += 1) {
      const value = pixels[index]
      pixels[index] = (value & 0xff00ff00) |
        ((value & 0x00ff0000) >>> 16) |
        ((value & 0x000000ff) << 16)
    }
  } else {
    for (let offset = 0; offset < bitmap.length; offset += 4) {
      const blue = bitmap[offset]
      bitmap[offset] = bitmap[offset + 2]
      bitmap[offset + 2] = blue
    }
  }
  return new Uint8Array(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength)
}

function errorMessages(error: unknown) {
  const messages: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    messages.push(current instanceof Error ? `${current.name}: ${current.message}` : String(current))
    current = current instanceof Error
      ? (current as Error & { cause?: unknown }).cause
      : undefined
  }
  return messages
}

function errorCode(error: unknown, fallback: string) {
  const explicitCode = error instanceof CaptureBackendError ? error.code : undefined
  const message = errorMessages(error).join(" ")
  // Prefer the renderer/native reason over a generic stage wrapper. Electron's
  // executeJavaScript bridge can otherwise collapse a DOMException into the
  // unhelpful capture_stream_start_failed code.
  if (/-2147024809|0x80070057|E_INVALIDARG/i.test(message)) {
    return "capture_stream_start_e_invalidarg"
  }
  if (/NotReadableError|Could not start video source/i.test(message)) {
    return "capture_stream_not_readable"
  }
  if (/NotAllowedError|Permission denied/i.test(message)) {
    return "capture_stream_permission_denied"
  }
  if (/InvalidStateError|transient activation|user gesture/i.test(message)) {
    return "capture_stream_invalid_state"
  }
  if (/AbortError/i.test(message)) return "capture_stream_aborted"
  if (/NotSupportedError/i.test(message)) return "capture_stream_not_supported"
  if (/OverconstrainedError|ConstraintNotSatisfiedError/i.test(message)) {
    return "capture_stream_overconstrained"
  }
  if (/SecurityError/i.test(message)) return "capture_stream_security_error"
  if (/NotFoundError|Requested device not found/i.test(message)) {
    return "capture_stream_source_not_found"
  }
  if (/TypeError/i.test(message) && /constraint|media|display|capture/i.test(message)) {
    return "capture_stream_constraints_invalid"
  }
  const embeddedCode = message.match(/\b(?:capture|league)_[a-z0-9_]+\b/i)?.[0]
  if (embeddedCode) return embeddedCode.toLocaleLowerCase()
  return explicitCode ?? fallback
}

export function captureModeOrder(platform: string = process.platform): CaptureStreamMode[] {
  // On Windows the DesktopCapturerSource id is deterministic and avoids the
  // transient-activation/display-picker path. Keep getDisplayMedia as a second
  // implementation so a Chromium regression in either path is recoverable.
  return platform === "win32" ? ["legacy", "display"] : ["display", "legacy"]
}

/**
 * Electron's Windows offscreen compositor can accept a live desktop stream yet
 * never emit a paint event. A normal hidden BrowserWindow plus capturePage is
 * slower than OSR but deterministic and remains invisible with stayHidden.
 */
export function preferredFrameDeliveryMode(
  platform: string = process.platform,
): CaptureFrameDeliveryMode {
  return platform === "win32" ? "snapshot" : "paint"
}

function rendererFailureCode(failure: CaptureRendererFailure) {
  return errorCode(
    new Error([
      `${failure.name}: ${failure.message}`,
      failure.nativeCode !== undefined ? `nativeCode=${failure.nativeCode}` : undefined,
      failure.constraint ? `constraint=${failure.constraint}` : undefined,
      `stage=${failure.stage}`,
    ].filter(Boolean).join(" | ")),
    "capture_stream_start_failed",
  )
}

function boundedErrorDetail(error: unknown, maximumLength = 1_200) {
  return errorMessages(error).join(" <- ").slice(0, maximumLength)
}

function rendererFailureDetail(failure: CaptureRendererFailure) {
  const diagnostics = failure.diagnostics
  return [
    `${failure.name}: ${failure.message}`,
    `stage=${failure.stage}`,
    `mode=${diagnostics.mode}`,
    `secure=${diagnostics.secureContext}`,
    `mediaDevices=${diagnostics.mediaDevicesAvailable}`,
    `getUserMedia=${diagnostics.getUserMediaAvailable}`,
    `getDisplayMedia=${diagnostics.getDisplayMediaAvailable}`,
    `activation=${diagnostics.userActivationIsActive ?? "unknown"}`,
    failure.constraint ? `constraint=${failure.constraint}` : undefined,
    failure.nativeCode !== undefined ? `nativeCode=${failure.nativeCode}` : undefined,
  ].filter(Boolean).join(" | ").slice(0, 1_200)
}

function isCaptureVideoResult(value: unknown): value is CaptureVideoResult {
  return typeof value === "object" && value !== null &&
    typeof (value as { ok?: unknown }).ok === "boolean"
}

function isRetryableStreamStartCode(code: string) {
  return code === "capture_stream_start_failed" ||
    code === "capture_stream_start_e_invalidarg" ||
    code === "capture_stream_not_readable" ||
    code === "capture_stream_permission_denied" ||
    code === "capture_stream_invalid_state" ||
    code === "capture_stream_aborted" ||
    code === "capture_stream_not_supported" ||
    code === "capture_stream_overconstrained" ||
    code === "capture_stream_constraints_invalid" ||
    code === "capture_stream_security_error" ||
    code === "capture_stream_source_not_found" ||
    code === "capture_stream_video_track_missing" ||
    code === "capture_stream_video_track_not_live" ||
    code === "capture_stream_video_error" ||
    code === "capture_stream_metadata_timeout" ||
    code === "capture_stream_video_frame_timeout" ||
    code === "capture_frame_timeout" ||
    code === "capture_page_failed" ||
    code === "capture_page_timeout" ||
    code === "capture_renderer_frame_request_failed" ||
    code === "capture_frame_empty" ||
    code === "capture_frame_dimensions_invalid" ||
    code === "capture_frame_bitmap_invalid" ||
    code === "capture_media_devices_unavailable" ||
    code === "league_game_window_not_found" ||
    code === "capture_source_enumeration_failed" ||
    code === "capture_source_handle_changed" ||
    code === "capture_window_closed"
}

function waitForRetry(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new CaptureBackendError(code)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

function startVideoScript(
  maximumWidth: number,
  maximumHeight: number,
  mode: CaptureStreamMode,
  sourceId: string,
  frameDeliveryMode: CaptureFrameDeliveryMode,
) {
  const acquisition = mode === "legacy"
    ? `navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: ${JSON.stringify(sourceId)},
          maxWidth: ${maximumWidth},
          maxHeight: ${maximumHeight},
          maxFrameRate: ${CAPTURE_FRAME_RATE}
        }
      }
    })`
    : `navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: {
        width: { max: ${maximumWidth} },
        height: { max: ${maximumHeight} },
        frameRate: { max: ${CAPTURE_FRAME_RATE} }
      }
    })`
  return `(async () => {
    const continuousFramePump = ${JSON.stringify(frameDeliveryMode === "paint")}
    const diagnostics = {
      mode: ${JSON.stringify(mode)},
      secureContext: Boolean(globalThis.isSecureContext),
      href: String(globalThis.location?.href ?? ""),
      mediaDevicesAvailable: Boolean(navigator.mediaDevices),
      getUserMediaAvailable: typeof navigator.mediaDevices?.getUserMedia === "function",
      getDisplayMediaAvailable: typeof navigator.mediaDevices?.getDisplayMedia === "function",
      userActivationIsActive: navigator.userActivation?.isActive,
      userActivationHasBeenActive: navigator.userActivation?.hasBeenActive,
      visibilityState: document.visibilityState
    }
    let stage = "bootstrap"
    let stream
    let stopFramePump
    const video = document.getElementById("capture")
    const canvas = document.getElementById("capture-canvas")
    try {
      if (!globalThis.isSecureContext) throw new Error("capture_insecure_context")
      if (!(video instanceof HTMLVideoElement)) throw new Error("capture_video_element_missing")
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("capture_canvas_element_missing")
      const mediaMethod = ${JSON.stringify(mode)} === "legacy" ? "getUserMedia" : "getDisplayMedia"
      if (!navigator.mediaDevices || typeof navigator.mediaDevices[mediaMethod] !== "function") {
        throw new Error("capture_media_devices_unavailable")
      }

      try { globalThis.__recallCaptureStopFramePump?.() } catch {}
      try { globalThis.__recallCaptureStream?.getTracks().forEach((entry) => entry.stop()) } catch {}
      globalThis.__recallCaptureStopFramePump = undefined
      globalThis.__recallCaptureDrawFrame = undefined
      globalThis.__recallCaptureStream = undefined
      globalThis.__recallCaptureFrameSerial = 0
      globalThis.__recallCaptureFrameWidth = 0
      globalThis.__recallCaptureFrameHeight = 0

      stage = "requesting_stream"
      stream = await ${acquisition}
      const track = stream.getVideoTracks()[0]
      if (!track) throw new Error("capture_stream_video_track_missing")
      globalThis.__recallCaptureStream = stream
      video.srcObject = stream

      stage = "waiting_metadata"
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("capture_stream_metadata_timeout")), ${STREAM_START_TIMEOUT_MS})
        const ready = () => {
          clearTimeout(timeout)
          resolve(undefined)
        }
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) ready()
        else video.addEventListener("loadedmetadata", ready, { once: true })
        video.addEventListener("error", () => {
          clearTimeout(timeout)
          reject(new Error("capture_stream_video_error"))
        }, { once: true })
      })

      stage = "playing_video"
      await video.play()
      if (track.readyState !== "live") throw new Error("capture_stream_video_track_not_live")
      if (!Number.isFinite(video.videoWidth) || !Number.isFinite(video.videoHeight) ||
          video.videoWidth <= 0 || video.videoHeight <= 0) {
        throw new Error("capture_stream_dimensions_invalid")
      }

      const scale = Math.min(
        1,
        ${maximumWidth} / video.videoWidth,
        ${maximumHeight} / video.videoHeight
      )
      const evenFloor = (value) => {
        const floored = Math.max(2, Math.floor(value))
        return floored - (floored % 2)
      }
      const targetWidth = evenFloor(video.videoWidth * scale)
      const targetHeight = evenFloor(video.videoHeight * scale)
      const context = canvas.getContext("2d", {
        alpha: false,
        desynchronized: true,
        willReadFrequently: false
      })
      if (!context) throw new Error("capture_canvas_context_unavailable")
      const configureCanvas = (width, height) => {
        if (canvas.width !== width) canvas.width = width
        if (canvas.height !== height) canvas.height = height
        canvas.style.width = width + "px"
        canvas.style.height = height + "px"
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = "medium"
      }
      const normalizedRequest = (request) => {
        const rect = request?.sourceRect
        if (!rect) {
          return {
            sourceX: 0,
            sourceY: 0,
            sourceWidth: video.videoWidth,
            sourceHeight: video.videoHeight,
            outputWidth: targetWidth,
            outputHeight: targetHeight
          }
        }
        const values = [rect.x, rect.y, rect.width, rect.height]
        if (!values.every(Number.isFinite) || rect.x < 0 || rect.y < 0 ||
            rect.width <= 0 || rect.height <= 0 ||
            rect.x + rect.width > targetWidth ||
            rect.y + rect.height > targetHeight) {
          throw new Error("capture_region_invalid")
        }
        const outputWidth = evenFloor(request.outputWidth ?? rect.width)
        const outputHeight = evenFloor(request.outputHeight ?? rect.height)
        const sourceScaleX = video.videoWidth / targetWidth
        const sourceScaleY = video.videoHeight / targetHeight
        return {
          sourceX: rect.x * sourceScaleX,
          sourceY: rect.y * sourceScaleY,
          sourceWidth: rect.width * sourceScaleX,
          sourceHeight: rect.height * sourceScaleY,
          outputWidth,
          outputHeight
        }
      }

      stage = "waiting_video_frame"
      let stopped = false
      let frameSerial = 0
      let pumpTimer
      let firstFrameTimeout
      let resolveFirstFrame
      let rejectFirstFrame
      const firstFrame = new Promise((resolve, reject) => {
        resolveFirstFrame = resolve
        rejectFirstFrame = reject
        firstFrameTimeout = setTimeout(
          () => reject(new Error("capture_stream_video_frame_timeout")),
          ${STREAM_START_TIMEOUT_MS}
        )
      })
      const drawFrame = (request) => {
        if (stopped) return false
        try {
          if (track.readyState !== "live") throw new Error("capture_stream_video_track_not_live")
          if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
              video.videoWidth <= 0 || video.videoHeight <= 0) return false
          const frame = normalizedRequest(request)
          configureCanvas(frame.outputWidth, frame.outputHeight)
          // The ordinary capture path now draws only the calibrated minimap
          // region into a small canvas. Full-frame composition is reserved for
          // initial calibration and infrequent source validation.
          context.drawImage(
            video,
            frame.sourceX,
            frame.sourceY,
            frame.sourceWidth,
            frame.sourceHeight,
            0,
            0,
            frame.outputWidth,
            frame.outputHeight
          )
          frameSerial += 1
          globalThis.__recallCaptureFrameSerial = frameSerial
          globalThis.__recallCaptureFrameWidth = frame.outputWidth
          globalThis.__recallCaptureFrameHeight = frame.outputHeight
          if (frameSerial === 1) {
            clearTimeout(firstFrameTimeout)
            resolveFirstFrame(undefined)
          }
          return true
        } catch (error) {
          if (frameSerial === 0) {
            clearTimeout(firstFrameTimeout)
            rejectFirstFrame(error)
          } else {
            document.title = "Recall minimap capture ended"
          }
          return false
        }
      }
      stopFramePump = () => {
        stopped = true
        clearTimeout(firstFrameTimeout)
        clearInterval(pumpTimer)
      }
      globalThis.__recallCaptureStopFramePump = stopFramePump
      globalThis.__recallCaptureDrawFrame = drawFrame

      // A short timer bootstraps the first decoded frame. Snapshot delivery is
      // demand-driven after that point, avoiding an independent full-frame
      // compositor loop beside the telemetry scheduler. Its bootstrap canvas is
      // deliberately tiny; the coordinator requests one full frame afterward
      // for minimap calibration.
      const bootstrapRequest = continuousFramePump ? undefined : {
        sourceRect: { x: 0, y: 0, width: targetWidth, height: targetHeight },
        outputWidth: Math.min(targetWidth, ${STARTUP_PROBE_WIDTH}),
        outputHeight: Math.min(targetHeight, ${STARTUP_PROBE_HEIGHT})
      }
      drawFrame(bootstrapRequest)
      pumpTimer = setInterval(
        drawFrame,
        continuousFramePump
          ? ${Math.max(16, Math.round(1_000 / CAPTURE_FRAME_RATE))}
          : 50
      )
      if (continuousFramePump && typeof video.requestVideoFrameCallback === "function") {
        video.requestVideoFrameCallback(() => drawFrame())
      }
      await firstFrame
      if (!continuousFramePump) {
        clearInterval(pumpTimer)
        pumpTimer = undefined
      }

      track.addEventListener("ended", () => { document.title = "Recall minimap capture ended" })
      track.addEventListener("mute", () => { document.title = "Recall minimap capture muted" })
      return {
        ok: true,
        info: {
          width: targetWidth,
          height: targetHeight,
          trackState: track.readyState,
          frameSerial
        },
        diagnostics
      }
    } catch (error) {
      try { stopFramePump?.() } catch {}
      try { stream?.getTracks().forEach((entry) => entry.stop()) } catch {}
      globalThis.__recallCaptureStopFramePump = undefined
      globalThis.__recallCaptureDrawFrame = undefined
      globalThis.__recallCaptureStream = undefined
      globalThis.__recallCaptureFrameSerial = 0
      globalThis.__recallCaptureFrameWidth = 0
      globalThis.__recallCaptureFrameHeight = 0
      if (video instanceof HTMLVideoElement) video.srcObject = null
      const candidate = error && typeof error === "object" ? error : undefined
      return {
        ok: false,
        error: {
          name: typeof candidate?.name === "string" ? candidate.name : "Error",
          message: (typeof candidate?.message === "string" ? candidate.message : String(error)).slice(0, 1000),
          stack: typeof candidate?.stack === "string" ? candidate.stack.slice(0, 2000) : undefined,
          constraint: typeof candidate?.constraint === "string" ? candidate.constraint : undefined,
          nativeCode: typeof candidate?.code === "string" || typeof candidate?.code === "number"
            ? candidate.code
            : undefined,
          stage,
          diagnostics
        }
      }
    }
  })()`
}

function refreshCanvasScript(request?: CaptureRendererFrameRequest) {
  return `(async () => {
    const drawFrame = globalThis.__recallCaptureDrawFrame
    const previousWidth = Number(globalThis.__recallCaptureFrameWidth ?? 0)
    const previousHeight = Number(globalThis.__recallCaptureFrameHeight ?? 0)
    let drawn = false
    try {
      drawn = typeof drawFrame === "function" && Boolean(drawFrame(${JSON.stringify(request)}))
    } catch {}
    const frameSerial = Number(globalThis.__recallCaptureFrameSerial ?? 0)
    const width = Number(globalThis.__recallCaptureFrameWidth ?? 0)
    const height = Number(globalThis.__recallCaptureFrameHeight ?? 0)
    if (drawn && (width !== previousWidth || height !== previousHeight)) {
      // Canvas and BrowserWindow resizing commit on separate Chromium turns.
      // Waiting through two animation frames prevents capturePage from reading
      // a cleared or partially resized surface during full-frame refreshes.
      const schedule = typeof globalThis.requestAnimationFrame === "function"
        ? (callback) => globalThis.requestAnimationFrame(callback)
        : (callback) => setTimeout(callback, ${CAPTURE_SURFACE_RESIZE_SETTLE_MS})
      await new Promise((resolve) => schedule(() => schedule(() => resolve(undefined))))
    }
    return {
      drawn,
      frameSerial: Number.isSafeInteger(frameSerial) ? Math.max(0, frameSerial) : 0,
      width: Number.isSafeInteger(width) ? Math.max(0, width) : 0,
      height: Number.isSafeInteger(height) ? Math.max(0, height) : 0
    }
  })()`
}

const STOP_VIDEO_SCRIPT = `(() => {
  try { globalThis.__recallCaptureStopFramePump?.() } catch {}
  globalThis.__recallCaptureStopFramePump = undefined
  globalThis.__recallCaptureDrawFrame = undefined
  const stream = globalThis.__recallCaptureStream
  if (stream) stream.getTracks().forEach((track) => track.stop())
  globalThis.__recallCaptureStream = undefined
  globalThis.__recallCaptureFrameSerial = 0
  globalThis.__recallCaptureFrameWidth = 0
  globalThis.__recallCaptureFrameHeight = 0
  const video = document.getElementById("capture")
  if (video instanceof HTMLVideoElement) video.srcObject = null
})()`

/**
 * Captures one explicitly selected League game window through a persistent
 * MediaStream rendered in an isolated hidden Electron window. desktopCapturer
 * is used only for bounded, tiny-thumbnail HWND discovery; telemetry frames
 * consume the persistent stream for the one selected game window. Windows uses
 * capturePage snapshots because Electron offscreen paint can stall on video.
 */
export class ElectronDesktopCaptureBackend implements MinimapCaptureBackend {
  readonly id = "electron_desktop_capture" as const
  private health: CaptureBackendHealth = { state: "idle" }
  private sourceId?: string
  private sourceName?: string
  private options: Required<Pick<CaptureStartInput, "requestedWidth" | "requestedHeight">> &
    Omit<CaptureStartInput, "requestedWidth" | "requestedHeight"> = {
      requestedWidth: DEFAULT_CAPTURE_WIDTH,
      requestedHeight: DEFAULT_CAPTURE_HEIGHT,
    }
  private captureWindow?: BrowserWindow
  private captureGeneration = 0
  private acceptPaint = false
  private expectedFrameSize?: { width: number; height: number }
  private streamTerminalErrorCode?: string
  private latestPaint?: CapturedPaint
  private paintSerial = 0
  private lastDeliveredPaintSerial = 0
  private readonly frameWaiters = new Set<FrameWaiter>()
  private nextSourceValidationAt = 0
  private sequence = 0
  private startInFlight?: Promise<void>
  private startFailure?: { code: string; retryAt: number }
  private sourceDiscoveryAttempts = 0
  private lastSourceScanAt?: number
  private discoveredWindowCount = 0
  private candidateSourceNames: string[] = []
  private candidateSourceCount = 0
  private captureMode?: CaptureStreamMode
  private frameDeliveryMode: CaptureFrameDeliveryMode = "paint"
  private captureStage = "idle"
  private lastErrorDetail?: string
  private paintEventCount = 0
  private paintSizeMismatchCount = 0
  private snapshotCaptureCount = 0
  private lastPaintSize?: string
  private rendererFrameSerial = 0
  private captureSurfaceSize?: { width: number; height: number }

  async start(input: CaptureStartInput = {}) {
    if (this.startInFlight) return this.startInFlight
    if (this.startFailure && Date.now() < this.startFailure.retryAt) {
      const code = this.startFailure.code
      this.setFailure(code)
      throw new CaptureBackendError(code)
    }
    this.options = {
      ...input,
      requestedWidth: normalizedDimension(
        input.requestedWidth,
        DEFAULT_CAPTURE_WIDTH,
        MIN_CAPTURE_WIDTH,
        MAX_CAPTURE_WIDTH,
      ),
      requestedHeight: normalizedDimension(
        input.requestedHeight,
        DEFAULT_CAPTURE_HEIGHT,
        MIN_CAPTURE_HEIGHT,
        MAX_CAPTURE_HEIGHT,
      ),
    }
    this.sequence = 0
    this.lastDeliveredPaintSerial = this.paintSerial
    this.health = this.withDiagnostics({ state: "starting" })
    const task = this.startWithBoundedRetry()
    this.startInFlight = task
    try {
      await task
    } finally {
      if (this.startInFlight === task) this.startInFlight = undefined
    }
  }

  async captureFrame(): Promise<RgbaFrame> {
    return this.captureOutput()
  }

  async captureRegion(input: CaptureRegionInput): Promise<RgbaFrame> {
    if (!this.captureWindow || !this.sourceId || !this.expectedFrameSize) {
      await this.acquireCaptureStream()
    }
    return this.captureOutput(this.normalizeRegionInput(input))
  }

  private normalizeRegionInput(input: CaptureRegionInput): CaptureRendererFrameRequest {
    const fullSize = this.expectedFrameSize
    if (!fullSize) throw new CaptureBackendError("capture_frame_dimensions_invalid")
    const sourceRect = {
      x: Math.round(input.sourceRect.x),
      y: Math.round(input.sourceRect.y),
      width: Math.round(input.sourceRect.width),
      height: Math.round(input.sourceRect.height),
    }
    if (
      !Object.values(sourceRect).every(Number.isSafeInteger) ||
      sourceRect.x < 0 ||
      sourceRect.y < 0 ||
      sourceRect.width <= 0 ||
      sourceRect.height <= 0 ||
      sourceRect.x + sourceRect.width > fullSize.width ||
      sourceRect.y + sourceRect.height > fullSize.height
    ) {
      throw new CaptureBackendError("capture_region_invalid")
    }
    return {
      sourceRect,
      outputWidth: normalizedDimension(
        input.outputWidth,
        sourceRect.width,
        MIN_CAPTURE_WIDTH,
        MAX_CAPTURE_WIDTH,
      ),
      outputHeight: normalizedDimension(
        input.outputHeight,
        sourceRect.height,
        MIN_CAPTURE_HEIGHT,
        MAX_CAPTURE_HEIGHT,
      ),
    }
  }

  private async captureOutput(request?: CaptureRendererFrameRequest): Promise<RgbaFrame> {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (!this.captureWindow || !this.sourceId) await this.acquireCaptureStream()
        await this.validateSourceHandle()
        const paint = await this.captureNextFrame(request)
        const frame = this.frameFromPaint(paint)
        this.lastDeliveredPaintSerial = paint.serial
        this.health = this.withDiagnostics({
          state: "healthy",
          sourceId: this.sourceId,
          sourceName: this.sourceName,
          lastFrameAt: Date.now(),
        })
        return frame
      } catch (error) {
        lastError = error
        if (attempt === 0) {
          const code = errorCode(error, "capture_frame_failed")
          this.health = this.withDiagnostics({
            state: "starting",
            sourceId: this.sourceId,
            sourceName: this.sourceName,
            lastErrorCode: code,
          })
          try {
            await this.acquireCaptureStream()
          } catch (reacquireError) {
            lastError = reacquireError
            break
          }
        }
      }
    }

    const code = errorCode(lastError, "capture_frame_failed")
    this.setFailure(code)
    throw new CaptureBackendError(code, lastError)
  }

  async stop() {
    await this.destroyCaptureWindow("capture_stopped")
    this.sourceId = undefined
    this.sourceName = undefined
    this.startFailure = undefined
    this.captureMode = undefined
    this.frameDeliveryMode = "paint"
    this.captureStage = "idle"
    this.lastErrorDetail = undefined
    this.paintEventCount = 0
    this.paintSizeMismatchCount = 0
    this.snapshotCaptureCount = 0
    this.lastPaintSize = undefined
    this.rendererFrameSerial = 0
    this.captureSurfaceSize = undefined
    this.health = this.withDiagnostics({ state: "idle" })
  }

  private async startWithBoundedRetry() {
    let lastError: unknown
    const modes = captureModeOrder()
    for (let attempt = 0; attempt < Math.min(MAX_STREAM_START_ATTEMPTS, modes.length); attempt += 1) {
      const mode = modes[attempt]
      this.captureMode = mode
      this.captureStage = "starting"
      try {
        await this.acquireCaptureStream(mode)
        this.startFailure = undefined
        this.lastErrorDetail = undefined
        this.captureStage = "capturing"
        return
      } catch (error) {
        lastError = error
        const code = errorCode(error, "capture_stream_start_failed")
        this.lastErrorDetail = boundedErrorDetail(error)
        console.warn("[Recall minimap capture] stream startup attempt failed", {
          attempt: attempt + 1,
          mode,
          code,
          sourceId: this.sourceId,
          sourceName: this.sourceName,
          detail: this.lastErrorDetail,
        })
        const hasAlternateMode = attempt + 1 < Math.min(MAX_STREAM_START_ATTEMPTS, modes.length)
        if (!hasAlternateMode || !isRetryableStreamStartCode(code)) {
          const retryAt = Date.now() + retryCooldownMs(code)
          this.startFailure = {
            code,
            retryAt,
          }
          this.setFailure(code, retryAt)
          throw new CaptureBackendError(code, error)
        }
        this.captureStage = "retrying_alternate_mode"
        await waitForRetry(STREAM_START_RETRY_DELAY_MS)
      }
    }
    const code = errorCode(lastError, "capture_stream_start_failed")
    const retryAt = Date.now() + retryCooldownMs(code)
    this.startFailure = {
      code,
      retryAt,
    }
    this.setFailure(code, retryAt)
    throw new CaptureBackendError(code, lastError)
  }

  getHealth() {
    return {
      ...this.health,
      candidateSourceNames: this.health.candidateSourceNames
        ? [...this.health.candidateSourceNames]
        : undefined,
    }
  }

  private async acquireCaptureStream(mode?: CaptureStreamMode) {
    const selectedMode = mode ?? this.captureMode ?? captureModeOrder()[0]
    this.captureMode = selectedMode
    await this.destroyCaptureWindow("capture_stream_restarting")
    this.sourceId = undefined
    this.sourceName = undefined
    this.captureStage = "enumerating_sources"
    const source = await this.resolveSource()
    this.sourceId = source.id
    this.sourceName = source.name
    this.captureStage = "starting_stream"
    this.health = this.withDiagnostics({
      state: "starting",
      sourceId: source.id,
      sourceName: source.name,
    })
    try {
      await this.startSelectedStream(source, selectedMode)
      this.nextSourceValidationAt = Date.now() + SOURCE_REVALIDATION_INTERVAL_MS
    } catch (error) {
      this.lastErrorDetail = boundedErrorDetail(error)
      await this.destroyCaptureWindow("capture_stream_start_failed")
      const code = errorCode(error, "capture_stream_start_failed")
      throw new CaptureBackendError(code, error)
    }
  }

  private async resolveSource() {
    const sources = await this.enumerateWindowSources()
    this.recordSourceScan(sources)
    const source = selectLeagueGameWindowSource(
      sources,
      this.options.preferredSourceId,
      this.options.sourceNamePattern,
    )
    if (!source) throw new CaptureBackendError("league_game_window_not_found")
    return source
  }

  private async enumerateWindowSources() {
    this.sourceDiscoveryAttempts += 1
    try {
      return await desktopCapturer.getSources({
        types: ["window"],
        // Electron documents zero in either dimension as the no-thumbnail
        // form. This avoids starting a thumbnail capture for every window;
        // the selected stream is negotiated separately below.
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      })
    } catch (error) {
      throw new CaptureBackendError("capture_source_enumeration_failed", error)
    }
  }

  private async validateSourceHandle() {
    if (Date.now() < this.nextSourceValidationAt) return
    this.nextSourceValidationAt = Date.now() + SOURCE_REVALIDATION_INTERVAL_MS
    const sourceId = this.sourceId
    if (!sourceId) throw new CaptureBackendError("capture_source_handle_missing")
    const sources = await this.enumerateWindowSources()
    this.recordSourceScan(sources)
    const source = sources.find((entry) => entry.id === sourceId)
    if (!source || !isAllowedGameWindow(source, this.options.sourceNamePattern)) {
      throw new CaptureBackendError("capture_source_handle_changed")
    }
  }

  private async startSelectedStream(
    source: DesktopCapturerSource,
    mode: CaptureStreamMode,
  ) {
    const generation = this.captureGeneration
    // A fresh in-memory session per stream attempt prevents Chromium from
    // reusing a denied permission result and avoids Electron's historical
    // setDisplayMediaRequestHandler re-registration edge cases.
    const captureSessionPartition = `recall-minimap-capture-${randomUUID()}`
    this.frameDeliveryMode = preferredFrameDeliveryMode()
    const useOffscreenPaint = this.frameDeliveryMode === "paint"
    const captureWindow = new BrowserWindow({
      show: false,
      frame: false,
      focusable: false,
      skipTaskbar: true,
      paintWhenInitiallyHidden: true,
      backgroundColor: "#000000",
      width: MIN_CAPTURE_WIDTH,
      height: MIN_CAPTURE_HEIGHT,
      webPreferences: {
        ...(useOffscreenPaint
          ? { offscreen: { useSharedTexture: false, deviceScaleFactor: 1 } }
          : {}),
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: captureSessionPartition,
      },
    })
    this.captureWindow = captureWindow
    this.acceptPaint = false
    this.streamTerminalErrorCode = undefined
    this.paintEventCount = 0
    this.paintSizeMismatchCount = 0
    this.snapshotCaptureCount = 0
    this.lastPaintSize = undefined
    this.rendererFrameSerial = 0
    const webContents = captureWindow.webContents
    const captureSession = webContents.session
    if (captureSession.protocol.isProtocolHandled("https")) {
      captureSession.protocol.unhandle("https")
    }
    captureSession.protocol.handle("https", (request) => new Response(
      request.url === CAPTURE_PAGE_URL ? CAPTURE_PAGE_HTML : "Not found",
      {
        status: request.url === CAPTURE_PAGE_URL ? 200 : 404,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'none'; media-src blob:; style-src 'unsafe-inline'",
          // Chromium 150 applies Permissions Policy before Electron's media
          // callbacks. Make the internal top-level capture document's video
          // capabilities explicit and deny microphone access.
          "permissions-policy": "display-capture=(self), camera=(self), microphone=()",
          "cache-control": "no-store",
        },
      },
    ))
    // This is a unique, non-persistent partition used by one hidden internal
    // renderer. Do not require optional WebContents/origin/media metadata here:
    // Electron 43 can omit or generalize those fields during the preliminary
    // desktop-capture check, which previously denied Recall's own request.
    captureSession.setPermissionCheckHandler((_requestingContents, permission, _origin, details) =>
      generation === this.captureGeneration &&
      this.captureWindow === captureWindow &&
      shouldGrantCaptureSessionPermission(permission, details),
    )
    captureSession.setPermissionRequestHandler((_requestingContents, permission, callback, details) => {
      callback(
        generation === this.captureGeneration &&
        this.captureWindow === captureWindow &&
        shouldGrantCaptureSessionPermission(permission, details),
      )
    })
    captureSession.setDisplayMediaRequestHandler((request, callback) => {
      // Session isolation, generation identity, video-only constraints, and the
      // selected DesktopCapturerSource are the authorization boundary. The
      // request's securityOrigin is diagnostic metadata and is not guaranteed
      // to be normalized consistently across Chromium desktop-capture paths.
      const allowed = generation === this.captureGeneration &&
        this.captureWindow === captureWindow &&
        request.videoRequested &&
        !request.audioRequested
      callback(allowed ? { video: source } : {})
    })
    if (useOffscreenPaint) {
      webContents.setFrameRate(CAPTURE_FRAME_RATE)
      webContents.on("paint", (_event, _dirtyRect, image) => {
        if (
          generation !== this.captureGeneration ||
          this.captureWindow !== captureWindow
        ) return
        this.publishPaint(image)
      })
    }
    webContents.on("render-process-gone", (_event, details) => {
      if (generation !== this.captureGeneration) return
      this.markStreamTerminal(`capture_render_process_gone:${details.reason}`)
    })
    captureWindow.on("page-title-updated", (event, title) => {
      event.preventDefault()
      if (generation !== this.captureGeneration) return
      if (/capture ended/i.test(title)) this.markStreamTerminal("capture_stream_ended")
    })
    captureWindow.on("closed", () => {
      if (generation !== this.captureGeneration) return
      this.markStreamTerminal("capture_window_closed")
    })

    this.captureStage = "loading_capture_page"
    try {
      await captureWindow.loadURL(CAPTURE_PAGE_URL)
    } catch (error) {
      throw new CaptureBackendError("capture_page_load_failed", error)
    }
    this.captureStage = "requesting_stream"
    let rawVideoResult: unknown
    try {
      rawVideoResult = await webContents.executeJavaScript(
        startVideoScript(
          this.options.requestedWidth,
          this.options.requestedHeight,
          mode,
          source.id,
          this.frameDeliveryMode,
        ),
        true,
      )
    } catch (error) {
      // Transport/render-process failures still reject across executeJavaScript;
      // generic startup failures are retried with the alternate capture mode.
      throw new CaptureBackendError(
        errorCode(error, "capture_stream_start_failed"),
        error,
      )
    }
    let videoInfo: CaptureVideoInfo
    if (isCaptureVideoResult(rawVideoResult)) {
      if (!rawVideoResult.ok) {
        const detail = rendererFailureDetail(rawVideoResult.error)
        throw new CaptureBackendError(
          rendererFailureCode(rawVideoResult.error),
          new Error(detail),
        )
      }
      videoInfo = rawVideoResult.info
    } else {
      // Backward compatibility for a renderer that was already alive while the
      // main process hot-reloaded during `pnpm dev`.
      videoInfo = rawVideoResult as CaptureVideoInfo
    }
    if (videoInfo.trackState !== "live") {
      throw new CaptureBackendError("capture_stream_video_track_not_live")
    }
    const outputSize = fitCaptureSize(
      videoInfo.width,
      videoInfo.height,
      this.options.requestedWidth,
      this.options.requestedHeight,
    )
    this.rendererFrameSerial = Number.isSafeInteger(videoInfo.frameSerial)
      ? Math.max(0, videoInfo.frameSerial)
      : 1
    this.expectedFrameSize = outputSize
    const startupProbe: CaptureRendererFrameRequest = {
      sourceRect: { x: 0, y: 0, width: outputSize.width, height: outputSize.height },
      outputWidth: Math.min(STARTUP_PROBE_WIDTH, outputSize.width),
      outputHeight: Math.min(STARTUP_PROBE_HEIGHT, outputSize.height),
    }
    const baselineSerial = this.paintSerial
    this.acceptPaint = true

    let initialPaint: CapturedPaint
    if (this.frameDeliveryMode === "paint") {
      captureWindow.setContentSize(outputSize.width, outputSize.height)
      this.captureSurfaceSize = { ...outputSize }
      this.captureStage = "waiting_first_paint"
      if (webContents.isOffscreen() && !webContents.isPainting()) {
        webContents.startPainting()
      }
      webContents.invalidate()
      try {
        initialPaint = await this.waitForFreshPaint(
          baselineSerial,
          OFFSCREEN_PAINT_BOOTSTRAP_TIMEOUT_MS,
        )
      } catch (error) {
        if (errorCode(error, "capture_frame_failed") !== "capture_frame_timeout") throw error
        this.frameDeliveryMode = "snapshot"
        this.captureStage = "waiting_first_snapshot"
        this.lastErrorDetail = [
          "offscreen paint event timed out; switched to capturePage",
          `paintEvents=${this.paintEventCount}`,
          `sizeMismatches=${this.paintSizeMismatchCount}`,
          this.lastPaintSize ? `lastPaint=${this.lastPaintSize}` : undefined,
        ].filter(Boolean).join(" | ")
        console.warn("[Recall minimap capture] offscreen paint stalled; using snapshot delivery", {
          mode,
          sourceId: source.id,
          sourceName: source.name,
          detail: this.lastErrorDetail,
        })
        initialPaint = await this.captureSnapshot(startupProbe)
      }
    } else {
      this.captureStage = "waiting_first_snapshot"
      initialPaint = await this.captureSnapshot(startupProbe)
    }

    this.validatePaint(initialPaint)
    this.lastDeliveredPaintSerial = initialPaint.serial
    this.captureStage = "capturing"
    if (this.frameDeliveryMode === "paint") this.lastErrorDetail = undefined
    this.health = this.withDiagnostics({
      state: "healthy",
      sourceId: source.id,
      sourceName: source.name,
      lastFrameAt: Date.now(),
    })
    if (process.env.NODE_ENV !== "test") {
      console.info("[Recall minimap capture] stream ready", {
        mode,
        frameDeliveryMode: this.frameDeliveryMode,
        sourceId: source.id,
        sourceName: source.name,
        size: `${outputSize.width}x${outputSize.height}`,
        rendererFrameSerial: this.rendererFrameSerial,
        paintEvents: this.paintEventCount,
        snapshots: this.snapshotCaptureCount,
      })
    }
  }

  private async captureNextFrame(request?: CaptureRendererFrameRequest) {
    // Region capture is snapshot-only: offscreen paint always delivers the
    // complete compositor surface and would forfeit the ROI optimization.
    if (request || this.frameDeliveryMode === "snapshot") {
      return this.captureSnapshot(request)
    }
    try {
      return await this.waitForFreshPaint(
        this.lastDeliveredPaintSerial,
        FRESH_FRAME_TIMEOUT_MS,
      )
    } catch (error) {
      if (errorCode(error, "capture_frame_failed") !== "capture_frame_timeout") throw error
      this.frameDeliveryMode = "snapshot"
      this.captureStage = "capturing_snapshot"
      this.lastErrorDetail = [
        "offscreen paint stopped; switched to capturePage",
        `paintEvents=${this.paintEventCount}`,
        `sizeMismatches=${this.paintSizeMismatchCount}`,
        this.lastPaintSize ? `lastPaint=${this.lastPaintSize}` : undefined,
      ].filter(Boolean).join(" | ")
      console.warn("[Recall minimap capture] offscreen paint stopped; using snapshot delivery", {
        captureMode: this.captureMode,
        sourceId: this.sourceId,
        sourceName: this.sourceName,
        detail: this.lastErrorDetail,
      })
      return this.captureSnapshot()
    }
  }

  private async refreshRendererCanvas(
    request?: CaptureRendererFrameRequest,
  ): Promise<CaptureRendererFrameResult> {
    const captureWindow = this.captureWindow
    if (!captureWindow || captureWindow.isDestroyed()) {
      throw new CaptureBackendError("capture_window_closed")
    }
    let result: unknown
    try {
      result = await captureWindow.webContents.executeJavaScript(
        refreshCanvasScript(request),
        true,
      )
    } catch (error) {
      throw new CaptureBackendError("capture_renderer_frame_request_failed", error)
    }
    if (typeof result !== "object" || result === null) {
      throw new CaptureBackendError("capture_renderer_frame_request_failed")
    }
    const frame = result as CaptureRendererFrameResult
    if (
      frame.drawn !== true ||
      !Number.isSafeInteger(frame.frameSerial) ||
      !Number.isSafeInteger(frame.width) ||
      !Number.isSafeInteger(frame.height) ||
      frame.width <= 0 ||
      frame.height <= 0
    ) {
      throw new CaptureBackendError("capture_renderer_frame_request_failed")
    }
    this.rendererFrameSerial = Math.max(this.rendererFrameSerial, frame.frameSerial)
    return frame
  }

  private async ensureCaptureSurfaceSize(size: { width: number; height: number }) {
    const captureWindow = this.captureWindow
    if (!captureWindow || captureWindow.isDestroyed()) {
      throw new CaptureBackendError("capture_window_closed")
    }
    if (this.captureSurfaceSize?.width === size.width &&
        this.captureSurfaceSize.height === size.height) return
    captureWindow.setContentSize(size.width, size.height)
    this.captureSurfaceSize = { ...size }
    captureWindow.webContents.invalidate()
    // setContentSize is synchronous at the Electron API boundary, but Chromium
    // applies the compositor-surface resize asynchronously. This wait occurs
    // only when switching between full calibration and the small minimap ROI.
    await waitForRetry(CAPTURE_SURFACE_RESIZE_SETTLE_MS)
  }

  private async captureSnapshot(
    request?: CaptureRendererFrameRequest,
  ): Promise<CapturedPaint> {
    if (this.streamTerminalErrorCode) {
      throw new CaptureBackendError(this.streamTerminalErrorCode)
    }
    const captureWindow = this.captureWindow
    const fullSize = this.expectedFrameSize
    if (!captureWindow || captureWindow.isDestroyed()) {
      throw new CaptureBackendError("capture_window_closed")
    }
    if (!fullSize) throw new CaptureBackendError("capture_frame_dimensions_invalid")

    let outputSize = request
      ? { width: request.outputWidth ?? 0, height: request.outputHeight ?? 0 }
      : fullSize
    await this.ensureCaptureSurfaceSize(outputSize)
    let rect = { x: 0, y: 0, ...outputSize }
    const captureOnce = async () => {
      try {
        return await promiseWithTimeout(
          captureWindow.capturePage(rect, {
            stayHidden: true,
            stayAwake: false,
          }),
          CAPTURE_PAGE_TIMEOUT_MS,
          "capture_page_timeout",
        )
      } catch (error) {
        const code = errorCode(error, "capture_page_failed")
        throw new CaptureBackendError(code, error)
      }
    }
    const snapshotUsable = (candidate: NativeImage) => {
      if (candidate.isEmpty()) return false
      const size = candidate.getSize()
      return Number.isSafeInteger(size.width) && Number.isSafeInteger(size.height) &&
        size.width > 0 && size.height > 0
    }

    let image: NativeImage | undefined
    let lastCaptureError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      // The first snapshot follows a resize; subsequent waits are only for a
      // transient empty/failed capture. Force the latest MediaStream pixels
      // into the canvas immediately before taking the page snapshot.
      if (this.snapshotCaptureCount === 0 || attempt > 0) {
        captureWindow.webContents.invalidate()
        await waitForRetry(SNAPSHOT_RETRY_DELAY_MS)
      }
      const renderedFrame = await this.refreshRendererCanvas(request)
      outputSize = { width: renderedFrame.width, height: renderedFrame.height }
      await this.ensureCaptureSurfaceSize(outputSize)
      rect = { x: 0, y: 0, ...outputSize }
      try {
        const candidate = await captureOnce()
        if (snapshotUsable(candidate)) {
          image = candidate
          break
        }
        lastCaptureError = new CaptureBackendError("capture_frame_empty")
      } catch (error) {
        lastCaptureError = error
      }
    }
    if (!image) {
      throw lastCaptureError instanceof Error
        ? lastCaptureError
        : new CaptureBackendError("capture_frame_empty")
    }

    const rawSize = image.getSize()
    this.lastPaintSize = `${rawSize.width}x${rawSize.height}`
    // capturePage can return physical-pixel dimensions on a scaled Windows
    // display even though setContentSize uses DIP. Normalize before strict
    // frame validation so 150%/200% display scaling cannot cause a false
    // capture_frame_dimensions_invalid failure.
    if (rawSize.width !== outputSize.width || rawSize.height !== outputSize.height) {
      image = image.resize({
        width: outputSize.width,
        height: outputSize.height,
        quality: "good",
      })
    }
    const paint = {
      image,
      serial: ++this.paintSerial,
      capturedMonotonicMs: performance.now(),
    }
    this.snapshotCaptureCount += 1
    this.latestPaint = paint
    return paint
  }

  private publishPaint(image: NativeImage) {
    if (this.streamTerminalErrorCode) return
    const expectedSize = this.expectedFrameSize
    const actualSize = image.getSize()
    this.paintEventCount += 1
    this.lastPaintSize = `${actualSize.width}x${actualSize.height}`
    if (!this.acceptPaint) return
    if (
      expectedSize &&
      (actualSize.width !== expectedSize.width || actualSize.height !== expectedSize.height)
    ) {
      this.paintSizeMismatchCount += 1
      return
    }
    const paint = {
      image,
      serial: ++this.paintSerial,
      capturedMonotonicMs: performance.now(),
    }
    this.latestPaint = paint
    for (const waiter of [...this.frameWaiters]) {
      if (paint.serial <= waiter.afterSerial) continue
      clearTimeout(waiter.timeout)
      this.frameWaiters.delete(waiter)
      waiter.resolve(paint)
    }
  }

  private waitForFreshPaint(afterSerial: number, timeoutMs: number) {
    if (this.streamTerminalErrorCode) {
      return Promise.reject(new CaptureBackendError(this.streamTerminalErrorCode))
    }
    if (this.latestPaint && this.latestPaint.serial > afterSerial) {
      return Promise.resolve(this.latestPaint)
    }
    return new Promise<CapturedPaint>((resolve, reject) => {
      const waiter: FrameWaiter = {
        afterSerial,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.frameWaiters.delete(waiter)
          reject(new CaptureBackendError("capture_frame_timeout"))
        }, timeoutMs),
      }
      this.frameWaiters.add(waiter)
    })
  }

  private frameFromPaint(paint: CapturedPaint): RgbaFrame {
    const bitmap = this.validatePaint(paint)
    const size = paint.image.getSize()
    return {
      width: size.width,
      height: size.height,
      data: bgraToRgba(bitmap),
      capturedMonotonicMs: paint.capturedMonotonicMs,
      frameSequence: ++this.sequence,
    }
  }

  private validatePaint(paint: CapturedPaint) {
    if (paint.image.isEmpty()) throw new CaptureBackendError("capture_frame_empty")
    const size = paint.image.getSize()
    const bitmap = paint.image.toBitmap()
    const validationError = capturedBitmapValidationError(
      size.width,
      size.height,
      bitmap.length,
    )
    if (validationError) throw new CaptureBackendError(validationError)
    return bitmap
  }

  private rejectFrameWaiters(code: string) {
    for (const waiter of this.frameWaiters) {
      clearTimeout(waiter.timeout)
      waiter.reject(new CaptureBackendError(code))
    }
    this.frameWaiters.clear()
  }

  private markStreamTerminal(code: string) {
    this.streamTerminalErrorCode = code
    this.rejectFrameWaiters(code)
  }

  private async destroyCaptureWindow(waiterCode: string) {
    const captureWindow = this.captureWindow
    this.captureWindow = undefined
    this.acceptPaint = false
    this.expectedFrameSize = undefined
    this.captureSurfaceSize = undefined
    this.streamTerminalErrorCode = undefined
    this.latestPaint = undefined
    this.nextSourceValidationAt = 0
    this.captureGeneration += 1
    this.rejectFrameWaiters(waiterCode)
    if (!captureWindow || captureWindow.isDestroyed()) return
    const webContents = captureWindow.webContents
    try {
      await webContents.executeJavaScript(STOP_VIDEO_SCRIPT, true)
    } catch {
      // A missing renderer is already equivalent to a stopped capture stream.
    }
    webContents.session.setPermissionCheckHandler(null)
    webContents.session.setPermissionRequestHandler(null)
    webContents.session.setDisplayMediaRequestHandler(null)
    if (webContents.session.protocol.isProtocolHandled("https")) {
      webContents.session.protocol.unhandle("https")
    }
    if (!captureWindow.isDestroyed()) captureWindow.destroy()
  }

  private setFailure(code: string, nextRetryAt = this.startFailure?.retryAt) {
    const state = code === "league_game_window_not_found" ||
        code.startsWith("capture_stream_") ||
        code === "capture_frame_timeout" ||
        code === "capture_window_closed"
      ? "unavailable"
      : "failed"
    this.health = this.withDiagnostics({
      state,
      sourceId: this.sourceId,
      sourceName: this.sourceName,
      lastErrorCode: code,
      nextRetryAt,
    })
  }

  private recordSourceScan(sources: readonly CaptureSourceIdentity[]) {
    this.lastSourceScanAt = Date.now()
    this.discoveredWindowCount = sources.length
    const allowed = sources.filter((source) =>
      isAllowedGameWindow(source, this.options.sourceNamePattern))
    this.candidateSourceCount = allowed.length
    this.candidateSourceNames = sources
      .filter((source) => /league|riot/i.test(source.name))
      .map((source) => normalizeLeagueWindowTitle(source.name))
      .filter((name, index, entries) => Boolean(name) && entries.indexOf(name) === index)
      .slice(0, 8)
  }

  private withDiagnostics(health: CaptureBackendHealth): CaptureBackendHealth {
    return {
      ...health,
      discoveredWindowCount: this.discoveredWindowCount,
      candidateSourceCount: this.candidateSourceCount,
      candidateSourceNames: [...this.candidateSourceNames],
      sourceDiscoveryAttempts: this.sourceDiscoveryAttempts,
      lastSourceScanAt: this.lastSourceScanAt,
      captureMode: this.captureMode,
      captureStage: this.captureStage,
      frameDeliveryMode: this.frameDeliveryMode,
      paintEventCount: this.paintEventCount,
      paintSizeMismatchCount: this.paintSizeMismatchCount,
      snapshotCaptureCount: this.snapshotCaptureCount,
      lastPaintSize: this.lastPaintSize,
      rendererFrameSerial: this.rendererFrameSerial,
      lastErrorDetail: this.lastErrorDetail,
    }
  }
}
