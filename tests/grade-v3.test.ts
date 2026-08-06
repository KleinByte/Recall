import { describe, expect, it } from "vitest"
import {
  componentScore,
  gradeLobbyV3,
  magnitudeScore,
  rankPercentile,
} from "../electron/main/matches/grade-v3.js"
import type { GradeInput } from "../electron/main/matches/grade.js"

const lobby = (): GradeInput[] => Array.from({ length: 10 }, (_, index) => ({
  participantId: index + 1,
  teamId: index < 5 ? 100 : 200,
  isPlayer: index === 0,
  kills: index,
  deaths: 9 - index,
  assists: index + 1,
  damageToChampions: index * 1000,
  damageTaken: (10 - index) * 900,
  damageMitigated: index * 300,
  goldEarned: 8_000 + index * 500,
  csPerMin: index,
  visionScore: index * 2,
  damageObjectives: index * 100,
  role: ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"][index % 5],
}))

describe("Grade v3 formulas", () => {
  it("uses fair ties and a neutral one-peer rank", () => {
    expect(rankPercentile([1], 1)).toBe(.5)
    expect(rankPercentile([1, 2, 2, 4], 2)).toBe(.5)
  })

  it("keeps magnitude, reliability, and the 75/25 score separate", () => {
    expect(magnitudeScore([0, 10], 10)).toBe(1)
    expect(magnitudeScore([0, 10], 0, "inverse")).toBe(1)
    expect(magnitudeScore([0, 0], 0)).toBe(.5)
    const scored = componentScore([0, 10], 10)
    expect(scored.rankPercentile).toBe(1)
    expect(scored.magnitudeScore).toBe(1)
    expect(scored.componentScore).toBe(.75)
    expect(scored.componentScore).not.toBe(scored.rankPercentile)
  })
})

describe("Grade v3 lobby contract", () => {
  it("grades exactly ten unique players on two teams of five with one owner", () => {
    const outcome = gradeLobbyV3(lobby(), "sr")
    expect(outcome.status).toBe("ready")
    expect(outcome.results).toHaveLength(10)
    const result = outcome.results.get(1)!
    expect(result.breakdown.algorithmVersion).toBe(3)
    expect(result.breakdown.components.every((component) =>
      component.peerCount >= 2 && Number.isFinite(component.contribution))).toBe(true)
  })

  it.each([
    lobby().slice(0, 9),
    [...lobby(), { ...lobby()[0], participantId: 11 }],
    lobby().map((row, index) => index === 9 ? { ...row, participantId: 1 } : row),
    lobby().map((row) => ({ ...row, isPlayer: false })),
    lobby().map((row, index) => ({ ...row, isPlayer: index < 2 })),
    lobby().map((row, index) => index === 9 ? { ...row, teamId: 100 } : row),
  ])("rejects malformed lobby shape", (rows) => {
    expect(gradeLobbyV3(rows, "sr").status).toBe("incomplete_lobby")
  })

  it("rejects a missing core value instead of turning it into zero", () => {
    const rows = lobby()
    rows[3] = { ...rows[3], kills: Number.NaN }
    expect(gradeLobbyV3(rows, "sr")).toMatchObject({
      status: "missing_core_metric", results: new Map(),
    })
  })

  it("omits one unavailable optional component lobby-wide and renormalizes", () => {
    const rows = lobby()
    rows[3] = { ...rows[3], visionScore: undefined }
    const outcome = gradeLobbyV3(rows, "sr")
    expect(outcome.status).toBe("ready")
    for (const result of outcome.results.values()) {
      expect(result.breakdown.components.some((component) => component.key === "vision")).toBe(false)
      expect(result.breakdown.components.reduce((sum, component) => sum + component.weight, 0)).toBeCloseTo(1)
    }
  })

  it("uses role peers only when there is exactly one opposing normalized peer", () => {
    const outcome = gradeLobbyV3(lobby(), "sr")
    expect(outcome.results.get(1)?.breakdown.components.find((entry) => entry.key === "economy"))
      .toMatchObject({ comparisonScope: "role", peerCount: 2 })
    const malformedRoles = lobby().map((row, index) => index === 5
      ? { ...row, role: "JUNGLE" }
      : row)
    expect(gradeLobbyV3(malformedRoles, "sr").results.get(1)?.breakdown.components
      .find((entry) => entry.key === "economy")).toMatchObject({
        comparisonScope: "lobby", peerCount: 10,
      })
  })

  it("does not grade unsupported or forced-ineligible matches", () => {
    expect(gradeLobbyV3(lobby(), "other").status).toBe("unsupported_mode")
    expect(gradeLobbyV3(lobby(), "sr", "short_game")).toMatchObject({
      status: "short_game", results: new Map(),
    })
  })
})
