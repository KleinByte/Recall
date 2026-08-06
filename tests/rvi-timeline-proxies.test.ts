import { describe, expect, it } from "vitest"
import {
  isWithinObjectiveProximity,
  qualifiesAsEarlyRoam,
  qualifiesAsObjectiveSetupWard,
} from "../electron/main/matches/rvi-contract.js"

describe("RVI timeline proxy boundaries", () => {
  it("requires before 15:00, outside lane, and a non-lane opponent for roams", () => {
    const base = { timestamp: 899_999, ownerPosition: { x: 7_000, y: 5_000 },
      ownerRole: "MIDDLE" as const, opponentParticipantId: 6,
      enemyParticipantIds: [6, 7] }
    expect(qualifiesAsEarlyRoam(base)).toMatchObject({ state: "observed", value: true })
    expect(qualifiesAsEarlyRoam({ ...base, timestamp: 900_000 }).state).toBe("not_applicable")
    expect(qualifiesAsEarlyRoam({ ...base, ownerPosition: { x: 7_000, y: 7_000 } }))
      .toMatchObject({ value: false })
    expect(qualifiesAsEarlyRoam({ ...base, enemyParticipantIds: [6] }))
      .toMatchObject({ value: false })
  })

  it("uses inclusive 1,500-unit and 60-second objective proximity", () => {
    expect(isWithinObjectiveProximity({ x: 0, y: 0 }, { x: 1_500, y: 0 }, 60_000, 0))
      .toMatchObject({ value: true })
    expect(isWithinObjectiveProximity({ x: 0, y: 0 }, { x: 1_501, y: 0 }, 60_000, 0))
      .toMatchObject({ value: false })
  })

  it("requires a spatial owner ward action 30–90 seconds before an owner-team objective", () => {
    const base = { objectiveTimestamp: 100_000, objectiveTeamId: 100, ownerTeamId: 100,
      objectivePosition: { x: 0, y: 0 }, wardTimestamp: 70_000,
      wardPosition: { x: 1_500, y: 0 }, wardAction: "placed" as const }
    expect(qualifiesAsObjectiveSetupWard(base)).toMatchObject({ value: true })
    expect(qualifiesAsObjectiveSetupWard({ ...base, wardTimestamp: 10_000 })).toMatchObject({ value: true })
    expect(qualifiesAsObjectiveSetupWard({ ...base, wardAction: "purchased" })).toMatchObject({ value: false })
    expect(qualifiesAsObjectiveSetupWard({ ...base, objectiveTeamId: 200 })).toMatchObject({ value: false })
    expect(qualifiesAsObjectiveSetupWard({ ...base, wardPosition: undefined }).state).toBe("unavailable")
  })
})
