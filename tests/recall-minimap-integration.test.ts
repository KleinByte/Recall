import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  BrowserWindow: class {},
  desktopCapturer: { getSources: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() },
}))

import {
  hasAuthoritativeCaptureClassification,
  isPracticeToolSession,
  RecallMinimapIntegration,
} from "../electron/main/minimap/recall-minimap-integration.js"

function databaseStub() {
  const sql: string[] = []
  return {
    sql,
    database: {
      prepare: vi.fn((statement: string) => {
        sql.push(statement)
        return {
          run: vi.fn(),
          all: vi.fn(() => []),
          get: vi.fn(),
        }
      }),
    },
  }
}

const practiceSession = {
  phase: "InProgress" as const,
  gameId: 99,
  mapId: 11,
  gameMode: "CLASSIC",
  gameType: "Practice",
}

const normalSession = {
  phase: "InProgress" as const,
  gameId: 100,
  mapId: 11,
  queueId: 420,
  gameMode: "CLASSIC",
}

function unavailableCaptureBackend() {
  return {
    id: "electron_desktop_capture" as const,
    start: vi.fn().mockRejectedValue(new Error("capture_unavailable_in_test")),
    captureFrame: vi.fn().mockRejectedValue(new Error("no_test_frame")),
    stop: vi.fn().mockResolvedValue(undefined),
    getHealth: vi.fn(() => ({ state: "unavailable" as const })),
  }
}

function runningCaptureBackend() {
  return {
    id: "electron_desktop_capture" as const,
    start: vi.fn().mockResolvedValue(undefined),
    captureFrame: vi.fn().mockRejectedValue(new Error("no_test_frame")),
    stop: vi.fn().mockResolvedValue(undefined),
    getHealth: vi.fn(() => ({ state: "healthy" as const })),
  }
}

describe("RecallMinimapIntegration session policy", () => {
  it("excludes a CLASSIC Practice session before capture starts", async () => {
    const { database, sql } = databaseStub()
    const integration = new RecallMinimapIntegration({
      gameClient: { request: vi.fn() },
      database,
      puuid: "owner",
      getEnabled: () => true,
      getDataDragonVersion: () => undefined,
    })
    const state = integration as unknown as {
      lastGameId?: number
      lastRosterSignature: string
    }
    state.lastGameId = 98
    state.lastRosterSignature = "stale-normal-game-roster"

    expect(isPracticeToolSession(practiceSession)).toBe(true)
    await integration.update(practiceSession)
    await integration.completeMatch()

    expect(integration.getHealth().state).toBe("idle")
    expect(state.lastGameId).toBeUndefined()
    expect(state.lastRosterSignature).toBe("")
    expect(sql.some((statement) =>
      /INSERT INTO minimap_capture_sessions/i.test(statement),
    )).toBe(false)
    expect(sql.some((statement) =>
      /INSERT INTO pathing_analysis_runs/i.test(statement),
    )).toBe(false)
  })

  it("retries calibration hints after a transient read failure", async () => {
    const { database } = databaseStub()
    const getCalibrationHints = vi.fn()
      .mockRejectedValueOnce(new Error("game_cfg_temporarily_locked"))
      .mockResolvedValueOnce({ minimapScale: 1.25 })
    const integration = new RecallMinimapIntegration({
      gameClient: { request: vi.fn() },
      database,
      puuid: "owner",
      getEnabled: () => true,
      getDataDragonVersion: () => undefined,
      getCalibrationHints,
    })
    const classifiedNonCaptureSession = {
      ...normalSession,
      mapId: 12,
      gameType: "MATCHED_GAME",
    }

    await integration.update(classifiedNonCaptureSession)
    await integration.update(classifiedNonCaptureSession)
    await integration.update(classifiedNonCaptureSession)

    expect(getCalibrationHints).toHaveBeenCalledTimes(2)
  })

  it("defers CLASSIC capture until game type or a definitive queue is known", async () => {
    const { database } = databaseStub()
    const captureBackend = unavailableCaptureBackend()
    const integration = new RecallMinimapIntegration({
      gameClient: { request: vi.fn() },
      database,
      puuid: "owner",
      getEnabled: () => true,
      getDataDragonVersion: () => undefined,
      captureBackend,
    })
    const unclassified = {
      phase: "InProgress" as const,
      gameId: 101,
      mapId: 11,
      gameMode: "CLASSIC",
    }

    expect(hasAuthoritativeCaptureClassification(unclassified)).toBe(false)
    await integration.update(unclassified)
    expect(captureBackend.start).not.toHaveBeenCalled()

    const classifiedByQueue = { ...unclassified, queueId: 420 }
    expect(hasAuthoritativeCaptureClassification(classifiedByQueue)).toBe(true)
    await integration.update(classifiedByQueue)
    expect(captureBackend.start).toHaveBeenCalledTimes(1)
  })

  it("allows an explicit settings off/on cycle to retry the same failed game", async () => {
    const { database } = databaseStub()
    const captureBackend = unavailableCaptureBackend()
    let enabled = true
    const integration = new RecallMinimapIntegration({
      gameClient: { request: vi.fn() },
      database,
      puuid: "owner",
      getEnabled: () => enabled,
      getDataDragonVersion: () => undefined,
      captureBackend,
    })

    await integration.update(normalSession)
    for (let index = 0; index < 10; index += 1) {
      await integration.update(normalSession)
    }
    expect(captureBackend.start).toHaveBeenCalledTimes(1)

    enabled = false
    await integration.update(normalSession)
    enabled = true
    await integration.update(normalSession)

    expect(captureBackend.start).toHaveBeenCalledTimes(2)
  })

  it("reads the final game id after pending updates settle", async () => {
    const { database, sql } = databaseStub()
    const integration = new RecallMinimapIntegration({
      gameClient: { request: vi.fn() },
      database,
      puuid: "owner",
      getEnabled: () => true,
      getDataDragonVersion: () => undefined,
      captureBackend: unavailableCaptureBackend(),
    })

    const pendingUpdate = integration.update(normalSession)
    const pendingCompletion = integration.completeMatch()
    await pendingUpdate
    await pendingCompletion

    expect(sql.some((statement) =>
      /INSERT INTO pathing_analysis_runs/i.test(statement),
    )).toBe(true)
  })

  it("stops the old capture before an InProgress game id change", async () => {
    const { database } = databaseStub()
    const captureBackend = runningCaptureBackend()
    const integration = new RecallMinimapIntegration({
      gameClient: {
        request: vi.fn().mockRejectedValue(new Error("no_live_test_data")),
      },
      database,
      puuid: "owner",
      getEnabled: () => true,
      getDataDragonVersion: () => undefined,
      captureBackend,
    })

    await integration.update(normalSession)
    await integration.update({ ...normalSession, gameId: 102 })

    expect(captureBackend.stop).toHaveBeenCalledTimes(1)
    expect(captureBackend.start).toHaveBeenCalledTimes(2)
    expect(captureBackend.stop.mock.invocationCallOrder[0]).toBeLessThan(
      captureBackend.start.mock.invocationCallOrder[1],
    )
    await integration.stop()
  })

  it("also recognizes Practice metadata from the in-game snapshot", () => {
    expect(isPracticeToolSession({
      phase: "InProgress",
      gameId: 100,
      mapId: 11,
      gameMode: "CLASSIC",
      game: {
        gameMode: "CLASSIC",
        gameType: "Practice",
        allies: [],
        enemies: [],
      },
    })).toBe(true)
    expect(hasAuthoritativeCaptureClassification({
      phase: "InProgress",
      gameId: 100,
      mapId: 11,
      gameMode: "CLASSIC",
      game: {
        gameMode: "CLASSIC",
        gameType: "MATCHED_GAME",
        allies: [],
        enemies: [],
      },
    })).toBe(true)
  })
})
