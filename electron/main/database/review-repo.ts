import type { Database } from "better-sqlite3"
import type { MatchRow, TrackedMode } from "../matches/types.js"
import type { GradeBreakdown } from "../review/types.js"
import { confidenceForGames } from "../review/types.js"

export type ExperimentStatus = "active" | "paused" | "completed"
export type ExperimentOutcome = "worked" | "mixed" | "did_not_work" | "unrated"

export interface AnnotationTag {
  id: number
  name: string
  color: string
}

export interface MatchAnnotation {
  gameId: number
  note: string
  bookmarked: boolean
  tags: AnnotationTag[]
  experimentOutcomes: {
    experimentId: number
    experimentName: string
    outcome: ExperimentOutcome
    note: string
  }[]
  updatedAt?: number
}

export interface PracticeExperiment {
  id: number
  name: string
  hypothesis: string
  championIds: number[]
  modes: TrackedMode[]
  status: ExperimentStatus
  startedAt: number
  endedAt?: number
  games: number
  summary?: {
    winRate: number
    avgGrade?: number
    kda: number
    confidence: ReturnType<typeof confidenceForGames>
    baselineGames: number
    baselineWinRate: number
    baselineAvgGrade?: number
    baselineKda: number
    baselineConfidence: ReturnType<typeof confidenceForGames>
  }
}

export interface ExperimentInput {
  name: string
  hypothesis: string
  championIds: number[]
  modes: TrackedMode[]
  status?: ExperimentStatus
}

const TAG_COLORS = [
  "blue", "teal", "green", "amber", "orange", "red", "pink", "purple",
] as const

function normalizeTagName(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function parseIds(value: string): number[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is number => Number.isInteger(entry))
      : []
  } catch {
    return []
  }
}

function parseModes(value: string): TrackedMode[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is TrackedMode => typeof entry === "string")
      : []
  } catch {
    return []
  }
}

export class ReviewRepository {
  constructor(private readonly db: Database) {}

  getGradeBreakdown(
    gameId: number,
    puuid: string,
    participantId: number,
  ): GradeBreakdown | undefined {
    const row = this.db.prepare(
      `SELECT algorithm_version AS algorithmVersion,
              composite_percentile AS compositePercentile,
              components_json AS componentsJson
       FROM match_grade_breakdowns
       WHERE game_id = ? AND puuid = ? AND participant_id = ?
       ORDER BY algorithm_version DESC LIMIT 1`,
    ).get(gameId, puuid, participantId) as
      | { algorithmVersion: number; compositePercentile: number; componentsJson: string }
      | undefined
    if (!row) return undefined
    try {
      return {
        algorithmVersion: row.algorithmVersion,
        compositePercentile: row.compositePercentile,
        components: JSON.parse(row.componentsJson),
      }
    } catch {
      return undefined
    }
  }

  getAnnotation(gameId: number, puuid: string): MatchAnnotation {
    const row = this.db.prepare(
      `SELECT note, bookmarked, updated_at AS updatedAt
       FROM match_annotations WHERE game_id = ? AND puuid = ?`,
    ).get(gameId, puuid) as
      | { note: string; bookmarked: number; updatedAt: number }
      | undefined
    const tags = this.db.prepare(
      `SELECT t.id, t.name, t.color
       FROM annotation_tags t
       JOIN match_annotation_tags mt ON mt.tag_id = t.id
       WHERE mt.game_id = ? AND mt.puuid = ?
       ORDER BY t.name COLLATE NOCASE`,
    ).all(gameId, puuid) as AnnotationTag[]
    const outcomes = this.db.prepare(
      `SELECT e.id AS experimentId, e.name AS experimentName,
              me.outcome, me.outcome_note AS note
       FROM match_experiments me
       JOIN practice_experiments e ON e.id = me.experiment_id
       WHERE me.game_id = ? AND me.puuid = ?
       ORDER BY e.started_at, e.id`,
    ).all(gameId, puuid) as MatchAnnotation["experimentOutcomes"]
    return {
      gameId,
      note: row?.note ?? "",
      bookmarked: row?.bookmarked === 1,
      tags,
      experimentOutcomes: outcomes,
      updatedAt: row?.updatedAt,
    }
  }

  saveAnnotation(
    gameId: number,
    puuid: string,
    input: { note: string; bookmarked: boolean; tagIds: number[] },
  ): MatchAnnotation {
    const now = Date.now()
    const save = this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO match_annotations
         (game_id, puuid, note, bookmarked, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_id, puuid) DO UPDATE SET
           note = excluded.note,
           bookmarked = excluded.bookmarked,
           updated_at = excluded.updated_at`,
      ).run(gameId, puuid, input.note, Number(input.bookmarked), now, now)
      this.db.prepare(
        "DELETE FROM match_annotation_tags WHERE game_id = ? AND puuid = ?",
      ).run(gameId, puuid)
      const attach = this.db.prepare(
        `INSERT INTO match_annotation_tags (game_id, puuid, tag_id)
         SELECT ?, ?, id FROM annotation_tags WHERE id = ? AND puuid = ?`,
      )
      for (const tagId of [...new Set(input.tagIds)].slice(0, 20)) {
        attach.run(gameId, puuid, tagId, puuid)
      }
    })
    save()
    return this.getAnnotation(gameId, puuid)
  }

  listTags(puuid: string): AnnotationTag[] {
    return this.db.prepare(
      "SELECT id, name, color FROM annotation_tags WHERE puuid = ? ORDER BY name COLLATE NOCASE",
    ).all(puuid) as AnnotationTag[]
  }

  createTag(puuid: string, rawName: string, color?: string): AnnotationTag {
    const name = normalizeTagName(rawName)
    const normalized = name.toLocaleLowerCase()
    const selected = TAG_COLORS.includes(color as typeof TAG_COLORS[number])
      ? color!
      : TAG_COLORS[this.listTags(puuid).length % TAG_COLORS.length]
    this.db.prepare(
      `INSERT INTO annotation_tags
       (puuid, name, normalized_name, color, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(puuid, normalized_name) DO NOTHING`,
    ).run(puuid, name, normalized, selected, Date.now())
    return this.db.prepare(
      `SELECT id, name, color FROM annotation_tags
       WHERE puuid = ? AND normalized_name = ?`,
    ).get(puuid, normalized) as AnnotationTag
  }

  deleteTag(id: number, puuid: string): boolean {
    return this.db.prepare(
      "DELETE FROM annotation_tags WHERE id = ? AND puuid = ?",
    ).run(id, puuid).changes > 0
  }

  listExperiments(puuid: string): PracticeExperiment[] {
    const rows = this.db.prepare(
      `SELECT e.id, e.name, e.hypothesis, e.champion_ids AS championIds,
              e.modes, e.status, e.started_at AS startedAt,
              e.ended_at AS endedAt,
              COUNT(CASE WHEN counted.is_matched = 1 THEN me.game_id END) AS games
       FROM practice_experiments e
       LEFT JOIN match_experiments me ON me.experiment_id = e.id
       LEFT JOIN matches counted
         ON counted.game_id = me.game_id AND counted.puuid = me.puuid
       WHERE e.puuid = ?
       GROUP BY e.id
       ORDER BY CASE e.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
                e.started_at DESC`,
    ).all(puuid) as Array<Omit<PracticeExperiment, "championIds" | "modes"> & {
      championIds: string
      modes: string
    }>
    return rows.map((row) => {
      const championIds = parseIds(row.championIds)
      const modes = parseModes(row.modes)
      const attached = this.db.prepare(
        `SELECT m.win, m.kills, m.deaths, m.assists, m.grade_score AS gradeScore
         FROM match_experiments me
         JOIN matches m ON m.game_id = me.game_id AND m.puuid = me.puuid
         WHERE me.experiment_id = ? AND me.puuid = ? AND m.is_matched = 1
         ORDER BY m.played_at DESC`,
      ).all(row.id, puuid) as Array<{
        win: number
        kills: number
        deaths: number
        assists: number
        gradeScore: number | null
      }>
      const conditions = ["puuid = ?", "is_matched = 1", "played_at < ?"]
      const params: Array<string | number> = [puuid, row.startedAt]
      if (championIds.length) {
        conditions.push(`champion_id IN (${championIds.map(() => "?").join(", ")})`)
        params.push(...championIds)
      }
      if (modes.length) {
        conditions.push(`mode IN (${modes.map(() => "?").join(", ")})`)
        params.push(...modes)
      }
      const baseline = this.db.prepare(
        `SELECT win, kills, deaths, assists, grade_score AS gradeScore
         FROM matches WHERE ${conditions.join(" AND ")}
         ORDER BY played_at DESC LIMIT 20`,
      ).all(...params) as Array<{
        win: number
        kills: number
        deaths: number
        assists: number
        gradeScore: number | null
      }>
      const graded = attached.filter((match) => match.gradeScore !== null)
      const baselineGraded = baseline.filter((match) => match.gradeScore !== null)
      const kills = attached.reduce((sum, match) => sum + match.kills, 0)
      const deaths = attached.reduce((sum, match) => sum + match.deaths, 0)
      const assists = attached.reduce((sum, match) => sum + match.assists, 0)
      const baselineKills = baseline.reduce((sum, match) => sum + match.kills, 0)
      const baselineDeaths = baseline.reduce((sum, match) => sum + match.deaths, 0)
      const baselineAssists = baseline.reduce((sum, match) => sum + match.assists, 0)
      return {
        ...row,
        endedAt: row.endedAt ?? undefined,
        championIds,
        modes,
        summary: attached.length ? {
          winRate: attached.reduce((sum, match) => sum + match.win, 0) / attached.length,
          avgGrade: graded.length
            ? graded.reduce((sum, match) => sum + (match.gradeScore ?? 0), 0) / graded.length
            : undefined,
          kda: deaths ? (kills + assists) / deaths : kills + assists,
          confidence: confidenceForGames(attached.length),
          baselineGames: baseline.length,
          baselineWinRate: baseline.length
            ? baseline.reduce((sum, match) => sum + match.win, 0) / baseline.length
            : 0,
          baselineAvgGrade: baselineGraded.length
            ? baselineGraded.reduce(
              (sum, match) => sum + (match.gradeScore ?? 0),
              0,
            ) / baselineGraded.length
            : undefined,
          baselineKda: baselineDeaths
            ? (baselineKills + baselineAssists) / baselineDeaths
            : baselineKills + baselineAssists,
          baselineConfidence: confidenceForGames(baseline.length),
        } : undefined,
      }
    })
  }

  createExperiment(puuid: string, input: ExperimentInput): PracticeExperiment {
    const now = Date.now()
    const result = this.db.prepare(
      `INSERT INTO practice_experiments
       (puuid, name, hypothesis, champion_ids, modes, status,
        started_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      puuid,
      input.name,
      input.hypothesis,
      JSON.stringify([...new Set(input.championIds)]),
      JSON.stringify([...new Set(input.modes)]),
      input.status ?? "active",
      now,
      now,
      now,
    )
    return this.listExperiments(puuid).find(
      (experiment) => experiment.id === Number(result.lastInsertRowid),
    )!
  }

  updateExperiment(
    id: number,
    puuid: string,
    input: ExperimentInput,
  ): PracticeExperiment | undefined {
    const status = input.status ?? "active"
    this.db.prepare(
      `UPDATE practice_experiments SET
         name = ?, hypothesis = ?, champion_ids = ?, modes = ?, status = ?,
         ended_at = CASE WHEN ? = 'completed' THEN COALESCE(ended_at, ?) ELSE NULL END,
         updated_at = ?
       WHERE id = ? AND puuid = ?`,
    ).run(
      input.name,
      input.hypothesis,
      JSON.stringify([...new Set(input.championIds)]),
      JSON.stringify([...new Set(input.modes)]),
      status,
      status,
      Date.now(),
      Date.now(),
      id,
      puuid,
    )
    return this.listExperiments(puuid).find((experiment) => experiment.id === id)
  }

  attachMatchingExperiments(match: MatchRow): number {
    if (match.isMatched !== 1) return 0

    const experiments = this.listExperiments(match.puuid).filter((experiment) =>
      experiment.status === "active" &&
      match.playedAt >= experiment.startedAt &&
      (experiment.championIds.length === 0 || experiment.championIds.includes(match.championId)) &&
      (experiment.modes.length === 0 || experiment.modes.includes(match.mode)),
    )
    const attach = this.db.prepare(
      `INSERT OR IGNORE INTO match_experiments
       (game_id, puuid, experiment_id, outcome, outcome_note, attached_at)
       VALUES (?, ?, ?, 'unrated', '', ?)`,
    )
    return experiments.reduce(
      (count, experiment) =>
        count + attach.run(match.gameId, match.puuid, experiment.id, Date.now()).changes,
      0,
    )
  }

  setExperimentOutcome(
    gameId: number,
    puuid: string,
    experimentId: number,
    outcome: ExperimentOutcome,
    note: string,
  ): boolean {
    return this.db.prepare(
      `UPDATE match_experiments SET outcome = ?, outcome_note = ?
       WHERE game_id = ? AND puuid = ? AND experiment_id = ?`,
    ).run(outcome, note, gameId, puuid, experimentId).changes > 0
  }

  getBoundaryOverrides(puuid: string): Map<number, "split" | "join"> {
    const rows = this.db.prepare(
      `SELECT game_id AS gameId, action
       FROM session_boundary_overrides WHERE puuid = ?`,
    ).all(puuid) as { gameId: number; action: "split" | "join" }[]
    return new Map(rows.map((row) => [row.gameId, row.action]))
  }

  setBoundaryOverride(
    gameId: number,
    puuid: string,
    action: "split" | "join" | null,
  ) {
    if (action === null) {
      this.db.prepare(
        "DELETE FROM session_boundary_overrides WHERE game_id = ? AND puuid = ?",
      ).run(gameId, puuid)
      return
    }
    this.db.prepare(
      `INSERT INTO session_boundary_overrides
       (game_id, puuid, action, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(game_id, puuid) DO UPDATE SET
         action = excluded.action, updated_at = excluded.updated_at`,
    ).run(gameId, puuid, action, Date.now())
  }
}
