import { describe, expect, it } from "vitest"
import { laneMatchups, positionLabel, resolvePosition } from "../src/helpers/roles"
import { resolvePosition as resolveMainPosition } from "../electron/main/matches/position.js"

describe("resolvePosition", () => {
  it("stays identical in the renderer and main process", () => {
    const cases: Array<[string?, string?, string?]> = [
      ["TOP", "SOLO"],
      ["BOTTOM", "SUPPORT"],
      ["BOTTOM", "CARRY"],
      ["NONE", "SUPPORT"],
      ["JUNGLE", "TOP"],
      ["TOP", "MIDDLE", "UTILITY"],
      ["NONE", "NONE", "JUNGLE"],
    ]

    for (const values of cases) {
      expect(resolveMainPosition(...values)).toBe(resolvePosition(...values))
    }
  })

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

  it("prefers the stated team position to the client's lane", () => {
    // The client hands back whole teams as JUNGLE; role still names the lane.
    expect(resolvePosition("JUNGLE", "TOP")).toBe("TOP")
    expect(resolvePosition("JUNGLE", "MIDDLE")).toBe("MIDDLE")
  })

  it("ignores a duo hint with no lane to place it in", () => {
    // Short games come back with every player marked SUPPORT and no lane.
    expect(resolvePosition("NONE", "SUPPORT")).toBeUndefined()
    expect(resolvePosition("NONE", "DUO")).toBeUndefined()
    expect(resolvePosition("", "DUO_CARRY")).toBeUndefined()
  })

  it("uses champion select when no canonical post-game position exists", () => {
    expect(resolvePosition("MIDDLE", "SOLO", "UTILITY")).toBe("UTILITY")
    expect(resolvePosition("NONE", "NONE", "JUNGLE")).toBe("JUNGLE")
    expect(resolvePosition("TOP", "SOLO", "")).toBe("TOP")
  })

  it("prefers Match-V5's played-position estimate to the queue assignment", () => {
    expect(resolvePosition("TOP", "MIDDLE", "UTILITY")).toBe("MIDDLE")
    expect(resolvePosition("JUNGLE", "JUNGLE", "TOP")).toBe("JUNGLE")
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

  it("falls back to listed order when a position is unknown", () => {
    const rows = laneMatchups(
      team(["NONE", "NONE"]),
      team(["TOP", "JUNGLE"]),
    )

    expect(rows[0]).toMatchObject({ position: "TOP", right: { name: "p0" } })
    expect(rows[0].left).toBeUndefined()
    expect(rows[1]).toMatchObject({ position: "JUNGLE", right: { name: "p1" } })
    expect(rows[2].position).toBeUndefined()
    expect(rows[2].left?.name).toBe("p0")
  })

  it("seats nobody in a position two of a team both claim", () => {
    const rows = laneMatchups(team(["TOP", "TOP"]), team(["TOP", "JUNGLE"]))

    expect(rows.find((row) => row.position === "TOP")?.left).toBeUndefined()
    expect(rows.filter((row) => !row.position).map((row) => row.left?.name)).toEqual([
      "p0",
      "p1",
    ])
  })

  it("keeps all ten when the client calls the whole team junglers", () => {
    // Straight from a stored game: lane is JUNGLE for two, role names the lane.
    const blue = [
      { lane: "JUNGLE", role: "TOP", name: "top" },
      { lane: "JUNGLE", role: "JUNGLE", name: "jungle" },
      { lane: "MIDDLE", role: "MIDDLE", name: "mid" },
      { lane: "BOTTOM", role: "BOTTOM", name: "bot" },
      { lane: "BOTTOM", role: "UTILITY", name: "support" },
    ]
    const rows = laneMatchups(blue, [])

    expect(rows.map((row) => row.left?.name)).toEqual([
      "top",
      "jungle",
      "mid",
      "bot",
      "support",
    ])
  })
})
