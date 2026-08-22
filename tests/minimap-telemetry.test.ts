import Database from "better-sqlite3-node"
import { describe, expect, it, vi } from "vitest"
import { applyMigrations, latestSchemaVersion } from "../electron/main/database/migrations.js"
import { MinimapTelemetryRepository } from "../electron/main/database/minimap-telemetry-repo.js"
import { CAMP_BY_KEY } from "../electron/main/jungle/camp-map.js"
import { MinimapTelemetryCoordinator } from
  "../electron/main/minimap/minimap-telemetry-coordinator.js"
import { createCalibration } from "../electron/main/minimap/calibration.js"
import type { MinimapCaptureBackend } from
  "../electron/main/minimap/capture-backend.js"
import type {
  CampStateObservation,
  ChampionTrackSnapshot,
  MinimapCalibration,
  RgbaFrame,
} from "../src/shared/minimap/contracts.js"
import type { ChampionMarkerTemplate } from
  "../electron/main/minimap/champion-marker-detector.js"
import type { CampVisualTemplateAsset } from
  "../electron/main/jungle/camp-visual-detector.js"
import type {
  VisionCalibrationResult,
  VisionFrameResult,
  VisionRuntimeInfo,
} from "../electron/main/vision/contracts.js"
import type { VisionWorkerPortClient } from
  "../electron/main/vision/vision-worker-client.js"

function frame(width: number, height: number, fill: [number, number, number, number]) {
  const data = new Uint8Array(width * height * 4)
  for (let index = 0; index < width * height; index += 1) data.set(fill, index * 4)
  return { width, height, data, capturedMonotonicMs: 0, frameSequence: 1 }
}

const HEALTHY_VISUAL = {
  score: 0.95,
  valid: true,
  texturedQuadrants: 4,
  darkRatio: 0.3,
  coloredRatio: 0.25,
  markerColorRatio: 0.01,
  axisBalance: 0.8,
  edgeDensity: 0.2,
  variance: 800,
}

class TestVisionWorker implements VisionWorkerPortClient {
  readonly restarts = 0
  readonly runtime: VisionRuntimeInfo = { engine: "opencv_js", opencvVersion: "test" }
  readonly state = "ready" as const

  async initialize() { return this.runtime }
  async setRoster(_sessionId: string, _gameId: number, _templates: ChampionMarkerTemplate[]) {}
  async setCampTemplates(_templates: CampVisualTemplateAsset[]) {}
  async calibrate(input: {
    sessionId: string
    frame: RgbaFrame
    hints: object
    calibration?: MinimapCalibration
  }): Promise<VisionCalibrationResult> {
    const calibration = input.calibration ?? createCalibration({
      sourceWidth: input.frame.width,
      sourceHeight: input.frame.height,
      minimapRect: {
        x: Math.max(0, input.frame.width - Math.min(input.frame.width, input.frame.height)),
        y: Math.max(0, input.frame.height - Math.min(input.frame.width, input.frame.height)),
        width: Math.min(input.frame.width, input.frame.height),
        height: Math.min(input.frame.width, input.frame.height),
      },
      placement: "right",
    })
    const minimap = frame(320, 320, [18, 30, 24, 255])
    minimap.capturedMonotonicMs = input.frame.capturedMonotonicMs
    minimap.frameSequence = input.frame.frameSequence
    return {
      calibration,
      minimap,
      visual: HEALTHY_VISUAL,
      diagnostics: { evaluatedCandidates: 1, visuallyValidCandidates: 1, bestScore: 0.95 },
    }
  }
  async processFrame(input: {
    sessionId: string
    gameId: number
    gameTimeMs: number
    frame: RgbaFrame
    includeCamps: boolean
  }): Promise<VisionFrameResult> {
    return {
      sessionId: input.sessionId,
      gameId: input.gameId,
      frameSequence: input.frame.frameSequence,
      frame: input.frame,
      visual: HEALTHY_VISUAL,
      markerProposals: [],
      championObservations: [],
      campObservations: [],
      metrics: { totalMs: 1, visualValidationMs: 0.2, championMs: 0.4, campMs: 0 },
    }
  }
  async reset() {}
  async ping() { return this.runtime }
  async close() {}
}

function campObservation(
  state: "alive" | "dead",
  gameTimeMs: number,
  frameSequence: number,
): CampStateObservation {
  return {
    gameId: 77,
    campKey: "west_blue",
    gameTimeMs,
    state,
    source: "minimap_cv",
    sourceConfidence: 1,
    frameSequence,
    providerVersion: 6_001,
  }
}

describe("minimap telemetry integration", () => {
  it("persists confirmed camp transitions and suppresses impossible pre-respawn repeats", () => {
    const db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    applyMigrations(db)
    const coordinator = new MinimapTelemetryCoordinator(
      {
        id: "electron_desktop_capture",
        start: vi.fn(async () => undefined),
        captureFrame: vi.fn(async () => frame(320, 320, [12, 18, 20, 255])),
        stop: vi.fn(async () => undefined),
        getHealth: () => ({ state: "healthy" }),
      },
      { request: vi.fn(async () => ({})) },
      new MinimapTelemetryRepository(db),
      undefined,
      undefined,
      undefined,
      undefined,
      new TestVisionWorker(),
    )
    const internal = coordinator as unknown as {
      processCampObservations(
        context: {
          phase: "InProgress"
          gameId: number
          mapNumber: number
          puuid: string
          localParticipantKey?: string
          deadParticipantKeys: string[]
        },
        observations: CampStateObservation[],
      ): void
      recordTrackHistory(
        gameTimeMs: number,
        tracks: ChampionTrackSnapshot[],
        deadParticipantKeys: string[],
      ): void
      recordEvidenceHistory(gameTimeMs: number, evidence: {
        elapsedMs: number
        goldDelta: number
        estimatedPassiveGold: number
        goldResidual: number
        creepScoreDelta?: number
      }): void
    }
    const context = {
      phase: "InProgress" as const,
      gameId: 77,
      mapNumber: 11,
      puuid: "owner",
      localParticipantKey: "ally:local",
      deadParticipantKeys: [],
    }

    for (const [index, gameTimeMs] of [1_000, 1_500, 2_000].entries()) {
      internal.processCampObservations(context, [campObservation("alive", gameTimeMs, index + 1)])
    }
    const campCenter = CAMP_BY_KEY.get("west_blue")!.center
    const localTrack = (position: { x: number; y: number }): ChampionTrackSnapshot => ({
      participantKey: "ally:local",
      championName: "Nunu",
      team: "ally",
      state: "visible",
      position,
      confidence: 1,
    })
    internal.recordTrackHistory(2_500, [localTrack(campCenter)], [])
    internal.recordEvidenceHistory(2_700, {
      elapsedMs: 500,
      goldDelta: 20,
      estimatedPassiveGold: 0,
      goldResidual: 20,
      creepScoreDelta: 4,
    })
    internal.recordTrackHistory(3_500, [localTrack({ x: 0.95, y: 0.05 })], [])
    internal.recordEvidenceHistory(3_500, {
      elapsedMs: 500,
      goldDelta: 0,
      estimatedPassiveGold: 0,
      goldResidual: 0,
      creepScoreDelta: 0,
    })
    for (const [index, gameTimeMs] of [2_500, 3_000, 3_500].entries()) {
      internal.processCampObservations(context, [campObservation("dead", gameTimeMs, index + 4)])
    }
    for (const [index, gameTimeMs] of [4_000, 4_500, 5_000].entries()) {
      internal.processCampObservations(context, [campObservation("alive", gameTimeMs, index + 7)])
    }
    // A CV-occluded poll is represented as unknown/no actionable state and does
    // not mutate the state machine. The next three dead samples confirm 6.5 s.
    internal.processCampObservations(context, [])
    for (const [index, gameTimeMs] of [6_500, 7_000, 7_500].entries()) {
      internal.processCampObservations(context, [campObservation("dead", gameTimeMs, index + 10)])
    }

    expect(db.prepare(`
      SELECT game_time_ms AS gameTimeMs, state, confidence
      FROM camp_state_events
      WHERE game_id = 77 AND puuid = 'owner' AND camp_key = 'west_blue'
      ORDER BY game_time_ms
    `).all()).toEqual([
      { gameTimeMs: 1_000, state: "alive", confidence: 1 },
      { gameTimeMs: 2_500, state: "dead", confidence: 1 },
      { gameTimeMs: 4_000, state: "alive", confidence: 1 },
      { gameTimeMs: 6_500, state: "dead", confidence: 1 },
    ])
    const storedClears = db.prepare(`
      SELECT cleared_at_ms AS clearedAtMs, respawn_at_ms AS respawnAtMs,
             attribution, evidence_json AS evidenceJson
      FROM camp_clear_events
      WHERE game_id = 77 AND puuid = 'owner' AND camp_key = 'west_blue'
      ORDER BY cleared_at_ms
    `).all() as Array<{
      clearedAtMs: number
      respawnAtMs: number
      attribution: string
      evidenceJson: string
    }>
    expect(storedClears).toHaveLength(1)
    expect(storedClears[0]).toMatchObject({
      clearedAtMs: 2_500,
      respawnAtMs: 272_500,
      attribution: "local",
    })
    expect(JSON.parse(storedClears[0].evidenceJson)).toMatchObject({
      localPositionObserved: true,
      localPositionDistance: 0,
      creepScoreDelta: 4,
      goldResidual: 20,
      evidenceAgeMs: 0,
    })
    db.close()
  })

  it("uses the calibrated minimap ROI between bounded full-frame refreshes", async () => {
    const db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    applyMigrations(db)

    const fullFrame = frame(1600, 900, [18, 30, 24, 255])
    const roiFrame = frame(320, 320, [18, 30, 24, 255])
    const captureFrame = vi.fn(async () => fullFrame)
    const captureRegion = vi.fn(async () => roiFrame)
    const backend: MinimapCaptureBackend = {
      id: "electron_desktop_capture",
      start: vi.fn(async () => undefined),
      captureFrame,
      captureRegion,
      stop: vi.fn(async () => undefined),
      getHealth: () => ({
        state: "healthy",
        sourceId: "window:2102070:0",
        sourceName: "League of Legends (TM) Client",
      }),
    }
    const coordinator = new MinimapTelemetryCoordinator(
      backend,
      { request: vi.fn(async () => ({})) },
      new MinimapTelemetryRepository(db),
      undefined,
      { fullFrameRefreshIntervalMs: 30_000 },
      undefined,
      undefined,
      new TestVisionWorker(),
    )
    const calibration = createCalibration({
      sourceWidth: 1600,
      sourceHeight: 900,
      minimapRect: { x: 1270, y: 590, width: 300, height: 300 },
      placement: "right",
    })
    const internal = coordinator as unknown as {
      context: {
        phase: "InProgress"
        gameId: number
        mapNumber: number
        puuid: string
        deadParticipantKeys: string[]
      }
      calibration: typeof calibration
      activeSourceFingerprint: string
      lastFullFrameCaptureMs: number
      lastCalibrationValidationMs: number
      captureSessionId: string
      sourceFingerprint(width: number, height: number): string
      processFrame(): Promise<void>
    }
    internal.context = {
      phase: "InProgress",
      gameId: 78,
      mapNumber: 11,
      puuid: "owner",
      deadParticipantKeys: [],
    }
    internal.captureSessionId = "test-session"
    internal.calibration = calibration
    internal.activeSourceFingerprint = internal.sourceFingerprint(1600, 900)

    const firstCaptureAt = performance.now()
    roiFrame.capturedMonotonicMs = firstCaptureAt
    internal.lastFullFrameCaptureMs = firstCaptureAt
    internal.lastCalibrationValidationMs = firstCaptureAt
    await internal.processFrame()

    expect(captureFrame).not.toHaveBeenCalled()
    expect(captureRegion).toHaveBeenCalledOnce()
    expect(captureRegion).toHaveBeenCalledWith({
      sourceRect: calibration.innerMapRect,
      outputWidth: 320,
      outputHeight: 320,
    })

    const refreshCaptureAt = performance.now()
    fullFrame.capturedMonotonicMs = refreshCaptureAt
    internal.lastFullFrameCaptureMs = refreshCaptureAt - 30_001
    internal.lastCalibrationValidationMs = refreshCaptureAt
    await internal.processFrame()

    expect(captureFrame).toHaveBeenCalledOnce()
    expect(captureRegion).toHaveBeenCalledOnce()
    db.close()
  })

  it("installs the minimap telemetry and quality schema", () => {
    const db = new Database(":memory:")
    db.pragma("foreign_keys = ON")

    expect(applyMigrations(db)).toBe(latestSchemaVersion)
    expect(latestSchemaVersion).toBe(35)
    const tables = new Set((db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all() as { name: string }[]).map((row) => row.name))
    for (const table of [
      "minimap_capture_sessions",
      "minimap_calibrations",
      "champion_track_chunks",
      "camp_state_events",
      "camp_clear_events",
      "pathing_analysis_runs",
      "path_segments",
    ]) expect(tables.has(table), table).toBe(true)
    const captureColumns = new Set((db.prepare(
      "PRAGMA table_info(minimap_capture_sessions)",
    ).all() as { name: string }[]).map((column) => column.name))
    for (const column of [
      "capture_attempts",
      "rejected_frames",
      "achieved_fps",
      "p95_frame_gap_ms",
      "maximum_frame_gap_ms",
      "confirmed_observations",
    ]) expect(captureColumns.has(column), column).toBe(true)

    db.close()
  })

  it("waits for an in-flight frame before completing shutdown", async () => {
    const db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    applyMigrations(db)

    let releaseFrame!: () => void
    const pendingFrame = new Promise<RgbaFrame>((resolve) => {
      releaseFrame = () => resolve({
        width: 1,
        height: 1,
        data: new Uint8Array([0, 0, 0, 255]),
        capturedMonotonicMs: performance.now(),
        frameSequence: 1,
      })
    })
    const stop = vi.fn(async () => undefined)
    const backend: MinimapCaptureBackend = {
      id: "electron_desktop_capture",
      start: vi.fn(async () => undefined),
      captureFrame: vi.fn(() => pendingFrame),
      stop,
      getHealth: () => ({ state: "healthy" }),
    }
    const coordinator = new MinimapTelemetryCoordinator(
      backend,
      { request: vi.fn(async () => ({})) },
      new MinimapTelemetryRepository(db),
      undefined,
      undefined,
      undefined,
      undefined,
      new TestVisionWorker(),
    )
    await coordinator.updateContext({
      phase: "InProgress",
      gameId: 42,
      mapNumber: 11,
      puuid: "owner",
      deadParticipantKeys: [],
    })

    let stopped = false
    const stopping = coordinator.stop("aborted").then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)
    expect(stop).not.toHaveBeenCalled()

    releaseFrame()
    await stopping
    expect(stop).toHaveBeenCalledOnce()
    expect(db.prepare(`
      SELECT status FROM minimap_capture_sessions WHERE game_id = 42
    `).get()).toEqual({ status: "aborted" })
    db.close()
  })

  it("supports capture in Practice Tool for detector and jungle-clear tuning", async () => {
    const db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    applyMigrations(db)
    const start = vi.fn(async () => undefined)
    const backend: MinimapCaptureBackend = {
      id: "electron_desktop_capture",
      start,
      captureFrame: vi.fn(async () => { throw new Error("no_test_frame") }),
      stop: vi.fn(async () => undefined),
      getHealth: () => ({ state: "idle" }),
    }
    const coordinator = new MinimapTelemetryCoordinator(
      backend,
      { request: vi.fn() },
      new MinimapTelemetryRepository(db),
      undefined,
      undefined,
      undefined,
      undefined,
      new TestVisionWorker(),
    )

    await coordinator.updateContext({
      phase: "InProgress",
      gameId: 43,
      mapNumber: 11,
      gameMode: "PRACTICETOOL",
      isPracticeTool: true,
      puuid: "owner",
      deadParticipantKeys: [],
    })

    expect(start).toHaveBeenCalledOnce()
    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM minimap_capture_sessions WHERE game_id = 43",
    ).get()).toEqual({ count: 1 })
    await coordinator.stop("aborted")
    db.close()
  })

  it("retries a transient capture-start failure without creating a phantom session", async () => {
    const db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    applyMigrations(db)
    const start = vi.fn()
      .mockRejectedValueOnce(new Error("capture_stream_start_e_invalidarg"))
      .mockResolvedValueOnce(undefined)
    const backend: MinimapCaptureBackend = {
      id: "electron_desktop_capture",
      start,
      captureFrame: vi.fn(async () => { throw new Error("no_test_frame") }),
      stop: vi.fn(async () => undefined),
      getHealth: () => ({ state: "unavailable" }),
    }
    const coordinator = new MinimapTelemetryCoordinator(
      backend,
      { request: vi.fn() },
      new MinimapTelemetryRepository(db),
      undefined,
      { startupRetryBaseMs: 0, startupRetryMaximumMs: 0 },
      undefined,
      undefined,
      new TestVisionWorker(),
    )

    await coordinator.updateContext({
      phase: "InProgress",
      gameId: 44,
      mapNumber: 11,
      puuid: "owner",
      deadParticipantKeys: [],
    })

    expect(coordinator.getHealth()).toMatchObject({
      state: "degraded",
      startupAttempts: 1,
      lastErrorCode: "capture_stream_start_e_invalidarg",
    })
    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM minimap_capture_sessions WHERE game_id = 44",
    ).get()).toEqual({ count: 0 })

    // Retry is coordinator-owned; no Port 2999 success, settings toggle, or
    // phase transition is required after the game window appears.
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2))
    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM minimap_capture_sessions WHERE game_id = 44",
    ).get()).toEqual({ count: 1 })
    await coordinator.stop("aborted")
    db.close()
  })

  it("closes the old capture before starting a new in-progress game", async () => {
    const db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    applyMigrations(db)
    const start = vi.fn(async () => undefined)
    const backend: MinimapCaptureBackend = {
      id: "electron_desktop_capture",
      start,
      captureFrame: vi.fn(async () => ({
        width: 1,
        height: 1,
        data: new Uint8Array([0, 0, 0, 255]),
        capturedMonotonicMs: performance.now(),
        frameSequence: 1,
      })),
      stop: vi.fn(async () => undefined),
      getHealth: () => ({ state: "healthy" }),
    }
    const coordinator = new MinimapTelemetryCoordinator(
      backend,
      { request: vi.fn(async () => { throw new Error("not_ready") }) },
      new MinimapTelemetryRepository(db),
      undefined,
      { maximumConsecutiveFailures: 999 },
      undefined,
      undefined,
      new TestVisionWorker(),
    )

    await coordinator.updateContext({
      phase: "InProgress",
      gameId: 46,
      mapNumber: 11,
      puuid: "owner",
      deadParticipantKeys: [],
    })
    await coordinator.updateContext({
      phase: "InProgress",
      gameId: 47,
      mapNumber: 11,
      puuid: "owner",
      deadParticipantKeys: [],
    })

    expect(start).toHaveBeenCalledTimes(2)
    expect(db.prepare(`
      SELECT game_id AS gameId, status
      FROM minimap_capture_sessions
      ORDER BY started_at, game_id
    `).all()).toEqual([
      { gameId: 46, status: "complete" },
      { gameId: 47, status: "running" },
    ])
    await coordinator.stop("aborted")
    db.close()
  })

  it("closes capture sessions orphaned by an app restart", () => {
    const db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    applyMigrations(db)
    const repository = new MinimapTelemetryRepository(db)
    const sessionId = repository.startCaptureSession({
      gameId: 45,
      puuid: "owner",
      captureBackend: "electron_desktop_capture",
      detectorVersion: 2,
    })

    repository.reconcileOrphanedCaptureSessions(123_456)

    expect(db.prepare(`
      SELECT ended_at AS endedAt, status,
             terminal_error_code AS terminalErrorCode
      FROM minimap_capture_sessions WHERE session_id = ?
    `).get(sessionId)).toEqual({
      endedAt: 123_456,
      status: "aborted",
      terminalErrorCode: "capture_process_restarted",
    })
    db.close()
  })
})
