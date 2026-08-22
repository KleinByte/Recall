import { EventEmitter } from "node:events"
import { WebSocket } from "ws"
import { buildAuthHeader } from "./lcu-client.js"
import { assertLoopbackLcuCredentials } from "./lcu-discovery.js"
import type { LcuCredentials } from "./lcu-discovery.js"
import {
  LCUEvents,
  type ChampSelectSessionEvent,
  type LCUEventMessage,
} from "./interface.js"

const INITIAL_RECONNECT_DELAY_MS = 500
const MAXIMUM_RECONNECT_DELAY_MS = 15_000

function parseSessionEvent(event: ChampSelectSessionEvent) {
  return event.actions
    .flat()
    .find(
      (action) =>
        action.isAllyAction === true &&
        action.type === "pick" &&
        action.actorCellId === event.localPlayerCellId,
    )?.championId
}

function parseEventMessage(message: string) {
  const [, type, payload] = JSON.parse(message) as [number, LCUEvents, any]
  return { type, data: payload.data }
}

/**
 * Subscribes to the League Client event stream.
 *
 * Emits `pick`, `game-start`, gameflow `phase` and `end-of-game`. Connection
 * failures are retried quietly, since the client is frequently unavailable
 * while starting.
 */
export class LcuEvents extends EventEmitter {
  private socket?: WebSocket
  private timer?: NodeJS.Timeout
  private stopped = true
  private inGame = false
  private reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS
  private readonly credentials: LcuCredentials

  constructor(credentials: LcuCredentials) {
    super()
    this.credentials = assertLoopbackLcuCredentials(credentials)
  }

  start() {
    if (!this.stopped || this.timer || this.socket) return
    this.stopped = false
    this.connect()
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.socket?.removeAllListeners()
    this.socket?.terminate()
    this.socket = undefined
    this.removeAllListeners()
  }

  /** Aligns edge-triggered event state after HTTP reconciliation on reconnect. */
  reconcilePhase(phase: string) {
    if (phase === "InProgress") this.inGame = true
    else if (phase !== "Reconnect" && phase !== "GameStart") this.inGame = false
  }

  private connect() {
    this.timer = undefined
    if (this.stopped || this.socket) return

    const { address, port } = this.credentials

    const socket = new WebSocket(`wss://${address}:${port}/`, "wamp", {
      headers: { Authorization: buildAuthHeader(this.credentials) },
      rejectUnauthorized: false,
    })

    socket.on("open", () => {
      this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS
      // 5 means subscribe.
      socket.send(`[5, "${LCUEvents.EndOfGameStats}"]`)
      socket.send(`[5, "${LCUEvents.ChampSelectSession}"]`)
      socket.send(`[5, "${LCUEvents.GameSession}"]`)
      // WebSocket events are hints rather than a replayable log. Callers must
      // reconcile the current HTTP phase whenever a transport opens.
      this.emit("connected")
    })

    socket.on("message", (raw) => this.handleMessage(raw.toString()))

    socket.on("error", (error) => {
      console.warn(`League Client event stream error: ${error.message}`)
    })

    socket.on("close", () => {
      if (this.socket === socket) this.socket = undefined
      if (this.stopped) return
      this.emit("disconnected")
      const delay = this.reconnectDelayMs
      this.reconnectDelayMs = Math.min(
        MAXIMUM_RECONNECT_DELAY_MS,
        this.reconnectDelayMs * 2,
      )
      this.timer = setTimeout(() => this.connect(), delay)
    })

    this.socket = socket
  }

  private handleMessage(raw: string) {
    let event: LCUEventMessage

    try {
      event = parseEventMessage(raw) as LCUEventMessage
    } catch {
      return
    }

    switch (event.type) {
      case LCUEvents.EndOfGameStats:
        this.emit("end-of-game", event.data)
        break

      case LCUEvents.ChampSelectSession: {
        if (!event.data || !Array.isArray(event.data.actions)) break
        this.emit("champ-select", event.data)
        const championId = parseSessionEvent(event.data)
        if (championId !== undefined && championId < 0) {
          this.emit("pick", null)
        } else if (championId) {
          this.emit("pick", championId)
        }
        break
      }

      case LCUEvents.GameSession:
        if (!event.data || typeof event.data.phase !== "string") break
        this.emit("phase", event.data.phase)
        if (event.data.phase === "InProgress") {
          if (!this.inGame) {
            this.inGame = true
            this.emit(
              "game-start",
              event.data.gameData?.playerChampionSelections ?? [],
            )
          }
        } else if (event.data.phase !== "Reconnect" &&
            event.data.phase !== "GameStart") {
          // Reconnect is explicitly nonterminal: the game process may return
          // and the same logical capture must resume. The lifecycle reducer
          // decides whether every other phase is terminal using Port 2999 too.
          this.inGame = false
        }
        break
    }
  }
}
