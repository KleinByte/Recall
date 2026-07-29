import Database from "better-sqlite3-node"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { ParticipantsRepository } from "../electron/main/database/participants-repo.js"
import { RiotBackfillRepository } from "../electron/main/database/riot-backfill-repo.js"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { RiotHistoryBackfill } from "../electron/main/riot/history-backfill.js"
import type { RiotMatchDto } from "../electron/main/riot/match-mapper.js"

const PUUID = "owner"

function dto(gameId: number): RiotMatchDto {
  return {
    metadata: { matchId: `NA1_${gameId}` },
    info: {
      gameId,
      gameStartTimestamp: 1_700_000_000_000 - gameId,
      gameDuration: 1_200,
      gameMode: "ARAM",
      gameType: "MATCHED_GAME",
      gameVersion: "16.1",
      queueId: 450,
      mapId: 12,
      participants: Array.from({ length: 10 }, (_, index) => ({
        participantId: index + 1,
        puuid: index === 0 ? PUUID : `other-${index}`,
        championId: 22 + index,
        teamId: index < 5 ? 100 : 200,
        win: index < 5,
        kills: 10 - index,
        deaths: 5 + index,
        assists: 10 + index,
        goldEarned: 12_000 - index * 100,
        totalDamageDealtToChampions: 25_000 - index * 500,
        totalDamageTaken: 10_000 + index * 500,
      })),
      teams: [
        { teamId: 100, win: true, objectives: {} },
        { teamId: 200, win: false, objectives: {} },
      ],
    },
  }
}

describe("RiotHistoryBackfill", () => {
  let db: Database.Database
  let matches: MatchesRepository
  let participants: ParticipantsRepository
  let progress: RiotBackfillRepository

  beforeEach(() => {
    db = new Database(":memory:")
    applyMigrations(db as never)
    matches = new MatchesRepository(db as never)
    participants = new ParticipantsRepository(db as never)
    progress = new RiotBackfillRepository(db as never)
  })

  afterEach(() => db.close())

  it("freezes endTime at the current second, never in the future", () => {
    const state = progress.start(PUUID, "americas", true, 1_999)

    expect(state.endTimeSeconds).toBe(1)
  })

  it("imports every returned ID and completes at the oldest page", async () => {
    const api = {
      get: vi.fn(async (path: string) => {
        if (path.includes("/ids?")) return ["NA1_1", "NA1_2"]
        return dto(Number(path.match(/(\d+)$/)![1]))
      }),
    }
    const updates: string[] = []
    const backfill = new RiotHistoryBackfill(
      "key",
      "americas",
      PUUID,
      matches,
      participants,
      new Map(),
      progress,
      {
        api: api as never,
        onProgress: (state) => updates.push(state.status),
      },
    )

    const state = await backfill.run(true)

    expect(state).toMatchObject({
      status: "complete",
      nextOffset: 2,
      idsScanned: 2,
      matchesDownloaded: 2,
      matchesImported: 2,
    })
    expect(matches.countMatches(PUUID)).toBe(2)
    expect(participants.getMatchDetail(1, PUUID).participants).toHaveLength(10)
    expect(participants.hasCurrentLobby(2, PUUID)).toBe(true)
    expect(updates).toEqual(["running", "running", "running", "complete"])
  })

  it("resumes the durable offset without replaying completed pages", async () => {
    progress.start(PUUID, "americas", true, 1)
    progress.advance(
      PUUID,
      "americas",
      100,
      {
        idsScanned: 100,
        matchesDownloaded: 90,
        matchesImported: 80,
        matchesSkipped: 10,
      },
      2,
    )
    progress.stop(PUUID, "americas", "paused", undefined, 3)

    const api = {
      get: vi.fn(async () => []),
    }
    const backfill = new RiotHistoryBackfill(
      "key",
      "americas",
      PUUID,
      matches,
      participants,
      new Map(),
      progress,
      { api: api as never },
    )

    const state = await backfill.run(false)

    expect(api.get.mock.calls[0][0]).toContain("start=100")
    expect(api.get.mock.calls[0][0]).toContain("endTime=")
    expect(state.status).toBe("complete")
    expect(state.idsScanned).toBe(100)
  })

  it("does not call Riot again after a completed automatic resume", async () => {
    progress.start(PUUID, "americas", true)
    progress.complete(PUUID, "americas")
    const api = { get: vi.fn() }
    const backfill = new RiotHistoryBackfill(
      "key",
      "americas",
      PUUID,
      matches,
      participants,
      new Map(),
      progress,
      { api: api as never },
    )

    await expect(backfill.run(false)).resolves.toMatchObject({
      status: "complete",
    })
    expect(api.get).not.toHaveBeenCalled()
  })

  it("resumes at the exact match after an interrupted page", async () => {
    const firstApi = {
      get: vi.fn(async (path: string) => {
        if (path.includes("/ids?")) return ["NA1_20", "NA1_19"]
        if (path.endsWith("NA1_20")) return dto(20)
        throw new Error("network stopped")
      }),
    }
    const first = new RiotHistoryBackfill(
      "key",
      "americas",
      PUUID,
      matches,
      participants,
      new Map(),
      progress,
      { api: firstApi as never },
    )

    await expect(first.run(true)).rejects.toThrow("network stopped")
    const interrupted = progress.get(PUUID, "americas")!
    expect(interrupted).toMatchObject({
      status: "error",
      nextOffset: 1,
      idsScanned: 1,
    })

    const secondApi = {
      get: vi.fn(async (path: string) =>
        path.includes("/ids?") ? ["NA1_19"] : dto(19),
      ),
    }
    const second = new RiotHistoryBackfill(
      "replacement-key",
      "americas",
      PUUID,
      matches,
      participants,
      new Map(),
      progress,
      { api: secondApi as never },
    )
    const completed = await second.run(false)

    expect(secondApi.get.mock.calls[0][0]).toContain("start=1")
    expect(secondApi.get.mock.calls[0][0]).toContain(
      `endTime=${interrupted.endTimeSeconds}`,
    )
    expect(completed.status).toBe("complete")
    expect(matches.countMatches(PUUID)).toBe(2)
  })

  it("skips detail requests for matches with a complete local lobby", async () => {
    const firstApi = {
      get: vi.fn(async (path: string) =>
        path.includes("/ids?") ? ["NA1_9"] : dto(9),
      ),
    }
    await new RiotHistoryBackfill(
      "key",
      "americas",
      PUUID,
      matches,
      participants,
      new Map(),
      progress,
      { api: firstApi as never },
    ).run(true)

    const secondApi = {
      get: vi.fn(async (path: string) =>
        path.includes("/ids?") ? ["NA1_9"] : dto(9),
      ),
    }
    await new RiotHistoryBackfill(
      "key",
      "americas",
      PUUID,
      matches,
      participants,
      new Map(),
      progress,
      { api: secondApi as never },
    ).run(true)

    expect(secondApi.get).toHaveBeenCalledOnce()
    expect(secondApi.get.mock.calls[0][0]).toContain("/ids?")
  })
})
