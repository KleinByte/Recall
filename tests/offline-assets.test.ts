import { describe, expect, it } from "vitest"
import { championNameById } from "../src/helpers/format"
import { findingLabel, findingSummary } from "../src/helpers/insight-findings"
import { itemAsset } from "../src/helpers/items"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { summonerSpellIconUrl } from "../src/helpers/ddragon"
import runeCatalog from "../src/data/rune-catalog.json"

describe("offline renderer assets", () => {
  it("uses a packaged-relative URL for a known item", () => {
    const item = itemAsset(1001)

    expect(item.name).toBe("Boots")
    expect(item.iconUrl).toMatch(/items\/1001\.png$/)
    expect(item.iconUrl.startsWith("/")).toBe(true)
  })

  it("resolves known champion names without a live-client catalog", () => {
    expect(championNameById(null, 103)).toBe("Ahri")
  })

  it("prefers the live-client catalog when it is available", () => {
    expect(championNameById([{ id: 103, name: "Live Ahri" }], 103)).toBe("Live Ahri")
  })

  it("uses bundled names for item findings in labels and summary copy", () => {
    const finding = {
      key: "item:3020",
      title: "Item 3020",
      summary: "Item 3020 associated with higher grades.",
    }

    expect(findingLabel(finding)).toBe("Sorcerer's Shoes")
    expect(findingSummary(finding)).toBe("Sorcerer's Shoes associated with higher grades.")
  })

  it("bundles modern and League Classic rune and spell art", () => {
    expect(runeCatalog.modern).toHaveLength(103)
    expect(runeCatalog.classic).toHaveLength(50)
    expect(summonerSpellIconUrl(74)).toBe("/game-data/spells/74.png")
    expect(existsSync(resolve("public/game-data/spells/74.png"))).toBe(true)
    expect(existsSync(resolve("public/game-data/runes/775337.png"))).toBe(true)
  })
})
