import type { Database } from "better-sqlite3"
import type { RecallGrade } from "../../src/shared/recall-grade.js"

interface LegacyMatchGradeFixture {
  gameId: number
  puuid: string
  grade: RecallGrade
  score: number
  compositePercentile?: number
  storagePartition?: number
}

interface LegacyParticipantGradeFixture {
  participantId: number
  grade: RecallGrade
  score: number
  compositePercentile: number
  components?: readonly unknown[]
}

/** Installs only the pre-recipe match cache needed by legacy-reader tests. */
export function storeLegacyMatchGrade(
  db: Database,
  fixture: LegacyMatchGradeFixture,
): void {
  db.prepare(`
    UPDATE matches
    SET grade = ?, grade_score = ?, grade_algorithm_version = ?,
        grade_status = 'ready', grade_composite_percentile = ?
    WHERE game_id = ? AND puuid = ?
  `).run(
    fixture.grade,
    fixture.score,
    fixture.storagePartition ?? 2,
    fixture.compositePercentile ?? 0.5,
    fixture.gameId,
    fixture.puuid,
  )
}

/**
 * Installs the old cache plus immutable/mutable breakdown rows used to prove
 * that current readers hide or regrade historical artifacts safely.
 */
export function storeLegacyParticipantGrades(
  db: Database,
  fixture: {
    gameId: number
    puuid: string
    storagePartition: number
    grades: readonly LegacyParticipantGradeFixture[]
  },
): void {
  if (fixture.grades.length === 0) return
  const owner = db.prepare(`
    SELECT participant_id AS participantId
    FROM match_participants
    WHERE game_id = ? AND puuid = ? AND is_player = 1
  `).get(fixture.gameId, fixture.puuid) as { participantId: number } | undefined
  if (!owner) throw new Error("legacy_grade_fixture_owner_missing")

  const updateCache = db.prepare(`
    UPDATE match_participants
    SET grade = ?, grade_score = ?, grade_algorithm_version = ?,
        grade_status = 'ready', grade_composite_percentile = ?
    WHERE game_id = ? AND puuid = ? AND participant_id = ?
  `)
  const insertResult = db.prepare(`
    INSERT INTO match_grade_results
      (game_id, puuid, participant_id, algorithm_version, grade, grade_score,
       composite_percentile, grade_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', 1)
  `)
  const insertVersionedBreakdown = db.prepare(`
    INSERT INTO match_grade_breakdown_versions
      (game_id, puuid, participant_id, algorithm_version,
       composite_percentile, components_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `)
  const insertLegacyBreakdown = db.prepare(`
    INSERT INTO match_grade_breakdowns
      (game_id, puuid, participant_id, algorithm_version,
       composite_percentile, components_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `)

  db.transaction(() => {
    db.prepare(`
      INSERT INTO match_grade_attempts
        (game_id, puuid, algorithm_version, owner_participant_id,
         grade_status, input_fingerprint, attempted_at)
      VALUES (?, ?, ?, ?, 'ready', ?, 1)
    `).run(
      fixture.gameId,
      fixture.puuid,
      fixture.storagePartition,
      owner.participantId,
      "0".repeat(64),
    )

    for (const grade of fixture.grades) {
      const components = JSON.stringify(grade.components ?? [])
      updateCache.run(
        grade.grade,
        grade.score,
        fixture.storagePartition,
        grade.compositePercentile,
        fixture.gameId,
        fixture.puuid,
        grade.participantId,
      )
      insertResult.run(
        fixture.gameId,
        fixture.puuid,
        grade.participantId,
        fixture.storagePartition,
        grade.grade,
        grade.score,
        grade.compositePercentile,
      )
      insertVersionedBreakdown.run(
        fixture.gameId,
        fixture.puuid,
        grade.participantId,
        fixture.storagePartition,
        grade.compositePercentile,
        components,
      )
      insertLegacyBreakdown.run(
        fixture.gameId,
        fixture.puuid,
        grade.participantId,
        fixture.storagePartition,
        grade.compositePercentile,
        components,
      )
    }
  })()
}
