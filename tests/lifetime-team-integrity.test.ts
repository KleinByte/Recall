import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { buildMatchRow } from "./fixtures/matches.js"

const PUUID = "team-integrity-puuid"

let db: InstanceType<typeof Database>
let repo: MatchesRepository

beforeEach(() => {
  db = new Database(":memory:")
  applyMigrations(db)
  repo = new MatchesRepository(db)
})

function storeParticipants(gameId: number, count: number, ownerIds: number[] = [1]) {
  const insert = db.prepare(`
    INSERT INTO match_participants
      (game_id, puuid, participant_id, team_id, is_player, champion_id, win,
       kills, deaths, assists, gold_earned, damage_to_champions, damage_taken,
       damage_self_mitigated, total_heal, time_ccing_others,
       total_minions_killed, neutral_minions, vision_score, damage_objectives)
    VALUES (?, ?, ?, ?, ?, 84, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
  `)
  for (let participantId = 1; participantId <= count; participantId += 1) {
    insert.run(
      gameId,
      PUUID,
      participantId,
      participantId <= 5 ? 100 : 200,
      ownerIds.includes(participantId) ? 1 : 0,
    )
  }
}

function storeTeams(gameId: number, ownerDragons: number) {
  const insert = db.prepare(`
    INSERT INTO match_teams
      (game_id, puuid, team_id, win, bans, baron_kills, dragon_kills,
       herald_kills, horde_kills, tower_kills, inhibitor_kills)
    VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?)
  `)
  insert.run(gameId, PUUID, 100, 1, 1, ownerDragons, 1, 3, 8, 2)
  insert.run(gameId, PUUID, 200, 0, 0, 1, 0, 0, 2, 0)
}

function storeCompleteManifest(gameId: number) {
  db.prepare(`
    INSERT INTO match_capture_manifests
      (game_id, puuid, source, match_mapper_version,
       participant_mapper_version, participant_count, team_count,
       augment_participant_count, captured_categories_json,
       missing_categories_json, unknown_field_names_json, captured_at)
    VALUES (?, ?, 'match_v5', 1, 2, 10, 2, 0, '[]', '[]', '[]', 1)
  `).run(gameId, PUUID)
}

describe("lifetime team-context integrity", () => {
  it("counts only a complete scoreboard with one owner-to-team mapping", () => {
    repo.insertMany([
      buildMatchRow({ gameId: 1, puuid: PUUID, durationSecs: 1_200 }),
      buildMatchRow({ gameId: 2, puuid: PUUID, durationSecs: 1_200 }),
      buildMatchRow({ gameId: 3, puuid: PUUID, durationSecs: 1_200 }),
      buildMatchRow({ gameId: 4, puuid: PUUID, durationSecs: 1_200 }),
    ])

    // Fully proven capture: ten players, five per side, two team rows, one owner.
    storeParticipants(1, 10)
    storeTeams(1, 4)
    storeCompleteManifest(1)

    // Manifest and team rows claim completeness, but one participant is absent.
    storeParticipants(2, 9)
    storeTeams(2, 99)
    storeCompleteManifest(2)

    // The scoreboard has ten players, but its owner mapping is ambiguous.
    storeParticipants(3, 10, [1, 2])
    storeTeams(3, 88)
    storeCompleteManifest(3)

    // Persisted shape alone is insufficient without a capture manifest.
    storeParticipants(4, 10)
    storeTeams(4, 77)

    expect(repo.getLifetimeTotals(PUUID).teamContext).toEqual({
      measuredGames: 1,
      dragons: 4,
      barons: 1,
      heralds: 1,
      voidGrubs: 3,
      turrets: 8,
      inhibitors: 2,
    })
  })
})
