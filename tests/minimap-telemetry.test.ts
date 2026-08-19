import Database from "better-sqlite3-node"
import { describe, expect, it, vi } from "vitest"
import { applyMigrations, latestSchemaVersion } from "../electron/main/database/migrations.js"
import { MinimapTelemetryRepository } from "../electron/main/database/minimap-telemetry-repo.js"
import { CAMP_BY_KEY } from "../electron/main/jungle/camp-map.js"
import { CampTemplateBank } from "../electron/main/jungle/camp-visual-detector.js"
import { MinimapTelemetryCoordinator } from
  "../electron/main/minimap/minimap-telemetry-coordinator.js"
import type { MinimapCaptureBackend } from
  "../electron/main/minimap/capture-backend.js"
import { boundedRect, cropFrame } from "../electron/main/minimap/image-ops.js"
import type {
  ChampionTrackSnapshot,
  RgbaFrame,
} from "../src/shared/minimap/contracts.js"
import {
  ChampionMarkerDetector,
  createChampionMarkerTemplate,
  type ChampionMarkerProposalFootprint,
} from "../electron/main/minimap/champion-marker-detector.js"

function frame(width: number, height: number, fill: [number, number, number, number]) {
  const data = new Uint8Array(width * height * 4)
  for (let index = 0; index < width * height; index += 1) data.set(fill, index * 4)
  return { width, height, data, capturedMonotonicMs: 0, frameSequence: 1 }
}

function setPixel(target: RgbaFrame, x: number, y: number, rgba: ArrayLike<number>) {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height) return
  target.data.set(rgba, (y * target.width + x) * 4)
}

function patternedIcon(size: number, invert = false) {
  const result = frame(size, size, [25, 25, 25, 255])
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const on = ((x * 3 + y * 5 + Math.floor(x / 3)) % 11) < 5
      const value = on !== invert ? 220 : 48
      setPixel(result, x, y, [value, value, value, 255])
    }
  }
  return result
}

function drawMarker(target: RgbaFrame, icon: RgbaFrame, centerX: number, centerY: number) {
  for (let y = centerY - 10; y <= centerY + 10; y += 1) {
    for (let x = centerX - 10; x <= centerX + 10; x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY)
      if (distance >= 7 && distance <= 10) setPixel(target, x, y, [255, 20, 20, 255])
    }
  }
  for (let y = 0; y < icon.height; y += 1) {
    for (let x = 0; x < icon.width; x += 1) {
      const source = (y * icon.width + x) * 4
      setPixel(
        target,
        centerX - 7 + x,
        centerY - 7 + y,
        icon.data.subarray(source, source + 4),
      )
    }
  }
}

function campVisualFrame(state: "alive" | "dead") {
  const target = frame(320, 320, [12, 18, 20, 255])
  const camp = CAMP_BY_KEY.get("west_blue")!
  const radiusX = target.width * camp.patchRadius
  const radiusY = target.height * camp.patchRadius
  const rect = boundedRect({
    x: target.width * camp.center.x - radiusX,
    y: target.height * camp.center.y - radiusY,
    width: radiusX * 2,
    height: radiusY * 2,
  }, target.width, target.height)
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const value = state === "alive"
        ? (x + y) % 2 === 0 ? 238 : 16
        : 48 + ((x * 7 + y * 11) % 58)
      setPixel(target, rect.x + x, rect.y + y, [value, value, value, 255])
    }
  }
  return { target, patch: cropFrame(target, rect) }
}

describe("minimap telemetry integration", () => {
  it("abstains when one roster identity appears at two positions", () => {
    const canvas = frame(100, 80, [8, 10, 12, 255])
    const icon = patternedIcon(15)
    drawMarker(canvas, icon, 25, 25)
    drawMarker(canvas, icon, 72, 48)
    const templates = [
      createChampionMarkerTemplate({
        participantKey: "enemy:ahri",
        championName: "Ahri",
        team: "enemy",
        isLocal: false,
      }, icon, 18),
      createChampionMarkerTemplate({
        participantKey: "enemy:zed",
        championName: "Zed",
        team: "enemy",
        isLocal: false,
      }, patternedIcon(15, true), 18),
    ]
    const detector = new ChampionMarkerDetector(undefined, {
      minimumRingScore: 0.45,
      minimumIdentityScore: 0.35,
      minimumIdentityMargin: 0.01,
    })

    const found = detector.detect({
      frame: canvas,
      templates,
      gameId: 7,
      gameTimeMs: 12_345,
    })

    expect(found).toEqual([])
  })

  it("persists only confirmed camp transitions at their first supporting time", () => {
    const db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    applyMigrations(db)
    const alive = campVisualFrame("alive")
    const dead = campVisualFrame("dead")
    const campTemplates = new CampTemplateBank()
    campTemplates.add("west_blue", "alive", alive.patch)
    campTemplates.add("west_blue", "dead", dead.patch)
    const backend: MinimapCaptureBackend = {
      id: "electron_desktop_capture",
      start: vi.fn(async () => undefined),
      captureFrame: vi.fn(async () => alive.target),
      stop: vi.fn(async () => undefined),
      getHealth: () => ({ state: "healthy" }),
    }
    const coordinator = new MinimapTelemetryCoordinator(
      backend,
      { request: vi.fn(async () => ({})) },
      new MinimapTelemetryRepository(db),
      campTemplates,
    )
    const internal = coordinator as unknown as {
      processCampFrame(
        context: {
          phase: "InProgress"
          gameId: number
          mapNumber: number
          puuid: string
          localParticipantKey?: string
          deadParticipantKeys: string[]
        },
        minimap: RgbaFrame,
        gameTimeMs: number,
        markerProposals?: readonly ChampionMarkerProposalFootprint[],
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
      alive.target.frameSequence = index + 1
      internal.processCampFrame(context, alive.target, gameTimeMs)
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
    // These later samples are closer to confirmation, but not to the first
    // visually absent frame and therefore must not drive attribution.
    internal.recordTrackHistory(3_500, [localTrack({ x: 0.95, y: 0.05 })], [])
    internal.recordEvidenceHistory(3_500, {
      elapsedMs: 500,
      goldDelta: 0,
      estimatedPassiveGold: 0,
      goldResidual: 0,
      creepScoreDelta: 0,
    })
    for (const [index, gameTimeMs] of [2_500, 3_000, 3_500].entries()) {
      dead.target.frameSequence = index + 4
      internal.processCampFrame(context, dead.target, gameTimeMs)
    }
    for (const [index, gameTimeMs] of [4_000, 4_500, 5_000].entries()) {
      alive.target.frameSequence = index + 7
      internal.processCampFrame(context, alive.target, gameTimeMs)
    }
    dead.target.frameSequence = 10
    internal.processCampFrame(context, dead.target, 5_500)
    dead.target.frameSequence = 11
    const unmatchedMarkerFrame = frame(320, 320, [8, 10, 12, 255])
    drawMarker(
      unmatchedMarkerFrame,
      frame(15, 15, [127, 127, 127, 255]),
      Math.round(campCenter.x * 319),
      Math.round(campCenter.y * 319),
    )
    const unmatchedMarkerDetector = new ChampionMarkerDetector()
    expect(unmatchedMarkerDetector.detect({
      frame: unmatchedMarkerFrame,
      templates: [],
      gameId: 77,
      gameTimeMs: 6_000,
    })).toEqual([])
    const unmatchedMarkerProposals = unmatchedMarkerDetector.getProposalFootprints()
    expect(unmatchedMarkerProposals).toHaveLength(1)
    internal.processCampFrame(context, dead.target, 6_000, unmatchedMarkerProposals)
    for (const [index, gameTimeMs] of [6_500, 7_000, 7_500].entries()) {
      dead.target.frameSequence = index + 12
      internal.processCampFrame(context, dead.target, gameTimeMs)
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
      SELECT cleared_at_ms AS clearedAtMs, attribution, evidence_json AS evidenceJson
      FROM camp_clear_events
      WHERE game_id = 77 AND puuid = 'owner' AND camp_key = 'west_blue'
      ORDER BY cleared_at_ms
    `).all() as Array<{ clearedAtMs: number; attribution: string; evidenceJson: string }>
    expect(storedClears.map(({ clearedAtMs }) => clearedAtMs)).toEqual([2_500, 6_500])
    expect(storedClears[0]).toMatchObject({
      clearedAtMs: 2_500,
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

  it("installs the minimap telemetry and quality schema", () => {
    const db = new Database(":memory:")
    db.pragma("foreign_keys = ON")

    expect(applyMigrations(db)).toBe(latestSchemaVersion)
    expect(latestSchemaVersion).toBe(34)
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

  it("never starts capture for Practice Tool", async () => {
    const db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    applyMigrations(db)
    const start = vi.fn(async () => undefined)
    const backend: MinimapCaptureBackend = {
      id: "electron_desktop_capture",
      start,
      captureFrame: vi.fn(async () => { throw new Error("unexpected_capture") }),
      stop: vi.fn(async () => undefined),
      getHealth: () => ({ state: "idle" }),
    }
    const coordinator = new MinimapTelemetryCoordinator(
      backend,
      { request: vi.fn() },
      new MinimapTelemetryRepository(db),
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

    expect(start).not.toHaveBeenCalled()
    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM minimap_capture_sessions WHERE game_id = 43",
    ).get()).toEqual({ count: 0 })
    db.close()
  })

  it("records a structured capture-start failure instead of a phantom running session", async () => {
    const db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    applyMigrations(db)
    const backend: MinimapCaptureBackend = {
      id: "electron_desktop_capture",
      start: vi.fn(async () => { throw new Error("capture_stream_start_e_invalidarg") }),
      captureFrame: vi.fn(async () => { throw new Error("unexpected_capture") }),
      stop: vi.fn(async () => undefined),
      getHealth: () => ({ state: "unavailable" }),
    }
    const coordinator = new MinimapTelemetryCoordinator(
      backend,
      { request: vi.fn() },
      new MinimapTelemetryRepository(db),
    )

    await coordinator.updateContext({
      phase: "InProgress",
      gameId: 44,
      mapNumber: 11,
      puuid: "owner",
      deadParticipantKeys: [],
    })

    expect(db.prepare(`
      SELECT status, terminal_error_code AS terminalErrorCode
      FROM minimap_capture_sessions WHERE game_id = 44
    `).get()).toEqual({
      status: "capture_unavailable",
      terminalErrorCode: "capture_stream_start_e_invalidarg",
    })

    // The game-client poller can deliver the same context again shortly
    // after startup fails. It must not create another phantom session.
    await coordinator.updateContext({
      phase: "InProgress",
      gameId: 44,
      mapNumber: 11,
      puuid: "owner",
      deadParticipantKeys: [],
    })
    expect(backend.start).toHaveBeenCalledTimes(1)
    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM minimap_capture_sessions WHERE game_id = 44",
    ).get()).toEqual({ count: 1 })

    // Leaving InProgress explicitly clears the latch, so a deliberate
    // telemetry off/on cycle remains an intentional retry path.
    await coordinator.updateContext({
      phase: "Idle",
      gameId: 44,
      puuid: "owner",
      deadParticipantKeys: [],
    })
    await coordinator.updateContext({
      phase: "InProgress",
      gameId: 44,
      mapNumber: 11,
      puuid: "owner",
      deadParticipantKeys: [],
    })
    expect(backend.start).toHaveBeenCalledTimes(2)
    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM minimap_capture_sessions WHERE game_id = 44",
    ).get()).toEqual({ count: 2 })
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
