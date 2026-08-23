import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createUpdaterService,
  registerUpdaterIpc,
  type UpdaterClient,
} from "../electron/main/updater.js"

function client(): UpdaterClient & EventEmitter {
  const value = new EventEmitter() as UpdaterClient & EventEmitter
  value.autoDownload = false
  value.autoInstallOnAppQuit = true
  value.checkForUpdates = vi.fn().mockResolvedValue(undefined)
  value.downloadUpdate = vi.fn().mockResolvedValue([])
  value.quitAndInstall = vi.fn()
  return value
}

afterEach(() => vi.restoreAllMocks())

describe("createUpdaterService", () => {
  it("does not contact GitHub in a development build", async () => {
    const updater = client()
    const service = createUpdaterService({
      updater,
      isPackaged: false,
      publish: vi.fn(),
    })

    await service.start()

    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(service.status()).toEqual({ kind: "up-to-date" })
    service.stop()
  })

  it("silently installs and restarts only after the download is ready", async () => {
    const updater = client()
    const publish = vi.fn()
    const beforeInstall = vi.fn()
    const beginInstall = vi.fn()
    const service = createUpdaterService({
      updater,
      isPackaged: true,
      publish,
      beforeInstall,
      beginInstall,
    })
    await service.start()

    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    updater.emit("update-available", { version: "1.2.0" })
    updater.emit("download-progress", { percent: 42.4 })
    updater.emit("update-downloaded", { version: "1.2.0" })

    expect(publish).toHaveBeenLastCalledWith({
      kind: "downloaded",
      version: "1.2.0",
    })
    await expect(service.install()).resolves.toBe(true)
    expect(beginInstall).toHaveBeenCalledWith("1.2.0")
    expect(beforeInstall).toHaveBeenCalledOnce()
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it("checks for updates every six hours without overlapping a pending check", async () => {
    vi.useFakeTimers()
    const updater = client()
    const service = createUpdaterService({
      updater,
      isPackaged: true,
      publish: vi.fn(),
    })

    await service.start()
    let finishCheck!: () => void
    ;(updater.checkForUpdates as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<void>((resolve) => { finishCheck = resolve }),
    )

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)

    finishCheck()
    await Promise.resolve()
    service.stop()
    vi.useRealTimers()
  })

  it("refuses to install when the database cannot be safely closed", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const updater = client()
    const publish = vi.fn()
    const cancelInstall = vi.fn()
    const service = createUpdaterService({
      updater,
      isPackaged: true,
      publish,
      beforeInstall: () => {
        throw new Error("database is busy")
      },
      cancelInstall,
    })
    await service.start()
    updater.emit("update-downloaded", { version: "1.2.0" })

    await expect(service.install()).resolves.toBe(false)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    expect(cancelInstall).toHaveBeenCalledOnce()
    expect(service.status()).toEqual({
      kind: "error",
      message: expect.stringContaining("safely close"),
    })
    expect(errorLog).toHaveBeenCalledWith(
      "[updater] could not prepare database for install:",
      expect.objectContaining({ message: "database is busy" }),
    )
  })

  it("waits for background database work before installing", async () => {
    const updater = client()
    let finish!: () => void
    const ready = new Promise<void>((resolve) => {
      finish = resolve
    })
    const service = createUpdaterService({
      updater,
      isPackaged: true,
      publish: vi.fn(),
      beforeInstall: () => ready,
    })
    await service.start()
    updater.emit("update-downloaded", { version: "1.2.0" })

    const installing = service.install()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    finish()

    await expect(installing).resolves.toBe(true)
    expect(updater.quitAndInstall).toHaveBeenCalledOnce()
  })

  it("publishes a safe error and retries the feed check", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const updater = client()
    const service = createUpdaterService({
      updater,
      isPackaged: true,
      publish: vi.fn(),
    })
    await service.start()
    updater.emit("error", new Error("socket reset"))

    expect(service.status()).toEqual({
      kind: "error",
      message: "Could not check for updates. Recall is still ready to use.",
    })
    await service.retry()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(warning).toHaveBeenCalledWith(
      "[updater] error:",
      expect.objectContaining({ message: "socket reset" }),
    )
  })

  it("allows a manual check from any current state", async () => {
    const updater = client()
    const service = createUpdaterService({
      updater,
      isPackaged: true,
      publish: vi.fn(),
    })
    await service.start()
    updater.emit("update-not-available")

    await service.check()

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it("sets status to checking immediately and exposes it via status()", async () => {
    const updater = client()
    const publish = vi.fn()
    const service = createUpdaterService({ updater, isPackaged: true, publish })

    const startPromise = service.start()
    expect(service.status()).toEqual({ kind: "checking" })
    expect(publish).toHaveBeenCalledWith({ kind: "checking" })
    await startPromise
  })

  it("does not propagate a rejected checkForUpdates() from start()", async () => {
    const updater = client()
    ;(updater.checkForUpdates as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network failure"),
    )
    const service = createUpdaterService({
      updater,
      isPackaged: true,
      publish: vi.fn(),
    })
    await expect(service.start()).resolves.toBeUndefined()
  })

  it("sets status to checking immediately when retry() is called", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const updater = client()
    const publish = vi.fn()
    const service = createUpdaterService({ updater, isPackaged: true, publish })
    await service.start()
    updater.emit("error", new Error("socket reset"))
    expect(service.status()).toEqual({ kind: "error", message: expect.any(String) })

    const retryPromise = service.retry()
    expect(service.status()).toEqual({ kind: "checking" })
    expect(publish).toHaveBeenLastCalledWith({ kind: "checking" })
    await retryPromise
    expect(warning).toHaveBeenCalledWith(
      "[updater] error:",
      expect.objectContaining({ message: "socket reset" }),
    )
  })

  it("does not propagate a rejected checkForUpdates() from retry()", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const updater = client()
    const service = createUpdaterService({
      updater,
      isPackaged: true,
      publish: vi.fn(),
    })
    await service.start()
    updater.emit("error", new Error("first failure"))
    ;(updater.checkForUpdates as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("retry failure"),
    )
    await expect(service.retry()).resolves.toBeUndefined()
    expect(warning).toHaveBeenCalledWith(
      "[updater] error:",
      expect.objectContaining({ message: "first failure" }),
    )
  })

  it("forwards updater state through the main-window publisher", async () => {
    const updater = client()
    const publish = vi.fn()
    const service = createUpdaterService({ updater, isPackaged: true, publish })

    await service.start()
    updater.emit("update-not-available")

    expect(publish).toHaveBeenLastCalledWith({ kind: "up-to-date" })
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(false)
  })
})

describe("registerUpdaterIpc", () => {
  it("registers typed state, check, retry, and install handlers", async () => {
    const handle = vi.fn()
    const service = {
      status: vi.fn().mockReturnValue({ kind: "up-to-date" as const }),
      check: vi.fn().mockResolvedValue(undefined),
      retry: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(false),
    }

    registerUpdaterIpc({ handle } as never, service)
    const handlers = new Map(handle.mock.calls.map(([name, fn]) => [name, fn]))

    await expect(handlers.get("app:update-status")!()).resolves.toEqual({
      kind: "up-to-date",
    })
    await handlers.get("app:update-check")!()
    expect(service.check).toHaveBeenCalledOnce()
    await handlers.get("app:update-retry")!()
    expect(service.retry).toHaveBeenCalledOnce()
    await expect(handlers.get("app:update-install")!()).resolves.toBe(false)
  })
})
