import { describe, expect, it } from "vitest"
import {
  bindMinimapParticipants,
  clampMinimapPlaybackConfidence,
  DEFAULT_PLAYBACK_TRAIL_STEP_MS,
  DEFAULT_PLAYBACK_TRAIL_WINDOW_MS,
  minimapCampMarkersAt,
  minimapPlaybackTrails,
  unifiedPlaybackPositionAt,
  unifiedPlaybackTrailSegments,
  unifiedPlaybackTrails,
} from "../src/helpers/unified-playback"
import type { MinimapPathingReview } from "../src/shared/minimap/review"
import type { TimelineEvent, TimelineFrame } from "../src/types/review"
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

  it("keeps an exact Riot snapshot authoritative while connecting nearby CV evidence", () => {
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
      source: "riot_snapshot",
      origin: "riot_timeline",
      confidence: 1,
    })
    expect(result?.point.left).toBeCloseTo(10, 2)
    expect(result?.point.top).toBeCloseTo(90, 2)
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

  it("estimates continuously across unknown CV gaps using both surrounding sightings", () => {
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
    expect(result?.origin).toBe("minimap_cv")
    expect(result?.point.left).toBeCloseTo(45, 0)
    expect(result?.point.top).toBeCloseTo(50, 0)
  })

  it("does not let legacy inferred segments override the fused Riot baseline", () => {
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
    expect(between).toMatchObject({ source: "estimated", origin: "riot_timeline" })
  })

  it("uses validated model-three graph inference to shape fog-of-war playback", () => {
    const minimapReview: MinimapPathingReview = {
      ...review,
      segments: [{
        gameId: 42,
        participantKey: "ally:riot:local#na1",
        startTimeMs: 20_000,
        endTimeMs: 40_000,
        kind: "inferred",
        points: [
          { x: .35, y: .65 },
          { x: .35, y: .45 },
          { x: .65, y: .35 },
        ],
        confidence: .82,
        inferenceMode: "smoothed_postgame",
        modelVersion: 3,
      }],
    }
    const position = unifiedPlaybackPositionAt({
      frames: [
        frame(0, { x: 1_482, y: 1_488 }),
        frame(60_000, { x: 13_338, y: 13_393 }),
      ],
      events: [],
      minimapReview,
      bindings,
      participantId: 1,
      timestamp: 30_000,
      mapId: 11,
    })

    expect(position).toMatchObject({
      source: "estimated",
      origin: "minimap_cv",
      exact: false,
    })
    expect(position!.point.left).toBeLessThan(45)
  })

  it("uses brief coherent sightings to bend the route and rejects an overlay-sized jump", () => {
    const minimapReview: MinimapPathingReview = {
      ...review,
      segments: [{
        gameId: 42,
        participantKey: "ally:riot:local#na1",
        startTimeMs: 28_000,
        endTimeMs: 29_000,
        kind: "observed",
        points: [{ x: .46, y: .54 }, { x: .48, y: .52 }],
        confidence: .94,
        modelVersion: 2,
      }, {
        gameId: 42,
        participantKey: "ally:riot:local#na1",
        startTimeMs: 30_000,
        endTimeMs: 30_750,
        kind: "observed",
        points: [{ x: .95, y: .95 }, { x: .96, y: .94 }],
        confidence: .94,
        modelVersion: 2,
      }, {
        gameId: 42,
        participantKey: "ally:riot:local#na1",
        startTimeMs: 32_000,
        endTimeMs: 33_000,
        kind: "observed",
        points: [{ x: .52, y: .48 }, { x: .54, y: .46 }],
        confidence: .94,
        modelVersion: 2,
      }],
    }
    const input = {
      frames: [
        frame(0, { x: 1_482, y: 1_488 }),
        frame(60_000, { x: 13_338, y: 13_393 }),
      ],
      events: [],
      minimapReview,
      bindings,
      participantId: 1,
      mapId: 11 as const,
    }

    const falseObservationTime = unifiedPlaybackPositionAt({
      ...input,
      timestamp: 30_375,
    })
    const briefSighting = unifiedPlaybackPositionAt({
      ...input,
      timestamp: 32_500,
    })
    const afterSighting = unifiedPlaybackPositionAt({
      ...input,
      timestamp: 34_000,
    })

    expect(falseObservationTime).toMatchObject({
      source: "estimated",
      origin: "minimap_cv",
    })
    expect(falseObservationTime!.point.left).toBeLessThan(60)
    expect(falseObservationTime!.point.top).toBeLessThan(60)
    expect(briefSighting).toMatchObject({
      source: "cv_observed",
      origin: "minimap_cv",
    })
    expect(briefSighting!.point.left).toBeCloseTo(53, 0)
    expect(afterSighting).toMatchObject({ source: "estimated", origin: "minimap_cv" })
  })

  it("geometry-simplifies the exact fused route for one stable playback trail", () => {
    const minimapReview: MinimapPathingReview = {
      ...review,
      segments: [{
        gameId: 42,
        participantKey: "ally:riot:local#na1",
        startTimeMs: 10_000,
        endTimeMs: 11_000,
        kind: "observed",
        points: [{ x: .2, y: .8 }, { x: .22, y: .78 }],
        confidence: .9,
        modelVersion: 2,
      }, {
        gameId: 42,
        participantKey: "ally:riot:local#na1",
        startTimeMs: 40_000,
        endTimeMs: 41_000,
        kind: "observed",
        points: [{ x: .65, y: .35 }, { x: .67, y: .33 }],
        confidence: .9,
        modelVersion: 2,
      }],
    }
    const trails = unifiedPlaybackTrails({
      frames: [
        frame(0, { x: 1_482, y: 1_488 }),
        frame(60_000, { x: 13_338, y: 13_393 }),
      ],
      events: [],
      minimapReview,
      bindings,
      participantIds: [1],
      timestamp: 50_000,
      mapId: 11,
      lookbackMs: 50_000,
    })

    expect(trails).toHaveLength(1)
    expect(trails[0]).toMatchObject({
      key: "fused:1",
      participantId: 1,
      origin: "minimap_cv",
    })
    expect(trails[0].points.length).toBeGreaterThanOrEqual(2)
    expect(trails[0].points.length).toBeLessThanOrEqual(6)
    expect(trails[0].points[0].left).toBeCloseTo(10, 0)
    expect(trails[0].points.at(-1)!.left).toBeGreaterThan(70)
  })

  it("keeps absolute short-trail geometry stable and expires whole segments", () => {
    expect(DEFAULT_PLAYBACK_TRAIL_WINDOW_MS).toBe(15_000)
    expect(DEFAULT_PLAYBACK_TRAIL_STEP_MS).toBe(250)
    const input = {
      frames: [
        frame(0, { x: 1_482, y: 1_488 }),
        frame(60_000, { x: 13_338, y: 13_393 }),
      ],
      events: [],
      bindings,
      participantId: 1,
      mapId: 11 as const,
    }
    const at = (timestamp: number) => unifiedPlaybackTrailSegments({
      ...input,
      timestamp,
    })
    const cursors = [30_100, 30_249, 30_250, 30_499, 30_500]
    const geometryByKey = new Map<string, unknown>()

    for (const timestamp of cursors) {
      const segments = at(timestamp)
      expect(segments.length).toBeLessThanOrEqual(
        Math.ceil(DEFAULT_PLAYBACK_TRAIL_WINDOW_MS / DEFAULT_PLAYBACK_TRAIL_STEP_MS) + 1,
      )
      expect(segments.every((segment) =>
        segment.toTimestamp - segment.fromTimestamp === DEFAULT_PLAYBACK_TRAIL_STEP_MS &&
        timestamp - segment.fromTimestamp <=
          DEFAULT_PLAYBACK_TRAIL_WINDOW_MS + DEFAULT_PLAYBACK_TRAIL_STEP_MS,
      )).toBe(true)
      for (const segment of segments) {
        const geometry = {
          fromTimestamp: segment.fromTimestamp,
          toTimestamp: segment.toTimestamp,
          from: segment.from,
          to: segment.to,
          evidence: segment.evidence,
          origin: segment.origin,
          confidence: segment.confidence,
        }
        const previous = geometryByKey.get(segment.key)
        if (previous) expect(geometry).toEqual(previous)
        else geometryByKey.set(segment.key, geometry)
      }
    }

    const oldestKey = "trail:1:15000:15250"
    expect(at(30_100).find((segment) => segment.key === oldestKey)).toBeDefined()
    expect(at(30_249).find((segment) => segment.key === oldestKey)).toBeDefined()
    expect(at(30_250).find((segment) => segment.key === oldestKey)).toBeUndefined()
    expect(at(30_250).at(-1)).toMatchObject({
      key: "trail:1:30000:30250",
      evidence: "estimated",
      origin: "riot_timeline",
    })
  })

  it("leaves explicit unknown pathing intervals disconnected", () => {
    const minimapReview: MinimapPathingReview = {
      ...review,
      segments: [{
        gameId: 42,
        participantKey: "ally:riot:local#na1",
        startTimeMs: 0,
        endTimeMs: 10_000,
        kind: "observed",
        points: [{ x: .1, y: .8 }, { x: .2, y: .7 }],
        pointTimesMs: [0, 10_000],
        confidence: .9,
        modelVersion: 4,
      }, {
        gameId: 42,
        participantKey: "ally:riot:local#na1",
        startTimeMs: 10_000,
        endTimeMs: 12_000,
        kind: "unknown",
        points: [{ x: .2, y: .7 }, { x: .3, y: .6 }],
        pointTimesMs: [10_000, 12_000],
        confidence: 0,
        modelVersion: 4,
      }, {
        gameId: 42,
        participantKey: "ally:riot:local#na1",
        startTimeMs: 12_000,
        endTimeMs: 30_000,
        kind: "observed",
        points: [{ x: .3, y: .6 }, { x: .6, y: .3 }],
        pointTimesMs: [12_000, 30_000],
        confidence: .9,
        modelVersion: 4,
      }],
    }
    const segments = unifiedPlaybackTrailSegments({
      frames: [],
      events: [],
      minimapReview,
      bindings,
      participantId: 1,
      timestamp: 20_000,
      mapId: 11,
    })

    expect(segments.some((segment) =>
      segment.fromTimestamp < 12_000 && segment.toTimestamp > 10_000,
    )).toBe(false)
    expect(segments.find((segment) => segment.key === "trail:1:9750:10000"))
      .toMatchObject({ evidence: "observed", origin: "minimap_cv" })
    expect(segments.find((segment) => segment.key === "trail:1:12000:12250"))
      .toMatchObject({ evidence: "observed", origin: "minimap_cv" })
  })

  it("keeps a positioned victim hidden through unchanged dead snapshots", () => {
    const events: TimelineEvent[] = [{
      eventId: "positioned-death",
      timestamp: 20_000,
      type: "CHAMPION_KILL",
      category: "kill",
      targetId: 1,
      position: { x: 7_410, y: 7_440 },
    }]
    const input = {
      frames: [
        frame(0, { x: 1_482, y: 1_488 }),
        frame(30_000, { x: 7_410, y: 7_440 }),
        frame(60_000, { x: 7_410, y: 7_440 }),
        frame(90_000, { x: 10_374, y: 10_417 }),
      ],
      events,
      bindings,
      participantId: 1,
      mapId: 11 as const,
    }

    expect(unifiedPlaybackPositionAt({ ...input, timestamp: 20_000 })).toBeUndefined()
    expect(unifiedPlaybackPositionAt({ ...input, timestamp: 20_001 })).toBeUndefined()
    expect(unifiedPlaybackPositionAt({ ...input, timestamp: 30_000 })).toBeUndefined()
    expect(unifiedPlaybackPositionAt({ ...input, timestamp: 75_000 })).toBeUndefined()
    expect(unifiedPlaybackPositionAt({ ...input, timestamp: 90_000 }))
      .toMatchObject({ source: "riot_snapshot", fromTimestamp: 90_000 })
  })

  it("ignores an implausibly early fountain jump before later respawn evidence", () => {
    const events: TimelineEvent[] = [{
      eventId: "early-fountain-after-death",
      timestamp: 20_000,
      type: "CHAMPION_KILL",
      category: "kill",
      targetId: 1,
      position: { x: 7_410, y: 7_440 },
    }]
    const input = {
      frames: [
        frame(0, { x: 4_446, y: 4_464 }),
        // A dead snapshot can jump to blue fountain before the death timer ends.
        frame(25_000, { x: 519, y: 521 }),
        frame(35_000, { x: 1_482, y: 1_488 }),
        frame(60_000, { x: 4_446, y: 4_464 }),
      ],
      events,
      bindings,
      participantId: 1,
      mapId: 11 as const,
    }

    expect(unifiedPlaybackPositionAt({ ...input, timestamp: 25_000 })).toBeUndefined()
    expect(unifiedPlaybackPositionAt({ ...input, timestamp: 34_999 })).toBeUndefined()
    expect(unifiedPlaybackPositionAt({ ...input, timestamp: 35_000 }))
      .toMatchObject({ source: "riot_snapshot", fromTimestamp: 35_000 })
  })

  it("does not let a positionless death or exact route control bypass life state", () => {
    const events: TimelineEvent[] = [{
      eventId: "death-without-position",
      timestamp: 30_000,
      type: "CHAMPION_KILL",
      category: "kill",
      targetId: 1,
    }]
    const input = {
      frames: [
        frame(0, { x: 1_482, y: 1_488 }),
        frame(30_000, { x: 4_446, y: 4_464 }),
        frame(60_000, { x: 7_410, y: 7_440 }),
        frame(90_000, { x: 10_374, y: 10_417 }),
      ],
      events,
      bindings,
      participantId: 1,
      mapId: 11 as const,
    }

    expect(unifiedPlaybackPositionAt({ ...input, timestamp: 30_001 })).toBeUndefined()
    expect(unifiedPlaybackPositionAt({ ...input, timestamp: 60_000 })).toBeUndefined()
    expect(unifiedPlaybackPositionAt({ ...input, timestamp: 89_999 })).toBeUndefined()
    expect(unifiedPlaybackPositionAt({ ...input, timestamp: 90_000 }))
      .toMatchObject({ source: "riot_snapshot", fromTimestamp: 90_000 })
  })

  it("uses durable life intervals and waits for post-respawn position evidence", () => {
    const events: TimelineEvent[] = [{
      eventId: "captured-death",
      timestamp: 20_000,
      type: "CHAMPION_KILL",
      category: "kill",
      targetId: 1,
      position: { x: 7_410, y: 7_440 },
    }]
    const input = {
      frames: [
        frame(0, { x: 1_482, y: 1_488 }),
        frame(30_000, { x: 7_410, y: 7_440 }),
        frame(60_000, { x: 1_482, y: 1_488 }),
        frame(90_000, { x: 4_446, y: 4_464 }),
      ],
      events,
      lifeIntervals: [{ participantId: 1, diedAtMs: 20_000, respawnAtMs: 50_000 }],
      bindings,
      participantId: 1,
      mapId: 11 as const,
    }

    expect(unifiedPlaybackPositionAt({ ...input, timestamp: 30_000 })).toBeUndefined()
    expect(unifiedPlaybackPositionAt({ ...input, timestamp: 55_000 })).toBeUndefined()
    expect(unifiedPlaybackPositionAt({ ...input, timestamp: 60_000 }))
      .toMatchObject({ source: "riot_snapshot", fromTimestamp: 60_000 })
  })

  it("keeps consecutive death windows independent", () => {
    const events: TimelineEvent[] = [{
      eventId: "first-death",
      timestamp: 20_000,
      type: "CHAMPION_KILL",
      category: "kill",
      targetId: 1,
      position: { x: 4_446, y: 4_464 },
    }, {
      eventId: "second-death",
      timestamp: 110_000,
      type: "CHAMPION_KILL",
      category: "kill",
      targetId: 1,
      position: { x: 8_892, y: 8_929 },
    }]
    const input = {
      frames: [
        frame(0, { x: 1_482, y: 1_488 }),
        frame(30_000, { x: 4_446, y: 4_464 }),
        frame(60_000, { x: 1_482, y: 1_488 }),
        frame(90_000, { x: 5_928, y: 5_952 }),
        frame(120_000, { x: 8_892, y: 8_929 }),
        frame(150_000, { x: 8_892, y: 8_929 }),
        frame(180_000, { x: 1_482, y: 1_488 }),
        frame(210_000, { x: 4_446, y: 4_464 }),
      ],
      events,
      lifeIntervals: [
        { participantId: 1, diedAtMs: 20_000, respawnAtMs: 50_000 },
        { participantId: 1, diedAtMs: 110_000, respawnAtMs: 170_000 },
      ],
      bindings,
      participantId: 1,
      mapId: 11 as const,
    }

    expect(unifiedPlaybackPositionAt({ ...input, timestamp: 30_000 })).toBeUndefined()
    expect(unifiedPlaybackPositionAt({ ...input, timestamp: 60_000 })).toBeDefined()
    expect(unifiedPlaybackPositionAt({ ...input, timestamp: 150_000 })).toBeUndefined()
    expect(unifiedPlaybackPositionAt({ ...input, timestamp: 180_000 })).toBeDefined()
  })

  it("breaks a trail until credible post-death movement is observed", () => {
    const events: TimelineEvent[] = [{
      eventId: "death-without-position",
      timestamp: 20_125,
      type: "CHAMPION_KILL",
      category: "kill",
      targetId: 1,
    }]
    const input = {
      frames: [
        frame(0, { x: 1_482, y: 1_488 }),
        frame(60_000, { x: 7_410, y: 7_440 }),
        frame(90_000, { x: 10_374, y: 10_417 }),
        frame(120_000, { x: 11_856, y: 11_905 }),
      ],
      events,
      bindings,
      participantId: 1,
      mapId: 11 as const,
    }
    const beforeRespawnEvidence = unifiedPlaybackTrailSegments({
      ...input,
      timestamp: 30_000,
    })
    const beforeCredibleRespawn = unifiedPlaybackTrailSegments({
      ...input,
      timestamp: 65_000,
    })
    const afterRespawnEvidence = unifiedPlaybackTrailSegments({
      ...input,
      timestamp: 95_000,
    })

    expect(beforeRespawnEvidence.at(-1)?.toTimestamp).toBe(20_000)
    expect(beforeRespawnEvidence.some((segment) =>
      segment.fromTimestamp <= events[0].timestamp &&
      segment.toTimestamp > events[0].timestamp,
    )).toBe(false)
    expect(beforeCredibleRespawn).toEqual([])
    expect(afterRespawnEvidence[0]?.fromTimestamp).toBe(90_000)
    expect(afterRespawnEvidence.every((segment) => segment.fromTimestamp >= 90_000)).toBe(true)
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

  it("coalesces samples into one bounded 30-second SVG trail", () => {
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
    expect(trails[0].points[0]).toEqual({ left: 13, top: 77 })
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

    const legacyClear = { ...clear, campKey: "west_gromp" as const, respawnAtMs: undefined }
    expect(minimapCampMarkersAt([legacyClear], 219_999).find((camp) => camp.key === "west_gromp"))
      .toMatchObject({ state: "respawning", respawnInMs: 1 })
    expect(minimapCampMarkersAt([legacyClear], 220_000).find((camp) => camp.key === "west_gromp"))
      .toMatchObject({ state: "available", respawnInMs: undefined })
  })

  it("clamps invalid playback confidence settings to the supported range", () => {
    expect(clampMinimapPlaybackConfidence(undefined)).toBe(.68)
    expect(clampMinimapPlaybackConfidence(.1)).toBe(.5)
    expect(clampMinimapPlaybackConfidence(.99)).toBe(.95)
  })
})
