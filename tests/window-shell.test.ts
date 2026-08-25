import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("Recall desktop window shell", () => {
  it("uses a frameless Electron window with working custom controls", () => {
    const main = read("electron/main/index.ts")
    const titlebar = read("src/components/WindowTitleBar.vue")
    const api = read("src/helpers/api.ts")

    expect(main).toContain("frame: false")
    expect(main).toContain('ipcMain.on("window:minimize"')
    expect(main).toContain('ipcMain.on("window:toggle-maximize"')
    expect(main).toContain('ipcMain.on("window:close"')
    expect(main).not.toContain('win.on("minimize"')
    expect(api).toContain('send("window:minimize")')
    expect(api).toContain('send("window:toggle-maximize")')
    expect(api).toContain('send("window:close")')
    expect(titlebar).toContain("-webkit-app-region: drag")
    expect(titlebar).toContain("-webkit-app-region: no-drag")
    expect(titlebar).toContain('<RecallMark animated class="titlebar-mark" />')
    expect(titlebar).not.toContain("titlebar-wordmark")
  })

  it("keeps the letter mark in the sidebar and uses the full Recall logo elsewhere", () => {
    const mark = read("src/components/RecallMark.vue")
    const sidebar = read("src/components/AppSidebar.vue")
    const titlebar = read("src/components/WindowTitleBar.vue")

    expect(mark).toContain('props.variant === "letter" ? "recall-r.png" : "recall-icon.png"')
    expect(mark).toContain("recall-mark-wave")
    expect(sidebar).toContain('<RecallMark variant="letter" class="brand-logo" />')
    expect(sidebar).toContain('<RecallMark animated class="brand-logo brand-logo-collapsed" />')
    expect(sidebar).toContain('class="brand-mark">ECALL</span>')
    expect(titlebar).toContain('<RecallMark animated class="titlebar-mark" />')
    expect(titlebar).not.toContain("titlebar-wordmark")
  })

  it("ships a transparent 512px Recall logo, letter mark, and multi-resolution favicon", () => {
    const png = readFileSync("public/recall-icon.png")
    const letter = readFileSync("public/recall-r.png")
    const ico = readFileSync("public/favicon.ico")
    const builderIco = readFileSync("build/icon.ico")

    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG")
    expect(png.readUInt32BE(16)).toBe(512)
    expect(png.readUInt32BE(20)).toBe(512)
    expect(png[25]).toBe(6)

    expect(letter.subarray(1, 4).toString("ascii")).toBe("PNG")
    expect(letter.readUInt32BE(16)).toBe(512)
    expect(letter.readUInt32BE(20)).toBe(512)
    expect(letter[25]).toBe(6)

    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(8)
    expect(builderIco.equals(ico)).toBe(true)
  })

  it("routes the creative icon through the window, taskbar, tray, and installer", () => {
    const main = read("electron/main/index.ts")
    const builder = read("electron-builder.json")
    const html = read("index.html")

    expect(main.match(/path\.join\(process\.env\.VITE_PUBLIC, "favicon\.ico"\)/g)).toHaveLength(3)
    expect(builder).toContain('"icon": "public/favicon.ico"')
    expect(html).toContain('<link rel="icon" href="/favicon.ico" />')
  })

  it("suspends cosmetic main-window rendering during games and keeps DevTools opt-in", () => {
    const main = read("electron/main/index.ts")
    const app = read("src/App.vue")
    const mark = read("src/components/RecallMark.vue")
    const style = read("src/style.css")

    expect(main).toContain('process.env.RECALL_OPEN_DEVTOOLS === "1"')
    expect(main).toContain("if (OPEN_DEVTOOLS) win.webContents.openDevTools()")
    expect(app).toContain("document.documentElement.dataset.livePhase = live.phase")
    expect(mark).toContain(':data-live-motion="animated && variant === \'logo\' ? \'ambient\' : undefined"')
    expect(style).toContain('html[data-live-phase="InProgress"] [data-live-motion="ambient"]')
    expect(style).not.toContain('html[data-live-phase="InProgress"] .app-window *')
    expect(style).toContain("animation-play-state: paused !important")
  })
})
