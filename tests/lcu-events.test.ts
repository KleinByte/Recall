import { describe, expect, it, vi } from "vitest"
import { LcuEvents } from "../electron/main/lcu-events.js"
import { LCUEvents } from "../electron/main/interface.js"

const credentials = {
  address: "127.0.0.1",
  port: 50329,
  username: "riot",
  password: "local-secret",
  protocol: "https",
}

function message(phase: string) {
  return JSON.stringify([8, LCUEvents.GameSession, {
    data: {
      phase,
      gameData: { gameId: 1, playerChampionSelections: [] },
    },
  }])
}

describe("LcuEvents gameflow semantics", () => {
  it("does not turn Reconnect into game end and deduplicates InProgress start", () => {
    const events = new LcuEvents(credentials)
    const start = vi.fn()
    const legacyEnd = vi.fn()
    const phases: string[] = []
    events.on("game-start", start)
    events.on("game-end", legacyEnd)
    events.on("phase", (phase) => phases.push(phase))
    const handle = (events as unknown as { handleMessage(raw: string): void })
      .handleMessage.bind(events)

    handle(message("InProgress"))
    handle(message("InProgress"))
    handle(message("Reconnect"))
    handle(message("InProgress"))

    expect(start).toHaveBeenCalledOnce()
    expect(legacyEnd).not.toHaveBeenCalled()
    expect(phases).toEqual(["InProgress", "InProgress", "Reconnect", "InProgress"])
    events.stop()
  })

  it("reconciles a missed terminal phase before the next game starts", () => {
    const events = new LcuEvents(credentials)
    const start = vi.fn()
    events.on("game-start", start)
    const handle = (events as unknown as { handleMessage(raw: string): void })
      .handleMessage.bind(events)

    handle(message("InProgress"))
    events.reconcilePhase("Lobby")
    handle(message("InProgress"))

    expect(start).toHaveBeenCalledTimes(2)
    events.stop()
  })

  it("forwards end-of-game identity so delayed terminal events can be rejected", () => {
    const events = new LcuEvents(credentials)
    const end = vi.fn()
    events.on("end-of-game", end)
    const handle = (events as unknown as { handleMessage(raw: string): void })
      .handleMessage.bind(events)

    handle(JSON.stringify([8, LCUEvents.EndOfGameStats, {
      data: { gameId: 77 },
    }]))

    expect(end).toHaveBeenCalledWith({ gameId: 77 })
    events.stop()
  })
})
