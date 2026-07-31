import { describe, expect, it } from "vitest"
import { classifyPlaystyle } from "../src/helpers/playstyle"
import type { StyleAxis } from "../src/types/stats"

const axes = (values: Record<string, number>): StyleAxis[] =>
  Object.entries(values).map(([key, value]) => ({
    key, label: key, value, description: key, formula: key,
  }))

describe("classifyPlaystyle", () => {
  it("waits for a useful sample before assigning an identity", () => {
    expect(classifyPlaystyle(axes({ aggression: 0.9, damage: 0.8 }), 4).label)
      .toBe("Developing Identity")
  })

  it("names the two strongest Rift tendencies", () => {
    const result = classifyPlaystyle(axes({
      aggression: 0.76, damage: 0.72, durability: 0.4,
      farming: 0.5, objectives: 0.3, vision: 0.35,
    }), 30)

    expect(result.label).toBe("Duelist")
    expect(result.axes).toEqual(["aggression", "damage"])
  })

  it("names ARAM-specific combinations regardless of axis order", () => {
    expect(classifyPlaystyle(axes({
      aggression: 0.3, damage: 0.5, durability: 0.4,
      farming: 0.35, sustain: 0.81, teamfighting: 0.77,
    }), 20).label).toBe("Battle Medic")
  })

  it("uses a single-axis identity when one spoke clearly dominates", () => {
    expect(classifyPlaystyle(axes({
      aggression: 0.35, damage: 0.4, durability: 0.86,
      farming: 0.42, sustain: 0.3, teamfighting: 0.36,
    }), 20).label).toBe("Frontliner")
  })

  it("recognizes balanced profiles", () => {
    expect(classifyPlaystyle(axes({
      aggression: 0.7, damage: 0.68, durability: 0.66,
      farming: 0.67, objectives: 0.65, vision: 0.64,
    }), 40).label).toBe("All-Rounder")

    expect(classifyPlaystyle(axes({
      aggression: 0.5, damage: 0.48, durability: 0.46,
      farming: 0.47, objectives: 0.45, vision: 0.44,
    }), 40).label).toBe("Flexible")
  })
})
