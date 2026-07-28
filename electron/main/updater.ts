export type UpdateStatus =
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; percent: number }
  | { kind: "downloaded"; version: string }
  | { kind: "error"; message: string }

export interface UpdaterClient {
  autoDownload: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
  on(
    event:
      | "checking-for-update"
      | "update-available"
      | "update-not-available"
      | "download-progress"
      | "update-downloaded"
      | "error",
    listener: (payload?: unknown) => void,
  ): unknown
}

export interface UpdaterService {
  start(): Promise<void>
  status(): UpdateStatus
  retry(): Promise<void>
  install(): boolean
}

interface UpdaterServiceOptions {
  updater: UpdaterClient
  isPackaged: boolean
  publish: (status: UpdateStatus) => void
}

const ERROR_MESSAGE =
  "Could not check for updates. Recall is still ready to use."

export function createUpdaterService({
  updater,
  isPackaged,
  publish,
}: UpdaterServiceOptions): UpdaterService {
  let current: UpdateStatus = { kind: "up-to-date" }

  function set(next: UpdateStatus) {
    current = next
    publish(next)
  }

  function registerListeners() {
    updater.on("checking-for-update", () => {
      set({ kind: "checking" })
    })

    updater.on("update-available", (payload) => {
      const info = payload as { version: string } | undefined
      set({ kind: "available", version: info?.version ?? "" })
    })

    updater.on("update-not-available", () => {
      set({ kind: "up-to-date" })
    })

    updater.on("download-progress", (payload) => {
      const info = payload as { percent: number } | undefined
      const raw = info?.percent ?? 0
      const percent = Math.min(100, Math.max(0, Math.round(raw)))
      const version =
        current.kind === "available" || current.kind === "downloading"
          ? (current as { version: string }).version
          : ""
      set({ kind: "downloading", version, percent })
    })

    updater.on("update-downloaded", (payload) => {
      const info = payload as { version: string } | undefined
      set({ kind: "downloaded", version: info?.version ?? "" })
    })

    updater.on("error", (err) => {
      console.warn("[updater] error:", err)
      set({ kind: "error", message: ERROR_MESSAGE })
    })
  }

  return {
    async start() {
      if (!isPackaged) return

      updater.autoDownload = true
      registerListeners()
      set({ kind: "checking" })
      await updater.checkForUpdates().catch(() => undefined)
    },

    status() {
      return current
    },

    async retry() {
      if (current.kind !== "error") return
      await updater.checkForUpdates().catch(() => undefined)
    },

    install() {
      if (current.kind !== "downloaded") return false
      updater.quitAndInstall()
      return true
    },
  }
}

export function registerUpdaterIpc(
  ipcMain: { handle(channel: string, handler: () => unknown): void },
  service: UpdaterService,
) {
  ipcMain.handle("app:update-status", () => Promise.resolve(service.status()))
  ipcMain.handle("app:update-retry", () => service.retry())
  ipcMain.handle("app:update-install", () => service.install())
}
