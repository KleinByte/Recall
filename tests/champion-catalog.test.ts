import { describe, expect, it } from "vitest"
import { mergeChampionCatalog } from "../electron/main/champion-catalog.js"

const champion = (id: number, name: string) => ({
  id,
  alias: name.toLowerCase(),
  name,
  roles: ["mage"],
  isVisibleInClient: true,
})

describe("persistent champion catalog", () => {
  it("keeps previously fetched champions when a later response is partial", () => {
    const merged = mergeChampionCatalog(
      [champion(103, "Ahri"), champion(123, "Remembered champion")],
      [champion(103, "Ahri, the Nine-Tailed Fox")],
    )

    expect(merged.find((entry) => entry.id === 123)?.name).toBe(
      "Remembered champion",
    )
    expect(merged.find((entry) => entry.id === 103)?.name).toBe(
      "Ahri, the Nine-Tailed Fox",
    )
  })

  it("ignores placeholders and malformed entries", () => {
    const merged = mergeChampionCatalog([], [
      champion(22, "Ashe"),
      champion(0, "None"),
      { id: 999 },
    ])

    expect(merged.map((entry) => entry.name)).toEqual(["Ashe"])
  })

  it("remembers hidden positive-id entries for offline match labels", () => {
    const hidden = {
      ...champion(123, "Future champion"),
      isVisibleInClient: false,
    }

    expect(mergeChampionCatalog([], [hidden])).toEqual([
      { ...hidden, primaryArchetype: "specialist" },
    ])
  })

  it("enriches live and legacy cached entries from the current Grade taxonomy", () => {
    const catalog = mergeChampionCatalog([
      {
        id: 103,
        alias: "Ahri",
        name: "Ahri",
        roles: ["mage", "assassin"],
        primaryArchetype: "specialist",
        isVisibleInClient: true,
      },
    ])

    expect(catalog).toEqual([
      expect.objectContaining({
        id: 103,
        primaryArchetype: "burst_mage",
      }),
    ])
  })

  it("canonicalizes League Classic ids when enriching the catalog", () => {
    const [tristana] = mergeChampionCatalog([], [{
      id: 60_018,
      alias: "Tristana",
      name: "Tristana",
      roles: ["marksman"],
      isVisibleInClient: true,
    }])

    expect(tristana.primaryArchetype).toBe("marksman")
  })
})
