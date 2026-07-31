import { describe, expect, it } from "vitest"
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
})
