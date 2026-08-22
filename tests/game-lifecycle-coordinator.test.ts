import { describe, expect, it } from "vitest"
import { GameLifecycleCoordinator } from "../electron/main/game-lifecycle-coordinator.js"

describe("GameLifecycleCoordinator", () => {
  it("keeps tracking across an LCU UI disconnect while Port 2999 remains alive", () => {
    const lifecycle = new GameLifecycleCoordinator()
    lifecycle.observeSession("InProgress", 10, 1)
    lifecycle.observePortAvailable(2)

    expect(lifecycle.observeLcuDisconnected(3)).toEqual({ type: "none" })
    expect(lifecycle.snapshot()).toMatchObject({
      stage: "tracking",
      gameId: 10,
      lcuConnected: false,
      portAvailable: true,
    })
  })

  it("starts tracking from Port 2999 when LCU drops during champion select", () => {
    const lifecycle = new GameLifecycleCoordinator()
    lifecycle.observeSession("ChampSelect", 101, 1)
    lifecycle.observeLcuDisconnected(2)

    expect(lifecycle.observePortAvailable(3)).toEqual({ type: "none" })
    expect(lifecycle.snapshot()).toMatchObject({
      stage: "tracking",
      gameId: 101,
      lcuConnected: false,
      portAvailable: true,
      trackingStartedAt: 3,
    })
  })

  it("treats Reconnect as suspension and resumes the same logical game", () => {
    const lifecycle = new GameLifecycleCoordinator()
    lifecycle.observeSession("InProgress", 11, 1)
    lifecycle.observePortAvailable(2)
    lifecycle.observeLcuPhase("Reconnect", 3)

    expect(lifecycle.observePortUnavailable(4)).toEqual({ type: "none" })
    expect(lifecycle.snapshot().stage).toBe("suspended")

    lifecycle.observeSession("InProgress", 11, 5)
    lifecycle.observePortAvailable(6)
    expect(lifecycle.snapshot()).toMatchObject({
      stage: "tracking",
      gameId: 11,
      portAvailable: true,
    })
  })

  it("waits for terminal grace and finalizes only once", () => {
    const lifecycle = new GameLifecycleCoordinator({ terminalGraceMs: 10 })
    lifecycle.observeSession("InProgress", 12, 1)
    lifecycle.observePortAvailable(2)
    lifecycle.observeLcuPhase("WaitingForStats", 20)
    lifecycle.observePortUnavailable(21)

    expect(lifecycle.tick(29)).toEqual({ type: "none" })
    expect(lifecycle.tick(30)).toEqual({
      type: "finalize",
      outcome: "complete",
      reason: "WaitingForStats",
      gameId: 12,
    })
    expect(lifecycle.tick(31)).toEqual({ type: "none" })
  })

  it("accepts end-of-game stats as strong terminal evidence", () => {
    const lifecycle = new GameLifecycleCoordinator()
    lifecycle.observeSession("InProgress", 13, 1)
    lifecycle.observePortAvailable(2)

    expect(lifecycle.observeStrongTerminal("end_of_game_stats", 3)).toMatchObject({
      type: "finalize",
      outcome: "complete",
      gameId: 13,
    })
    expect(lifecycle.observeStrongTerminal("duplicate", 4)).toEqual({ type: "none" })
  })

  it("ignores delayed end-of-game stats for a different game id", () => {
    const lifecycle = new GameLifecycleCoordinator()
    lifecycle.observeSession("InProgress", 130, 1)
    lifecycle.observePortAvailable(2)

    expect(lifecycle.observeStrongTerminal("end_of_game_stats", 3, 129))
      .toEqual({ type: "none" })
    expect(lifecycle.snapshot().stage).toBe("tracking")
  })

  it("aborts a source loss that never receives terminal evidence", () => {
    const lifecycle = new GameLifecycleCoordinator({ abandonmentMs: 50 })
    lifecycle.observeSession("InProgress", 14, 1)
    lifecycle.observePortAvailable(2)
    lifecycle.observeLcuDisconnected(3)
    lifecycle.observePortUnavailable(4)

    expect(lifecycle.tick(51)).toEqual({ type: "none" })
    expect(lifecycle.tick(52)).toEqual({
      type: "finalize",
      outcome: "aborted",
      reason: "game_source_timeout",
      gameId: 14,
    })
  })

  it("clears a dodged draft without manufacturing a completed game", () => {
    const lifecycle = new GameLifecycleCoordinator()
    lifecycle.observeSession("ChampSelect", 15, 1)

    expect(lifecycle.observeLcuPhase("Lobby", 2)).toEqual({ type: "clear_draft" })
    expect(lifecycle.snapshot().stage).toBe("idle")
    expect(lifecycle.snapshot().gameId).toBeUndefined()
  })

  it("requires the previous game to finalize before replacing its identity", () => {
    const lifecycle = new GameLifecycleCoordinator()
    lifecycle.observeSession("InProgress", 16, 1)
    lifecycle.observePortAvailable(2)

    expect(lifecycle.observeSession("InProgress", 17, 3)).toEqual({
      type: "finalize",
      outcome: "complete",
      reason: "game_id_changed",
      gameId: 16,
    })
    expect(lifecycle.snapshot().gameId).toBe(16)
  })

  it("recovers an interrupted finalization instead of remaining stuck", () => {
    const lifecycle = new GameLifecycleCoordinator({ terminalGraceMs: 10 })
    lifecycle.restore({
      stage: "finalizing",
      gameId: 17,
      lcuConnected: false,
      portAvailable: false,
      trackingStartedAt: 2,
      terminalCandidateAt: 20,
      terminalReason: "WaitingForStats",
    })

    expect(lifecycle.snapshot().stage).toBe("ending")
    expect(lifecycle.tick(29)).toEqual({ type: "none" })
    expect(lifecycle.tick(30)).toEqual({
      type: "finalize",
      outcome: "complete",
      reason: "WaitingForStats",
      gameId: 17,
    })
  })

  it("expires an abandoned disconnected draft without recording a game", () => {
    const lifecycle = new GameLifecycleCoordinator({ abandonmentMs: 50 })
    lifecycle.observeSession("ChampSelect", 18, 1)
    lifecycle.observeLcuDisconnected(2)

    expect(lifecycle.tick(50)).toEqual({ type: "none" })
    expect(lifecycle.tick(51)).toEqual({ type: "clear_draft" })
    expect(lifecycle.snapshot().stage).toBe("idle")
  })

  it("does not manufacture a completed match when the game process never appeared", () => {
    const lifecycle = new GameLifecycleCoordinator({ terminalGraceMs: 10 })
    lifecycle.observeSession("InProgress", 19, 1)
    lifecycle.observeLcuPhase("Lobby", 2)

    expect(lifecycle.observePortUnavailable(12)).toEqual({
      type: "finalize",
      outcome: "aborted",
      reason: "Lobby",
      gameId: 19,
    })
  })
})
