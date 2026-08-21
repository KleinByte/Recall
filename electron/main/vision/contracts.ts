import type {
  CampStateObservation,
  ChampionPositionObservation,
  MinimapCalibration,
  RgbaFrame,
} from "../../../src/shared/minimap/contracts.js"
import type {
  MinimapCalibrationHints,
  MinimapLocatorDiagnostics,
  MinimapVisualEvidence,
} from "../minimap/calibration.js"
import type {
  ChampionMarkerProposalFootprint,
  ChampionMarkerTemplate,
} from "../minimap/champion-marker-detector.js"
import type { CampVisualTemplateAsset } from "../jungle/camp-visual-detector.js"

export interface VisionMetrics {
  totalMs: number
  visualValidationMs: number
  championMs: number
  campMs: number
}

export interface VisionRuntimeInfo {
  engine: "opencv_js"
  opencvVersion: string
}

export interface VisionFrameResult {
  sessionId: string
  gameId: number
  frameSequence: number
  /** Canonical minimap frame. Its transferred buffer is returned to main. */
  frame: RgbaFrame
  /** Present only on the coordinator's bounded visual-validation cadence. */
  visual?: MinimapVisualEvidence
  markerProposals: ChampionMarkerProposalFootprint[]
  championObservations: ChampionPositionObservation[]
  campObservations: CampStateObservation[]
  metrics: VisionMetrics
}

export interface VisionCalibrationResult {
  calibration?: MinimapCalibration
  diagnostics: MinimapLocatorDiagnostics
  minimap?: RgbaFrame
  visual?: MinimapVisualEvidence
}

export type VisionWorkerTask =
  | { task: "initialize"; canonicalSize: number }
  | {
      task: "set-roster"
      sessionId: string
      gameId: number
      templates: ChampionMarkerTemplate[]
    }
  | { task: "set-camp-templates"; templates: CampVisualTemplateAsset[] }
  | {
      task: "calibrate"
      sessionId: string
      frame: RgbaFrame
      hints: MinimapCalibrationHints
      calibration?: MinimapCalibration
    }
  | {
      task: "process-frame"
      sessionId: string
      gameId: number
      gameTimeMs: number
      frame: RgbaFrame
      includeCamps: boolean
      includeVisualValidation?: boolean
    }
  | { task: "reset"; sessionId?: string }
  | { task: "ping" }

export type VisionWorkerRequest = VisionWorkerTask & { id: number }
export type VisionWorkerResponse =
  | { id: number; ok: true; task: VisionWorkerTask["task"]; result: unknown }
  | {
      id: number
      ok: false
      task: VisionWorkerTask["task"]
      error: { message: string; stack?: string }
    }
