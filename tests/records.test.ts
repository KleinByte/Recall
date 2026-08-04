import { describe, expect, it } from "vitest"
import {
  evaluateRecords,
  recordScopeForMatch,
  type RecordContext,
  type RecordParticipant,
} from "../electron/main/matches/records.js"
import type { CompactTimeline } from "../electron/main/riot/timeline-mapper.js"
import { buildMatchRow } from "./fixtures/matches.js"

const participant = (
  participantId: number,
  teamId: number,
  overrides: Partial<RecordParticipant> = {},
): RecordParticipant => ({
  participantId,
  teamId,
  isPlayer: participantId === 1 ? 1 : 0,
  kills: 3,
  deaths: 2,
  assists: 6,
  goldEarned: 10_000,
  damageToChampions: 12_000,
  damageObjectives: 2_000,
  role: participantId === 1 || participantId === 6 ? "MIDDLE" : "TOP",
  longestTimeLiving: 720,
  totalHealOnTeammates: 0,
  totalDamageShieldedOnTeammates: 0,
  objectivesStolen: 0,
  turretPlatesTaken: 0,
  extendedMetrics: {},
  ...overrides,
})

const timeline = (): CompactTimeline => ({
  frames: [
    {
      timestamp: 0,
      blueGold: 2_500,
      redGold: 2_500,
      ownerGold: 500,
      ownerLevel: 1,
      ownerXp: 0,
      ownerCs: 0,
      participants: [
        { participantId: 1, teamId: 100, currentGold: 500, totalGold: 500, level: 1, xp: 0, minionsKilled: 0, jungleMinionsKilled: 0 },
        { participantId: 6, teamId: 200, currentGold: 500, totalGold: 500, level: 1, xp: 0, minionsKilled: 0, jungleMinionsKilled: 0 },
      ],
    },
    {
      timestamp: 600_000,
      blueGold: 13_000,
      redGold: 15_500,
      ownerGold: 3_800,
      ownerLevel: 8,
      ownerXp: 4_000,
      ownerCs: 78,
      participants: [
        { participantId: 1, teamId: 100, currentGold: 800, totalGold: 3_800, level: 8, xp: 4_000, minionsKilled: 78, jungleMinionsKilled: 0 },
        { participantId: 6, teamId: 200, currentGold: 400, totalGold: 3_200, level: 7, xp: 3_600, minionsKilled: 61, jungleMinionsKilled: 0 },
      ],
    },
    {
      timestamp: 900_000,
      blueGold: 24_000,
      redGold: 19_000,
      ownerGold: 6_900,
      ownerLevel: 11,
      ownerXp: 7_000,
      ownerCs: 128,
      participants: [
        { participantId: 1, teamId: 100, currentGold: 900, totalGold: 6_900, level: 11, xp: 7_000, minionsKilled: 128, jungleMinionsKilled: 0 },
        { participantId: 6, teamId: 200, currentGold: 500, totalGold: 5_100, level: 10, xp: 6_300, minionsKilled: 104, jungleMinionsKilled: 0 },
      ],
    },
  ],
  events: [
    { eventId: "k1", timestamp: 60_000, type: "CHAMPION_KILL", category: "kill", participantId: 1, targetId: 6, teamId: 100 },
    { eventId: "k2", timestamp: 65_000, type: "CHAMPION_KILL", category: "kill", participantId: 1, targetId: 7, teamId: 100 },
    { eventId: "k3", timestamp: 69_000, type: "CHAMPION_KILL", category: "kill", participantId: 1, targetId: 8, teamId: 100 },
    { eventId: "k4", timestamp: 72_000, type: "CHAMPION_KILL", category: "kill", participantId: 1, targetId: 9, teamId: 100 },
    { eventId: "k5", timestamp: 75_000, type: "CHAMPION_KILL", category: "kill", participantId: 1, targetId: 10, teamId: 100 },
    { eventId: "tower", timestamp: 300_000, type: "BUILDING_KILL", category: "objective", participantId: 1, teamId: 100, objective: "OUTER_TURRET" },
    { eventId: "dragon", timestamp: 400_000, type: "ELITE_MONSTER_KILL", category: "objective", participantId: 2, assistingParticipantIds: [1], teamId: 100, objective: "DRAGON" },
    { eventId: "death", timestamp: 500_000, type: "CHAMPION_KILL", category: "kill", participantId: 6, targetId: 1, teamId: 200 },
  ],
  turningPoints: [{ timestamp: 850_000, swing: 4_500, beforeDifference: -2_000, afterDifference: 2_500 }],
})

function richContext(): RecordContext {
  const mine = participant(1, 100, {
    kills: 18,
    assists: 22,
    goldEarned: 17_000,
    damageToChampions: 48_000,
    damageObjectives: 9_000,
    longestTimeLiving: 880,
    totalHealOnTeammates: 4_200,
    totalDamageShieldedOnTeammates: 3_400,
    objectivesStolen: 2,
    turretPlatesTaken: 5,
    extendedMetrics: { "challenge.augmentDamage": 7_500 },
  })
  return {
    match: buildMatchRow({
      gameId: 8,
      queueId: 2400,
      gameMode: "ARAM",
      mode: "mayhem",
      modeFamily: "aram",
      gradeScore: 2.4,
      kills: 18,
      assists: 22,
      damageToChampions: 48_000,
      damageTaken: 41_000,
      damageSelfMitigated: 35_000,
      totalHeal: 12_000,
      timeCcingOthers: 75,
      doubleKills: 3,
      tripleKills: 2,
      quadraKills: 1,
      pentaKills: 1,
      largestKillingSpree: 12,
      goldEarned: 17_000,
      totalMinionsKilled: 110,
      neutralMinions: 28,
      visionScore: 32,
      wardsPlaced: 8,
      wardsKilled: 7,
      controlWards: 3,
      damageObjectives: 9_000,
      damageTurrets: 8_000,
      turretKills: 4,
      inhibitorKills: 2,
    }),
    player: mine,
    participants: [
      mine,
      participant(2, 100), participant(3, 100), participant(4, 100), participant(5, 100),
      participant(6, 200), participant(7, 200), participant(8, 200), participant(9, 200), participant(10, 200),
    ],
    timeline: timeline(),
    augmentCount: 4,
    firstAugmentAtMs: 180_000,
  }
}

describe("expanded personal records", () => {
  it("covers match, scoreboard, timeline, and mode-specific records without lobby placement", () => {
    const records = evaluateRecords([richContext()])
    const keys = records.map((record) => record.key)

    expect(keys).toEqual(expect.arrayContaining([
      "grade", "damage_taken", "damage_mitigated", "healing", "crowd_control",
      "damage_per_minute", "damage_share", "carry_score",
      "objective_damage", "objective_steals", "vision_per_minute", "fastest_win",
      "biggest_comeback", "largest_team_lead", "largest_personal_lead",
      "largest_tempo_swing", "fastest_penta", "kills_in_minute",
      "longest_deathless", "objectives_secured", "objective_participation",
      "lane_gold_10", "lane_cs_15", "turret_plates", "ally_healing",
      "ally_shielding", "jungle_cs", "augment_damage", "augment_game",
      "mayhem_tempo",
    ]))
    expect(keys).not.toContain("lobby_place")
    expect(keys).not.toContain("kill_participation")
    expect(records.find((record) => record.key === "biggest_comeback")?.value).toBe(2_500)
    expect(records.find((record) => record.key === "fastest_penta")?.value).toBe(15)
  })

  it("uses lower values only for records where faster is better", () => {
    const slow = richContext()
    const fast = richContext()
    slow.match = { ...slow.match, gameId: 1, durationSecs: 1_800, kills: 30 }
    fast.match = { ...fast.match, gameId: 2, durationSecs: 900, kills: 12 }

    const records = evaluateRecords([slow, fast])
    expect(records.find((record) => record.key === "fastest_win")?.gameId).toBe(2)
    expect(records.find((record) => record.key === "kills")?.gameId).toBe(1)
  })

  it("keeps the original holder when a newer game only ties the record", () => {
    const older = richContext()
    const newer = richContext()
    older.match = { ...older.match, gameId: 3, playedAt: 1_000, kills: 20 }
    newer.match = { ...newer.match, gameId: 4, playedAt: 2_000, kills: 20 }

    expect(evaluateRecords([newer, older]).find((record) => record.key === "kills")?.gameId)
      .toBe(3)
  })

  it("matches the Progress page mode scopes", () => {
    expect(recordScopeForMatch(buildMatchRow({ mode: "aram", modeFamily: "aram" })))
      .toEqual({ mode: "aram" })
    expect(recordScopeForMatch(buildMatchRow({ mode: "sr_normal", modeFamily: "sr" })))
      .toMatchObject({ modes: expect.arrayContaining(["sr_normal", "sr_ranked_solo"]) })
  })
})
