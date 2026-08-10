import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { GRADE_V3_ROLE_FIT_THRESHOLDS } from "../electron/main/matches/grade-v3-recipe.js"
import { RECALL_ROLE_FIT_THRESHOLDS } from "../src/shared/recall-grade.js"

describe("RoleFit UI contract", () => {
  it("uses the exact authoritative Grade v3 letter bands", () => {
    expect(RECALL_ROLE_FIT_THRESHOLDS).toEqual(GRADE_V3_ROLE_FIT_THRESHOLDS)
  })

  it("keeps compatibility-score grade derivation out of visible v3 views", () => {
    const paths = [
      "src/pages/DashboardPage.vue",
      "src/pages/MatchesPage.vue",
      "src/pages/ChampionsPage.vue",
      "src/pages/LiveGamePage.vue",
      "src/components/ChampionDetail.vue",
      "src/components/skill/SkillOverview.vue",
      "src/components/skill/SkillInsights.vue",
    ]
    for (const path of paths) {
      expect(readFileSync(path, "utf8"), path).not.toContain("gradeFromScore")
    }
  })
})
