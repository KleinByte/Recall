import Database from "better-sqlite3-node"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { ParticipantsRepository } from "../electron/main/database/participants-repo.js"
import { RiotBackfillRepository } from "../electron/main/database/riot-backfill-repo.js"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { RiotHistoryBackfill } from "../electron/main/riot/history-backfill.js"
import type { RiotMatchDto } from "../electron/main/riot/match-mapper.js"

const PUUID = "owner"
const MATCH_PUUID = "official-owner-puuid"

function dto(gameId: number, ownerPuuid = PUUID): RiotMatchDto {
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
        puuid: index === 0 ? ownerPuuid : `other-${index}`,
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

  it("advances the durable coverage boundary only after a rolling job completes", () => {
    const first = progress.start(PUUID, "americas", true, 1_700_000_000_000)
    const completed = progress.complete(PUUID, "americas", 1_700_000_100_000)
    expect(completed.coverageThroughSeconds).toBe(first.endTimeSeconds)

    const rolling = progress.start(
      PUUID,
      "americas",
      true,
      1_700_100_000_000,
      completed.coverageThroughSeconds! - 86_400,
    )
    expect(rolling.coverageThroughSeconds).toBe(first.endTimeSeconds)
    expect(rolling.startTimeSeconds).toBe(
      completed.coverageThroughSeconds! - 86_400,
    )

    const refreshed = progress.complete(PUUID, "americas", 1_700_100_100_000)
    expect(refreshed.coverageThroughSeconds).toBe(rolling.endTimeSeconds)
  })

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

  it("counts bot games as skipped instead of importing them", async () => {
    const api = {
      get: vi.fn(async (path: string) => {
        if (path.includes("/ids?")) return ["NA1_890"]
        const bot = dto(890)
        bot.info!.queueId = 890
        bot.info!.gameMode = "CLASSIC"
        bot.info!.mapId = 11
        return bot
      }),
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

    const state = await backfill.run(true)

    expect(state).toMatchObject({
      matchesImported: 0,
      matchesSkipped: 1,
    })
    expect(matches.countMatches(PUUID)).toBe(0)
    expect(participants.countGamesWithLobby(PUUID)).toBe(0)
  })

  it("resolves the Match-V5 PUUID from Riot ID but stores under the client identity", async () => {
    const api = {
      get: vi.fn(async (path: string) => {
        if (path.includes("/accounts/by-riot-id/")) {
          return { puuid: MATCH_PUUID }
        }
        if (path.includes("/ids?")) return ["NA1_7"]
        return dto(7, MATCH_PUUID)
      }),
    }
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
        riotId: { gameName: "Space Name", tagLine: "N#A" },
      },
    )

    await backfill.run(true)

    expect(api.get.mock.calls[0][0]).toContain(
      "/accounts/by-riot-id/Space%20Name/N%23A",
    )
    expect(api.get.mock.calls[1][0]).toContain(
      `/by-puuid/${MATCH_PUUID}/ids?`,
    )
    expect(api.get.mock.calls[1][0]).not.toContain(`/by-puuid/${PUUID}/`)
    expect(matches.countMatches(PUUID)).toBe(1)
    expect(participants.getMatchDetail(7, PUUID).participants[0]).toMatchObject({
      isPlayer: 1,
    })
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
