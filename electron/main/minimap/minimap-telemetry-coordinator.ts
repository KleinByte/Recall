import { createHash } from "node:crypto"
import type {
  CampClearEvent,
  CampKey,
  CampStateObservation,
  ChampionTrackSnapshot,
  MinimapCalibration,
} from "../../../src/shared/minimap/contracts.js"
import { normalizedDistance } from "../../../src/shared/minimap/contracts.js"
import { MinimapTelemetryRepository } from "../database/minimap-telemetry-repo.js"
import { CAMP_BY_KEY } from "../jungle/camp-map.js"
import { CampAttributionEngine } from "../jungle/camp-attribution-engine.js"
import { CampStateMachine } from "../jungle/camp-state-machine.js"
import { CampTemplateBank, CampVisualDetector } from "../jungle/camp-visual-detector.js"
import {
  JungleEvidenceAccumulator,
  readJungleEvidenceSample,
  type GameClientRequest,
  type JungleEvidenceDelta,
} from "../jungle/live-jungle-evidence.js"
import {
  calibrationMatchesHints,
  createCalibrationContextSignature,
  evaluateMinimapVisual,
  MinimapLocator,
  validateCalibration,
  type MinimapCalibrationHints,
} from "./calibration.js"
import type { MinimapCaptureBackend } from "./capture-backend.js"
import {
  CHAMPION_MARKER_DETECTOR_VERSION,
  ChampionMarkerDetector,
  type ChampionMarkerProposalFootprint,
  type ChampionMarkerTemplate,
} from "./champion-marker-detector.js"
import { ChampionTracker } from "./champion-tracker.js"
import { GameClockSynchronizer } from "./game-clock-synchronizer.js"
import { cropFrame, resizeFrameBilinear } from "./image-ops.js"
import { MinimapDebugSampler } from "./minimap-debug-sampler.js"
import type { MinimapDebugSample } from "./minimap-debug-sampler.js"

export interface MinimapTelemetryContext {
  phase: "Idle" | "ChampSelect" | "InProgress"
  gameId?: number
  mapNumber?: number
  gameMode?: string
  gameType?: string
  captureClassificationReady?: boolean
  isPracticeTool?: boolean
  debugEnabled?: boolean
  debugOverlayEnabled?: boolean
  puuid: string
  localRiotId?: string
  localParticipantKey?: string
  deadParticipantKeys: string[]
  routePlan?: CampKey[]
}

export interface MinimapTelemetryCoordinatorOptions {
  targetFps: number
  canonicalSize: number
  clockPollIntervalMs: number
  campPollIntervalMs: number
  calibrationValidationIntervalMs: number
  maximumConsecutiveFailures: number
}

const DEFAULT_OPTIONS: MinimapTelemetryCoordinatorOptions = {
  targetFps: 8,
  canonicalSize: 320,
  clockPollIntervalMs: 500,
  campPollIntervalMs: 500,
  calibrationValidationIntervalMs: 2_000,
  maximumConsecutiveFailures: 12,
}

export interface MinimapTelemetryHealth {
  state: "idle" | "starting" | "capturing" | "degraded" | "failed"
  processedFrames: number
  droppedFrames: number
  captureAttempts: number
  rejectedFrames: number
  confirmedObservations: number
  averageProcessingMs: number
  achievedFps: number
  p95FrameGapMs: number
  maximumFrameGapMs: number
  calibrationFailures: number
  calibrationConfidence?: number
  lastErrorCode?: string
  lastEvidenceErrorCode?: string
  debugSampleCount?: number
  debugErrorCode?: string
}

export interface MinimapDebugFrameEvent {
  gameId: number
  frame: import("../../../src/shared/minimap/contracts.js").RgbaFrame
  sample: MinimapDebugSample
  health: MinimapTelemetryHealth
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  if (milliseconds <= 0 || signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(done, milliseconds)
    function done() {
      clearTimeout(timeout)
      signal.removeEventListener("abort", done)
      resolve()
    }
    signal.addEventListener("abort", done, { once: true })
  })
}

function percentile(values: number[], quantile: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * quantile) - 1,
  ))
  return sorted[index]
}

interface TrackHistorySample {
  gameTimeMs: number
  tracks: ChampionTrackSnapshot[]
  deadParticipantKeys: string[]
}

interface EvidenceHistorySample {
  gameTimeMs: number
  evidence: JungleEvidenceDelta
}

const CAMP_ALIGNMENT_HISTORY_MS = 30_000
const MAXIMUM_TRACK_ALIGNMENT_MS = 2_000
const MAXIMUM_EVIDENCE_ALIGNMENT_MS = 2_000

export class MinimapTelemetryCoordinator {
  private readonly options: MinimapTelemetryCoordinatorOptions
  private readonly clock = new GameClockSynchronizer()
  private readonly evidence = new JungleEvidenceAccumulator()
  private readonly campStates = new CampStateMachine()
  private readonly attribution = new CampAttributionEngine()
  private readonly markerDetector = new ChampionMarkerDetector()
  private readonly championTracker = new ChampionTracker()
  private readonly locator = new MinimapLocator()
  private readonly campDetector: CampVisualDetector
  private context?: MinimapTelemetryContext
  private calibration?: MinimapCalibration
  private calibrationHints: MinimapCalibrationHints = {}
  private templates: ChampionMarkerTemplate[] = []
  private abort?: AbortController
  private loopTask?: Promise<void>
  private evidenceTask?: Promise<void>
  private stopping?: Promise<void>
  private captureSessionId?: string
  // A failed startup is terminal for the current game. The game-client
  // poller can report the same InProgress context repeatedly; retrying here
  // would create a new zero-frame DB session and Chromium capture window on
  // every poll. A different game (or leaving InProgress) clears the latch.
  private failedStartGameId?: number
  private activeSourceFingerprint?: string
  private latestTracks: ChampionTrackSnapshot[] = []
  private readonly trackHistory: TrackHistorySample[] = []
  private readonly evidenceHistory: EvidenceHistorySample[] = []
  private lastCampObservations: CampStateObservation[] = []
  private lastCampPollMs = Number.NEGATIVE_INFINITY
  private lastCalibrationValidationMs = Number.NEGATIVE_INFINITY
  private calibrationValidationFailures = 0
  private localClearCount = 0
  private consecutiveFailures = 0
  private persistedCalibrationId?: string
  private sessionStartedMonotonicMs = 0
  private sessionEndedMonotonicMs?: number
  private lastCapturedMonotonicMs?: number
  private readonly frameGapSamples: number[] = []
  private debugSamplingActive = false
  private health: MinimapTelemetryHealth = this.emptyHealth()

  constructor(
    private readonly backend: MinimapCaptureBackend,
    private readonly gameClient: GameClientRequest,
    private readonly repository: MinimapTelemetryRepository,
    campTemplates = new CampTemplateBank(),
    options: Partial<MinimapTelemetryCoordinatorOptions> = {},
    private readonly debugSampler?: MinimapDebugSampler,
    private readonly onDebugFrame?: (event: MinimapDebugFrameEvent) => void,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.campDetector = new CampVisualDetector(campTemplates)
  }

  setTemplates(templates: ChampionMarkerTemplate[]) {
    this.templates = [...templates]
  }

  setCalibration(calibration: MinimapCalibration | undefined) {
    this.calibration = calibration && calibrationMatchesHints(calibration, this.calibrationHints)
      ? calibration
      : undefined
  }

  setCalibrationHints(hints: MinimapCalibrationHints = {}) {
    this.calibrationHints = { ...hints }
    if (this.calibration && !calibrationMatchesHints(this.calibration, this.calibrationHints)) {
      this.calibration = undefined
    }
  }

  async updateContext(context: MinimapTelemetryContext) {
    this.context = context
    if (
      this.failedStartGameId !== undefined &&
      (context.phase !== "InProgress" || context.gameId !== this.failedStartGameId)
    ) {
      this.failedStartGameId = undefined
    }
    const eligible = context.phase === "InProgress" &&
      context.gameId !== undefined &&
      context.mapNumber === 11 &&
      context.captureClassificationReady !== false &&
      !context.isPracticeTool
    if (eligible && !this.abort && context.gameId !== this.failedStartGameId) await this.start()
    if (eligible && this.abort && context.debugEnabled && !this.debugSamplingActive) {
      this.debugSampler?.start(context.gameId!)
      this.debugSamplingActive = Boolean(this.debugSampler)
    }
    if (this.abort && this.debugSamplingActive && !context.debugEnabled) {
      // Stop admitting new samples before awaiting the pending write queue.
      this.debugSamplingActive = false
      await this.debugSampler?.finish().catch(() => undefined)
    }
    if (!eligible && this.abort) await this.stop("complete")
  }

  async start() {
    if (this.stopping) await this.stopping
    const context = this.context
    if (!context?.gameId || context.phase !== "InProgress" ||
        context.captureClassificationReady === false ||
        context.isPracticeTool || this.abort) return
    this.abort = new AbortController()
    this.resetSessionState()
    this.sessionStartedMonotonicMs = performance.now()
    this.health = this.emptyHealth("starting")
    this.captureSessionId = this.repository.startCaptureSession({
      gameId: context.gameId,
      puuid: context.puuid,
      captureBackend: this.backend.id,
      detectorVersion: CHAMPION_MARKER_DETECTOR_VERSION,
      debugRetention: context.debugEnabled === true,
    })
    if (context.debugEnabled) {
      this.debugSampler?.start(context.gameId)
      this.debugSamplingActive = Boolean(this.debugSampler)
    }

    try {
      await this.backend.start()
      const signal = this.abort.signal
      this.health.state = "capturing"
      this.evidenceTask = this.evidenceLoop(signal)
      this.loopTask = this.loop(signal)
      void this.loopTask.catch((error) => {
        this.health = {
          ...this.health,
          state: "failed",
          lastErrorCode: error instanceof Error ? error.message : "capture_loop_failed",
        }
        void this.stop("failed")
      })
    } catch (error) {
      const code = error instanceof Error ? error.message : "capture_start_failed"
      this.health = { ...this.health, state: "failed", lastErrorCode: code }
      this.failedStartGameId = context.gameId
      const abort = this.abort
      this.abort = undefined
      abort?.abort()
      await this.backend.stop().catch(() => undefined)
      await this.debugSampler?.finish().catch(() => undefined)
      this.debugSamplingActive = false
      this.sessionEndedMonotonicMs = performance.now()
      this.finishCaptureSession("capture_unavailable")
    }
  }

  stop(status: "complete" | "capture_unavailable" | "calibration_required" | "failed" | "aborted") {
    if (this.stopping) return this.stopping
    if (!this.abort && !this.loopTask && !this.evidenceTask &&
        !this.captureSessionId && !this.debugSamplingActive) {
      return Promise.resolve()
    }
    this.stopping = this.performStop(status).finally(() => {
      this.stopping = undefined
    })
    return this.stopping
  }

  getHealth() {
    const quality = this.qualityMetrics()
    const debug = this.debugSampler?.getHealth()
    return {
      ...this.health,
      ...quality,
      ...(debug ? {
        debugSampleCount: debug.sampleCount,
        debugErrorCode: debug.lastError,
      } : {}),
    }
  }

  /** Allows an explicit telemetry disable/enable cycle to retry startup. */
  resetFailedStart() {
    this.failedStartGameId = undefined
  }

  private async performStop(
    status: "complete" | "capture_unavailable" | "calibration_required" | "failed" | "aborted",
  ) {
    const abort = this.abort
    this.abort = undefined
    abort?.abort()
    const loopTask = this.loopTask
    const evidenceTask = this.evidenceTask
    await Promise.all([
      loopTask?.catch(() => undefined),
      evidenceTask?.catch(() => undefined),
    ])
    if (this.loopTask === loopTask) this.loopTask = undefined
    if (this.evidenceTask === evidenceTask) this.evidenceTask = undefined
    try {
      await this.backend.stop()
    } catch (error) {
      if (status !== "complete" && status !== "aborted" && !this.health.lastErrorCode) {
        this.health.lastErrorCode = error instanceof Error
          ? error.message
          : "capture_stop_failed"
      }
    }
    await this.debugSampler?.finish().catch(() => undefined)
    this.debugSamplingActive = false
    this.sessionEndedMonotonicMs = performance.now()
    this.finishCaptureSession(status)
    this.repository.flushAll()
    this.calibration = undefined
    this.activeSourceFingerprint = undefined
    this.persistedCalibrationId = undefined
    this.health = {
      ...this.health,
      ...this.qualityMetrics(),
      state: status === "complete" || status === "aborted" ? "idle" : "failed",
      ...(status === "complete" || status === "aborted" ? { lastErrorCode: undefined } : {}),
    }
  }

  private finishCaptureSession(
    status: "complete" | "capture_unavailable" | "calibration_required" | "failed" | "aborted",
  ) {
    const captureSessionId = this.captureSessionId
    this.captureSessionId = undefined
    if (!captureSessionId) return
    const quality = this.qualityMetrics()
    this.repository.finishCaptureSession({
      sessionId: captureSessionId,
      status,
      processedFrames: this.health.processedFrames,
      droppedFrames: this.health.droppedFrames,
      averageProcessingMs: this.health.averageProcessingMs,
      captureAttempts: this.health.captureAttempts,
      rejectedFrames: this.health.rejectedFrames,
      achievedFps: quality.achievedFps,
      p95FrameGapMs: quality.p95FrameGapMs,
      maximumFrameGapMs: quality.maximumFrameGapMs,
      confirmedObservations: this.health.confirmedObservations,
      terminalErrorCode: status === "complete" || status === "aborted"
        ? undefined
        : this.health.lastErrorCode,
    })
  }

  private async loop(signal: AbortSignal) {
    const intervalMs = 1_000 / this.options.targetFps
    let nextDeadline = performance.now()
    while (!signal.aborted && this.abort) {
      const startedAt = performance.now()
      this.health.captureAttempts += 1
      try {
        await this.processFrame()
        this.consecutiveFailures = 0
        this.health.state = "capturing"
        this.health.lastErrorCode = undefined
      } catch (error) {
        if (signal.aborted) return
        this.health.rejectedFrames += 1
        this.consecutiveFailures += 1
        this.health.lastErrorCode = error instanceof Error ? error.message : "capture_frame_failed"
        this.health.state = "degraded"
        if (this.consecutiveFailures >= this.options.maximumConsecutiveFailures) {
          const calibrationFailure = this.health.lastErrorCode === "minimap_calibration_required" ||
            this.health.lastErrorCode === "minimap_visual_validation_failed"
          void this.stop(calibrationFailure ? "calibration_required" : "capture_unavailable")
          return
        }
      } finally {
        const processingMs = performance.now() - startedAt
        this.health.averageProcessingMs +=
          (processingMs - this.health.averageProcessingMs) / this.health.captureAttempts
      }

      nextDeadline += intervalMs
      const now = performance.now()
      if (now > nextDeadline) {
        const missedSlots = Math.floor((now - nextDeadline) / intervalMs) + 1
        this.health.droppedFrames += missedSlots
        nextDeadline += missedSlots * intervalMs
      }
      await abortableDelay(nextDeadline - performance.now(), signal)
    }
  }

  /** Live Client failures never discard an otherwise valid captured frame. */
  private async evidenceLoop(signal: AbortSignal) {
    let nextDeadline = performance.now()
    while (!signal.aborted && this.abort) {
      const requestStarted = performance.now()
      try {
        const sample = await readJungleEvidenceSample(
          this.gameClient,
          requestStarted,
          this.context?.localRiotId,
        )
        const requestEnded = performance.now()
        const midpoint = (requestStarted + requestEnded) / 2
        this.clock.addSample(midpoint, sample.gameTimeMs / 1_000)
        const evidence = this.evidence.update({
          ...sample,
          capturedMonotonicMs: midpoint,
        })
        if (evidence) this.recordEvidenceHistory(sample.gameTimeMs, evidence)
        this.health.lastEvidenceErrorCode = undefined
      } catch (error) {
        if (!signal.aborted) {
          this.health.lastEvidenceErrorCode = error instanceof Error
            ? error.message
            : "live_evidence_failed"
        }
      }
      nextDeadline += this.options.clockPollIntervalMs
      if (performance.now() > nextDeadline) nextDeadline = performance.now()
      await abortableDelay(nextDeadline - performance.now(), signal)
    }
  }

  private async processFrame() {
    const context = this.context
    if (!context?.gameId || context.phase !== "InProgress" ||
        context.captureClassificationReady === false || context.isPracticeTool) return
    const gameId = context.gameId
    const frame = await this.backend.captureFrame()
    this.recordFrameGap(frame.capturedMonotonicMs)
    const sourceFingerprint = this.sourceFingerprint(frame.width, frame.height)
    if (this.activeSourceFingerprint !== sourceFingerprint) {
      this.activeSourceFingerprint = sourceFingerprint
      this.calibration = undefined
      this.persistedCalibrationId = undefined
      this.lastCalibrationValidationMs = Number.NEGATIVE_INFINITY
      this.calibrationValidationFailures = 0
    }

    let calibration = this.calibration
    const calibrationIsValid = calibration &&
      validateCalibration(calibration, frame.width, frame.height) &&
      calibrationMatchesHints(calibration, this.calibrationHints)
    if (!calibrationIsValid) {
      calibration = this.repository.findCalibration(
        sourceFingerprint,
        frame.width,
        frame.height,
      )
      if (!calibration || !validateCalibration(calibration, frame.width, frame.height) ||
          !calibrationMatchesHints(calibration, this.calibrationHints)) {
        calibration = this.locator.locate(frame, this.calibrationHints)
      }
      if (!calibration) throw new Error("minimap_calibration_required")
      this.calibration = calibration
      this.lastCalibrationValidationMs = Number.NEGATIVE_INFINITY
    }
    if (!calibration) throw new Error("minimap_calibration_required")

    if (this.calibrationValidationFailures > 0 ||
        frame.capturedMonotonicMs - this.lastCalibrationValidationMs >=
        this.options.calibrationValidationIntervalMs) {
      const visual = evaluateMinimapVisual(resizeFrameBilinear(
        cropFrame(frame, calibration.minimapRect),
        96,
        96,
      ))
      this.lastCalibrationValidationMs = frame.capturedMonotonicMs
      if (!visual.valid) {
        this.calibrationValidationFailures += 1
        this.health.calibrationFailures += 1
        if (this.calibrationValidationFailures >= 2) this.calibration = undefined
        throw new Error("minimap_visual_validation_failed")
      }
      this.calibrationValidationFailures = 0
    }

    this.persistCalibration(sourceFingerprint, calibration)
    this.health.calibrationConfidence = calibration.confidence
    const minimap = resizeFrameBilinear(
      cropFrame(frame, calibration.innerMapRect),
      this.options.canonicalSize,
      this.options.canonicalSize,
    )
    const estimate = this.clock.estimate(frame.capturedMonotonicMs)
    if (!estimate) {
      this.health.rejectedFrames += 1
      return
    }
    const gameTimeMs = estimate.gameTimeMs

    const detections = this.markerDetector.detect({
      frame: minimap,
      templates: this.templates,
      gameId,
      gameTimeMs,
    })
    const markerProposals = this.markerDetector.getProposalFootprints()
    this.latestTracks = this.championTracker.update({
      gameTimeMs,
      observations: detections,
      deadParticipantKeys: context.deadParticipantKeys,
      captureAvailable: true,
    })
    this.recordTrackHistory(gameTimeMs, this.latestTracks, context.deadParticipantKeys)
    const confirmed = this.championTracker.getConfirmedObservations()
    for (const observation of confirmed) {
      this.repository.appendChampionObservation(context.puuid, observation)
    }
    this.health.confirmedObservations += confirmed.length

    if (gameTimeMs - this.lastCampPollMs >= this.options.campPollIntervalMs) {
      this.lastCampPollMs = gameTimeMs
      this.processCampFrame(
        { ...context, gameId },
        minimap,
        gameTimeMs,
        markerProposals,
      )
    }
    if (this.debugSamplingActive) {
      this.debugSampler?.sample(minimap, {
        gameTimeMs,
        calibration,
        markerProposals,
        detections,
        confirmed,
        campStates: this.lastCampObservations,
      })
    }

    if (context.debugOverlayEnabled) {
      this.onDebugFrame?.({
        gameId,
        frame: minimap,
        sample: {
          gameTimeMs,
          calibration,
          markerProposals,
          detections,
          confirmed,
          campStates: this.lastCampObservations,
        },
        health: { ...this.health, ...this.qualityMetrics() },
      })
    }

    this.health.processedFrames += 1
  }

  private processCampFrame(
    context: MinimapTelemetryContext & { gameId: number },
    minimap: Parameters<CampVisualDetector["observeAll"]>[0]["frame"],
    gameTimeMs: number,
    markerProposals: readonly ChampionMarkerProposalFootprint[] = [],
  ) {
    const observations = this.campDetector.observeAll({
      frame: minimap,
      gameId: context.gameId,
      gameTimeMs,
    })
    this.lastCampObservations = observations.map((observation) => {
      const camp = CAMP_BY_KEY.get(observation.campKey)
      const overlapped = camp && markerProposals.some((proposal) =>
        normalizedDistance(proposal.center, camp.center) <=
        camp.patchRadius + proposal.radius)
      return overlapped
        ? { ...observation, state: "unknown" as const, sourceConfidence: 0 }
        : observation
    })
    for (const observation of this.lastCampObservations) {
      const transition = this.campStates.observe(observation)
      if (!transition) continue
      // Persist confirmed state changes, not every repeated per-frame state.
      this.repository.recordCampState(context.puuid, {
        gameId: transition.gameId,
        campKey: transition.campKey,
        gameTimeMs: transition.observedAtMs,
        state: transition.state,
        source: transition.source,
        sourceConfidence: transition.confidence,
        providerVersion: transition.providerVersion,
      })
      if (transition.previousState !== "alive" ||
          !["dead", "respawn_long", "respawn_soon"].includes(transition.state)) continue
      const camp = CAMP_BY_KEY.get(transition.campKey)
      if (!camp) continue
      const trackSample = this.trackSampleAt(transition.observedAtMs)
      const alignedTracks = trackSample?.tracks ?? []
      const alignedEvidence = this.evidenceAt(transition.observedAtMs)
      const local = context.localParticipantKey
        ? alignedTracks.find((track) => track.participantKey === context.localParticipantKey)
        : undefined
      const nearbyAllies = alignedTracks.filter((track) =>
        track.state === "visible" && track.team === "ally" && track.position &&
        normalizedDistance(track.position, camp.center) <= camp.attributionRadius).length
      const nearbyEnemies = alignedTracks.filter((track) =>
        track.state === "visible" && track.team === "enemy" && track.position &&
        normalizedDistance(track.position, camp.center) <= camp.attributionRadius).length
      const evidence = {
        campTransition: true,
        localPositionObserved: local?.state === "visible" && Boolean(local.position),
        localPositionDistance: local?.position
          ? normalizedDistance(local.position, camp.center)
          : undefined,
        creepScoreDelta: alignedEvidence?.evidence.creepScoreDelta,
        goldResidual: alignedEvidence?.evidence.goldResidual,
        expectedNextCamp: context.routePlan?.[this.localClearCount] === transition.campKey,
        visibleAlliesNearCamp: nearbyAllies,
        visibleEnemiesNearCamp: nearbyEnemies,
        localPlayerDead: context.localParticipantKey && trackSample
          ? trackSample.deadParticipantKeys.includes(context.localParticipantKey) ||
            local?.state === "dead"
          : undefined,
        transitionConfidence: transition.confidence,
        evidenceAgeMs: alignedEvidence?.distanceMs ?? Number.MAX_SAFE_INTEGER,
      }
      const attributed = this.attribution.attribute(evidence)
      const event: CampClearEvent = {
        gameId: context.gameId,
        puuid: context.puuid,
        campKey: transition.campKey,
        clearedAtMs: transition.observedAtMs,
        source: "minimap_cv",
        sourceConfidence: transition.confidence,
        attribution: attributed.attribution,
        attributionConfidence: attributed.confidence,
        evidence,
        routeIndex: attributed.attribution === "local" ? this.localClearCount : undefined,
        algorithmVersion: 2,
      }
      this.repository.recordCampClear(event)
      if (attributed.attribution === "local") this.localClearCount += 1
    }
  }

  private recordTrackHistory(
    gameTimeMs: number,
    tracks: ChampionTrackSnapshot[],
    deadParticipantKeys: string[],
  ) {
    this.trackHistory.push({
      gameTimeMs,
      tracks: tracks.map((track) => ({
        ...track,
        position: track.position ? { ...track.position } : undefined,
        lastObservedPosition: track.lastObservedPosition
          ? { ...track.lastObservedPosition }
          : undefined,
      })),
      deadParticipantKeys: [...deadParticipantKeys],
    })
    this.pruneAlignmentHistory(gameTimeMs)
  }

  private recordEvidenceHistory(gameTimeMs: number, evidence: JungleEvidenceDelta) {
    this.evidenceHistory.push({ gameTimeMs, evidence: { ...evidence } })
    this.pruneAlignmentHistory(gameTimeMs)
  }

  private pruneAlignmentHistory(referenceGameTimeMs: number) {
    const cutoff = referenceGameTimeMs - CAMP_ALIGNMENT_HISTORY_MS
    while (this.trackHistory.length > 0 && this.trackHistory[0].gameTimeMs < cutoff) {
      this.trackHistory.shift()
    }
    while (this.evidenceHistory.length > 0 && this.evidenceHistory[0].gameTimeMs < cutoff) {
      this.evidenceHistory.shift()
    }
  }

  private trackSampleAt(gameTimeMs: number) {
    let best: TrackHistorySample | undefined
    let bestDistanceMs = Number.POSITIVE_INFINITY
    for (const sample of this.trackHistory) {
      const distanceMs = Math.abs(sample.gameTimeMs - gameTimeMs)
      if (distanceMs <= bestDistanceMs) {
        best = sample
        bestDistanceMs = distanceMs
      }
    }
    return bestDistanceMs <= MAXIMUM_TRACK_ALIGNMENT_MS ? best : undefined
  }

  private evidenceAt(gameTimeMs: number) {
    let best: EvidenceHistorySample | undefined
    let bestDistanceMs = Number.POSITIVE_INFINITY
    for (const sample of this.evidenceHistory) {
      const intervalStartMs = sample.gameTimeMs - sample.evidence.elapsedMs
      const distanceMs = gameTimeMs < intervalStartMs
        ? intervalStartMs - gameTimeMs
        : gameTimeMs > sample.gameTimeMs
          ? gameTimeMs - sample.gameTimeMs
          : 0
      if (distanceMs <= bestDistanceMs) {
        best = sample
        bestDistanceMs = distanceMs
      }
    }
    return best && bestDistanceMs <= MAXIMUM_EVIDENCE_ALIGNMENT_MS
      ? { evidence: best.evidence, distanceMs: bestDistanceMs }
      : undefined
  }

  private recordFrameGap(capturedMonotonicMs: number) {
    const previous = this.lastCapturedMonotonicMs
    this.lastCapturedMonotonicMs = capturedMonotonicMs
    if (previous === undefined || capturedMonotonicMs <= previous) return
    this.frameGapSamples.push(capturedMonotonicMs - previous)
    if (this.frameGapSamples.length > 2_048) this.frameGapSamples.shift()
  }

  private qualityMetrics() {
    const elapsedSeconds = Math.max(
      0,
      ((this.sessionEndedMonotonicMs ?? performance.now()) - this.sessionStartedMonotonicMs) /
        1_000,
    )
    return {
      achievedFps: elapsedSeconds > 0 ? this.health.processedFrames / elapsedSeconds : 0,
      p95FrameGapMs: percentile(this.frameGapSamples, 0.95),
      maximumFrameGapMs: this.frameGapSamples.length > 0
        ? Math.max(...this.frameGapSamples)
        : 0,
    }
  }

  private sourceFingerprint(width: number, height: number) {
    const backend = this.backend.getHealth()
    return [
      this.backend.id,
      backend.sourceId ?? backend.sourceName ?? "unknown",
      `${width}x${height}`,
      createCalibrationContextSignature({
        sourceWidth: width,
        sourceHeight: height,
        hints: this.calibrationHints,
      }),
    ].join(":")
  }

  private persistCalibration(
    sourceFingerprint: string,
    calibration: MinimapCalibration,
  ) {
    if (!this.captureSessionId) return
    const calibrationId = createHash("sha256")
      .update(JSON.stringify({ sourceFingerprint, calibration }))
      .digest("hex")
      .slice(0, 32)
    if (this.persistedCalibrationId === calibrationId) return
    this.repository.saveCalibration(calibrationId, sourceFingerprint, calibration)
    this.repository.attachCalibration(this.captureSessionId, calibrationId)
    this.persistedCalibrationId = calibrationId
  }

  private resetSessionState() {
    this.clock.reset()
    this.evidence.reset()
    this.campStates.reset()
    this.campDetector.reset()
    this.championTracker.reset()
    this.calibration = undefined
    this.activeSourceFingerprint = undefined
    this.latestTracks = []
    this.trackHistory.length = 0
    this.evidenceHistory.length = 0
    this.lastCampObservations = []
    this.lastCampPollMs = Number.NEGATIVE_INFINITY
    this.lastCalibrationValidationMs = Number.NEGATIVE_INFINITY
    this.calibrationValidationFailures = 0
    this.localClearCount = 0
    this.consecutiveFailures = 0
    this.persistedCalibrationId = undefined
    this.lastCapturedMonotonicMs = undefined
    this.sessionEndedMonotonicMs = undefined
    this.frameGapSamples.length = 0
  }

  private emptyHealth(
    state: MinimapTelemetryHealth["state"] = "idle",
  ): MinimapTelemetryHealth {
    return {
      state,
      processedFrames: 0,
      droppedFrames: 0,
      captureAttempts: 0,
      rejectedFrames: 0,
      confirmedObservations: 0,
      averageProcessingMs: 0,
      achievedFps: 0,
      p95FrameGapMs: 0,
      maximumFrameGapMs: 0,
      calibrationFailures: 0,
    }
  }
}
