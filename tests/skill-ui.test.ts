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
})