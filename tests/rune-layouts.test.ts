import { existsSync, statSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  CLASSIC_RUNE_CAPACITY,
  CLASSIC_RUNE_SLOTS,
  placeClassicRunes,
} from "../src/helpers/rune-layouts"

const selection = (runeId: number, count?: number) => ({
  runeId,
  slot: 0,
  var1: 0,
  var2: 0,
  var3: 0,
  count,
  kind: "classic" as const,
})

describe("Classic rune board", () => {
  it("keeps the historical 9 / 9 / 9 / 3 socket capacity", () => {
    expect(CLASSIC_RUNE_CAPACITY).toEqual({
      kMark: 9,
      kSeal: 9,
      kGlyph: 9,
      kQuintessence: 3,
    })
    expect(Object.values(CLASSIC_RUNE_SLOTS).flat()).toHaveLength(30)
  })

  it("expands counted runes into real sockets and caps overflow", () => {
    const metadata = {
      1: { type: "kMark" },
      2: { type: "kSeal" },
      3: { type: "kQuintessence" },
    }
    const placed = placeClassicRunes([
      selection(1, 99),
      selection(2, 2),
      selection(3, 3),
    ], metadata)

    expect(placed.filter((entry) => entry.type === "kMark")).toHaveLength(9)
    expect(placed.filter((entry) => entry.type === "kSeal")).toHaveLength(2)
    expect(placed.filter((entry) => entry.type === "kQuintessence")).toHaveLength(3)
  })

  it("does not guess a socket for an unknown rune", () => {
    expect(placeClassicRunes([selection(404)], {})).toEqual([])
  })

  it("ships both neutral board assets for offline reviews", () => {
    for (const asset of [
      "public/game-data/ui/classic-rune-board.webp",
      "public/game-data/ui/classic-masteries-empty.webp",
    ]) {
      expect(existsSync(asset)).toBe(true)
      expect(statSync(asset).size).toBeGreaterThan(10_000)
    }
  })
})
