import { randomUUID } from "node:crypto"
import { BrowserWindow, desktopCapturer } from "electron"
import type { DesktopCapturerSource, NativeImage } from "electron"
import type { RgbaFrame } from "../../../src/shared/minimap/contracts.js"
import type {
  CaptureBackendHealth,
  CaptureStartInput,
  MinimapCaptureBackend,
} from "./capture-backend.js"

const DEFAULT_CAPTURE_WIDTH = 2560
const DEFAULT_CAPTURE_HEIGHT = 1440
const MIN_CAPTURE_WIDTH = 320
const MIN_CAPTURE_HEIGHT = 180
const MAX_CAPTURE_WIDTH = 4096
const MAX_CAPTURE_HEIGHT = 2160
const STREAM_START_TIMEOUT_MS = 5_000
const FRESH_FRAME_TIMEOUT_MS = 1_500
const SOURCE_REVALIDATION_INTERVAL_MS = 2_000
const CAPTURE_FRAME_RATE = 12
// A WGC start can fail while the game HWND is being recreated (for example
// when the client changes from the loading window to the in-game window).  A
// single retry is enough to pick up the new HWND; more retries just create a
// storm of short-lived Chromium capture sessions.
const MAX_STREAM_START_ATTEMPTS = 2
const STREAM_START_RETRY_DELAY_MS = 100
const STREAM_START_FAILURE_COOLDOWN_MS = 5_000

const GAME_WINDOW_PATTERNS = [
  /^League of Legends \(TM\) Client$/i,
  /^League of Legends$/i,
  /^League of Legends\s*[-—:]\s*.+$/i,
]
const NON_GAME_WINDOW_PATTERN = /LeagueClientUx|LeagueClient(?:\.exe)?|Riot Client|Recall/i

const CAPTURE_PAGE_URL = "https://recall-capture.invalid/"
const CAPTURE_PAGE_ORIGIN = new URL(CAPTURE_PAGE_URL).origin
const CAPTURE_PAGE_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src blob:; style-src 'unsafe-inline'">
    <title>Recall minimap capture</title>
    <style>
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #000; }
      video { display: block; width: 100vw; height: 100vh; object-fit: fill; }
    </style>
  </head>
  <body><video id="capture" autoplay muted playsinline></video></body>
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

interface CaptureVideoInfo {
  width: number
  height: number
  trackState: string
}

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

function isDisplayCapturePermission(permission: string) {
  // Electron documents this runtime permission even though older bundled
  // PermissionType declarations omit it from setPermissionCheckHandler.
  return permission === "display-capture"
}

function isVideoOnlyMediaPermission(details: unknown) {
  const mediaTypes = (details as { mediaTypes?: unknown }).mediaTypes
  return Array.isArray(mediaTypes) && mediaTypes.length === 1 && mediaTypes[0] === "video"
}

function isCaptureOrigin(value?: string) {
  if (!value) return false
  try {
    return new URL(value).origin === CAPTURE_PAGE_ORIGIN
  } catch {
    return false
  }
}

function isWindowSource(source: CaptureSourceIdentity) {
  return source.id.startsWith("window:")
}

function isAllowedGameWindow(source: CaptureSourceIdentity, customPattern?: RegExp) {
  if (!isWindowSource(source) || NON_GAME_WINDOW_PATTERN.test(source.name)) return false
  if (customPattern) return regexMatches(customPattern, source.name)
  return GAME_WINDOW_PATTERNS.some((pattern) => pattern.test(source.name))
}

function leagueGameSourceScore(name: string) {
  if (/^League of Legends \(TM\) Client$/i.test(name)) return 300
  if (/^League of Legends$/i.test(name)) return 200
  if (/^League of Legends\s*[-—:]\s*.+$/i.test(name)) return 100
  return 0
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

function bgraToRgba(bitmap: Buffer) {
  const result = new Uint8Array(bitmap.length)
  for (let offset = 0; offset < bitmap.length; offset += 4) {
    result[offset] = bitmap[offset + 2]
    result[offset + 1] = bitmap[offset + 1]
    result[offset + 2] = bitmap[offset]
    result[offset + 3] = bitmap[offset + 3]
  }
  return result
}

function errorCode(error: unknown, fallback: string) {
  if (error instanceof CaptureBackendError) return error.code
  const messages: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    messages.push(current instanceof Error ? current.message : String(current))
    current = current instanceof Error
      ? (current as Error & { cause?: unknown }).cause
      : undefined
  }
  const message = messages.join(" ")
  // Prefer the native HRESULT over a generic wrapper message such as
  // "capture_stream_start_failed". Electron often prefixes executeJavaScript
  // failures with its own stage name while retaining the WGC HRESULT later in
  // the cause/message.
  if (/-2147024809|0x80070057|E_INVALIDARG/i.test(message)) {
    return "capture_stream_start_e_invalidarg"
  }
  if (/NotReadableError|Could not start video source/i.test(message)) {
    return "capture_stream_not_readable"
  }
  if (/NotAllowedError|Permission denied/i.test(message)) {
    return "capture_stream_permission_denied"
  }
  if (/NotFoundError|Requested device not found/i.test(message)) {
    return "league_game_window_not_found"
  }
  const embeddedCode = message.match(/\b(?:capture|league)_[a-z0-9_]+\b/i)?.[0]
  if (embeddedCode) return embeddedCode.toLocaleLowerCase()
  return fallback
}

function isRetryableStreamStartCode(code: string) {
  return code === "capture_stream_start_e_invalidarg" ||
    code === "capture_stream_not_readable" ||
    code === "capture_stream_video_track_not_live" ||
    code === "capture_stream_metadata_timeout"
}

function waitForRetry(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

function startVideoScript(maximumWidth: number, maximumHeight: number, sourceId?: string) {
  const usingLegacySource = sourceId !== undefined
  const acquisition = usingLegacySource
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
    const video = document.getElementById("capture")
    if (!globalThis.isSecureContext) throw new Error("capture_insecure_context")
    if (!(video instanceof HTMLVideoElement) || !navigator.mediaDevices?.${usingLegacySource ? "getUserMedia" : "getDisplayMedia"}) {
      throw new Error("capture_media_devices_unavailable")
    }
    const stream = await ${acquisition}
    const track = stream.getVideoTracks()[0]
    if (!track) {
      stream.getTracks().forEach((entry) => entry.stop())
      throw new Error("capture_stream_video_track_missing")
    }
    globalThis.__recallCaptureStream = stream
    video.srcObject = stream
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
    await video.play()
    await new Promise((resolve) => {
      if (typeof video.requestVideoFrameCallback === "function") {
        const timeout = setTimeout(resolve, ${STREAM_START_TIMEOUT_MS})
        video.requestVideoFrameCallback(() => {
          clearTimeout(timeout)
          resolve(undefined)
        })
      } else {
        setTimeout(resolve, 100)
      }
    })
    track.addEventListener("ended", () => { document.title = "Recall minimap capture ended" })
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      trackState: track.readyState
    }
  })()`
}

const STOP_VIDEO_SCRIPT = `(() => {
  const stream = globalThis.__recallCaptureStream
  if (stream) stream.getTracks().forEach((track) => track.stop())
  globalThis.__recallCaptureStream = undefined
  const video = document.getElementById("capture")
  if (video instanceof HTMLVideoElement) video.srcObject = null
})()`

/**
 * Captures one explicitly selected League game window through a persistent
 * MediaStream rendered in an offscreen Electron window. desktopCapturer is used
 * only for bounded, tiny-thumbnail HWND discovery; telemetry frames consume
 * the persistent stream for the one selected game window.
 */
export class ElectronDesktopCaptureBackend implements MinimapCaptureBackend {
  readonly id = "electron_desktop_capture" as const
  private readonly captureSessionPartition =
    `recall-minimap-capture-${randomUUID()}`
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
    this.health = { state: "starting" }
    const task = this.startWithBoundedRetry()
    this.startInFlight = task
    try {
      await task
    } finally {
      if (this.startInFlight === task) this.startInFlight = undefined
    }
  }

  async captureFrame(): Promise<RgbaFrame> {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (!this.captureWindow || !this.sourceId) await this.acquireCaptureStream()
        await this.validateSourceHandle()
        const paint = await this.waitForFreshPaint(
          this.lastDeliveredPaintSerial,
          FRESH_FRAME_TIMEOUT_MS,
        )
        const frame = this.frameFromPaint(paint)
        this.lastDeliveredPaintSerial = paint.serial
        this.health = {
          state: "healthy",
          sourceId: this.sourceId,
          sourceName: this.sourceName,
          lastFrameAt: Date.now(),
        }
        return frame
      } catch (error) {
        lastError = error
        if (attempt === 0) {
          const code = errorCode(error, "capture_frame_failed")
          this.health = {
            state: "starting",
            sourceId: this.sourceId,
            sourceName: this.sourceName,
            lastErrorCode: code,
          }
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
    this.health = { state: "idle" }
  }

  private async startWithBoundedRetry() {
    let lastError: unknown
    let mode: "display" | "legacy" = "display"
    for (let attempt = 0; attempt < MAX_STREAM_START_ATTEMPTS; attempt += 1) {
      try {
        await this.acquireCaptureStream(mode)
        this.startFailure = undefined
        return
      } catch (error) {
        lastError = error
        const code = errorCode(error, "capture_stream_start_failed")
        if (attempt + 1 >= MAX_STREAM_START_ATTEMPTS || !isRetryableStreamStartCode(code)) {
          this.startFailure = {
            code,
            retryAt: Date.now() + STREAM_START_FAILURE_COOLDOWN_MS,
          }
          this.setFailure(code)
          throw new CaptureBackendError(code, error)
        }
        if (code === "capture_stream_start_e_invalidarg") mode = "legacy"
        await waitForRetry(STREAM_START_RETRY_DELAY_MS)
      }
    }
    const code = errorCode(lastError, "capture_stream_start_failed")
    this.startFailure = {
      code,
      retryAt: Date.now() + STREAM_START_FAILURE_COOLDOWN_MS,
    }
    this.setFailure(code)
    throw new CaptureBackendError(code, lastError)
  }

  getHealth() {
    return { ...this.health }
  }

  private async acquireCaptureStream(mode: "display" | "legacy" = "display") {
    await this.destroyCaptureWindow("capture_stream_restarting")
    this.sourceId = undefined
    this.sourceName = undefined
    const source = await this.resolveSource()
    this.sourceId = source.id
    this.sourceName = source.name
    this.health = {
      state: "starting",
      sourceId: source.id,
      sourceName: source.name,
    }
    try {
      await this.startSelectedStream(source, mode)
      this.nextSourceValidationAt = Date.now() + SOURCE_REVALIDATION_INTERVAL_MS
    } catch (error) {
      await this.destroyCaptureWindow("capture_stream_start_failed")
      const code = errorCode(error, "capture_stream_start_failed")
      throw new CaptureBackendError(code, error)
    }
  }

  private async resolveSource() {
    const sources = await this.enumerateWindowSources()
    const source = selectLeagueGameWindowSource(
      sources,
      this.options.preferredSourceId,
      this.options.sourceNamePattern,
    )
    if (!source) throw new CaptureBackendError("league_game_window_not_found")
    return source
  }

  private async enumerateWindowSources() {
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
    const source = sources.find((entry) => entry.id === sourceId)
    if (!source || !isAllowedGameWindow(source, this.options.sourceNamePattern)) {
      throw new CaptureBackendError("capture_source_handle_changed")
    }
  }

  private async startSelectedStream(
    source: DesktopCapturerSource,
    mode: "display" | "legacy" = "display",
  ) {
    const generation = this.captureGeneration
    const captureWindow = new BrowserWindow({
      show: false,
      frame: false,
      focusable: false,
      skipTaskbar: true,
      paintWhenInitiallyHidden: true,
      width: MIN_CAPTURE_WIDTH,
      height: MIN_CAPTURE_HEIGHT,
      webPreferences: {
        offscreen: { useSharedTexture: false, deviceScaleFactor: 1 },
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: this.captureSessionPartition,
      },
    })
    this.captureWindow = captureWindow
    this.acceptPaint = false
    this.streamTerminalErrorCode = undefined
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
          "cache-control": "no-store",
        },
      },
    ))
    captureSession.setPermissionCheckHandler((requestingContents, permission, origin, details) => {
      const trustedContents = requestingContents?.id === webContents.id
      const trustedOrigin = isCaptureOrigin(origin) ||
        isCaptureOrigin(details.securityOrigin) ||
        isCaptureOrigin(details.requestingUrl)
      if (!trustedContents || !trustedOrigin) return false
      if (isDisplayCapturePermission(permission)) return true
      return permission === "media" && details.mediaType === "video"
    })
    captureSession.setPermissionRequestHandler((requestingContents, permission, callback, details) => {
      const trustedContents = requestingContents.id === webContents.id
      const trustedOrigin = isCaptureOrigin("securityOrigin" in details ? details.securityOrigin : undefined) ||
        isCaptureOrigin(details.requestingUrl)
      callback(
        trustedContents && trustedOrigin && (
          permission === "display-capture" ||
          permission === "media" && isVideoOnlyMediaPermission(details)
        ),
      )
    })
    captureSession.setDisplayMediaRequestHandler((request, callback) => {
      const allowed = generation === this.captureGeneration &&
        this.captureWindow === captureWindow &&
        request.videoRequested &&
        !request.audioRequested &&
        isCaptureOrigin(request.securityOrigin)
      callback(allowed ? { video: source } : {})
    })
    webContents.setFrameRate(CAPTURE_FRAME_RATE)
    webContents.on("paint", (_event, _dirtyRect, image) => {
      if (
        generation !== this.captureGeneration ||
        this.captureWindow !== captureWindow ||
        !this.acceptPaint
      ) return
      this.publishPaint(image)
    })
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

    await captureWindow.loadURL(CAPTURE_PAGE_URL)
    const videoInfo = await webContents.executeJavaScript(
      startVideoScript(
        this.options.requestedWidth,
        this.options.requestedHeight,
        mode === "legacy" ? source.id : undefined,
      ),
      true,
    ) as CaptureVideoInfo
    if (videoInfo.trackState !== "live") {
      throw new CaptureBackendError("capture_stream_video_track_not_live")
    }
    const outputSize = fitCaptureSize(
      videoInfo.width,
      videoInfo.height,
      this.options.requestedWidth,
      this.options.requestedHeight,
    )
    captureWindow.setContentSize(outputSize.width, outputSize.height)
    this.expectedFrameSize = outputSize
    const baselineSerial = this.paintSerial
    this.acceptPaint = true
    webContents.invalidate()
    const initialPaint = await this.waitForFreshPaint(baselineSerial, STREAM_START_TIMEOUT_MS)
    this.validatePaint(initialPaint)
    this.health = {
      state: "healthy",
      sourceId: source.id,
      sourceName: source.name,
      lastFrameAt: Date.now(),
    }
  }

  private publishPaint(image: NativeImage) {
    if (this.streamTerminalErrorCode) return
    const expectedSize = this.expectedFrameSize
    const actualSize = image.getSize()
    if (
      expectedSize &&
      (actualSize.width !== expectedSize.width || actualSize.height !== expectedSize.height)
    ) return
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

  private setFailure(code: string) {
    const state = code === "league_game_window_not_found" ||
        code.startsWith("capture_stream_") ||
        code === "capture_frame_timeout" ||
        code === "capture_window_closed"
      ? "unavailable"
      : "failed"
    this.health = {
      state,
      sourceId: this.sourceId,
      sourceName: this.sourceName,
      lastErrorCode: code,
    }
  }
}
