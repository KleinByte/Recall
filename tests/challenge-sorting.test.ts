import { describe, expect, it } from "vitest"
import {
  buildChallengeGroups,
  challengeGameModeLabel,
  challengeGameModes,
  challengeKind,
  challengeMatchesGameMode,
  challengeMatchesGroup,
  challengeMatchesKind,
  challengeMatchesMap,
  challengeMatchesCategory,
  challengeTierProgress,
  isChallengeCompleted,
  selectIncompleteChallenges,
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

  it("treats exact-target and over-completed challenges as completed", () => {
    const oneOfOne = challenge({ currentValue: 1, currentThreshold: 0, nextThreshold: 1 })
    const overCompleted = challenge({ currentValue: 3, currentThreshold: 0, nextThreshold: 1 })

    expect(isChallengeCompleted(oneOfOne)).toBe(true)
    expect(isChallengeCompleted(overCompleted)).toBe(true)
    expect(isChallengeCompleted(challenge({ currentValue: 0, nextThreshold: 1 }))).toBe(false)
  })

  it("selects unfinished challenges through the shared completion rule", () => {
    const unfinished = challenge({ challengeId: 1, currentValue: 4, nextThreshold: 5 })
    const exact = challenge({ challengeId: 2, currentValue: 1, nextThreshold: 1 })
    const over = challenge({ challengeId: 3, currentValue: 2, nextThreshold: 1 })
    const highestTier = challenge({ challengeId: 4, nextLevel: null, nextThreshold: null })

    expect(selectIncompleteChallenges([unfinished, exact, over, highestTier]))
      .toEqual([unfinished])
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

  it("de-duplicates client game modes and labels them for people", () => {
    const row = challenge({ gameModes: '["ARAM","ARAM","KIWI"]' })

    expect(challengeGameModes(row)).toEqual(["ARAM", "KIWI"])
    expect(challengeGameModeLabel("KIWI")).toBe("ARAM: Mayhem")
  })

  it("filters challenges by game mode while keeping global challenges", () => {
    const aram = challenge({ gameModes: '["ARAM"]' })
    const classic = challenge({ gameModes: '["CLASSIC"]' })
    const global = challenge({ gameModes: "[]" })

    expect(challengeMatchesGameMode(aram, "ARAM")).toBe(true)
    expect(challengeMatchesGameMode(classic, "ARAM")).toBe(false)
    expect(challengeMatchesGameMode(global, "ARAM")).toBe(true)
  })

  it("groups modes into their maps for map filtering", () => {
    const swiftplay = challenge({ gameModes: '["SWIFTPLAY"]' })
    const mayhem = challenge({ gameModes: '["KIWI_JADE"]' })

    expect(challengeMatchesMap(swiftplay, "Summoner's Rift")).toBe(true)
    expect(challengeMatchesMap(swiftplay, "Howling Abyss")).toBe(false)
    expect(challengeMatchesMap(mayhem, "Howling Abyss")).toBe(true)
  })

  it("builds capstone groups from parent ids", () => {
    const capstone = challenge({
      challengeId: 10,
      name: "The Sage",
      isCapstone: 1,
      parentId: 999,
    })
    const second = challenge({ challengeId: 12, name: "Visionary", parentId: 10 })
    const first = challenge({ challengeId: 11, name: "Adaptable", parentId: 10 })
    const standalone = challenge({ challengeId: 13, name: "Solo act" })

    expect(buildChallengeGroups([second, standalone, capstone, first])).toEqual([
      { capstone, members: [first, second] },
    ])
  })

  it("includes nested capstones and all of their descendants", () => {
    const parent = challenge({
      challengeId: 10,
      name: "Mastermind",
      isCapstone: 1,
    })
    const nested = challenge({
      challengeId: 11,
      name: "Visionary",
      isCapstone: 1,
      parentId: 10,
    })
    const member = challenge({
      challengeId: 12,
      name: "Ward Hunter",
      parentId: 11,
    })

    const groups = buildChallengeGroups([member, parent, nested])

    expect(groups.find((group) => group.capstone === parent)?.members)
      .toEqual([nested, member])
    expect(groups.find((group) => group.capstone === nested)?.members)
      .toEqual([member])
  })

  it("filters capstones, group members, and standalone challenges", () => {
    const capstoneIds = new Set([10])
    const capstone = challenge({ challengeId: 10, isCapstone: 1 })
    const grouped = challenge({ challengeId: 11, parentId: 10 })
    const standalone = challenge({ challengeId: 12, parentId: 999 })

    expect(challengeKind(capstone, capstoneIds)).toBe("capstone")
    expect(challengeKind(grouped, capstoneIds)).toBe("grouped")
    expect(challengeKind(standalone, capstoneIds)).toBe("standalone")
    expect(challengeMatchesKind(grouped, "grouped", capstoneIds)).toBe(true)
    expect(challengeMatchesKind(grouped, "capstone", capstoneIds)).toBe(false)
    const groupMemberIds = new Set([11])
    expect(challengeMatchesGroup(capstone, 10, groupMemberIds)).toBe(true)
    expect(challengeMatchesGroup(grouped, 10, groupMemberIds)).toBe(true)
    expect(challengeMatchesGroup(standalone, 10, groupMemberIds)).toBe(false)
  })
})
