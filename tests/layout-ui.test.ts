import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("desktop page layout", () => {
  it("stacks related dashboard panels independently in two columns", () => {
    const dashboard = read("src/pages/DashboardPage.vue")

    expect(dashboard).toContain('class="dashboard-columns"')
    expect(dashboard).toMatch(
      /class="dashboard-column"[\s\S]*title="Rank"[\s\S]*title="Recent games"/,
    )
    expect(dashboard).toMatch(
      /class="dashboard-column"[\s\S]*title="Playstyle"[\s\S]*title="Champions in form"/,
    )
    expect(dashboard).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))")
  })

  it("makes repeated dashboard cards align within their rows", () => {
    const dashboard = read("src/pages/DashboardPage.vue")

    expect(dashboard).toMatch(/\.kpis \{[\s\S]*grid-auto-rows: 1fr/)
    expect(dashboard).toMatch(/\.categories \{[\s\S]*grid-auto-rows: 1fr/)
    expect(dashboard).toMatch(/\.near-list \{[\s\S]*grid-auto-rows: 1fr/)
  })

  it("aligns variable-height analysis and progress cards", () => {
    const skill = read("src/pages/SkillPage.vue")
    const progress = read("src/pages/ProgressPage.vue")

    expect(skill).toMatch(/\.kpis \{[\s\S]*grid-auto-rows: 1fr/)
    expect(skill).toMatch(/\.metric-grid \{[\s\S]*grid-auto-rows: 1fr/)
    expect(skill).toMatch(/\.triple \{[\s\S]*align-items: stretch/)
    expect(skill).toMatch(/\.playstyle \{[\s\S]*align-items: start/)
    expect(progress).toMatch(/\.records \{[\s\S]*grid-auto-rows: 1fr/)
  })

  it("uses distinct champion-select and in-game live layouts", () => {
    const live = read("src/pages/LiveGamePage.vue")

    expect(live).toContain("live.phase === 'ChampSelect'")
    expect(live).toContain('class="choice-table"')
    expect(live).toContain("composition-card")
    expect(live).toContain("live-scoreboard")
    expect(live).toContain("live.game.activePlayer")
  })

  it("places event icons directly on the timeline graph", () => {
    const review = read("src/pages/ReviewPage.vue")

    expect(review).toContain('class="gold-chart-wrap"')
    expect(review).toContain('class="chart-marker"')
    expect(review).toContain("timelineMarkerIcon")
    expect(review).toContain("timelineMarkerTitle")
  })
})
