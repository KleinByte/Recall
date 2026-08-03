export type UpdateStatus =
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; percent: number }
  | { kind: "downloaded"; version: string }
  | { kind: "error"; message: string }

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

export interface UpdaterClient {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
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
  stop(): void
  status(): UpdateStatus
  check(): Promise<void>
  retry(): Promise<void>
  install(): Promise<boolean>
}

interface UpdaterServiceOptions {
  updater: UpdaterClient
  isPackaged: boolean
  publish: (status: UpdateStatus) => void
  beforeInstall?: () => void | Promise<void>
}

const ERROR_MESSAGE =
  "Could not check for updates. Recall is still ready to use."

export function createUpdaterService({
  updater,
  isPackaged,
  publish,
  beforeInstall = () => undefined,
}: UpdaterServiceOptions): UpdaterService {
  let current: UpdateStatus = { kind: "up-to-date" }
  let checkInProgress = false
  let checkTimer: NodeJS.Timeout | undefined

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

  async function checkForUpdates() {
    if (checkInProgress) return

    if (!isPackaged) {
      set({ kind: "up-to-date" })
      return
    }

    checkInProgress = true
    set({ kind: "checking" })
    try {
      await updater.checkForUpdates().catch(() => undefined)
    } finally {
      checkInProgress = false
    }
  }

  return {
    async start() {
      if (!isPackaged) return

      updater.autoDownload = true
      // electron-updater otherwise installs a downloaded release on an
      // ordinary app quit, bypassing our verified database snapshot.
      updater.autoInstallOnAppQuit = false
      registerListeners()
      checkTimer = setInterval(() => void checkForUpdates(), UPDATE_CHECK_INTERVAL_MS)
      await checkForUpdates()
    },

    stop() {
      if (!checkTimer) return
      clearInterval(checkTimer)
      checkTimer = undefined
    },

    status() {
      return current
    },

    async check() {
      await checkForUpdates()
    },

    async retry() {
      if (current.kind !== "error") return
      await checkForUpdates()
    },

    async install() {
      if (current.kind !== "downloaded") return false
      try {
        await beforeInstall()
        updater.quitAndInstall(true, true)
        return true
      } catch (error) {
        console.error("[updater] could not prepare database for install:", error)
        set({
          kind: "error",
          message:
            "Could not safely close your history for the update. Please retry after restarting Recall.",
        })
        return false
      }
    },
  }
}

export function registerUpdaterIpc(
  ipcMain: { handle(channel: string, handler: () => unknown): void },
  service: UpdaterService,
) {
  ipcMain.handle("app:update-status", () => Promise.resolve(service.status()))
  ipcMain.handle("app:update-check", () => service.check())
  ipcMain.handle("app:update-retry", () => service.retry())
  ipcMain.handle("app:update-install", () => service.install())
}
