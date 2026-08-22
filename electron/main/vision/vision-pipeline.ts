import type {
  CampKey,
  MinimapCalibration,
  RgbaFrame,
} from "../../../src/shared/minimap/contracts.js"
import { normalizedDistance } from "../../../src/shared/minimap/contracts.js"
import { CAMP_BY_KEY } from "../jungle/camp-map.js"
import type { CampVisualTemplateAsset } from "../jungle/camp-visual-detector.js"
import {
  calibrationMatchesHints,
  validateCalibration,
  type MinimapCalibrationHints,
} from "../minimap/calibration.js"
import type { ChampionMarkerTemplate } from "../minimap/champion-marker-detector.js"
import type {
  VisionCalibrationResult,
  VisionFrameResult,
  VisionRuntimeInfo,
} from "./contracts.js"
import {
  evaluateMinimapVisualCv,
  OpenCvMinimapLocator,
} from "./opencv-calibration.js"
import { OpenCvCampDetector } from "./opencv-camp-detector.js"
import { OpenCvChampionDetector } from "./opencv-champion-detector.js"
import type { LearnedChampionDetectionResult } from "./onnx-champion-detector.js"
import {
  cropAndResize,
  frameToMat,
  matToFrame,
  safeDelete,
  type OpenCv,
} from "./opencv-runtime.js"

function opencvVersion(cv: OpenCv) {
  const direct = cv.CV_VERSION ?? cv.VERSION ?? cv.version
  if (typeof direct === "string" && direct.trim()) return direct.trim()
  try {
    const info = String(cv.getBuildInformation?.() ?? "")
    const match = info.match(/OpenCV\s+([0-9]+(?:\.[0-9]+){1,3}(?:[-+\w.]*)?)/i)
    if (match?.[1]) return match[1]
  } catch { /* build information is diagnostic only */ }
  return "unknown"
}

export class VisionPipeline {
  readonly runtime: VisionRuntimeInfo
  private readonly locator: OpenCvMinimapLocator
  private readonly champions: OpenCvChampionDetector
  private readonly camps: OpenCvCampDetector
  private activeSessionId: string | undefined
  private activeGameId: number | undefined

  constructor(private readonly cv: OpenCv, private readonly canonicalSize: number) {
    this.locator = new OpenCvMinimapLocator(cv, canonicalSize)
    this.champions = new OpenCvChampionDetector(cv)
    this.camps = new OpenCvCampDetector(cv)
    this.runtime = { engine: "opencv_js", opencvVersion: opencvVersion(cv) }
  }

  setRoster(sessionId: string, gameId: number, templates: ChampionMarkerTemplate[]) {
    if (this.activeSessionId !== sessionId || this.activeGameId !== gameId) {
      this.camps.resetAdaptive()
    }
    this.activeSessionId = sessionId
    this.activeGameId = gameId
    this.champions.setTemplates(templates)
  }

  setCampTemplates(templates: CampVisualTemplateAsset[]) {
    this.camps.setTemplates(templates)
  }

  calibrate(input: {
    sessionId: string
    frame: RgbaFrame
    hints: MinimapCalibrationHints
    calibration?: MinimapCalibration
  }): VisionCalibrationResult {
    const cached = input.calibration
    if (cached && validateCalibration(cached, input.frame.width, input.frame.height) &&
        calibrationMatchesHints(cached, input.hints)) {
      const source = frameToMat(this.cv, input.frame)
      try {
        const minimapMat = cropAndResize(
          this.cv,
          source,
          cached.innerMapRect,
          this.canonicalSize,
          this.canonicalSize,
        )
        try {
          return {
            calibration: cached,
            diagnostics: {
              evaluatedCandidates: 0,
              visuallyValidCandidates: 1,
              bestScore: cached.confidence,
              bestPlacement: cached.placement,
            },
            minimap: matToFrame(
              minimapMat,
              input.frame.capturedMonotonicMs,
              input.frame.frameSequence,
            ),
            visual: evaluateMinimapVisualCv(this.cv, minimapMat),
          }
        } finally {
          minimapMat.delete()
        }
      } finally {
        source.delete()
      }
    }

    const located = this.locator.locate(input.frame, input.hints)
    return {
      ...located,
      diagnostics: this.locator.getDiagnostics(),
    }
  }

  processFrame(input: {
    sessionId: string
    gameId: number
    gameTimeMs: number
    frame: RgbaFrame
    includeCamps: boolean
    includeVisualValidation?: boolean
    learned?: LearnedChampionDetectionResult
  }): VisionFrameResult {
    if (this.activeSessionId !== input.sessionId || this.activeGameId !== input.gameId) {
      throw new Error("vision_stale_session")
    }
    const started = performance.now()
    const frame = this.normalize(input.frame)
    // Convert the transferred frame into WASM memory once. Visual validation,
    // champion detection, and camp detection otherwise each copied the same
    // 409 KiB canonical frame into a separate OpenCV Mat.
    const rgba = frameToMat(this.cv, frame)
    try {
      let visual: VisionFrameResult["visual"]
      let visualValidationMs = 0
      if (input.includeVisualValidation !== false) {
        const visualStarted = performance.now()
        visual = evaluateMinimapVisualCv(this.cv, rgba)
        visualValidationMs = performance.now() - visualStarted
      }

      const championStarted = performance.now()
      const champion = this.champions.detect({
        frame,
        rgba,
        gameId: input.gameId,
        gameTimeMs: input.gameTimeMs,
        learnedDetections: input.learned?.detections,
      })
      const championMs = performance.now() - championStarted + (input.learned?.inferenceMs ?? 0)

      let campObservations: VisionFrameResult["campObservations"] = []
      const campStarted = performance.now()
      if (input.includeCamps) {
        const occludedCampKeys = new Set<CampKey>()
        for (const camp of CAMP_BY_KEY.values()) {
          if (champion.proposals.some((proposal) =>
            proposal.identityAccepted === true &&
            normalizedDistance(proposal.center, camp.center) <= camp.patchRadius + proposal.radius)) {
            occludedCampKeys.add(camp.key)
          }
        }
        campObservations = this.camps.observeAll({
          frame,
          rgba,
          gameId: input.gameId,
          gameTimeMs: input.gameTimeMs,
          occludedCampKeys,
        })
      }
      const campMs = performance.now() - campStarted

      return {
        sessionId: input.sessionId,
        gameId: input.gameId,
        frameSequence: frame.frameSequence,
        frame,
        visual,
        markerProposals: champion.proposals,
        championObservations: champion.observations,
        campObservations,
        metrics: {
          totalMs: performance.now() - started + (input.learned?.inferenceMs ?? 0),
          visualValidationMs,
          championMs,
          campMs,
        },
      }
    } finally {
      rgba.delete()
    }
  }

  reset(sessionId?: string) {
    if (!sessionId || sessionId === this.activeSessionId) {
      this.activeSessionId = undefined
      this.activeGameId = undefined
      this.champions.clearTemplates()
      this.camps.resetAdaptive()
    }
  }

  close() {
    this.champions.close()
    this.camps.close()
  }

  private normalize(frame: RgbaFrame) {
    if (frame.width === this.canonicalSize && frame.height === this.canonicalSize) return frame
    const source = frameToMat(this.cv, frame)
    const resized = new this.cv.Mat()
    try {
      this.cv.resize(
        source,
        resized,
        new this.cv.Size(this.canonicalSize, this.canonicalSize),
        0,
        0,
        this.cv.INTER_LINEAR,
      )
      return matToFrame(resized, frame.capturedMonotonicMs, frame.frameSequence)
    } finally {
      safeDelete(source, resized)
    }
  }
}
