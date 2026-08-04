import { readFileSync, statSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("Skill Overview", () => {
  it("makes RVI the single performance identity below ranked history", () => {
    const overview = read("src/components/skill/SkillOverview.vue")
    const profile = read("src/components/skill/PerformanceProfile.vue")
    const engine = read("electron/main/matches/performance-profile.ts")

    expect(overview).toMatch(/RankedHistoryPanel[\s\S]*PerformanceProfile[\s\S]*title="Recorded comparisons"/)
    expect(overview).toContain("classifyRviIdentity")
    expect(overview).toContain("overview.performance")
    expect(overview).not.toContain("classifyPlaystyle")
    expect(overview).not.toContain('title="Playstyle"')
    expect(profile).toContain("Recall Vector Index")
    expect(profile).toContain("RVI playstyle")
    expect(profile).toContain("How RVI measures it")
    expect(profile).toContain("measurement-table")
    expect(profile).toContain("segment-meter")
    expect(profile).toContain(':aria-expanded="detailsOpen"')
    expect(profile).toContain('v-if="detailsOpen"')
    expect(profile).toContain("Influence")
    expect(profile).toContain("metric.games")
    expect(profile).toContain("dimension-grid")
    expect(engine).toContain("RVI_ALGORITHM_VERSION")
  })

  it("offers queue and season-selectable ranked growth history", () => {
    const overview = read("src/components/skill/SkillOverview.vue")
    const ranked = read("src/components/RankedHistoryPanel.vue")

    expect(overview).toContain("RankedHistoryPanel")
    expect(overview).toContain("allow-season-selection")
    expect(overview).toMatch(/RankedHistoryPanel[\s\S]*compact[\s\S]*PerformanceProfile/)
    expect(ranked).toContain("All seasons")
    expect(ranked).toContain('v-model="selectedQueue"')
    expect(ranked).toContain('v-model="selectedSeason"')
    expect(ranked).toContain("change")
  })

  it("uses literal Recall and an RVI-native identity", () => {
    const overview = read("src/components/skill/SkillOverview.vue")

    expect(overview).toContain("Avg grade")
    expect(overview).toContain("TelemetryBoard")
    expect(overview).toContain("graded")
    expect(overview).toContain("rviIdentity")
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

  it("removes the duplicate playstyle presentation", () => {
    const overview = read("src/components/skill/SkillOverview.vue")

    expect(overview).not.toContain("StyleRadar")
    expect(overview).not.toContain("StyleDeltaChart")
    expect(overview).not.toContain("DriftChart")
    expect(overview).toContain(':identity="rviIdentity"')
  })

  it("keeps the useful scoped outcome visuals", () => {
    const overview = read("src/components/skill/SkillOverview.vue")

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

  it("orders Grade Journey history chronologically", () => {
    const insights = read("src/components/skill/SkillInsights.vue")

    expect(insights).toContain(".sort((left, right) => left.playedAt - right.playedAt)")
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
    expect(effectChart).toContain("numericChartValue")
    expect(effectChart).toContain(':height="chartHeight"')
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

    expect(page).toContain('type SkillTab = "overview" | "insights" | "analyze"')
    expect(page).toContain('ref<SkillTab>("overview")')
    expect(page).toContain("<SkillInsights")
    expect(page).toContain("<SkillAnalyze")
    expect(page).toContain("Analyze")
    expect(page).toMatch(/Overview[\s\S]*Insights[\s\S]*Analyze/)
    expect(page.match(/getSkillReport/g)).toHaveLength(1)
    expect(page).not.toMatch(/@click="[^\"]*loadReport[^\"]*"[^>]*>\s*Insights/)
  })

  it("uses compact selects and a searchable visual champion picker", () => {
    const page = read("src/pages/SkillPage.vue")
    const championPicker = read("src/components/ChampionPicker.vue")

    expect(page).toContain("riftScopes")
    expect(page).toContain("abyssScopes")
    expect(page).toContain("classicScopes")
    expect(page).toContain("counts[scope.id]")
    expect(page).toContain('v-model="season"')
    expect(page).toContain('v-model="role"')
    expect(page).toContain('v-model="championId"')
    expect(page).toContain("ChampionPicker")
    expect(page).toContain('class="league-select"')
    expect(page).not.toContain('class="scope-button')
    expect(championPicker).toContain('type="search"')
    expect(championPicker).toContain('class="champion-grid"')
    expect(championPicker).toContain("championIconUrl")
    expect(championPicker).toContain('role="listbox"')
  })

  it("maps persisted death density over an optimized Rift image", () => {
    const overview = read("src/components/skill/SkillOverview.vue")
    const analyze = read("src/components/skill/SkillAnalyze.vue")
    const heatmap = read("src/components/skill/DeathHeatmap.vue")
    const mapAsset = statSync("public/summoners-rift-base.webp")

    expect(overview).not.toContain("DeathHeatmap")
    expect(analyze).toContain("DeathHeatmap")
    expect(analyze).toContain("report.overview.deathMap")
    expect(analyze).toContain("report.scope.family === 'sr'")
    expect(heatmap).toContain('type: "heatmap"')
    expect(heatmap).toContain('type: "scatter"')
    expect(heatmap).toContain('type: "category"')
    expect(heatmap).toContain("xAxisIndex: 1")
    expect(heatmap).toContain("yAxisIndex: 1")
    expect(heatmap).toContain("Array.isArray(item.data)")
    expect(heatmap).toContain("nearbyDeaths")
    expect(heatmap).toContain("nearby death")
    expect(heatmap).toContain("% of deaths in this selection")
    expect(heatmap).toContain("Average death")
    expect(heatmap).not.toContain("relative density")
    expect(heatmap).toContain("summoners-rift-base.webp")
    expect(heatmap).toMatch(/mode,\s*season, role, and champion filters above/)
    expect(heatmap).toContain("before 15 min")
    expect(heatmap).toContain("15–30 min")
    expect(heatmap).toContain("Heat overlay")
    expect(heatmap).toContain("Death dots")
    expect(heatmap).toContain("visualization")
    expect(heatmap).not.toContain("Rank hotspots")
    expect(heatmap).toContain("rankedHotspots")
    expect(heatmap).toContain("HEAT_STOPS")
    expect(heatmap).toContain('class="map-layout"')
    expect(heatmap).toContain('class="hotspot-aside"')
    expect(mapAsset.size).toBeLessThan(1_000_000)
  })

  it("builds Analyze from honest RVI and Recall Grade views", () => {
    const analyze = read("src/components/skill/SkillAnalyze.vue")
    const signatures = read("src/components/skill/MatchSignaturesChart.vue")
    const form = read("src/components/skill/PerformanceFormChart.vue")

    expect(analyze).toContain("PerformanceFormChart")
    expect(analyze).toContain("MatchSignaturesChart")
    expect(analyze).toContain("SessionEnduranceChart")
    expect(analyze).toContain("ChampionQuadrantChart")
    expect(analyze).toContain("ChampionLearningCurve")
    expect(analyze).toContain("classifyRviIdentity")
    expect(analyze).toContain("per-match comparison percentiles, not RVI vector scores")
    expect(signatures).toContain('type: "parallel"')
    expect(form).toContain("dimension.delta")
    expect(form).toContain('import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"')
    expect(form).toContain("color: CHART_COLOURS.text")
    expect(form).toContain("textBorderWidth: 0")
    expect(analyze).toContain("align-items: stretch")
    expect(analyze).toContain("height: 100%")
  })
})
