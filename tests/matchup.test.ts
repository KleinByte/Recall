import { describe, expect, it } from "vitest"
import { compareMatchup, MATCHUP_STATS } from "../src/helpers/matchup"
import type { ParticipantRow } from "../src/types/stats"

const player = (overrides: Partial<ParticipantRow> = {}) =>
  ({
    kills: 0,
    deaths: 0,
    assists: 0,
    champLevel: 0,
    totalMinionsKilled: 0,
    neutralMinions: 0,
    goldEarned: 0,
    damageToChampions: 0,
    physicalDamageToChampions: 0,
    magicDamageToChampions: 0,
    trueDamageToChampions: 0,
    damageTaken: 0,
    damageSelfMitigated: 0,
    totalHeal: 0,
    totalUnitsHealed: 0,
    timeCcingOthers: 0,
    visionScore: 0,
    wardsPlaced: 0,
    wardsKilled: 0,
    controlWards: 0,
    damageObjectives: 0,
    damageTurrets: 0,
    turretKills: 0,
    largestKillingSpree: 0,
    largestMultiKill: 0,
    ...overrides,
  }) as ParticipantRow

const row = (rows: ReturnType<typeof compareMatchup>, key: string) =>
  rows.find((entry) => entry.key === key)!

describe("compareMatchup", () => {
  it("scales both bars against the larger of the pair", () => {
    const rows = compareMatchup(
      player({ damageToChampions: 10000 }),
      player({ damageToChampions: 40000 }),
    )

    expect(row(rows, "damage")).toMatchObject({
      leftShare: 0.25,
      rightShare: 1,
      leads: "right",
    })
  })

  it("gives the lead to whoever died less", () => {
    const rows = compareMatchup(player({ deaths: 2 }), player({ deaths: 9 }))

    expect(row(rows, "deaths").leads).toBe("left")
  })

  it("leaves stats nobody wins unclaimed", () => {
    const rows = compareMatchup(
      player({ damageTaken: 30000, kills: 4 }),
      player({ damageTaken: 10000, kills: 4 }),
    )

    expect(row(rows, "damageTaken").leads).toBe("none")
    expect(row(rows, "kills").leads).toBe("none")
  })

  it("counts jungle camps towards creep score", () => {
    const rows = compareMatchup(
      player({ totalMinionsKilled: 30, neutralMinions: 120 }),
      player({ totalMinionsKilled: 200, neutralMinions: 0 }),
    )

    expect(row(rows, "cs").left).toBe(150)
    expect(row(rows, "cs").right).toBe(200)
  })

  it("still lists every stat when a lane has no opponent", () => {
    const rows = compareMatchup(player({ kills: 5 }), undefined)

    expect(rows).toHaveLength(MATCHUP_STATS.length)
    expect(row(rows, "kills")).toMatchObject({ right: 0, leads: "none" })
  })
})
