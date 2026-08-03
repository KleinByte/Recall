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
    expect(titlebar).toContain("v{{ currentAppVersion }}")
  })

  it("uses the supplied special R as the first letter of Recall", () => {
    const mark = read("src/components/RecallMark.vue")
    const sidebar = read("src/components/AppSidebar.vue")
    const titlebar = read("src/components/WindowTitleBar.vue")

    expect(mark).toContain(":src=\"publicAssetUrl('recall-icon.png')\"")
    expect(sidebar).toContain('<RecallMark class="brand-logo" />')
    expect(sidebar).toContain('class="brand-mark">ECALL</span>')
    expect(titlebar).toContain('<RecallMark class="titlebar-mark" />')
    expect(titlebar).toContain('class="titlebar-wordmark">ECALL</span>')
  })

  it("ships a transparent 512px UI mark and a multi-resolution favicon", () => {
    const png = readFileSync("public/recall-icon.png")
    const ico = readFileSync("public/favicon.ico")

    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG")
    expect(png.readUInt32BE(16)).toBe(512)
    expect(png.readUInt32BE(20)).toBe(512)
    expect(png[25]).toBe(6)

    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(8)
  })
})
