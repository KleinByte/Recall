import { GRADE_V3_RECIPE } from "./grade-v3-recipe.js"

export type CalibrationMatchId = string | number

export interface CalibrationObservation {
  matchId: CalibrationMatchId
  value: number
  /** Relative weight inside a match cluster. Each match still totals one. */
  weight?: number
}

export interface CalibrationCohort {
  observations: readonly CalibrationObservation[]
  parent?: CalibrationCohort
}

export interface ClusterWeightedObservation extends CalibrationObservation {
  clusterWeight: number
}

export interface CalibrationOptions {
  direction?: "higher" | "lower"
  kappa?: number
  /** Optional distinct prior weight for the root cohort. */
  rootKappa?: number
  excludeMatchId?: CalibrationMatchId
}

export interface CalibrationResult {
  percentile: number
  localPercentile?: number
  parentPercentile: number
  matchClusters: number
  source: "local_shrunk" | "parent_fallback" | "neutral_fallback"
}

const [MIN_PERCENTILE, MAX_PERCENTILE] = GRADE_V3_RECIPE.calibration.percentileClamp

const matchKey = (matchId: CalibrationMatchId) => `${typeof matchId}:${String(matchId)}`
const validObservation = (entry: CalibrationObservation) =>
  Number.isFinite(entry.value) &&
  (entry.weight === undefined || (Number.isFinite(entry.weight) && entry.weight > 0))

export function clampCalibrationPercentile(value: number): number {
  return Math.max(MIN_PERCENTILE, Math.min(MAX_PERCENTILE, value))
}

/** Normalizes observations so every independent match contributes total weight one. */
export function matchClusterWeights(
  observations: readonly CalibrationObservation[],
  excludeMatchId?: CalibrationMatchId,
): ClusterWeightedObservation[] {
  const excluded = excludeMatchId === undefined ? undefined : matchKey(excludeMatchId)
  const usable = observations.filter((entry) =>
    validObservation(entry) && matchKey(entry.matchId) !== excluded)
  const totals = new Map<string, number>()
  for (const entry of usable) {
    const key = matchKey(entry.matchId)
    totals.set(key, (totals.get(key) ?? 0) + (entry.weight ?? 1))
  }
  return usable.map((entry) => ({
    ...entry,
    clusterWeight: (entry.weight ?? 1) / (totals.get(matchKey(entry.matchId)) as number),
  }))
}

function rawMidEcdf(
  value: number,
  weighted: readonly ClusterWeightedObservation[],
  direction: "higher" | "lower",
): number | undefined {
  if (!Number.isFinite(value) || weighted.length === 0) return undefined
  const signedValue = direction === "lower" ? -value : value
  let below = 0
  let tied = 0
  let total = 0
  for (const entry of weighted) {
    const signedEntry = direction === "lower" ? -entry.value : entry.value
    total += entry.clusterWeight
    if (signedEntry < signedValue) below += entry.clusterWeight
    else if (signedEntry === signedValue) tied += entry.clusterWeight
  }
  return total > 0 ? (below + .5 * tied) / total : undefined
}

export function midEcdfPercentile(
  value: number,
  observations: readonly CalibrationObservation[],
  options: Pick<CalibrationOptions, "direction" | "excludeMatchId"> = {},
): number | undefined {
  const raw = rawMidEcdf(
    value,
    matchClusterWeights(observations, options.excludeMatchId),
    options.direction ?? "higher",
  )
  return raw === undefined ? undefined : clampCalibrationPercentile(raw)
}

function calibrationAtLevel(
  value: number,
  cohort: CalibrationCohort | undefined,
  options: Required<Pick<CalibrationOptions, "direction" | "kappa" | "rootKappa">> &
    Pick<CalibrationOptions, "excludeMatchId">,
): CalibrationResult {
  if (!cohort) {
    return {
      percentile: .5,
      parentPercentile: .5,
      matchClusters: 0,
      source: "neutral_fallback",
    }
  }

  const parent = calibrationAtLevel(value, cohort.parent, options)
  const weighted = matchClusterWeights(cohort.observations, options.excludeMatchId)
  const local = rawMidEcdf(value, weighted, options.direction)
  const clusters = new Set(weighted.map((entry) => matchKey(entry.matchId))).size
  if (local === undefined || clusters === 0) {
    return {
      percentile: parent.percentile,
      parentPercentile: parent.percentile,
      matchClusters: 0,
      source: cohort.parent ? "parent_fallback" : "neutral_fallback",
    }
  }

  const kappa = cohort.parent ? options.kappa : options.rootKappa
  const shrunk = (clusters * local + kappa * parent.percentile) /
    (clusters + kappa)
  return {
    percentile: clampCalibrationPercentile(shrunk),
    localPercentile: clampCalibrationPercentile(local),
    parentPercentile: parent.percentile,
    matchClusters: clusters,
    source: "local_shrunk",
  }
}

/** Shrunk match-cluster mid-ECDF with recursive parent fallback. */
export function shrunkMidEcdf(
  value: number,
  cohort: CalibrationCohort,
  options: CalibrationOptions = {},
): CalibrationResult {
  const kappa = options.kappa ?? GRADE_V3_RECIPE.calibration.defaultKappa
  if (!Number.isFinite(kappa) || kappa < 0) throw new RangeError("kappa must be finite and non-negative")
  const rootKappa = options.rootKappa ?? kappa
  if (!Number.isFinite(rootKappa) || rootKappa < 0) {
    throw new RangeError("rootKappa must be finite and non-negative")
  }
  return calibrationAtLevel(value, cohort, {
    direction: options.direction ?? "higher",
    kappa,
    rootKappa,
    excludeMatchId: options.excludeMatchId,
  })
}

/** Excludes every observation from the subject match, not just one player row. */
export function leaveOneMatchOutPercentile(
  value: number,
  matchId: CalibrationMatchId,
  cohort: CalibrationCohort,
  options: Omit<CalibrationOptions, "excludeMatchId"> = {},
): CalibrationResult {
  return shrunkMidEcdf(value, cohort, { ...options, excludeMatchId: matchId })
}

/** Peter John Acklam's inverse-normal approximation, bounded by the recipe clamp. */
export function normalQuantile(percentile: number): number {
  const p = clampCalibrationPercentile(percentile)
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416]
  const low = .02425
  const high = 1 - low
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > high) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  const q = p - .5
  const r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}
