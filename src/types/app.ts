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
  imageData?: string
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
  proposals: Array<{ team: "ally" | "enemy"; x: number; y: number; radius: number; confidence: number }>
  detections: Array<{ championName: string; team: "ally" | "enemy"; x: number; y: number; confidence: number }>
  confirmed: Array<{ championName: string; team: "ally" | "enemy"; x: number; y: number; confidence: number; continuity?: "continuous" | "relocation" }>
  camps: Array<{ campKey: string; state: string; confidence: number }>
  health: {
    achievedFps: number
    captureAttempts: number
    processedFrames: number
    rejectedFrames: number
    calibrationFailures: number
    lastErrorCode?: string
  }
}
