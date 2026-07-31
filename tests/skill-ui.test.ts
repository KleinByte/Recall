import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("Skill Overview", () => {
  it("offers queue and season-selectable ranked growth history", () => {
    const page = read("src/pages/SkillPage.vue")
    const ranked = read("src/components/RankedHistoryPanel.vue")

    expect(page).toContain("RankedHistoryPanel")
    expect(page).toContain("allow-season-selection")
    expect(ranked).toContain("All seasons")
    expect(ranked).toContain('v-model="selectedQueue"')
    expect(ranked).toContain('v-model="selectedSeason"')
    expect(ranked).toContain("change")
  })

  it("uses literal Recall and playstyle copy", () => {
    const overview = read("src/components/skill/SkillOverview.vue")

    expect(overview).toContain("Avg Recall grade")
    expect(overview).toContain("graded")
    expect(overview).toContain("axis.formula")
    expect(overview).not.toMatch(/strengths|weaknesses|you play best|to work on/i)
  })

  it("keeps interpretation-only rates out of Overview", () => {
    const overview = read("src/components/skill/SkillOverview.vue")

    expect(overview).not.toContain("coreWinRate")
    expect(overview).not.toContain("restWinRate")
    expect(overview).not.toMatch(/item.*winRate/i)
  })

  it("labels lobby comparison scope and custom grade coverage", () => {
    const overview = read("src/components/skill/SkillOverview.vue")

    expect(overview).toContain("metric.scope")
    expect(overview).toContain("Recall grade")
    expect(overview).toContain("gradedGames")
  })

  it("uses an animated diverging chart for playstyle changes", () => {
    const overview = read("src/components/skill/SkillOverview.vue")
    const deltaChart = read("src/components/skill/StyleDeltaChart.vue")

    expect(overview).toContain("StyleDeltaChart")
    expect(overview).toContain("overview.style.career")
    expect(overview).toContain("styleComparison")
    expect(overview).toContain("style?.earlier")
    expect(overview).toContain("style.recent")
    expect(deltaChart).toContain('type: "bar"')
    expect(deltaChart).toContain('type: "category"')
    expect(deltaChart).toContain("markLine")
    expect(deltaChart).toContain("BaseEChart")
    expect(deltaChart).not.toContain("chart.js")
  })

  it("restores the useful historical playstyle and outcome visuals", () => {
    const overview = read("src/components/skill/SkillOverview.vue")

    expect(overview).toContain(":recent=")
    expect(overview).toContain("Last 10 games")
    expect(overview).toContain("DriftChart")
    expect(overview).toContain("OutcomeTrendChart")
    expect(overview).toContain("Game length")
    expect(overview).toContain("Time of day")
  })
})

describe("Skill Insights", () => {
  it("renders the chart-led story chapters in order", () => {
    const insights = read("src/components/skill/SkillInsights.vue")

    expect(insights).toMatch(
      /01 · Form[\s\S]*02 · Grade DNA[\s\S]*03 · Rhythm[\s\S]*04 · Match shape[\s\S]*05 · Champion pool[\s\S]*06 · Evidence/,
    )
    expect(insights).toContain("GradeJourneyChart")
    expect(insights).toContain("GradeDnaHeatmap")
    expect(insights).toContain("PlayCalendarChart")
    expect(insights).toContain("WeekdayGradeBoxplot")
    expect(insights).toContain("DurationGradeScatter")
    expect(insights).toContain("ChampionPoolTreemap")
  })

  it("shows evidence, sample size, intervals, and timezone context", () => {
    const insights = read("src/components/skill/SkillInsights.vue")
    const finding = read("src/components/skill/InsightFinding.vue")

    expect(finding).toContain("evidenceLevel")
    expect(finding).toContain("eligibleGames")
    expect(finding).toContain("games")
    expect(finding).toContain("95%")
    expect(finding).toContain("rateInterval")
    expect(finding).toContain("finding.games }} games")
    expect(finding).toContain("finding.eligibleGames }} eligible in scope")
    expect(insights).toContain("timezoneLabel")
    expect(insights).toContain("percentile point (PP)")
    expect(insights).toContain('class="detail-pane"')
  })

  it("keeps every predictive result visible in the collapsed evidence pane", () => {
    const insights = read("src/components/skill/SkillInsights.vue")

    expect(insights).toContain("report.insights.predictive.state")
    expect(insights).toContain("report.insights.predictive.message")
    expect(insights).toContain("predictiveEntries")
    expect(insights).toContain("Predictive model")
  })

  it("leads with a Recall Grade identity and ECharts evidence", () => {
    const insights = read("src/components/skill/SkillInsights.vue")
    const finding = read("src/components/skill/InsightFinding.vue")
    const overview = read("src/components/skill/SkillOverview.vue")
    const effectChart = read("src/components/skill/EffectChart.vue")

    expect(insights).toContain("One grade. Eight signals. Every match in context.")
    expect(insights).toContain("grade-identity")
    expect(insights).toContain("EffectChart")
    expect(finding).toContain("findingItemAsset")
    expect(finding).toContain("findingSummary")
    expect(finding).toContain("Stronger games")
    expect(overview).toContain("itemAsset")
    expect(effectChart).toContain('type: "bar"')
    expect(effectChart).toContain('type: "category"')
    expect(effectChart).toContain("BaseEChart")
  })

  it("resolves finding labels and keeps detailed evidence condensed", () => {
    const insights = read("src/components/skill/SkillInsights.vue")

    expect(insights).toContain("findingLabel")
    expect(insights).toContain("confidentFindings")
    expect(insights).toContain("evidenceEntries")
    expect(insights).toContain('v-for="section in sections"')
    expect(insights).toContain("InsightFinding")
    expect(insights).toContain(":entries=\"predictiveEntries\"")
  })

  it("uses ECharts everywhere and leaves reduced motion to the shared wrapper", () => {
    const wrapper = read("src/components/charts/BaseEChart.vue")
    const packageJson = read("package.json")

    expect(wrapper).toContain("prefers-reduced-motion")
    expect(wrapper).toContain("ResizeObserver")
    expect(packageJson).toContain('"echarts": "6.1.0"')
    expect(packageJson).not.toContain('"chart.js"')
    expect(packageJson).not.toContain('"vue-chartjs"')
  })

  it("keeps generated report copy associative", () => {
    const reportSource = read("electron/main/matches/skill-report.ts").toLowerCase()

    for (const forbidden of [" causes ", " makes you ", " optimal ", " true skill "]) {
      expect(reportSource).not.toContain(forbidden)
    }
  })
})

describe("Skill page coordination", () => {
  it("keeps tabs local and uses one report fetch path", () => {
    const page = read("src/pages/SkillPage.vue")

    expect(page).toContain('type SkillTab = "overview" | "insights"')
    expect(page).toContain('ref<SkillTab>("overview")')
    expect(page).toContain("<SkillInsights")
    expect(page.match(/getSkillReport/g)).toHaveLength(1)
    expect(page).not.toMatch(/@click="[^\"]*loadReport[^\"]*"[^>]*>\s*Insights/)
  })

  it("uses match-style selects for mode, season, role, and champion filters", () => {
    const page = read("src/pages/SkillPage.vue")

    expect(page).toContain("riftScopes")
    expect(page).toContain("otherScopes")
    expect(page).toContain("counts[scope.id]")
    expect(page).toContain('v-model="season"')
    expect(page).toContain('v-model="role"')
    expect(page).toContain('v-model="championId"')
    expect(page).toContain('class="league-select"')
    expect(page).not.toContain('class="scope-button')
  })
})
