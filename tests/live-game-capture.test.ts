import Database from "better-sqlite3-node"
import { describe, expect, it } from "vitest"
import {
  deriveLiveTimelineEvents,
  LiveGameCaptureRepository,
} from "../electron/main/database/live-game-capture-repo.js"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { ParticipantsRepository } from "../electron/main/database/participants-repo.js"
import type { LiveGameSnapshot } from "../electron/main/game-client.js"
import type { ParticipantRow } from "../electron/main/matches/types.js"
import { mapParticipants } from "../electron/main/matches/map-participants.js"
import type { CompactTimeline } from "../electron/main/riot/timeline-mapper.js"

function snapshot(
  gameTime: number,
  overrides: Partial<LiveGameSnapshot> = {},
): LiveGameSnapshot {
  return {
    available: true,
    gameTime,
    gameMode: "CLASSIC",
    localTeam: "ORDER",
    activePlayer: {
      riotId: "Owner#NA1",
      currentGold: 500,
      level: 1,
      abilityHaste: 0,
    },
    allies: [{
      championName: "Annie",
      riotId: "Owner#NA1",
      team: "ORDER",
      level: 1,
      isDead: false,
      respawnTimer: 0,
      isLocal: true,
      scores: { kills: 0, deaths: 0, assists: 0, creepScore: 0, wardScore: 0 },
      items: [{
        itemId: 1001,
        name: "Boots",
        count: 1,
        price: 300,
        canUse: false,
        consumable: false,
      }],
      summonerSpells: ["Flash", "Ignite"],
    }],
    enemies: [],
    events: [],
    updatedAt: 1_000_000 + gameTime * 1_000,
    ...overrides,
  }
}

describe("LiveGameCaptureRepository", () => {
  it("stamps canonical positions onto allies and enemies from the live roster", () => {
    const db = new Database(":memory:")
    applyMigrations(db)
    const repo = new LiveGameCaptureRepository(db as never)
    const enemy = {
      ...snapshot(4).allies[0],
      championName: "Shaco",
      riotId: "Enemy#NA1",
      team: "CHAOS",
      isLocal: false,
      position: "JUNGLE",
    }
    repo.record(10, "owner", snapshot(2))
    expect(repo.record(10, "owner", snapshot(4, {
      allies: [{ ...snapshot(4).allies[0], position: "MIDDLE" }],
      enemies: [enemy],
    })).snapshotWritten).toBe(true)

    const rows = [
      { isPlayer: 1, summonerName: "Owner#NA1", role: "SOLO" },
      { isPlayer: 0, summonerName: "enemy#na1", role: "SUPPORT" },
      { isPlayer: 0, summonerName: "Unknown#NA1", role: "SOLO" },
    ] as ParticipantRow[]

    expect(repo.stampPositions(10, "owner", rows)).toBe(2)
    expect(rows.map((row) => row.role)).toEqual(["MIDDLE", "JUNGLE", "SOLO"])
  })

  it("stamps the local bonus shards from Riot's active-player rune page", () => {
    const db = new Database(":memory:")
    applyMigrations(db)
    const repo = new LiveGameCaptureRepository(db as never)
    repo.record(10, "owner", snapshot(4, {
      activePlayer: {
        ...snapshot(4).activePlayer!,
        runes: {
          primaryStyleId: 8000,
          secondaryStyleId: 8300,
          generalRuneIds: [8005, 9111, 9104, 8014, 8345, 8347],
          statRuneIds: [5005, 5008, 5001],
        },
      },
    }))
    const rows = mapParticipants({
      gameId: 10,
      participantIdentities: [
        { participantId: 1, player: { puuid: "owner" } },
        { participantId: 2, player: { puuid: "enemy" } },
      ],
      participants: [
        {
          participantId: 1,
          teamId: 100,
          stats: {
            perkPrimaryStyle: 8000,
            perkSubStyle: 8300,
            perk0: 8005,
            perk0Var1: 42,
            perk1: 9111,
            perk2: 9104,
            perk3: 8014,
            perk4: 8345,
            perk5: 8347,
          },
        },
        { participantId: 2, teamId: 200, stats: { perk0: 8112 } },
      ],
    }, "owner")

    expect(repo.stampRunes(10, "owner", rows)).toBe(1)
    expect(rows[0].runeSelections).toEqual([
      expect.objectContaining({ runeId: 8005, slot: 0, var1: 42 }),
      expect.objectContaining({ runeId: 9111, slot: 1 }),
      expect.objectContaining({ runeId: 9104, slot: 2 }),
      expect.objectContaining({ runeId: 8014, slot: 3 }),
      expect.objectContaining({ runeId: 8345, slot: 4 }),
      expect.objectContaining({ runeId: 8347, slot: 5 }),
      expect.objectContaining({ runeId: 5005, slot: 6 }),
      expect.objectContaining({ runeId: 5008, slot: 7 }),
      expect.objectContaining({ runeId: 5001, slot: 8 }),
    ])
    expect(rows[1].runeSelections).toEqual([
      expect.objectContaining({ runeId: 8112, slot: 0 }),
    ])
    expect(repo.stampRunes(10, "owner", rows)).toBe(0)
  })

  it("repairs an already-stored local rune page from a durable live snapshot", () => {
    const db = new Database(":memory:")
    applyMigrations(db)
    const repo = new LiveGameCaptureRepository(db as never)
    const participants = new ParticipantsRepository(db as never)
    const rows = mapParticipants({
      gameId: 10,
      participantIdentities: [{ participantId: 1, player: { puuid: "owner" } }],
      participants: [{
        participantId: 1,
        teamId: 100,
        stats: {
          perkPrimaryStyle: 8000,
          perkSubStyle: 8300,
          perk0: 8005,
          perk1: 9111,
          perk2: 9104,
          perk3: 8014,
          perk4: 8345,
          perk5: 8347,
        },
      }],
    }, "owner")
    participants.insertMany(rows)
    repo.record(10, "owner", snapshot(4, {
      activePlayer: {
        ...snapshot(4).activePlayer!,
        runes: {
          primaryStyleId: 8000,
          secondaryStyleId: 8300,
          generalRuneIds: [8005, 9111, 9104, 8014, 8345, 8347],
          statRuneIds: [5005, 5008, 5001],
        },
      },
    }))

    expect(repo.repairStoredRunes("owner")).toBe(1)
    expect(
      participants.getMatchDetail(10, "owner").participants[0].runeSelections
        ?.filter((selection) => selection.slot >= 6)
        .map((selection) => selection.runeId),
    ).toEqual([5005, 5008, 5001])
    expect(repo.repairStoredRunes("owner")).toBe(0)
  })

  it("repairs positions in lobbies stored before live roles were applied", () => {
    const db = new Database(":memory:")
    applyMigrations(db)
    const repo = new LiveGameCaptureRepository(db as never)
    const participants = new ParticipantsRepository(db as never)
    const rows = mapParticipants({
      gameId: 10,
      participantIdentities: [
        { participantId: 1, player: { puuid: "owner", gameName: "Owner", tagLine: "NA1" } },
        { participantId: 2, player: { puuid: "enemy", gameName: "Enemy", tagLine: "NA1" } },
      ],
      participants: [
        { participantId: 1, teamId: 100, timeline: { role: "SOLO" } },
        { participantId: 2, teamId: 200, timeline: { role: "SUPPORT" } },
      ],
    }, "owner")
    participants.insertMany(rows)
    repo.record(10, "owner", snapshot(4, {
      allies: [{ ...snapshot(4).allies[0], position: "MIDDLE" }],
      enemies: [{
        ...snapshot(4).allies[0],
        riotId: "Enemy#NA1",
        team: "CHAOS",
        isLocal: false,
        position: "JUNGLE",
      }],
    }))

    expect(repo.repairStoredPositions("owner")).toBe(2)
    expect(
      (db.prepare(
        "SELECT role FROM match_participants WHERE game_id = 10 ORDER BY participant_id",
      ).all() as { role: string }[]).map((row) => row.role),
    ).toEqual(["MIDDLE", "JUNGLE"])
  })

  it("stores bounded snapshots and deduplicates the cumulative event feed", () => {
    const db = new Database(":memory:")
    applyMigrations(db)
    const repo = new LiveGameCaptureRepository(db as never)

    expect(repo.record(10, "owner", snapshot(2)).snapshotWritten).toBe(true)
    expect(repo.record(10, "owner", snapshot(4, {
      events: [{ id: 1, name: "GameStart", time: 0, assisters: [] }],
    }))).toEqual({ snapshotWritten: false, eventsWritten: 1 })
    const changed = snapshot(6, {
      events: [{ id: 1, name: "GameStart", time: 0, assisters: [] }],
      allies: [{
        ...snapshot(6).allies[0],
        level: 2,
        items: [
          ...snapshot(6).allies[0].items,
          { itemId: 1056, name: "Doran's Ring", count: 1, price: 400, canUse: false, consumable: false },
        ],
      }],
    })
    expect(repo.record(10, "owner", changed)).toEqual({
      snapshotWritten: true,
      eventsWritten: 0,
    })
    expect(repo.record(10, "owner", snapshot(22, {
      allies: changed.allies,
    })).snapshotWritten).toBe(true)

    expect(repo.listSnapshots(10, "owner").map((entry) => entry.reason)).toEqual([
      "first",
      "state_change",
      "periodic",
    ])
    expect(repo.listEvents(10, "owner")).toEqual([
      expect.objectContaining({ id: 1, name: "GameStart" }),
    ])

    expect(repo.deleteAll("owner")).toEqual({ events: 1, snapshots: 3 })
    expect(repo.listSnapshots(10, "owner")).toEqual([])
    expect(repo.listEvents(10, "owner")).toEqual([])
  })

  it("derives honest item observations and tighter level milestones", () => {
    const first = snapshot(5)
    const second = snapshot(7, {
      allies: [{
        ...first.allies[0],
        level: 2,
        items: [
          ...first.allies[0].items,
          { itemId: 1056, name: "Doran's Ring", count: 1, price: 400, canUse: false, consumable: false },
        ],
      }],
    })
    const events = deriveLiveTimelineEvents(
      [
        { ...first, events: undefined, reason: "first" } as never,
        { ...second, events: undefined, reason: "state_change" } as never,
      ],
      [{ participantId: 1, teamId: 100, isPlayer: 1, summonerName: "Owner#NA1" }],
    )

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "ITEM_OBSERVED",
        itemId: 1001,
        timestamp: 5_000,
        approximate: true,
      }),
      expect.objectContaining({
        type: "ITEM_ACQUIRED",
        itemId: 1056,
        timestamp: 7_000,
      }),
      expect.objectContaining({
        type: "LEVEL_UP",
        level: 2,
        timestamp: 7_000,
      }),
    ]))
  })

  it("preserves the named killer and victim from the live kill feed", () => {
    const events = deriveLiveTimelineEvents([], [
      { participantId: 1, teamId: 100, isPlayer: 1, summonerName: "Warwick Main#NA1" },
      { participantId: 6, teamId: 200, isPlayer: 0, summonerName: "Amumu Main#NA1" },
    ], [{
      id: 44, name: "ChampionKill", time: 412.3,
      killerName: "Warwick Main", victimName: "Amumu Main", assisters: [],
    }])

    expect(events).toContainEqual(expect.objectContaining({
      type: "CHAMPION_KILL", participantId: 1, targetId: 6, teamId: 100,
      actorName: "Warwick Main", targetName: "Amumu Main", timestamp: 412_300,
    }))
  })

  it("replaces coarser inferred levels when enriching a post-game timeline", () => {
    const db = new Database(":memory:")
    applyMigrations(db)
    const repo = new LiveGameCaptureRepository(db as never)
    repo.record(10, "owner", snapshot(5))
    repo.record(10, "owner", snapshot(7, {
      allies: [{ ...snapshot(7).allies[0], level: 2 }],
    }))
    const timeline: CompactTimeline = {
      frames: [],
      events: [{
        eventId: "inferred-level:60000:1:2",
        timestamp: 60_000,
        type: "LEVEL_UP",
        category: "level",
        participantId: 1,
        teamId: 100,
        level: 2,
        approximate: true,
      }],
      turningPoints: [],
    }

    const enriched = repo.enrichTimeline(10, "owner", timeline, [
      { participantId: 1, teamId: 100, isPlayer: 1, summonerName: "Owner#NA1" },
    ])
    expect(enriched.events.filter((event) => event.type === "LEVEL_UP")).toEqual([
      expect.objectContaining({ timestamp: 7_000, level: 2 }),
    ])
    expect(enriched.events.some((event) => event.category === "item")).toBe(true)
  })

  it("keeps the exact post-game position when adding live kill names", () => {
    const db = new Database(":memory:")
    applyMigrations(db)
    const repo = new LiveGameCaptureRepository(db as never)
    repo.record(10, "owner", snapshot(412.3, {
      enemies: [{
        ...snapshot(412.3).allies[0],
        championName: "Amumu",
        riotId: "Amumu Main#NA1",
        team: "CHAOS",
        isLocal: false,
      }],
      events: [{
        id: 44,
        name: "ChampionKill",
        time: 412.3,
        killerName: "Owner",
        victimName: "Amumu Main",
        assisters: [],
      }],
    }))
    const timeline: CompactTimeline = {
      frames: [],
      events: [{
        eventId: "post-game-kill",
        timestamp: 412_275,
        type: "CHAMPION_KILL",
        category: "kill",
        participantId: 1,
        targetId: 6,
        teamId: 100,
        bounty: 300,
        position: { x: 7_033, y: 7_097 },
      }],
      turningPoints: [],
    }

    const enriched = repo.enrichTimeline(10, "owner", timeline, [
      { participantId: 1, teamId: 100, isPlayer: 1, summonerName: "Owner#NA1" },
      { participantId: 6, teamId: 200, isPlayer: 0, summonerName: "Amumu Main#NA1" },
    ])

    expect(enriched.events.filter((event) => event.type === "CHAMPION_KILL")).toEqual([
      expect.objectContaining({
        eventId: "post-game-kill",
        actorName: "Owner",
        targetName: "Amumu Main",
        bounty: 300,
        position: { x: 7_033, y: 7_097 },
      }),
    ])
  })

  it("keeps unmatched incomplete live kills in raw capture instead of the compact timeline", () => {
    const db = new Database(":memory:")
    applyMigrations(db)
    const repo = new LiveGameCaptureRepository(db as never)
    repo.record(10, "owner", snapshot(412.3, {
      events: [{
        id: 77,
        name: "ChampionKill",
        time: 412.3,
        killerName: "Unknown killer",
        victimName: "Unknown victim",
        assisters: [],
      }],
    }))
    const timeline: CompactTimeline = { frames: [], events: [], turningPoints: [] }

    const enriched = repo.enrichTimeline(10, "owner", timeline, [
      { participantId: 1, teamId: 100, isPlayer: 1, summonerName: "Owner#NA1" },
    ])

    expect(repo.listEvents(10, "owner")).toHaveLength(1)
    expect(enriched.events.filter((event) => event.type === "CHAMPION_KILL"))
      .toEqual([])
    expect(enriched.evidenceCoverage).toMatchObject({
      incompleteSupplementalKillEvents: 1,
    })
  })

  it("joins an unresolved live kill to a unique post-game event by timestamp", () => {
    const db = new Database(":memory:")
    applyMigrations(db)
    const repo = new LiveGameCaptureRepository(db as never)
    repo.record(10, "owner", snapshot(412.3, {
      events: [{
        id: 78,
        name: "ChampionKill",
        time: 412.3,
        killerName: "Unresolved killer",
        victimName: "Unresolved victim",
        assisters: [],
      }],
    }))
    const timeline: CompactTimeline = {
      frames: [],
      events: [{
        eventId: "post-game-unique-kill",
        timestamp: 412_275,
        type: "CHAMPION_KILL",
        category: "kill",
        participantId: 1,
        targetId: 6,
        teamId: 100,
        position: { x: 7_000, y: 7_000 },
      }],
      turningPoints: [],
    }

    const enriched = repo.enrichTimeline(10, "owner", timeline, [
      { participantId: 1, teamId: 100, isPlayer: 1, summonerName: "Owner#NA1" },
    ])

    expect(enriched.events.filter((event) => event.type === "CHAMPION_KILL"))
      .toEqual([expect.objectContaining({
        eventId: "post-game-unique-kill",
        participantId: 1,
        targetId: 6,
        position: { x: 7_000, y: 7_000 },
      })])
    expect(enriched.evidenceCoverage?.incompleteSupplementalKillEvents).toBe(0)
  })
})
