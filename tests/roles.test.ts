import { describe, expect, it } from "vitest"
import {
  laneMatchups,
  POSITION_RESOLVER_VERSION,
  positionForPlayer,
  positionLabel,
  resolvePosition,
} from "../src/helpers/roles"
import {
  normalizeTeamPositions,
  resolvePosition as resolveMainPosition,
} from "../electron/main/matches/position.js"

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

  it("uses a current persisted resolution instead of the corrupt raw lane", () => {
    expect(positionForPlayer({
      lane: "JUNGLE",
      role: "NONE",
      resolvedPosition: "TOP",
      positionResolverVersion: POSITION_RESOLVER_VERSION,
    })).toBe("TOP")
  })

  it("prefers Match-V5's played-position estimate to the queue assignment", () => {
    expect(resolvePosition("TOP", "MIDDLE", "UTILITY")).toBe("MIDDLE")
    expect(resolvePosition("JUNGLE", "JUNGLE", "TOP")).toBe("JUNGLE")
  })
})

describe("normalizeTeamPositions", () => {
  it("uses Smite and the canonical legacy role when LCU marks top as jungle", () => {
    const resolved = normalizeTeamPositions([
      {
        participantId: 1,
        teamId: 100,
        legacyLane: "JUNGLE",
        legacyRole: "TOP",
        lcuLane: "JUNGLE",
        lcuRole: "NONE",
        spell1Id: 4,
        spell2Id: 12,
      },
      {
        participantId: 2,
        teamId: 100,
        legacyLane: "JUNGLE",
        legacyRole: "JUNGLE",
        lcuLane: "JUNGLE",
        lcuRole: "NONE",
        spell1Id: 11,
        spell2Id: 4,
      },
      { participantId: 3, teamId: 100, legacyRole: "MIDDLE" },
      { participantId: 4, teamId: 100, legacyRole: "BOTTOM" },
      { participantId: 5, teamId: 100, legacyRole: "UTILITY" },
    ])

    expect([...resolved!.values()]).toEqual([
      "TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY",
    ])
  })

  it("uses the one-of-each team shape when a non-Smite player has only bad jungle data", () => {
    const resolved = normalizeTeamPositions([
      { participantId: 1, teamId: 100, lcuLane: "JUNGLE", lcuRole: "NONE", spell1Id: 4 },
      { participantId: 2, teamId: 100, lcuLane: "JUNGLE", lcuRole: "NONE", spell1Id: 11 },
      { participantId: 3, teamId: 100, lcuLane: "MIDDLE", lcuRole: "SOLO" },
      { participantId: 4, teamId: 100, lcuLane: "BOTTOM", lcuRole: "CARRY" },
      { participantId: 5, teamId: 100, lcuLane: "BOTTOM", lcuRole: "SUPPORT" },
    ])

    expect(resolved?.get(1)).toBe("TOP")
    expect(resolved?.get(2)).toBe("JUNGLE")
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

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ left: { name: "p0" }, right: { name: "p0" } })
    expect(rows[1]).toMatchObject({ left: { name: "p1" }, right: { name: "p1" } })
    expect(rows.every((row) => row.position === undefined)).toBe(true)
  })

  it("seats nobody in a position two of a team both claim", () => {
    const rows = laneMatchups(team(["TOP", "TOP"]), team(["TOP", "JUNGLE"]))

    expect(rows.map((row) => row.left?.name)).toEqual(["p0", "p1"])
    expect(rows.map((row) => row.right?.name)).toEqual(["p0", "p1"])
    expect(rows.every((row) => row.position === undefined)).toBe(true)
  })

  it("keeps Riot's order and exposes no positions for roleless modes", () => {
    const rows = laneMatchups(
      team(["TOP", "JUNGLE", "MIDDLE"]),
      team(["MIDDLE", "TOP", "JUNGLE"]),
      false,
    )

    expect(rows.map((row) => [row.left?.name, row.right?.name])).toEqual([
      ["p0", "p0"],
      ["p1", "p1"],
      ["p2", "p2"],
    ])
    expect(rows.every((row) => row.position === undefined)).toBe(true)
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
