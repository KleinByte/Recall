import { describe, expect, it } from "vitest"
import { evaluateTimelineLabels } from "../electron/main/matches/timeline-labels.js"
import type { MatchRow, ParticipantRow } from "../electron/main/matches/types.js"
import type { CompactTimeline } from "../electron/main/riot/timeline-mapper.js"

const owner = {
  participantId: 1,
  teamId: 100,
  isPlayer: 1,
  role: "JUNGLE",
  win: 1,
} as ParticipantRow

const enemyJungler = {
  participantId: 6,
  teamId: 200,
  isPlayer: 0,
  role: "JUNGLE",
} as ParticipantRow

const match = {
  gameId: 1,
  puuid: "owner",
  modeFamily: "sr",
  isMatched: 1,
} as MatchRow

function timeline(overrides: Partial<CompactTimeline> = {}): CompactTimeline {
  return {
    frames: [{
      timestamp: 600_000,
      blueGold: 15_000,
      redGold: 15_000,
      ownerGold: 3_500,
      ownerLevel: 7,
      ownerXp: 3_000,
      ownerCs: 60,
      participants: [
        {
          participantId: 1,
          teamId: 100,
          currentGold: 500,
          totalGold: 3_500,
          level: 7,
          xp: 3_000,
          minionsKilled: 5,
          jungleMinionsKilled: 55,
          position: { x: 10_000, y: 6_500 },
        },
        {
          participantId: 6,
          teamId: 200,
          currentGold: 200,
          totalGold: 2_800,
          level: 6,
          xp: 2_500,
          minionsKilled: 3,
          jungleMinionsKilled: 45,
          position: { x: 9_000, y: 7_000 },
        },
      ],
    }],
    events: [],
    turningPoints: [],
    ...overrides,
  }
}

describe("timeline performance labels", () => {
  it("awards Invader only for an early kill on the enemy jungler in their jungle", () => {
    const labels = evaluateTimelineLabels({
      match,
      player: owner,
      participants: [owner, enemyJungler],
      timeline: timeline({
        events: [{
          eventId: "invade",
          timestamp: 540_000,
          type: "CHAMPION_KILL",
          category: "kill",
          participantId: 1,
          targetId: 6,
          position: { x: 10_000, y: 6_500 },
        }],
      }),
    })

    expect(labels.find((label) => label.id === "invader")).toMatchObject({
      name: "Invader",
      source: "timeline",
      confidence: "strong",
      evidence: { firstTimestamp: 540_000, x: 10_000, y: 6_500 },
    })
  })

  it("does not call a lane or river kill an invade", () => {
    const labels = evaluateTimelineLabels({
      match,
      player: owner,
      participants: [owner, enemyJungler],
      timeline: timeline({
        events: [{
          eventId: "mid-kill",
          timestamp: 540_000,
          type: "CHAMPION_KILL",
          category: "kill",
          participantId: 1,
          targetId: 6,
          position: { x: 7_500, y: 7_500 },
        }],
      }),
    })

    expect(labels.some((label) => label.id === "invader")).toBe(false)
  })

  it("uses role-opponent snapshots for jungle gap and level lead", () => {
    const labels = evaluateTimelineLabels({
      match,
      player: owner,
      participants: [owner, enemyJungler],
      timeline: timeline({
        frames: [
          ...timeline().frames,
          {
            ...timeline().frames[0],
            timestamp: 900_000,
            participants: timeline().frames[0].participants.map((entry) => ({
              ...entry,
              totalGold: entry.participantId === 1 ? 6_000 : 4_700,
            })),
          },
        ],
      }),
    })

    expect(labels.map((label) => label.id)).toEqual(expect.arrayContaining([
      "jungle_gap",
      "level_lead",
    ]))
  })

  it("marks nearest-snapshot isolation and unspent-gold conclusions as inferred", () => {
    const labels = evaluateTimelineLabels({
      match: { ...match, win: 0 } as MatchRow,
      player: { ...owner, win: 0 } as ParticipantRow,
      participants: [owner, enemyJungler],
      timeline: timeline({
        frames: [{
          ...timeline().frames[0],
          timestamp: 500_000,
          participants: timeline().frames[0].participants.map((entry) => ({
            ...entry,
            currentGold: entry.participantId === 1 ? 1_800 : entry.currentGold,
          })),
        }],
        events: [540_000, 570_000].map((timestamp) => ({
          eventId: String(timestamp),
          timestamp,
          type: "CHAMPION_KILL",
          category: "kill" as const,
          participantId: 6,
          targetId: 1,
          position: { x: 10_000, y: 6_500 },
        })),
      }),
    })

    expect(labels.find((label) => label.id === "caught_out")?.confidence).toBe("inferred")
    expect(labels.find((label) => label.id === "shopping_with_a_fortune")?.confidence).toBe("inferred")
  })

  it("counts unique real ward placements and never exceeds the recorded match total", () => {
    const realPlacements = Array.from({ length: 8 }, (_, index) => ({
      eventId: `ward-${index}`,
      timestamp: 570_000 + index * 1_000,
      type: "WARD_PLACED",
      category: "vision" as const,
      participantId: 1,
      wardType: "YELLOW_TRINKET",
    }))
    const repeatedNoise = Array.from({ length: 74 }, (_, index) => ({
      eventId: `noise-${index}`,
      timestamp: 575_000,
      type: "WARD_PLACED",
      category: "vision" as const,
      participantId: 1,
      wardType: "UNDEFINED",
    }))
    const labels = evaluateTimelineLabels({
      match,
      player: { ...owner, wardsPlaced: 6 } as ParticipantRow,
      participants: [owner, enemyJungler],
      timeline: timeline({
        frames: [{
          ...timeline().frames[0],
          participants: timeline().frames[0].participants.map((entry) => entry.participantId === 1
            ? { ...entry, position: { x: 10_000, y: 7_000 } }
            : entry),
        }],
        events: [...realPlacements, ...realPlacements, ...repeatedNoise],
      }),
    })

    expect(labels.find((label) => label.id === "deep_vision")).toMatchObject({
      tooltip: "6 of your 6 ward placements happened while nearby timeline snapshots showed you on the enemy side.",
      evidence: {
        deepWards: 6,
        wardsPlaced: 6,
        exactEventPositions: 0,
      },
    })
  })
})
