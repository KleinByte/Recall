import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { ChallengesRepository } from "../electron/main/database/challenges-repo.js"
import { mapChallengeRow } from "../electron/main/challenges/map-challenge.js"
import type { LcuChallenge } from "../electron/main/challenges/types.js"

const PUUID = "test-puuid"

let repo: ChallengesRepository

beforeEach(() => {
  const db = new Database(":memory:")
  applyMigrations(db)
  repo = new ChallengesRepository(db)
})

const raw = (overrides: Partial<LcuChallenge> = {}): LcuChallenge =>
  ({
    id: 1,
    name: "Challenge",
    description: "d",
    descriptionShort: "d",
    category: "TEAMWORK",
    idListType: "NONE",
    gameModes: [],
    currentLevel: "GOLD",
    currentValue: 10,
    thresholds: {},
    pointsAwarded: 5,
    isCapstone: false,
    isApex: false,
    retireTimestamp: 0,
    completedIds: [],
    availableIds: [],
    ...overrides,
  }) as LcuChallenge

const row = (overrides: Partial<LcuChallenge> = {}) =>
  mapChallengeRow(raw(overrides), PUUID)

describe("ChallengesRepository", () => {
  it("stores challenges", () => {
    repo.upsertMany([row({ id: 1 }), row({ id: 2 })])

    expect(repo.countChallenges(PUUID)).toBe(2)
  })

  it("updates an existing challenge rather than duplicating it", () => {
    repo.upsertMany([row({ id: 1, currentValue: 10 })])
    repo.upsertMany([row({ id: 1, currentValue: 42, currentLevel: "PLATINUM" })])

    expect(repo.countChallenges(PUUID)).toBe(1)

    const stored = repo.getById(1, PUUID)
    expect(stored?.currentValue).toBe(42)
    expect(stored?.currentLevel).toBe("PLATINUM")
  })

  it("hides retired challenges unless asked for them", () => {
    repo.upsertMany([
      row({ id: 1 }),
      row({ id: 2, retireTimestamp: 1_700_000 }),
    ])

    expect(repo.getAll({ puuid: PUUID })).toHaveLength(1)
    expect(
      repo.getAll({ puuid: PUUID, includeRetired: true }),
    ).toHaveLength(2)
  })

  it("filters by category, level and list type", () => {
    repo.upsertMany([
      row({ id: 1, category: "TEAMWORK", currentLevel: "GOLD" }),
      row({ id: 2, category: "COLLECTION", currentLevel: "IRON" }),
      row({ id: 3, category: "COLLECTION", idListType: "CHAMPION" }),
    ])

    expect(repo.getAll({ puuid: PUUID, category: "COLLECTION" })).toHaveLength(2)
    expect(repo.getAll({ puuid: PUUID, level: "IRON" })).toHaveLength(1)
    expect(
      repo.getAll({ puuid: PUUID, idListType: "CHAMPION" }),
    ).toHaveLength(1)
  })

  it("searches by name and description", () => {
    repo.upsertMany([
      row({ id: 1, name: "All Random All Champions" }),
      row({ id: 2, name: "Perfectionist" }),
    ])

    expect(repo.getAll({ puuid: PUUID, search: "Random" })).toHaveLength(1)
  })

  it("reports stored progress for change detection", () => {
    repo.upsertMany([
      row({ id: 1, currentValue: 10, currentLevel: "GOLD" }),
      row({ id: 2, currentValue: 3, currentLevel: "IRON" }),
    ])

    const snapshot = repo.getProgressSnapshot(PUUID)

    expect(snapshot.get(1)).toEqual({ currentValue: 10, currentLevel: "GOLD" })
    expect(snapshot.size).toBe(2)
  })

  it("keeps history in chronological order", () => {
    repo.recordHistory([
      {
        challengeId: 1,
        puuid: PUUID,
        recordedAt: 200,
        currentValue: 12,
        currentLevel: "GOLD",
      },
      {
        challengeId: 1,
        puuid: PUUID,
        recordedAt: 100,
        currentValue: 10,
        currentLevel: "GOLD",
      },
    ])

    const history = repo.getHistory(1, PUUID)

    expect(history.map((entry) => entry.recordedAt)).toEqual([100, 200])
  })

  it("ignores a duplicate history entry for the same instant", () => {
    const entry = {
      challengeId: 1,
      puuid: PUUID,
      recordedAt: 100,
      currentValue: 10,
      currentLevel: "GOLD",
    }

    repo.recordHistory([entry])
    const written = repo.recordHistory([entry])

    expect(written).toBe(0)
    expect(repo.getHistory(1, PUUID)).toHaveLength(1)
  })
})
