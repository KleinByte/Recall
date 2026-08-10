import {
  DEFAULT_BOOTSTRAP_DRAWS,
  interpolatedQuantile,
  keyedRandom,
  type ConfidenceInterval,
} from "./statistics.js"

export const STATISTICAL_CONTRACT_VERSION = 3
export const CONDITION_MINIMUM_ARM_GAMES = 8
export const CONDITION_FDR_Q = .10

export interface ConditionObservation {
  id: string | number
  sessionId: string | number
  selected: boolean
  gradeScore: number
}

export interface ConditionFinding {
  status: "ready" | "insufficient_evidence" | "unstable"
  estimator: "arithmetic_mean_difference"
  selectedGames: number
  complementGames: number
  sessions: number
  effect: number | null
  interval: ConfidenceInterval | null
  pValue: number | null
  draws: number
  seedKey: string
}

const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

/** Session-cluster bootstrap over a selected group and its true complement. */
export function conditionFinding(
  input: readonly ConditionObservation[],
  findingKey: string,
  draws = DEFAULT_BOOTSTRAP_DRAWS,
): ConditionFinding {
  const observations = input.filter((value) => Number.isFinite(value.gradeScore))
  const selected = observations.filter((value) => value.selected)
  const complement = observations.filter((value) => !value.selected)
  const seedKey = `condition:v3:${findingKey}`
  const sessionMap = new Map<string | number, ConditionObservation[]>()
  for (const observation of observations) {
    const session = sessionMap.get(observation.sessionId) ?? []
    session.push(observation)
    sessionMap.set(observation.sessionId, session)
  }
  const base = {
    estimator: "arithmetic_mean_difference" as const,
    selectedGames: selected.length,
    complementGames: complement.length,
    sessions: sessionMap.size,
    seedKey,
  }
  if (selected.length < CONDITION_MINIMUM_ARM_GAMES ||
      complement.length < CONDITION_MINIMUM_ARM_GAMES || sessionMap.size === 0) {
    return { ...base, status: "insufficient_evidence", effect: null, interval: null,
      pValue: null, draws: 0 }
  }
  const sessions = [...sessionMap.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([, entries]) => entries)
  const rng = keyedRandom(seedKey)
  const differences: number[] = []
  for (let attempt = 0; attempt < 10_000 && differences.length < draws; attempt += 1) {
    const sampledSelected: number[] = []
    const sampledComplement: number[] = []
    for (let index = 0; index < sessions.length; index += 1) {
      const sampled = sessions[Math.floor(rng() * sessions.length)]
      for (const observation of sampled) {
        ;(observation.selected ? sampledSelected : sampledComplement).push(observation.gradeScore)
      }
    }
    if (!sampledSelected.length || !sampledComplement.length) continue
    differences.push(mean(sampledSelected) - mean(sampledComplement))
  }
  if (differences.length < draws) {
    return { ...base, status: "unstable", effect: mean(selected.map((value) => value.gradeScore)) -
      mean(complement.map((value) => value.gradeScore)), interval: null, pValue: null,
      draws: differences.length }
  }
  const lessOrEqual = differences.filter((value) => value <= 0).length / differences.length
  const greaterOrEqual = differences.filter((value) => value >= 0).length / differences.length
  return {
    ...base,
    status: "ready",
    effect: mean(selected.map((value) => value.gradeScore)) -
      mean(complement.map((value) => value.gradeScore)),
    interval: { low: interpolatedQuantile(differences, .025)!,
      high: interpolatedQuantile(differences, .975)!, level: .95 },
    pValue: Math.min(1, 2 * Math.min(lessOrEqual, greaterOrEqual)),
    draws: differences.length,
  }
}

export interface FdrResult {
  key: string
  pValue: number
  adjustedPValue: number
  passes: boolean
}

/** Benjamini-Hochberg correction across one complete report family. */
export function benjaminiHochberg(
  findings: readonly { key: string; pValue: number }[],
  q = CONDITION_FDR_Q,
): FdrResult[] {
  const ordered = findings.map((entry, index) => ({ ...entry, index }))
    .filter((entry) => Number.isFinite(entry.pValue) && entry.pValue >= 0 && entry.pValue <= 1)
    .sort((left, right) => left.pValue - right.pValue || left.key.localeCompare(right.key))
  let cutoffRank = 0
  for (let rank = 1; rank <= ordered.length; rank += 1) {
    if (ordered[rank - 1].pValue <= q * rank / ordered.length) cutoffRank = rank
  }
  let runningAdjusted = 1
  const adjusted = new Map<string, number>()
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    runningAdjusted = Math.min(runningAdjusted, ordered[index].pValue * ordered.length / (index + 1))
    adjusted.set(ordered[index].key, Math.min(1, runningAdjusted))
  }
  return findings.map((entry) => ({
    key: entry.key,
    pValue: entry.pValue,
    adjustedPValue: adjusted.get(entry.key) ?? 1,
    passes: ordered.findIndex((candidate) => candidate.key === entry.key) + 1 <= cutoffRank,
  }))
}
