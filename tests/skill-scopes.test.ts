import { describe, expect, it } from "vitest"
import { filterForSkillScope, SKILL_SCOPES } from "../src/helpers/skill-scopes.js"

describe("Skill scopes", () => {
  it("keeps ranked and normal Rift queues separate", () => {
    expect(filterForSkillScope("riftRanked").modes).toEqual([
      "sr_ranked_solo", "sr_ranked_flex",
    ])
    expect(filterForSkillScope("riftNormal").modes).toEqual([
      "sr_normal", "sr_quickplay", "sr_swiftplay",
    ])
  })

  it("defines every stored player-facing mode exactly once in leaf scopes", () => {
    const leaves = SKILL_SCOPES.filter((scope) => scope.kind === "leaf")
      .flatMap((scope) => scope.modes)
    expect(leaves).toEqual([
      "sr_ranked_solo", "sr_ranked_flex", "sr_normal",
      "sr_quickplay", "sr_swiftplay", "aram", "mayhem", "league_classic",
    ])
    expect(new Set(leaves).size).toBe(leaves.length)
  })

  it("returns fresh arrays that can cross Electron IPC", () => {
    const first = filterForSkillScope("riftAll")
    const second = filterForSkillScope("riftAll")
    expect(first.modes).not.toBe(second.modes)
    expect(() => structuredClone(first)).not.toThrow()
  })
})
