import { describe, expect, it } from "vitest"
import {
  buildStyleProfile,
  type StyleAverages,
} from "../electron/main/matches/style.js"

/** Averages for a player with no leaning in any direction. */
const averages = (overrides: Partial<StyleAverages> = {}): StyleAverages => ({
  games: 20,
  aggression: 0.5,
  damage: 0.5,
  durability: 0.5,
  farming: 0.5,
  objectives: 0.5,
  sustain: 0.5,
  visionPerMin: 1,
  ccPerMin: 10,
  damagePerMin: 1000,
  goldPerMin: 400,
  csPerMin: 6,
  avgDeaths: 5,
  avgLargestSpree: 3,
  doubleKills: 1,
  tripleKills: 0,
  quadraKills: 0,
  pentaKills: 0,
  ...overrides,
})

const axisValue = (
  profile: ReturnType<typeof buildStyleProfile>,
  key: string,
) => profile!.axes.find((axis) => axis.key === key)!.value

describe("buildStyleProfile", () => {
  it("describes a Summoner's Rift game with the axes that mode rewards", () => {
    const profile = buildStyleProfile(averages(), "sr")!

    expect(profile.axes.map((axis) => axis.key)).toEqual([
      "aggression",
      "damage",
      "durability",
      "farming",
      "objectives",
      "vision",
    ])
  })

  it("swaps in the axes that exist on the Howling Abyss", () => {
    const profile = buildStyleProfile(averages(), "aram")!

    // No wards and no objectives to speak of in ARAM.
    expect(profile.axes.map((axis) => axis.key)).toEqual([
      "aggression",
      "damage",
      "durability",
      "farming",
      "sustain",
      "teamfighting",
    ])
  })

  it("passes a ratio axis through unchanged", () => {
    const profile = buildStyleProfile(averages({ damage: 0.72 }), "sr")

    expect(axisValue(profile, "damage")).toBeCloseTo(0.72)
  })

  it("scales vision against the value that fills the ring", () => {
    // Two vision score per minute is a full ring, so one is half.
    expect(axisValue(buildStyleProfile(averages({ visionPerMin: 1 }), "sr"), "vision")).toBeCloseTo(0.5)
    expect(axisValue(buildStyleProfile(averages({ visionPerMin: 0 }), "sr"), "vision")).toBe(0)
  })

  it("scales crowd control against the value that fills the ring", () => {
    expect(
      axisValue(buildStyleProfile(averages({ ccPerMin: 10 }), "aram"), "teamfighting"),
    ).toBeCloseTo(0.5)
  })

  it("clamps a rate above its scale to a full ring rather than overflowing", () => {
    expect(
      axisValue(buildStyleProfile(averages({ visionPerMin: 9 }), "sr"), "vision"),
    ).toBe(1)
    expect(
      axisValue(buildStyleProfile(averages({ ccPerMin: 200 }), "aram"), "teamfighting"),
    ).toBe(1)
  })

  it("gives a damage dealer and a tank opposite shapes", () => {
    const dealer = buildStyleProfile(
      averages({ damage: 0.8, durability: 0.2 }),
      "sr",
    )
    const tank = buildStyleProfile(
      averages({ damage: 0.25, durability: 0.75 }),
      "sr",
    )

    expect(axisValue(dealer, "damage")).toBeGreaterThan(axisValue(tank, "damage"))
    expect(axisValue(tank, "durability")).toBeGreaterThan(
      axisValue(dealer, "durability"),
    )
  })

  it("labels every axis for display", () => {
    for (const axis of buildStyleProfile(averages(), "sr")!.axes) {
      expect(axis.label.length).toBeGreaterThan(0)
    }
  })

  it("reports no profile when no games are recorded", () => {
    expect(buildStyleProfile(averages({ games: 0 }), "sr")).toBeUndefined()
    expect(buildStyleProfile(undefined, "sr")).toBeUndefined()
  })

  it("keeps the game count and detail alongside the shape", () => {
    const profile = buildStyleProfile(averages({ games: 37 }), "sr")!

    expect(profile.games).toBe(37)
    expect(profile.detail.csPerMin).toBe(6)
    expect(profile.detail.avgDeaths).toBe(5)
  })

  it("never returns a value outside the ring", () => {
    // Averages arriving from SQL should already be proportions, but a stray
    // value must not draw outside the chart.
    const profile = buildStyleProfile(
      averages({ damage: 1.4, aggression: -0.2 }),
      "sr",
    )!

    for (const axis of profile.axes) {
      expect(axis.value).toBeGreaterThanOrEqual(0)
      expect(axis.value).toBeLessThanOrEqual(1)
    }
  })
})
