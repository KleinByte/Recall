import { EventEmitter } from "node:events"
import { WebSocket } from "ws"
import { buildAuthHeader } from "./lcu-client.js"
import type { LcuCredentials } from "./lcu-discovery.js"
import {
  LCUEvents,
  type ChampSelectSessionEvent,
  type LCUEventMessage,
} from "./interface.js"

/** The client refuses WebSocket connections for a short time after launching. */
const CONNECT_DELAY_MS = 10_000
const RECONNECT_DELAY_MS = 15_000

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
 * Emits `pick`, `game-start`, `game-end` and `end-of-game`. Connection
 * failures are retried quietly, since the client is frequently unavailable
 * while starting.
 */
export class LcuEvents extends EventEmitter {
  private socket?: WebSocket
  private timer?: NodeJS.Timeout
  private stopped = false
  private inGame = false

  constructor(private readonly credentials: LcuCredentials) {
    super()
  }

  start() {
    this.stopped = false
    this.timer = setTimeout(() => this.connect(), CONNECT_DELAY_MS)
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.socket?.removeAllListeners()
    this.socket?.close()
    this.socket = undefined
  }

  private connect() {
    if (this.stopped) return

    const { address, port } = this.credentials

    const socket = new WebSocket(`wss://${address}:${port}/`, "wamp", {
      headers: { Authorization: buildAuthHeader(this.credentials) },
      rejectUnauthorized: false,
    })

    socket.on("open", () => {
      // 5 means subscribe.
      socket.send(`[5, "${LCUEvents.EndOfGameStats}"]`)
      socket.send(`[5, "${LCUEvents.ChampSelectSession}"]`)
      socket.send(`[5, "${LCUEvents.GameSession}"]`)
    })

    socket.on("message", (raw) => this.handleMessage(raw.toString()))

    socket.on("error", (error) => {
      console.warn(`League Client event stream error: ${error.message}`)
    })

    socket.on("close", () => {
      if (this.stopped) return
      this.timer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS)
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
        this.emit("end-of-game")
        break

      case LCUEvents.ChampSelectSession: {
        const championId = parseSessionEvent(event.data)
        if (championId !== undefined && championId < 0) {
          this.emit("pick", null)
        } else if (championId) {
          this.emit("pick", championId)
        }
        break
      }

      case LCUEvents.GameSession:
        if (event.data.phase === "InProgress") {
          this.inGame = true
          this.emit(
            "game-start",
            event.data.gameData.playerChampionSelections,
          )
        } else if (this.inGame) {
          // Leaving a game is the earliest reliable sign that one finished.
          // The end-of-game screen follows, but is skipped entirely if the
          // player closes it quickly or the client restarts.
          this.inGame = false
          this.emit("game-end")
        }
        break
    }
  }
}
