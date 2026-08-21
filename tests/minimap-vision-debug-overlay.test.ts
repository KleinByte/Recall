import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("bounded minimap CV debug overlay contract", () => {
  it("uses a dedicated renderer surface and only renders the bounded ROI", () => {
    const entry = read("src/main.ts")
    const preload = read("electron/preload/index.ts")
    const overlay = read("src/MinimapVisionDebugOverlay.vue")

    expect(entry).toContain('surface") === "minimap-vision-debug"')
    expect(entry).toContain('import("./MinimapVisionDebugOverlay.vue")')
    expect(preload).toContain('surface") === "minimap-vision-debug"')
    expect(overlay).toContain('aria-label="Bounded minimap ROI"')
    expect(overlay).toContain("context.putImageData")
    expect(overlay).toContain("snapshot.proposals")
    expect(overlay).toContain("snapshot.confirmed")
    expect(overlay).toContain("sourceDiscoveryAttempts")
    expect(overlay).toContain("candidateSourceNames")
    expect(overlay).toContain("templateErrorCode")
    expect(overlay).toContain("calibrationFailureReason")
    expect(overlay).toContain("opencvVersion")
    expect(overlay).toContain("visionWorkerState")
    expect(overlay).toContain("visionProcessingMs")
  })

  it("keeps the native window click-through/content-protected and bounds preview cadence", () => {
    const main = read("electron/main/index.ts")

    expect(main).toContain('title: "Recall Minimap CV Debug"')
    expect(main).toContain("overlay.setContentProtection(true)")
    expect(main).toContain("overlay.setIgnoreMouseEvents(locked, { forward: true })")
    expect(main).toContain("overlay.setContentProtection(true)")
    expect(main).toContain("now - lastMinimapDebugPublishAt < 333")
    expect(main).toContain("imageRgba: frame.data")
    expect(main).not.toContain("encodeMinimapDebugPng(frame)")
    expect(main).toContain('overlayUrl.searchParams.set("surface", "minimap-vision-debug")')
    expect(main).toContain("clearMinimapVisionDebugOverlay(win)")
    expect(main).toContain("debugWindow.destroy()")
    expect(main).toContain("publishMinimapDebugHealth()")
    expect(main).toContain("resetMinimapVisionDebugFrame(win)")
    expect(main).toContain("minimapVisionDebugRequestedVisible || latestMinimapVisionDebug.enabled")
    expect(main).toContain('settingsStore.getMain("minimap-vision-overlay-enabled") !== true')
    expect(main).not.toContain("participantKey: observation.participantKey")
    expect(read("src/MinimapVisionDebugOverlay.vue")).toContain("font-size: 11px")
  })

  it("exposes narrow controls and an explicit opt-in setting", () => {
    const api = read("src/helpers/api.ts")
    const settings = read("electron/main/settings-store.ts")
    const main = read("electron/main/index.ts")

    expect(settings).toContain('"minimap-vision-overlay-enabled"')
    expect(api).toContain('invoke("minimap-vision-debug:toggle")')
    expect(api).toContain('invoke("minimap-vision-debug:lock")')
    expect(main).toContain('ipcMain.handle("minimap-vision-debug:toggle"')
    expect(main).toContain('ipcMain.handle("settings:minimap-vision-overlay:set"')
  })
})
