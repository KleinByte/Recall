import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { ParticipantsRepository } from "../electron/main/database/participants-repo.js"
import { ReviewRepository } from "../electron/main/database/review-repo.js"
import { ReviewService } from "../electron/main/review/review-service.js"
import type { LcuTimelineService } from "../electron/main/lcu-timeline-service.js"
import type { ParticipantRow } from "../electron/main/matches/types.js"
import {
  storeLegacyMatchGrade,
  storeLegacyParticipantGrades,
} from "./fixtures/legacy-grade-cache.js"
import { buildMatchRow } from "./fixtures/matches.js"

const PUUID = "test-puuid"

let db: InstanceType<typeof Database>
let matches: MatchesRepository
let participants: ParticipantsRepository
let reviews: ReviewRepository
let service: ReviewService

beforeEach(() => {
  db = new Database(":memory:")
  applyMigrations(db)
  matches = new MatchesRepository(db)
  participants = new ParticipantsRepository(db)
  reviews = new ReviewRepository(db)
  service = new ReviewService(
    db,
    matches,
    participants,
    reviews,
    { get: () => undefined } as unknown as LcuTimelineService,
    undefined,
  )
})

const player = (overrides: Partial<ParticipantRow> = {}): ParticipantRow => ({
  gameId: 1,
  puuid: PUUID,
  participantId: 1,
  teamId: 100,
  isPlayer: 0,
  championId: 84,
  win: 1,
  summonerName: "Someone#NA1",
  profileIcon: 0,
  spell1Id: 4,
  spell2Id: 14,
  items: [0, 0, 0, 0, 0, 0, 0],
  perkPrimaryStyle: 0,
  perkSubStyle: 0,
  perks: [0, 0, 0, 0, 0, 0],
  champLevel: 18,
  kills: 2,
  deaths: 2,
  assists: 2,
  goldEarned: 10000,
  goldSpent: 9000,
  damageToChampions: 10000,
  totalDamageDealt: 50000,
  magicDamageToChampions: 0,
  physicalDamageToChampions: 0,
  trueDamageToChampions: 0,
  damageTaken: 10000,
  damageSelfMitigated: 5000,
  totalHeal: 1000,
  totalUnitsHealed: 1,
  timeCcingOthers: 5,
  largestKillingSpree: 1,
  largestMultiKill: 1,
  doubleKills: 0,
  tripleKills: 0,
  quadraKills: 0,
  pentaKills: 0,
  totalMinionsKilled: 50,
  neutralMinions: 0,
  visionScore: 10,
  wardsPlaced: 1,
  wardsKilled: 0,
  controlWards: 0,
  damageObjectives: 1000,
  damageTurrets: 500,
  turretKills: 0,
  inhibitorKills: 0,
  longestTimeLiving: 200,
  firstBlood: 0,
  firstTower: 0,
  ...overrides,
})

const lobby = (gameId: number) =>
  Array.from({ length: 10 }, (_, index) =>
    player({
      gameId,
      participantId: index + 1,
      teamId: index < 5 ? 100 : 200,
      isPlayer: index === 0 ? 1 : 0,
    }),
  )

/** A grade saved before the canonical recipe selection exists. */
const staleGrade = (gameId: number) => {
  storeLegacyParticipantGrades(db, {
    gameId,
    puuid: PUUID,
    storagePartition: 2,
    grades: [{
      participantId: 1,
      grade: "B",
      score: 0,
      compositePercentile: 0.5,
      components: [],
    }],
  })
  storeLegacyMatchGrade(db, {
    gameId, puuid: PUUID, grade: "B", score: 0,
  })
}

describe("Review Grade visibility", () => {
  it("does not fabricate canonical review context from a cached legacy grade", () => {
    matches.insertMany([buildMatchRow({ gameId: 1 })])
    participants.insertMany(lobby(1))
    staleGrade(1)

    const review = service.match(1, PUUID)

    expect(review.match.grade).toBe("B")
    expect(review.grade).toBeUndefined()
  })
})
