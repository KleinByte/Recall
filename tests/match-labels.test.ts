import Database from "better-sqlite3-node"
import { describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import {
  evaluateMatchLabels,
  LABEL_EVALUATOR_VERSION,
  MAX_LABELS_PER_GAME,
} from "../electron/main/matches/labels.js"
import type {
  MatchRow,
  ParticipantRow,
} from "../electron/main/matches/types.js"

const OWNER = "owner"

function match(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    gameId: 1, puuid: OWNER, queueId: 420, gameMode: "CLASSIC",
    mode: "sr_ranked_solo", isMatched: 1, playedAt: 1_700_000_000_000,
    durationSecs: 1_800, gameVersion: "16.1", championId: 1, win: 1,
    kills: 12, deaths: 0, assists: 16, champLevel: 18, goldEarned: 12_000,
    damageToChampions: 40_000, damageTaken: 20_000, damageSelfMitigated: 5_000,
    totalHeal: 2_000, totalUnitsHealed: 1, timeCcingOthers: 25,
    largestKillingSpree: 12, largestMultiKill: 5, doubleKills: 2,
    tripleKills: 1, quadraKills: 1, pentaKills: 1, totalMinionsKilled: 260,
    visionScore: 35, endedInSurrender: 0, endedInEarlySurrender: 0,
    modeFamily: "sr", isRanked: 1, lane: "MIDDLE", role: "MIDDLE",
    neutralMinions: 10, wardsPlaced: 10, wardsKilled: 7, controlWards: 5,
    damageObjectives: 12_000, damageTurrets: 7_000, turretKills: 3,
    inhibitorKills: 1, firstBlood: 1, csPerMin: 9, goldPerMin: 400,
    ...overrides,
  }
}

function participant(id: number, overrides: Partial<ParticipantRow> = {}): ParticipantRow {
  const mine = id === 1
  return {
    gameId: 1, puuid: OWNER, participantId: id, teamId: id <= 5 ? 100 : 200,
    isPlayer: mine ? 1 : 0, championId: id, win: id <= 5 ? 1 : 0,
    profileIcon: 0, spell1Id: 4, spell2Id: 14, items: Array(7).fill(0),
    perkPrimaryStyle: 0, perkSubStyle: 0, perks: Array(6).fill(0), champLevel: 18,
    kills: mine ? 12 : 4, deaths: mine ? 0 : 6, assists: mine ? 16 : 5,
    goldEarned: mine ? 12_000 : 10_000, goldSpent: 9_000,
    damageToChampions: mine ? 40_000 : 12_000, totalDamageDealt: 100_000,
    magicDamageToChampions: 0, physicalDamageToChampions: 12_000,
    trueDamageToChampions: mine ? 6_000 : 0, damageTaken: mine ? 20_000 : 15_000,
    damageSelfMitigated: 5_000, totalHeal: 2_000, totalUnitsHealed: 1,
    timeCcingOthers: mine ? 25 : 5, largestKillingSpree: mine ? 12 : 2,
    largestMultiKill: mine ? 5 : 1, doubleKills: mine ? 2 : 0,
    tripleKills: mine ? 1 : 0, quadraKills: mine ? 1 : 0,
    pentaKills: mine ? 1 : 0, totalMinionsKilled: mine ? 260 : 150,
    neutralMinions: mine ? 10 : 0, visionScore: mine ? 35 : 15,
    wardsPlaced: mine ? 10 : 4, wardsKilled: mine ? 7 : 1,
    controlWards: mine ? 5 : 1, damageObjectives: mine ? 12_000 : 2_000,
    damageTurrets: mine ? 7_000 : 1_000, turretKills: mine ? 3 : 0,
    inhibitorKills: mine ? 1 : 0, longestTimeLiving: 1_000,
    firstBlood: mine ? 1 : 0, firstTower: mine ? 1 : 0,
    lane: mine ? "MIDDLE" : "TOP", role: mine ? "MIDDLE" : "TOP",
    extendedMetrics: mine ? {
      "challenge.soloKills": 3,
      "challenge.turretPlatesTaken": 4,
      "challenge.turretTakedowns": 5,
      objectivesStolen: 1,
    } : {},
    ...overrides,
  }
}

describe("Match-V5 performance labels", () => {
  it("selects a readable, suppressed set of high-value labels", () => {
    const participants = Array.from({ length: 10 }, (_, index) => participant(index + 1))
    const labels = evaluateMatchLabels({
      match: match(), player: participants[0], participants,
    })

    expect(labels).toHaveLength(MAX_LABELS_PER_GAME)
    expect(labels.map((label) => label.id)).toContain("pentakill")
    expect(labels.map((label) => label.id)).not.toContain("quadra_kill")
    expect(labels.map((label) => label.id)).not.toContain("triple_kill")
    expect(labels.every((label) => Object.keys(label.evidence).length > 0)).toBe(true)
  })

  it("does not claim telemetry Match-V5 summaries cannot observe", () => {
    const participants = Array.from({ length: 10 }, (_, index) => participant(index + 1))
    const ids = evaluateMatchLabels({
      match: match(), player: participants[0], participants,
    }).map((label) => label.id)

    expect(ids).not.toContain("facecheck_fatality")
    expect(ids).not.toContain("died_with_flash")
    expect(ids).not.toContain("ultimate_whiff")
    expect(ids).not.toContain("bad_recall")
  })

  it("persists evidence and remembers an empty completed evaluation", () => {
    const db = new Database(":memory:")
    applyMigrations(db)
    const repository = new MatchesRepository(db)
    repository.insertMany([match()])
    const label = evaluateMatchLabels({
      match: match(), player: participant(1),
      participants: Array.from({ length: 10 }, (_, index) => participant(index + 1)),
    })[0]

    repository.replacePerformanceLabels(1, OWNER, [label])
    expect(repository.needsLabelEvaluation(1, OWNER, LABEL_EVALUATOR_VERSION)).toBe(false)
    expect(repository.getPerformanceLabels(1, OWNER)[0]).toMatchObject({
      id: label.id,
      evidence: label.evidence,
    })

    repository.replacePerformanceLabels(1, OWNER, [])
    expect(repository.getPerformanceLabels(1, OWNER)).toEqual([])
    expect(repository.needsLabelEvaluation(1, OWNER)).toBe(false)
  })
})
