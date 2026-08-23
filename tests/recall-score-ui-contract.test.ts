import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { MATCH_GRADE_SCORE_THRESHOLDS } from "../electron/main/matches/match-grade-recipe.js"
import { RECALL_SCORE_THRESHOLDS } from "../src/shared/recall-grade.js"

describe("Recall Score UI contract", () => {
  it("uses the exact authoritative match Grade letter bands", () => {
    expect(RECALL_SCORE_THRESHOLDS).toEqual(MATCH_GRADE_SCORE_THRESHOLDS)
  })

  it("keeps compatibility-score grade derivation out of visible views", () => {
    const paths = [
      "src/pages/DashboardPage.vue",
      "src/pages/MatchesPage.vue",
      "src/pages/ChampionsPage.vue",
      "src/pages/LiveGamePage.vue",
      "src/pages/ChampionDetailPage.vue",
      "src/components/skill/SkillOverview.vue",
      "src/components/skill/SkillInsights.vue",
    ]
    for (const path of paths) {
      expect(readFileSync(path, "utf8"), path).not.toContain("gradeFromScore")
    }
  })
})
