import { beforeEach, describe, expect, it, vi } from "vitest"

const electronMocks = vi.hoisted(() => {
  const getSources = vi.fn()
  const executeJavaScriptFailures: unknown[] = []
  const windows: FakeBrowserWindow[] = []

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
    private readonly listeners = new Map<string, Array<(...args: never[]) => void>>()

    constructor(private readonly owner: FakeBrowserWindow) {}

    setFrameRate() {}

    on(event: string, listener: (...args: never[]) => void) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    }

    executeJavaScript(script: string) {
      this.executedScripts.push(script)
      if (script.includes("getDisplayMedia") || script.includes("getUserMedia")) {
        const failure = executeJavaScriptFailures.shift()
        if (failure !== undefined) return Promise.reject(failure)
        return Promise.resolve({ width: 640, height: 360, trackState: "live" })
      }
      return Promise.resolve(undefined)
    }

    invalidate() {
      const { width, height } = this.owner.contentSize
      const image = {
        isEmpty: () => false,
        getSize: () => ({ width, height }),
        toBitmap: () => Buffer.alloc(width * height * 4),
      }
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

    isDestroyed() {
      return this.destroyed
    }

    destroy() {
      this.destroyed = true
      this.emit("closed")
    }
  }

  return { FakeBrowserWindow, executeJavaScriptFailures, getSources, windows }
})

vi.mock("electron", () => ({
  BrowserWindow: electronMocks.FakeBrowserWindow,
  desktopCapturer: { getSources: electronMocks.getSources },
}))

import {
  capturedBitmapValidationError,
  ElectronDesktopCaptureBackend,
  fitCaptureSize,
  selectLeagueGameWindowSource,
} from "../electron/main/minimap/electron-desktop-capture-backend.js"

beforeEach(() => {
  electronMocks.getSources.mockReset()
  electronMocks.executeJavaScriptFailures.splice(0)
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

describe("ElectronDesktopCaptureBackend persistent stream", () => {
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

    expect(electronMocks.getSources).toHaveBeenCalledWith({
      types: ["window"],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    })
    expect(electronMocks.getSources).toHaveBeenCalledTimes(1)
    const captureWindow = electronMocks.windows[0]
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
      requestingContents: { id: number },
      permission: string,
      callback: (allowed: boolean) => void,
      details: { requestingUrl: string; securityOrigin?: string },
    ) => void
    let permissionGranted = false
    permissionHandler(
      captureWindow.webContents,
      "display-capture",
      (allowed) => { permissionGranted = allowed },
      { requestingUrl: "https://recall-capture.invalid/" },
    )
    expect(permissionGranted).toBe(true)
    permissionHandler(
      captureWindow.webContents,
      "media",
      (allowed) => { permissionGranted = allowed },
      { requestingUrl: "https://recall-capture.invalid/", mediaTypes: ["audio"] },
    )
    expect(permissionGranted).toBe(false)
    permissionHandler(
      captureWindow.webContents,
      "media",
      (allowed) => { permissionGranted = allowed },
      { requestingUrl: "https://recall-capture.invalid/", mediaTypes: ["video"] },
    )
    expect(permissionGranted).toBe(true)
    permissionHandler(
      { id: captureWindow.webContents.id + 1 },
      "display-capture",
      (allowed) => { permissionGranted = allowed },
      { requestingUrl: "https://recall-capture.invalid/" },
    )
    expect(permissionGranted).toBe(false)

    const permissionCheck = captureWindow.webContents.session.permissionCheckHandler as (
      requestingContents: { id: number },
      permission: string,
      origin: string,
      details: { requestingUrl: string; mediaType?: string },
    ) => boolean
    expect(permissionCheck(
      captureWindow.webContents,
      "display-capture",
      "https://recall-capture.invalid",
      { requestingUrl: "https://recall-capture.invalid/" },
    )).toBe(true)
    expect(permissionCheck(
      captureWindow.webContents,
      "display-capture",
      "https://untrusted.invalid",
      { requestingUrl: "https://untrusted.invalid/" },
    )).toBe(false)
    expect(permissionCheck(
      captureWindow.webContents,
      "media",
      "https://recall-capture.invalid",
      { requestingUrl: "https://recall-capture.invalid/", mediaType: "audio" },
    )).toBe(false)
    expect(permissionCheck(
      captureWindow.webContents,
      "media",
      "https://recall-capture.invalid",
      { requestingUrl: "https://recall-capture.invalid/", mediaType: "video" },
    )).toBe(true)

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
      now.mockReturnValue(13_000)

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
    expect(electronMocks.windows[1].webContents.executedScripts[0]).toContain(
      'chromeMediaSource: "desktop"',
    )
    expect(electronMocks.windows[1].webContents.executedScripts[0]).toContain(
      `chromeMediaSourceId: ${JSON.stringify(replacement.id)}`,
    )
    expect(backend.getHealth()).toMatchObject({
      state: "healthy",
      sourceId: replacement.id,
    })
  })
})
