import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("Recall branding", () => {
  it("uses the Recall logo as the sidebar brand mark", () => {
    const sidebar = read("src/components/AppSidebar.vue")

    expect(sidebar).toContain('import RecallMark from "./RecallMark.vue"')
    expect(sidebar).toContain('<RecallMark variant="letter" class="brand-logo" />')
    expect(sidebar).toContain('<RecallMark animated class="brand-logo brand-logo-collapsed" />')
    expect(sidebar).toContain('name="brand-recall"')
    expect(sidebar).toContain("recall-brand-depart")
    expect(sidebar).toContain('aria-label="Recall"')
    expect(sidebar).toContain("ECALL")
    expect(sidebar).toContain('class="brand-row"')
    expect(sidebar).not.toMatch(/\.brand-title\s*\{[^}]*position:\s*absolute/s)
  })

  it("supports a persistent collapsible icon rail with accessible controls", () => {
    const sidebar = read("src/components/AppSidebar.vue")
    const app = read("src/App.vue")

    expect(sidebar).toContain("collapsed: boolean")
    expect(sidebar).toContain("update:collapsed")
    expect(sidebar).toContain("faAnglesLeft")
    expect(sidebar).toContain("faAnglesRight")
    expect(sidebar).toContain(':class="{ collapsed }"')
    expect(sidebar).toContain("aria-label")
    expect(app).toContain("sidebarCollapsed")
    expect(app).toContain("@update:collapsed")
    expect(app).toContain("sidebarCollapsed: sidebarCollapsed.value")
  })

  it("uses local League artwork for every navigation destination", () => {
    const sidebar = read("src/components/AppSidebar.vue")

    expect(sidebar).toContain("const navSections: NavigationSection[]")
    for (const destination of [
      "dashboard",
      "live",
      "review",
      "matches",
      "skill",
      "progress",
      "champions",
      "challenges",
      "settings",
    ]) {
      expect(sidebar).toContain(`sidebarIconUrl("${destination}")`)
    }
    expect(sidebar).toContain('publicAssetUrl(`game-data/ui/sidebar/${name}.svg`)')
    expect(sidebar).not.toContain("/game-data/rune-styles/")
    expect(sidebar).not.toContain("/game-data/spells/")
    expect(sidebar).toContain('class="nav-emblem"')
    expect(sidebar).toContain('aria-current="page === item.id ? \'page\' : undefined"')
    expect(sidebar).not.toContain("faChartSimple")
    expect(sidebar).not.toContain("faGear")
  })

  it("uses one stable Windows taskbar identity for the app and package", () => {
    const main = read("electron/main/index.ts")
    const builder = read("electron-builder.json")

    expect(main).toContain('app.setAppUserModelId("com.kleinbyte.recall")')
    expect(builder).toContain('"appId": "com.kleinbyte.recall"')
  })
})
