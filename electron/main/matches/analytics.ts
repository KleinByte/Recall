export interface Interval { low: number; high: number; level: 0.95 }
export interface SessionInput { gameId: number; startedAt: number; endedAt?: number }
export interface SessionGame extends SessionInput {
  session: number
  sessionGame: number
  restMinutes?: number
}

export type EvidenceConfidence = "high" | "medium" | "low" | "insufficient"

/**
 * Wilson score confidence interval for binomial proportion
 */
export function wilsonInterval(wins: number, games: number, z = 1.96): Interval {
  if (games === 0) {
    return { low: 0, high: 1, level: 0.95 }
  }
  
  const p = wins / games
  const z2 = z * z
  const denominator = 1 + z2 / games
  const center = (p + z2 / (2 * games)) / denominator
  const margin = (z * Math.sqrt(p * (1 - p) / games + z2 / (4 * games * games))) / denominator
  
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
    level: 0.95,
  }
}

/**
 * Bayesian shrinkage of observed rate toward baseline prior
 */
export function shrinkRate(wins: number, games: number, baseline: number, priorWeight = 12): number {
  return (wins + priorWeight * baseline) / (games + priorWeight)
}

/**
 * Compute quantile without mutating input array
 */
export function quantile(values: number[], probability: number): number | undefined {
  if (values.length === 0) return undefined
  
  const sorted = [...values].sort((a, b) => a - b)
  const index = probability * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const weight = index - lower
  
  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

/**
 * Empirical percentile using midrank for ties
 */
export function empiricalPercentile(values: number[], value: number): number {
  if (values.length === 0) return 0
  
  let below = 0
  let equal = 0
  
  for (const v of values) {
    if (v < value) below++
    else if (v === value) equal++
  }
  
  return (below + equal / 2) / values.length
}

/**
 * Detect play sessions from game timestamps
 */
export function sessionize<T extends SessionInput>(games: T[], breakMinutes = 90): Array<T & SessionGame> {
  if (games.length === 0) return []
  
  const results: Array<T & SessionGame> = []
  let currentSession = 1
  let sessionGame = 1
  let previousEnd: number | undefined
  
  for (const game of games) {
    let restMinutes: number | undefined
    
    if (previousEnd !== undefined && game.endedAt !== undefined) {
      const gapMs = game.startedAt - previousEnd
      restMinutes = gapMs / 60_000
      
      if (restMinutes > breakMinutes) {
        currentSession++
        sessionGame = 1
      }
    } else if (previousEnd === undefined && results.length > 0) {
      // Missing end time breaks the session
      currentSession++
      sessionGame = 1
    }
    
    results.push({
      ...game,
      session: currentSession,
      sessionGame: sessionGame,
      restMinutes,
    })
    
    sessionGame++
    previousEnd = game.endedAt
  }
  
  return results
}

/**
 * Seeded pseudo-random number generator using FNV-1a hash
 */
export function seededRandom(seed: string): () => number {
  // FNV-1a 32-bit hash
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  
  // Linear congruential generator
  let state = hash >>> 0
  return () => {
    state = Math.imul(state, 1664525) + 1013904223
    return (state >>> 0) / 0x100000000
  }
}

/**
 * Bootstrap confidence interval for median difference
 */
export function bootstrapDifference(left: number[], right: number[], seed: string, resamples = 2_000): Interval {
  const rng = seededRandom(seed)
  const differences: number[] = []
  
  for (let i = 0; i < resamples; i++) {
    // Resample left with replacement
    const leftSample: number[] = []
    for (let j = 0; j < left.length; j++) {
      const index = Math.floor(rng() * left.length)
      leftSample.push(left[index])
    }
    
    // Resample right with replacement
    const rightSample: number[] = []
    for (let j = 0; j < right.length; j++) {
      const index = Math.floor(rng() * right.length)
      rightSample.push(right[index])
    }
    
    // Compute median difference
    const leftMedian = quantile(leftSample, 0.5) ?? 0
    const rightMedian = quantile(rightSample, 0.5) ?? 0
    differences.push(leftMedian - rightMedian)
  }
  
  const low = quantile(differences, 0.025) ?? 0
  const high = quantile(differences, 0.975) ?? 0
  
  return { low, high, level: 0.95 }
}

/**
 * Assess confidence level for a finding
 */
export function confidenceForFinding(games: number, interval: Interval | undefined, unit: "grade" | "probability"): EvidenceConfidence {
  if (!interval || games < 10) return "insufficient"
  
  const width = interval.high - interval.low
  
  if (unit === "probability") {
    if (games >= 50 && width < 0.15) return "high"
    if (games >= 30 && width < 0.25) return "medium"
    return "low"
  } else { // grade
    if (games >= 50 && width < 1.5) return "high"
    if (games >= 30 && width < 2.5) return "medium"
    return "low"
  }
}
