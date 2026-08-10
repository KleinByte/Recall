import type { Database } from "better-sqlite3"
import type {
  Evidence,
  EvidenceState,
} from "../../../src/shared/measurement.js"
import {
  validateMatchMetricObservation,
  type MatchMetricObservation,
  type MetricComparisonScope,
  type MetricSourceQuality,
  type MetricSource,
} from "../matches/match-metric-observations.js"
import { canonicalJson } from "./match-source-repo.js"

export interface RviRecipeRegistration {
  recipeId: string
  algorithmVersion: number
  recipeHash: string
  gradeRecipeId: string
  calibrationId: string
  definition: unknown
  createdAt?: number
}

export interface StoredRviRecipe {
  recipeId: string
  algorithmVersion: number
  recipeHash: string
  gradeRecipeId: string
  calibrationId: string
  definition: unknown
  createdAt: number
}

export interface MatchMetricObservationSet {
  gameId: number
  puuid: string
  algorithmVersion: number
  recipeId: string
  observations: readonly MatchMetricObservation[]
}

export interface StoredMatchMetricObservation extends MatchMetricObservation {
  algorithmVersion: number
}

export interface OwnerMetricObservation extends StoredMatchMetricObservation {
  playedAt: number
}

export interface MetricObservationPurgeOptions {
  algorithmVersion: number
  recipeId?: string
  puuid?: string
}

interface ObservationRow {
  gameId: number
  puuid: string
  participantId: number
  algorithmVersion: number
  recipeId: string
  calibrationId: string
  metricKey: string
  rawEvidenceState: EvidenceState
  rawEvidenceReason: string | null
  rawValue: number | null
  scoreEvidenceState: EvidenceState
  scoreEvidenceReason: string | null
  scoreValue: number | null
  numerator: number | null
  denominator: number | null
  opportunityCount: number | null
  unit: string
  comparisonScope: MetricComparisonScope | null
  referenceMatchCount: number | null
  source: MetricSource
  sourceQuality: MetricSourceQuality
  derivationId: string
  derivedAt: number
}

interface OwnerObservationRow extends ObservationRow {
  playedAt: number
}

const HASH_PATTERN = /^[a-f0-9]{64}$/

function assertNonempty(value: string, name: string) {
  if (!value.trim()) throw new Error(`${name}_required`)
}

function assertIntegerAtLeast(value: number, minimum: number, name: string) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name}_invalid`)
}

function assertOptionalFinite(value: number | undefined, name: string) {
  if (value !== undefined && !Number.isFinite(value)) throw new Error(`${name}_invalid`)
}

function assertEvidence(evidence: Evidence<number>, name: string, score = false) {
  if (evidence.state !== "observed") return
  if (!Number.isFinite(evidence.value)) throw new Error(`${name}_invalid`)
  if (score && (evidence.value < 0 || evidence.value > 1)) {
    throw new Error(`${name}_out_of_range`)
  }
}

function evidenceFromRow(
  state: EvidenceState,
  value: number | null,
  reason: string | null,
): Evidence<number> {
  if (state === "observed") return { state, value: value as number }
  return reason === null ? { state } : { state, reason }
}

function mapObservation(row: ObservationRow): StoredMatchMetricObservation {
  return {
    gameId: row.gameId,
    puuid: row.puuid,
    participantId: row.participantId,
    algorithmVersion: row.algorithmVersion,
    recipeId: row.recipeId,
    calibrationId: row.calibrationId,
    metricKey: row.metricKey,
    rawEvidence: evidenceFromRow(
      row.rawEvidenceState,
      row.rawValue,
      row.rawEvidenceReason,
    ),
    scoreEvidence: evidenceFromRow(
      row.scoreEvidenceState,
      row.scoreValue,
      row.scoreEvidenceReason,
    ),
    unit: row.unit,
    ...(row.numerator === null ? {} : { numerator: row.numerator }),
    ...(row.denominator === null ? {} : { denominator: row.denominator }),
    ...(row.opportunityCount === null
      ? {}
      : { opportunityCount: row.opportunityCount }),
    ...(row.comparisonScope === null
      ? {}
      : { comparisonScope: row.comparisonScope }),
    ...(row.referenceMatchCount === null
      ? {}
      : { referenceMatchCount: row.referenceMatchCount }),
    source: row.source,
    sourceQuality: row.sourceQuality,
    derivationId: row.derivationId,
    derivedAt: row.derivedAt,
  }
}

const OBSERVATION_SELECT = `
  observation.game_id AS gameId,
  observation.puuid,
  observation.participant_id AS participantId,
  observation.algorithm_version AS algorithmVersion,
  observation.recipe_id AS recipeId,
  observation.calibration_id AS calibrationId,
  observation.metric_key AS metricKey,
  observation.raw_evidence_state AS rawEvidenceState,
  observation.raw_evidence_reason AS rawEvidenceReason,
  observation.raw_value AS rawValue,
  observation.score_evidence_state AS scoreEvidenceState,
  observation.score_evidence_reason AS scoreEvidenceReason,
  observation.score_value AS scoreValue,
  observation.numerator,
  observation.denominator,
  observation.opportunity_count AS opportunityCount,
  observation.unit,
  observation.comparison_scope AS comparisonScope,
  observation.reference_match_count AS referenceMatchCount,
  observation.source,
  observation.source_quality AS sourceQuality,
  observation.derivation_id AS derivationId,
  observation.derived_at AS derivedAt
`

/**
 * Persists the exact metric evidence shared by match Grade and RVI.
 *
 * RVI recipe selection follows the same purge-before-switch invariant as the
 * match Grade repository. Reads always take an explicit recipe identity; callers
 * that want the current product view first resolve `getSelectedRecipe()`.
 */
export class MetricObservationsRepository {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  registerRecipe(input: RviRecipeRegistration): boolean {
    assertNonempty(input.recipeId, "rvi_recipe_id")
    assertIntegerAtLeast(input.algorithmVersion, 1, "rvi_algorithm_version")
    if (!HASH_PATTERN.test(input.recipeHash)) throw new Error("rvi_recipe_hash_must_be_sha256")
    assertNonempty(input.gradeRecipeId, "rvi_grade_recipe_id")
    assertNonempty(input.calibrationId, "rvi_calibration_id")
    const definitionJson = canonicalJson(input.definition)
    const createdAt = input.createdAt ?? this.now()
    assertIntegerAtLeast(createdAt, 0, "rvi_recipe_created_at")

    const inserted = this.db.prepare(`
      INSERT OR IGNORE INTO rvi_recipes
        (recipe_id, algorithm_version, recipe_hash, grade_recipe_id,
         calibration_id, definition_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.recipeId,
      input.algorithmVersion,
      input.recipeHash,
      input.gradeRecipeId,
      input.calibrationId,
      definitionJson,
      createdAt,
    ).changes
    const stored = this.db.prepare(`
      SELECT algorithm_version AS algorithmVersion, recipe_hash AS recipeHash,
             grade_recipe_id AS gradeRecipeId, calibration_id AS calibrationId,
             definition_json AS definitionJson, created_at AS createdAt
      FROM rvi_recipes WHERE recipe_id = ?
    `).get(input.recipeId) as {
      algorithmVersion: number
      recipeHash: string
      gradeRecipeId: string
      calibrationId: string
      definitionJson: string
      createdAt: number
    } | undefined
    if (!stored || stored.algorithmVersion !== input.algorithmVersion ||
        stored.recipeHash !== input.recipeHash ||
        stored.gradeRecipeId !== input.gradeRecipeId ||
        stored.calibrationId !== input.calibrationId ||
        stored.definitionJson !== definitionJson ||
        (input.createdAt !== undefined && stored.createdAt !== input.createdAt)) {
      throw new Error("rvi_recipe_registration_conflict")
    }
    return inserted === 1
  }

  getRecipe(recipeId: string): StoredRviRecipe | undefined {
    const row = this.db.prepare(`
      SELECT recipe_id AS recipeId, algorithm_version AS algorithmVersion,
             recipe_hash AS recipeHash, grade_recipe_id AS gradeRecipeId,
             calibration_id AS calibrationId,
             definition_json AS definitionJson, created_at AS createdAt
      FROM rvi_recipes WHERE recipe_id = ?
    `).get(recipeId) as Omit<StoredRviRecipe, "definition"> & {
      definitionJson: string
    } | undefined
    if (!row) return undefined
    const { definitionJson, ...recipe } = row
    return { ...recipe, definition: JSON.parse(definitionJson) as unknown }
  }

  getSelectedRecipe(algorithmVersion: number): StoredRviRecipe | undefined {
    assertIntegerAtLeast(algorithmVersion, 1, "rvi_algorithm_version")
    const row = this.db.prepare(`
      SELECT recipe.recipe_id AS recipeId,
             recipe.algorithm_version AS algorithmVersion,
             recipe.recipe_hash AS recipeHash,
             recipe.grade_recipe_id AS gradeRecipeId,
             recipe.calibration_id AS calibrationId,
             recipe.definition_json AS definitionJson,
             recipe.created_at AS createdAt
      FROM rvi_recipe_selections selection
      JOIN rvi_recipes recipe
        ON recipe.algorithm_version = selection.algorithm_version
       AND recipe.recipe_id = selection.recipe_id
      WHERE selection.algorithm_version = ?
    `).get(algorithmVersion) as Omit<StoredRviRecipe, "definition"> & {
      definitionJson: string
    } | undefined
    if (!row) return undefined
    const { definitionJson, ...recipe } = row
    return { ...recipe, definition: JSON.parse(definitionJson) as unknown }
  }

  selectRecipe(recipeId: string): StoredRviRecipe {
    const recipe = this.getRecipe(recipeId)
    if (!recipe) throw new Error("rvi_recipe_not_registered")
    this.db.prepare(`
      INSERT INTO rvi_recipe_selections
        (algorithm_version, recipe_id, selected_at)
      VALUES (?, ?, ?)
      ON CONFLICT(algorithm_version) DO UPDATE SET
        recipe_id = excluded.recipe_id,
        selected_at = excluded.selected_at
    `).run(recipe.algorithmVersion, recipe.recipeId, this.now())
    return recipe
  }

  replaceMatchObservations(input: MatchMetricObservationSet): number {
    this.validateObservationSet(input)
    return this.db.transaction(() => this.replaceSet(input))()
  }

  replaceManyMatches(inputs: readonly MatchMetricObservationSet[]): number {
    const identities = new Set<string>()
    for (const input of inputs) {
      this.validateObservationSet(input)
      const identity = [
        input.gameId,
        input.puuid,
        input.algorithmVersion,
        input.recipeId,
      ].join("\u0000")
      if (identities.has(identity)) throw new Error("metric_observation_set_duplicate")
      identities.add(identity)
    }
    return this.db.transaction(() => inputs.reduce(
      (total, input) => total + this.replaceSet(input),
      0,
    ))()
  }

  getMatchObservations(
    gameId: number,
    puuid: string,
    participantId: number,
    algorithmVersion: number,
    recipeId: string,
  ): StoredMatchMetricObservation[] {
    return (this.db.prepare(`
      SELECT ${OBSERVATION_SELECT}
      FROM match_metric_observations observation
      WHERE observation.game_id = ? AND observation.puuid = ?
        AND observation.participant_id = ?
        AND observation.algorithm_version = ? AND observation.recipe_id = ?
      ORDER BY observation.metric_key
    `).all(gameId, puuid, participantId, algorithmVersion, recipeId) as ObservationRow[])
      .map(mapObservation)
  }

  getOwnerMatchObservations(
    gameId: number,
    puuid: string,
    algorithmVersion: number,
    recipeId: string,
  ): StoredMatchMetricObservation[] {
    return (this.db.prepare(`
      SELECT ${OBSERVATION_SELECT}
      FROM match_metric_observations observation
      JOIN match_participants participant
        ON participant.game_id = observation.game_id
       AND participant.puuid = observation.puuid
       AND participant.participant_id = observation.participant_id
       AND participant.is_player = 1
      WHERE observation.game_id = ? AND observation.puuid = ?
        AND observation.algorithm_version = ? AND observation.recipe_id = ?
      ORDER BY observation.metric_key
    `).all(gameId, puuid, algorithmVersion, recipeId) as ObservationRow[])
      .map(mapObservation)
  }

  getOwnerHistory(
    puuid: string,
    algorithmVersion: number,
    recipeId: string,
  ): OwnerMetricObservation[] {
    return (this.db.prepare(`
      SELECT ${OBSERVATION_SELECT}, match.played_at AS playedAt
      FROM match_metric_observations observation
      JOIN match_participants participant
        ON participant.game_id = observation.game_id
       AND participant.puuid = observation.puuid
       AND participant.participant_id = observation.participant_id
       AND participant.is_player = 1
      JOIN matches match
        ON match.game_id = observation.game_id AND match.puuid = observation.puuid
      WHERE observation.puuid = ? AND observation.algorithm_version = ?
        AND observation.recipe_id = ?
      ORDER BY match.played_at, observation.game_id, observation.metric_key
    `).all(puuid, algorithmVersion, recipeId) as OwnerObservationRow[])
      .map((row) => ({ ...mapObservation(row), playedAt: row.playedAt }))
  }

  purgeObservations(options: MetricObservationPurgeOptions): number {
    assertIntegerAtLeast(options.algorithmVersion, 1, "rvi_algorithm_version")
    const clauses = ["algorithm_version = ?"]
    const parameters: Array<string | number> = [options.algorithmVersion]
    if (options.recipeId !== undefined) {
      clauses.push("recipe_id = ?")
      parameters.push(options.recipeId)
    }
    if (options.puuid !== undefined) {
      clauses.push("puuid = ?")
      parameters.push(options.puuid)
    }
    return this.db.prepare(`
      DELETE FROM match_metric_observations WHERE ${clauses.join(" AND ")}
    `).run(...parameters).changes
  }

  private validateObservationSet(input: MatchMetricObservationSet) {
    assertIntegerAtLeast(input.gameId, 1, "metric_observation_game_id")
    assertNonempty(input.puuid, "metric_observation_puuid")
    assertIntegerAtLeast(input.algorithmVersion, 1, "rvi_algorithm_version")
    assertNonempty(input.recipeId, "rvi_recipe_id")
    const selected = this.getSelectedRecipe(input.algorithmVersion)
    if (!selected || selected.recipeId !== input.recipeId) {
      throw new Error("rvi_recipe_not_selected")
    }
    const storedParticipantIds = input.observations.length === 0
      ? undefined
      : new Set((this.db.prepare(`
          SELECT participant_id AS participantId
          FROM match_participants WHERE game_id = ? AND puuid = ?
        `).all(input.gameId, input.puuid) as { participantId: number }[])
        .map((row) => row.participantId))
    const identities = new Set<string>()
    for (const observation of input.observations) {
      validateMatchMetricObservation(observation)
      if (observation.gameId !== input.gameId || observation.puuid !== input.puuid ||
          observation.recipeId !== input.recipeId) {
        throw new Error("metric_observation_set_identity_mismatch")
      }
      if (observation.calibrationId !== selected.calibrationId) {
        throw new Error("metric_observation_calibration_mismatch")
      }
      assertIntegerAtLeast(observation.participantId, 1,
        "metric_observation_participant_id")
      if (!storedParticipantIds?.has(observation.participantId)) {
        throw new Error("metric_observation_participant_mismatch")
      }
      assertNonempty(observation.metricKey, "metric_observation_metric_key")
      assertNonempty(observation.unit, "metric_observation_unit")
      assertNonempty(observation.derivationId, "metric_observation_derivation_id")
      assertIntegerAtLeast(observation.derivedAt, 0, "metric_observation_derived_at")
      assertEvidence(observation.rawEvidence, "metric_observation_raw_evidence")
      assertEvidence(observation.scoreEvidence, "metric_observation_score_evidence", true)
      if (observation.scoreEvidence.state === "observed" &&
          observation.rawEvidence.state !== "observed") {
        throw new Error("metric_observation_score_requires_raw_evidence")
      }
      assertOptionalFinite(observation.numerator, "metric_observation_numerator")
      assertOptionalFinite(observation.denominator, "metric_observation_denominator")
      if (observation.opportunityCount !== undefined) {
        assertIntegerAtLeast(observation.opportunityCount, 0,
          "metric_observation_opportunity_count")
      }
      if (observation.referenceMatchCount !== undefined) {
        assertIntegerAtLeast(observation.referenceMatchCount, 0,
          "metric_observation_reference_match_count")
      }
      const identity = `${observation.participantId}\u0000${observation.metricKey}`
      if (identities.has(identity)) throw new Error("metric_observation_duplicate")
      identities.add(identity)
    }
  }

  private replaceSet(input: MatchMetricObservationSet): number {
    this.db.prepare(`
      DELETE FROM match_metric_observations
      WHERE game_id = ? AND puuid = ? AND algorithm_version = ? AND recipe_id = ?
    `).run(input.gameId, input.puuid, input.algorithmVersion, input.recipeId)
    const insert = this.db.prepare(`
      INSERT INTO match_metric_observations
        (game_id, puuid, participant_id, algorithm_version, recipe_id,
         calibration_id, metric_key, raw_evidence_state, raw_evidence_reason,
         raw_value, score_evidence_state, score_evidence_reason, score_value,
         numerator, denominator, opportunity_count, unit, comparison_scope,
         reference_match_count, source, source_quality, derivation_id, derived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const observation of input.observations) {
      insert.run(
        observation.gameId,
        observation.puuid,
        observation.participantId,
        input.algorithmVersion,
        observation.recipeId,
        observation.calibrationId,
        observation.metricKey,
        observation.rawEvidence.state,
        observation.rawEvidence.reason ?? null,
        observation.rawEvidence.state === "observed"
          ? observation.rawEvidence.value
          : null,
        observation.scoreEvidence.state,
        observation.scoreEvidence.reason ?? null,
        observation.scoreEvidence.state === "observed"
          ? observation.scoreEvidence.value
          : null,
        observation.numerator ?? null,
        observation.denominator ?? null,
        observation.opportunityCount ?? null,
        observation.unit,
        observation.comparisonScope ?? null,
        observation.referenceMatchCount ?? null,
        observation.source,
        observation.sourceQuality,
        observation.derivationId,
        observation.derivedAt,
      )
    }
    return input.observations.length
  }
}
