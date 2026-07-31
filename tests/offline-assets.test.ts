import { describe, expect, it } from "vitest"
import { championNameById } from "../src/helpers/format"
import { itemAsset } from "../src/helpers/items"

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
})