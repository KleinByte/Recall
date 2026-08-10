import type { Database } from "better-sqlite3"
import type { Grade } from "../matches/grade.js"
import { GRADES } from "../matches/grade.js"
import { canonicalJson } from "./match-source-repo.js"

export const GRADE_STATUSES = [
  "ready",
  "unsupported_mode",
  "short_game",
  "invalid_duration",
  "incomplete_lobby",
  "missing_core_metric",
  "missing_source_fact",
  "terminated",
  "ineligible_for_progression",
  "unmatched",
  "bot_or_tutorial",
  "legacy_unknown",
  "calibrating",
  "position_unresolved",
] as const

export type GradeStatus = (typeof GRADE_STATUSES)[number]

export interface GradeCalibrationRegistration {
  calibrationId: string
  calibrationHash: string
  referencePopulation: unknown
  sampleCount: number
  snapshot: unknown
  createdAt?: number
}

export interface GradeRecipeRegistration {
  recipeId: string
  algorithmVersion: number
  recipeHash: string
  calibrationId?: string | null
  definition: unknown
  createdAt?: number
}

export interface StoredGradeRecipe {
  recipeId: string
  algorithmVersion: number
  recipeHash: string
  calibrationId: string | null
  definition: unknown
  createdAt: number
}

export interface CanonicalGradeResultInput {
  participantId: number
  grade: Grade
  /** Monotonic frozen-reference normal score retained for compatibility analytics. */
  gradeScore: number
  /** Authoritative frozen-reference percentile on Recall v3's 0-100 scale. */
  roleFitScore: number
  /** Lobby percentile retained only for compatibility diagnostics. */
  lobbyPercentile: number
  evidenceCoverage: number
  referenceSampleCount: number
  referenceMetadata?: unknown
  breakdown: unknown
}

export interface CanonicalGradeWriteInput {
  algorithmVersion: number
  recipeId: string
  /** SHA-256 of canonical source inputs, never of the grade outputs. */
  inputFingerprint: string
  status: GradeStatus
  statusReason?: string | null
  evidenceCoverage: number
  referenceSampleCount: number
  referenceMetadata?: unknown
  results: ReadonlyMap<number, CanonicalGradeResultInput>
  attemptedAt?: number
}

export interface CanonicalGradeAttempt {
  gameId: number
  puuid: string
  algorithmVersion: number
  recipeId: string
  ownerParticipantId: number | null
  status: GradeStatus
  inputFingerprint: string
  roleFitScore: number | null
  evidenceCoverage: number
  referenceSampleCount: number
  referenceMetadata: unknown
  statusReason: string | null
  attemptedAt: number
}

export interface DerivedGradePurgeOptions {
  algorithmVersion: number
  /** Omit to purge every recipe occupying this algorithm version. */
  recipeId?: string
  /** Omit to purge every account. */
  puuid?: string
  rebuildRunId?: number
}

export interface DerivedGradePurgeResult {
  attempts: number
  results: number
  versionedBreakdowns: number
  compatibilityBreakdowns: number
  matchCaches: number
  participantCaches: number
}

export type GradeRebuildStatus =
  "pending" | "running" | "complete" | "complete_with_errors" | "cancelled" | "error"
export type GradeRebuildStage = "preflight" | "purge" | "recompute" | "verify" | "complete"

export interface GradeRebuildRun {
  id: number
  puuid: string
  algorithmVersion: number
  recipeId: string
  status: GradeRebuildStatus
  stage: GradeRebuildStage
  totalMatches: number
  processedMatches: number
  readyMatches: number
  nonreadyMatches: number
  errorMatches: number
  lastGameId: number | null
  backupPath: string
  backupSha256: string
  lastError: string | null
  startedAt: number
  updatedAt: number
  completedAt: number | null
}

export interface GradeRebuildStateUpdate {
  status: GradeRebuildStatus
  stage: GradeRebuildStage
  processedMatches: number
  readyMatches: number
  nonreadyMatches: number
  errorMatches: number
  lastGameId?: number | null
  lastError?: string | null
}

const HASH_PATTERN = /^[a-f0-9]{64}$/
const GRADE_SET = new Set<string>(GRADES)

function assertHash(value: string, name: string) {
  if (!HASH_PATTERN.test(value)) throw new Error(`${name}_must_be_sha256`)
}

function assertIntegerAtLeast(value: number, minimum: number, name: string) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name}_invalid`)
}

function assertRange(value: number, minimum: number, maximum: number, name: string) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name}_out_of_range`)
  }
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown
}

/**
 * Owns all Recall v3 grade-derived persistence.
 *
 * Artifact primary keys are intentionally still algorithm-version keyed. This
 * repository therefore enforces the v25 invariant: purge a version's derived
 * rows before selecting a different recipe for that same version. Exact recipe
 * predicates keep legacy:vN markers out of current-recipe reads.
 */
export class GradePersistenceRepository {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  registerCalibration(input: GradeCalibrationRegistration): boolean {
    if (!input.calibrationId) throw new Error("grade_calibration_id_required")
    assertHash(input.calibrationHash, "grade_calibration_hash")
    assertIntegerAtLeast(input.sampleCount, 0, "grade_calibration_sample_count")
    const referencePopulationJson = canonicalJson(input.referencePopulation)
    const snapshotJson = canonicalJson(input.snapshot)
    const createdAt = input.createdAt ?? this.now()
    const inserted = this.db.prepare(`
      INSERT OR IGNORE INTO grade_calibration_snapshots
        (calibration_id, calibration_hash, reference_population_json,
         sample_count, snapshot_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.calibrationId, input.calibrationHash, referencePopulationJson,
      input.sampleCount, snapshotJson, createdAt).changes
    const stored = this.db.prepare(`
      SELECT calibration_hash AS calibrationHash,
             reference_population_json AS referencePopulationJson,
             sample_count AS sampleCount, snapshot_json AS snapshotJson,
             created_at AS createdAt
      FROM grade_calibration_snapshots WHERE calibration_id = ?
    `).get(input.calibrationId) as {
      calibrationHash: string
      referencePopulationJson: string
      sampleCount: number
      snapshotJson: string
      createdAt: number
    } | undefined
    if (!stored || stored.calibrationHash !== input.calibrationHash ||
        stored.referencePopulationJson !== referencePopulationJson ||
        stored.sampleCount !== input.sampleCount || stored.snapshotJson !== snapshotJson ||
        (input.createdAt !== undefined && stored.createdAt !== input.createdAt)) {
      throw new Error("grade_calibration_registration_conflict")
    }
    return inserted === 1
  }

  registerRecipe(input: GradeRecipeRegistration): boolean {
    if (!input.recipeId) throw new Error("grade_recipe_id_required")
    assertIntegerAtLeast(input.algorithmVersion, 1, "grade_algorithm_version")
    assertHash(input.recipeHash, "grade_recipe_hash")
    const definitionJson = canonicalJson(input.definition)
    const createdAt = input.createdAt ?? this.now()
    const inserted = this.db.prepare(`
      INSERT OR IGNORE INTO grade_recipes
        (recipe_id, algorithm_version, recipe_hash, calibration_id,
         definition_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.recipeId, input.algorithmVersion, input.recipeHash,
      input.calibrationId ?? null, definitionJson, createdAt).changes
    const stored = this.db.prepare(`
      SELECT algorithm_version AS algorithmVersion, recipe_hash AS recipeHash,
             calibration_id AS calibrationId, definition_json AS definitionJson,
             created_at AS createdAt
      FROM grade_recipes WHERE recipe_id = ?
    `).get(input.recipeId) as {
      algorithmVersion: number
      recipeHash: string
      calibrationId: string | null
      definitionJson: string
      createdAt: number
    } | undefined
    if (!stored || stored.algorithmVersion !== input.algorithmVersion ||
        stored.recipeHash !== input.recipeHash ||
        stored.calibrationId !== (input.calibrationId ?? null) ||
        stored.definitionJson !== definitionJson ||
        (input.createdAt !== undefined && stored.createdAt !== input.createdAt)) {
      throw new Error("grade_recipe_registration_conflict")
    }
    return inserted === 1
  }

  selectRecipe(recipeId: string): StoredGradeRecipe {
    const recipe = this.getRecipe(recipeId)
    if (!recipe) throw new Error("grade_recipe_not_registered")
    this.db.prepare(`
      INSERT INTO grade_recipe_selections (algorithm_version, recipe_id, selected_at)
      VALUES (?, ?, ?)
      ON CONFLICT(algorithm_version) DO UPDATE SET
        recipe_id = excluded.recipe_id, selected_at = excluded.selected_at
    `).run(recipe.algorithmVersion, recipe.recipeId, this.now())
    return recipe
  }

  getRecipe(recipeId: string): StoredGradeRecipe | undefined {
    const row = this.db.prepare(`
      SELECT recipe_id AS recipeId, algorithm_version AS algorithmVersion,
             recipe_hash AS recipeHash, calibration_id AS calibrationId,
             definition_json AS definitionJson, created_at AS createdAt
      FROM grade_recipes WHERE recipe_id = ?
    `).get(recipeId) as Omit<StoredGradeRecipe, "definition"> & {
      definitionJson: string
    } | undefined
    if (!row) return undefined
    const { definitionJson, ...recipe } = row
    return { ...recipe, definition: parseJson(definitionJson) }
  }

  getSelectedRecipe(algorithmVersion: number): StoredGradeRecipe | undefined {
    const row = this.db.prepare(`
      SELECT r.recipe_id AS recipeId, r.algorithm_version AS algorithmVersion,
             r.recipe_hash AS recipeHash, r.calibration_id AS calibrationId,
             r.definition_json AS definitionJson, r.created_at AS createdAt
      FROM grade_recipe_selections s
      JOIN grade_recipes r ON r.recipe_id = s.recipe_id
      WHERE s.algorithm_version = ? AND r.algorithm_version = s.algorithm_version
    `).get(algorithmVersion) as Omit<StoredGradeRecipe, "definition"> & {
      definitionJson: string
    } | undefined
    if (!row) return undefined
    const { definitionJson, ...recipe } = row
    return { ...recipe, definition: parseJson(definitionJson) }
  }

  /** Writes attempt, ten results/breakdowns, participant caches, and owner cache atomically. */
  writeCanonicalGrade(gameId: number, puuid: string, input: CanonicalGradeWriteInput): void {
    assertIntegerAtLeast(gameId, 0, "grade_game_id")
    assertIntegerAtLeast(input.algorithmVersion, 1, "grade_algorithm_version")
    assertHash(input.inputFingerprint, "grade_input_fingerprint")
    assertRange(input.evidenceCoverage, 0, 1, "grade_evidence_coverage")
    assertIntegerAtLeast(input.referenceSampleCount, 0, "grade_reference_sample_count")
    if (input.status === "ready" && input.statusReason) {
      throw new Error("ready_grade_cannot_have_status_reason")
    }
    if (input.status === "ready" ? input.results.size !== 10 : input.results.size !== 0) {
      throw new Error(input.status === "ready"
        ? "ready_grade_requires_exactly_ten_results"
        : "nonready_grade_requires_zero_results")
    }
    const selected = this.getSelectedRecipe(input.algorithmVersion)
    if (!selected || selected.recipeId !== input.recipeId) {
      throw new Error("grade_recipe_not_selected")
    }
    const participants = this.db.prepare(`
      SELECT participant_id AS participantId, is_player AS isPlayer
      FROM match_participants WHERE game_id = ? AND puuid = ?
      ORDER BY participant_id
    `).all(gameId, puuid) as { participantId: number; isPlayer: number }[]
    const ownerRows = participants.filter((participant) => participant.isPlayer === 1)
    if (input.status === "ready" && (participants.length !== 10 || ownerRows.length !== 1)) {
      throw new Error("canonical_grade_requires_complete_owned_lobby")
    }
    const ownerParticipantId = ownerRows.length === 1 ? ownerRows[0].participantId : null
    const storedIds = new Set(participants.map((participant) => participant.participantId))
    const results = [...input.results.entries()].sort(([left], [right]) => left - right)
    for (const [participantId, result] of results) {
      if (participantId !== result.participantId || !storedIds.has(participantId)) {
        throw new Error("canonical_grade_participant_mismatch")
      }
      if (!GRADE_SET.has(result.grade)) throw new Error("canonical_grade_letter_invalid")
      assertRange(result.gradeScore, -4, 4, "canonical_grade_score")
      assertRange(result.roleFitScore, 0, 100, "canonical_role_fit_score")
      assertRange(result.lobbyPercentile, 0, 1, "canonical_grade_lobby_percentile")
      assertRange(result.evidenceCoverage, 0, 1, "canonical_result_evidence_coverage")
      assertIntegerAtLeast(result.referenceSampleCount, 0,
        "canonical_result_reference_sample_count")
    }
    if (input.status === "ready" && results.length !== storedIds.size) {
      throw new Error("canonical_grade_participant_mismatch")
    }

    const attemptedAt = input.attemptedAt ?? this.now()
    const referenceMetadataJson = canonicalJson(input.referenceMetadata ?? {})
    const ownerResult = ownerParticipantId === null
      ? undefined
      : input.results.get(ownerParticipantId)
    const transaction = this.db.transaction(() => {
      // Delete explicitly instead of relying on PRAGMA foreign_keys so the
      // operation is deterministic in tests, repair tools, and production.
      this.db.prepare(`
        DELETE FROM match_grade_breakdown_versions
        WHERE game_id = ? AND puuid = ? AND algorithm_version = ?
      `).run(gameId, puuid, input.algorithmVersion)
      this.db.prepare(`
        DELETE FROM match_grade_results
        WHERE game_id = ? AND puuid = ? AND algorithm_version = ?
      `).run(gameId, puuid, input.algorithmVersion)
      this.db.prepare(`
        INSERT INTO match_grade_attempts
          (game_id, puuid, algorithm_version, owner_participant_id,
           grade_status, input_fingerprint, attempted_at, recipe_id,
           role_fit_score, evidence_coverage, reference_sample_count,
           reference_metadata_json, status_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(game_id, puuid, algorithm_version) DO UPDATE SET
          owner_participant_id = excluded.owner_participant_id,
          grade_status = excluded.grade_status,
          input_fingerprint = excluded.input_fingerprint,
          attempted_at = excluded.attempted_at,
          recipe_id = excluded.recipe_id,
          role_fit_score = excluded.role_fit_score,
          evidence_coverage = excluded.evidence_coverage,
          reference_sample_count = excluded.reference_sample_count,
          reference_metadata_json = excluded.reference_metadata_json,
          status_reason = excluded.status_reason
      `).run(gameId, puuid, input.algorithmVersion, ownerParticipantId,
        input.status, input.inputFingerprint, attemptedAt, input.recipeId,
        ownerResult?.roleFitScore ?? null, input.evidenceCoverage,
        input.referenceSampleCount, referenceMetadataJson, input.statusReason ?? null)

      const saveResult = this.db.prepare(`
        INSERT INTO match_grade_results
          (game_id, puuid, participant_id, algorithm_version, grade,
           grade_score, composite_percentile, grade_status, created_at,
           recipe_id, role_fit_score, evidence_coverage,
           reference_sample_count, reference_metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?)
      `)
      const saveBreakdown = this.db.prepare(`
        INSERT INTO match_grade_breakdown_versions
          (game_id, puuid, participant_id, algorithm_version,
           composite_percentile, components_json, created_at, recipe_id,
           role_fit_score, evidence_coverage, reference_sample_count,
           reference_metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const updateParticipant = this.db.prepare(`
        UPDATE match_participants
        SET grade = ?, grade_score = ?, grade_algorithm_version = ?,
            grade_status = 'ready', grade_composite_percentile = ?,
            grade_recipe_id = ?, role_fit_score = ?,
            grade_evidence_coverage = ?, grade_reference_sample_count = ?,
            grade_reference_metadata_json = ?
        WHERE game_id = ? AND puuid = ? AND participant_id = ?
      `)
      for (const [participantId, result] of results) {
        const resultReferenceJson = canonicalJson(result.referenceMetadata ??
          input.referenceMetadata ?? {})
        saveResult.run(gameId, puuid, participantId, input.algorithmVersion,
          result.grade, result.gradeScore, result.lobbyPercentile, attemptedAt,
          input.recipeId, result.roleFitScore, result.evidenceCoverage,
          result.referenceSampleCount, resultReferenceJson)
        saveBreakdown.run(gameId, puuid, participantId, input.algorithmVersion,
          result.lobbyPercentile, canonicalJson(result.breakdown), attemptedAt,
          input.recipeId, result.roleFitScore, result.evidenceCoverage,
          result.referenceSampleCount, resultReferenceJson)
        if (updateParticipant.run(result.grade, result.gradeScore,
          input.algorithmVersion, result.lobbyPercentile, input.recipeId,
          result.roleFitScore, result.evidenceCoverage, result.referenceSampleCount,
          resultReferenceJson, gameId, puuid, participantId).changes !== 1) {
          throw new Error("canonical_grade_participant_cache_write_failed")
        }
      }

      if (input.status !== "ready") {
        this.db.prepare(`
          UPDATE match_participants
          SET grade = NULL, grade_score = NULL, grade_algorithm_version = ?,
              grade_status = ?, grade_composite_percentile = NULL,
              grade_recipe_id = ?, role_fit_score = NULL,
              grade_evidence_coverage = ?, grade_reference_sample_count = ?,
              grade_reference_metadata_json = ?
          WHERE game_id = ? AND puuid = ?
        `).run(input.algorithmVersion, input.status, input.recipeId,
          input.evidenceCoverage, input.referenceSampleCount, referenceMetadataJson,
          gameId, puuid)
      }

      const matchCache = input.status === "ready" ? this.db.prepare(`
        UPDATE matches
        SET grade = ?, grade_score = ?, grade_algorithm_version = ?,
            grade_status = 'ready', grade_composite_percentile = ?,
            grade_recipe_id = ?, role_fit_score = ?,
            grade_evidence_coverage = ?, grade_reference_sample_count = ?,
            grade_reference_metadata_json = ?
        WHERE game_id = ? AND puuid = ?
      `).run(ownerResult!.grade, ownerResult!.gradeScore, input.algorithmVersion,
        ownerResult!.lobbyPercentile, input.recipeId, ownerResult!.roleFitScore,
        ownerResult!.evidenceCoverage, ownerResult!.referenceSampleCount,
        canonicalJson(ownerResult!.referenceMetadata ?? input.referenceMetadata ?? {}),
        gameId, puuid) : this.db.prepare(`
        UPDATE matches
        SET grade = NULL, grade_score = NULL, grade_algorithm_version = ?,
            grade_status = ?, grade_composite_percentile = NULL,
            grade_recipe_id = ?, role_fit_score = NULL,
            grade_evidence_coverage = ?, grade_reference_sample_count = ?,
            grade_reference_metadata_json = ?
        WHERE game_id = ? AND puuid = ?
      `).run(input.algorithmVersion, input.status, input.recipeId,
        input.evidenceCoverage, input.referenceSampleCount, referenceMetadataJson,
        gameId, puuid)
      if (matchCache.changes !== 1) throw new Error("canonical_grade_owner_cache_write_failed")
    })
    transaction()
  }

  getAttemptForRecipe(
    gameId: number,
    puuid: string,
    recipeId: string,
  ): CanonicalGradeAttempt | undefined {
    const row = this.db.prepare(`
      SELECT game_id AS gameId, puuid, algorithm_version AS algorithmVersion,
             recipe_id AS recipeId, owner_participant_id AS ownerParticipantId,
             grade_status AS status, input_fingerprint AS inputFingerprint,
             role_fit_score AS roleFitScore, evidence_coverage AS evidenceCoverage,
             reference_sample_count AS referenceSampleCount,
             reference_metadata_json AS referenceMetadataJson,
             status_reason AS statusReason, attempted_at AS attemptedAt
      FROM match_grade_attempts
      WHERE game_id = ? AND puuid = ? AND recipe_id = ?
    `).get(gameId, puuid, recipeId) as Omit<CanonicalGradeAttempt, "referenceMetadata"> & {
      referenceMetadataJson: string
    } | undefined
    if (!row) return undefined
    const { referenceMetadataJson, ...attempt } = row
    return { ...attempt, referenceMetadata: parseJson(referenceMetadataJson) }
  }

  getCurrentAttempt(
    gameId: number,
    puuid: string,
    algorithmVersion: number,
  ): CanonicalGradeAttempt | undefined {
    const selected = this.getSelectedRecipe(algorithmVersion)
    return selected
      ? this.getAttemptForRecipe(gameId, puuid, selected.recipeId)
      : undefined
  }

  getMatchesMissingRecipe(
    puuid: string,
    recipeId: string,
    limit: number,
  ): { gameId: number; puuid: string }[] {
    const recipe = this.getRecipe(recipeId)
    if (!recipe) throw new Error("grade_recipe_not_registered")
    assertIntegerAtLeast(limit, 1, "grade_recipe_candidate_limit")
    return this.db.prepare(`
      SELECT m.game_id AS gameId, m.puuid
      FROM matches m
      LEFT JOIN match_grade_attempts a
        ON a.game_id = m.game_id AND a.puuid = m.puuid
       AND a.algorithm_version = ? AND a.recipe_id = ?
      WHERE m.puuid = ? AND a.game_id IS NULL
      ORDER BY m.played_at, m.game_id
      LIMIT ?
    `).all(recipe.algorithmVersion, recipeId, puuid, limit) as {
      gameId: number
      puuid: string
    }[]
  }

  /** Deletes only grade-derived artifacts and clears their denormalized caches. */
  purgeDerivedGrades(options: DerivedGradePurgeOptions): DerivedGradePurgeResult {
    assertIntegerAtLeast(options.algorithmVersion, 1, "grade_algorithm_version")
    if (options.recipeId) {
      const recipe = this.getRecipe(options.recipeId)
      if (!recipe || recipe.algorithmVersion !== options.algorithmVersion) {
        throw new Error("grade_purge_recipe_version_mismatch")
      }
    }
    const artifactWhere = ["algorithm_version = ?"]
    const artifactParameters: unknown[] = [options.algorithmVersion]
    const cacheWhere = ["grade_algorithm_version = ?"]
    const cacheParameters: unknown[] = [options.algorithmVersion]
    if (options.recipeId) {
      artifactWhere.push("recipe_id = ?")
      artifactParameters.push(options.recipeId)
      cacheWhere.push("grade_recipe_id = ?")
      cacheParameters.push(options.recipeId)
    }
    if (options.puuid) {
      artifactWhere.push("puuid = ?")
      artifactParameters.push(options.puuid)
      cacheWhere.push("puuid = ?")
      cacheParameters.push(options.puuid)
    }
    const artifactPredicate = artifactWhere.join(" AND ")
    const cachePredicate = cacheWhere.join(" AND ")
    const transaction = this.db.transaction(() => {
      const versionedBreakdowns = this.db.prepare(
        `DELETE FROM match_grade_breakdown_versions WHERE ${artifactPredicate}`,
      ).run(...artifactParameters).changes
      const results = this.db.prepare(
        `DELETE FROM match_grade_results WHERE ${artifactPredicate}`,
      ).run(...artifactParameters).changes
      const attempts = this.db.prepare(
        `DELETE FROM match_grade_attempts WHERE ${artifactPredicate}`,
      ).run(...artifactParameters).changes
      const compatibilityBreakdowns = this.db.prepare(
        `DELETE FROM match_grade_breakdowns WHERE ${artifactPredicate}`,
      ).run(...artifactParameters).changes
      const matchCaches = this.db.prepare(`
        UPDATE matches
        SET grade = NULL, grade_score = NULL, grade_algorithm_version = NULL,
            grade_status = NULL, grade_composite_percentile = NULL,
            grade_recipe_id = NULL, role_fit_score = NULL,
            grade_evidence_coverage = NULL,
            grade_reference_sample_count = NULL,
            grade_reference_metadata_json = NULL
        WHERE ${cachePredicate}
      `).run(...cacheParameters).changes
      const participantCaches = this.db.prepare(`
        UPDATE match_participants
        SET grade = NULL, grade_score = NULL, grade_algorithm_version = NULL,
            grade_status = NULL, grade_composite_percentile = NULL,
            grade_recipe_id = NULL, role_fit_score = NULL,
            grade_evidence_coverage = NULL,
            grade_reference_sample_count = NULL,
            grade_reference_metadata_json = NULL
        WHERE ${cachePredicate}
      `).run(...cacheParameters).changes
      if (options.rebuildRunId !== undefined) {
        const changed = this.db.prepare(`
          UPDATE grade_rebuild_runs
          SET status = 'running', stage = 'recompute', updated_at = ?
          WHERE id = ? AND algorithm_version = ?
            AND status IN ('pending','running')
        `).run(this.now(), options.rebuildRunId, options.algorithmVersion).changes
        if (changed !== 1) throw new Error("grade_rebuild_run_not_purgeable")
      }
      return {
        attempts,
        results,
        versionedBreakdowns,
        compatibilityBreakdowns,
        matchCaches,
        participantCaches,
      }
    })
    return transaction()
  }

  createRebuildRun(input: {
    puuid: string
    recipeId: string
    totalMatches: number
    verifiedBackup: { path: string; sha256: string }
  }): number {
    const recipe = this.getRecipe(input.recipeId)
    if (!recipe) throw new Error("grade_recipe_not_registered")
    if (!input.verifiedBackup.path) throw new Error("verified_grade_rebuild_backup_required")
    assertHash(input.verifiedBackup.sha256, "grade_rebuild_backup_hash")
    assertIntegerAtLeast(input.totalMatches, 0, "grade_rebuild_total_matches")
    if (this.db.pragma("quick_check", { simple: true }) !== "ok") {
      throw new Error("grade_rebuild_quick_check_failed")
    }
    if ((this.db.pragma("foreign_key_check") as unknown[]).length) {
      throw new Error("grade_rebuild_foreign_key_check_failed")
    }
    const at = this.now()
    return Number(this.db.prepare(`
      INSERT INTO grade_rebuild_runs
        (puuid, algorithm_version, recipe_id, status, stage, total_matches,
         backup_path, backup_sha256, started_at, updated_at)
      VALUES (?, ?, ?, 'pending', 'preflight', ?, ?, ?, ?, ?)
    `).run(input.puuid, recipe.algorithmVersion, recipe.recipeId,
      input.totalMatches, input.verifiedBackup.path, input.verifiedBackup.sha256,
      at, at).lastInsertRowid)
  }

  updateRebuildRun(runId: number, update: GradeRebuildStateUpdate): GradeRebuildRun {
    assertIntegerAtLeast(runId, 1, "grade_rebuild_run_id")
    for (const [name, value] of [
      ["processed_matches", update.processedMatches],
      ["ready_matches", update.readyMatches],
      ["nonready_matches", update.nonreadyMatches],
      ["error_matches", update.errorMatches],
    ] as const) assertIntegerAtLeast(value, 0, `grade_rebuild_${name}`)
    const terminal = ["complete", "complete_with_errors", "cancelled", "error"]
      .includes(update.status)
    const at = this.now()
    const changed = this.db.prepare(`
      UPDATE grade_rebuild_runs
      SET status = ?, stage = ?, processed_matches = ?, ready_matches = ?,
          nonready_matches = ?, error_matches = ?, last_game_id = ?,
          last_error = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `).run(update.status, update.stage, update.processedMatches,
      update.readyMatches, update.nonreadyMatches, update.errorMatches,
      update.lastGameId ?? null, update.lastError ?? null, at,
      terminal ? at : null, runId).changes
    if (changed !== 1) throw new Error("grade_rebuild_run_not_found")
    return this.getRebuildRun(runId)!
  }

  getRebuildRun(runId: number): GradeRebuildRun | undefined {
    return this.db.prepare(`
      SELECT id, puuid, algorithm_version AS algorithmVersion,
             recipe_id AS recipeId, status, stage,
             total_matches AS totalMatches,
             processed_matches AS processedMatches,
             ready_matches AS readyMatches,
             nonready_matches AS nonreadyMatches,
             error_matches AS errorMatches, last_game_id AS lastGameId,
             backup_path AS backupPath, backup_sha256 AS backupSha256,
             last_error AS lastError, started_at AS startedAt,
             updated_at AS updatedAt, completed_at AS completedAt
      FROM grade_rebuild_runs WHERE id = ?
    `).get(runId) as GradeRebuildRun | undefined
  }
}
