import type { Evidence, EvidenceState } from "../../../src/shared/measurement.js"
import { observed, unavailable } from "../../../src/shared/measurement.js"
import {
  shrunkMidEcdf,
  type CalibrationCohort,
  type CalibrationMatchId,
  type CalibrationObservation,
} from "./grade-v3-calibration.js"

export type MetricDirectionV3 = "higher" | "lower"
export type MetricSourceV3 = "scoreboard" | "extended" | "timeline" | "derived"
export type MetricSourceQualityV3 = "verified" | "retained" | "derived" | "legacy"
export type MetricComparisonScopeV3 = "mode" | "position" | "archetype"
export type MetricResponsibilityTierV3 = "CORE" | "SECONDARY" | "DIAGNOSTIC" | "N/A"

/**
 * Formula output before calibration. Numerator and denominator are retained so
 * a displayed rate or share can be audited without reverse engineering it.
 */
export interface RawMetricObservationV3<TMetricKey extends string = string> {
  metricKey: TMetricKey
  rawEvidence: Evidence<number>
  unit: string
  numerator?: number
  denominator?: number
  opportunityCount?: number
  source: MetricSourceV3
  sourceQuality: MetricSourceQualityV3
}

/**
 * Durable observation shared by Grade and RVI. Raw evidence is deliberately
 * separate from score evidence: a raw value can be known even when the frozen
 * reference cannot produce a calibrated percentile.
 */
export interface MatchMetricObservationV3<TMetricKey extends string = string>
  extends RawMetricObservationV3<TMetricKey> {
  gameId: number
  puuid: string
  participantId: number
  recipeId: string
  calibrationId: string
  /** Observed values are stored in the native 0..1 percentile range. */
  scoreEvidence: Evidence<number>
  comparisonScope?: MetricComparisonScopeV3
  referenceMatchCount?: number
  derivationId: string
  derivedAt: number
}

export interface MatchMetricObservationIdentityV3 {
  gameId: number
  puuid: string
  participantId: number
  recipeId: string
  calibrationId: string
  derivationId: string
  derivedAt: number
}

const isNonEmpty = (value: string) => value.trim().length > 0
const isFiniteNumber = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value)

function assertEvidenceNumber(
  evidence: Evidence<number>,
  label: string,
  score = false,
): void {
  if (evidence.state !== "observed") return
  if (!Number.isFinite(evidence.value)) {
    throw new RangeError(`${label} observed value must be finite`)
  }
  if (score && (evidence.value < 0 || evidence.value > 1)) {
    throw new RangeError(`${label} observed value must be between 0 and 1`)
  }
}

/** Throws when an observation could not be safely persisted or aggregated. */
export function validateMatchMetricObservationV3(
  observation: MatchMetricObservationV3,
): void {
  if (!Number.isSafeInteger(observation.gameId) || observation.gameId <= 0) {
    throw new RangeError("gameId must be a positive safe integer")
  }
  if (!Number.isSafeInteger(observation.participantId) || observation.participantId <= 0) {
    throw new RangeError("participantId must be a positive safe integer")
  }
  for (const [label, value] of [
    ["puuid", observation.puuid],
    ["metricKey", observation.metricKey],
    ["recipeId", observation.recipeId],
    ["calibrationId", observation.calibrationId],
    ["unit", observation.unit],
    ["derivationId", observation.derivationId],
  ] as const) {
    if (!isNonEmpty(value)) throw new TypeError(`${label} cannot be empty`)
  }
  if (!Number.isSafeInteger(observation.derivedAt) || observation.derivedAt < 0) {
    throw new RangeError("derivedAt must be a non-negative safe integer")
  }
  assertEvidenceNumber(observation.rawEvidence, "rawEvidence")
  assertEvidenceNumber(observation.scoreEvidence, "scoreEvidence", true)
  if (isFiniteNumber(observation.denominator) && observation.denominator < 0) {
    throw new RangeError("denominator cannot be negative")
  }
  if (observation.denominator !== undefined && !isFiniteNumber(observation.denominator)) {
    throw new RangeError("denominator must be finite")
  }
  if (observation.numerator !== undefined && !isFiniteNumber(observation.numerator)) {
    throw new RangeError("numerator must be finite")
  }
  if (observation.opportunityCount !== undefined &&
      (!Number.isSafeInteger(observation.opportunityCount) || observation.opportunityCount < 0)) {
    throw new RangeError("opportunityCount must be a non-negative safe integer")
  }
  if (observation.referenceMatchCount !== undefined &&
      (!Number.isSafeInteger(observation.referenceMatchCount) ||
       observation.referenceMatchCount < 0)) {
    throw new RangeError("referenceMatchCount must be a non-negative safe integer")
  }
}

/**
 * Attaches immutable match and recipe identity to a raw formula result. The
 * caller supplies calibrated score evidence; no fallback score is invented.
 */
export function toMatchMetricObservationV3<TMetricKey extends string>(
  raw: RawMetricObservationV3<TMetricKey>,
  identity: MatchMetricObservationIdentityV3,
  scoreEvidence: Evidence<number> = unavailable("metric_not_calibrated", {
    source: "derived",
  }),
  calibration: {
    comparisonScope?: MetricComparisonScopeV3
    referenceMatchCount?: number
  } = {},
): MatchMetricObservationV3<TMetricKey> {
  const observation: MatchMetricObservationV3<TMetricKey> = {
    ...raw,
    ...identity,
    scoreEvidence,
    ...calibration,
  }
  validateMatchMetricObservationV3(observation)
  return observation
}

/** Storage boundaries may still contain the retired `missing` state. */
export function normalizeStoredEvidenceV3(
  evidence: Evidence<number> | { state: "missing"; reason?: string },
): Evidence<number> {
  return evidence.state === "missing"
    ? unavailable(evidence.reason ?? "legacy_missing_evidence", { source: "legacy" })
    : evidence
}

export function evidenceStateForObservationV3(
  observation: MatchMetricObservationV3,
): EvidenceState {
  return observation.scoreEvidence.state === "observed"
    ? observation.rawEvidence.state
    : observation.scoreEvidence.state
}

export interface DetailMetricCalibrationMatchV3 {
  matchId: CalibrationMatchId
  /** Frozen tracked-mode and rules-epoch identity. */
  scopeKey: string
  position?: string
  archetype?: string
  observations: readonly RawMetricObservationV3[]
  /** Optional per-row weight; a complete match still totals one cluster. */
  weight?: number
}

export interface DetailMetricCalibrationRowV3 extends CalibrationObservation {
  metricKey: string
  scopeKey: string
  position?: string
  archetype?: string
}

export interface DetailMetricCalibrationTargetV3 {
  matchId: CalibrationMatchId
  scopeKey: string
  position?: string
  archetype?: string
}

export interface DetailMetricCalibrationResultV3 {
  scoreEvidence: Evidence<number>
  comparisonScope?: MetricComparisonScopeV3
  referenceMatchCount?: number
}

export interface DetailMetricCalibrationOptionsV3 {
  direction?: MetricDirectionV3
  kappa?: number
  minimumReferenceMatches?: number
}

const calibrationMatchKey = (matchId: CalibrationMatchId) =>
  `${typeof matchId}:${String(matchId)}`

const normalizedCohortKey = (value: string | undefined) => value?.trim().toUpperCase()

/**
 * Flattens arbitrary registered raw observations into snapshot-ready rows.
 * Unobserved and non-finite values are deliberately excluded from an ECDF;
 * they remain on their match observation and are never converted to zero.
 */
export function collectDetailMetricCalibrationRowsV3(
  matches: readonly DetailMetricCalibrationMatchV3[],
): DetailMetricCalibrationRowV3[] {
  const rows: DetailMetricCalibrationRowV3[] = []
  for (const match of matches) {
    if (!match.scopeKey.trim()) throw new TypeError("scopeKey cannot be empty")
    if (match.weight !== undefined && (!Number.isFinite(match.weight) || match.weight <= 0)) {
      throw new RangeError("calibration row weight must be finite and positive")
    }
    const metricKeys = new Set<string>()
    for (const entry of match.observations) {
      if (metricKeys.has(entry.metricKey)) {
        throw new Error(`duplicate_detail_metric_in_match:${entry.metricKey}`)
      }
      metricKeys.add(entry.metricKey)
      if (entry.rawEvidence.state !== "observed" ||
          !Number.isFinite(entry.rawEvidence.value)) continue
      rows.push({
        metricKey: entry.metricKey,
        matchId: match.matchId,
        scopeKey: match.scopeKey,
        ...(match.position ? { position: normalizedCohortKey(match.position) } : {}),
        ...(match.archetype ? { archetype: normalizedCohortKey(match.archetype) } : {}),
        value: entry.rawEvidence.value,
        ...(match.weight === undefined ? {} : { weight: match.weight }),
      })
    }
  }
  return rows.sort((left, right) =>
    left.metricKey.localeCompare(right.metricKey) ||
    left.scopeKey.localeCompare(right.scopeKey) ||
    calibrationMatchKey(left.matchId).localeCompare(calibrationMatchKey(right.matchId)))
}

function independentMatches(
  observations: readonly CalibrationObservation[],
  excludeMatchId: CalibrationMatchId,
): number {
  const excluded = calibrationMatchKey(excludeMatchId)
  return new Set(observations
    .filter((entry) => calibrationMatchKey(entry.matchId) !== excluded)
    .map((entry) => calibrationMatchKey(entry.matchId))).size
}

/** Builds archetype -> position -> mode hierarchy without champion-local cells. */
export function detailMetricCalibrationCohortV3(
  metricKey: string,
  target: DetailMetricCalibrationTargetV3,
  rows: readonly DetailMetricCalibrationRowV3[],
): {
  cohort?: CalibrationCohort
  comparisonScope?: MetricComparisonScopeV3
  referenceMatchCount: number
  rootReferenceMatchCount: number
} {
  const eligible = rows.filter((entry) =>
    entry.metricKey === metricKey && entry.scopeKey === target.scopeKey)
  const root: CalibrationCohort = { observations: eligible }
  const rootCount = independentMatches(eligible, target.matchId)
  const targetPosition = normalizedCohortKey(target.position)
  const targetArchetype = normalizedCohortKey(target.archetype)
  if (!targetPosition) {
    return {
      cohort: root,
      comparisonScope: rootCount > 0 ? "mode" : undefined,
      referenceMatchCount: rootCount,
      rootReferenceMatchCount: rootCount,
    }
  }
  const positionRows = eligible.filter((entry) => entry.position === targetPosition)
  const position: CalibrationCohort = { observations: positionRows, parent: root }
  const positionCount = independentMatches(positionRows, target.matchId)
  if (!targetArchetype) {
    return {
      cohort: position,
      comparisonScope: positionCount > 0 ? "position" : rootCount > 0 ? "mode" : undefined,
      referenceMatchCount: positionCount > 0 ? positionCount : rootCount,
      rootReferenceMatchCount: rootCount,
    }
  }
  const archetypeRows = positionRows.filter((entry) => entry.archetype === targetArchetype)
  const archetype: CalibrationCohort = { observations: archetypeRows, parent: position }
  const archetypeCount = independentMatches(archetypeRows, target.matchId)
  return {
    cohort: archetype,
    comparisonScope: archetypeCount > 0
      ? "archetype"
      : positionCount > 0 ? "position" : rootCount > 0 ? "mode" : undefined,
    referenceMatchCount: archetypeCount > 0
      ? archetypeCount
      : positionCount > 0 ? positionCount : rootCount,
    rootReferenceMatchCount: rootCount,
  }
}

/**
 * Calibrates one arbitrary raw detail metric against a frozen set of rows.
 * The subject match is excluded as a whole cluster. A small/missing root
 * reference withholds only score evidence and preserves the raw observation.
 */
export function calibrateRawDetailMetricV3(
  raw: RawMetricObservationV3,
  target: DetailMetricCalibrationTargetV3,
  rows: readonly DetailMetricCalibrationRowV3[],
  options: DetailMetricCalibrationOptionsV3 = {},
): DetailMetricCalibrationResultV3 {
  if (raw.rawEvidence.state !== "observed") {
    return { scoreEvidence: raw.rawEvidence }
  }
  if (!Number.isFinite(raw.rawEvidence.value)) {
    return { scoreEvidence: unavailable("raw_metric_not_finite", { source: "derived" }) }
  }
  const minimum = options.minimumReferenceMatches ?? 10
  if (!Number.isSafeInteger(minimum) || minimum < 1) {
    throw new RangeError("minimumReferenceMatches must be a positive integer")
  }
  const hierarchy = detailMetricCalibrationCohortV3(raw.metricKey, target, rows)
  if (!hierarchy.cohort || hierarchy.rootReferenceMatchCount < minimum) {
    return {
      scoreEvidence: unavailable("reference_population_too_small", { source: "derived" }),
      ...(hierarchy.comparisonScope ? { comparisonScope: hierarchy.comparisonScope } : {}),
      referenceMatchCount: hierarchy.referenceMatchCount,
    }
  }
  const calibrated = shrunkMidEcdf(raw.rawEvidence.value, hierarchy.cohort, {
    direction: options.direction ?? "higher",
    ...(options.kappa === undefined ? {} : { kappa: options.kappa }),
    excludeMatchId: target.matchId,
  })
  return {
    scoreEvidence: observed(calibrated.percentile, {
      source: "derived",
      reason: calibrated.source,
    }),
    comparisonScope: hierarchy.comparisonScope,
    referenceMatchCount: hierarchy.referenceMatchCount,
  }
}
