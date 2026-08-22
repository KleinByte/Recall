import type { Database } from "better-sqlite3"
import type { GradeBreakdown } from "../review/types.js"
import {
  MATCH_GRADE_ARM_KEYS,
  MATCH_GRADE_ARM_LABELS,
  CANONICAL_GRADE_STORAGE_PARTITION,
  gradeRecipeDefinitionId,
} from "../matches/match-grade-recipe.js"
import { getCompatibleGradeRecipeSelection } from "./grade-recipe-selection.js"

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
  updatedAt?: number
}

const TAG_COLORS = [
  "blue", "teal", "green", "amber", "orange", "red", "pink", "purple",
] as const

function normalizeTagName(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

const finiteInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum

function parseSelectedGradeBreakdown(
  value: string,
  recipeId: string,
  recallScore: number,
  recipeDefinitionId: string,
): GradeBreakdown["components"] | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
  const breakdown = parsed as Record<string, unknown>
  const storedRecallScore = breakdown.recallScore ?? breakdown.roleFitScore
  if (breakdown.algorithmVersion !== CANONICAL_GRADE_STORAGE_PARTITION ||
      breakdown.recipeDefinitionId !== recipeDefinitionId ||
      breakdown.recipeId !== recipeId ||
      !finiteInRange(storedRecallScore, 0, 100) ||
      Math.abs(storedRecallScore - recallScore) > 1e-9 ||
      !Array.isArray(breakdown.components) || breakdown.components.length === 0) {
    return undefined
  }

  const knownFamilies = new Set<string>(MATCH_GRADE_ARM_KEYS)
  const seen = new Set<string>()
  const components: GradeBreakdown["components"] = []
  for (const raw of breakdown.components) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
    const component = raw as Record<string, unknown>
    if (typeof component.key !== "string" || !knownFamilies.has(component.key) ||
        seen.has(component.key) || typeof component.label !== "string" ||
        !finiteInRange(component.componentScore, 0, 1) ||
        !finiteInRange(component.weight, 0, 1) ||
        !finiteInRange(component.contribution, 0, 1) ||
        (component.comparisonScope !== "role" && component.comparisonScope !== "lobby")) {
      return undefined
    }
    seen.add(component.key)
    components.push({
      key: component.key as GradeBreakdown["components"][number]["key"],
      label: MATCH_GRADE_ARM_LABELS[
        component.key as GradeBreakdown["components"][number]["key"]
      ],
      percentile: component.componentScore,
      weight: component.weight,
      contribution: component.contribution,
      scope: component.comparisonScope,
    })
  }
  return components
}

export class ReviewRepository {
  constructor(private readonly db: Database) {}

  getGradeBreakdown(
    gameId: number,
    puuid: string,
    participantId: number,
  ): GradeBreakdown | undefined {
    const selected = getCompatibleGradeRecipeSelection(this.db)
    if (!selected) return undefined
    const row = this.db.prepare(
      `SELECT b.recipe_id AS recipeId,
              r.role_fit_score AS recallScore,
              b.composite_percentile AS lobbyPercentile,
              b.components_json AS componentsJson
       FROM match_grade_breakdown_versions b
       JOIN match_grade_results r
         ON r.game_id = b.game_id
        AND r.puuid = b.puuid
        AND r.participant_id = b.participant_id
        AND r.algorithm_version = b.algorithm_version
        AND r.recipe_id = b.recipe_id
       JOIN match_grade_attempts a
         ON a.game_id = r.game_id
        AND a.puuid = r.puuid
        AND a.algorithm_version = r.algorithm_version
        AND a.recipe_id = r.recipe_id
       WHERE b.game_id = ? AND b.puuid = ? AND b.participant_id = ?
         AND b.algorithm_version = ?
         AND b.recipe_id = ?
         AND a.owner_participant_id = b.participant_id
         AND a.grade_status = 'ready'
         AND r.grade_status = 'ready'
         AND a.role_fit_score IS NOT NULL
         AND r.role_fit_score IS NOT NULL
         AND b.role_fit_score IS NOT NULL
         AND a.role_fit_score = r.role_fit_score
         AND b.role_fit_score = r.role_fit_score
       LIMIT 1`,
    ).get(
      gameId,
      puuid,
      participantId,
      CANONICAL_GRADE_STORAGE_PARTITION,
      selected.recipeId,
    ) as
      | { recipeId: string; recallScore: number;
          lobbyPercentile: number; componentsJson: string }
      | undefined
    if (!row) return undefined
    if (!finiteInRange(row.recallScore, 0, 100) ||
        !finiteInRange(row.lobbyPercentile, 0, 1)) return undefined
    const components = parseSelectedGradeBreakdown(
      row.componentsJson,
      row.recipeId,
      row.recallScore,
      gradeRecipeDefinitionId(selected.identity),
    )
    if (!components) return undefined
    return {
      recipeId: selected.publicRecipeId,
      recallScore: row.recallScore,
      lobbyPercentile: row.lobbyPercentile,
      compositePercentile: row.recallScore / 100,
      components,
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
    return {
      gameId,
      note: row?.note ?? "",
      bookmarked: row?.bookmarked === 1,
      tags,
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
