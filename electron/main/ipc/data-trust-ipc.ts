import type { IpcMain } from "electron"
import type { BackupManager } from "../database/backup-manager.js"
import type { DataTrustService } from "../database/data-trust.js"

type BackupDatabase = Parameters<BackupManager["createAsync"]>[0]
type BackupStore = Pick<
  BackupManager,
  "createAsync" | "delete" | "list" | "prepareRestoreAsync"
>
type DataTrustReader = Pick<DataTrustService, "check" | "report">
type DataTrustReport = ReturnType<DataTrustReader["report"]>

export interface DataTrustIpcDependencies {
  getDataTrustService(): DataTrustReader
  getBackupManager(): BackupStore
  getDatabase(): BackupDatabase
  getReportContext(): {
    puuid: string | undefined
    keyConfigured: boolean
    keyProtected: boolean
  }
  trackDatabaseTask<T>(task: Promise<T>): Promise<T>
  normalizeBackupName(value: unknown): string
  broadcastUpdated(report?: DataTrustReport): void
  scheduleApplicationRestart(): void
}

/**
 * Registers the data-integrity and managed-backup IPC surface.
 *
 * The composition root retains ownership of the database, application
 * lifecycle, validation policy, and renderer publisher. Keeping those as
 * injected boundaries makes this router independently testable without
 * changing any IPC contracts or persistence behavior.
 */
export function registerDataTrustIpc(
  ipcMain: Pick<IpcMain, "handle">,
  dependencies: DataTrustIpcDependencies,
) {
  const report = (service = dependencies.getDataTrustService()) => {
    const context = dependencies.getReportContext()
    return service.report(
      context.puuid,
      context.keyConfigured,
      context.keyProtected,
    )
  }

  ipcMain.handle("data-trust:get", () => report())

  ipcMain.handle("data-trust:check", () => {
    const service = dependencies.getDataTrustService()
    service.check()
    const current = report(service)
    dependencies.broadcastUpdated(current)
    return current
  })

  ipcMain.handle("backups:list", () => dependencies.getBackupManager().list())
  ipcMain.handle("backups:create", async () => {
    const backup = await dependencies.trackDatabaseTask(
      dependencies.getBackupManager().createAsync(
        dependencies.getDatabase(),
        "manual",
      ),
    )
    dependencies.broadcastUpdated()
    return backup
  })
  ipcMain.handle("backups:delete", (_event, fileName: unknown) => {
    const deleted = dependencies.getBackupManager().delete(
      dependencies.normalizeBackupName(fileName),
    )
    dependencies.broadcastUpdated()
    return deleted
  })
  ipcMain.handle("backups:restore", async (_event, fileName: unknown) => {
    await dependencies.trackDatabaseTask(
      dependencies.getBackupManager().prepareRestoreAsync(
        dependencies.getDatabase(),
        dependencies.normalizeBackupName(fileName),
      ),
    )
    dependencies.scheduleApplicationRestart()
    return true
  })
}
