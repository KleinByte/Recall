import { createHash } from "node:crypto"
import type {
  CampClearEvent,
  CampKey,
  CampStateObservation,
  ChampionTrackSnapshot,
  MinimapCalibration,
  RgbaFrame,
} from "../../../src/shared/minimap/contracts.js"
import { normalizedDistance } from "../../../src/shared/minimap/contracts.js"
import { MinimapTelemetryRepository } from "../database/minimap-telemetry-repo.js"
import {
  CAMP_BY_KEY,
  CAMP_CLEAR_ALGORITHM_VERSION,
  campRespawnDurationMs,
} from "../jungle/camp-map.js"
import { CampAttributionEngine } from "../jungle/camp-attribution-engine.js"
import { CampStateMachine } from "../jungle/camp-state-machine.js"
import {
  CAMP_VISUAL_DETECTOR_VERSION,
  CampTemplateBank,
} from "../jungle/camp-visual-detector.js"
import { LiveClientCampInference } from "../jungle/live-client-camp-inference.js"
import {
  JungleEvidenceAccumulator,
  readJungleEvidenceSample,
  type GameClientRequest,
  type JungleEvidenceDelta,
} from "../jungle/live-jungle-evidence.js"
import {
  MINIMAP_CALIBRATION_VERSION,
  calibrationMatchesHints,
  createCalibrationContextSignature,
  validateCalibration,
  type MinimapCalibrationHints,
} from "./calibration.js"
import type { MinimapCaptureBackend } from "./capture-backend.js"
import {
  CHAMPION_MARKER_DETECTOR_VERSION,
  type ChampionMarkerTemplate,
} from "./champion-marker-detector.js"
import { ChampionTracker } from "./champion-tracker.js"
import { GameClockSynchronizer } from "./game-clock-synchronizer.js"
import { MinimapDebugSampler } from "./minimap-debug-sampler.js"
import type { MinimapDebugSample } from "./minimap-debug-sampler.js"
import { VisionWorkerClient, type VisionWorkerPortClient } from "../vision/vision-worker-client.js"

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
  fullFrameRefreshIntervalMs: number
  maximumConsecutiveFailures: number
  startupRetryBaseMs: number
  startupRetryMaximumMs: number
}

const DEFAULT_OPTIONS: MinimapTelemetryCoordinatorOptions = {
  targetFps: 4,
  canonicalSize: 320,
  clockPollIntervalMs: 500,
  campPollIntervalMs: 750,
  calibrationValidationIntervalMs: 2_000,
  fullFrameRefreshIntervalMs: 30_000,
  maximumConsecutiveFailures: 12,
  startupRetryBaseMs: 1_500,
  startupRetryMaximumMs: 15_000,
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
  startupAttempts: number
  nextRetryAt?: number
  eligibilityReason?: "eligible" | "phase_not_in_progress" | "game_id_unavailable" |
    "map_not_summoners_rift" | "classification_pending"
  backendState?: ReturnType<MinimapCaptureBackend["getHealth"]>["state"]
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
  inferredCampClears?: number
  clockSampleCount?: number
  clockReady?: boolean
  visionEngine?: "opencv_js"
  opencvVersion?: string
  visionWorkerState?: "idle" | "initializing" | "ready" | "failed" | "closed"
  visionWorkerRestarts?: number
  visionProcessingMs?: number
  visionChampionMs?: number
  visionCampMs?: number
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
  private readonly liveCampInference = new LiveClientCampInference()
  private readonly championTracker = new ChampionTracker()
  private readonly campTemplates: CampTemplateBank
  private readonly vision: VisionWorkerPortClient
  private context?: MinimapTelemetryContext
  private calibration?: MinimapCalibration
  private calibrationHints: MinimapCalibrationHints = {}
  private templates: ChampionMarkerTemplate[] = []
  private abort?: AbortController
  private loopTask?: Promise<void>
  private evidenceTask?: Promise<void>
  private stopping?: Promise<void>
  private captureSessionId?: string
  private startInFlight?: Promise<void>
  private startupGameId?: number
  private nextStartAttemptAt = 0
  private startupRetryTimer?: ReturnType<typeof setTimeout>
  private needsSessionReset = true
  private activeSourceFingerprint?: string
  private latestTracks: ChampionTrackSnapshot[] = []
  private readonly trackHistory: TrackHistorySample[] = []
  private readonly evidenceHistory: EvidenceHistorySample[] = []
  private readonly lastRecordedClearAt = new Map<CampKey, number>()
  private lastCampObservations: CampStateObservation[] = []
  private lastCampPollMs = Number.NEGATIVE_INFINITY
  private lastCalibrationValidationMs = Number.NEGATIVE_INFINITY
  private lastFullFrameCaptureMs = Number.NEGATIVE_INFINITY
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
    vision: VisionWorkerPortClient = new VisionWorkerClient(),
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.campTemplates = campTemplates
    this.vision = vision
  }

  setTemplates(
    templates: ChampionMarkerTemplate[],
    status: {
      rosterCount?: number
      localParticipantKey?: string
      errorCode?: string
    } = {},
  ) {
    this.templates = templates.map((template) => ({
      ...template,
      rgba: Uint8Array.from(template.rgba),
    }))
    this.setTemplateStatus(status)
    const sessionId = this.captureSessionId
    const gameId = this.context?.gameId
    if (sessionId && gameId !== undefined && this.abort) {
      void this.vision.setRoster(sessionId, gameId, this.templates).catch((error) => {
        this.health.templateErrorCode = error instanceof Error
          ? error.message
          : "vision_roster_update_failed"
      })
    }
  }

  setTemplateStatus(status: {
    rosterCount?: number
    localParticipantKey?: string
    errorCode?: string
  } = {}) {
    this.health.rosterCount = status.rosterCount
    this.health.templateCount = this.templates.length
    this.health.localTemplateAvailable = status.localParticipantKey
      ? this.templates.some((template) => template.participantKey === status.localParticipantKey)
      : undefined
    this.health.templateErrorCode = status.errorCode
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
    const activeGameChanged = this.startupGameId !== undefined &&
      context.gameId !== this.startupGameId
    if (activeGameChanged &&
        (this.abort || this.startInFlight || this.captureSessionId)) {
      // Close the old capture against its original context before exposing the
      // new game ID to either the frame loop or the Live Client evidence loop.
      await this.stop("complete")
    }
    this.context = context
    const eligibilityReason = this.captureEligibilityReason(context)
    const eligible = eligibilityReason === "eligible"
    this.health.eligibilityReason = eligibilityReason

    if (this.startupGameId !== undefined &&
        (context.phase !== "InProgress" || context.gameId !== this.startupGameId)) {
      this.resetStartupRetry()
    }

    if (eligible && !this.abort && !this.startInFlight &&
        Date.now() >= this.nextStartAttemptAt) {
      await this.start()
    }
    if (eligible && this.abort && context.debugEnabled && !this.debugSamplingActive) {
      this.debugSampler?.start(context.gameId!)
      this.debugSamplingActive = Boolean(this.debugSampler)
    }
    if (this.abort && this.debugSamplingActive && !context.debugEnabled) {
      // Stop admitting new samples before awaiting the pending write queue.
      this.debugSamplingActive = false
      await this.debugSampler?.finish().catch(() => undefined)
    }
    if (!eligible && (this.abort || this.startInFlight || this.captureSessionId)) {
      await this.stop("complete")
    } else if (!eligible && !this.abort && !this.startInFlight) {
      this.health.state = "idle"
    }
  }

  async start() {
    if (this.startInFlight) return this.startInFlight
    const task = (async () => {
      // A caller may request a new capture immediately after a phase transition.
      // Wait for an older shutdown, but never let stop() and performStart() await
      // one another through the same startInFlight promise.
      await this.stopping?.catch(() => undefined)
      await this.performStart()
    })()
    this.startInFlight = task
    try {
      await task
    } finally {
      if (this.startInFlight === task) this.startInFlight = undefined
    }
  }

  private async performStart() {
    const context = this.context
    if (context?.gameId === undefined ||
        this.captureEligibilityReason(context) !== "eligible" || this.abort) return
    const gameId = context.gameId
    if (this.startupGameId !== gameId || this.needsSessionReset) {
      const preservedStartupAttempts = this.startupGameId === gameId
        ? this.health.startupAttempts
        : 0
      const preservedTemplateStatus = {
        rosterCount: this.health.rosterCount,
        templateCount: this.health.templateCount,
        localTemplateAvailable: this.health.localTemplateAvailable,
        templateErrorCode: this.health.templateErrorCode,
      }
      this.resetSessionState()
      this.health = {
        ...this.emptyHealth("starting"),
        startupAttempts: preservedStartupAttempts,
        eligibilityReason: "eligible",
        ...preservedTemplateStatus,
      }
      this.startupGameId = gameId
      this.needsSessionReset = false
    }
    this.health.state = "starting"
    this.health.startupAttempts += 1
    this.health.nextRetryAt = undefined

    try {
      await this.backend.start()
      // The integration serializes updates, but retain a defensive context
      // check so a direct caller cannot attach a late stream to another game.
      if (this.context?.gameId !== gameId ||
          this.captureEligibilityReason(this.context) !== "eligible") {
        await this.backend.stop().catch(() => undefined)
        return
      }
      this.clearStartupRetryTimer()
      this.nextStartAttemptAt = 0
      this.abort = new AbortController()
      this.sessionStartedMonotonicMs = performance.now()
      this.captureSessionId = this.repository.startCaptureSession({
        gameId,
        puuid: context.puuid,
        captureBackend: this.backend.id,
        detectorVersion: CHAMPION_MARKER_DETECTOR_VERSION,
        debugRetention: context.debugEnabled === true,
      })
      const captureSessionId = this.captureSessionId
      const runtime = await this.vision.initialize(this.options.canonicalSize)
      await this.vision.setCampTemplates(this.campTemplates.snapshot())
      await this.vision.setRoster(captureSessionId, gameId, this.templates)
      this.health.visionEngine = runtime.engine
      this.health.opencvVersion = runtime.opencvVersion
      if (context.debugEnabled) {
        this.debugSampler?.start(gameId)
        this.debugSamplingActive = Boolean(this.debugSampler)
      }
      const signal = this.abort.signal
      this.health.state = "capturing"
      this.health.lastErrorCode = undefined
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
      const backendRetryAt = this.backend.getHealth().nextRetryAt ?? 0
      const failedAbort = this.abort
      this.abort = undefined
      failedAbort?.abort()
      this.health.lastErrorCode = code
      if (this.captureSessionId) {
        const failedSessionId = this.captureSessionId
        await this.vision.reset(failedSessionId).catch(() => undefined)
        this.sessionEndedMonotonicMs = performance.now()
        this.finishCaptureSession("failed")
        this.repository.flushAll()
      }
      await this.debugSampler?.finish().catch(() => undefined)
      this.debugSamplingActive = false
      await this.backend.stop().catch(() => undefined)
      const exponentialDelay = Math.min(
        this.options.startupRetryMaximumMs,
        this.options.startupRetryBaseMs * 2 ** Math.min(6, this.health.startupAttempts - 1),
      )
      this.nextStartAttemptAt = Math.max(Date.now() + exponentialDelay, backendRetryAt)
      this.health = {
        ...this.health,
        state: "degraded",
        lastErrorCode: code,
        nextRetryAt: this.nextStartAttemptAt,
      }
      this.scheduleStartupRetry(gameId)
    }
  }

  stop(status: "complete" | "capture_unavailable" | "calibration_required" | "failed" | "aborted") {
    if (this.stopping) return this.stopping
    this.stopping = (async () => {
      await this.startInFlight?.catch(() => undefined)
      if (!this.abort && !this.loopTask && !this.evidenceTask &&
          !this.captureSessionId && !this.debugSamplingActive) {
        if (status === "complete" || status === "aborted") {
          this.resetStartupRetry()
          this.health = {
            ...this.health,
            state: "idle",
            nextRetryAt: undefined,
          }
        }
        return
      }
      await this.performStop(status)
    })().finally(() => {
      this.stopping = undefined
    })
    return this.stopping
  }

  getHealth() {
    const quality = this.qualityMetrics()
    const debug = this.debugSampler?.getHealth()
    const backend = this.backend.getHealth()
    return {
      ...this.health,
      ...quality,
      backendState: backend.state,
      sourceId: backend.sourceId,
      sourceName: backend.sourceName,
      discoveredWindowCount: backend.discoveredWindowCount,
      candidateSourceCount: backend.candidateSourceCount,
      candidateSourceNames: backend.candidateSourceNames
        ? [...backend.candidateSourceNames]
        : undefined,
      sourceDiscoveryAttempts: backend.sourceDiscoveryAttempts,
      captureMode: backend.captureMode,
      captureStage: backend.captureStage,
      frameDeliveryMode: backend.frameDeliveryMode,
      paintEventCount: backend.paintEventCount,
      paintSizeMismatchCount: backend.paintSizeMismatchCount,
      snapshotCaptureCount: backend.snapshotCaptureCount,
      lastPaintSize: backend.lastPaintSize,
      rendererFrameSerial: backend.rendererFrameSerial,
      lastErrorDetail: backend.lastErrorDetail,
      clockSampleCount: this.clock.sampleCount,
      clockReady: this.clock.sampleCount > 0,
      visionEngine: this.vision.runtime?.engine,
      opencvVersion: this.vision.runtime?.opencvVersion,
      visionWorkerState: this.vision.state,
      visionWorkerRestarts: this.vision.restarts,
      ...(debug ? {
        debugSampleCount: debug.sampleCount,
        debugErrorCode: debug.lastError,
      } : {}),
    }
  }

  /** Clears startup backoff after an explicit telemetry disable/enable cycle. */
  resetFailedStart() {
    this.resetStartupRetry()
  }

  private resetStartupRetry() {
    this.clearStartupRetryTimer()
    this.startupGameId = undefined
    this.nextStartAttemptAt = 0
    this.needsSessionReset = true
    this.health.nextRetryAt = undefined
  }

  private clearStartupRetryTimer() {
    if (this.startupRetryTimer !== undefined) clearTimeout(this.startupRetryTimer)
    this.startupRetryTimer = undefined
  }

  private scheduleStartupRetry(gameId: number) {
    this.clearStartupRetryTimer()
    const delayMs = Math.max(0, this.nextStartAttemptAt - Date.now())
    this.startupRetryTimer = setTimeout(() => {
      this.startupRetryTimer = undefined
      const context = this.context
      if (!context || context.gameId !== gameId || this.abort ||
          this.captureEligibilityReason(context) !== "eligible") return
      if (this.stopping) {
        this.nextStartAttemptAt = Math.max(this.nextStartAttemptAt, Date.now() + 25)
        this.scheduleStartupRetry(gameId)
        return
      }
      void this.start()
    }, delayMs)
    this.startupRetryTimer.unref?.()
  }

  private captureEligibilityReason(
    context: MinimapTelemetryContext,
  ): NonNullable<MinimapTelemetryHealth["eligibilityReason"]> {
    if (context.phase !== "InProgress") return "phase_not_in_progress"
    if (context.gameId === undefined) return "game_id_unavailable"
    if (context.mapNumber !== 11) return "map_not_summoners_rift"
    if (context.captureClassificationReady === false) return "classification_pending"
    return "eligible"
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
    const visionSessionId = this.captureSessionId
    if (visionSessionId) await this.vision.reset(visionSessionId).catch(() => undefined)
    this.sessionEndedMonotonicMs = performance.now()
    this.finishCaptureSession(status)
    this.repository.flushAll()
    this.calibration = undefined
    this.activeSourceFingerprint = undefined
    this.persistedCalibrationId = undefined
    const terminal = status === "complete" || status === "aborted"
    if (terminal) {
      this.resetStartupRetry()
    } else {
      this.needsSessionReset = true
      this.nextStartAttemptAt = Date.now() + this.options.startupRetryBaseMs
      const gameId = this.context?.gameId
      if (gameId !== undefined &&
          this.captureEligibilityReason(this.context!) === "eligible") {
        this.scheduleStartupRetry(gameId)
      }
    }
    this.health = {
      ...this.health,
      ...this.qualityMetrics(),
      state: terminal ? "idle" : "degraded",
      nextRetryAt: terminal ? undefined : this.nextStartAttemptAt,
      ...(terminal ? { lastErrorCode: undefined } : {}),
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
        if (evidence) {
          this.recordEvidenceHistory(sample.gameTimeMs, evidence)
          this.processLiveCampEvidence(sample.gameTimeMs, sample.localPlayerDead, evidence)
        }
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
    if (context?.gameId === undefined || context.phase !== "InProgress" ||
        context.captureClassificationReady === false) return
    const gameId = context.gameId
    const captureSessionId = this.captureSessionId
    if (!captureSessionId) throw new Error("minimap_capture_session_required")

    let calibration = this.calibration
    let sourceFingerprint = this.activeSourceFingerprint
    let minimap: RgbaFrame

    const captureRegion = this.backend.captureRegion?.bind(this.backend)
    const regionEligible = Boolean(
      captureRegion &&
      calibration &&
      sourceFingerprint &&
      calibrationMatchesHints(calibration, this.calibrationHints) &&
      performance.now() - this.lastFullFrameCaptureMs <
        this.options.fullFrameRefreshIntervalMs
    )

    if (regionEligible && captureRegion && calibration) {
      try {
        minimap = await captureRegion({
          sourceRect: calibration.innerMapRect,
          outputWidth: this.options.canonicalSize,
          outputHeight: this.options.canonicalSize,
        })
      } catch (error) {
        // A window recreation or resolution change can invalidate a previously
        // correct ROI. Force a full-frame OpenCV calibration pass next time.
        this.calibration = undefined
        this.persistedCalibrationId = undefined
        this.lastFullFrameCaptureMs = Number.NEGATIVE_INFINITY
        throw error
      }
    } else {
      const frame = await this.backend.captureFrame()
      const sourceWidth = frame.width
      const sourceHeight = frame.height
      this.lastFullFrameCaptureMs = frame.capturedMonotonicMs
      sourceFingerprint = this.sourceFingerprint(sourceWidth, sourceHeight)
      if (this.activeSourceFingerprint !== sourceFingerprint) {
        this.activeSourceFingerprint = sourceFingerprint
        this.calibration = undefined
        this.persistedCalibrationId = undefined
        this.lastCalibrationValidationMs = Number.NEGATIVE_INFINITY
        this.calibrationValidationFailures = 0
      }

      calibration = this.calibration
      if (!calibration || !validateCalibration(calibration, sourceWidth, sourceHeight) ||
          !calibrationMatchesHints(calibration, this.calibrationHints)) {
        const persisted = this.repository.findCalibration(
          sourceFingerprint,
          sourceWidth,
          sourceHeight,
        )
        calibration = persisted &&
          validateCalibration(persisted, sourceWidth, sourceHeight) &&
          calibrationMatchesHints(persisted, this.calibrationHints)
          ? persisted
          : undefined
      }

      const located = await this.vision.calibrate({
        sessionId: captureSessionId,
        frame,
        hints: this.calibrationHints,
        calibration,
      })
      const diagnostics = located.diagnostics
      this.health.calibrationCandidatesEvaluated = diagnostics.evaluatedCandidates
      this.health.calibrationCandidatesValid = diagnostics.visuallyValidCandidates
      this.health.calibrationBestScore = diagnostics.bestScore
      this.health.calibrationFailureReason = diagnostics.failureReason
      this.health.calibrationVariance = diagnostics.bestVisual?.variance ?? located.visual?.variance
      this.health.calibrationEdgeDensity = diagnostics.bestVisual?.edgeDensity ?? located.visual?.edgeDensity
      this.health.calibrationColoredRatio = diagnostics.bestVisual?.coloredRatio ?? located.visual?.coloredRatio

      calibration = located.calibration
      minimap = located.minimap as RgbaFrame
      if (!calibration || !minimap) throw new Error("minimap_calibration_required")
      this.calibration = calibration
      this.persistCalibration(sourceFingerprint, calibration)
    }

    if (!calibration || !sourceFingerprint) throw new Error("minimap_calibration_required")
    this.recordFrameGap(minimap.capturedMonotonicMs)

    const estimate = this.clock.estimate(minimap.capturedMonotonicMs)
    const gameTimeMs = estimate?.gameTimeMs ?? 0
    const includeCamps = Boolean(
      estimate && gameTimeMs - this.lastCampPollMs >= this.options.campPollIntervalMs
    )
    const includeVisualValidation = this.calibrationValidationFailures > 0 ||
      minimap.capturedMonotonicMs - this.lastCalibrationValidationMs >=
        this.options.calibrationValidationIntervalMs
    const vision = await this.vision.processFrame({
      sessionId: captureSessionId,
      gameId,
      gameTimeMs,
      frame: minimap,
      includeCamps,
      includeVisualValidation,
    })

    // A worker result can arrive after a match/window transition. Never allow
    // pixels from the old session to update tracking or persistence for the new one.
    if (this.captureSessionId !== vision.sessionId ||
        this.context?.gameId !== vision.gameId || vision.gameId !== gameId) return

    minimap = vision.frame
    this.health.visionProcessingMs = vision.metrics.totalMs
    this.health.visionChampionMs = vision.metrics.championMs
    this.health.visionCampMs = vision.metrics.campMs

    if (includeVisualValidation) {
      const visual = vision.visual
      if (!visual) throw new Error("vision_visual_validation_missing")
      this.lastCalibrationValidationMs = minimap.capturedMonotonicMs
      this.health.calibrationVariance = visual.variance
      this.health.calibrationEdgeDensity = visual.edgeDensity
      this.health.calibrationColoredRatio = visual.coloredRatio
      if (!visual.valid) {
        this.calibrationValidationFailures += 1
        this.health.calibrationFailures += 1
        if (this.calibrationValidationFailures >= 2) {
          this.calibration = undefined
          this.lastFullFrameCaptureMs = Number.NEGATIVE_INFINITY
        }
        this.health.calibrationFailureReason = "periodic_visual_validation"
        throw new Error("minimap_visual_validation_failed")
      }
      this.calibrationValidationFailures = 0
      this.health.calibrationFailureReason = undefined
    }

    this.health.calibrationConfidence = calibration.confidence
    const detections = vision.championObservations
    const markerProposals = vision.markerProposals
    let confirmed: ReturnType<ChampionTracker["getConfirmedObservations"]> = []

    if (estimate) {
      this.latestTracks = this.championTracker.update({
        gameTimeMs,
        observations: detections,
        deadParticipantKeys: context.deadParticipantKeys,
        captureAvailable: true,
      })
      this.recordTrackHistory(gameTimeMs, this.latestTracks, context.deadParticipantKeys)
      confirmed = this.championTracker.getConfirmedObservations()
      for (const observation of confirmed) {
        this.repository.appendChampionObservation(context.puuid, observation)
      }
      this.health.confirmedObservations += confirmed.length

      if (includeCamps) {
        this.lastCampPollMs = gameTimeMs
        this.processCampObservations(
          { ...context, gameId },
          vision.campObservations,
        )
      }
      this.health.processedFrames += 1
    } else {
      this.health.rejectedFrames += 1
    }

    const debugSample: MinimapDebugSample = {
      gameTimeMs,
      vision: {
        engine: "opencv_js",
        opencvVersion: this.vision.runtime?.opencvVersion ?? "unknown",
        calibrationVersion: MINIMAP_CALIBRATION_VERSION,
        championDetectorVersion: CHAMPION_MARKER_DETECTOR_VERSION,
        campDetectorVersion: CAMP_VISUAL_DETECTOR_VERSION,
      },
      calibration,
      markerProposals,
      detections,
      confirmed,
      campStates: this.lastCampObservations,
    }
    if (this.debugSamplingActive) this.debugSampler?.sample(minimap, debugSample)
    if (context.debugOverlayEnabled) {
      this.onDebugFrame?.({
        gameId,
        frame: minimap,
        sample: debugSample,
        health: this.getHealth(),
      })
    }
  }

  private processCampObservations(
    context: MinimapTelemetryContext & { gameId: number },
    observations: CampStateObservation[],
  ) {
    this.lastCampObservations = observations
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
      if (transition.state === "alive" && transition.previousState !== "alive") {
        // A confirmed respawn starts a new camp life. Evidence deduplication is
        // only meant to merge CV and Live Client reports for the same clear.
        const previousClear = this.lastRecordedClearAt.get(transition.campKey)
        const respawnDuration = campRespawnDurationMs(transition.campKey)
        if (previousClear === undefined || respawnDuration === undefined ||
            transition.observedAtMs >= previousClear + respawnDuration - 10_000) {
          this.lastRecordedClearAt.delete(transition.campKey)
        }
      }
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
      const localPositionAgeMs = local?.lastObservedGameTimeMs === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(0, transition.observedAtMs - local.lastObservedGameTimeMs)
      const localPosition = local?.state === "visible" && local.position
        ? local.position
        : local?.lastObservedPosition && localPositionAgeMs <= 2_000 && local.confidence >= 0.35
          ? local.lastObservedPosition
          : undefined
      const nearbyAllies = alignedTracks.filter((track) =>
        track.state === "visible" && track.team === "ally" && track.position &&
        normalizedDistance(track.position, camp.center) <= camp.attributionRadius).length
      const nearbyEnemies = alignedTracks.filter((track) =>
        track.state === "visible" && track.team === "enemy" && track.position &&
        normalizedDistance(track.position, camp.center) <= camp.attributionRadius).length
      const evidence = {
        campTransition: true,
        localPositionObserved: Boolean(localPosition),
        localPositionDistance: localPosition
          ? normalizedDistance(localPosition, camp.center)
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
        evidenceAgeMs: Math.max(
          Number.isFinite(localPositionAgeMs) ? localPositionAgeMs : 0,
          alignedEvidence?.distanceMs ?? Number.MAX_SAFE_INTEGER,
        ),
      }
      const attributed = this.attribution.attribute(evidence)
      this.liveCampInference.markObservedClear(transition.campKey, transition.observedAtMs)
      const event: CampClearEvent = {
        gameId: context.gameId,
        puuid: context.puuid,
        campKey: transition.campKey,
        clearedAtMs: transition.observedAtMs,
        respawnAtMs: campRespawnDurationMs(transition.campKey) === undefined
          ? undefined
          : transition.observedAtMs + campRespawnDurationMs(transition.campKey)!,
        source: "minimap_cv",
        sourceConfidence: transition.confidence,
        attribution: attributed.attribution,
        attributionConfidence: attributed.confidence,
        evidence,
        routeIndex: attributed.attribution === "local" ? this.localClearCount : undefined,
        algorithmVersion: CAMP_CLEAR_ALGORITHM_VERSION,
      }
      this.recordCampClearEvent(event)
    }
  }

  private processLiveCampEvidence(
    gameTimeMs: number,
    localPlayerDead: boolean | undefined,
    evidence: JungleEvidenceDelta,
  ) {
    const context = this.context
    if (context?.gameId === undefined || context.phase !== "InProgress") return
    const trackSample = this.trackSampleAt(gameTimeMs)
    const event = this.liveCampInference.observe({
      gameId: context.gameId,
      puuid: context.puuid,
      gameTimeMs,
      evidence,
      localParticipantKey: context.localParticipantKey,
      tracks: trackSample?.tracks ?? [],
      localPlayerDead: localPlayerDead ?? (
        context.localParticipantKey
          ? context.deadParticipantKeys.includes(context.localParticipantKey)
          : undefined
      ),
      routePlan: context.routePlan,
      routeIndex: this.localClearCount,
    })
    if (!event || !this.recordCampClearEvent(event)) return
    this.repository.recordCampState(context.puuid, {
      gameId: event.gameId,
      campKey: event.campKey,
      gameTimeMs: event.clearedAtMs,
      state: "dead",
      source: "live_client_inference",
      sourceConfidence: event.sourceConfidence,
      providerVersion: event.algorithmVersion,
    })
    this.health.inferredCampClears = (this.health.inferredCampClears ?? 0) + 1
  }

  private recordCampClearEvent(event: CampClearEvent) {
    const previous = this.lastRecordedClearAt.get(event.campKey)
    const respawnDuration = campRespawnDurationMs(event.campKey)
    const minimumRepeatMs = respawnDuration === undefined
      ? 15_000
      : Math.max(15_000, respawnDuration - 10_000)
    if (previous !== undefined && event.clearedAtMs - previous < minimumRepeatMs) {
      return false
    }
    this.repository.recordCampClear(event)
    this.lastRecordedClearAt.set(event.campKey, event.clearedAtMs)
    if (event.attribution === "local") this.localClearCount += 1
    return true
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
    this.liveCampInference.reset()
    this.championTracker.reset()
    this.calibration = undefined
    this.activeSourceFingerprint = undefined
    this.latestTracks = []
    this.trackHistory.length = 0
    this.evidenceHistory.length = 0
    this.lastRecordedClearAt.clear()
    this.lastCampObservations = []
    this.lastCampPollMs = Number.NEGATIVE_INFINITY
    this.lastCalibrationValidationMs = Number.NEGATIVE_INFINITY
    this.lastFullFrameCaptureMs = Number.NEGATIVE_INFINITY
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
      startupAttempts: 0,
      inferredCampClears: 0,
    }
  }
}
