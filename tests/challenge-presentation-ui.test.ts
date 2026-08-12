import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("challenge objective presentation", () => {
  it("uses one unfinished selector on challenge, dashboard, and goal surfaces", () => {
    const challenges = read("src/pages/ChallengesPage.vue")
    const dashboard = read("src/pages/DashboardPage.vue")
    const progress = read("src/pages/ProgressPage.vue")

    expect(challenges).toContain("selectIncompleteChallenges(challenges.value)")
    expect(dashboard).toContain("selectIncompleteChallenges(challenges.value)")
    expect(progress).toContain("selectIncompleteChallenges(challenges.value)")
    expect(dashboard).not.toContain("challenge.nextThreshold > challenge.currentValue")
  })

  it("states the objective and next milestone in rows and the Dashboard popup", () => {
    const row = read("src/components/ChallengeRow.vue")
    const dashboard = read("src/pages/DashboardPage.vue")
    const modal = read("src/components/ChallengeDetailModal.vue")

    expect(row).toContain('class="objective-label">Objective')
    expect(row).toContain("remaining")
    expect(dashboard).toContain('class="near-objective"')
    expect(dashboard).toContain("Next challenge milestones")
    expect(modal).toContain('aria-label="Challenge objective"')
    expect(modal).toContain("Next milestone")
    expect(modal).toContain("Target reached")
  })
})
