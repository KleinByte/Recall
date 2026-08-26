import Database from "better-sqlite3-node"
import { describe, expect, it, vi } from "vitest"
import { LiveGameCaptureRepository } from "../electron/main/database/live-game-capture-repo.js"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { ParticipantsRepository } from "../electron/main/database/participants-repo.js"
import { TimelineRepository } from "../electron/main/database/timeline-repo.js"
import type {
  LiveGamePlayer,
  LiveGameSnapshot,
} from "../electron/main/game-client.js"
import { LcuTimelineService } from "../electron/main/lcu-timeline-service.js"
import { mapParticipants } from "../electron/main/matches/map-participants.js"
import { deriveParticipantLifeIntervals } from "../electron/main/matches/participant-life-intervals.js"
import {
  mapTimeline,
  TIMELINE_MAPPER_VERSION,
  type CompactTimeline,
} from "../electron/main/riot/timeline-mapper.js"
import { buildMatchRow } from "./fixtures/matches.js"

const PUUID = "life-interval-owner"

function player(overrides: Partial<LiveGamePlayer> = {}): LiveGamePlayer {
  return {
    championName: "Annie",
    riotId: "Owner#NA1",
    team: "ORDER",
    level: 1,
    isDead: false,
    respawnTimer: 0,
    isLocal: true,
    scores: { kills: 0, deaths: 0, assists: 0, creepScore: 0, wardScore: 0 },
    items: [],
    summonerSpells: ["Flash", "Ignite"],
    ...overrides,
  }
}

function snapshotAt(
  gameTime: number,
  players: LiveGamePlayer[],
): LiveGameSnapshot {
  const local = players.find((entry) => entry.isLocal)
  return {
    available: true,
    gameTime,
    gameMode: "CLASSIC",
    localTeam: local?.team,
    activePlayer: {
      riotId: local?.riotId,
      currentGold: 500,
      level: local?.level ?? 1,
      abilityHaste: 0,
    },
    allies: players.filter((entry) => entry.team === local?.team),
    enemies: players.filter((entry) => entry.team !== local?.team),
    events: [],
    updatedAt: 1_000_000 + gameTime * 1_000,
  }
}

const roster = [
  { participantId: 1, teamId: 100, isPlayer: 1, summonerName: "Owner#NA1" },
  { participantId: 6, teamId: 200, isPlayer: 0, summonerName: "Enemy#NA1" },
]

const owner = () => player()
const enemy = (overrides: Partial<LiveGamePlayer> = {}) => player({
  championName: "Amumu",
  riotId: "Enemy#NA1",
  team: "CHAOS",
  isLocal: false,
  ...overrides,
})

function killTimeline(timestamp = 120_000): CompactTimeline {
  return {
    frames: [],
    events: [{
      eventId: `kill:${timestamp}`,
      timestamp,
      type: "CHAMPION_KILL",
      category: "kill",
      participantId: 1,
      teamId: 100,
      targetId: 6,
    }],
    turningPoints: [],
  }
}

function database() {
  const db = new Database(":memory:")
  applyMigrations(db)
  new MatchesRepository(db).insertMany([buildMatchRow({
    gameId: 1,
    puuid: PUUID,
    riotMatchId: "NA1_1",
  })])
  new ParticipantsRepository(db).insertMany(mapParticipants({
    gameId: 1,
    participantIdentities: [
      { participantId: 1, player: { puuid: PUUID, gameName: "Owner", tagLine: "NA1" } },
      { participantId: 6, player: { puuid: "enemy", gameName: "Enemy", tagLine: "NA1" } },
    ],
    participants: [
      { participantId: 1, teamId: 100, championId: 1 },
      { participantId: 6, teamId: 200, championId: 32 },
    ],
  }, PUUID))
  return db
}

describe("participant life intervals", () => {
  it("joins an observed death to its exact kill and uses the live respawn countdown", () => {
    const snapshots = [
      snapshotAt(100, [owner(), enemy()]),
      snapshotAt(120, [owner(), enemy({ isDead: true, respawnTimer: 18 })]),
      snapshotAt(130, [owner(), enemy({ isDead: true, respawnTimer: 8 })]),
      snapshotAt(138.5, [owner(), enemy()]),
    ]

    expect(deriveParticipantLifeIntervals(
      snapshots,
      roster,
      killTimeline(119_500).events,
    )).toEqual([{
      participantId: 6,
      diedAtMs: 119_500,
      respawnAtMs: 138_000,
    }])
  })

  it("does not join a delayed dead observation to an older kill", () => {
    const snapshots = [
      snapshotAt(100, [owner(), enemy()]),
      snapshotAt(130, [owner(), enemy({ isDead: true, respawnTimer: 18 })]),
    ]

    expect(deriveParticipantLifeIntervals(
      snapshots,
      roster,
      killTimeline(120_000).events,
    )).toEqual([{
      participantId: 6,
      diedAtMs: 130_000,
      respawnAtMs: 148_000,
    }])
  })

  it("falls back to captured state boundaries and skips ambiguous remote identities", () => {
    const ambiguousRoster = [
      ...roster.slice(0, 1),
      { participantId: 6, teamId: 200, isPlayer: 0, summonerName: "Twin#ONE" },
      { participantId: 7, teamId: 200, isPlayer: 0, summonerName: "Twin#TWO" },
    ]
    const exactTwin = enemy({ riotId: "Twin#ONE" })
    const unknownTwin = enemy({ riotId: "Twin", championName: "Neeko" })
    const snapshots = [
      snapshotAt(50, [
        owner(),
        { ...exactTwin, isDead: true, respawnTimer: 0 },
        unknownTwin,
      ]),
      snapshotAt(64, [owner(), exactTwin, unknownTwin]),
    ]

    expect(deriveParticipantLifeIntervals(snapshots, ambiguousRoster)).toEqual([{
      participantId: 6,
      diedAtMs: 50_000,
      respawnAtMs: 64_000,
    }])
  })

  it("keeps post-game-only mapper payloads backward compatible", () => {
    const timeline = mapTimeline([{
      timestamp: 0,
      participantFrames: {
        "1": { participantId: 1, level: 1 },
      },
      events: [],
    }], 1, new Map([[1, 100]]))

    expect(timeline).not.toHaveProperty("participantLifeIntervals")
  })

  it("enriches a repository timeline even when snapshots derive no supplemental events", () => {
    const db = database()
    const captures = new LiveGameCaptureRepository(db as never)
    captures.record(1, PUUID, snapshotAt(120, [
      owner(),
      enemy({ isDead: true, respawnTimer: 18 }),
    ]))

    const enriched = captures.enrichTimeline(1, PUUID, killTimeline(), roster)

    expect(enriched.events).toHaveLength(1)
    expect(enriched.participantLifeIntervals).toEqual([{
      participantId: 6,
      diedAtMs: 120_000,
      respawnAtMs: 138_000,
    }])
  })

  it("returns and persists life intervals through the timeline service payload", async () => {
    const db = database()
    const captures = new LiveGameCaptureRepository(db as never)
    captures.record(1, PUUID, snapshotAt(100, [owner(), enemy()]))
    captures.record(1, PUUID, snapshotAt(120, [
      owner(),
      enemy({ isDead: true, respawnTimer: 18 }),
    ]))
    const request = vi.fn().mockResolvedValue({
      frames: [{
        timestamp: 120_000,
        participantFrames: {
          "1": { participantId: 1, level: 1 },
          "6": { participantId: 6, level: 1 },
        },
        events: [{
          timestamp: 120_000,
          type: "CHAMPION_KILL",
          killerId: 1,
          victimId: 6,
        }],
      }],
    })
    const service = new LcuTimelineService(
      db as never,
      () => ({ request }),
      () => undefined,
      undefined,
      captures,
    )

    const requested = await service.request(1, PUUID)

    expect(requested.summary?.participantLifeIntervals).toEqual([{
      participantId: 6,
      diedAtMs: 120_000,
      respawnAtMs: 138_000,
    }])
    expect(service.get(1, PUUID).summary?.participantLifeIntervals)
      .toEqual(requested.summary?.participantLifeIntervals)
  })

  it("overlays live life intervals onto the selected Match-V5 timeline", () => {
    const db = database()
    const captures = new LiveGameCaptureRepository(db as never)
    captures.record(1, PUUID, snapshotAt(100, [owner(), enemy()]))
    captures.record(1, PUUID, snapshotAt(120, [
      owner(),
      enemy({ isDead: true, respawnTimer: 18 }),
    ]))
    const timelines = new TimelineRepository(db as never)
    timelines.persistReady({
      gameId: 1,
      puuid: PUUID,
      source: "match_v5",
      sourceMatchId: "NA1_1",
      mapperVersion: TIMELINE_MAPPER_VERSION,
      timeline: killTimeline(),
      capturedAt: 1_000,
    })
    expect(timelines.state(1, PUUID).summary)
      .not.toHaveProperty("participantLifeIntervals")
    const service = new LcuTimelineService(
      db as never,
      () => undefined,
      () => undefined,
      undefined,
      captures,
    )

    expect(service.get(1, PUUID)).toMatchObject({
      status: "ready",
      summary: {
        participantLifeIntervals: [{
          participantId: 6,
          diedAtMs: 120_000,
          respawnAtMs: 138_000,
        }],
      },
    })
    expect(timelines.state(1, PUUID).summary)
      .not.toHaveProperty("participantLifeIntervals")
  })
})
