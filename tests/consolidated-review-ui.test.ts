import fs from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => fs.readFileSync(path, "utf8")

describe("consolidated match review UI", () => {
  it("routes match clicks into Review and exposes title-bar history", () => {
    const app = read("src/App.vue")
    const navigation = read("src/helpers/navigation.ts")
    const titlebar = read("src/components/WindowTitleBar.vue")

    expect(app).not.toContain("<MatchSheet")
    expect(navigation).toContain("reviewGameId?: number")
    expect(navigation).toContain("export function goBack()")
    expect(navigation).toContain("export function goForward()")
    expect(navigation).toMatch(/openMatch[\s\S]*reviewMatch\(match\.gameId\)/)
    expect(titlebar).toContain('aria-label="Page history"')
    expect(titlebar).toContain(":disabled=\"!canGoBack\"")
    expect(titlebar).toContain(":disabled=\"!canGoForward\"")
    expect(titlebar).toContain('event.key === "ArrowLeft"')
    expect(titlebar).toContain('event.key === "ArrowRight"')
    expect(titlebar).toContain('title="Back (Alt+Left)"')
  })

  it("uses one tabbed match destination with the requested review surfaces", () => {
    const review = read("src/pages/ReviewPage.vue")

    expect(review).toContain("<MatchReviewHero")
    expect(review).toContain('type MatchTab = "overview" | "stats" | "timeline" | "probability"')
    expect(review).toContain("<ReviewScoreboard")
    expect(review).toContain("<MatchStatsTable")
    expect(review).toContain("<PerformanceRadar")
    expect(review).toContain("<WinProbabilityChart")
    expect(review).toContain("RVI profile")
    expect(review).toContain("Grade &amp; context")
    expect(review).not.toContain('id: "gold"')
    expect(review).toContain('v-if="matchTab === \'timeline\'" class="card match-tab-panel"')
    expect(review).toContain('class="gold-chart-wrap"')
    expect(review).not.toContain("Every build, role, rune page, and contribution at a glance")
    expect(review).not.toContain("Complete lobby")
  })

  it("returns teams and labels as part of the unified review payload", () => {
    const service = read("electron/main/review/review-service.ts")
    const types = read("src/types/review.ts")

    expect(service).toContain("teams: detail.teams")
    expect(service).toContain("labels: this.matches.getPerformanceLabels")
    expect(types).toContain("teams: TeamRow[]")
    expect(types).toContain("labels: PerformanceLabel[]")
  })

  it("keeps interactive rune pages in the Blitz-inspired scoreboard", () => {
    const scoreboard = read("src/components/ReviewScoreboard.vue")

    expect(scoreboard).toContain("<RunePage")
    expect(scoreboard).toContain(":classic=\"match.modeFamily === 'classic'\"")
    expect(scoreboard).toContain("team-bans")
    expect(scoreboard).toContain("damage-cell")
  })
})
