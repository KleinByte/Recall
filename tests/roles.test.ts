import { describe, expect, it } from "vitest"
import { laneMatchups, positionLabel, resolvePosition } from "../src/helpers/roles"

describe("resolvePosition", () => {
  it("accepts the canonical team position Match-V5 stores in role", () => {
    expect(resolvePosition(undefined, "UTILITY")).toBe("UTILITY")
    expect(resolvePosition("BOTTOM", "BOTTOM")).toBe("BOTTOM")
    expect(resolvePosition("JUNGLE", "JUNGLE")).toBe("JUNGLE")
  })

  it("folds the League Client lane and duo hint into one position", () => {
    expect(resolvePosition("BOTTOM", "DUO_SUPPORT")).toBe("UTILITY")
    expect(resolvePosition("BOTTOM", "DUO_CARRY")).toBe("BOTTOM")
    expect(resolvePosition("MIDDLE", "SOLO")).toBe("MIDDLE")
    expect(resolvePosition("TOP", "SOLO")).toBe("TOP")
  })

  it("reports nothing rather than guessing when the source is empty", () => {
    expect(resolvePosition("NONE", "NONE")).toBeUndefined()
    expect(resolvePosition()).toBeUndefined()
    expect(positionLabel(undefined)).toBe("Unknown")
  })

  it("trusts champion select over Riot's post-game classification", () => {
    expect(resolvePosition("MIDDLE", "SOLO", "UTILITY")).toBe("UTILITY")
    expect(resolvePosition("NONE", "NONE", "JUNGLE")).toBe("JUNGLE")
    expect(resolvePosition("TOP", "SOLO", "")).toBe("TOP")
  })
})

describe("laneMatchups", () => {
  const team = (positions: string[]) =>
    positions.map((role, index) => ({ role, name: `p${index}` }))

  it("puts each player opposite the enemy who played their position", () => {
    const rows = laneMatchups(
      team(["UTILITY", "TOP", "JUNGLE", "BOTTOM", "MIDDLE"]),
      team(["TOP", "MIDDLE", "BOTTOM", "UTILITY", "JUNGLE"]),
    )

    expect(rows.map((row) => row.position)).toEqual([
      "TOP",
      "JUNGLE",
      "MIDDLE",
      "BOTTOM",
      "UTILITY",
    ])
    expect(rows[0].left?.name).toBe("p1")
    expect(rows[0].right?.name).toBe("p0")
  })

  it("falls back to listed order for unknown or duplicated positions", () => {
    const rows = laneMatchups(
      team(["NONE", "NONE"]),
      team(["TOP", "TOP"]),
    )

    expect(rows[0]).toMatchObject({ position: "TOP", right: { name: "p0" } })
    expect(rows[0].left).toBeUndefined()
    expect(rows[1].position).toBeUndefined()
    expect(rows[1].left?.name).toBe("p0")
    expect(rows[1].right?.name).toBe("p1")
  })
})
