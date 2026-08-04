import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { ChallengesRepository } from "../electron/main/database/challenges-repo.js"
import { ChallengeSync } from "../electron/main/challenges/challenge-sync.js"
import type { LcuChallenge } from "../electron/main/challenges/types.js"

const PUUID = "test-puuid"

const challenge = (id: number, overrides: Partial<LcuChallenge> = {}) =>
  ({
    id,
    name: `Challenge ${id}`,
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
    friendsAtLevels: [{ level: "IRON", friends: ["friend-puuid"] }],
    ...overrides,
  }) as LcuChallenge

class FakeClient {
  private challenges = new Map<number, LcuChallenge>()

  constructor(ids: number[]) {
    for (const id of ids) this.challenges.set(id, challenge(id))
  }

  update(id: number, overrides: Partial<LcuChallenge>) {
    this.challenges.set(id, challenge(id, overrides))
  }

  request<T>(): Promise<T> {
    return Promise.resolve(
      Object.fromEntries(
        [...this.challenges].map(([id, value]) => [String(id), value]),
      ) as T,
    )
  }
}

let repo: ChallengesRepository

beforeEach(() => {
  const db = new Database(":memory:")
  applyMigrations(db)
  repo = new ChallengesRepository(db)
})

describe("ChallengeSync", () => {
  it("stores every challenge the client reports", async () => {
    const client = new FakeClient([1, 2, 3])
    const sync = new ChallengeSync(client as never, repo, PUUID)

    const result = await sync.syncNow(1000)

    expect(result.total).toBe(3)
    expect(repo.countChallenges(PUUID)).toBe(3)
  })

  it("records a baseline for every challenge on the first sync", async () => {
    const client = new FakeClient([1, 2])
    const sync = new ChallengeSync(client as never, repo, PUUID)

    const result = await sync.syncNow(1000)

    expect(result.changed).toBe(2)
    expect(repo.getHistory(1, PUUID)).toHaveLength(1)
  })

  it("records history only for challenges that actually changed", async () => {
    const client = new FakeClient([1, 2, 3])
    const sync = new ChallengeSync(client as never, repo, PUUID)
    await sync.syncNow(1000)

    client.update(1, { currentValue: 49 })
    const second = await sync.syncNow(2000)

    expect(second.changed).toBe(1)
    expect(repo.getHistory(1, PUUID)).toHaveLength(2)
    expect(repo.getHistory(2, PUUID)).toHaveLength(1)
  })

  it("writes no history when nothing moved", async () => {
    const client = new FakeClient([1, 2])
    const sync = new ChallengeSync(client as never, repo, PUUID)
    await sync.syncNow(1000)

    const second = await sync.syncNow(2000)

    expect(second.changed).toBe(0)
    expect(repo.getHistory(1, PUUID)).toHaveLength(1)
  })

  it("records a tier change even when the value is unchanged", async () => {
    const client = new FakeClient([1])
    const sync = new ChallengeSync(client as never, repo, PUUID)
    await sync.syncNow(1000)

    client.update(1, { currentLevel: "PLATINUM" })
    const second = await sync.syncNow(2000)

    expect(second.changed).toBe(1)
  })

  it("keeps the latest values on the challenge itself", async () => {
    const client = new FakeClient([1])
    const sync = new ChallengeSync(client as never, repo, PUUID)
    await sync.syncNow(1000)

    client.update(1, { currentValue: 77 })
    await sync.syncNow(2000)

    expect(repo.getById(1, PUUID)?.currentValue).toBe(77)
  })

  it("never stores friends' identifiers", async () => {
    const client = new FakeClient([1])
    await new ChallengeSync(client as never, repo, PUUID).syncNow(1000)

    const stored = JSON.stringify(repo.getById(1, PUUID))
    expect(stored).not.toContain("friend-puuid")
  })

  it("does not throw when the client is unavailable", async () => {
    const failing = {
      request: () => Promise.reject(new Error("ECONNREFUSED")),
    }

    await expect(
      new ChallengeSync(failing as never, repo, PUUID).syncNow(),
    ).resolves.toEqual({ total: 0, changed: 0 })
  })
})
