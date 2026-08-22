import type {
  CampKey,
  CampStateObservation,
  CampStateTransition,
  CampVisualState,
} from "../../../src/shared/minimap/contracts.js"

interface CandidateState {
  state: CampVisualState
  count: number
  firstObservedAtMs: number
  latestObservedAtMs: number
  latestFrameSequence?: number
  confidenceTotal: number
  latest: CampStateObservation
}

interface ConfirmedState {
  state: CampVisualState
  confidence: number
}

export interface CampStateMachineOptions {
  confirmationFrames: number
  minimumConfidence: number
  minimumConfirmationDurationMs: number
  maximumObservationGapMs: number
  maximumConfirmationWindowMs: number
}

const DEFAULT_OPTIONS: CampStateMachineOptions = {
  confirmationFrames: 3,
  minimumConfidence: 0.72,
  minimumConfirmationDurationMs: 750,
  maximumObservationGapMs: 6_000,
  maximumConfirmationWindowMs: 15_000,
}

/**
 * Confirms only stable, distinct observations. Blank absence requires a prior
 * confirmed alive state; an explicit countdown may establish a mid-respawn
 * state, but cannot become a synthetic clear without the alive transition.
 */
export class CampStateMachine {
  private readonly confirmed = new Map<CampKey, ConfirmedState>()
  private readonly candidates = new Map<CampKey, CandidateState>()
  private readonly options: CampStateMachineOptions

  constructor(options: Partial<CampStateMachineOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  observe(observation: CampStateObservation): CampStateTransition | undefined {
    if (observation.state === "unknown" ||
        observation.sourceConfidence < this.options.minimumConfidence) {
      this.candidates.delete(observation.campKey)
      return undefined
    }
    const current = this.confirmed.get(observation.campKey)
    if (current?.state === observation.state) {
      current.confidence = current.confidence * 0.7 + observation.sourceConfidence * 0.3
      this.candidates.delete(observation.campKey)
      return undefined
    }
    // A blank/dead patch cannot establish a clear without first seeing the
    // camp alive. Riot/Blitz countdown states are stronger evidence: they may
    // establish that capture started mid-respawn, but the coordinator still
    // creates a clear event only for a confirmed alive -> absent transition.
    if (observation.state === "dead" && current?.state !== "alive") {
      this.candidates.delete(observation.campKey)
      return undefined
    }
    if (current?.state === "respawn_soon" && observation.state === "respawn_long") {
      this.candidates.delete(observation.campKey)
      return undefined
    }
    const candidate = this.candidates.get(observation.campKey)
    if (candidate) {
      const frameIsNotNew = observation.frameSequence !== undefined &&
        candidate.latestFrameSequence !== undefined &&
        observation.frameSequence <= candidate.latestFrameSequence
      const timeWentBackwards = observation.gameTimeMs < candidate.latestObservedAtMs
      const duplicateWithoutFrameSequence = observation.frameSequence === undefined &&
        candidate.latestFrameSequence === undefined &&
        observation.gameTimeMs === candidate.latestObservedAtMs
      if (frameIsNotNew || timeWentBackwards || duplicateWithoutFrameSequence) return undefined
    }
    const gapMs = candidate
      ? observation.gameTimeMs - candidate.latestObservedAtMs
      : 0
    const elapsedMs = candidate
      ? observation.gameTimeMs - candidate.firstObservedAtMs
      : 0
    if (!candidate || candidate.state !== observation.state ||
        gapMs > this.options.maximumObservationGapMs ||
        elapsedMs > this.options.maximumConfirmationWindowMs) {
      this.candidates.set(observation.campKey, {
        state: observation.state,
        count: 1,
        firstObservedAtMs: observation.gameTimeMs,
        latestObservedAtMs: observation.gameTimeMs,
        latestFrameSequence: observation.frameSequence,
        confidenceTotal: observation.sourceConfidence,
        latest: observation,
      })
      return undefined
    }
    candidate.count += 1
    candidate.latestObservedAtMs = observation.gameTimeMs
    candidate.latestFrameSequence = observation.frameSequence
    candidate.confidenceTotal += observation.sourceConfidence
    candidate.latest = observation
    if (candidate.count < this.options.confirmationFrames ||
        observation.gameTimeMs - candidate.firstObservedAtMs <
          this.options.minimumConfirmationDurationMs) return undefined
    const confidence = candidate.confidenceTotal / candidate.count
    const previousState = current?.state ?? "unknown"
    this.confirmed.set(observation.campKey, { state: observation.state, confidence })
    this.candidates.delete(observation.campKey)
    return {
      gameId: observation.gameId,
      campKey: observation.campKey,
      previousState,
      state: observation.state,
      observedAtMs: candidate.firstObservedAtMs,
      confirmedAtMs: observation.gameTimeMs,
      source: observation.source,
      confidence,
      providerVersion: observation.providerVersion,
    }
  }

  state(campKey: CampKey) {
    return this.confirmed.get(campKey)
  }

  reset() {
    this.confirmed.clear()
    this.candidates.clear()
  }
}
