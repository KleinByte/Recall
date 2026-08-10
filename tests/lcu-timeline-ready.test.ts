import Database from "better-sqlite3-node"
import { describe, expect, it, vi } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { ParticipantsRepository } from "../electron/main/database/participants-repo.js"
import { LcuTimelineService } from "../electron/main/lcu-timeline-service.js"
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
})
