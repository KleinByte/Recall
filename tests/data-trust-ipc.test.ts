import { describe, expect, it, vi } from "vitest"
import {
  registerDataTrustIpc,
  type DataTrustIpcDependencies,
} from "../electron/main/ipc/data-trust-ipc.js"

type IpcHandler = (...args: unknown[]) => unknown

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup() {
  const handlers = new Map<string, IpcHandler>()
  const handle = vi.fn((channel: string, handler: IpcHandler) => {
    handlers.set(channel, handler)
  })
  const report = { integrity: "ok" }
  const dataTrust = {
    check: vi.fn().mockReturnValue("ok"),
    report: vi.fn().mockReturnValue(report),
  }
  const backup = {
    fileName: "stats-manual-1.db",
    format: "recall-managed-backup" as const,
    manifestVersion: 2 as const,
    createdAt: 1,
    reason: "manual" as const,
    protection: "rolling" as const,
    appVersion: "test",
    releaseSequence: 1,
    sha256: "hash",
    schemaVersion: 1,
    sizeBytes: 1,
    matchCount: 0,
    integrity: "ok" as const,
  }
  const backups = {
    list: vi.fn().mockReturnValue([backup]),
    createAsync: vi.fn().mockResolvedValue(backup),
    delete: vi.fn().mockReturnValue(true),
    prepareRestoreAsync: vi.fn().mockResolvedValue(undefined),
  }
  const database = {} as ReturnType<DataTrustIpcDependencies["getDatabase"]>
  const dependencies: DataTrustIpcDependencies = {
    getDataTrustService: () => dataTrust as never,
    getBackupManager: () => backups,
    getDatabase: () => database,
    getReportContext: vi.fn().mockReturnValue({
      puuid: "player",
      keyConfigured: true,
      keyProtected: true,
    }),
    trackDatabaseTask: (task) => task,
    normalizeBackupName: vi.fn().mockReturnValue("stats-manual-1.db"),
    broadcastUpdated: vi.fn(),
    scheduleApplicationRestart: vi.fn(),
  }

  registerDataTrustIpc({ handle } as never, dependencies)
  return { handlers, handle, dependencies, dataTrust, backups, backup, database, report }
}

describe("registerDataTrustIpc", () => {
  it("registers the complete data-trust and managed-backup surface", () => {
    const { handle } = setup()

    expect(handle.mock.calls.map(([channel]) => channel)).toEqual([
      "data-trust:get",
      "data-trust:check",
      "backups:list",
      "backups:create",
      "backups:delete",
      "backups:restore",
    ])
  })

  it("checks integrity, publishes the fresh report, and returns it", () => {
    const { handlers, dependencies, dataTrust, report } = setup()

    expect(handlers.get("data-trust:get")!()).toBe(report)
    expect(dataTrust.check).not.toHaveBeenCalled()

    expect(handlers.get("data-trust:check")!()).toBe(report)
    expect(dataTrust.check).toHaveBeenCalledOnce()
    expect(dataTrust.report).toHaveBeenLastCalledWith("player", true, true)
    expect(dependencies.broadcastUpdated).toHaveBeenCalledWith(report)
  })

  it("waits for backup creation before broadcasting the returned manifest", async () => {
    const { handlers, dependencies, backups, backup, database } = setup()
    const pending = deferred<typeof backup>()
    backups.createAsync.mockReturnValueOnce(pending.promise)

    const creating = handlers.get("backups:create")!() as Promise<unknown>
    expect(backups.createAsync).toHaveBeenCalledWith(database, "manual")
    expect(dependencies.broadcastUpdated).not.toHaveBeenCalled()

    pending.resolve(backup)
    await expect(creating).resolves.toBe(backup)
    expect(dependencies.broadcastUpdated).toHaveBeenCalledWith()
  })

  it("normalizes deletion input and publishes only after the delete", () => {
    const { handlers, dependencies, backups } = setup()

    expect(handlers.get("backups:delete")!({}, " raw.db ")).toBe(true)
    expect(dependencies.normalizeBackupName).toHaveBeenCalledWith(" raw.db ")
    expect(backups.delete).toHaveBeenCalledWith("stats-manual-1.db")
    expect(dependencies.broadcastUpdated).toHaveBeenCalledWith()
  })

  it("waits for restore preparation before scheduling the application restart", async () => {
    const { handlers, dependencies, backups, database } = setup()
    const pending = deferred<void>()
    backups.prepareRestoreAsync.mockReturnValueOnce(pending.promise)

    const restoring = handlers.get("backups:restore")!({}, " raw.db ") as Promise<unknown>
    expect(backups.prepareRestoreAsync).toHaveBeenCalledWith(
      database,
      "stats-manual-1.db",
    )
    expect(dependencies.scheduleApplicationRestart).not.toHaveBeenCalled()

    pending.resolve()
    await expect(restoring).resolves.toBe(true)
    expect(dependencies.scheduleApplicationRestart).toHaveBeenCalledOnce()
    expect(dependencies.broadcastUpdated).not.toHaveBeenCalled()
  })
})
