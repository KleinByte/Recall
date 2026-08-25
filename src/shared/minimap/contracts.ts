export type NormalizedPoint = {
  /** West to east, inclusive. */
  x: number
  /** North to south, inclusive. */
  y: number
}

export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

export interface RgbaFrame {
  width: number
  height: number
  /** Tightly packed RGBA bytes. */
  data: Uint8Array
  capturedMonotonicMs: number
  frameSequence: number
}

export type MinimapPlacement = "left" | "right"

export interface MinimapCalibration {
  sourceWidth: number
  sourceHeight: number
  minimapRect: PixelRect
  innerMapRect: PixelRect
  placement: MinimapPlacement
  displayScaleFactor: number
  confidence: number
  calibrationVersion: number
}

export type ChampionVisionTeam = "ally" | "enemy"

export interface ChampionTemplateDescriptor {
  participantKey: string
  championName: string
  team: ChampionVisionTeam
  isLocal: boolean
}

export interface ChampionPositionObservation {
  gameId: number
  participantKey: string
  championName: string
  team: ChampionVisionTeam
  isLocal: boolean
  gameTimeMs: number
  position: NormalizedPoint
  source: "minimap_cv"
  identityConfidence: number
  positionConfidence: number
  frameSequence: number
  detectorVersion: number
  /**
   * A confirmed relocation starts a new visible run. Both endpoints were
   * rendered, but the pixels do not establish a traversed route between them.
   */
  continuity?: "continuous" | "relocation"
}

export type ChampionTrackState =
  | "visible"
  | "temporarily_occluded"
  | "not_visible"
  | "dead"
  | "capture_unavailable"

export interface ChampionTrackSnapshot {
  participantKey: string
  championName: string
  team: ChampionVisionTeam
  state: ChampionTrackState
  /** Present only while the marker is actually observed in the current frame. */
  position?: NormalizedPoint
  /** Historical last-seen data is observable; it is never a predicted position. */
  lastObservedPosition?: NormalizedPoint
  lastObservedGameTimeMs?: number
  confidence: number
}

export type CampKey =
  | "west_blue"
  | "west_gromp"
  | "west_wolves"
  | "west_raptors"
  | "west_red"
  | "west_krugs"
  | "east_blue"
  | "east_gromp"
  | "east_wolves"
  | "east_raptors"
  | "east_red"
  | "east_krugs"
  | "north_scuttle"
  | "south_scuttle"
  | "dragon"
  | "baron"
  | "rift_herald"
  | "void_grubs"

export type CampVisualState =
  | "alive"
  | "dead"
  | "respawn_long"
  | "respawn_soon"
  | "unknown"

export type CampTelemetrySource =
  | "minimap_cv"
  | "live_client_inference"
  | "manual"

export interface CampStateObservation {
  gameId: number
  campKey: CampKey
  gameTimeMs: number
  state: CampVisualState
  source: CampTelemetrySource
  sourceConfidence: number
  frameSequence?: number
  providerVersion: number
}

export interface CampStateTransition {
  gameId: number
  campKey: CampKey
  previousState: CampVisualState
  state: CampVisualState
  observedAtMs: number
  confirmedAtMs: number
  source: CampTelemetrySource
  confidence: number
  providerVersion: number
}

export interface CampClearEvidence {
  campTransition: boolean
  localPositionObserved: boolean
  localPositionDistance?: number
  neutralMinionKillDelta?: number
  creepScoreDelta?: number
  goldResidual?: number
  expectedNextCamp?: boolean
  visibleAlliesNearCamp?: number
  visibleEnemiesNearCamp?: number
  localPlayerDead?: boolean
  transitionConfidence: number
  evidenceAgeMs?: number
}

export type CampClearAttribution = "local" | "other" | "uncertain"

export interface CampClearEvent {
  gameId: number
  puuid: string
  campKey: CampKey
  clearedAtMs: number
  respawnAtMs?: number
  source: CampTelemetrySource
  sourceConfidence: number
  attribution: CampClearAttribution
  attributionConfidence: number
  evidence: CampClearEvidence
  routeIndex?: number
  algorithmVersion: number
}

export type PathSegmentKind =
  | "observed"
  | "interpolated"
  | "inferred"
  | "unknown"

export interface PathSegment {
  gameId: number
  participantKey: string
  startTimeMs: number
  endTimeMs: number
  kind: PathSegmentKind
  points: NormalizedPoint[]
  /** Exact sample time for each point when the reconstructed artifact retains it. */
  pointTimesMs?: number[]
  confidence: number
  uncertaintyRadius?: number[]
  inferenceMode?: "smoothed_postgame"
  modelVersion: number
}

export const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value))

export function normalizedPoint(x: number, y: number): NormalizedPoint {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("normalized_point_not_finite")
  }
  return { x: clamp(x), y: clamp(y) }
}

export function normalizedDistance(left: NormalizedPoint, right: NormalizedPoint) {
  return Math.hypot(left.x - right.x, left.y - right.y)
}
