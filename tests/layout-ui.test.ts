import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("desktop page layout", () => {
  it("stacks related dashboard panels independently in two columns", () => {
    const dashboard = read("src/pages/DashboardPage.vue")

    expect(dashboard).toContain('class="dashboard-columns"')
    expect(dashboard).toMatch(
      /class="dashboard-column left-column"[\s\S]*RankedHistoryPanel[\s\S]*title="Recent games"/,
    )
    expect(dashboard).toMatch(
      /class="dashboard-column right-column"[\s\S]*title="Playstyle"[\s\S]*title="Champions in form"/,
    )
    expect(dashboard).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))")
    expect(dashboard).toContain("grid-template-rows: auto minmax(0, 1fr)")
    expect(dashboard).toContain('height="260px"')
  })

  it("makes repeated dashboard cards align within their rows", () => {
    const dashboard = read("src/pages/DashboardPage.vue")

    expect(dashboard).toMatch(/\.kpis \{[\s\S]*grid-auto-rows: 1fr/)
    expect(dashboard).toMatch(/\.categories \{[\s\S]*grid-auto-rows: 1fr/)
    expect(dashboard).toMatch(/\.near-list \{[\s\S]*grid-auto-rows: 1fr/)
  })

  it("aligns variable-height analysis and progress cards", () => {
    const skill = read("src/components/skill/SkillOverview.vue")
    const progress = read("src/pages/ProgressPage.vue")

    expect(skill).toMatch(/\.kpis \{[\s\S]*grid-auto-rows: 1fr/)
    expect(skill).toMatch(/\.metric-grid \{[\s\S]*grid-auto-rows: 1fr/)
    expect(skill).toMatch(/\.overview-grid \{[\s\S]*align-items: stretch/)
    expect(skill).toMatch(/\.playstyle \{[\s\S]*align-items: start/)
    expect(skill).toContain('class="context-grid"')
    expect(skill).toContain('class="contribution-layout"')
    expect(skill).toMatch(/\.context-grid \{[\s\S]*grid-template-columns: repeat\(2/)
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
    expect(review).toContain("sampleTimelineEvents(source, 90)")
  })

  it("shows ranked history from the first reading and plots it on a time axis", () => {
    const dashboard = read("src/pages/DashboardPage.vue")
    const panel = read("src/components/RankedHistoryPanel.vue")
    const rankGraph = read("src/components/RankGraph.vue")

    expect(dashboard).toContain("RankedHistoryPanel")
    expect(panel).toContain('title="Rank over time"')
    expect(panel).toContain('<RankGraph :points="points" />')
    expect(panel).toContain("currentRankedSeason")
    expect(panel).toContain('v-model="selectedQueue"')
    expect(rankGraph).toContain('type: "time"')
    expect(rankGraph).toContain('step: "end"')
    expect(rankGraph).toContain("timestamps.length === 1")
  })

  it("keeps League Classic out of the dashboard feed while retaining queue tags", () => {
    const dashboard = read("src/pages/DashboardPage.vue")
    const matches = read("src/components/MatchList.vue")

    expect(dashboard).toContain("excludeLeagueClassic: true")
    expect(dashboard).not.toContain("2450")
    expect(matches).toContain("match.queueName ?? modeLabel(match.mode)")
  })

  it("scopes personal records with mode tabs", () => {
    const progress = read("src/pages/ProgressPage.vue")

    expect(progress).toContain('role="tablist"')
    expect(progress).toContain('label: "Solo/Duo Ranked"')
    expect(progress).toContain('label: "ARAM"')
    expect(progress).toContain('label: "Mayhem"')
    expect(progress).toContain('label: "All Rift"')
    expect(progress).toContain("excludeLeagueClassic: true")
  })

  it("visually separates the evidence introduction from its accordions", () => {
    const insights = read("src/components/skill/SkillInsights.vue")

    expect(insights).toContain('class="story-head evidence-head"')
    expect(insights).toMatch(/\.evidence-head \{[\s\S]*border-left: 2px solid var\(--cyan\)/)
  })

  it("sorts champions from their table headers instead of separate buttons", () => {
    const champions = read("src/pages/ChampionsPage.vue")

    expect(champions).not.toContain('class="sort-row"')
    expect(champions).toContain('@click="setSort(\'rank\')"')
    expect(champions).toContain('@click="setSort(\'games\')"')
    expect(champions).toContain('@click="setSort(\'needs\')"')
    expect(champions).toContain(":aria-sort=\"ariaSort('winRate')\"")
  })

  it("offers challenge filters for both game mode and map", () => {
    const challenges = read("src/pages/ChallengesPage.vue")

    expect(challenges).toContain('v-model="gameMode"')
    expect(challenges).toContain('v-model="challengeMap"')
    expect(challenges).toContain("challengeMatchesGameMode")
    expect(challenges).toContain("challengeMatchesMap")
  })

  it("uses visual performance charts in insights and names the top champion pool", () => {
    const overview = read("src/components/skill/SkillOverview.vue")
    const insights = read("src/components/skill/SkillInsights.vue")

    expect(overview).toContain("overview.pool.top")
    expect(overview).toContain("championNameById")
    expect(overview).toContain("championIconUrl")
    expect(insights).toContain("OutcomeTrendChart")
    expect(insights).toContain(':rows="report.overview.outcomes.hours"')
    expect(insights).toContain(':rows="report.overview.outcomes.weekdays"')
    expect(insights).toContain(':rows="report.overview.outcomes.duration"')
    expect(insights).toContain("ChampionPoolTreemap")
  })
})
