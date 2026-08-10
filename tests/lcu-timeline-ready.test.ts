import Database from "better-sqlite3-node"
import { describe, expect, it, vi } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { ParticipantsRepository } from "../electron/main/database/participants-repo.js"
import {
  LCU_TIMELINE_404_GRACE_MS,
  LCU_TIMELINE_LOADING_STALE_MS,
  LCU_TIMELINE_MAX_ATTEMPTS,
  LcuTimelineService,
} from "../electron/main/lcu-timeline-service.js"
import { LcuRequestError } from "../electron/main/lcu-client.js"
import type { ParticipantRow } from "../electron/main/matches/types.js"
import { TIMELINE_MAPPER_VERSION } from "../electron/main/riot/timeline-mapper.js"
import { buildMatchRow } from "./fixtures/matches.js"

const PUUID = "timeline-owner"

const owner = (): ParticipantRow => ({
  gameId: 1,
  puuid: PUUID,
  participantId: 1,
  teamId: 100,
  isPlayer: 1,
  championId: 84,
  win: 1,
  summonerName: "Owner#NA1",
  profileIcon: 501,
  spell1Id: 4,
  spell2Id: 14,
  items: [1001, 3006, 3031, 3072, 3094, 6673, 2055],
  perkPrimaryStyle: 8000,
  perkSubStyle: 8300,
  perks: [8005, 9111, 9104, 8014, 8345, 8347],
  champLevel: 18,
  kills: 5,
  deaths: 3,
  assists: 8,
  goldEarned: 12_000,
  goldSpent: 11_000,
  damageToChampions: 20_000,
  totalDamageDealt: 90_000,
  magicDamageToChampions: 5_000,
  physicalDamageToChampions: 14_000,
  trueDamageToChampions: 1_000,
  damageTaken: 20_000,
  damageSelfMitigated: 10_000,
  totalHeal: 3_000,
  totalUnitsHealed: 1,
  timeCcingOthers: 20,
  largestKillingSpree: 3,
  largestMultiKill: 2,
  doubleKills: 1,
  tripleKills: 0,
  quadraKills: 0,
  pentaKills: 0,
  totalMinionsKilled: 100,
  neutralMinions: 0,
  visionScore: 20,
  wardsPlaced: 8,
  wardsKilled: 2,
  controlWards: 1,
  damageObjectives: 5_000,
  damageTurrets: 2_000,
  turretKills: 1,
  inhibitorKills: 0,
  longestTimeLiving: 400,
  firstBlood: 0,
  firstTower: 0,
  lane: "MIDDLE",
  role: "MIDDLE",
})

const rawTimeline = {
  frames: [{
    timestamp: 0,
    participantFrames: {
      "1": {
        participantId: 1,
        currentGold: 500,
        totalGold: 500,
        level: 1,
        xp: 0,
        minionsKilled: 0,
        jungleMinionsKilled: 0,
        position: { x: 5_000, y: 5_000 },
      },
    },
    events: [],
  }],
}

function database() {
  const db = new Database(":memory:")
  applyMigrations(db)
  new MatchesRepository(db).insertMany([buildMatchRow({
    gameId: 1,
    puuid: PUUID,
    riotMatchId: "NA1_1",
  })])
  new ParticipantsRepository(db).insertMany([owner()])
  return db
}

describe("LCU timeline ready integration", () => {
  it("runs onReady only after the selected compact timeline is durable", async () => {
    const db = database()
    const observedStatus: string[] = []
    const onReady = vi.fn(() => {
      const row = db.prepare(`
        SELECT status, mapper_version AS mapperVersion, data_json AS dataJson
        FROM match_timeline_cache WHERE game_id = 1 AND puuid = ?
      `).get(PUUID) as { status: string; mapperVersion: number; dataJson: string }
      observedStatus.push(`${row.status}:${row.mapperVersion}:${Boolean(row.dataJson)}`)
    })
    const service = new LcuTimelineService(
      db,
      () => ({ request: vi.fn().mockResolvedValue(rawTimeline) }),
      () => undefined,
      onReady,
    )

    const result = await service.request(1, PUUID)

    expect(result.status).toBe("ready")
    expect(onReady).toHaveBeenCalledOnce()
    expect(onReady).toHaveBeenCalledWith(
      1,
      PUUID,
      expect.objectContaining({ frames: expect.any(Array), events: expect.any(Array) }),
    )
    expect(observedStatus).toEqual([`ready:${TIMELINE_MAPPER_VERSION}:true`])
  })

  it("retries transient local timeline failures within a bounded attempt count", async () => {
    const db = database()
    const request = vi.fn()
      .mockRejectedValueOnce(new LcuRequestError(503, "/timeline"))
      .mockResolvedValue(rawTimeline)
    const service = new LcuTimelineService(
      db,
      () => ({ request }),
      () => undefined,
    )

    await expect(service.request(1, PUUID)).resolves.toMatchObject({ status: "ready" })
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls.length).toBeLessThanOrEqual(LCU_TIMELINE_MAX_ATTEMPTS)
  })

  it("retries a local 404 without making the missing timeline permanently sticky", async () => {
    const db = database()
    const match = db.prepare(`SELECT played_at AS playedAt, duration_secs AS durationSecs
      FROM matches WHERE game_id = 1 AND puuid = ?`).get(PUUID) as {
        playedAt: number
        durationSecs: number
      }
    const justFinished = match.playedAt + match.durationSecs * 1000 + 1_000
    const request = vi.fn().mockRejectedValue(new LcuRequestError(404, "/timeline"))
    const service = new LcuTimelineService(
      db,
      () => ({ request }),
      () => undefined,
      undefined,
      undefined,
      () => justFinished,
    )

    await expect(service.request(1, PUUID)).resolves.toMatchObject({ status: "error" })
    expect(request).toHaveBeenCalledTimes(LCU_TIMELINE_MAX_ATTEMPTS)

    request.mockResolvedValueOnce(rawTimeline)
    await expect(service.request(1, PUUID)).resolves.toMatchObject({ status: "ready" })
  })

  it("stops retrying a 404 after the local post-game grace window", async () => {
    const db = database()
    const match = db.prepare(`SELECT played_at AS playedAt, duration_secs AS durationSecs
      FROM matches WHERE game_id = 1 AND puuid = ?`).get(PUUID) as {
        playedAt: number
        durationSecs: number
      }
    const request = vi.fn().mockRejectedValue(new LcuRequestError(404, "/timeline"))
    const service = new LcuTimelineService(
      db,
      () => ({ request }),
      () => undefined,
      undefined,
      undefined,
      () => match.playedAt + match.durationSecs * 1000 + LCU_TIMELINE_404_GRACE_MS + 1,
    )

    await expect(service.request(1, PUUID)).resolves.toMatchObject({ status: "unavailable" })
    expect(request).toHaveBeenCalledTimes(LCU_TIMELINE_MAX_ATTEMPTS)
    await expect(service.request(1, PUUID)).resolves.toMatchObject({ status: "unavailable" })
    expect(request).toHaveBeenCalledTimes(LCU_TIMELINE_MAX_ATTEMPTS)
  })

  it("remaps an outdated compact timeline from its durable raw payload", async () => {
    const db = database()
    const request = vi.fn().mockResolvedValue(rawTimeline)
    const service = new LcuTimelineService(
      db,
      () => ({ request }),
      () => undefined,
    )
    await service.request(1, PUUID)
    db.prepare(`
      UPDATE match_timeline_cache
      SET mapper_version = ?, raw_json = NULL
      WHERE game_id = 1 AND puuid = ?
    `).run(TIMELINE_MAPPER_VERSION - 1, PUUID)

    request.mockClear()
    await service.queueRecentMatches(PUUID)
    expect(db.prepare(`
      SELECT mapper_version AS mapperVersion, status
      FROM match_timeline_cache WHERE game_id = 1 AND puuid = ?
    `).get(PUUID)).toEqual({ mapperVersion: TIMELINE_MAPPER_VERSION, status: "ready" })
    expect(request).not.toHaveBeenCalled()
  })

  it("recovers a stale loading row during the account drain", async () => {
    const db = database()
    const now = 1_000_000
    db.prepare(`
      INSERT INTO match_timeline_cache
        (game_id, puuid, riot_match_id, status, mapper_version, updated_at)
      VALUES (1, ?, 'NA1_1', 'loading', ?, ?)
    `).run(PUUID, TIMELINE_MAPPER_VERSION, now - LCU_TIMELINE_LOADING_STALE_MS - 1)
    const request = vi.fn().mockResolvedValue(rawTimeline)
    const service = new LcuTimelineService(
      db,
      () => ({ request }),
      () => undefined,
      undefined,
      undefined,
      () => now,
    )

    await service.queueRecentMatches(PUUID)

    expect(request).toHaveBeenCalledOnce()
    expect(service.get(1, PUUID)).toMatchObject({ status: "ready" })
  })

  it("times out a hung local request after bounded attempts", async () => {
    const db = database()
    const request = vi.fn(() => new Promise(() => undefined))
    const service = new LcuTimelineService(
      db,
      () => ({ request }),
      () => undefined,
      undefined,
      undefined,
      Date.now,
      1,
    )

    await expect(service.request(1, PUUID)).resolves.toMatchObject({
      status: "error",
      error: "League Client timeline request timed out",
    })
    expect(request).toHaveBeenCalledTimes(LCU_TIMELINE_MAX_ATTEMPTS)
  })

  it("makes a structurally incomplete payload terminal for the current mapper", async () => {
    const db = database()
    const request = vi.fn().mockResolvedValue({ frames: [] })
    const service = new LcuTimelineService(
      db,
      () => ({ request }),
      () => undefined,
    )

    await expect(service.request(1, PUUID)).resolves.toMatchObject({
      status: "unavailable",
      error: "League Client timeline data is incomplete",
    })
    await service.queueRecentMatches(PUUID)
    expect(request).toHaveBeenCalledOnce()
    expect(db.prepare(`
      SELECT mapper_version AS mapperVersion, mapping_status AS mappingStatus
      FROM match_source_payloads
      WHERE owner_puuid = ? AND source = 'league_client' AND kind = 'timeline'
    `).get(PUUID)).toEqual({
      mapperVersion: TIMELINE_MAPPER_VERSION,
      mappingStatus: "unmappable",
    })
  })
})
