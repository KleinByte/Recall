import { describe, expect, it } from "vitest"
import { canonicalChampionId, championIconUrl, championNameById } from "../src/helpers/format"
import { findingLabel, findingSummary } from "../src/helpers/insight-findings"
import { itemAsset } from "../src/helpers/items"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { summonerSpellIconUrl } from "../src/helpers/ddragon"
import { runeMetrics } from "../src/helpers/runes"
import { playbackWorldObjectiveIconUrl, timelineObjectiveIconUrl } from "../src/helpers/game-assets"
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

  it("resolves League Classic champion aliases to canonical portrait and name assets", () => {
    expect(canonicalChampionId(60103)).toBe(103)
    expect(championIconUrl(60103)).toMatch(/champion-icons\/103\.png$/)
    expect(championNameById(null, 60103)).toBe("Ahri")
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

  it("bundles objective art used by match review and map playback", () => {
    const urls = [
      playbackWorldObjectiveIconUrl("baron"),
      playbackWorldObjectiveIconUrl("herald"),
      playbackWorldObjectiveIconUrl("void-grub"),
      timelineObjectiveIconUrl("ELITE_MONSTER_KILL", "ELDER_DRAGON", 200)!,
      timelineObjectiveIconUrl("ELITE_MONSTER_KILL", "HORDE", 100)!,
    ]

    expect(urls.every((url) => !/^https?:/.test(url))).toBe(true)
    expect(urls.every((url) => existsSync(resolve("public", url.replace(/^\//, ""))))).toBe(true)
  })

  it("routes dynamic public art through the embedded-build base", () => {
    const spells = readFileSync("src/helpers/ddragon.ts", "utf8")
    const runes = readFileSync("src/helpers/runes.ts", "utf8")
    const mark = readFileSync("src/components/RecallMark.vue", "utf8")

    expect(spells).toContain("publicAssetUrl(`game-data/spells/${spellId}.png`)")
    expect(runes).toContain("publicAssetUrl(`game-data/runes/${runeId}.png`)")
    expect(runes).toContain("publicAssetUrl(`game-data/rune-styles/${styleId}.png`)")
    expect(mark).toContain(":src=\"publicAssetUrl(assetName)\"")
    expect(mark).toContain('"recall-r.png" : "recall-icon.png"')
    expect(spells).not.toContain("return `/game-data/spells/")
    expect(runes).not.toContain("? `/game-data/runes/")
  })

  it("resolves reordered end-of-game rune placeholders", () => {
    const metrics = runeMetrics({ runeId: 8135, slot: 5, var1: 130, var2: 5, var3: 0, kind: "modern" })

    expect(metrics).toContain("Total Stacks: 5")
    expect(metrics).toContain("Gold Collected: 130")
    expect(metrics.join(" ")).not.toContain("@eogvar")
  })
})
