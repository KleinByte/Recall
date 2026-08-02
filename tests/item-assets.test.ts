import { access } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import classic from "../src/data/classic-items.json"
import { itemAsset } from "../src/helpers/items"

describe("itemAsset", () => {
  it("resolves packaged item metadata and art", () => {
    expect(itemAsset(3031)).toEqual({
      name: "Infinity Edge",
      iconUrl: "/items/3031.png",
      fallback: false,
    })
  })

  it("uses a local readable fallback for unknown items", () => {
    expect(itemAsset(999999)).toEqual({
      name: "Item 999999",
      iconUrl: "/recall-icon.png",
      fallback: true,
    })
  })

  it("packages every Data Dragon League Classic item icon", async () => {
    expect(classic.mapId).toBe(453)
    expect(classic.items.length).toBeGreaterThan(0)

    for (const item of classic.items) {
      expect(itemAsset(item.id)).toEqual({
        name: item.name,
        iconUrl: `/items/${item.id}.png`,
        fallback: false,
      })
      await expect(access(resolve("public/items", `${item.id}.png`)))
        .resolves.toBeUndefined()
    }
  })
})
