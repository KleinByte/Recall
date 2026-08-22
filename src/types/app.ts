export interface StoredSettings {
  isColoredWhenDone: boolean
  showChampionNames: boolean
  sidebarCollapsed: boolean
}

export interface TempoOverlayStatus {
  visible: boolean
  locked: boolean
  shortcutRegistered: boolean
}

/** Status and bounded evidence sent to the opt-in minimap CV overlay. */
export interface MinimapVisionDebugStatus {
  visible: boolean
  locked: boolean
}

export interface MinimapVisionDebugSnapshot {
  enabled: boolean
  state: "idle" | "starting" | "capturing" | "degraded" | "failed"
  updatedAt: number
  frameSequence?: number
  gameTimeMs?: number
  imageRgba?: Uint8Array
  imageWidth?: number
  imageHeight?: number
  calibration?: {
    sourceWidth: number
    sourceHeight: number
    minimapRect: { x: number; y: number; width: number; height: number }
    innerMapRect: { x: number; y: number; width: number; height: number }
    placement: "left" | "right"
    displayScaleFactor: number
    confidence: number
    calibrationVersion: number
  }
  proposals: Array<{
    team: "ally" | "enemy"
    x: number
    y: number
    radius: number
    confidence: number
    diameterPx?: number
    aspectRatio?: number
    fillRatio?: number
    proposalSource?: "model" | "component" | "hough_circle" | "edge_circle"
    modelConfidence?: number
    ringSupport?: number
    ringSectors?: number
    identityCandidate?: string
    identityScore?: number
    identityMargin?: number
    identityAccepted?: boolean
  }>
  detections: Array<{ championName: string; team: "ally" | "enemy"; x: number; y: number; confidence: number }>
  confirmed: Array<{ championName: string; team: "ally" | "enemy"; x: number; y: number; confidence: number; continuity?: "continuous" | "relocation" }>
  camps: Array<{ campKey: string; state: string; confidence: number }>
  health: {
    achievedFps: number
    captureAttempts: number
    processedFrames: number
    rejectedFrames: number
    calibrationFailures: number
    startupAttempts?: number
    nextRetryAt?: number
    eligibilityReason?: "eligible" | "phase_not_in_progress" | "game_id_unavailable" |
      "map_not_summoners_rift" | "classification_pending"
    backendState?: "idle" | "starting" | "healthy" | "unavailable" | "failed"
    sourceId?: string
    sourceName?: string
    discoveredWindowCount?: number
    candidateSourceCount?: number
    candidateSourceNames?: string[]
    sourceDiscoveryAttempts?: number
    captureMode?: "display" | "legacy"
    captureStage?: string
    frameDeliveryMode?: "paint" | "snapshot"
    paintEventCount?: number
    paintSizeMismatchCount?: number
    snapshotCaptureCount?: number
    lastPaintSize?: string
    rendererFrameSerial?: number
    lastErrorDetail?: string
    rosterCount?: number
    templateCount?: number
    localTemplateAvailable?: boolean
    templateErrorCode?: string
    calibrationCandidatesEvaluated?: number
    calibrationCandidatesValid?: number
    calibrationBestScore?: number
    calibrationFailureReason?: string
    calibrationVariance?: number
    calibrationEdgeDensity?: number
    calibrationColoredRatio?: number
    visionEngine?: "opencv_js"
    opencvVersion?: string
    visionWorkerState?: "idle" | "initializing" | "ready" | "failed" | "closed"
    visionWorkerRestarts?: number
    visionProcessingMs?: number
    visionChampionMs?: number
    visionCampMs?: number
    inferredCampClears?: number
    clockSampleCount?: number
    clockReady?: boolean
    lastErrorCode?: string
    lastEvidenceErrorCode?: string
  }
}
