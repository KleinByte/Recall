import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { ParticipantsRepository } from "../electron/main/database/participants-repo.js"
import type { ParticipantRow, TeamRow } from "../electron/main/matches/types.js"
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

const team = (overrides: Partial<TeamRow> = {}): TeamRow => ({
  gameId: 1,
  puuid: PUUID,
  teamId: 100,
  win: 0,
  bans: "[]",
  baronKills: 0,
  dragonKills: 0,
  heraldKills: 0,
  hordeKills: 0,
  towerKills: 0,
  inhibitorKills: 0,
  firstBlood: 0,
  firstTower: 0,
  firstBaron: 0,
  firstDragon: 0,
  firstInhibitor: 0,
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

  it("scopes owner augment performance to the selected champion", () => {
    matches.insertMany([
      buildMatchRow({ gameId: 1, championId: 84, durationSecs: 1200 }),
      buildMatchRow({ gameId: 2, championId: 22, durationSecs: 1200 }),
    ])
    repo.insertMany([
      participant({
        gameId: 1,
        championId: 84,
        isPlayer: 1,
        augments: [{ slot: 1, augmentId: 101, source: "match_v5" }],
      }),
      participant({
        gameId: 2,
        championId: 22,
        isPlayer: 1,
        augments: [{ slot: 1, augmentId: 101, source: "match_v5" }],
      }),
    ])
    const setGrade = db.prepare(
      `UPDATE match_participants
       SET grade = 'B', grade_score = ?, grade_algorithm_version = 2,
           grade_status = 'ready', grade_composite_percentile = .5
       WHERE game_id = ? AND puuid = ?`,
    )
    setGrade.run(1.2, 1, PUUID)
    setGrade.run(-0.6, 2, PUUID)

    const summary = repo.getOwnerAugmentSummaries(PUUID, undefined, 84)
    expect(summary).toHaveLength(1)
    expect(summary[0]).toMatchObject({
      augmentId: 101,
      games: 1,
      averageGrade: 1.2,
      champions: [{ championId: 84, games: 1 }],
    })
    expect(summary[0]).not.toHaveProperty("winRate")
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

  it("does not let a partial retry erase a complete core payload", () => {
    repo.insertMany([participant({
      kills: 5,
      gradeCoreComplete: 1,
      gradeCoreSource: "match_v5",
      gradeCoreMissingFields: [],
      gradeCoreContractVersion: 1,
    })])

    repo.insertMany([participant({
      kills: 0,
      gradeCoreComplete: 0,
      gradeCoreSource: "league_client",
      gradeCoreMissingFields: ["kills"],
      gradeCoreContractVersion: 1,
    })])

    expect(repo.getMatchDetail(1, PUUID).participants[0]).toMatchObject({
      kills: 5,
      gradeCoreComplete: 1,
      gradeCoreSource: "match_v5",
      gradeCoreMissingFields: [],
      gradeCoreContractVersion: 1,
    })
  })

  it("lets a complete retry replace an incomplete fallback with explicit zero", () => {
    repo.insertMany([participant({
      gameId: 2,
      kills: 99,
      gradeCoreComplete: 0,
      gradeCoreSource: "league_client",
      gradeCoreMissingFields: ["kills"],
    })])

    repo.insertMany([participant({
      gameId: 2,
      kills: 0,
      gradeCoreComplete: 1,
      gradeCoreSource: "match_v5",
      gradeCoreMissingFields: [],
    })])

    expect(repo.getMatchDetail(2, PUUID).participants[0]).toMatchObject({
      kills: 0,
      gradeCoreComplete: 1,
      gradeCoreSource: "match_v5",
      gradeCoreMissingFields: [],
    })
  })

  it("stores the participant PUUID needed for mastery lookups without account IDs", () => {
    repo.insertMany(lobby(1, 30000))

    const columns = repo.columnNames()

    expect(columns).toContain("participant_puuid")
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

  it("repairs partial team rows without letting a later partial retry erase facts", () => {
    repo.insertMany(lobby(1, 30000))
    repo.insertTeams([team()])

    repo.insertTeams([team({
      win: 1,
      bans: "[12,34,56]",
      baronKills: 1,
      dragonKills: 3,
      heraldKills: 1,
      hordeKills: 6,
      towerKills: 8,
      inhibitorKills: 2,
      firstBlood: 1,
      firstTower: 1,
      firstBaron: 1,
      firstDragon: 1,
      firstInhibitor: 1,
    })])

    // A narrower reread can happen after the richer payload. Monotonic final
    // scoreboard facts must survive it as well.
    repo.insertTeams([team()])

    expect(repo.getMatchDetail(1, PUUID).teams[0]).toMatchObject({
      win: 1,
      bans: "[12,34,56]",
      baronKills: 1,
      dragonKills: 3,
      heraldKills: 1,
      hordeKills: 6,
      towerKills: 8,
      inhibitorKills: 2,
      firstBlood: 1,
      firstTower: 1,
      firstBaron: 1,
      firstDragon: 1,
      firstInhibitor: 1,
    })
  })

  it("reads back a player's build and identity", () => {
    repo.insertMany(lobby(1, 30000))

    const row = repo.getMatchDetail(1, PUUID).participants[0]

    expect(row.items).toEqual([1001, 3006, 3031, 3072, 3094, 6673, 2055])
    expect(row.perks).toEqual([8005, 9111, 9104, 8014, 8345, 8347])
    expect(row.summonerName).toBe("Someone#NA1")
    expect(row.champLevel).toBe(18)
  })

  it("keeps the champion select assignment beside Riot's lane and role", () => {
    repo.insertMany([
      participant({ isPlayer: 1, assignedPosition: "UTILITY" }),
      participant({ participantId: 2 }),
    ])

    const rows = repo.getMatchDetail(1, PUUID).participants

    expect(rows[0]).toMatchObject({
      lane: "MIDDLE",
      role: "SOLO",
      assignedPosition: "UTILITY",
    })
    expect(rows[1].assignedPosition).toBeUndefined()
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

  it("compares CS against the opposing role when exactly one peer exists", () => {
    matches.insertMany([
      buildMatchRow({ gameId: 1, mode: "sr_ranked_solo", modeFamily: "sr" }),
    ])
    // Player is MIDDLE with 150 CS — second-best mid but 8th in lobby.
    const players = Array.from({ length: 10 }, (_, i) =>
      participant({
        gameId: 1,
        participantId: i + 1,
        teamId: i < 5 ? 100 : 200,
        isPlayer: i === 0 ? 1 : 0,
        totalMinionsKilled: i === 0 ? 150 : (i === 5 ? 200 : 300),
        neutralMinions: 0,
        goldEarned: i === 0 ? 10000 : (i === 5 ? 12000 : 15000),
        visionScore: i === 0 ? 30 : (i === 5 ? 25 : 40),
        role: i === 0 || i === 5 ? "MIDDLE" : "TOP",
        assignedPosition: i === 0 ? "UTILITY" : undefined,
        extendedMetrics: { teamPosition: i === 0 || i === 5 ? "MIDDLE" : "TOP" },
      }),
    )
    repo.insertMany(players)

    const comparison = repo.getLobbyComparison({ puuid: PUUID, modes: ["sr_ranked_solo"] })!
    const cs = comparison.metrics.find((m) => m.key === "cs")!
    const gold = comparison.metrics.find((m) => m.key === "gold")!
    const vision = comparison.metrics.find((m) => m.key === "vision")!

    // Compared against one opposing mid (200 CS) → player is worse → rank 2 of 2.
    expect(cs.scope).toBe("role")
    expect(cs.averageRank).toBe(2)
    expect(gold.scope).toBe("role")
    expect(vision.scope).toBe("role")
    // Damage stays lobby-scoped.
    expect(comparison.metrics.find((m) => m.key === "damage")!.scope).toBe("lobby")
  })

  it("falls back to lobby when role labels are missing", () => {
    matches.insertMany([
      buildMatchRow({ gameId: 1, mode: "sr_ranked_solo", modeFamily: "sr" }),
    ])
    // This is a real short-game LCU failure mode: a role hint with no lane is
    // not enough evidence to call every participant a support.
    const players = Array.from({ length: 10 }, (_, i) =>
      participant({
        gameId: 1,
        participantId: i + 1,
        teamId: i < 5 ? 100 : 200,
        isPlayer: i === 0 ? 1 : 0,
        totalMinionsKilled: i === 0 ? 150 : 100,
        neutralMinions: 0,
        role: "SUPPORT",
        lane: "NONE",
        extendedMetrics: {},
      }),
    )
    repo.insertMany(players)

    const comparison = repo.getLobbyComparison({ puuid: PUUID, modes: ["sr_ranked_solo"] })!
    const cs = comparison.metrics.find((m) => m.key === "cs")!

    expect(cs.scope).toBe("lobby")
  })

  it("ARAM lobbies are always lobby-scoped", () => {
    matches.insertMany([
      buildMatchRow({ gameId: 1, mode: "aram", modeFamily: "aram" }),
    ])
    const players = Array.from({ length: 10 }, (_, i) =>
      participant({
        gameId: 1,
        participantId: i + 1,
        teamId: i < 5 ? 100 : 200,
        isPlayer: i === 0 ? 1 : 0,
        totalMinionsKilled: i === 0 ? 200 : 100,
        neutralMinions: 0,
      }),
    )
    repo.insertMany(players)

    const comparison = repo.getLobbyComparison({ puuid: PUUID, modes: ["aram"] })!

    for (const metric of comparison.metrics) {
      expect(metric.scope).toBe("lobby")
    }
  })

  it("treats absent modes filter as lobby scope over mixed data", () => {
    matches.insertMany([
      buildMatchRow({ gameId: 1, mode: "sr_ranked_solo", modeFamily: "sr" }),
      buildMatchRow({ gameId: 2, mode: "aram", modeFamily: "aram" }),
    ])
    // Game 1: SR with roles
    repo.insertMany(
      Array.from({ length: 10 }, (_, i) =>
        participant({
          gameId: 1,
          participantId: i + 1,
          teamId: i < 5 ? 100 : 200,
          isPlayer: i === 0 ? 1 : 0,
          totalMinionsKilled: i === 0 ? 150 : 100,
          neutralMinions: 0,
          role: i === 0 || i === 5 ? "MIDDLE" : "TOP",
          extendedMetrics: { teamPosition: i === 0 || i === 5 ? "MIDDLE" : "TOP" },
        }),
      ),
    )
    // Game 2: ARAM
    repo.insertMany(
      Array.from({ length: 10 }, (_, i) =>
        participant({
          gameId: 2,
          participantId: i + 1,
          teamId: i < 5 ? 100 : 200,
          isPlayer: i === 0 ? 1 : 0,
          totalMinionsKilled: i === 0 ? 200 : 100,
          neutralMinions: 0,
        }),
      ),
    )

    // No mode filter → should use lobby scope despite having SR data
    const comparison = repo.getLobbyComparison({ puuid: PUUID })!

    expect(comparison.games).toBe(2)
    for (const metric of comparison.metrics) {
      expect(metric.scope).toBe("lobby")
    }
  })

  it("handles malformed extended_metrics_json gracefully", () => {
    matches.insertMany([
      buildMatchRow({ gameId: 1, mode: "sr_ranked_solo", modeFamily: "sr" }),
    ])
    // Create participants with one having malformed JSON
    const players = Array.from({ length: 10 }, (_, i) =>
      participant({
        gameId: 1,
        participantId: i + 1,
        teamId: i < 5 ? 100 : 200,
        isPlayer: i === 0 ? 1 : 0,
        totalMinionsKilled: i === 0 ? 150 : (i === 5 ? 200 : 100),
        neutralMinions: 0,
        role: i === 0 || i === 5 ? "MIDDLE" : "TOP",
        extendedMetrics: { teamPosition: i === 0 || i === 5 ? "MIDDLE" : "TOP" },
      }),
    )
    repo.insertMany(players)

    // Corrupt the extended_metrics_json for one participant
    db.prepare(
      "UPDATE match_participants SET extended_metrics_json = ? WHERE game_id = 1 AND participant_id = 6",
    ).run("{malformed json")

    // Should not throw and should fall back to stored role
    const comparison = repo.getLobbyComparison({ puuid: PUUID, modes: ["sr_ranked_solo"] })

    expect(comparison).toBeDefined()
    expect(comparison!.games).toBe(1)
  })
})
