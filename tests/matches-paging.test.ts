import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { MATCH_GRADE_RECIPE_DEFINITION_ID } from
  "../electron/main/matches/match-grade-recipe.js"
import { buildMatchRow, buildMatchSequence } from "./fixtures/matches.js"

const PUUID = "test-puuid"
const SELECTED_RECIPE_ID =
  `${MATCH_GRADE_RECIPE_DEFINITION_ID}@calibration:paging-test`

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
      grade, grade_score, role_fit_score, grade_algorithm_version, grade_status,
      grade_composite_percentile, assigned_position)
     VALUES (1, ?, ?, 100, ?, 84, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
             ?, ?, ?, ?, ?, ?, ?)`,
  )
  scores.forEach((score, index) => {
    const ready = score !== undefined
    insert.run(PUUID, index + 1, index === 0 ? 1 : 0,
      ready ? "B" : null,
      score ?? null,
      score ?? null,
      ready ? 2 : null,
      ready ? "ready" : null,
      ready ? .5 : null,
      index === 0 ? "UTILITY" : null)
  })
}

function storeSelectedOwnerGrades(rows: Array<{
  gameId: number
  gradeScore: number
  recallScore: number
  cachedGradeScore: number
  cachedRecallScore: number
}>) {
  db.prepare(`
    INSERT INTO grade_calibration_snapshots
      (calibration_id, calibration_hash, reference_population_json,
       sample_count, snapshot_json, created_at)
    VALUES ('paging-test', ?, '{}', 2, '{}', 1)
  `).run("a".repeat(64))
  db.prepare(`
    INSERT INTO grade_recipes
      (recipe_id, algorithm_version, recipe_hash, calibration_id,
       definition_json, created_at)
    VALUES (?, 3, ?, 'paging-test', ?, 1)
  `).run(
    SELECTED_RECIPE_ID,
    "b".repeat(64),
    JSON.stringify({ recipeDefinitionId: MATCH_GRADE_RECIPE_DEFINITION_ID }),
  )
  db.prepare(`
    INSERT INTO grade_recipe_selections (algorithm_version, recipe_id, selected_at)
    VALUES (3, ?, 1)
  `).run(SELECTED_RECIPE_ID)

  const participant = db.prepare(`
    INSERT INTO match_participants
      (game_id, puuid, participant_id, team_id, is_player, champion_id, win,
       kills, deaths, assists, gold_earned, damage_to_champions, damage_taken,
       damage_self_mitigated, total_heal, time_ccing_others,
       total_minions_killed, neutral_minions, vision_score, damage_objectives)
    VALUES (?, ?, 1, 100, 1, 84, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
  `)
  const attempt = db.prepare(`
    INSERT INTO match_grade_attempts
      (game_id, puuid, algorithm_version, owner_participant_id, grade_status,
       input_fingerprint, attempted_at, recipe_id, role_fit_score)
    VALUES (?, ?, 3, 1, 'ready', ?, 1, ?, ?)
  `)
  const result = db.prepare(`
    INSERT INTO match_grade_results
      (game_id, puuid, participant_id, algorithm_version, grade, grade_score,
       composite_percentile, grade_status, created_at, recipe_id, role_fit_score)
    VALUES (?, ?, 1, 3, 'A', ?, .8, 'ready', 1, ?, ?)
  `)
  const cache = db.prepare(`
    UPDATE matches
    SET grade = 'D', grade_score = ?, grade_algorithm_version = 3,
        grade_status = 'ready', grade_composite_percentile = .1,
        grade_recipe_id = ?, role_fit_score = ?
    WHERE game_id = ? AND puuid = ?
  `)

  for (const row of rows) {
    participant.run(row.gameId, PUUID)
    attempt.run(row.gameId, PUUID, `${row.gameId}`.repeat(64).slice(0, 64),
      SELECTED_RECIPE_ID, row.recallScore)
    result.run(row.gameId, PUUID, row.gradeScore, SELECTED_RECIPE_ID, row.recallScore)
    cache.run(row.cachedGradeScore, SELECTED_RECIPE_ID, row.cachedRecallScore,
      row.gameId, PUUID)
  }
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

  it("filters visible current grades by authoritative Recall Score", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1 }),
      buildMatchRow({ gameId: 2 }),
    ])
    db.prepare(
      "UPDATE matches SET role_fit_score = CASE game_id WHEN 1 THEN 82 ELSE 55 END WHERE puuid = ?",
    ).run(PUUID)

    const page = repo.listMatches({ puuid: PUUID, minRecallScore: 81.59 }, 1, 25)

    expect(page.rows.map((row) => row.gameId)).toEqual([1])
  })

  it("filters and sorts by the selected result when match caches disagree", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, playedAt: 1_000 }),
      buildMatchRow({ gameId: 2, playedAt: 2_000 }),
      buildMatchRow({ gameId: 3, playedAt: 3_000 }),
    ])
    storeSelectedOwnerGrades([
      {
        gameId: 1,
        gradeScore: 2,
        recallScore: 90,
        cachedGradeScore: -4,
        cachedRecallScore: 5,
      },
      {
        gameId: 2,
        gradeScore: -2,
        recallScore: 20,
        cachedGradeScore: 4,
        cachedRecallScore: 95,
      },
    ])
    // Simulate an interrupted rebuild: this cache looks excellent, but there
    // is no immutable selected-recipe result behind it.
    db.prepare(`
      UPDATE matches
      SET grade = 'S+', grade_score = 4, grade_algorithm_version = 3,
          grade_status = 'ready', grade_composite_percentile = 1,
          grade_recipe_id = ?, role_fit_score = 100
      WHERE game_id = 3 AND puuid = ?
    `).run(SELECTED_RECIPE_ID, PUUID)

    expect(repo.listMatches({ puuid: PUUID, minGradeScore: 1 }, 1, 25).rows
      .map((row) => row.gameId)).toEqual([1])
    expect(repo.listMatches({ puuid: PUUID, minRecallScore: 80 }, 1, 25).rows
      .map((row) => row.gameId)).toEqual([1])
    expect(repo.listMatches({ puuid: PUUID, sortBy: "grade", sortDir: "desc" }, 1, 25)
      .rows.map((row) => row.gameId)).toEqual([1, 2, 3])

    expect(repo.getSummary({ puuid: PUUID, minRecallScore: 80 })).toMatchObject({
      games: 1,
      gradedGames: 1,
      avgGradeScore: 2,
      averageRecallScore: 90,
    })
    expect(repo.getGradeDistribution({ puuid: PUUID, minRecallScore: 80 }))
      .toEqual([{ grade: "A", count: 1 }])
  })

  it("reports an authoritative average Recall Score alongside the compatibility score", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1 }),
      buildMatchRow({ gameId: 2 }),
    ])
    repo.setGrade(1, PUUID, "A", 1)
    repo.setGrade(2, PUUID, "B", 0)
    db.prepare(
      `UPDATE matches
       SET role_fit_score = CASE game_id WHEN 1 THEN 80 ELSE 60 END
       WHERE puuid = ?`,
    ).run(PUUID)

    const summary = repo.getSummary({ puuid: PUUID })

    expect(summary.avgGradeScore).toBeCloseTo(.5)
    expect(summary.averageRecallScore).toBeCloseTo(70)
  })

  it("counts only rows with an authoritative Recall Score as graded", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1 }),
      buildMatchRow({ gameId: 2 }),
    ])
    repo.setGrade(1, PUUID, "A", 1)
    repo.setGrade(2, PUUID, "B", -2)
    db.prepare("UPDATE matches SET role_fit_score = 80 WHERE game_id = 1 AND puuid = ?")
      .run(PUUID)

    const summary = repo.getSummary({ puuid: PUUID })

    expect(summary.gradedGames).toBe(1)
    expect(summary.avgGradeScore).toBe(1)
    expect(summary.averageRecallScore).toBe(80)
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
