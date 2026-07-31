import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("Recall branding", () => {
  it("uses the Recall logo as the sidebar brand mark", () => {
    const sidebar = read("src/components/AppSidebar.vue")

    expect(sidebar).toContain('src="/favicon.ico"')
    expect(sidebar).toContain('aria-label="Recall"')
    expect(sidebar).toContain("ECALL")
  })

  it("uses one stable Windows taskbar identity for the app and package", () => {
    const main = read("electron/main/index.ts")
    const builder = read("electron-builder.json")

    expect(main).toContain('app.setAppUserModelId("com.kleinbyte.recall")')
    expect(builder).toContain('"appId": "com.kleinbyte.recall"')
  })
})