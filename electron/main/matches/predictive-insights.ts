/**
 * Leakage-safe predictive signals for pregame conditions.
 *
 * Uses only information available before a match starts to predict
 * strong-game outcomes via ridge logistic regression with temporal validation.
 */

import type { InsightObservation } from "../database/insights-repo.js"
import { quantile, sessionize } from "./analytics.js"

// --- Public types ---

export interface PregameRow {
  playedAt: number
  gradeScore: number
  features: Record<string, number>
  raw: {
    priorChampionGames: number
    sessionGame: number
    previousWin?: boolean
    restMinutes?: number
  }
}

export interface RidgeResult {
  weights: number[]
  intercept: number
  converged: boolean
  iterations: number
}

export interface PredictiveSignal {
  feature: string
  direction: "positive" | "negative"
  marginalEffect: number
}

export interface PredictiveSection {
  state: "insufficient" | "no-signal" | "ready" | "error"
  message?: string
  neededGames?: number
  observedGames?: number
  window?: { label: string; trainingGames?: number; holdoutGames?: number }
  signals?: PredictiveSignal[]
}

export interface SplitResult {
  training: PregameRow[]
  holdout: PregameRow[]
  threshold: number
  trainingThreshold: number
  scalerSource: "training"
}

// --- Constants ---

const MIN_GRADED = 200
const MIN_EACH_CLASS = 40
const MIN_HOLDOUT_EACH_CLASS = 2
const HOLDOUT_FRACTION = 0.2
const LAMBDA_CANDIDATES = [0.1, 1, 10]
const N_FOLDS = 5
const MAX_ITER = 2000
const LEARNING_RATE = 0.05
const CONVERGENCE_TOL = 1e-8
const CONVERGENCE_PATIENCE = 10
const MAX_SIGNALS = 3
const MIN_FOLD_SIGN_STABILITY = 4
const MIN_LOGLOSS_IMPROVEMENT = 0.02
const REST_CAP_MINUTES = 90

// Reference categories (excluded from one-hot encoding)
const WEEKDAY_REFERENCE = "sunday"
const ROLE_REFERENCE = "UTILITY"
const QUEUE_REFERENCE = 420

// Fixed vocabulary
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
const KNOWN_ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM"]
const KNOWN_QUEUE_IDS = [400, 430, 440, 450, 480, 490]

// --- Feature extraction ---

export function buildPregameRows(observations: InsightObservation[]): PregameRow[] {
  if (observations.length === 0) return []

  // Sort chronologically with gameId as deterministic tiebreaker
  const sorted = [...observations].sort(
    (a, b) => a.playedAt - b.playedAt || a.gameId - b.gameId,
  )

  // Sessionize for session context
  const sessionized = sorted.every((obs) =>
    Number.isSafeInteger(obs.session) && Number.isSafeInteger(obs.sessionGame))
    ? sorted.map((obs) => ({
        gameId: obs.gameId,
        startedAt: obs.playedAt,
        durationSecs: obs.durationSecs,
        observation: obs,
        session: obs.session!,
        sessionGame: obs.sessionGame!,
        restMinutes: obs.restMinutes,
      }))
    : sessionize(sorted.map((obs) => ({
        gameId: obs.gameId,
        startedAt: obs.playedAt,
        durationSecs: obs.durationSecs,
        observation: obs,
      })))

  // Track champion game counts strictly before each row
  const championCounts = new Map<number, number>()

  const rows: PregameRow[] = []

  for (let i = 0; i < sessionized.length; i++) {
    const entry = sessionized[i]
    const obs = entry.observation
    const inferredPriorChampionGames = championCounts.get(obs.championId) ?? 0
    const priorChampionGames = obs.priorChampionGames ?? inferredPriorChampionGames
    if (obs.recallScore === undefined) {
      championCounts.set(obs.championId, inferredPriorChampionGames + 1)
      continue
    }

    // Session context
    const sessionGame = entry.sessionGame
    let previousWin: boolean | undefined = obs.previousWin
    let restMinutes: number | undefined = obs.restMinutes

    if (sessionGame > 1 && i > 0) {
      const prev = sessionized[i - 1]
      if (prev.session === entry.session) {
        previousWin ??= prev.observation.win
        restMinutes ??= entry.restMinutes
      }
    }

    // Build fixed feature vector
    const features: Record<string, number> = {}

    // Hour sine/cosine
    const hour = new Date(obs.playedAt).getHours()
    features["hour_cos"] = Math.cos((2 * Math.PI * hour) / 24)
    features["hour_sin"] = Math.sin((2 * Math.PI * hour) / 24)

    // Weekday one-hot (reference: sunday)
    const dayIndex = new Date(obs.playedAt).getDay()
    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
    for (const day of WEEKDAYS) {
      features[`weekday_${day}`] = dayNames[dayIndex] === day ? 1 : 0
    }

    // Session game indicators (2, 3, 4+)
    features["session_game_2"] = sessionGame === 2 ? 1 : 0
    features["session_game_3"] = sessionGame === 3 ? 1 : 0
    features["session_game_4plus"] = sessionGame >= 4 ? 1 : 0

    // Rest: capped log rest + new session indicator
    const cappedRest = restMinutes !== undefined ? Math.min(restMinutes, REST_CAP_MINUTES) : 0
    features["log_rest_minutes"] = restMinutes !== undefined ? Math.log1p(cappedRest) : 0
    features["new_session"] = sessionGame === 1 ? 1 : 0

    // Previous win + missing indicator
    features["previous_win"] = previousWin === true ? 1 : 0
    features["previous_missing"] = previousWin === undefined ? 1 : 0

    // Role one-hot (reference: UTILITY) with unknown bucket
    const role = obs.role
    const isKnownRole = role !== undefined && (KNOWN_ROLES.includes(role) || role === "UTILITY")
    for (const r of KNOWN_ROLES) {
      features[`role_${r}`] = role === r ? 1 : 0
    }
    features["role_unknown"] = isKnownRole ? 0 : 1

    // Queue-ID one-hot (reference: 420) with unknown bucket
    const queueId = obs.queueId
    const isKnownQueue = queueId === QUEUE_REFERENCE || KNOWN_QUEUE_IDS.includes(queueId)
    for (const qid of KNOWN_QUEUE_IDS) {
      features[`queue_${qid}`] = queueId === qid ? 1 : 0
    }
    features["queue_unknown"] = isKnownQueue ? 0 : 1

    // Log prior champion games
    features["log_prior_champion_games"] = Math.log1p(priorChampionGames)

    // Random champion mode indicator
    features["random_champion_mode"] = obs.mode === "aram" || obs.mode === "mayhem" ? 1 : 0

    // Sort feature keys for stability
    const sortedFeatures: Record<string, number> = {}
    for (const key of Object.keys(features).sort()) {
      sortedFeatures[key] = features[key]
    }

    rows.push({
      playedAt: obs.playedAt,
      // Keep the legacy field name in this internal modeling row for API
      // compatibility; the value is the authoritative 0-100 Recall Score.
      gradeScore: obs.recallScore,
      features: sortedFeatures,
      raw: { priorChampionGames, sessionGame, previousWin, restMinutes },
    })

    // Update champion count AFTER creating the row
    championCounts.set(obs.championId, inferredPriorChampionGames + 1)
  }

  return rows
}

// --- Temporal split ---

export function splitPredictiveHistory(observations: InsightObservation[]): SplitResult {
  const rows = buildPregameRows(observations)
  // Already sorted chronologically by buildPregameRows
  const holdoutCount = Math.floor(rows.length * HOLDOUT_FRACTION)
  const trainingCount = rows.length - holdoutCount

  const training = rows.slice(0, trainingCount)
  const holdout = rows.slice(trainingCount)

  // Compute threshold on training data only
  const trainingScores = training.map((r) => r.gradeScore)
  const threshold = quantile(trainingScores, 0.75) ?? 0

  return {
    training,
    holdout,
    threshold,
    trainingThreshold: threshold,
    scalerSource: "training",
  }
}

// --- Ridge logistic regression ---

function sigmoid(z: number): number {
  // Numerically stable sigmoid with clamping
  if (z > 500) return 1
  if (z < -500) return 0
  return 1 / (1 + Math.exp(-z))
}

function logLoss(y: number[], preds: number[]): number {
  const eps = 1e-15
  let sum = 0
  for (let i = 0; i < y.length; i++) {
    const p = Math.max(eps, Math.min(1 - eps, preds[i]))
    sum -= y[i] * Math.log(p) + (1 - y[i]) * Math.log(1 - p)
  }
  return sum / y.length
}

function brierScore(y: number[], preds: number[]): number {
  let sum = 0
  for (let i = 0; i < y.length; i++) {
    sum += (preds[i] - y[i]) ** 2
  }
  return sum / y.length
}

export class PredictiveModelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PredictiveModelError"
  }
}

export function fitRidgeLogistic(
  X: number[][],
  y: number[],
  lambda: number,
): RidgeResult {
  const n = X.length
  if (n === 0) throw new PredictiveModelError("Empty training set")
  const d = X[0].length

  // Validate inputs
  for (let i = 0; i < n; i++) {
    if (X[i].length !== d) throw new PredictiveModelError("Inconsistent feature dimensions")
    for (let j = 0; j < d; j++) {
      if (!isFinite(X[i][j])) throw new PredictiveModelError("Non-finite feature value")
    }
    if (!isFinite(y[i]) || (y[i] !== 0 && y[i] !== 1)) {
      throw new PredictiveModelError("Labels must be 0 or 1")
    }
  }

  const weights = new Array(d).fill(0)
  let intercept = 0

  let prevLoss = Infinity
  let stableCount = 0
  let converged = false
  let iterations = 0

  for (let iter = 0; iter < MAX_ITER; iter++) {
    iterations = iter + 1

    // Compute predictions
    const preds: number[] = []
    for (let i = 0; i < n; i++) {
      let z = intercept
      for (let j = 0; j < d; j++) {
        z += weights[j] * X[i][j]
      }
      preds.push(sigmoid(z))
    }

    // Compute gradients
    const gradW = new Array(d).fill(0)
    let gradB = 0

    for (let i = 0; i < n; i++) {
      const error = preds[i] - y[i]
      gradB += error
      for (let j = 0; j < d; j++) {
        gradW[j] += error * X[i][j]
      }
    }

    // Average gradients and add L2 penalty (not on intercept)
    gradB /= n
    for (let j = 0; j < d; j++) {
      gradW[j] = gradW[j] / n + lambda * weights[j]
    }

    // Update
    intercept -= LEARNING_RATE * gradB
    for (let j = 0; j < d; j++) {
      weights[j] -= LEARNING_RATE * gradW[j]
    }

    // Check convergence
    const currentLoss = logLoss(y, preds)
    if (!isFinite(currentLoss)) {
      throw new PredictiveModelError("Non-finite loss during optimization")
    }

    if (Math.abs(prevLoss - currentLoss) < CONVERGENCE_TOL) {
      stableCount++
      if (stableCount >= CONVERGENCE_PATIENCE) {
        converged = true
        break
      }
    } else {
      stableCount = 0
    }
    prevLoss = currentLoss
  }

  // Final finiteness check
  if (!isFinite(intercept) || weights.some((w) => !isFinite(w))) {
    throw new PredictiveModelError("Non-finite weights after optimization")
  }

  return { weights, intercept, converged, iterations }
}

// --- Validation pipeline ---

interface StandardizationParams {
  means: number[]
  stds: number[]
}

function standardize(X: number[][], params?: StandardizationParams): { X: number[][]; params: StandardizationParams } {
  const n = X.length
  const d = X[0]?.length ?? 0
  const means = params?.means ?? new Array(d).fill(0)
  const stds = params?.stds ?? new Array(d).fill(1)

  if (!params) {
    // Compute from data
    for (let j = 0; j < d; j++) {
      let sum = 0
      for (let i = 0; i < n; i++) sum += X[i][j]
      means[j] = sum / n

      let sumSq = 0
      for (let i = 0; i < n; i++) sumSq += (X[i][j] - means[j]) ** 2
      stds[j] = Math.sqrt(sumSq / n) || 1 // avoid divide by zero
    }
  }

  const Xs: number[][] = []
  for (let i = 0; i < n; i++) {
    const row: number[] = []
    for (let j = 0; j < d; j++) {
      row.push((X[i][j] - means[j]) / stds[j])
    }
    Xs.push(row)
  }

  return { X: Xs, params: { means, stds } }
}

function rowsToMatrix(rows: PregameRow[]): { X: number[][]; featureNames: string[] } {
  if (rows.length === 0) return { X: [], featureNames: [] }
  const featureNames = Object.keys(rows[0].features)
  const X = rows.map((r) => featureNames.map((f) => r.features[f] ?? 0))
  return { X, featureNames }
}

function predict(X: number[][], model: RidgeResult): number[] {
  return X.map((row) => {
    let z = model.intercept
    for (let j = 0; j < row.length; j++) {
      z += model.weights[j] * row[j]
    }
    return sigmoid(z)
  })
}

function interceptOnlyLogLoss(y: number[], baselineP: number): number {
  const eps = 1e-15
  const pClamped = Math.max(eps, Math.min(1 - eps, baselineP))
  let sum = 0
  for (const yi of y) {
    sum -= yi * Math.log(pClamped) + (1 - yi) * Math.log(1 - pClamped)
  }
  return sum / y.length
}

function interceptOnlyBrier(y: number[], baselineP: number): number {
  let sum = 0
  for (const yi of y) {
    sum += (baselineP - yi) ** 2
  }
  return sum / y.length
}

export function validatePredictiveSignals(
  training: PregameRow[],
  holdout: PregameRow[],
  threshold: number,
): { valid: boolean; signals: PredictiveSignal[]; logLossImprovement: number; brierOk: boolean } | null {
  const { X: trainX, featureNames } = rowsToMatrix(training)
  const { X: holdX } = rowsToMatrix(holdout)

  if (trainX.length === 0 || holdX.length === 0 || featureNames.length === 0) return null

  const trainY = training.map((r) => (r.gradeScore >= threshold ? 1 : 0) as number)
  const holdY = holdout.map((r) => (r.gradeScore >= threshold ? 1 : 0) as number)

  // Baseline probability fitted from training labels only
  const trainingPrevalence = trainY.reduce((s, v) => s + v, 0) / trainY.length

  // Check holdout class requirements
  const holdStrong = holdY.filter((y) => y === 1).length
  const holdWeak = holdY.filter((y) => y === 0).length
  if (holdStrong < MIN_HOLDOUT_EACH_CLASS || holdWeak < MIN_HOLDOUT_EACH_CLASS) return null

  // Standardize final model using training data only
  const { X: trainXs, params: scaleParams } = standardize(trainX)
  const { X: holdXs } = standardize(holdX, scaleParams)

  // Forward-chaining cross-validation for lambda selection
  const foldSize = Math.floor(trainX.length / (N_FOLDS + 1))
  if (foldSize < 10) return null

  // Track coefficient signs per fold for stability check
  const foldSigns: number[][] = [] // [fold][feature] = sign

  let bestLambda = LAMBDA_CANDIDATES[0]
  let bestFoldLoss = Infinity

  for (const lambda of LAMBDA_CANDIDATES) {
    let totalLoss = 0
    const currentFoldSigns: number[][] = []

    for (let fold = 0; fold < N_FOLDS; fold++) {
      const trainEnd = foldSize * (fold + 1)
      const valStart = trainEnd
      const valEnd = Math.min(valStart + foldSize, trainX.length)

      if (valEnd <= valStart) continue

      // Fit scaler on this fold's training partition only
      const foldTrainRaw = trainX.slice(0, trainEnd)
      const foldValRaw = trainX.slice(valStart, valEnd)
      const { X: foldTrainX, params: foldScaleParams } = standardize(foldTrainRaw)
      const { X: foldValX } = standardize(foldValRaw, foldScaleParams)

      const foldTrainY = trainY.slice(0, trainEnd)
      const foldValY = trainY.slice(valStart, valEnd)

      try {
        const model = fitRidgeLogistic(foldTrainX, foldTrainY, lambda)
        const preds = predict(foldValX, model)
        totalLoss += logLoss(foldValY, preds)
        currentFoldSigns.push(model.weights.map((w) => Math.sign(w)))
      } catch {
        totalLoss += 10 // Penalize failed folds
        currentFoldSigns.push(new Array(featureNames.length).fill(0))
      }
    }

    const meanLoss = totalLoss / N_FOLDS
    if (meanLoss < bestFoldLoss) {
      bestFoldLoss = meanLoss
      bestLambda = lambda
      foldSigns.length = 0
      foldSigns.push(...currentFoldSigns)
    }
  }

  // Train final model on full training set with best lambda
  let finalModel: RidgeResult
  try {
    finalModel = fitRidgeLogistic(trainXs, trainY, bestLambda)
  } catch {
    return null
  }

  // Evaluate on holdout using training-derived baseline
  const holdPreds = predict(holdXs, finalModel)
  const modelLogLoss = logLoss(holdY, holdPreds)
  const baselineLogLoss = interceptOnlyLogLoss(holdY, trainingPrevalence)
  const logLossImprovement = (baselineLogLoss - modelLogLoss) / baselineLogLoss

  const modelBrier = brierScore(holdY, holdPreds)
  const baselineBrier = interceptOnlyBrier(holdY, trainingPrevalence)
  const brierOk = modelBrier <= baselineBrier

  // Check gates
  if (logLossImprovement < MIN_LOGLOSS_IMPROVEMENT || !brierOk) {
    return { valid: false, signals: [], logLossImprovement, brierOk }
  }

  // Determine sign-stable features
  const stableFeatures: Array<{ index: number; sign: number }> = []
  for (let j = 0; j < featureNames.length; j++) {
    if (foldSigns.length < N_FOLDS) continue
    const signs = foldSigns.map((s) => s[j])
    const positiveCount = signs.filter((s) => s > 0).length
    const negativeCount = signs.filter((s) => s < 0).length

    if (positiveCount >= MIN_FOLD_SIGN_STABILITY) {
      stableFeatures.push({ index: j, sign: 1 })
    } else if (negativeCount >= MIN_FOLD_SIGN_STABILITY) {
      stableFeatures.push({ index: j, sign: -1 })
    }
  }

  // Sort by absolute weight magnitude and take top MAX_SIGNALS
  stableFeatures.sort(
    (a, b) => Math.abs(finalModel.weights[b.index]) - Math.abs(finalModel.weights[a.index]),
  )
  const topFeatures = stableFeatures.slice(0, MAX_SIGNALS)

  if (topFeatures.length === 0) {
    return { valid: false, signals: [], logLossImprovement, brierOk }
  }

  // Compute marginal probability effect over holdout
  const signals: PredictiveSignal[] = topFeatures.map(({ index, sign }) => {
    // Average marginal effect: mean(P(y=1|x_j=1) - P(y=1|x_j=0)) over holdout
    let totalEffect = 0
    for (const row of holdXs) {
      const rowHigh = [...row]
      const rowLow = [...row]
      rowHigh[index] = row[index] + 1 // one SD above
      rowLow[index] = row[index] - 1 // one SD below

      let zHigh = finalModel.intercept
      let zLow = finalModel.intercept
      for (let j = 0; j < row.length; j++) {
        zHigh += finalModel.weights[j] * rowHigh[j]
        zLow += finalModel.weights[j] * rowLow[j]
      }
      totalEffect += sigmoid(zHigh) - sigmoid(zLow)
    }
    const marginalEffect = totalEffect / holdXs.length

    return {
      feature: featureNames[index],
      direction: sign > 0 ? "positive" : "negative",
      marginalEffect,
    }
  })

  return { valid: true, signals, logLossImprovement, brierOk }
}

// --- Public section builder ---

export function buildPredictiveSection(observations: InsightObservation[]): PredictiveSection {
  try {
    const graded = observations.filter((obs) => obs.recallScore !== undefined)

    if (graded.length < MIN_GRADED) {
      return {
        state: "insufficient",
        message: `Need at least ${MIN_GRADED} graded games (have ${graded.length}).`,
        neededGames: MIN_GRADED - graded.length,
      }
    }

    // Use centralized split helper (single source of chronological split + threshold)
    const { training, holdout, threshold } = splitPredictiveHistory(graded)

    // Check class balance on all rows
    const allScores = [...training, ...holdout].map((r) => r.gradeScore)
    const strong = allScores.filter((s) => s >= threshold).length
    const nonStrong = allScores.filter((s) => s < threshold).length

    if (strong < MIN_EACH_CLASS || nonStrong < MIN_EACH_CLASS) {
      return {
        state: "insufficient",
        message: `Need at least ${MIN_EACH_CLASS} games in each class (strong: ${strong}, non-strong: ${nonStrong}).`,
        neededGames: Math.max(0, MIN_EACH_CLASS - Math.min(strong, nonStrong)),
      }
    }

    // Check holdout class balance
    const holdStrong = holdout.filter((r) => r.gradeScore >= threshold).length
    const holdWeak = holdout.filter((r) => r.gradeScore < threshold).length
    if (holdStrong < MIN_HOLDOUT_EACH_CLASS || holdWeak < MIN_HOLDOUT_EACH_CLASS) {
      return {
        state: "insufficient",
        message: `Holdout needs at least ${MIN_HOLDOUT_EACH_CLASS} outcomes in each class.`,
        neededGames: 0,
      }
    }

    // Run validation
    const result = validatePredictiveSignals(training, holdout, threshold)

    if (result === null) {
      return {
        state: "insufficient",
        message: "Insufficient data for cross-validation.",
        neededGames: 0,
      }
    }

    if (!result.valid || result.signals.length === 0) {
      return {
        state: "no-signal",
        message: "No repeatable pregame signal yet.",
      }
    }

    return {
      state: "ready",
      signals: result.signals,
    }
  } catch (e) {
    if (e instanceof PredictiveModelError) {
      return {
        state: "error",
        message: e.message,
      }
    }
    return {
      state: "error",
      message: "Unexpected error in predictive analysis.",
    }
  }
}
