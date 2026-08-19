import type {
  CampKey,
  CampStateObservation,
  CampVisualState,
  RgbaFrame,
} from "../../../src/shared/minimap/contracts.js"
import { clamp } from "../../../src/shared/minimap/contracts.js"
import {
  cropFrame,
  gradientMagnitude,
  grayscale,
  meanSquaredError,
  normalizedCorrelation,
  resizeFrameBilinear,
} from "../minimap/image-ops.js"
import {
  SUMMONERS_RIFT_CAMPS,
  SUMMONERS_RIFT_CAMP_MAP_VERSION,
  type CampDefinition,
} from "./camp-map.js"

export const CAMP_VISUAL_DETECTOR_VERSION = 3
const TEMPLATE_SIZE = 24

export interface CampVisualTemplate {
  campKey: CampKey | "*"
  state: Exclude<CampVisualState, "unknown">
  gray: Float32Array
  gradient: Float32Array
}

export interface CampClassification {
  campKey: CampKey
  state: CampVisualState
  confidence: number
  scoreMargin: number
  method?: "template" | "adaptive_alive_baseline"
}

export class CampTemplateBank {
  private readonly templates: CampVisualTemplate[] = []

  add(
    campKey: CampKey | "*",
    state: Exclude<CampVisualState, "unknown">,
    patch: RgbaFrame,
  ) {
    const normalized = resizeFrameBilinear(patch, TEMPLATE_SIZE, TEMPLATE_SIZE)
    const gray = grayscale(normalized)
    this.templates.push({
      campKey,
      state,
      gray,
      gradient: gradientMagnitude(gray, TEMPLATE_SIZE, TEMPLATE_SIZE),
    })
  }

  forCamp(campKey: CampKey) {
    const exact = this.templates.filter((template) => template.campKey === campKey)
    return exact.length > 0
      ? exact
      : this.templates.filter((template) => template.campKey === "*")
  }

  get size() {
    return this.templates.length
  }
}

function patchFor(frame: RgbaFrame, camp: CampDefinition) {
  const radiusX = frame.width * camp.patchRadius
  const radiusY = frame.height * camp.patchRadius
  return cropFrame(frame, {
    x: frame.width * camp.center.x - radiusX,
    y: frame.height * camp.center.y - radiusY,
    width: radiusX * 2,
    height: radiusY * 2,
  })
}

function normalizedFeatures(patch: RgbaFrame) {
  const normalized = resizeFrameBilinear(patch, TEMPLATE_SIZE, TEMPLATE_SIZE)
  const gray = grayscale(normalized)
  return {
    gray,
    gradient: gradientMagnitude(gray, TEMPLATE_SIZE, TEMPLATE_SIZE),
  }
}

function scoreFeatures(
  features: { gray: Float32Array; gradient: Float32Array },
  template: Pick<CampVisualTemplate, "gray" | "gradient">,
) {
  const intensityCorrelation = (normalizedCorrelation(features.gray, template.gray) + 1) / 2
  const gradientCorrelation = (normalizedCorrelation(features.gradient, template.gradient) + 1) / 2
  const mse = meanSquaredError(features.gray, template.gray)
  const mseScore = Math.exp(-mse / 1_800)
  return clamp(intensityCorrelation * 0.45 + gradientCorrelation * 0.4 + mseScore * 0.15)
}

function scorePatch(patch: RgbaFrame, template: CampVisualTemplate) {
  return scoreFeatures(normalizedFeatures(patch), template)
}

interface StableFeatureSequence {
  count: number
  firstObservedAtMs: number
  latestObservedAtMs: number
  accumulated: Float64Array
}

interface AdaptiveState {
  learning?: StableFeatureSequence
  learningRejected: boolean
  baseline?: CampVisualTemplate
}

export interface AdaptiveCampDetectorOptions {
  /** Safe interval in which an ordinary camp is expected to have just spawned. */
  learningWindowStartMs: number
  latestLearningStartMs: number
  learningWindowEndMs: number
  stableFramesRequired: number
  minimumLearningDurationMs: number
  maximumLearningGapMs: number
  maximumStableMse: number
  minimumBaselineVariance: number
  aliveScore: number
  changedScore: number
  changedPixelThreshold: number
  maximumChangedPixelFraction: number
  minimumCentralChangedShare: number
}

const DEFAULT_ADAPTIVE_OPTIONS: AdaptiveCampDetectorOptions = {
  learningWindowStartMs: 91_000,
  latestLearningStartMs: 93_000,
  learningWindowEndMs: 100_000,
  stableFramesRequired: 3,
  minimumLearningDurationMs: 1_500,
  maximumLearningGapMs: 6_000,
  maximumStableMse: 70,
  minimumBaselineVariance: 45,
  aliveScore: 0.82,
  changedScore: 0.57,
  changedPixelThreshold: 24,
  maximumChangedPixelFraction: 0.48,
  minimumCentralChangedShare: 0.4,
}

function beginSequence(features: { gray: Float32Array }, gameTimeMs: number) {
  return {
    count: 1,
    firstObservedAtMs: gameTimeMs,
    latestObservedAtMs: gameTimeMs,
    accumulated: Float64Array.from(features.gray),
  } satisfies StableFeatureSequence
}

function mseFromSequenceMean(gray: Float32Array, sequence: StableFeatureSequence) {
  let sum = 0
  for (let index = 0; index < gray.length; index += 1) {
    const difference = gray[index] - sequence.accumulated[index] / sequence.count
    sum += difference * difference
  }
  return sum / gray.length
}

function appendSequence(
  sequence: StableFeatureSequence,
  gray: Float32Array,
  gameTimeMs: number,
) {
  for (let index = 0; index < gray.length; index += 1) {
    sequence.accumulated[index] += gray[index]
  }
  sequence.count += 1
  sequence.latestObservedAtMs = gameTimeMs
}

function templateFromSequence(
  campKey: CampKey,
  state: Exclude<CampVisualState, "unknown">,
  sequence: StableFeatureSequence,
): CampVisualTemplate {
  const gray = new Float32Array(sequence.accumulated.length)
  for (let index = 0; index < gray.length; index += 1) {
    gray[index] = sequence.accumulated[index] / sequence.count
  }
  return {
    campKey,
    state,
    gray,
    gradient: gradientMagnitude(gray, TEMPLATE_SIZE, TEMPLATE_SIZE),
  }
}

function variance(values: Float32Array) {
  let sum = 0
  let squared = 0
  for (const value of values) {
    sum += value
    squared += value * value
  }
  const mean = sum / values.length
  return Math.max(0, squared / values.length - mean * mean)
}

function changeShape(
  gray: Float32Array,
  baseline: Float32Array,
  pixelThreshold: number,
) {
  let changed = 0
  let central = 0
  const center = (TEMPLATE_SIZE - 1) / 2
  const centralRadius = TEMPLATE_SIZE * 0.4
  for (let index = 0; index < gray.length; index += 1) {
    if (Math.abs(gray[index] - baseline[index]) < pixelThreshold) continue
    changed += 1
    const x = index % TEMPLATE_SIZE
    const y = Math.floor(index / TEMPLATE_SIZE)
    if (Math.hypot(x - center, y - center) <= centralRadius) central += 1
  }
  return {
    changedFraction: changed / gray.length,
    centralShare: changed === 0 ? 0 : central / changed,
  }
}

/**
 * Learns each ordinary camp's rendered alive icon immediately after first
 * spawn. This makes the first-clear path usable without shipping patch-specific
 * screenshots. Epic/scuttle camps remain template-only because their spawn/UI
 * rules are more patch-sensitive.
 */
export class AdaptiveCampBaselineDetector {
  private readonly states = new Map<CampKey, AdaptiveState>()
  private readonly options: AdaptiveCampDetectorOptions

  constructor(options: Partial<AdaptiveCampDetectorOptions> = {}) {
    this.options = { ...DEFAULT_ADAPTIVE_OPTIONS, ...options }
  }

  classify(
    patch: RgbaFrame,
    camp: CampDefinition,
    gameTimeMs: number | undefined,
  ): CampClassification {
    if (camp.respawnRule === "epic" || camp.respawnRule === "scuttle") {
      return { campKey: camp.key, state: "unknown", confidence: 0, scoreMargin: 0 }
    }
    const state = this.states.get(camp.key) ?? { learningRejected: false }
    this.states.set(camp.key, state)
    const features = normalizedFeatures(patch)
    if (!state.baseline) {
      if (gameTimeMs === undefined || gameTimeMs < this.options.learningWindowStartMs) {
        return { campKey: camp.key, state: "unknown", confidence: 0, scoreMargin: 0 }
      }
      if (gameTimeMs > this.options.learningWindowEndMs) {
        state.learning = undefined
        state.learningRejected = true
        return { campKey: camp.key, state: "unknown", confidence: 0, scoreMargin: 0 }
      }
      if (state.learningRejected) {
        return { campKey: camp.key, state: "unknown", confidence: 0, scoreMargin: 0 }
      }
      if (!state.learning) {
        if (gameTimeMs > this.options.latestLearningStartMs) {
          state.learningRejected = true
          return { campKey: camp.key, state: "unknown", confidence: 0, scoreMargin: 0 }
        }
        state.learning = beginSequence(features, gameTimeMs)
        return { campKey: camp.key, state: "unknown", confidence: 0.2, scoreMargin: 0 }
      }
      if (gameTimeMs <= state.learning.latestObservedAtMs) {
        return { campKey: camp.key, state: "unknown", confidence: 0, scoreMargin: 0 }
      }
      const learningGapMs = gameTimeMs - state.learning.latestObservedAtMs
      const stable = learningGapMs <= this.options.maximumLearningGapMs &&
        mseFromSequenceMean(features.gray, state.learning) <= this.options.maximumStableMse
      if (!stable) {
        // Do not restart inside the learning window. Once the early appearance
        // changes, a fresh stable sequence could already be a cleared camp.
        state.learning = undefined
        state.learningRejected = true
        return { campKey: camp.key, state: "unknown", confidence: 0, scoreMargin: 0 }
      }
      appendSequence(state.learning, features.gray, gameTimeMs)
      if (state.learning.count < this.options.stableFramesRequired ||
          gameTimeMs - state.learning.firstObservedAtMs <
            this.options.minimumLearningDurationMs) {
        return { campKey: camp.key, state: "unknown", confidence: 0.35, scoreMargin: 0 }
      }
      const learned = templateFromSequence(camp.key, "alive", state.learning)
      if (variance(learned.gray) < this.options.minimumBaselineVariance) {
        state.learning = undefined
        state.learningRejected = true
        return { campKey: camp.key, state: "unknown", confidence: 0, scoreMargin: 0 }
      }
      state.baseline = learned
      state.learning = undefined
      return {
        campKey: camp.key,
        state: "alive",
        confidence: 0.82,
        scoreMargin: 0.22,
        method: "adaptive_alive_baseline",
      }
    }

    const score = scoreFeatures(features, state.baseline)
    if (score >= this.options.aliveScore) {
      return {
        campKey: camp.key,
        state: "alive",
        confidence: clamp(0.72 + (score - this.options.aliveScore) * 1.2),
        scoreMargin: score - this.options.aliveScore,
        method: "adaptive_alive_baseline",
      }
    }
    if (score > this.options.changedScore || gameTimeMs === undefined) {
      return {
        campKey: camp.key,
        state: "unknown",
        confidence: clamp(Math.abs(score - 0.7)),
        scoreMargin: 0,
        method: "adaptive_alive_baseline",
      }
    }
    const shape = changeShape(
      features.gray,
      state.baseline.gray,
      this.options.changedPixelThreshold,
    )
    if (shape.changedFraction > this.options.maximumChangedPixelFraction ||
        shape.centralShare < this.options.minimumCentralChangedShare) {
      return {
        campKey: camp.key,
        state: "unknown",
        confidence: 0,
        scoreMargin: 0,
        method: "adaptive_alive_baseline",
      }
    }
    return {
      campKey: camp.key,
      state: "dead",
      confidence: clamp(0.78 + (this.options.changedScore - score) * 0.5),
      scoreMargin: this.options.changedScore - score,
      method: "adaptive_alive_baseline",
    }
  }

  reset() {
    this.states.clear()
  }
}

export class CampVisualDetector {
  constructor(
    private readonly templates: CampTemplateBank,
    private readonly minimumScore = 0.7,
    private readonly minimumMargin = 0.035,
    private readonly adaptive = new AdaptiveCampBaselineDetector(),
  ) {}

  classify(
    frame: RgbaFrame,
    camp: CampDefinition,
    gameTimeMs?: number,
  ): CampClassification {
    const templates = this.templates.forCamp(camp.key)
    const patch = patchFor(frame, camp)
    if (templates.length === 0) return this.adaptive.classify(patch, camp, gameTimeMs)
    const bestByState = new Map<Exclude<CampVisualState, "unknown">, {
      template: CampVisualTemplate
      score: number
    }>()
    for (const template of templates) {
      const score = scorePatch(patch, template)
      const previous = bestByState.get(template.state)
      if (!previous || score > previous.score) bestByState.set(template.state, { template, score })
    }
    const scored = [...bestByState.values()]
      .sort((left, right) => right.score - left.score)
    const best = scored[0]
    const competingState = scored[1]
    const margin = competingState
      ? best.score - competingState.score
      : best.score - this.minimumScore
    if (best.score < this.minimumScore ||
        (competingState !== undefined && margin < this.minimumMargin)) {
      return {
        campKey: camp.key,
        state: "unknown",
        confidence: clamp(best.score * 0.5),
        scoreMargin: Math.max(0, margin),
        method: "template",
      }
    }
    return {
      campKey: camp.key,
      state: best.template.state,
      confidence: clamp(best.score * 0.8 + margin * 1.5),
      scoreMargin: margin,
      method: "template",
    }
  }

  observeAll(input: {
    frame: RgbaFrame
    gameId: number
    gameTimeMs: number
  }): CampStateObservation[] {
    return SUMMONERS_RIFT_CAMPS.map((camp) => {
      const classification = this.classify(input.frame, camp, input.gameTimeMs)
      return {
        gameId: input.gameId,
        campKey: camp.key,
        gameTimeMs: input.gameTimeMs,
        state: classification.state,
        source: "minimap_cv",
        sourceConfidence: classification.confidence,
        frameSequence: input.frame.frameSequence,
        providerVersion: CAMP_VISUAL_DETECTOR_VERSION * 1_000 + SUMMONERS_RIFT_CAMP_MAP_VERSION,
      }
    })
  }

  reset() {
    this.adaptive.reset()
  }
}
