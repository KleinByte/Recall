import { describe, expect, it } from "vitest"
import {
  championStatusFor,
  isChampionChallenge,
} from "../electron/main/challenges/pinned.js"
import type { ChallengeRow } from "../electron/main/challenges/types.js"

const challenge = (overrides: Partial<ChallengeRow> = {}): ChallengeRow =>
  ({
    challengeId: 101_301,
    puuid: "p",
    name: "All Random All Champions",
    description: "Win with different champions in ARAM",
    category: "COLLECTION",
    idListType: "CHAMPION",
    gameModes: "[]",
    currentLevel: "SILVER",
    nextLevel: "GOLD",
    currentValue: 40,
    currentThreshold: 30,
    nextThreshold: 60,
    thresholds: "{}",
    percentile: 0.4,
    pointsAwarded: 15,
    isCapstone: 0,
    isApex: 0,
    isRetired: 0,
    parentId: null,
    iconPath: null,
    completedIds: "[84,22]",
    updatedAt: 0,
    ...overrides,
  }) as ChallengeRow

describe("isChampionChallenge", () => {
  it("recognises a challenge tracked per champion", () => {
    expect(isChampionChallenge(challenge())).toBe(true)
  })

  it("rejects one measured by a running total", () => {
    expect(isChampionChallenge(challenge({ idListType: "NONE" }))).toBe(false)
  })
})

describe("championStatusFor", () => {
  it("reports a champion already done", () => {
    const status = championStatusFor(challenge(), 84)

    expect(status).toEqual({
      challengeId: 101_301,
      name: "All Random All Champions",
      completed: true,
      completedCount: 2,
    })
  })

  it("reports a champion still needed", () => {
    expect(championStatusFor(challenge(), 64)?.completed).toBe(false)
  })

  it("says nothing about a challenge that is not per champion", () => {
    expect(championStatusFor(challenge({ idListType: "NONE" }), 84)).toBeUndefined()
  })

  it("treats an unreadable completed list as nothing completed", () => {
    const status = championStatusFor(challenge({ completedIds: "not json" }), 84)

    expect(status?.completed).toBe(false)
    expect(status?.completedCount).toBe(0)
  })

  it("copes with an empty completed list", () => {
    const status = championStatusFor(challenge({ completedIds: "[]" }), 84)

    expect(status?.completed).toBe(false)
    expect(status?.completedCount).toBe(0)
  })
})
