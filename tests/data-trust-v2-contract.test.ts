import { describe, expect, it } from "vitest"
import { SCOREBOARD_SHAPE_CONTRACTS_V1, scoreboardShapeState } from "../electron/main/matches/source-capabilities.js"

describe("Data Trust v2 shape contracts", () => {
  it("grades only the five exact standard capability shapes", () => {
    expect(Object.keys(SCOREBOARD_SHAPE_CONTRACTS_V1)).toEqual([
      "rift_draft", "rift_no_bans", "aram", "mayhem", "league_classic",
    ])
    const lobby = Array.from({ length: 10 }, (_, index) => ({
      participantId: index + 1, teamId: index < 5 ? 100 : 200, owner: index === 0,
    }))
    expect(scoreboardShapeState("aram", lobby)).toBe("complete")
    expect(scoreboardShapeState("aram", lobby.slice(0, 9))).toBe("incomplete")
    expect(scoreboardShapeState("arena", lobby)).toBe("mode_specific_unknown")
    expect(scoreboardShapeState("unknown", lobby)).toBe("mode_specific_unknown")
  })
})
