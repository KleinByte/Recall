import { describe, expect, it } from "vitest"
import {
  bindMinimapParticipants,
  clampMinimapPlaybackConfidence,
  minimapCampMarkersAt,
  minimapPlaybackTrails,
  unifiedPlaybackPositionAt,
} from "../src/helpers/unified-playback"
import type { MinimapPathingReview } from "../src/shared/minimap/review"
import type { TimelineFrame } from "../src/types/review"
import type { ParticipantRow } from "../src/types/stats"

function participant(input: Partial<ParticipantRow> & Pick<ParticipantRow, "participantId" | "teamId" | "championId">) {
  return {
    gameId: 42,
    puuid: input.participantPuuid ?? `puuid-${input.participantId}`,
    isPlayer: 0,
    win: 1,
    profileIcon: 0,
    spell1Id: 0,
    spell2Id: 0,
    items: [],
    perkPrimaryStyle: 0,
    perkSubStyle: 0,
    perks: [],
    champLevel: 18,
    kills: 0,
    deaths: 0,
    assists: 0,
    goldEarned: 0,
    goldSpent: 0,
    damageToChampions: 0,
    totalDamageDealt: 0,
    magicDamageToChampions: 0,
    physicalDamageToChampions: 0,
    trueDamageToChampions: 0,
    damageTaken: 0,
    damageSelfMitigated: 0,
    totalHeal: 0,
    totalUnitsHealed: 0,
    timeCcingOthers: 0,
    largestKillingSpree: 0,
    largestMultiKill: 0,
    doubleKills: 0,
    tripleKills: 0,
    quadraKills: 0,
    pentaKills: 0,
    totalMinionsKilled: 0,
    neutralMinions: 0,
    visionScore: 0,
    wardsPlaced: 0,
    wardsKilled: 0,
    controlWards: 0,
    damageObjectives: 0,
    damageTurrets: 0,
    turretKills: 0,
    inhibitorKills: 0,
    longestTimeLiving: 0,
    firstBlood: 0,
    firstTower: 0,
    ...input,
  } as ParticipantRow
}

function frame(timestamp: number, position?: { x: number; y: number }): TimelineFrame {
  return {
    timestamp,
    blueGold: 0,
    redGold: 0,
    ownerGold: 0,
    ownerLevel: 1,
    ownerXp: 0,
    ownerCs: 0,
    participants: [{
      participantId: 1,
      teamId: 100,
      currentGold: 0,
      totalGold: 0,
      level: 1,
      xp: 0,
      minionsKilled: 0,
      jungleMinionsKilled: 0,
      position,
    }],
  }
}

const scoreboard = [
  participant({ participantId: 1, teamId: 100, championId: 20, isPlayer: 1, summonerName: "Local#NA1" }),
  participant({ participantId: 2, teamId: 100, championId: 103, summonerName: "Fox#NA1" }),
  participant({ participantId: 6, teamId: 200, championId: 238, summonerName: "Shadow#NA1" }),
]

const review: MinimapPathingReview = {
  participants: [{
    participantKey: "ally:riot:local#na1",
    championName: "Nunu & Willump",
    team: "ally",
    isLocal: true,
  }, {
    participantKey: "ally:slot:1:ahri",
    championName: "Ahri",
    team: "ally",
    isLocal: false,
  }, {
    participantKey: "enemy:riot:shadow#na1",
    championName: "Zed",
    team: "enemy",
    isLocal: false,
  }],
  segments: [],
  campClears: [],
}

const bindings = bindMinimapParticipants(review, scoreboard)

describe("unified timeline and minimap playback", () => {
  it("binds local, Riot-ID, and unique team champion metadata conservatively", () => {
    expect(bindings).toEqual([
      { participantKey: "ally:riot:local#na1", participantId: 1, reason: "local" },
      { participantKey: "ally:slot:1:ahri", participantId: 2, reason: "team_champion" },
      { participantKey: "enemy:riot:shadow#na1", participantId: 6, reason: "riot_id" },
    ])
  })

  it("recovers participant metadata from canonical path keys for older captures", () => {
    const legacyReview: MinimapPathingReview = {
      segments: [{
        gameId: 42,
        participantKey: "ally:riot:local#na1",
        startTimeMs: 1_000,
        endTimeMs: 2_000,
        kind: "observed",
        points: [{ x: .2, y: .7 }, { x: .25, y: .65 }],
        confidence: .9,
        modelVersion: 2,
      }, {
        gameId: 42,
        participantKey: "enemy:slot:0:zed",
        startTimeMs: 1_000,
        endTimeMs: 2_000,
        kind: "observed",
        points: [{ x: .8, y: .3 }, { x: .75, y: .35 }],
        confidence: .9,
        modelVersion: 2,
      }],
      campClears: [],
    }

    expect(bindMinimapParticipants(legacyReview, scoreboard)).toEqual([
      { participantKey: "ally:riot:local#na1", participantId: 1, reason: "local" },
      { participantKey: "enemy:slot:0:zed", participantId: 6, reason: "team_champion" },
    ])
  })

  it("prefers a high-confidence observed CV position over an exact Riot snapshot", () => {
    const result = unifiedPlaybackPositionAt({
      frames: [frame(60_000, { x: 1_482, y: 1_488 })],
      events: [],
      minimapReview: {
        ...review,
        segments: [{
          gameId: 42,
          participantKey: "ally:riot:local#na1",
          startTimeMs: 59_000,
          endTimeMs: 61_000,
          kind: "observed",
          points: [{ x: .2, y: .7 }, { x: .3, y: .6 }],
          confidence: .92,
          modelVersion: 2,
        }],
      },
      bindings,
      participantId: 1,
      timestamp: 60_000,
      mapId: 11,
      minimumConfidence: .68,
    })

    expect(result).toMatchObject({
      source: "cv_observed",
      origin: "minimap_cv",
      confidence: .92,
      point: { left: 25, top: 65 },
    })
  })

  it("falls back to the Riot baseline when CV confidence is below threshold", () => {
    const result = unifiedPlaybackPositionAt({
      frames: [frame(60_000, { x: 1_482, y: 1_488 })],
      events: [],
      minimapReview: {
        ...review,
        segments: [{
          gameId: 42,
          participantKey: "ally:riot:local#na1",
          startTimeMs: 59_000,
          endTimeMs: 61_000,
          kind: "observed",
          points: [{ x: .9, y: .9 }],
          confidence: .6,
          modelVersion: 2,
        }],
      },
      bindings,
      participantId: 1,
      timestamp: 60_000,
      mapId: 11,
      minimumConfidence: .68,
    })

    expect(result?.source).toBe("riot_snapshot")
    expect(result?.origin).toBe("riot_timeline")
    expect(result?.point.left).toBeCloseTo(10, 1)
    expect(result?.point.top).toBeCloseTo(90, 1)
  })

  it("does not bridge unknown CV gaps and uses the Riot interpolation only as baseline", () => {
    const minimapReview: MinimapPathingReview = {
      ...review,
      segments: [{
        gameId: 42,
        participantKey: "ally:riot:local#na1",
        startTimeMs: 0,
        endTimeMs: 10_000,
        kind: "observed",
        points: [{ x: .1, y: .8 }, { x: .2, y: .7 }],
        confidence: .9,
        modelVersion: 2,
      }, {
        gameId: 42,
        participantKey: "ally:riot:local#na1",
        startTimeMs: 10_001,
        endTimeMs: 50_000,
        kind: "unknown",
        points: [],
        confidence: 0,
        modelVersion: 2,
      }, {
        gameId: 42,
        participantKey: "ally:riot:local#na1",
        startTimeMs: 50_001,
        endTimeMs: 60_000,
        kind: "observed",
        points: [{ x: .7, y: .3 }, { x: .8, y: .2 }],
        confidence: .9,
        modelVersion: 2,
      }],
    }
    const result = unifiedPlaybackPositionAt({
      frames: [frame(0, { x: 1_000, y: 1_000 }), frame(60_000, { x: 7_000, y: 7_000 })],
      events: [],
      minimapReview,
      bindings,
      participantId: 1,
      timestamp: 30_000,
      mapId: 11,
    })

    expect(result?.source).toBe("estimated")
    expect(result?.origin).toBe("riot_timeline")
  })

  it("prefers an exact Riot snapshot over reconstructed CV but CV inference over Riot interpolation", () => {
    const minimapReview: MinimapPathingReview = {
      ...review,
      segments: [{
        gameId: 42,
        participantKey: "ally:riot:local#na1",
        startTimeMs: 0,
        endTimeMs: 60_000,
        kind: "inferred",
        points: [{ x: .2, y: .8 }, { x: .8, y: .2 }],
        confidence: .85,
        modelVersion: 2,
      }],
    }
    const exact = unifiedPlaybackPositionAt({
      frames: [frame(0, { x: 1_000, y: 1_000 }), frame(60_000, { x: 7_000, y: 7_000 })],
      events: [],
      minimapReview,
      bindings,
      participantId: 1,
      timestamp: 60_000,
      mapId: 11,
    })
    const between = unifiedPlaybackPositionAt({
      frames: [frame(0, { x: 1_000, y: 1_000 }), frame(60_000, { x: 7_000, y: 7_000 })],
      events: [],
      minimapReview,
      bindings,
      participantId: 1,
      timestamp: 30_000,
      mapId: 11,
    })

    expect(exact?.source).toBe("riot_snapshot")
    expect(between).toMatchObject({ source: "estimated", origin: "minimap_cv" })
  })

  it("keeps separate CV trail polylines across unknown evidence gaps", () => {
    const trails = minimapPlaybackTrails({
      minimapReview: {
        ...review,
        segments: [{
          gameId: 42,
          participantKey: "ally:riot:local#na1",
          startTimeMs: 0,
          endTimeMs: 10_000,
          kind: "observed",
          points: [{ x: .1, y: .8 }, { x: .2, y: .7 }],
          confidence: .9,
          modelVersion: 2,
        }, {
          gameId: 42,
          participantKey: "ally:riot:local#na1",
          startTimeMs: 10_001,
          endTimeMs: 20_000,
          kind: "unknown",
          points: [],
          confidence: 0,
          modelVersion: 2,
        }, {
          gameId: 42,
          participantKey: "ally:riot:local#na1",
          startTimeMs: 20_001,
          endTimeMs: 30_000,
          kind: "observed",
          points: [{ x: .6, y: .4 }, { x: .7, y: .3 }],
          confidence: .9,
          modelVersion: 2,
        }],
      },
      bindings,
      participantIds: [1],
      timestamp: 30_000,
    })

    expect(trails).toHaveLength(2)
    expect(trails.every((trail) => trail.source === "cv_observed")).toBe(true)
    expect(trails[0].points.at(-1)).toEqual({ left: 20, top: 70 })
    expect(trails[1].points[0].left).toBeCloseTo(60)
  })

  it("coalesces adjacent observed samples into one bounded SVG trail", () => {
    const segments = Array.from({ length: 150 }, (_, index) => ({
      gameId: 42,
      participantKey: "ally:riot:local#na1",
      startTimeMs: index * 250,
      endTimeMs: (index + 1) * 250,
      kind: "observed" as const,
      points: [
        { x: .1 + index * .001, y: .8 - index * .001 },
        { x: .1 + (index + 1) * .001, y: .8 - (index + 1) * .001 },
      ],
      confidence: .9,
      modelVersion: 2,
    }))
    const trails = minimapPlaybackTrails({
      minimapReview: { ...review, segments },
      bindings,
      participantIds: [1],
      timestamp: 37_500,
    })

    expect(trails).toHaveLength(1)
    expect(trails[0].points.length).toBeLessThanOrEqual(96)
    expect(trails[0].points[0]).toEqual({ left: 10, top: 80 })
    expect(trails[0].points.at(-1)?.left).toBeCloseTo(25)
  })

  it("reports cleared, respawning, and available camp states at the shared timestamp", () => {
    const clear = {
      gameId: 42,
      puuid: "owner",
      campKey: "west_blue" as const,
      clearedAtMs: 100_000,
      respawnAtMs: 400_000,
      source: "minimap_cv" as const,
      sourceConfidence: .9,
      attribution: "local" as const,
      attributionConfidence: .9,
      evidence: {
        campTransition: true,
        localPositionObserved: true,
        transitionConfidence: .9,
      },
      routeIndex: 0,
      algorithmVersion: 3,
    }

    expect(minimapCampMarkersAt([clear], 101_000).find((camp) => camp.key === "west_blue"))
      .toMatchObject({ state: "cleared", justCleared: true })
    expect(minimapCampMarkersAt([clear], 380_000).find((camp) => camp.key === "west_blue"))
      .toMatchObject({ state: "respawning", respawnInMs: 20_000 })
    expect(minimapCampMarkersAt([clear], 400_000).find((camp) => camp.key === "west_blue"))
      .toMatchObject({ state: "available", respawnInMs: undefined })
  })

  it("clamps invalid playback confidence settings to the supported range", () => {
    expect(clampMinimapPlaybackConfidence(undefined)).toBe(.68)
    expect(clampMinimapPlaybackConfidence(.1)).toBe(.5)
    expect(clampMinimapPlaybackConfidence(.99)).toBe(.95)
  })
})
