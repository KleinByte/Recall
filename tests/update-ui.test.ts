import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { api } from "../src/helpers/api.js"
import { updatePresentation } from "../src/helpers/update.js"

afterEach(() => vi.unstubAllGlobals())

describe("updatePresentation", () => {
  it("renders every update state with only valid actions", () => {
    expect(updatePresentation({ kind: "checking" })).toEqual({
      message: "Checking for updates…",
      action: null,
    })
    expect(updatePresentation({ kind: "up-to-date" })).toEqual({
      message: "Recall is up to date.",
      action: null,
    })
    expect(
      updatePresentation({ kind: "available", version: "1.2.0" }),
    ).toEqual({
      message: "Downloading Recall 1.2.0…",
      action: null,
    })
    expect(
      updatePresentation({ kind: "downloading", version: "1.2.0", percent: 42 }),
    ).toEqual({
      message: "Downloading Recall 1.2.0: 42%",
      action: null,
    })
    expect(updatePresentation({ kind: "downloaded", version: "1.2.0" })).toEqual({
      message: "Recall 1.2.0 is ready.",
      action: { label: "Restart to update", command: "install" },
    })
    expect(
      updatePresentation({
        kind: "error",
        message: "Could not check for updates. Recall is still ready to use.",
      }),
    ).toEqual({
      message: "Could not check for updates. Recall is still ready to use.",
      action: { label: "Try again", command: "retry" },
    })
  })
})

describe("update API", () => {
  it("uses only the dedicated update IPC channels", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    const on = vi.fn()
    vi.stubGlobal("window", { ipcRenderer: { invoke, on } })

    await api.getUpdateStatus()
    await api.checkForUpdates()
    await api.retryUpdate()
    await api.installUpdate()
    api.onUpdateStatus(vi.fn())

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      "app:update-status",
      "app:update-check",
      "app:update-retry",
      "app:update-install",
    ])
    expect(on).toHaveBeenCalledWith(
      "app:update-status",
      expect.any(Function),
      expect.stringMatching(/:app:update-status$/),
    )
  })
})

describe("update-ready notification", () => {
  it("shows a dismissible app-wide restart banner when an update is downloaded", () => {
    const app = readFileSync("src/App.vue", "utf8")
    const banner = readFileSync("src/components/UpdateReadyBanner.vue", "utf8")
    const animation = readFileSync("src/components/UpdateRecallAnimation.vue", "utf8")
    const settings = readFileSync("src/pages/SettingsPage.vue", "utf8")

    expect(app).toContain("useApiEvents")
    expect(app).toContain("events.onUpdateStatus")
    expect(app).toContain("UpdateReadyBanner")
    expect(app).toContain(':status="updateStatus"')
    expect(banner).toContain("status.kind === 'downloaded'")
    expect(banner).toContain("Restart to update")
    expect(banner).toContain("emit('install')")
    expect(banner).toContain("emit('dismiss')")
    expect(app).toContain("installUpdateWithRecall")
    expect(app).toContain("UpdateRecallAnimation")
    expect(app).toContain("runStartupTransition")
    expect(app).toContain(':phase="startupAnimationPhase"')
    expect(animation).toContain('phase: "startup" | "channeling" | "arrival"')
    expect(animation).toContain("phase-startup")
    expect(animation).toContain("completion-burst")
    expect(settings).toContain("Check for updates")
    expect(settings).toContain("api.checkForUpdates()")
    expect(settings).toContain("https://developer.riotgames.com/")
    expect(settings).toContain("Development keys expire every 24 hours")
  })
})
