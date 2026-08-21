import { beforeEach, describe, expect, it, vi } from "vitest"

const electronMocks = vi.hoisted(() => {
  const getSources = vi.fn()
  const executeJavaScriptFailures: unknown[] = []
  const executeJavaScriptResults: unknown[] = []
  const capturePageFailures: unknown[] = []
  const capturePageSizes: Array<{ width: number; height: number }> = []
  const suppressPaint = { value: false }
  const windows: FakeBrowserWindow[] = []

  interface FakeNativeImage {
    isEmpty: () => boolean
    getSize: () => { width: number; height: number }
    toBitmap: () => Buffer
    resize: (size: { width: number; height: number }) => FakeNativeImage
  }

  class FakeSession {
    permissionCheckHandler: unknown
    permissionRequestHandler: unknown
    displayMediaRequestHandler: unknown
    readonly protocol = {
      handled: false,
      handler: undefined as unknown,
      isProtocolHandled: () => this.protocol.handled,
      handle: (_scheme: string, handler: unknown) => {
        this.protocol.handled = true
        this.protocol.handler = handler
      },
      unhandle: () => {
        this.protocol.handled = false
        this.protocol.handler = undefined
      },
    }

    setPermissionCheckHandler(handler: unknown) {
      this.permissionCheckHandler = handler
    }

    setPermissionRequestHandler(handler: unknown) {
      this.permissionRequestHandler = handler
    }

    setDisplayMediaRequestHandler(handler: unknown) {
      this.displayMediaRequestHandler = handler
    }
  }

  class FakeWebContents {
    readonly id = windows.length + 1
    readonly session = new FakeSession()
    readonly executedScripts: string[] = []
    rendererFrameSerial = 1
    private readonly listeners = new Map<string, Array<(...args: never[]) => void>>()

    constructor(private readonly owner: FakeBrowserWindow) {}

    private painting = true

    setFrameRate() {}

    isOffscreen() {
      return Boolean((this.owner.options as {
        webPreferences?: { offscreen?: unknown }
      }).webPreferences?.offscreen)
    }

    isPainting() {
      return this.painting
    }

    startPainting() {
      this.painting = true
    }

    on(event: string, listener: (...args: never[]) => void) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    }

    executeJavaScript(script: string) {
      this.executedScripts.push(script)
      if (script.includes("getDisplayMedia") || script.includes("getUserMedia")) {
        const failure = executeJavaScriptFailures.shift()
        if (failure !== undefined) return Promise.reject(failure)
        const queuedResult = executeJavaScriptResults.shift()
        if (queuedResult !== undefined) return Promise.resolve(queuedResult)
        const mode = script.includes('chromeMediaSourceId') ? "legacy" : "display"
        const permission = mode === "legacy" ? "media" : "display-capture"
        const permissionDetails = mode === "legacy" ? { mediaType: "unknown" } : {}
        const permissionCheck = this.session.permissionCheckHandler as undefined | ((
          requestingContents: FakeWebContents | null,
          permission: string,
          requestingOrigin: string,
          details: { mediaType?: string },
        ) => boolean)
        const checkAllowed = permissionCheck?.(null, permission, "", permissionDetails) ?? true
        let requestAllowed = true
        const permissionRequest = this.session.permissionRequestHandler as undefined | ((
          requestingContents: FakeWebContents,
          permission: string,
          callback: (allowed: boolean) => void,
          details: { mediaTypes?: string[] },
        ) => void)
        permissionRequest?.(this, permission, (allowed) => { requestAllowed = allowed }, {})
        let selectedDisplaySource = mode === "legacy"
        if (mode === "display") {
          const displayRequest = this.session.displayMediaRequestHandler as undefined | ((
            request: { videoRequested: boolean; audioRequested: boolean; securityOrigin: string },
            callback: (streams: { video?: unknown }) => void,
          ) => void)
          displayRequest?.(
            { videoRequested: true, audioRequested: false, securityOrigin: "" },
            (streams) => { selectedDisplaySource = Boolean(streams.video) },
          )
        }
        if (!checkAllowed || !requestAllowed || !selectedDisplaySource) {
          return Promise.resolve({
            ok: false,
            error: {
              name: "NotAllowedError",
              message: "Permission denied",
              stage: "requesting_stream",
              diagnostics: {
                mode,
                secureContext: true,
                href: "https://recall-capture.invalid/",
                mediaDevicesAvailable: true,
                getUserMediaAvailable: true,
                getDisplayMediaAvailable: true,
              },
            },
          })
        }
        return Promise.resolve({
          ok: true,
          info: {
            width: 640,
            height: 360,
            trackState: "live",
            frameSerial: this.rendererFrameSerial,
          },
          diagnostics: {
            mode,
            secureContext: true,
            href: "https://recall-capture.invalid/",
            mediaDevicesAvailable: true,
            getUserMediaAvailable: true,
            getDisplayMediaAvailable: true,
          },
        })
      }
      if (script.includes("const drawFrame = globalThis.__recallCaptureDrawFrame")) {
        this.rendererFrameSerial += 1
        const outputWidth = Number(script.match(/"outputWidth":(\d+)/)?.[1] ??
          this.owner.contentSize.width)
        const outputHeight = Number(script.match(/"outputHeight":(\d+)/)?.[1] ??
          this.owner.contentSize.height)
        return Promise.resolve({
          drawn: true,
          frameSerial: this.rendererFrameSerial,
          width: outputWidth,
          height: outputHeight,
        })
      }
      return Promise.resolve(undefined)
    }

    invalidate() {
      if (suppressPaint.value) return
      const image = this.owner.createImage(this.owner.contentSize.width, this.owner.contentSize.height)
      for (const listener of this.listeners.get("paint") ?? []) {
        listener(undefined as never, {} as never, image as never)
      }
    }
  }

  class FakeBrowserWindow {
    readonly webContents: FakeWebContents
    readonly listeners = new Map<string, Array<(...args: never[]) => void>>()
    contentSize = { width: 320, height: 180 }
    destroyed = false
    capturePageCalls = 0
    loaded?: { url: string; options: unknown }

    constructor(readonly options: unknown) {
      this.webContents = new FakeWebContents(this)
      windows.push(this)
    }

    on(event: string, listener: (...args: never[]) => void) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    }

    emit(event: string, ...args: never[]) {
      for (const listener of this.listeners.get(event) ?? []) listener(...args)
    }

    loadURL(url: string, options?: unknown) {
      this.loaded = { url, options }
      return Promise.resolve()
    }

    setContentSize(width: number, height: number) {
      this.contentSize = { width, height }
    }

    createImage(width: number, height: number): FakeNativeImage {
      return {
        isEmpty: () => false,
        getSize: () => ({ width, height }),
        toBitmap: () => Buffer.alloc(width * height * 4),
        resize: (size: { width: number; height: number }) =>
          this.createImage(size.width, size.height),
      }
    }

    capturePage(rect?: { width: number; height: number }) {
      this.capturePageCalls += 1
      const failure = capturePageFailures.shift()
      if (failure !== undefined) return Promise.reject(failure)
      const queuedSize = capturePageSizes.shift()
      return Promise.resolve(this.createImage(
        queuedSize?.width ?? rect?.width ?? this.contentSize.width,
        queuedSize?.height ?? rect?.height ?? this.contentSize.height,
      ))
    }

    isDestroyed() {
      return this.destroyed
    }

    destroy() {
      this.destroyed = true
      this.emit("closed")
    }
  }

  return {
    FakeBrowserWindow,
    capturePageFailures,
    capturePageSizes,
    executeJavaScriptFailures,
    executeJavaScriptResults,
    getSources,
    suppressPaint,
    windows,
  }
})

vi.mock("electron", () => ({
  BrowserWindow: electronMocks.FakeBrowserWindow,
  desktopCapturer: { getSources: electronMocks.getSources },
}))

import {
  capturedBitmapValidationError,
  captureModeOrder,
  ElectronDesktopCaptureBackend,
  fitCaptureSize,
  normalizeLeagueWindowTitle,
  preferredFrameDeliveryMode,
  selectLeagueGameWindowSource,
  shouldGrantCaptureSessionPermission,
} from "../electron/main/minimap/electron-desktop-capture-backend.js"

beforeEach(() => {
  electronMocks.getSources.mockReset()
  electronMocks.capturePageFailures.splice(0)
  electronMocks.capturePageSizes.splice(0)
  electronMocks.executeJavaScriptFailures.splice(0)
  electronMocks.executeJavaScriptResults.splice(0)
  electronMocks.suppressPaint.value = false
  electronMocks.windows.splice(0)
})

describe("ElectronDesktopCaptureBackend source policy", () => {
  it("selects the real game HWND and never a client or screen fallback", () => {
    const sources = [
      { id: "screen:0:0", name: "League of Legends" },
      { id: "window:10:0", name: "LeagueClientUx" },
      { id: "window:11:0", name: "League of Legends" },
      { id: "window:12:0", name: "League of Legends (TM) Client" },
    ]

    expect(selectLeagueGameWindowSource(sources, "window:10:0")).toEqual(
      sources[3],
    )
  })

  it("honors a preferred ID only when it still identifies an eligible game window", () => {
    const sources = [
      { id: "window:20:0", name: "League of Legends" },
      { id: "window:21:0", name: "League of Legends (TM) Client" },
    ]

    expect(selectLeagueGameWindowSource(sources, "window:20:0")).toEqual(
      sources[0],
    )
    expect(selectLeagueGameWindowSource(sources, "window:999:0")).toEqual(
      sources[1],
    )
  })

  it("supports a custom localized game-title pattern without admitting known clients", () => {
    const pattern = /Partida de League \d+/gi
    const sources = [
      { id: "window:30:0", name: "LeagueClientUx - Partida de League 1" },
      { id: "window:31:0", name: "Partida de League 1" },
    ]

    expect(selectLeagueGameWindowSource(sources, undefined, pattern)).toEqual(
      sources[1],
    )
    // Global regex state must not make later reacquisition nondeterministic.
    expect(selectLeagueGameWindowSource(sources, undefined, pattern)).toEqual(
      sources[1],
    )
  })

  it("returns no source instead of silently falling back", () => {
    expect(selectLeagueGameWindowSource([
      { id: "window:40:0", name: "LeagueClientUx" },
      { id: "screen:0:0", name: "Entire Screen" },
    ])).toBeUndefined()
  })

  it("normalizes trademark, NUL, whitespace, and current suffixed game titles", () => {
    expect(normalizeLeagueWindowTitle("  League of Legends™ Client\u0000  "))
      .toBe("League of Legends(TM) Client")
    const source = {
      id: "window:41:0",
      name: "League of Legends (TM) Client - Summoner's Rift",
    }
    expect(selectLeagueGameWindowSource([source])).toEqual(source)
  })
})

describe("ElectronDesktopCaptureBackend frame bounds", () => {
  it("preserves ultrawide source geometry inside bounded capture dimensions", () => {
    expect(fitCaptureSize(7680, 2880, 2560, 1440)).toEqual({
      width: 2560,
      height: 960,
    })
  })

  it("does not upscale smaller sources and keeps native-video dimensions even", () => {
    expect(fitCaptureSize(1919, 1079, 2560, 1440)).toEqual({
      width: 1918,
      height: 1078,
    })
  })

  it("rejects empty, implausible, and truncated native bitmaps", () => {
    expect(capturedBitmapValidationError(0, 0, 0))
      .toBe("capture_frame_dimensions_invalid")
    expect(capturedBitmapValidationError(2560, 1440, 100))
      .toBe("capture_frame_bitmap_invalid")
    expect(capturedBitmapValidationError(2560, 1440, 2560 * 1440 * 4))
      .toBeUndefined()
  })
})

describe("capture-session permission policy", () => {
  it("accepts incomplete Electron desktop-video metadata but rejects explicit audio-only access", () => {
    expect(shouldGrantCaptureSessionPermission("display-capture")).toBe(true)
    expect(shouldGrantCaptureSessionPermission("media")).toBe(true)
    expect(shouldGrantCaptureSessionPermission("media", { mediaType: "unknown" })).toBe(true)
    expect(shouldGrantCaptureSessionPermission("media", { mediaTypes: ["video"] })).toBe(true)
    expect(shouldGrantCaptureSessionPermission("media", { mediaType: "audio" })).toBe(false)
    expect(shouldGrantCaptureSessionPermission("media", { mediaTypes: ["audio"] })).toBe(false)
    expect(shouldGrantCaptureSessionPermission("geolocation")).toBe(false)
  })
})

describe("ElectronDesktopCaptureBackend persistent stream", () => {
  it("prefers the deterministic source-id path on Windows and retains a display fallback", () => {
    expect(captureModeOrder("win32")).toEqual(["legacy", "display"])
    expect(captureModeOrder("linux")).toEqual(["display", "legacy"])
    expect(captureModeOrder("darwin")).toEqual(["display", "legacy"])
  })

  it("uses snapshot frame delivery on Windows instead of depending on offscreen paint", () => {
    expect(preferredFrameDeliveryMode("win32")).toBe("snapshot")
    expect(preferredFrameDeliveryMode("linux")).toBe("paint")
    expect(preferredFrameDeliveryMode("darwin")).toBe("paint")
  })

  it("captures Windows frames through capturePage when no paint event is emitted", async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" })
    electronMocks.suppressPaint.value = true
    const source = { id: "window:48:0", name: "League of Legends (TM) Client" }
    electronMocks.getSources.mockResolvedValue([source])
    const backend = new ElectronDesktopCaptureBackend()

    try {
      await backend.start()
      const captureWindow = electronMocks.windows[0]
      expect((captureWindow.options as {
        webPreferences: { offscreen?: unknown }
      }).webPreferences.offscreen).toBeUndefined()
      expect(captureWindow.capturePageCalls).toBe(1)
      expect(backend.getHealth()).toMatchObject({
        state: "healthy",
        frameDeliveryMode: "snapshot",
        snapshotCaptureCount: 1,
        paintEventCount: 0,
      })

      const frame = await backend.captureFrame()
      expect(frame).toMatchObject({ width: 640, height: 360, frameSequence: 1 })
      expect(captureWindow.capturePageCalls).toBe(2)
      expect(backend.getHealth()).toMatchObject({
        state: "healthy",
        frameDeliveryMode: "snapshot",
        snapshotCaptureCount: 2,
      })
    } finally {
      await backend.stop()
      if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor)
    }
  })

  it("reads back only the calibrated minimap ROI after startup", async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" })
    const source = { id: "window:45:0", name: "League of Legends (TM) Client" }
    electronMocks.getSources.mockResolvedValue([source])
    const backend = new ElectronDesktopCaptureBackend()

    try {
      await backend.start()
      const captureWindow = electronMocks.windows[0]
      const frame = await backend.captureRegion({
        sourceRect: { x: 300, y: 20, width: 320, height: 320 },
        outputWidth: 320,
        outputHeight: 320,
      })

      expect(frame).toMatchObject({ width: 320, height: 320, frameSequence: 1 })
      expect(captureWindow.capturePageCalls).toBe(2)
      const refreshScript = captureWindow.webContents.executedScripts.at(-1)
      expect(() => new Function(`return ${refreshScript}`)).not.toThrow()
      expect(refreshScript).toContain('"sourceRect":{"x":300,"y":20,"width":320,"height":320}')
      expect(refreshScript).toContain('"outputWidth":320')
      expect(refreshScript).toContain("previousWidth")
      expect(refreshScript).toContain("requestAnimationFrame")
      expect(backend.getHealth()).toMatchObject({
        state: "healthy",
        lastPaintSize: "320x320",
        snapshotCaptureCount: 2,
      })
    } finally {
      await backend.stop()
      if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor)
    }
  })

  it("normalizes capturePage physical pixels on high-DPI Windows displays", async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" })
    const source = { id: "window:46:0", name: "League of Legends (TM) Client" }
    electronMocks.getSources.mockResolvedValue([source])
    electronMocks.capturePageSizes.push({ width: 1280, height: 720 })
    const backend = new ElectronDesktopCaptureBackend()

    try {
      await backend.start()
      expect(backend.getHealth()).toMatchObject({
        state: "healthy",
        frameDeliveryMode: "snapshot",
        lastPaintSize: "1280x720",
      })
      const frame = await backend.captureFrame()
      expect(frame).toMatchObject({ width: 640, height: 360 })
    } finally {
      await backend.stop()
      if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor)
    }
  })

  it("retries one transient hidden-page snapshot failure without replacing the League stream", async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" })
    const source = { id: "window:47:0", name: "League of Legends (TM) Client" }
    electronMocks.getSources.mockResolvedValue([source])
    electronMocks.capturePageFailures.push(new Error("transient capturePage failure"))
    const backend = new ElectronDesktopCaptureBackend()

    try {
      await backend.start()
      expect(electronMocks.windows).toHaveLength(1)
      expect(electronMocks.windows[0].capturePageCalls).toBe(2)
      expect(backend.getHealth()).toMatchObject({
        state: "healthy",
        frameDeliveryMode: "snapshot",
        snapshotCaptureCount: 1,
      })
    } finally {
      await backend.stop()
      if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor)
    }
  })

  it("isolates each backend in a unique non-persistent Electron session", async () => {
    const source = { id: "window:49:0", name: "League of Legends (TM) Client" }
    electronMocks.getSources.mockResolvedValue([source])
    const first = new ElectronDesktopCaptureBackend()
    const second = new ElectronDesktopCaptureBackend()

    try {
      await first.start()
      await second.start()

      const partitions = electronMocks.windows.map((captureWindow) =>
        (captureWindow.options as {
          webPreferences: { partition: string }
        }).webPreferences.partition,
      )
      expect(partitions).toHaveLength(2)
      expect(partitions[0]).toMatch(/^recall-minimap-capture-/)
      expect(partitions[0]).not.toMatch(/^persist:/)
      expect(partitions[1]).not.toBe(partitions[0])
    } finally {
      await first.stop()
      await second.stop()
    }
  })

  it("enumerates without thumbnails and grants only the selected game window", async () => {
    const source = { id: "window:50:0", name: "League of Legends (TM) Client" }
    electronMocks.getSources.mockResolvedValue([source])
    const backend = new ElectronDesktopCaptureBackend()

    await backend.start()

    const startScript = electronMocks.windows[0].webContents.executedScripts[0]
    expect(() => new Function(`return ${startScript}`)).not.toThrow()
    expect(startScript).toContain("__recallCaptureDrawFrame")
    expect(startScript).toMatch(/context\.drawImage\(\s*video/)

    expect(electronMocks.getSources).toHaveBeenCalledWith({
      types: ["window"],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    })
    expect(electronMocks.getSources).toHaveBeenCalledTimes(1)
    const captureWindow = electronMocks.windows[0]
    const protocolHandler = captureWindow.webContents.session.protocol.handler as (
      request: { url: string },
    ) => Response
    const capturePageResponse = protocolHandler({ url: "https://recall-capture.invalid/" })
    expect(capturePageResponse.headers.get("permissions-policy")).toBe(
      "display-capture=(self), camera=(self), microphone=()",
    )
    const displayHandler = captureWindow.webContents.session.displayMediaRequestHandler as (
      request: { videoRequested: boolean; audioRequested: boolean; securityOrigin: string },
      callback: (streams: unknown) => void,
    ) => void
    let granted: unknown
    displayHandler(
      {
        videoRequested: true,
        audioRequested: false,
        securityOrigin: "https://recall-capture.invalid",
      },
      (streams) => { granted = streams },
    )
    expect(granted).toEqual({ video: source })

    const permissionHandler = captureWindow.webContents.session.permissionRequestHandler as (
      requestingContents: { id: number } | null,
      permission: string,
      callback: (allowed: boolean) => void,
      details: { requestingUrl?: string; securityOrigin?: string; mediaTypes?: string[] },
    ) => void
    let permissionGranted = false
    permissionHandler(
      null,
      "display-capture",
      (allowed) => { permissionGranted = allowed },
      {},
    )
    expect(permissionGranted).toBe(true)
    permissionHandler(
      null,
      "media",
      (allowed) => { permissionGranted = allowed },
      {},
    )
    expect(permissionGranted).toBe(true)
    permissionHandler(
      captureWindow.webContents,
      "media",
      (allowed) => { permissionGranted = allowed },
      { mediaTypes: ["audio"] },
    )
    expect(permissionGranted).toBe(false)
    permissionHandler(
      captureWindow.webContents,
      "media",
      (allowed) => { permissionGranted = allowed },
      { mediaTypes: ["video"] },
    )
    expect(permissionGranted).toBe(true)
    permissionHandler(
      captureWindow.webContents,
      "geolocation",
      (allowed) => { permissionGranted = allowed },
      {},
    )
    expect(permissionGranted).toBe(false)

    const permissionCheck = captureWindow.webContents.session.permissionCheckHandler as (
      requestingContents: { id: number } | null,
      permission: string,
      origin: string,
      details: { requestingUrl?: string; mediaType?: string },
    ) => boolean
    // Electron 43 can supply null WebContents and unknown/absent media type for
    // the preliminary desktop-video permission check.
    expect(permissionCheck(
      null,
      "display-capture",
      "",
      {},
    )).toBe(true)
    expect(permissionCheck(
      null,
      "media",
      "",
      { mediaType: "unknown" },
    )).toBe(true)
    expect(permissionCheck(
      captureWindow.webContents,
      "media",
      "https://recall-capture.invalid",
      { mediaType: "audio" },
    )).toBe(false)
    expect(permissionCheck(
      captureWindow.webContents,
      "media",
      "https://recall-capture.invalid",
      { mediaType: "video" },
    )).toBe(true)
    expect(permissionCheck(
      captureWindow.webContents,
      "geolocation",
      "https://recall-capture.invalid",
      {},
    )).toBe(false)

    const frame = await backend.captureFrame()
    expect(frame).toMatchObject({ width: 640, height: 360, frameSequence: 1 })
    expect(frame.data).toHaveLength(640 * 360 * 4)
    expect(backend.getHealth()).toMatchObject({
      state: "healthy",
      sourceId: source.id,
      sourceName: source.name,
    })
    // Frame reads use the persistent selected stream rather than enumerating again.
    expect(electronMocks.getSources).toHaveBeenCalledTimes(1)

    await backend.stop()
    expect(captureWindow.destroyed).toBe(true)
  })

  it("reacquires a fresh HWND when the selected capture track ends", async () => {
    const first = { id: "window:60:0", name: "League of Legends (TM) Client" }
    const replacement = { id: "window:61:0", name: "League of Legends (TM) Client" }
    electronMocks.getSources
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([replacement])
    const backend = new ElectronDesktopCaptureBackend()
    await backend.start()
    await backend.captureFrame()

    electronMocks.windows[0].emit(
      "page-title-updated",
      { preventDefault: vi.fn() } as never,
      "Recall minimap capture ended" as never,
    )
    const replacementFrame = await backend.captureFrame()

    expect(replacementFrame.frameSequence).toBe(2)
    expect(electronMocks.getSources).toHaveBeenCalledTimes(2)
    expect(backend.getHealth()).toMatchObject({
      state: "healthy",
      sourceId: replacement.id,
    })
    expect(electronMocks.windows[0].destroyed).toBe(true)
    const retainedMode = captureModeOrder()[0]
    expect(electronMocks.windows[1].webContents.executedScripts[0]).toContain(
      retainedMode === "legacy"
        ? "stream = await navigator.mediaDevices.getUserMedia"
        : "stream = await navigator.mediaDevices.getDisplayMedia",
    )
    await backend.stop()
  })

  it("periodically notices HWND replacement even if the old stream does not end", async () => {
    const first = { id: "window:70:0", name: "League of Legends (TM) Client" }
    const replacement = { id: "window:71:0", name: "League of Legends (TM) Client" }
    electronMocks.getSources
      .mockResolvedValueOnce([first])
      // Handle-validation enumeration no longer contains the selected ID.
      .mockResolvedValueOnce([replacement])
      // Fresh enumeration used by stream reacquisition.
      .mockResolvedValueOnce([replacement])
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000)
    const backend = new ElectronDesktopCaptureBackend()

    try {
      await backend.start()
      await backend.captureFrame()
      now.mockReturnValue(21_000)

      const replacementFrame = await backend.captureFrame()

      expect(replacementFrame.frameSequence).toBe(2)
      expect(electronMocks.getSources).toHaveBeenCalledTimes(3)
      expect(backend.getHealth()).toMatchObject({
        state: "healthy",
        sourceId: replacement.id,
      })
      expect(electronMocks.windows[0].destroyed).toBe(true)
    } finally {
      now.mockRestore()
      await backend.stop()
    }
  })

  it("bounds WGC startup retries and suppresses an immediate retry storm", async () => {
    const source = { id: "window:80:0", name: "League of Legends (TM) Client" }
    electronMocks.getSources.mockResolvedValue([source])
    electronMocks.executeJavaScriptFailures.push(
      new Error("Chromium WGC Failed to start capture -2147024809 (E_INVALIDARG)"),
      new Error("Chromium WGC Failed to start capture -2147024809 (E_INVALIDARG)"),
    )
    const backend = new ElectronDesktopCaptureBackend()

    await expect(backend.start()).rejects.toThrow("capture_stream_start_e_invalidarg")
    expect(electronMocks.getSources).toHaveBeenCalledTimes(2)
    expect(electronMocks.windows).toHaveLength(2)

    // A caller polling startup must receive the stable original error without
    // creating another BrowserWindow or WGC session during the cooldown.
    await expect(backend.start()).rejects.toThrow("capture_stream_start_e_invalidarg")
    expect(electronMocks.getSources).toHaveBeenCalledTimes(2)
    expect(electronMocks.windows).toHaveLength(2)
    expect(backend.getHealth()).toMatchObject({
      state: "unavailable",
      lastErrorCode: "capture_stream_start_e_invalidarg",
    })
  })

  it("falls back when Electron exposes only the generic capture_stream_start_failed wrapper", async () => {
    const source = { id: "window:83:0", name: "League of Legends (TM) Client" }
    electronMocks.getSources.mockResolvedValue([source])
    electronMocks.executeJavaScriptFailures.push(
      new Error("Error invoking remote method: capture_stream_start_failed"),
    )
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const backend = new ElectronDesktopCaptureBackend()

    try {
      await backend.start()

      expect(electronMocks.windows).toHaveLength(2)
      const partitions = electronMocks.windows.map((captureWindow) =>
        (captureWindow.options as {
          webPreferences: { partition: string }
        }).webPreferences.partition,
      )
      expect(partitions[0]).not.toBe(partitions[1])
      const [firstMode, fallbackMode] = captureModeOrder()
      expect(electronMocks.windows[0].webContents.executedScripts[0]).toContain(
        firstMode === "legacy"
          ? "stream = await navigator.mediaDevices.getUserMedia"
          : "stream = await navigator.mediaDevices.getDisplayMedia",
      )
      expect(electronMocks.windows[1].webContents.executedScripts[0]).toContain(
        fallbackMode === "legacy"
          ? "stream = await navigator.mediaDevices.getUserMedia"
          : "stream = await navigator.mediaDevices.getDisplayMedia",
      )
      expect(backend.getHealth()).toMatchObject({
        state: "healthy",
        captureMode: fallbackMode,
        captureStage: "capturing",
      })
    } finally {
      warning.mockRestore()
      await backend.stop()
    }
  })

  it("uses renderer native error codes when Electron wraps the failure message", async () => {
    const source = { id: "window:85:0", name: "League of Legends (TM) Client" }
    electronMocks.getSources.mockResolvedValue([source])
    const firstMode = captureModeOrder()[0]
    electronMocks.executeJavaScriptResults.push({
      ok: false,
      error: {
        name: "Error",
        message: "capture_stream_start_failed",
        nativeCode: -2147024809,
        stage: "requesting_stream",
        diagnostics: {
          mode: firstMode,
          secureContext: true,
          href: "https://recall-capture.invalid/",
          mediaDevicesAvailable: true,
          getUserMediaAvailable: true,
          getDisplayMediaAvailable: true,
        },
      },
    })
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const backend = new ElectronDesktopCaptureBackend()

    try {
      await backend.start()
      expect(warning).toHaveBeenCalledWith(
        "[Recall minimap capture] stream startup attempt failed",
        expect.objectContaining({ code: "capture_stream_start_e_invalidarg" }),
      )
      expect(backend.getHealth()).toMatchObject({ state: "healthy" })
    } finally {
      warning.mockRestore()
      await backend.stop()
    }
  })

  it("preserves renderer DOMException details instead of reporting only a generic startup failure", async () => {
    const source = { id: "window:84:0", name: "League of Legends (TM) Client" }
    electronMocks.getSources.mockResolvedValue([source])
    const failure = (name: string, message: string, mode: "display" | "legacy") => ({
      ok: false,
      error: {
        name,
        message,
        stage: "requesting_stream",
        diagnostics: {
          mode,
          secureContext: true,
          href: "https://recall-capture.invalid/",
          mediaDevicesAvailable: true,
          getUserMediaAvailable: true,
          getDisplayMediaAvailable: true,
          userActivationIsActive: false,
        },
      },
    })
    const [firstMode, fallbackMode] = captureModeOrder()
    electronMocks.executeJavaScriptResults.push(
      failure("NotReadableError", "Could not start video source", firstMode),
      failure("InvalidStateError", "No transient activation", fallbackMode),
    )
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const backend = new ElectronDesktopCaptureBackend()

    try {
      await expect(backend.start()).rejects.toThrow("capture_stream_invalid_state")
      expect(backend.getHealth()).toMatchObject({
        state: "unavailable",
        captureMode: fallbackMode,
        captureStage: "requesting_stream",
        lastErrorCode: "capture_stream_invalid_state",
      })
      expect(backend.getHealth().lastErrorDetail).toContain("InvalidStateError")
      expect(backend.getHealth().lastErrorDetail).toContain("stage=requesting_stream")
      expect(backend.getHealth().lastErrorDetail).toContain("activation=false")
    } finally {
      warning.mockRestore()
      await backend.stop()
    }
  })

  it("re-enumerates the game HWND on the bounded startup retry", async () => {
    const first = { id: "window:81:0", name: "League of Legends (TM) Client" }
    const replacement = { id: "window:82:0", name: "League of Legends (TM) Client" }
    electronMocks.getSources
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([replacement])
    electronMocks.executeJavaScriptFailures.push(
      new Error("Chromium WGC Failed to start capture -2147024809 (E_INVALIDARG)"),
    )
    const backend = new ElectronDesktopCaptureBackend()

    await backend.start()

    expect(electronMocks.getSources).toHaveBeenCalledTimes(2)
    const fallbackMode = captureModeOrder()[1]
    expect(electronMocks.windows[1].webContents.executedScripts[0]).toContain(
      fallbackMode === "legacy"
          ? "stream = await navigator.mediaDevices.getUserMedia"
          : "stream = await navigator.mediaDevices.getDisplayMedia",
    )
    if (fallbackMode === "legacy") {
      expect(electronMocks.windows[1].webContents.executedScripts[0]).toContain(
        `chromeMediaSourceId: ${JSON.stringify(replacement.id)}`,
      )
    }
    expect(backend.getHealth()).toMatchObject({
      state: "healthy",
      sourceId: replacement.id,
    })
  })
})
