import { describe, expect, it } from "vitest"
import { overlayContentFor } from "../electron/main/challenges/pinned.js"
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

describe("overlayContentFor", () => {
  it("says nothing when no challenge is pinned", () => {
    expect(overlayContentFor([], 84)).toBeUndefined()
  })

  it("says nothing when no champion is being held", () => {
    expect(overlayContentFor([challenge()], null)).toBeUndefined()
  })

  it("says nothing when the pins cannot speak about champions", () => {
    // A challenge measured by a running total has no opinion on a champion.
    expect(
      overlayContentFor([challenge({ idListType: "NONE" })], 84),
    ).toBeUndefined()
  })

  it("reports a champion still needed", () => {
    const content = overlayContentFor([challenge()], 64)!

    expect(content.championId).toBe(64)
    expect(content.needed).toHaveLength(1)
    expect(content.done).toHaveLength(0)
  })

  it("reports a champion already done, which is worth knowing too", () => {
    // In ARAM this is the cue to reroll or trade it away.
    const content = overlayContentFor([challenge()], 84)!

    expect(content.needed).toHaveLength(0)
    expect(content.done).toHaveLength(1)
  })

  it("separates the pins that need this champion from those that do not", () => {
    const content = overlayContentFor(
      [
        challenge({ challengeId: 1, completedIds: "[84]" }),
        challenge({ challengeId: 2, name: "Protean Override", completedIds: "[]" }),
      ],
      84,
    )!

    expect(content.done.map((row) => row.challengeId)).toEqual([1])
    expect(content.needed.map((row) => row.challengeId)).toEqual([2])
  })

  it("leaves non-champion pins out rather than listing them blankly", () => {
    const content = overlayContentFor(
      [challenge(), challenge({ challengeId: 9, idListType: "NONE" })],
      64,
    )!

    expect(content.needed).toHaveLength(1)
    expect(content.done).toHaveLength(0)
  })

  it("keeps a pinned non-champion challenge out while evaluating an ARAM champion pin", () => {
    const content = overlayContentFor(
      [
        challenge({ challengeId: 1, name: "All Random All Champions", completedIds: "[]" }),
        challenge({ challengeId: 2, idListType: "NONE", name: "Deal damage" }),
      ],
      64,
    )!

    expect(content.needed.map((status) => status.challengeId)).toEqual([1])
    expect(content.done).toEqual([])
  })

  it("ignores a retired challenge, which no amount of play advances", () => {
    // The live client carries retired seasonal copies such as
    // "All Random All Champs: 2024 Split 1", still tracked per champion.
    // Calling a champion "needed" for one of those is a lie.
    expect(
      overlayContentFor([challenge({ isRetired: 1 })], 64),
    ).toBeUndefined()
  })

  it("still speaks for the live challenge beside a retired one", () => {
    const content = overlayContentFor(
      [
        challenge({ challengeId: 2024105, isRetired: 1 }),
        challenge({ challengeId: 101301, isRetired: 0 }),
      ],
      64,
    )!

    expect(content.needed.map((row) => row.challengeId)).toEqual([101301])
  })
})
