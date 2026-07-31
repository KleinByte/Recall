import { describe, expect, it } from "vitest"
import {
  challengeMatchesCategory,
  challengeTierProgress,
  isChallengeCompleted,
  sortChallenges,
} from "../src/helpers/challenges.js"
import type { ChallengeRow } from "../src/types/stats.js"

const challenge = (
  overrides: Partial<ChallengeRow> = {},
): ChallengeRow => ({
  challengeId: 1,
  puuid: "owner",
  name: "Challenge",
  description: "",
  category: "EXPERTISE",
  idListType: "NONE",
  gameModes: "[]",
  currentLevel: "GOLD",
  nextLevel: "PLATINUM",
  currentValue: 48,
  currentThreshold: 30,
  nextThreshold: 50,
  thresholds: "{}",
  percentile: null,
  pointsAwarded: 0,
  isCapstone: 0,
  isApex: 0,
  isRetired: 0,
  parentId: null,
  iconPath: null,
  completedIds: "[]",
  updatedAt: 1,
  ...overrides,
})

describe("challenge presentation helpers", () => {
  it("measures progress within the current tier", () => {
    expect(challengeTierProgress(challenge())).toBe(0.9)
  })

  it("treats a challenge without another tier as completed", () => {
    expect(
      isChallengeCompleted(
        challenge({ nextLevel: null, nextThreshold: null }),
      ),
    ).toBe(true)
    expect(isChallengeCompleted(challenge())).toBe(false)
  })

  it("sorts the closest challenge first", () => {
    const rows = [
      challenge({ challengeId: 1, name: "Halfway", currentValue: 40 }),
      challenge({ challengeId: 2, name: "Nearly there", currentValue: 49 }),
    ]

    expect(
      sortChallenges(rows, "closest", "desc").map((row) => row.challengeId),
    ).toEqual([2, 1])
  })

  it("sorts tiers in either direction", () => {
    const rows = [
      challenge({ challengeId: 1, name: "Gold", currentLevel: "GOLD" }),
      challenge({ challengeId: 2, name: "Master", currentLevel: "MASTER" }),
      challenge({ challengeId: 3, name: "Iron", currentLevel: "IRON" }),
    ]

    expect(
      sortChallenges(rows, "level", "desc").map((row) => row.currentLevel),
    ).toEqual(["MASTER", "GOLD", "IRON"])
    expect(
      sortChallenges(rows, "level", "asc").map((row) => row.currentLevel),
    ).toEqual(["IRON", "GOLD", "MASTER"])
  })

  it("hides legacy challenges until LEGACY is selected", () => {
    const active = challenge({ category: "EXPERTISE" })
    const legacy = challenge({ category: "LEGACY" })

    expect(challengeMatchesCategory(active, "All")).toBe(true)
    expect(challengeMatchesCategory(legacy, "All")).toBe(false)
    expect(challengeMatchesCategory(legacy, "EXPERTISE")).toBe(false)
    expect(challengeMatchesCategory(legacy, "LEGACY")).toBe(true)
    expect(challengeMatchesCategory(active, "LEGACY")).toBe(false)
  })
})
