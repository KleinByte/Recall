import { describe, expect, it } from "vitest"
import {
  MOMENTUM_SESSION_GAP_MS,
  performanceMomentum,
} from "../src/helpers/momentum.js"
import type { MatchRow } from "../src/types/stats.js"

const match = (win: boolean, gradeScore: number, gameId: number): MatchRow => ({
  gameId,
  win: win ? 1 : 0,
  gradeScore,
} as MatchRow)

describe("performance momentum", () => {
  it("rests at the midpoint when there is no active session", () => {
    expect(performanceMomentum([])).toMatchObject({
      score: 50,
      label: "Ready",
      streak: 0,
    })
  })

  it("hits overdrive for three straight wins with perfect performance", () => {
    const result = performanceMomentum([
      match(true, 1.55, 3),
      match(true, 1.55, 2),
      match(true, 1.55, 1),
    ])

    expect(result).toMatchObject({
      score: 100,
      label: "Dialed In",
      streak: 3,
      overdriveTier: "gold",
      wins: 3,
      losses: 0,
    })
  })

  it("hits the maximum after four wins with two S and two A grades", () => {
    const result = performanceMomentum([
      match(true, .4, 4),
      match(true, .4, 3),
      match(true, 1.2, 2),
      match(true, 1.2, 1),
    ])

    expect(result).toMatchObject({
      score: 100,
      streak: 4,
      overdriveTier: "emerald",
    })
  })

  it("falls to the bottom for a poor three-game losing streak", () => {
    const result = performanceMomentum([
      match(false, -1.55, 3),
      match(false, -1.55, 2),
      match(false, -1.55, 1),
    ])

    expect(result).toMatchObject({
      score: 0,
      label: "Lock the F in",
      streak: -3,
    })
  })

  it("uses grades as well as outcomes", () => {
    const strong = performanceMomentum([
      match(true, 1.2, 2),
      match(false, 1.2, 1),
    ])
    const weak = performanceMomentum([
      match(true, -1.2, 2),
      match(false, -1.2, 1),
    ])

    expect(strong.score).toBeGreaterThan(weak.score)
  })

  it.each([
    [3, "gold", "Dialed In"],
    [4, "emerald", "Dialed In"],
    [5, "diamond", "Flow State"],
    [6, "master", "Flow State"],
    [7, "master", "Flow State"],
  ] as const)("maps a %i-win hot streak to %s", (wins, tier, label) => {
    const matches = Array.from({ length: wins }, (_, index) =>
      match(true, 1.55, wins - index))

    expect(performanceMomentum(matches)).toMatchObject({
      score: 100,
      streak: wins,
      overdriveTier: tier,
      label,
    })
  })

  it("returns to the midpoint when the active session expires", () => {
    const latestAt = 1_800_000_000_000
    const matches = [0, 1, 2].map((index) => ({
      ...match(true, 1.55, 3 - index),
      playedAt: latestAt - index * 30 * 60_000,
      durationSecs: 1_800,
    }))
    const active = performanceMomentum(matches, latestAt + 1_800_000)
    const expired = performanceMomentum(
      matches,
      latestAt + 1_800_000 + MOMENTUM_SESSION_GAP_MS + 1,
    )

    expect(active.overdriveTier).toBe("gold")
    expect(expired).toMatchObject({ score: 50, label: "Ready", streak: 0 })
    expect(expired.overdriveTier).toBeUndefined()
  })

  it("starts a new session after a 30-minute break between games", () => {
    const latestAt = 1_800_000_000_000
    const matches = [
      { ...match(true, 1.55, 3), playedAt: latestAt, durationSecs: 1_800 },
      {
        ...match(true, 1.55, 2),
        playedAt: latestAt - 60 * 60_000,
        durationSecs: 1_800,
      },
      {
        ...match(true, 1.55, 1),
        playedAt: latestAt - 90 * 60_000,
        durationSecs: 1_800,
      },
    ]

    expect(performanceMomentum(matches, latestAt + 1_800_000)).toMatchObject({
      streak: 1,
      overdriveTier: undefined,
    })

    const continuous = [
      { ...match(true, 1.55, 3), playedAt: latestAt, durationSecs: 1_800 },
      {
        ...match(true, 1.55, 2),
        playedAt: latestAt - 60 * 60_000 + 1,
        durationSecs: 1_800,
      },
      {
        ...match(true, 1.55, 1),
        playedAt: latestAt - 90 * 60_000 + 1,
        durationSecs: 1_800,
      },
    ]
    expect(performanceMomentum(continuous, latestAt + 1_800_000)).toMatchObject({
      streak: 3,
      overdriveTier: "gold",
    })
  })

  it("drops Overdrive immediately after a loss", () => {
    const result = performanceMomentum([
      match(false, -.4, 4),
      match(true, 1.55, 3),
      match(true, 1.55, 2),
      match(true, 1.55, 1),
    ])

    expect(result.streak).toBe(-1)
    expect(result.overdriveTier).toBeUndefined()
    expect(result.score).toBeLessThan(100)
  })

  it("lets an awful latest game pull the active-session dial below neutral", () => {
    const result = performanceMomentum([
      match(false, -1.2, 4),
      match(true, 1.2, 3),
      match(true, 1.2, 2),
      match(true, 1.2, 1),
    ])

    expect(result.streak).toBe(-1)
    expect(result.score).toBeLessThan(50)
  })

  it("does not let an older hot session prop up a new poor session", () => {
    const latestAt = 1_800_000_000_000
    const result = performanceMomentum([
      { ...match(false, -.8, 4), playedAt: latestAt, durationSecs: 1_800 },
      { ...match(true, 1.2, 3), playedAt: latestAt - 2 * 60 * 60_000, durationSecs: 1_800 },
      { ...match(true, 1.2, 2), playedAt: latestAt - 2.5 * 60 * 60_000, durationSecs: 1_800 },
      { ...match(true, 1.2, 1), playedAt: latestAt - 3 * 60 * 60_000, durationSecs: 1_800 },
    ], latestAt + 1_800_000)

    expect(result).toMatchObject({ streak: -1, wins: 0, losses: 1 })
    expect(result.score).toBeLessThan(50)
  })
})
