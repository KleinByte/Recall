import type {
  CampKey,
  CampStateObservation,
  CampVisualState,
  RgbaFrame,
} from "../../../src/shared/minimap/contracts.js"
import { clamp } from "../../../src/shared/minimap/contracts.js"
import {
  CAMP_VISUAL_DETECTOR_VERSION,
  type CampClassification,
  type CampVisualTemplateAsset,
} from "../jungle/camp-visual-detector.js"
import {
  SUMMONERS_RIFT_CAMPS,
  SUMMONERS_RIFT_CAMP_MAP_VERSION,
  type CampDefinition,
} from "../jungle/camp-map.js"
import {
  frameToMat,
  gradientMagnitude,
  meanSquaredError,
  normalizedCorrelation,
  safeDelete,
  type OpenCv,
} from "./opencv-runtime.js"

const TEMPLATE_SIZE = 24

interface PreparedFeatures {
  gray: any
  gradient: any
  iconColorRatio: number
}

interface PreparedTemplate extends PreparedFeatures {
  source: CampVisualTemplateAsset
}

interface StableFeatureSequence {
  count: number
  firstObservedAtMs: number
  latestObservedAtMs: number
  accumulated: any
}

interface AdaptiveState {
  learning?: StableFeatureSequence
  learningRejected: boolean
  baseline?: PreparedFeatures
}

export interface AdaptiveCampDetectorOptions {
  learningWindowStartMs: number
  latestLearningStartMs: number
  learningWindowEndMs: number
  lateRecoveryStartMs: number
  minimumLateIconColorRatio: number
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
  learningWindowStartMs: 89_000,
  latestLearningStartMs: 99_000,
  learningWindowEndMs: 106_000,
  lateRecoveryStartMs: 130_000,
  minimumLateIconColorRatio: 0.025,
  stableFramesRequired: 3,
  minimumLearningDurationMs: 1_000,
  maximumLearningGapMs: 8_000,
  maximumStableMse: 70,
  minimumBaselineVariance: 45,
  aliveScore: 0.82,
  changedScore: 0.57,
  changedPixelThreshold: 24,
  maximumChangedPixelFraction: 0.48,
  minimumCentralChangedShare: 0.4,
}

function featuresFromRgba(cv: OpenCv, rgba: any): PreparedFeatures {
  const resized = new cv.Mat()
  const rgb = new cv.Mat()
  const hsv = new cv.Mat()
  const gray = new cv.Mat()
  const gold = new cv.Mat()
  const centralMask = cv.Mat.zeros(TEMPLATE_SIZE, TEMPLATE_SIZE, cv.CV_8UC1)
  const centralGold = new cv.Mat()
  const lowerGold = new cv.Mat(
    TEMPLATE_SIZE,
    TEMPLATE_SIZE,
    cv.CV_8UC3,
    new cv.Scalar(7, 50, 50),
  )
  const upperGold = new cv.Mat(
    TEMPLATE_SIZE,
    TEMPLATE_SIZE,
    cv.CV_8UC3,
    new cv.Scalar(38, 255, 255),
  )
  try {
    cv.resize(rgba, resized, new cv.Size(TEMPLATE_SIZE, TEMPLATE_SIZE), 0, 0, cv.INTER_LINEAR)
    cv.cvtColor(resized, rgb, cv.COLOR_RGBA2RGB)
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV)
    cv.cvtColor(resized, gray, cv.COLOR_RGBA2GRAY)
    cv.inRange(hsv, lowerGold, upperGold, gold)
    cv.circle(
      centralMask,
      new cv.Point(Math.floor(TEMPLATE_SIZE / 2), Math.floor(TEMPLATE_SIZE / 2)),
      Math.round(TEMPLATE_SIZE * 0.34),
      new cv.Scalar(255),
      -1,
    )
    cv.bitwise_and(gold, centralMask, centralGold)
    const centralPixels = Math.max(1, Number(cv.countNonZero(centralMask)))
    return {
      gray: gray.clone(),
      gradient: gradientMagnitude(cv, gray),
      iconColorRatio: Number(cv.countNonZero(centralGold)) / centralPixels,
    }
  } finally {
    safeDelete(
      resized, rgb, hsv, gray, gold, centralMask, centralGold,
      lowerGold, upperGold,
    )
  }
}

function patchFeatures(cv: OpenCv, frame: any, camp: CampDefinition) {
  const radiusX = frame.cols * camp.patchRadius
  const radiusY = frame.rows * camp.patchRadius
  const x = Math.max(0, Math.floor(frame.cols * camp.center.x - radiusX))
  const y = Math.max(0, Math.floor(frame.rows * camp.center.y - radiusY))
  const width = Math.max(1, Math.min(frame.cols - x, Math.ceil(radiusX * 2)))
  const height = Math.max(1, Math.min(frame.rows - y, Math.ceil(radiusY * 2)))
  const roi = frame.roi(new cv.Rect(x, y, width, height))
  try {
    return featuresFromRgba(cv, roi)
  } finally {
    roi.delete()
  }
}

function scoreFeatures(cv: OpenCv, features: PreparedFeatures, template: PreparedFeatures) {
  const intensityCorrelation = (normalizedCorrelation(cv, features.gray, template.gray) + 1) / 2
  const gradientCorrelation = (normalizedCorrelation(cv, features.gradient, template.gradient) + 1) / 2
  const mse = meanSquaredError(cv, features.gray, template.gray)
  const mseScore = Math.exp(-mse / 1_800)
  return clamp(intensityCorrelation * 0.45 + gradientCorrelation * 0.4 + mseScore * 0.15)
}

function beginSequence(cv: OpenCv, gray: any, gameTimeMs: number): StableFeatureSequence {
  const accumulated = new cv.Mat()
  gray.convertTo(accumulated, cv.CV_32F)
  return {
    count: 1,
    firstObservedAtMs: gameTimeMs,
    latestObservedAtMs: gameTimeMs,
    accumulated,
  }
}

function sequenceMean(cv: OpenCv, sequence: StableFeatureSequence) {
  const mean = new cv.Mat()
  sequence.accumulated.convertTo(mean, cv.CV_32F, 1 / sequence.count)
  return mean
}

function mseFromSequenceMean(cv: OpenCv, gray: any, sequence: StableFeatureSequence) {
  const mean = sequenceMean(cv, sequence)
  const floatGray = new cv.Mat()
  try {
    gray.convertTo(floatGray, cv.CV_32F)
    return meanSquaredError(cv, floatGray, mean)
  } finally {
    safeDelete(mean, floatGray)
  }
}

function appendSequence(cv: OpenCv, sequence: StableFeatureSequence, gray: any, gameTimeMs: number) {
  const floatGray = new cv.Mat()
  try {
    gray.convertTo(floatGray, cv.CV_32F)
    cv.add(sequence.accumulated, floatGray, sequence.accumulated)
    sequence.count += 1
    sequence.latestObservedAtMs = gameTimeMs
  } finally {
    floatGray.delete()
  }
}

function templateFromSequence(cv: OpenCv, sequence: StableFeatureSequence): PreparedFeatures {
  const floatMean = sequenceMean(cv, sequence)
  const gray = new cv.Mat()
  try {
    floatMean.convertTo(gray, cv.CV_8U)
    return {
      gray: gray.clone(),
      gradient: gradientMagnitude(cv, gray),
      iconColorRatio: 0,
    }
  } finally {
    safeDelete(floatMean, gray)
  }
}

function variance(cv: OpenCv, gray: any) {
  const mean = new cv.Mat()
  const stddev = new cv.Mat()
  try {
    cv.meanStdDev(gray, mean, stddev)
    const sigma = Number(stddev.doubleAt(0, 0))
    return sigma * sigma
  } finally {
    safeDelete(mean, stddev)
  }
}

function changeShape(
  cv: OpenCv,
  gray: any,
  baseline: any,
  pixelThreshold: number,
) {
  const diff = new cv.Mat()
  const changed = new cv.Mat()
  const centralMask = cv.Mat.zeros(TEMPLATE_SIZE, TEMPLATE_SIZE, cv.CV_8UC1)
  const centralChanged = new cv.Mat()
  try {
    cv.absdiff(gray, baseline, diff)
    cv.threshold(diff, changed, pixelThreshold - 1, 255, cv.THRESH_BINARY)
    cv.circle(
      centralMask,
      new cv.Point(Math.floor(TEMPLATE_SIZE / 2), Math.floor(TEMPLATE_SIZE / 2)),
      Math.round(TEMPLATE_SIZE * 0.4),
      new cv.Scalar(255),
      -1,
    )
    cv.bitwise_and(changed, centralMask, centralChanged)
    const changedCount = Number(cv.countNonZero(changed))
    const centralCount = Number(cv.countNonZero(centralChanged))
    return {
      changedFraction: changedCount / (TEMPLATE_SIZE * TEMPLATE_SIZE),
      centralShare: changedCount === 0 ? 0 : centralCount / changedCount,
    }
  } finally {
    safeDelete(diff, changed, centralMask, centralChanged)
  }
}

export class OpenCvCampDetector {
  private readonly templates = new Map<CampKey | "*", PreparedTemplate[]>()
  private readonly adaptiveStates = new Map<CampKey, AdaptiveState>()
  private readonly options: AdaptiveCampDetectorOptions

  constructor(
    private readonly cv: OpenCv,
    private readonly minimumScore = 0.7,
    private readonly minimumMargin = 0.035,
    adaptiveOptions: Partial<AdaptiveCampDetectorOptions> = {},
  ) {
    this.options = { ...DEFAULT_ADAPTIVE_OPTIONS, ...adaptiveOptions }
  }

  setTemplates(assets: CampVisualTemplateAsset[]) {
    this.clearTemplates()
    for (const asset of assets) {
      if (asset.width <= 0 || asset.height <= 0 ||
          asset.rgba.length !== asset.width * asset.height * 4) continue
      const rgba = frameToMat(this.cv, {
        width: asset.width,
        height: asset.height,
        data: asset.rgba,
        capturedMonotonicMs: 0,
        frameSequence: 0,
      })
      try {
        const features = featuresFromRgba(this.cv, rgba)
        const entry: PreparedTemplate = { source: asset, ...features }
        const list = this.templates.get(asset.campKey) ?? []
        list.push(entry)
        this.templates.set(asset.campKey, list)
      } finally {
        rgba.delete()
      }
    }
  }

  private classifyTemplate(campKey: CampKey, features: PreparedFeatures): CampClassification | undefined {
    const exact = this.templates.get(campKey)
    const templates = exact?.length ? exact : this.templates.get("*")
    if (!templates?.length) return undefined
    const bestByState = new Map<Exclude<CampVisualState, "unknown">, { template: PreparedTemplate; score: number }>()
    for (const template of templates) {
      const score = scoreFeatures(this.cv, features, template)
      const previous = bestByState.get(template.source.state)
      if (!previous || score > previous.score) {
        bestByState.set(template.source.state, { template, score })
      }
    }
    const scored = [...bestByState.values()].sort((left, right) => right.score - left.score)
    const best = scored[0]
    if (!best) return undefined
    const competing = scored[1]
    const margin = competing ? best.score - competing.score : best.score - this.minimumScore
    if (best.score < this.minimumScore || (competing && margin < this.minimumMargin)) {
      return {
        campKey,
        state: "unknown",
        confidence: clamp(best.score * 0.5),
        scoreMargin: Math.max(0, margin),
        method: "template",
      }
    }
    return {
      campKey,
      state: best.template.source.state,
      confidence: clamp(best.score * 0.8 + margin * 1.5),
      scoreMargin: margin,
      method: "template",
    }
  }

  private classifyAdaptive(
    camp: CampDefinition,
    features: PreparedFeatures,
    gameTimeMs: number | undefined,
  ): CampClassification {
    if (camp.respawnRule === "epic" || camp.respawnRule === "scuttle") {
      return { campKey: camp.key, state: "unknown", confidence: 0, scoreMargin: 0 }
    }
    const state = this.adaptiveStates.get(camp.key) ?? { learningRejected: false }
    this.adaptiveStates.set(camp.key, state)

    if (!state.baseline) {
      if (gameTimeMs === undefined || gameTimeMs < this.options.learningWindowStartMs) {
        return { campKey: camp.key, state: "unknown", confidence: 0, scoreMargin: 0 }
      }
      const lateRecovery = gameTimeMs >= this.options.lateRecoveryStartMs
      const lateIconVisible = features.iconColorRatio >=
        this.options.minimumLateIconColorRatio
      if (gameTimeMs > this.options.learningWindowEndMs &&
          (!lateRecovery || !lateIconVisible)) {
        safeDelete(state.learning?.accumulated)
        state.learning = undefined
        return { campKey: camp.key, state: "unknown", confidence: 0, scoreMargin: 0 }
      }
      if (state.learningRejected && !lateRecovery) {
        return { campKey: camp.key, state: "unknown", confidence: 0, scoreMargin: 0 }
      }
      if (!state.learning) {
        if (!lateRecovery && gameTimeMs > this.options.latestLearningStartMs) {
          state.learningRejected = true
          return { campKey: camp.key, state: "unknown", confidence: 0, scoreMargin: 0 }
        }
        if (lateRecovery) state.learningRejected = false
        state.learning = beginSequence(this.cv, features.gray, gameTimeMs)
        return { campKey: camp.key, state: "unknown", confidence: 0.2, scoreMargin: 0 }
      }
      if (gameTimeMs <= state.learning.latestObservedAtMs) {
        return { campKey: camp.key, state: "unknown", confidence: 0, scoreMargin: 0 }
      }
      const learningGapMs = gameTimeMs - state.learning.latestObservedAtMs
      const stable = learningGapMs <= this.options.maximumLearningGapMs &&
        mseFromSequenceMean(this.cv, features.gray, state.learning) <= this.options.maximumStableMse
      if (!stable) {
        safeDelete(state.learning.accumulated)
        state.learning = undefined
        state.learningRejected = !lateRecovery
        return { campKey: camp.key, state: "unknown", confidence: 0, scoreMargin: 0 }
      }
      appendSequence(this.cv, state.learning, features.gray, gameTimeMs)
      if (state.learning.count < this.options.stableFramesRequired ||
          gameTimeMs - state.learning.firstObservedAtMs < this.options.minimumLearningDurationMs) {
        return { campKey: camp.key, state: "unknown", confidence: 0.35, scoreMargin: 0 }
      }
      const learned = templateFromSequence(this.cv, state.learning)
      safeDelete(state.learning.accumulated)
      state.learning = undefined
      if (variance(this.cv, learned.gray) < this.options.minimumBaselineVariance) {
        safeDelete(learned.gray, learned.gradient)
        state.learningRejected = !lateRecovery
        return { campKey: camp.key, state: "unknown", confidence: 0, scoreMargin: 0 }
      }
      state.baseline = learned
      return {
        campKey: camp.key,
        state: "alive",
        confidence: 0.82,
        scoreMargin: 0.22,
        method: "adaptive_alive_baseline",
      }
    }

    const score = scoreFeatures(this.cv, features, state.baseline)
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
      this.cv,
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

  /** Test/debug seam for a pre-cropped camp patch. Production uses observeAll(). */
  classifyPatch(
    patch: RgbaFrame,
    camp: CampDefinition,
    gameTimeMs?: number,
  ): CampClassification {
    const rgba = frameToMat(this.cv, patch)
    try {
      const features = featuresFromRgba(this.cv, rgba)
      try {
        return this.classifyTemplate(camp.key, features) ??
          this.classifyAdaptive(camp, features, gameTimeMs)
      } finally {
        safeDelete(features.gray, features.gradient)
      }
    } finally {
      rgba.delete()
    }
  }

  observeAll(input: {
    frame: RgbaFrame
    rgba?: any
    gameId: number
    gameTimeMs: number
    occludedCampKeys?: ReadonlySet<CampKey>
  }): CampStateObservation[] {
    const ownsRgba = !input.rgba
    const rgba = input.rgba ?? frameToMat(this.cv, input.frame)
    try {
      return SUMMONERS_RIFT_CAMPS.map((camp) => {
        if (input.occludedCampKeys?.has(camp.key)) {
          return {
            gameId: input.gameId,
            campKey: camp.key,
            gameTimeMs: input.gameTimeMs,
            state: "unknown",
            source: "minimap_cv",
            sourceConfidence: 0,
            frameSequence: input.frame.frameSequence,
            providerVersion: CAMP_VISUAL_DETECTOR_VERSION * 1_000 + SUMMONERS_RIFT_CAMP_MAP_VERSION,
          }
        }
        const features = patchFeatures(this.cv, rgba, camp)
        try {
          const classification = this.classifyTemplate(camp.key, features) ??
            this.classifyAdaptive(camp, features, input.gameTimeMs)
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
        } finally {
          safeDelete(features.gray, features.gradient)
        }
      })
    } finally {
      if (ownsRgba) rgba.delete()
    }
  }

  resetAdaptive() {
    for (const state of this.adaptiveStates.values()) {
      safeDelete(state.learning?.accumulated, state.baseline?.gray, state.baseline?.gradient)
    }
    this.adaptiveStates.clear()
  }

  clearTemplates() {
    for (const templates of this.templates.values()) {
      for (const template of templates) safeDelete(template.gray, template.gradient)
    }
    this.templates.clear()
  }

  reset() {
    this.resetAdaptive()
  }

  close() {
    this.resetAdaptive()
    this.clearTemplates()
  }
}
