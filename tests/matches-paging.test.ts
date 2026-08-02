import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { buildMatchRow, buildMatchSequence } from "./fixtures/matches.js"

const PUUID = "test-puuid"

let repo: MatchesRepository
let db: InstanceType<typeof Database>

beforeEach(() => {
  db = new Database(":memory:")
  applyMigrations(db)
  repo = new MatchesRepository(db)
})

/** Ten players for game 1, graded in the given order, with the owner first. */
const storeLobby = (scores: (number | undefined)[]) => {
  const insert = db.prepare(
    `INSERT INTO match_participants
     (game_id, puuid, participant_id, team_id, is_player, champion_id, win,
      kills, deaths, assists, gold_earned, damage_to_champions, damage_taken,
      damage_self_mitigated, total_heal, time_ccing_others,
      total_minions_killed, neutral_minions, vision_score, damage_objectives,
      grade_score, assigned_position)
     VALUES (1, ?, ?, 100, ?, 84, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)`,
  )
  scores.forEach((score, index) => {
    insert.run(PUUID, index + 1, index === 0 ? 1 : 0, score ?? null,
      index === 0 ? "UTILITY" : null)
  })
}

describe("listMatches", () => {
  it("pages through history newest first", () => {
    repo.insertMany(buildMatchSequence(Array(60).fill(true)))

    const first = repo.listMatches({ puuid: PUUID }, 1, 25)
    const third = repo.listMatches({ puuid: PUUID }, 3, 25)

    expect(first.rows).toHaveLength(25)
    expect(first.total).toBe(60)
    expect(first.rows[0].gameId).toBe(60)

    expect(third.rows).toHaveLength(10)
    expect(third.rows.at(-1)!.gameId).toBe(1)
  })

  it("reports a total that reflects the filters, not the page", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, mode: "aram", modeFamily: "aram" }),
      buildMatchRow({ gameId: 2, mode: "aram", modeFamily: "aram" }),
      buildMatchRow({
        gameId: 3,
        mode: "sr_ranked_solo",
        modeFamily: "sr",
        isRanked: 1,
      }),
    ])

    expect(repo.listMatches({ puuid: PUUID, modes: ["aram"] }, 1, 25).total).toBe(
      2,
    )
  })

  it("filters by several modes at once", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, mode: "aram", modeFamily: "aram" }),
      buildMatchRow({ gameId: 2, mode: "mayhem", modeFamily: "aram" }),
      buildMatchRow({
        gameId: 3,
        mode: "sr_ranked_solo",
        modeFamily: "sr",
      }),
    ])

    const page = repo.listMatches(
      { puuid: PUUID, modes: ["aram", "sr_ranked_solo"] },
      1,
      25,
    )

    expect(page.total).toBe(2)
  })

  it("filters by mode family", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, modeFamily: "aram" }),
      buildMatchRow({ gameId: 2, modeFamily: "sr", mode: "sr_normal" }),
      buildMatchRow({ gameId: 3, modeFamily: "sr", mode: "sr_quickplay" }),
    ])

    expect(
      repo.listMatches({ puuid: PUUID, modeFamily: "sr" }, 1, 25).total,
    ).toBe(2)
  })

  it("filters by ranked only", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, isRanked: 1, mode: "sr_ranked_solo" }),
      buildMatchRow({ gameId: 2, isRanked: 0 }),
    ])

    expect(
      repo.listMatches({ puuid: PUUID, rankedOnly: true }, 1, 25).total,
    ).toBe(1)
  })

  it("filters by result", () => {
    repo.insertMany(buildMatchSequence([true, false, true]))

    expect(repo.listMatches({ puuid: PUUID, result: "win" }, 1, 25).total).toBe(2)
    expect(repo.listMatches({ puuid: PUUID, result: "loss" }, 1, 25).total).toBe(
      1,
    )
  })

  it("filters by champion", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, championId: 84 }),
      buildMatchRow({ gameId: 2, championId: 22 }),
      buildMatchRow({ gameId: 3, championId: 22 }),
    ])

    expect(
      repo.listMatches({ puuid: PUUID, championIds: [22] }, 1, 25).total,
    ).toBe(2)
  })

  it("filters by minimum grade", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1 }),
      buildMatchRow({ gameId: 2 }),
      buildMatchRow({ gameId: 3 }),
    ])
    repo.setGrade(1, PUUID, "S+", 1.8)
    repo.setGrade(2, PUUID, "B", -0.2)

    const page = repo.listMatches({ puuid: PUUID, minGradeScore: 1 }, 1, 25)

    expect(page.total).toBe(1)
    expect(page.rows[0].gameId).toBe(1)
  })

  it("excludes remakes below a minimum duration", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, durationSecs: 200 }),
      buildMatchRow({ gameId: 2, durationSecs: 1800 }),
    ])

    expect(
      repo.listMatches({ puuid: PUUID, minDurationSecs: 300 }, 1, 25).total,
    ).toBe(1)
  })

  it("combines filters", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, championId: 84, win: 1, modeFamily: "aram" }),
      buildMatchRow({ gameId: 2, championId: 84, win: 0, modeFamily: "aram" }),
      buildMatchRow({ gameId: 3, championId: 22, win: 1, modeFamily: "aram" }),
    ])

    const page = repo.listMatches(
      { puuid: PUUID, championIds: [84], result: "win" },
      1,
      25,
    )

    expect(page.total).toBe(1)
    expect(page.rows[0].gameId).toBe(1)
  })

  it("clamps a page beyond the end to the last page", () => {
    repo.insertMany(buildMatchSequence([true, true, true]))

    const page = repo.listMatches({ puuid: PUUID }, 99, 25)

    expect(page.page).toBe(1)
    expect(page.rows).toHaveLength(3)
  })

  it("returns an empty page rather than failing when nothing matches", () => {
    const page = repo.listMatches({ puuid: PUUID }, 1, 25)

    expect(page.total).toBe(0)
    expect(page.rows).toEqual([])
    expect(page.page).toBe(1)
  })

  it("sorts by damage when asked", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, damageToChampions: 10000 }),
      buildMatchRow({ gameId: 2, damageToChampions: 50000 }),
      buildMatchRow({ gameId: 3, damageToChampions: 30000 }),
    ])

    const page = repo.listMatches(
      { puuid: PUUID, sortBy: "damage", sortDir: "desc" },
      1,
      25,
    )

    expect(page.rows.map((row) => row.gameId)).toEqual([2, 3, 1])
  })

  it("sorts ascending when asked", () => {
    repo.insertMany(buildMatchSequence([true, true, true]))

    const page = repo.listMatches(
      { puuid: PUUID, sortBy: "played_at", sortDir: "asc" },
      1,
      25,
    )

    expect(page.rows[0].gameId).toBe(1)
  })

  it("ignores an unrecognised sort column instead of trusting it", () => {
    repo.insertMany(buildMatchSequence([true, true]))

    const page = repo.listMatches(
      { puuid: PUUID, sortBy: "played_at; DROP TABLE matches" as never },
      1,
      25,
    )

    // Falls back to the default ordering, and the table survives.
    expect(page.rows).toHaveLength(2)
    expect(repo.countMatches(PUUID)).toBe(2)
  })

  it("lists only champions actually played, for the filter dropdown", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, championId: 84 }),
      buildMatchRow({ gameId: 2, championId: 84 }),
      buildMatchRow({ gameId: 3, championId: 22 }),
    ])

    expect(repo.getPlayedChampionIds(PUUID).sort((a, b) => a - b)).toEqual([
      22, 84,
    ])
  })

  it("places the player in the lobby and carries their assigned position", () => {
    repo.insertMany([buildMatchRow({ gameId: 1 })])
    storeLobby([9, 8, 10, 7, 6, 5, 4, 3, 2, 1])

    const [row] = repo.listMatches({ puuid: PUUID }, 1, 25).rows

    expect(row.lobbyPlace).toBe(2)
    expect(row.lobbySize).toBe(10)
    expect(row.assignedPosition).toBe("UTILITY")
  })

  it("withholds a placement while any of the ten is ungraded", () => {
    repo.insertMany([buildMatchRow({ gameId: 1 })])
    storeLobby([9, 8, 10, 7, 6, 5, 4, 3, 2, undefined])

    const [row] = repo.listMatches({ puuid: PUUID }, 1, 25).rows

    expect(row.lobbyPlace).toBeUndefined()
    expect(row.lobbySize).toBe(10)
  })
})
