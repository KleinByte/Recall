import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("settings categories", () => {
  it("organizes settings with shared tabs", () => {
    const settings = read("src/pages/SettingsPage.vue")

    expect(settings).toContain("Tabs as UiTabs")
    expect(settings).toContain('label="Settings categories"')
    expect(settings).toContain('{ value: "general", label: "General" }')
    expect(settings).toContain('{ value: "gameplay", label: "Gameplay" }')
    expect(settings).toContain('{ value: "riot-history", label: "Riot & history" }')
    expect(settings).toContain('{ value: "data", label: "Data" }')
    expect(settings).toContain('{ value: "development", label: "Development" }')
    expect(settings).toContain("v-show=\"settingsTab === 'riot-history'\"")
    expect(settings).toContain("v-show=\"settingsTab === 'data'\"")
  })

  it("keeps minimap vision diagnostics development-only", () => {
    const settings = read("src/pages/SettingsPage.vue")
    const main = read("electron/main/index.ts")
    const rendererEntry = read("src/main.ts")

    expect(settings).toContain("const isDevelopment = import.meta.env.DEV")
    expect(settings).toContain(
      "...(isDevelopment ? [{ value: \"development\", label: \"Development\" }] : [])",
    )
    expect(settings).toMatch(
      /v-if="isDevelopment && settingsTab === 'development'"[\s\S]*Keep temporary minimap vision samples/,
    )
    expect(settings).toMatch(
      /v-if="isDevelopment && settingsTab === 'development'"[\s\S]*Enable minimap CV debug overlay/,
    )
    expect(main).toContain("const MINIMAP_VISION_DEBUG_AVAILABLE =")
    expect(main).toContain("Boolean(VITE_DEV_SERVER_URL) && !app.isPackaged")
    expect(main).toContain("if (!MINIMAP_VISION_DEBUG_AVAILABLE) return false")
    expect(main).toContain(
      "MINIMAP_VISION_DEBUG_AVAILABLE &&\n      settingsStore.getMain(\"minimap-vision-debug-enabled\") === true",
    )
    expect(rendererEntry).toContain("const minimapDebug = import.meta.env.DEV &&")
  })

  it("uses concise, accurate updater metadata", () => {
    const packageJson = JSON.parse(read("package.json")) as { description: string }

    expect(packageJson.description).toBe("Game tracking, grades, challenges, and insights.")
    expect(packageJson.description).not.toMatch(/ARAM stat tracker|challenge tracker/i)
  })
})
