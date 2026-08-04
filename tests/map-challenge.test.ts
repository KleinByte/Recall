import { describe, expect, it } from "vitest"
import { mapChallengeRow } from "../electron/main/challenges/map-challenge.js"
import type { LcuChallenge } from "../electron/main/challenges/types.js"

const PUUID = "me"

/** Mirrors challenge 101301 as returned by the live client. */
const challenge = (overrides: Partial<LcuChallenge> = {}): LcuChallenge =>
  ({
    id: 101301,
    name: "All Random All Champions",
    description: "Win with different champions in ARAM",
    descriptionShort: "Win with different champions in ARAM",
    category: "IMAGINATION",
    idListType: "CHAMPION",
    gameModes: ["ARAM"],
    currentLevel: "GOLD",
    nextLevel: "PLATINUM",
    currentValue: 48,
    currentThreshold: 30,
    nextThreshold: 50,
    thresholds: {
      IRON: { value: 1, rewards: [] },
      GOLD: { value: 30, rewards: [] },
      PLATINUM: { value: 50, rewards: [] },
    },
    percentile: 5.9,
    pointsAwarded: 25,
    isCapstone: false,
    isApex: false,
    retireTimestamp: 0,
    parentId: 101300,
    iconPath: "/path/icon.png",
    completedIds: [1, 2, 3],
    availableIds: [],
    friendsAtLevels: [],
    ...overrides,
  }) as LcuChallenge

describe("mapChallengeRow", () => {
  it("maps the fields Recall stores", () => {
    const row = mapChallengeRow(challenge(), PUUID)

    expect(row).toMatchObject({
      challengeId: 101301,
      puuid: PUUID,
      name: "All Random All Champions",
      category: "IMAGINATION",
      idListType: "CHAMPION",
      currentLevel: "GOLD",
      nextLevel: "PLATINUM",
      currentValue: 48,
      nextThreshold: 50,
      pointsAwarded: 25,
      parentId: 101300,
    })
  })

  it("stores list-shaped fields as JSON", () => {
    const row = mapChallengeRow(challenge(), PUUID)

    expect(JSON.parse(row.completedIds)).toEqual([1, 2, 3])
    expect(JSON.parse(row.gameModes)).toEqual(["ARAM"])
    expect(JSON.parse(row.thresholds).PLATINUM.value).toBe(50)
  })

  it("marks a challenge retired when it has a retire timestamp", () => {
    expect(mapChallengeRow(challenge(), PUUID).isRetired).toBe(0)
    expect(
      mapChallengeRow(challenge({ retireTimestamp: 1_700_000 }), PUUID)
        .isRetired,
    ).toBe(1)
  })

  it("records capstone and apex flags", () => {
    const row = mapChallengeRow(
      challenge({ isCapstone: true, isApex: true }),
      PUUID,
    )

    expect(row.isCapstone).toBe(1)
    expect(row.isApex).toBe(1)
  })

  it("never stores other players' identifiers", () => {
    const raw = challenge({
      friendsAtLevels: [
        { level: "IRON", friends: ["friend-puuid-a", "friend-puuid-b"] },
        { level: "GOLD", friends: ["friend-puuid-c"] },
      ],
    })

    const row = mapChallengeRow(raw, PUUID)

    // Friends' PUUIDs are other people's data and have no purpose here.
    expect(JSON.stringify(row)).not.toContain("friend-puuid")
    expect(Object.keys(row)).not.toContain("friendsAtLevels")
  })

  it("tolerates a challenge with no next level", () => {
    const row = mapChallengeRow(
      challenge({ nextLevel: undefined, nextThreshold: undefined }),
      PUUID,
    )

    expect(row.nextLevel).toBeNull()
    expect(row.nextThreshold).toBeNull()
  })
})
