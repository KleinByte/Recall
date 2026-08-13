import Database from "better-sqlite3-node"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { ParticipantsRepository } from "../electron/main/database/participants-repo.js"
import { RiotBackfillRepository } from "../electron/main/database/riot-backfill-repo.js"
import { MatchSourceRepository } from "../electron/main/database/match-source-repo.js"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { RiotHistoryBackfill } from "../electron/main/riot/history-backfill.js"
import { RiotApiError } from "../electron/main/riot/api-client.js"
import type { RiotMatchDto } from "../electron/main/riot/match-mapper.js"
import {
  mapTimeline,
  TIMELINE_MAPPER_VERSION,
} from "../electron/main/riot/timeline-mapper.js"

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
        totalTimeSpentDead: 90 + index,
      })),
      teams: [
        { teamId: 100, win: true, objectives: {} },
        { teamId: 200, win: false, objectives: {} },
      ],
    },
  }
}

function timelineDto() {
  return {
    info: {
      frames: [{
        timestamp: 1_200_000,
        participantFrames: Object.fromEntries(Array.from({ length: 10 }, (_, index) => [
          String(index + 1),
          {
            participantId: index + 1,
            currentGold: 500,
            totalGold: 500,
            level: 1,
            xp: 0,
            minionsKilled: 0,
            jungleMinionsKilled: 0,
            position: { x: 5_000 + index, y: 5_000 + index },
          },
        ])),
        events: [],
      }],
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
    expect(db.prepare(`
      SELECT COUNT(DISTINCT game_id) AS total
      FROM match_participants WHERE puuid = ?
    `).get(PUUID)).toEqual({ total: 0 })
  })

  it("refreshes the Match-V5 PUUID from the signed-in Riot ID", async () => {
    const api = {
      get: vi.fn(async (path: string) => {
        if (path.includes("/riot/account/")) return { puuid: MATCH_PUUID }
        if (path.includes("/ids?")) return ["NA1_7"]
        return dto(7, MATCH_PUUID)
      }),
    }
    const resolved = vi.fn()
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
        matchPuuid: "stale-match-puuid",
        riotId: { gameName: "Recall Player", tagLine: "NA1" },
        onAccountResolved: resolved,
      },
    )

    await backfill.run(true)

    expect(api.get.mock.calls[0][0]).toBe(
      "/riot/account/v1/accounts/by-riot-id/Recall%20Player/NA1",
    )
    expect(api.get.mock.calls[1][0]).toContain(
      `/by-puuid/${MATCH_PUUID}/ids?`,
    )
    expect(api.get.mock.calls[1][0]).not.toContain("stale-match-puuid")
    expect(resolved).toHaveBeenCalledWith(MATCH_PUUID)
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

  it("enriches missing extended facts and persists a preferred Match-V5 timeline", async () => {
    const initialApi = {
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
      { api: initialApi as never },
    ).run(true)
    db.prepare(`
      UPDATE match_participants SET extended_metrics_json = '{}'
      WHERE game_id = 9 AND puuid = ? AND is_player = 1
    `).run(PUUID)

    const api = {
      get: vi.fn(async (path: string) => {
        if (path.includes("/ids?")) return ["NA1_9"]
        if (path.endsWith("/timeline")) return timelineDto()
        return dto(9)
      }),
    }
    const sources = new MatchSourceRepository(db as never)
    await new RiotHistoryBackfill(
      "key",
      "americas",
      PUUID,
      matches,
      participants,
      new Map(),
      progress,
      { api: api as never, sourceRepository: sources },
    ).run(true)

    expect(api.get.mock.calls.map(([path]) => String(path))).toEqual([
      expect.stringContaining("/ids?"),
      "/lol/match/v5/matches/NA1_9",
      "/lol/match/v5/matches/NA1_9/timeline",
    ])
    expect(participants.getMatchDetail(9, PUUID).participants
      .find((participant) => participant.isPlayer === 1)?.extendedMetrics)
      .toMatchObject({ totalTimeSpentDead: 90 })
    expect(db.prepare(`
      SELECT status, mapper_version AS mapperVersion
      FROM match_timeline_sources
      WHERE game_id = 9 AND puuid = ? AND source = 'match_v5'
    `).get(PUUID)).toEqual({ status: "ready", mapperVersion: TIMELINE_MAPPER_VERSION })
    expect(db.prepare(`
      SELECT status, mapper_version AS mapperVersion
      FROM selected_match_timelines WHERE game_id = 9 AND puuid = ?
    `).get(PUUID)).toEqual({ status: "ready", mapperVersion: TIMELINE_MAPPER_VERSION })
  })

  it("retries a previously unavailable Match-V5 timeline on explicit reimport", async () => {
    const initialApi = {
      get: vi.fn(async (path: string) =>
        path.includes("/ids?") ? ["NA1_9"] : dto(9),
      ),
    }
    await new RiotHistoryBackfill(
      "key", "americas", PUUID, matches, participants, new Map(), progress,
      { api: initialApi as never },
    ).run(true)
    const sources = new MatchSourceRepository(db as never)
    const missingApi = {
      get: vi.fn(async (path: string) => {
        if (path.includes("/ids?")) return ["NA1_9"]
        throw new RiotApiError("missing", 404)
      }),
    }
    await new RiotHistoryBackfill(
      "key", "americas", PUUID, matches, participants, new Map(), progress,
      { api: missingApi as never, sourceRepository: sources },
    ).run(true)
    expect(db.prepare(`
      SELECT status FROM match_timeline_sources
      WHERE game_id = 9 AND puuid = ? AND source = 'match_v5'
        AND mapper_version = ?
    `).get(PUUID, TIMELINE_MAPPER_VERSION)).toEqual({ status: "unavailable" })

    const recoveredApi = {
      get: vi.fn(async (path: string) =>
        path.includes("/ids?") ? ["NA1_9"] : timelineDto(),
      ),
    }
    await new RiotHistoryBackfill(
      "key", "americas", PUUID, matches, participants, new Map(), progress,
      { api: recoveredApi as never, sourceRepository: sources },
    ).run(true)

    expect(recoveredApi.get).toHaveBeenCalledTimes(2)
    expect(db.prepare(`
      SELECT status FROM match_timeline_sources
      WHERE game_id = 9 AND puuid = ? AND source = 'match_v5'
        AND mapper_version = ?
    `).get(PUUID, TIMELINE_MAPPER_VERSION)).toEqual({ status: "ready" })
  })

  it("does not let an incomplete Match-V5 timeline displace a ready LCU source", async () => {
    const initialApi = {
      get: vi.fn(async (path: string) =>
        path.includes("/ids?") ? ["NA1_9"] : dto(9),
      ),
    }
    await new RiotHistoryBackfill(
      "key", "americas", PUUID, matches, participants, new Map(), progress,
      { api: initialApi as never },
    ).run(true)
    const sources = new MatchSourceRepository(db as never)
    const stored = participants.getMatchDetail(9, PUUID).participants
    const local = mapTimeline(
      timelineDto().info.frames,
      1,
      new Map(stored.map((entry) => [entry.participantId, entry.teamId])),
    )
    sources.persistTimelineSource({
      gameId: 9,
      puuid: PUUID,
      source: "league_client",
      sourceMatchId: "9",
      mapperVersion: TIMELINE_MAPPER_VERSION,
      timeline: local,
      capturedAt: 1,
    })
    const incomplete = {
      info: {
        frames: [{
          timestamp: 1_200_000,
          participantFrames: {
            "1": timelineDto().info.frames[0].participantFrames["1"],
          },
          events: [],
        }],
      },
    }
    const api = {
      get: vi.fn(async (path: string) =>
        path.includes("/ids?") ? ["NA1_9"] : incomplete,
      ),
    }
    await new RiotHistoryBackfill(
      "key", "americas", PUUID, matches, participants, new Map(), progress,
      { api: api as never, sourceRepository: sources },
    ).run(true)

    expect(db.prepare(`
      SELECT status FROM match_timeline_sources
      WHERE game_id = 9 AND puuid = ? AND source = 'match_v5'
        AND mapper_version = ?
    `).get(PUUID, TIMELINE_MAPPER_VERSION)).toEqual({ status: "unavailable" })
    expect(db.prepare(`
      SELECT selected.data_json = source.data_json AS sameData
      FROM selected_match_timelines selected
      JOIN match_timeline_sources source
        ON source.game_id = selected.game_id AND source.puuid = selected.puuid
       AND source.source = 'league_client' AND source.mapper_version = ?
      WHERE selected.game_id = 9 AND selected.puuid = ?
    `).get(TIMELINE_MAPPER_VERSION, PUUID)).toEqual({ sameData: 1 })
  })
})
