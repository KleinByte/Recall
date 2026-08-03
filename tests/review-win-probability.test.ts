import { describe, expect, it } from "vitest"
import { reviewWinProbability } from "../src/helpers/review-win-probability"
import type { TimelineSummary } from "../src/types/review"

const frame = (timestamp: number, blueGold: number, redGold: number) => ({
  timestamp,
  blueGold,
  redGold,
  ownerGold: 0,
  ownerLevel: 1,
  ownerXp: 0,
  ownerCs: 0,
  participants: [],
})

describe("review win probability", () => {
  it("starts even and moves toward the team with timestamp-safe advantages", () => {
    const summary: TimelineSummary = {
      frames: [frame(0, 2_500, 2_500), frame(600_000, 18_000, 15_500)],
      events: [{
        eventId: "kill",
        timestamp: 300_000,
        type: "CHAMPION_KILL",
        category: "kill",
        teamId: 100,
      }],
      turningPoints: [],
    }

    const points = reviewWinProbability(summary)
    expect(points[0].blue).toBe(50)
    expect(points[1].blue).toBeGreaterThan(56)
    expect(points[1].killDifference).toBe(1)
  })

  it("never presents false certainty", () => {
    const summary: TimelineSummary = {
      frames: [frame(1_800_000, 80_000, 10_000)],
      events: [],
      turningPoints: [],
    }
    expect(reviewWinProbability(summary)[0].blue).toBe(92)
  })

  it("does not leak a future event into an earlier frame", () => {
    const summary: TimelineSummary = {
      frames: [frame(300_000, 10_000, 10_000), frame(700_000, 10_000, 10_000)],
      events: [{
        eventId: "late-baron",
        timestamp: 600_000,
        type: "ELITE_MONSTER_KILL",
        category: "objective",
        objective: "BARON_NASHOR",
        teamId: 200,
      }],
      turningPoints: [],
    }
    const points = reviewWinProbability(summary)
    expect(points[0].blue).toBe(50)
    expect(points[1].blue).toBeLessThan(45)
  })
})
