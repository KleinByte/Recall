import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { ProfileRepository } from "../electron/main/database/profile-repo.js"
import { championsNeededFor } from "../electron/main/challenges/champion-needs.js"
import { mapChallengeRow } from "../electron/main/challenges/map-challenge.js"
import type { LcuChallenge } from "../electron/main/challenges/types.js"

const PUUID = "test-puuid"

let profiles: ProfileRepository

beforeEach(() => {
  const db = new Database(":memory:")
  applyMigrations(db)
  profiles = new ProfileRepository(db)
})

const snapshot = (recordedAt: number, totalScore: number) => ({
  puuid: PUUID,
  recordedAt,
  overallLevel: "GOLD",
  totalScore,
  percentile: 12.3,
  categoryJson: "[]",
})

describe("ProfileRepository", () => {
  it("stores the first snapshot", () => {
    expect(profiles.recordSnapshot(snapshot(1000, 8215))).toBe(true)
    expect(profiles.getLatest(PUUID)?.totalScore).toBe(8215)
  })

  it("ignores a snapshot when the score has not moved", () => {
    profiles.recordSnapshot(snapshot(1000, 8215))

    expect(profiles.recordSnapshot(snapshot(2000, 8215))).toBe(false)
    expect(profiles.getTrend(PUUID)).toHaveLength(1)
  })

  it("stores a snapshot when the score changes", () => {
    profiles.recordSnapshot(snapshot(1000, 8215))
    profiles.recordSnapshot(snapshot(2000, 8450))

    expect(profiles.getTrend(PUUID)).toHaveLength(2)
    expect(profiles.getLatest(PUUID)?.totalScore).toBe(8450)
  })

  it("returns the trend oldest first", () => {
    profiles.recordSnapshot(snapshot(2000, 8450))
    profiles.recordSnapshot(snapshot(1000, 8215))

    expect(profiles.getTrend(PUUID).map((row) => row.recordedAt)).toEqual([
      1000, 2000,
    ])
  })
})

const challengeRow = (overrides: Partial<LcuChallenge> = {}) =>
  mapChallengeRow(
    {
      id: 1,
      name: "Challenge",
      description: "d",
      descriptionShort: "d",
      category: "IMAGINATION",
      idListType: "CHAMPION",
      gameModes: [],
      currentLevel: "GOLD",
      currentValue: 2,
      nextThreshold: 10,
      thresholds: {},
      pointsAwarded: 5,
      isCapstone: false,
      isApex: false,
      retireTimestamp: 0,
      completedIds: [],
      availableIds: [],
      ...overrides,
    } as LcuChallenge,
    PUUID,
  )

describe("championsNeededFor", () => {
  it("lists the challenges a champion still counts toward", () => {
    const challenges = [
      challengeRow({ id: 101301, completedIds: [1, 2] }),
      challengeRow({ id: 210001, completedIds: [1] }),
    ]

    const needs = championsNeededFor(challenges, [1, 2, 3])

    expect(needs.get(3)?.map((need) => need.challengeId)).toEqual([
      101301, 210001,
    ])
    expect(needs.get(2)?.map((need) => need.challengeId)).toEqual([210001])
    expect(needs.get(1)).toBeUndefined()
  })

  it("ignores challenges that are not champion-based", () => {
    const challenges = [challengeRow({ idListType: "NONE" })]

    expect(championsNeededFor(challenges, [1]).size).toBe(0)
  })

  it("ignores retired challenges, which can no longer be progressed", () => {
    const challenges = [challengeRow({ retireTimestamp: 1_700_000 })]

    expect(championsNeededFor(challenges, [1]).size).toBe(0)
  })

  it("carries the progress needed to show why a champion matters", () => {
    const challenges = [
      challengeRow({ id: 101301, currentValue: 48, nextThreshold: 50 }),
    ]

    const need = championsNeededFor(challenges, [7]).get(7)?.[0]

    expect(need).toMatchObject({
      challengeId: 101301,
      currentValue: 48,
      nextThreshold: 50,
    })
  })
})
