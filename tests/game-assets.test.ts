import { describe, expect, it } from "vitest"
import {
  normalizeAugmentId,
  normalizeAugmentRarity,
  timelineObjectiveIconUrl,
} from "../src/helpers/game-assets"

describe("game asset normalization", () => {
  it("accepts numeric augment ids and rejects malformed catalog keys", () => {
    expect(normalizeAugmentId(1234)).toBe(1234)
    expect(normalizeAugmentId("5678")).toBe(5678)
    expect(normalizeAugmentId("undefined")).toBeUndefined()
    expect(normalizeAugmentId(Number.NaN)).toBeUndefined()
    expect(normalizeAugmentId(0)).toBeUndefined()
  })

  it("normalizes Riot's prefixed augment rarity values", () => {
    expect(normalizeAugmentRarity("kSilver")).toBe("Silver")
    expect(normalizeAugmentRarity("kGold")).toBe("Gold")
    expect(normalizeAugmentRarity("kPrismatic")).toBe("Prismatic")
    expect(normalizeAugmentRarity("gold")).toBe("Gold")
    expect(normalizeAugmentRarity(3)).toBe("Prismatic")
    expect(normalizeAugmentRarity("unknown")).toBeUndefined()
  })

  it("maps timeline objectives to League client match-history icons", () => {
    expect(timelineObjectiveIconUrl("ELITE_MONSTER_KILL", "BARON_NASHOR", 200))
      .toMatch(/baron-200\.png$/)
    expect(timelineObjectiveIconUrl("ELITE_MONSTER_KILL", "RIFTHERALD", 100))
      .toMatch(/herald-100\.png$/)
    expect(timelineObjectiveIconUrl("BUILDING_KILL", "TOWER_BUILDING", 100))
      .toMatch(/tower-100\.png$/)
    expect(timelineObjectiveIconUrl("BUILDING_KILL", "INHIBITOR_BUILDING", 200))
      .toMatch(/inhibitor-200\.png$/)
  })
})
