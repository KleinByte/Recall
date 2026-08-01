import { describe, expect, it } from "vitest"
import { normalizeAugmentId } from "../src/helpers/game-assets"

describe("game asset normalization", () => {
  it("accepts numeric augment ids and rejects malformed catalog keys", () => {
    expect(normalizeAugmentId(1234)).toBe(1234)
    expect(normalizeAugmentId("5678")).toBe(5678)
    expect(normalizeAugmentId("undefined")).toBeUndefined()
    expect(normalizeAugmentId(Number.NaN)).toBeUndefined()
    expect(normalizeAugmentId(0)).toBeUndefined()
  })
})
