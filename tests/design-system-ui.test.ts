import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("Recall shared UI system", () => {
  it("publishes semantic tokens and the non-CSS renderer bridge", () => {
    const tokens = read("src/design/tokens.css")
    const theme = read("src/design/theme.ts")
    const spec = read("docs/recall-ui-system.md")

    expect(tokens).toContain('@import "./dial-tokens.css"')

    const requiredTokens = [
      "ui-canvas",
      "ui-shell",
      "ui-sidebar",
      "ui-surface-panel",
      "ui-surface-raised",
      "ui-surface-inset",
      "ui-match-row-background",
      "ui-match-row-hover-background",
      "ui-text",
      "ui-text-heading",
      "ui-text-muted",
      "ui-border",
      "ui-border-emphasis",
      "ui-divider",
      "ui-focus-ring",
      "ui-live",
      "ui-positive",
      "ui-negative",
      "ui-warning",
      "ui-team-blue",
      "ui-team-red",
      "ui-font-body",
      "ui-space-4",
      "ui-radius-md",
      "ui-shadow-panel",
      "ui-control-background",
      "ui-page-max",
      "ui-z-modal",
    ]

    for (const token of requiredTokens) {
      expect(tokens).toMatch(new RegExp(`--${token}:\\s*`))
    }

    expect(tokens).toContain("--surface-0: var(--ui-canvas)")
    expect(tokens).toContain("--text-primary: var(--ui-text)")
    expect(tokens).toContain("--border-subtle: var(--ui-border)")

    expect(theme).toContain("export const UI_THEME")
    for (const role of ["accent", "live", "positive", "negative", "text", "grid", "teamBlue", "teamRed"]) {
      expect(theme).toMatch(new RegExp(`\\b${role}:`))
    }

    expect(spec).toContain("## Architecture")
    expect(spec).toContain("## Intentional specialty visuals")
    expect(spec).toContain("## Acceptance criteria")
  })

  it("exports accessible, token-driven component contracts", () => {
    const barrel = read("src/components/ui/index.ts")
    const components = [
      "Button",
      "Dialog",
      "EmptyState",
      "Field",
      "MiniBar",
      "PageHeader",
      "Panel",
      "ScrollArea",
      "StatTile",
      "Surface",
      "Tabs",
      "TelemetryBoard",
      "TelemetryGrid",
    ]

    for (const component of components) {
      expect(barrel).toContain(`export { default as ${component} }`)
    }
    expect(barrel).toContain("export type { TabOption }")

    const button = read("src/components/ui/Button.vue")
    expect(button).toContain('variant?: "primary" | "secondary" | "ghost" | "danger"')
    expect(button).toContain("var(--ui-control-background)")
    expect(button).toContain("var(--ui-focus-ring)")

    const surface = read("src/components/ui/Surface.vue")
    expect(surface).toContain('variant?: "panel" | "quiet" | "toolbar" | "inset" | "raised" | "instrument"')
    expect(surface).toContain("var(--ui-surface-panel)")
    expect(surface).toContain("var(--ui-surface-inset)")

    const panel = read("src/components/ui/Panel.vue")
    expect(panel).toContain('<Surface as="section"')

    const tabs = read("src/components/ui/Tabs.vue")
    expect(tabs).toContain('role="tablist"')
    expect(tabs).toContain('role="tab"')
    expect(tabs).toContain(':aria-selected="model === option.value"')
    expect(tabs).toContain('<slot name="after" />')
    expect(tabs).toContain("overflow-x: auto")
    expect(tabs).toContain("var(--ui-focus-ring)")

    const dialog = read("src/components/ui/Dialog.vue")
    expect(dialog).toContain('<Teleport to="body">')
    expect(dialog).toContain('role="dialog"')
    expect(dialog).toContain('aria-modal="true"')
    expect(dialog).toContain('event.key === "Escape"')
    expect(dialog).toContain("var(--ui-z-modal)")

    const pageHeader = read("src/components/ui/PageHeader.vue")
    expect(pageHeader).toContain("@container recall-content")
    expect(pageHeader).toContain("var(--ui-text-heading)")
  })

  it("adopts shared page chrome while retaining explicit feature heroes", () => {
    const standardPages = [
      "ChallengesPage",
      "ChampionsPage",
      "LiveGamePage",
      "MatchesPage",
      "ProgressPage",
      "ReviewPage",
      "SettingsPage",
      "SkillPage",
    ]

    for (const page of standardPages) {
      expect(read(`src/pages/${page}.vue`)).toContain("<PageHeader")
    }

    const sharedPageContracts: Record<string, string[]> = {
      ChallengesPage: ["<Surface", "<Field", "<Button"],
      ChampionsPage: ["<Surface", "<Field", "<Button"],
      MatchesPage: ["<Surface", "<Field", "<Button"],
      ProgressPage: ["<Panel", "<UiTabs", "<UiField", "<UiButton"],
      SettingsPage: ["<Panel", "<Surface", "<UiField", "<UiButton"],
      SkillPage: ["<Surface", "<UiTabs", "<UiField", "<UiButton"],
    }

    for (const [page, contracts] of Object.entries(sharedPageContracts)) {
      const source = read(`src/pages/${page}.vue`)
      for (const contract of contracts) expect(source).toContain(contract)
    }

    const dashboard = read("src/pages/DashboardPage.vue")
    expect(dashboard).toContain('class="page-head dashboard-hero"')
    expect(dashboard).toContain("<MomentumGauge")
    expect(dashboard).toContain("<Panel")

    const app = read("src/App.vue")
    expect(app).toContain("container-name: recall-content")
    expect(app).toContain("container-type: inline-size")
  })

  it("protects intentional game, instrument, and brand visuals", () => {
    const gauge = read("src/components/MomentumGauge.vue")
    expect(gauge).toContain('role="meter"')
    expect(gauge).toContain('class="gauge-svg"')
    expect(gauge).toContain('class="hex-cell"')
    expect(gauge).toContain('class="core-gem"')
    expect(gauge).toContain("prefers-reduced-motion")

    const tempo = read("src/components/TempoGauge.vue")
    expect(tempo).toContain('import MomentumGauge from "./MomentumGauge.vue"')
    expect(tempo).toContain('title="Tempo"')
    expect(tempo).toContain(':overdrive-tier="surgeTier"')

    const deathMap = read("src/components/MatchDeathMap.vue")
    expect(deathMap).toContain("reviewMapId(props.match.modeFamily)")
    expect(deathMap).toContain("mapPositionPercent")
    expect(deathMap).toContain('event.type !== "CHAMPION_KILL"')
    expect(deathMap).toContain("selectedParticipantId")
    expect(deathMap).toContain("background-size: 100% 100%")
    expect(deathMap).toContain("object-fit: cover")

    const runePage = read("src/components/RunePage.vue")
    expect(runePage).toContain("classic-rune-board.webp")
    expect(runePage).toContain("classic-masteries-empty.webp")
    expect(runePage).toContain('<Teleport to="body">')

    const grade = read("src/components/GradeBadge.vue")
    const augment = read("src/components/AugmentInsightCard.vue")
    const challenge = read("src/components/ChallengeRow.vue")
    expect(grade).toContain(".grade.s")
    expect(augment).toContain(".rarity-prismatic")
    expect(challenge).toContain(".tier.s")

    const mark = read("src/components/RecallMark.vue")
    const sidebar = read("src/components/AppSidebar.vue")
    expect(mark).toContain('variant?: "logo" | "letter"')
    expect(mark).toContain("prefers-reduced-motion")
    expect(sidebar).toContain('<Transition name="brand-recall"')
    expect(sidebar).toContain('import { publicAssetUrl } from "../helpers/assets"')
    expect(sidebar).toContain('publicAssetUrl(`game-data/ui/sidebar/${name}.svg`)')
    expect(sidebar).toContain('publicAssetUrl("game-data/ui/map11.png")')
    expect(sidebar).not.toContain('art: "/game-data/ui/sidebar')
    expect(sidebar).not.toContain('url("/game-data/ui/map11.png")')

    const titleBar = read("src/components/WindowTitleBar.vue")
    expect(titleBar).toContain("-webkit-app-region: drag")
    expect(titleBar).toContain("-webkit-app-region: no-drag")

    const updateArrival = read("src/components/UpdateRecallAnimation.vue")
    expect(updateArrival).toContain('phase: "startup" | "channeling" | "arrival"')
    expect(updateArrival).toContain("prefers-reduced-motion")
  })
})
