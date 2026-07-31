import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("Skill Overview", () => {
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
    expect(deltaChart).toContain('indexAxis: "y"')
    expect(deltaChart).toContain("prefers-reduced-motion")
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
  it("renders the seven approved sections in order", () => {
    const insights = read("src/components/skill/SkillInsights.vue")

    expect(insights).toMatch(
      /Best-game pattern[\s\S]*Playing conditions[\s\S]*Predictive signals[\s\S]*Game shape[\s\S]*Trends[\s\S]*Champion choices[\s\S]*Item associations/,
    )
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
    expect(insights).toContain("Times use this device's current timezone")
    expect(insights).toContain("timezoneLabel")
  })

  it("states every predictive result distinctly", () => {
    const insights = read("src/components/skill/SkillInsights.vue")

    expect(insights).toContain("Not enough graded history for predictive signals")
    expect(insights).toContain("No repeatable pregame signal yet")
    expect(insights).toContain("Repeatable pregame signals")
    expect(insights).toContain("Predictive analysis unavailable")
  })

  it("leads with visual takeaways and locally named items", () => {
    const insights = read("src/components/skill/SkillInsights.vue")
    const finding = read("src/components/skill/InsightFinding.vue")
    const overview = read("src/components/skill/SkillOverview.vue")
    const effectChart = read("src/components/skill/EffectChart.vue")

    expect(insights).toContain("Top takeaways")
    expect(insights).toContain("selectTakeaways")
    expect(insights).toContain("EffectChart")
    expect(finding).toContain("findingItemAsset")
    expect(finding).toContain("findingSummary")
    expect(finding).toContain("Stronger games")
    expect(overview).toContain("itemAsset")
    expect(effectChart).toContain('indexAxis: "y"')
    expect(effectChart).toContain("prefers-reduced-motion")
  })

  it("resolves item finding labels and charts every comparable section", () => {
    const insights = read("src/components/skill/SkillInsights.vue")

    expect(insights).toContain("findingLabel")
    expect(insights).toContain("findingSummary")
    expect(insights).toContain("takeawayEntries")
    expect(insights).toContain("sectionEffectGroups")
    expect(insights).toContain("group.entries")
    expect(insights).toContain(":entries=\"predictiveEntries\"")
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

  it("shows persistent counted primary and Rift scope rows", () => {
    const page = read("src/pages/SkillPage.vue")

    expect(page).toContain("PRIMARY_MODES")
    expect(page).toContain("riftScopes")
    expect(page).toContain("counts[scope.id]")
    expect(page).toMatch(/\.scope-row \{[\s\S]*flex-wrap: wrap/)
    expect(page).toMatch(/\.scope-button \{[\s\S]*min-height: 34px/)
  })
})