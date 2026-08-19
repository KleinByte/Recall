import { clamp } from "../../../src/shared/minimap/contracts.js"

export interface GameClockEstimate {
  gameTimeMs: number
  estimatedErrorMs: number
  sampleCount: number
  slope: number
}

interface ClockSample {
  monotonicMs: number
  gameTimeMs: number
}

function median(values: number[]) {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function regression(samples: ClockSample[]) {
  const origin = samples[0]
  const xs = samples.map((sample) => sample.monotonicMs - origin.monotonicMs)
  const ys = samples.map((sample) => sample.gameTimeMs - origin.gameTimeMs)
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length
  let numerator = 0
  let denominator = 0
  for (let index = 0; index < xs.length; index += 1) {
    numerator += (xs[index] - xMean) * (ys[index] - yMean)
    denominator += (xs[index] - xMean) ** 2
  }
  const slope = denominator <= 1e-6 ? 1 : clamp(numerator / denominator, 0.97, 1.03)
  const intercept = origin.gameTimeMs + yMean - slope * (origin.monotonicMs + xMean)
  return { slope, intercept }
}

/** Robustly maps performance/monotonic timestamps to Riot game time. */
export class GameClockSynchronizer {
  private samples: ClockSample[] = []

  constructor(private readonly maximumSamples = 31) {}

  addSample(monotonicMs: number, gameTimeSeconds: number) {
    if (!Number.isFinite(monotonicMs) || !Number.isFinite(gameTimeSeconds) ||
        monotonicMs < 0 || gameTimeSeconds < 0) return false
    const gameTimeMs = gameTimeSeconds * 1_000
    const previous = this.samples.at(-1)
    if (previous && (monotonicMs <= previous.monotonicMs ||
        gameTimeMs + 2_000 < previous.gameTimeMs)) {
      this.reset()
    }
    this.samples.push({ monotonicMs, gameTimeMs })
    if (this.samples.length > this.maximumSamples) this.samples.shift()
    return true
  }

  estimate(monotonicMs: number): GameClockEstimate | undefined {
    if (!Number.isFinite(monotonicMs) || this.samples.length === 0) return undefined
    if (this.samples.length === 1) {
      const sample = this.samples[0]
      return {
        gameTimeMs: Math.max(0, sample.gameTimeMs + monotonicMs - sample.monotonicMs),
        estimatedErrorMs: 500,
        sampleCount: 1,
        slope: 1,
      }
    }
    const initial = regression(this.samples)
    const residuals = this.samples.map((sample) =>
      sample.gameTimeMs - (initial.slope * sample.monotonicMs + initial.intercept))
    const center = median(residuals)
    const deviations = residuals.map((value) => Math.abs(value - center))
    const mad = Math.max(5, median(deviations))
    const inliers = this.samples.filter((_sample, index) => deviations[index] <= mad * 3.5)
    const fitted = regression(inliers.length >= 2 ? inliers : this.samples)
    const fittedResiduals = (inliers.length >= 2 ? inliers : this.samples).map((sample) =>
      Math.abs(sample.gameTimeMs - (fitted.slope * sample.monotonicMs + fitted.intercept)))
    return {
      gameTimeMs: Math.max(0, fitted.slope * monotonicMs + fitted.intercept),
      estimatedErrorMs: Math.max(12, median(fittedResiduals) * 1.4826),
      sampleCount: inliers.length,
      slope: fitted.slope,
    }
  }

  reset() {
    this.samples = []
  }

  get sampleCount() {
    return this.samples.length
  }
}
