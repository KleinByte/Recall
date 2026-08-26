import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("Tempo overlay UI contract", () => {
  it("boots a dedicated renderer and reuses the live Tempo gauge", () => {
    const entry = read("src/main.ts")
    const overlay = read("src/TempoOverlayApp.vue")

    expect(entry).toContain('get("surface") === "tempo-overlay"')
    expect(entry).toContain('import("./TempoOverlayApp.vue")')
    expect(overlay).toContain('import TempoGauge from "./components/TempoGauge.vue"')
    expect(overlay).toContain('events.on("live:updated"')
    expect(overlay).toContain("<TempoGauge")
    expect(overlay).toContain("-webkit-app-region: drag")
  })

  it("owns one native overlay window with shortcut, lock, and persistence controls", () => {
    const main = read("electron/main/index.ts")

    expect(main).toContain("tempoOverlayShortcutRegistered = globalShortcut.register(")
    expect(main).toContain('"Alt+T"')
    expect(main).toContain('title: "Recall Tempo Overlay"')
    expect(main).toContain('overlay.setAlwaysOnTop(true, "screen-saver")')
    expect(main).toContain("overlay.showInactive()")
    expect(main).toContain('settingsStore.setMain("tempo-overlay-position"')
    expect(main).toContain('ipcMain.handle("tempo-overlay:lock"')
    expect(main).toContain('if (liveSession.phase === "Idle"')
  })
})
