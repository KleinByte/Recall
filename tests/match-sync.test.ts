import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { ParticipantsRepository } from "../electron/main/database/participants-repo.js"
import { ChampSelectRepository } from "../electron/main/database/champ-select-repo.js"
import { MatchSync } from "../electron/main/match-sync.js"
import type { LcuGame } from "../electron/main/matches/types.js"

const PUUID = "test-puuid"

const aramGame = (gameId: number, gameMode = "ARAM"): LcuGame =>
  ({
    gameId,
    gameCreation: 1_700_000_000_000 + gameId * 1000,
    gameDuration: 1200,
    gameMode,
    gameType: "MATCHED_GAME",
    gameVersion: "16.14",
    queueId: gameMode === "ARAM" ? 450 : 2400,
    mapId: 12,
    participants: [
      {
        championId: 84,
        stats: {
          win: gameId % 2 === 0,
          kills: 5,
          deaths: 5,
          assists: 5,
          champLevel: 18,
          goldEarned: 12000,
          totalDamageDealtToChampions: 20000,
          totalDamageTaken: 20000,
          damageSelfMitigated: 10000,
          totalHeal: 3000,
          totalUnitsHealed: 1,
          timeCCingOthers: 20,
          largestKillingSpree: 2,
          largestMultiKill: 1,
          doubleKills: 0,
          tripleKills: 0,
          quadraKills: 0,
          pentaKills: 0,
          totalMinionsKilled: 40,
          visionScore: 3,
          gameEndedInSurrender: false,
          gameEndedInEarlySurrender: false,
        },
      },
    ],
  }) as LcuGame

/** Arena is retained under the generic "other" history family. */
const arenaGame = (gameId: number): LcuGame =>
  ({
    ...aramGame(gameId),
    mapId: 30,
    gameMode: "CHERRY",
    queueId: 1700,
  }) as LcuGame

/** A ranked Summoner's Rift game, which is tracked. */
const riftGame = (gameId: number): LcuGame =>
  ({
    ...aramGame(gameId),
    mapId: 11,
    gameMode: "CLASSIC",
    queueId: 420,
  }) as LcuGame

class FakeClient {
  requests: string[] = []
  failDetail = false
  buildDetail: (gameId: number) => unknown = buildLobby
  queues: unknown[] = []

  constructor(private games: LcuGame[]) {}

  setGames(games: LcuGame[]) {
    this.games = games
  }

  request<T>(path: string): Promise<T> {
    this.requests.push(path)

    if (path.includes("/lol-game-queues/")) {
      return Promise.resolve(this.queues as T)
    }

    const detail = path.match(/\/games\/(\d+)$/)
    if (detail) {
      if (this.failDetail) return Promise.reject(new Error("not found"))
      return Promise.resolve(this.buildDetail(Number(detail[1])) as T)
    }

    return Promise.resolve({ games: { games: this.games } } as T)
  }
}

/**
 * A lobby where every player performed identically apart from farming.
 *
 * Creep score counts on Summoner's Rift and is ignored in ARAM, so this lobby
 * separates the two sets of grading weights: the farmer stands out in one and
 * is indistinguishable in the other.
 */
function buildFarmLobby(gameId: number) {
  const participants = Array.from({ length: 10 }, (_, index) => ({
    participantId: index + 1,
    teamId: index < 5 ? 100 : 200,
    stats: {
      kills: 5,
      deaths: 5,
      assists: 10,
      totalDamageDealtToChampions: 20000,
      totalDamageTaken: 20000,
      goldEarned: 12000,
      visionScore: 20,
      damageDealtToObjectives: 5000,
      totalMinionsKilled: index === 0 ? 400 : 100,
      neutralMinionsKilled: 0,
    },
    timeline: { role: "SOLO" },
  }))

  return {
    gameId,
    gameDuration: 1800,
    participantIdentities: participants.map((participant) => ({
      participantId: participant.participantId,
      player: { puuid: participant.participantId === 1 ? PUUID : "other" },
    })),
    participants,
  }
}

/** A full ten-player lobby where our player is participant 1. */
function buildLobby(gameId: number) {
  const participants = Array.from({ length: 10 }, (_, index) => ({
    participantId: index + 1,
    teamId: index < 5 ? 100 : 200,
    stats: {
      kills: index === 0 ? 20 : 4,
      deaths: index === 0 ? 2 : 6,
      assists: index === 0 ? 20 : 8,
      totalDamageDealtToChampions: index === 0 ? 50000 : 18000,
      totalDamageTaken: 20000,
      goldEarned: index === 0 ? 15000 : 9000,
    },
  }))

  return {
    gameId,
    participantIdentities: participants.map((participant) => ({
      participantId: participant.participantId,
      player: { puuid: participant.participantId === 1 ? PUUID : "other" },
    })),
    participants,
  }
}

let repo: MatchesRepository
let participants: ParticipantsRepository
let db: InstanceType<typeof Database>

beforeEach(() => {
  db = new Database(":memory:")
  applyMigrations(db)
  repo = new MatchesRepository(db)
  participants = new ParticipantsRepository(db)
})

describe("MatchSync", () => {
  it("stores every mode without losing Arena or rotating games", () => {
    const games = [
      ...[1, 2, 3, 4].map((id) => aramGame(id)),
      ...[5, 6].map((id) => aramGame(id, "KIWI")),
      ...[7, 8].map(riftGame),
      ...[9, 10].map(arenaGame),
    ]
    const client = new FakeClient(games)
    const sync = new MatchSync(client as never, repo, PUUID)

    return sync.syncNow().then((result) => {
      expect(result.fetched).toBe(10)
      // Four ARAM, two Mayhem, two Rift and two other-mode games.
      expect(result.inserted).toBe(10)
      expect(repo.countMatches(PUUID)).toBe(10)
    })
  })

  it("inserts nothing when the same window is synced again", async () => {
    const client = new FakeClient([1, 2, 3].map((id) => aramGame(id)))
    const sync = new MatchSync(client as never, repo, PUUID)

    await sync.syncNow()
    const second = await sync.syncNow()

    expect(second.fetched).toBe(3)
    expect(second.inserted).toBe(0)
    expect(repo.countMatches(PUUID)).toBe(3)
  })

  it("adds only the newly played games when the window slides", async () => {
    const client = new FakeClient([1, 2, 3].map((id) => aramGame(id)))
    const sync = new MatchSync(client as never, repo, PUUID)
    await sync.syncNow()

    // Two new games pushed the oldest out of the client's window.
    client.setGames([3, 4, 5].map((id) => aramGame(id)))
    const result = await sync.syncNow()

    expect(result.inserted).toBe(2)
    expect(repo.countMatches(PUUID)).toBe(5)
  })

  it("reports an empty result instead of throwing when the client is unreachable", async () => {
    const failing = {
      request: () => Promise.reject(new Error("ECONNREFUSED")),
    }
    const sync = new MatchSync(failing as never, repo, PUUID)

    await expect(sync.syncNow()).resolves.toEqual({
      fetched: 0,
      inserted: 0,
      graded: 0,
      lobbies: 0,
    })
  })

  it("grades stored matches from the full lobby", async () => {
    const client = new FakeClient([1, 2].map((id) => aramGame(id)))
    const sync = new MatchSync(client as never, repo, PUUID)

    const result = await sync.syncNow()

    expect(result.graded).toBe(2)
    const stored = repo.getRecentMatches({ puuid: PUUID }, 5)
    expect(stored[0].grade).toBe("S+")
  })

  it("does not regrade matches that already have a grade", async () => {
    const client = new FakeClient([1].map((id) => aramGame(id)))
    const sync = new MatchSync(client as never, repo, PUUID)

    await sync.syncNow()
    const second = await sync.syncNow()

    expect(second.graded).toBe(0)
  })

  it("still records matches when grading fails", async () => {
    const client = new FakeClient([1, 2].map((id) => aramGame(id)))
    client.failDetail = true
    const sync = new MatchSync(client as never, repo, PUUID)

    const result = await sync.syncNow()

    expect(result.inserted).toBe(2)
    expect(result.graded).toBe(0)
    expect(repo.countMatches(PUUID)).toBe(2)
  })

  it("does not store or grade bot games", async () => {
    const bot = riftGame(1)
    bot.queueId = 890
    const client = new FakeClient([bot])
    const sync = new MatchSync(client as never, repo, PUUID, participants)

    const result = await sync.syncNow()

    expect(result).toMatchObject({ fetched: 1, inserted: 0, graded: 0, lobbies: 0 })
    expect(repo.countMatches(PUUID)).toBe(0)
    expect(participants.countGamesWithLobby(PUUID)).toBe(0)
  })

  it("grades a Rift game on the statistics that mode rewards", async () => {
    const client = new FakeClient([riftGame(1)])
    client.buildDetail = buildFarmLobby
    const sync = new MatchSync(client as never, repo, PUUID)

    await sync.syncNow()

    // The player out-farmed the lobby four to one, which only counts on the
    // Rift. Grading it as ARAM would ignore that entirely.
    const stored = repo.getRecentMatches({ puuid: PUUID }, 1)
    expect(stored[0].gradeScore).toBeGreaterThan(0)
  })

  it("ignores farming when grading ARAM", async () => {
    const client = new FakeClient([aramGame(1)])
    client.buildDetail = buildFarmLobby
    const sync = new MatchSync(client as never, repo, PUUID)

    await sync.syncNow()

    const stored = repo.getRecentMatches({ puuid: PUUID }, 1)
    expect(stored[0].gradeScore).toBeCloseTo(0)
  })

  it("keeps the lobby it already fetched for grading", async () => {
    const client = new FakeClient([1, 2].map((id) => aramGame(id)))
    const sync = new MatchSync(client as never, repo, PUUID, participants)

    await sync.syncNow()

    expect(participants.countGamesWithLobby(PUUID)).toBe(2)
  })

  it("does not fetch a game twice to store its lobby", async () => {
    const client = new FakeClient([aramGame(1)])
    const sync = new MatchSync(client as never, repo, PUUID, participants)

    await sync.syncNow()

    const detailRequests = client.requests.filter((path) =>
      path.includes("/games/"),
    )
    expect(detailRequests).toHaveLength(1)
  })

  it("backfills the lobby for a game graded before lobbies were kept", async () => {
    // A game already recorded and graded, with no lobby stored.
    const client = new FakeClient([aramGame(1)])
    await new MatchSync(client as never, repo, PUUID).syncNow()
    expect(participants.countGamesWithLobby(PUUID)).toBe(0)

    const result = await new MatchSync(
      client as never,
      repo,
      PUUID,
      participants,
    ).syncNow()

    expect(result.lobbies).toBe(1)
    expect(participants.countGamesWithLobby(PUUID)).toBe(1)
  })

  it("stamps champion select assignments onto the player's own team", async () => {
    const client = new FakeClient([riftGame(1)])
    client.buildDetail = (gameId) => {
      const detail = buildLobby(gameId)
      detail.participants.forEach((participant, index) => {
        Object.assign(participant, { championId: 100 + index })
      })
      return detail
    }
    const champSelect = new ChampSelectRepository(db)
    // Champion 105 sits on the enemy team, so its assignment must be ignored.
    champSelect.record(1, PUUID, [
      { championId: 100, position: "UTILITY" },
      { championId: 105, position: "TOP" },
    ])

    await new MatchSync(
      client as never,
      repo,
      PUUID,
      participants,
      champSelect,
    ).syncNow()

    const stored = participants.getMatchDetail(1, PUUID).participants
    expect(stored.find((row) => row.championId === 100)?.assignedPosition).toBe("UTILITY")
    expect(stored.find((row) => row.championId === 105)?.assignedPosition).toBeUndefined()
  })

  it("records the queue name the client reports", async () => {
    const client = new FakeClient([aramGame(1, "KIWI")])
    client.queues = [
      {
        id: 2400,
        name: "ARAM: Mayhem",
        shortName: "ARAM: Mayhem",
        gameMode: "KIWI",
        mapId: 12,
        isRanked: false,
      },
    ]
    const sync = new MatchSync(client as never, repo, PUUID)

    await sync.syncNow()

    expect(repo.getRecentMatches({ puuid: PUUID }, 1)[0].queueName).toBe(
      "ARAM: Mayhem",
    )
  })
})
