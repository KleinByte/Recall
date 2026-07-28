import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import {
  createUpdaterService,
  registerUpdaterIpc,
  type UpdaterClient,
} from "../electron/main/updater.js"

function client(): UpdaterClient & EventEmitter {
  const value = new EventEmitter() as UpdaterClient & EventEmitter
  value.autoDownload = false
  value.checkForUpdates = vi.fn().mockResolvedValue(undefined)
  value.downloadUpdate = vi.fn().mockResolvedValue([])
  value.quitAndInstall = vi.fn()
  return value
}

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
  })

  it("publishes progress and enables installation only after download", async () => {
    const updater = client()
    const publish = vi.fn()
    const service = createUpdaterService({ updater, isPackaged: true, publish })
    await service.start()

    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    updater.emit("update-available", { version: "1.2.0" })
    updater.emit("download-progress", { percent: 42.4 })
    updater.emit("update-downloaded", { version: "1.2.0" })

    expect(publish).toHaveBeenLastCalledWith({
      kind: "downloaded",
      version: "1.2.0",
    })
    expect(service.install()).toBe(true)
    expect(updater.quitAndInstall).toHaveBeenCalledOnce()
  })

  it("publishes a safe error and retries the feed check", async () => {
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

  it("does not propagate a rejected checkForUpdates() from retry()", async () => {
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
  })

  it("forwards updater state through the main-window publisher", async () => {
    const updater = client()
    const publish = vi.fn()
    const service = createUpdaterService({ updater, isPackaged: true, publish })

    await service.start()
    updater.emit("update-not-available")

    expect(publish).toHaveBeenLastCalledWith({ kind: "up-to-date" })
    expect(updater.autoDownload).toBe(true)
  })
})

describe("registerUpdaterIpc", () => {
  it("registers typed state, retry, and install handlers", async () => {
    const handle = vi.fn()
    const service = {
      status: vi.fn().mockReturnValue({ kind: "up-to-date" as const }),
      retry: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockReturnValue(false),
    }

    registerUpdaterIpc({ handle } as never, service)
    const handlers = new Map(handle.mock.calls.map(([name, fn]) => [name, fn]))

    await expect(handlers.get("app:update-status")!()).resolves.toEqual({
      kind: "up-to-date",
    })
    await handlers.get("app:update-retry")!()
    expect(service.retry).toHaveBeenCalledOnce()
    expect(handlers.get("app:update-install")!()).toBe(false)
  })
})
