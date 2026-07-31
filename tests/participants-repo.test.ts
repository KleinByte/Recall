import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { ParticipantsRepository } from "../electron/main/database/participants-repo.js"
import type { ParticipantRow } from "../electron/main/matches/types.js"
import { buildMatchRow } from "./fixtures/matches.js"

const PUUID = "test-puuid"

let repo: ParticipantsRepository
let matches: MatchesRepository
let db: InstanceType<typeof Database>

beforeEach(() => {
  db = new Database(":memory:")
  applyMigrations(db)
  repo = new ParticipantsRepository(db)
  matches = new MatchesRepository(db)
})

const participant = (overrides: Partial<ParticipantRow> = {}): ParticipantRow => ({
  gameId: 1,
  puuid: PUUID,
  participantId: 1,
  teamId: 100,
  isPlayer: 0,
  championId: 84,
  win: 1,
  summonerName: "Someone#NA1",
  profileIcon: 501,
  spell1Id: 4,
  spell2Id: 14,
  items: [1001, 3006, 3031, 3072, 3094, 6673, 2055],
  perkPrimaryStyle: 8000,
  perkSubStyle: 8300,
  perks: [8005, 9111, 9104, 8014, 8345, 8347],
  champLevel: 18,
  kills: 5,
  deaths: 5,
  assists: 10,
  goldEarned: 12000,
  goldSpent: 11000,
  damageToChampions: 20000,
  totalDamageDealt: 90000,
  magicDamageToChampions: 5000,
  physicalDamageToChampions: 14000,
  trueDamageToChampions: 1000,
  damageTaken: 20000,
  damageSelfMitigated: 10000,
  totalHeal: 3000,
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
  damageObjectives: 5000,
  damageTurrets: 2000,
  turretKills: 1,
  inhibitorKills: 0,
  longestTimeLiving: 400,
  firstBlood: 0,
  firstTower: 0,
  lane: "MIDDLE",
  role: "SOLO",
  ...overrides,
})

/**
 * A lobby where the player is participant 1 and `playerDamage` sets them apart.
 * Everyone else deals 10,000.
 */
const lobby = (gameId: number, playerDamage: number): ParticipantRow[] =>
  Array.from({ length: 10 }, (_, index) =>
    participant({
      gameId,
      participantId: index + 1,
      teamId: index < 5 ? 100 : 200,
      isPlayer: index === 0 ? 1 : 0,
      damageToChampions: index === 0 ? playerDamage : 10000,
    }),
  )

describe("ParticipantsRepository", () => {
  it("stores a whole lobby", () => {
    expect(repo.insertMany(lobby(1, 30000))).toBe(10)
    expect(repo.countGamesWithLobby(PUUID)).toBe(1)
  })

  it("stores augments for every player but aggregates only the owner without wins", () => {
    matches.insertMany([buildMatchRow({ gameId: 1, durationSecs: 1200 })])
    const rows = lobby(1, 30000).map((row) => ({
      ...row,
      augments: [{
        slot: 1,
        augmentId: row.isPlayer ? 101 : 202,
        source: "match_v5" as const,
      }],
    }))
    repo.insertMany(rows)

    expect(repo.getMatchDetail(1, PUUID).participants.every(
      (row) => row.augments?.length === 1,
    )).toBe(true)
    const ownerSummary = repo.getOwnerAugmentSummaries(PUUID)
    expect(ownerSummary).toHaveLength(1)
    expect(ownerSummary[0]).toMatchObject({ augmentId: 101, games: 1 })
    expect(ownerSummary[0]).not.toHaveProperty("wins")
    expect(ownerSummary[0]).not.toHaveProperty("winRate")
  })

  it("caches stable augment metadata and snapshots captured selections", () => {
    matches.insertMany([buildMatchRow({ gameId: 1 })])
    repo.insertMany([
      participant({
        isPlayer: 1,
        augments: [{ slot: 1, augmentId: 101, source: "match_v5" }],
      }),
    ])

    expect(repo.cacheAugmentCatalog("16.15.1", [{
      augmentId: 101,
      name: "Measured Risk",
      rarity: "gold",
      iconPath: "https://raw.communitydragon.org/latest/icon.png",
    }])).toBe(1)

    expect(repo.getMatchDetail(1, PUUID).participants[0].augments?.[0])
      .toMatchObject({
        name: "Measured Risk",
        rarity: "gold",
      })
  })

  it("does not duplicate a lobby it already holds", () => {
    repo.insertMany(lobby(1, 30000))
    repo.insertMany(lobby(1, 30000))

    expect(repo.countGamesWithLobby(PUUID)).toBe(1)
    expect(repo.getMatchDetail(1, PUUID).participants).toHaveLength(10)
  })

  it("keeps no names or identifiers for the other players", () => {
    repo.insertMany(lobby(1, 30000))

    const columns = repo.columnNames()

    expect(columns).not.toContain("participant_puuid")
    expect(columns).not.toContain("account_id")
  })

  it("reads back the whole scoreboard", () => {
    repo.insertMany(lobby(1, 30000))
    repo.insertTeams([
      {
        gameId: 1,
        puuid: PUUID,
        teamId: 100,
        win: 1,
        bans: "[12,34]",
        baronKills: 1,
        dragonKills: 3,
        heraldKills: 1,
        hordeKills: 4,
        towerKills: 8,
        inhibitorKills: 2,
        firstBlood: 1,
        firstTower: 1,
        firstBaron: 1,
        firstDragon: 1,
        firstInhibitor: 1,
      },
    ])

    const detail = repo.getMatchDetail(1, PUUID)

    expect(detail.participants).toHaveLength(10)
    expect(detail.teams).toHaveLength(1)
    expect(detail.teams[0].dragonKills).toBe(3)
  })

  it("reads back a player's build and identity", () => {
    repo.insertMany(lobby(1, 30000))

    const row = repo.getMatchDetail(1, PUUID).participants[0]

    expect(row.items).toEqual([1001, 3006, 3031, 3072, 3094, 6673, 2055])
    expect(row.perks).toEqual([8005, 9111, 9104, 8014, 8345, 8347])
    expect(row.summonerName).toBe("Someone#NA1")
    expect(row.champLevel).toBe(18)
  })

  it("orders the scoreboard by team", () => {
    repo.insertMany(lobby(1, 30000))

    const teams = repo
      .getMatchDetail(1, PUUID)
      .participants.map((row) => row.teamId)

    expect(teams).toEqual([100, 100, 100, 100, 100, 200, 200, 200, 200, 200])
  })

  it("reports which stored games still have no lobby", () => {
    repo.insertMany(lobby(1, 30000))

    const missing = repo.getGamesMissingLobby(PUUID, [1, 2, 3], 10)

    expect(missing).toEqual([2, 3])
  })

  it("treats a lobby stored before the full scoreboard as still missing", () => {
    repo.insertMany(lobby(1, 30000))
    // Rows written by an earlier version carry no completeness marker.
    db.prepare("UPDATE match_participants SET detail_version = 0").run()

    expect(repo.getGamesMissingLobby(PUUID, [1], 10)).toEqual([1])
  })

  it("stops asking for a lobby once it has been read in full", () => {
    // A payload with no names is still complete; there is nothing more to get.
    repo.insertMany(
      lobby(1, 30000).map((row) => ({ ...row, summonerName: undefined })),
    )

    expect(repo.getGamesMissingLobby(PUUID, [1], 10)).toEqual([])
  })

  it("replaces a partial lobby when the full one arrives", () => {
    repo.insertMany(
      lobby(1, 30000).map((row) => ({ ...row, summonerName: undefined })),
    )
    repo.insertMany(lobby(1, 30000))

    const rows = repo.getMatchDetail(1, PUUID).participants

    expect(rows).toHaveLength(10)
    expect(rows[0].summonerName).toBe("Someone#NA1")
  })

  it("limits how many missing games it reports at once", () => {
    expect(repo.getGamesMissingLobby(PUUID, [1, 2, 3, 4], 2)).toHaveLength(2)
  })
})

describe("lobby comparison", () => {
  it("puts a dominant player at the top of their lobbies", () => {
    repo.insertMany(lobby(1, 50000))

    const comparison = repo.getLobbyComparison({ puuid: PUUID })!

    const damage = comparison.metrics.find((m) => m.key === "damage")!
    // Best of ten.
    expect(damage.averageRank).toBe(1)
    expect(damage.percentile).toBeCloseTo(1)
  })

  it("puts the worst player at the bottom", () => {
    repo.insertMany(lobby(1, 100))

    const damage = repo
      .getLobbyComparison({ puuid: PUUID })!
      .metrics.find((m) => m.key === "damage")!

    expect(damage.averageRank).toBe(10)
    expect(damage.percentile).toBeCloseTo(0)
  })

  it("averages the player's rank across every game", () => {
    // Best in one game, worst in the next.
    repo.insertMany(lobby(1, 50000))
    repo.insertMany(lobby(2, 100))

    const damage = repo
      .getLobbyComparison({ puuid: PUUID })!
      .metrics.find((m) => m.key === "damage")!

    expect(damage.averageRank).toBeCloseTo(5.5)
  })

  it("counts the games behind the comparison", () => {
    repo.insertMany(lobby(1, 50000))
    repo.insertMany(lobby(2, 50000))

    expect(repo.getLobbyComparison({ puuid: PUUID })!.games).toBe(2)
  })

  it("reports nothing when no lobby has been recorded", () => {
    expect(repo.getLobbyComparison({ puuid: PUUID })).toBeUndefined()
  })

  it("compares every metric the panel shows", () => {
    repo.insertMany(lobby(1, 50000))

    const keys = repo.getLobbyComparison({ puuid: PUUID })!.metrics.map((m) => m.key)

    expect(keys).toEqual([
      "damage",
      "damageTaken",
      "gold",
      "kda",
      "killInvolvement",
      "cs",
      "vision",
      "objectives",
    ])
  })

  it("ranks a tied lobby in the middle rather than at either end", () => {
    repo.insertMany(lobby(1, 10000))

    const damage = repo
      .getLobbyComparison({ puuid: PUUID })!
      .metrics.find((m) => m.key === "damage")!

    expect(damage.averageRank).toBeGreaterThan(1)
    expect(damage.averageRank).toBeLessThan(10)
  })

  it("compares only the games of the mode asked for", () => {
    matches.insertMany([
      buildMatchRow({ gameId: 1, mode: "mayhem", modeFamily: "aram" }),
      buildMatchRow({ gameId: 2, mode: "aram", modeFamily: "aram" }),
    ])
    // Top of the lobby in Mayhem, bottom of it in ARAM.
    repo.insertMany(lobby(1, 50000))
    repo.insertMany(lobby(2, 100))

    const mayhem = repo.getLobbyComparison({ puuid: PUUID, mode: "mayhem" })!

    expect(mayhem.games).toBe(1)
    expect(mayhem.metrics.find((m) => m.key === "damage")!.averageRank).toBe(1)
  })

  it("isolates ranked and normal Rift scopes from each other and from ARAM", () => {
    matches.insertMany([
      buildMatchRow({ gameId: 1, mode: "sr_ranked_solo", modeFamily: "sr" }),
      buildMatchRow({ gameId: 2, mode: "sr_ranked_flex", modeFamily: "sr" }),
      buildMatchRow({ gameId: 3, mode: "sr_normal", modeFamily: "sr" }),
      buildMatchRow({ gameId: 4, mode: "sr_quickplay", modeFamily: "sr" }),
      buildMatchRow({ gameId: 5, mode: "sr_swiftplay", modeFamily: "sr" }),
      buildMatchRow({ gameId: 6, mode: "aram", modeFamily: "aram" }),
      buildMatchRow({ gameId: 7, mode: "mayhem", modeFamily: "aram" }),
    ])
    repo.insertMany(lobby(1, 10000))
    repo.insertMany(lobby(2, 10000))
    repo.insertMany(lobby(3, 10000))
    repo.insertMany(lobby(4, 10000))
    repo.insertMany(lobby(5, 10000))
    repo.insertMany(lobby(6, 10000))
    repo.insertMany(lobby(7, 10000))

    expect(
      repo.getLobbyComparison({ puuid: PUUID, modes: ["sr_ranked_solo", "sr_ranked_flex"] })!.games,
    ).toBe(2)
    expect(
      repo.getLobbyComparison({ puuid: PUUID, modes: ["sr_normal", "sr_quickplay", "sr_swiftplay"] })!.games,
    ).toBe(3)
    expect(repo.getLobbyComparison({ puuid: PUUID, modes: ["sr_ranked_solo"] })!.games).toBe(1)
    expect(repo.getLobbyComparison({ puuid: PUUID, modes: ["aram"] })!.games).toBe(1)
    // ARAM scope never includes Mayhem
    expect(repo.getLobbyComparison({ puuid: PUUID, modes: ["mayhem"] })!.games).toBe(1)
  })
})
