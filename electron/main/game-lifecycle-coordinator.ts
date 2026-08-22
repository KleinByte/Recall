export type GameLifecycleStage =
  | "idle"
  | "champ_select"
  | "launching"
  | "tracking"
  | "suspended"
  | "ending"
  | "finalizing"

export type GameFinalizationOutcome = "complete" | "aborted"

export interface GameLifecycleSnapshot {
  stage: GameLifecycleStage
  gameId?: number
  lcuConnected: boolean
  lcuPhase?: string
  portAvailable: boolean
  startedAt?: number
  trackingStartedAt?: number
  lastLcuSeenAt?: number
  lastPortSeenAt?: number
  suspendedAt?: number
  terminalCandidateAt?: number
  terminalReason?: string
}

export type GameLifecycleEffect =
  | { type: "none" }
  | { type: "clear_draft" }
  | {
      type: "finalize"
      outcome: GameFinalizationOutcome
      reason: string
      gameId?: number
    }

export interface GameLifecycleOptions {
  /** Lets the last Port 2999 snapshot and capture frame settle after gameflow ends. */
  terminalGraceMs: number
  /** A source loss with no terminal evidence is interruption, not a completed match. */
  abandonmentMs: number
}

const DEFAULT_OPTIONS: GameLifecycleOptions = {
  terminalGraceMs: 3_000,
  abandonmentMs: 5 * 60_000,
}

const ACTIVE_STAGES = new Set<GameLifecycleStage>([
  "launching",
  "tracking",
  "suspended",
  "ending",
])

const TERMINAL_PHASES = new Set([
  "PreEndOfGame",
  "WaitingForStats",
  "EndOfGame",
  "TerminatedInError",
])

const NEUTRAL_PHASES = new Set([
  "None",
  "Lobby",
  "Matchmaking",
  "ReadyCheck",
])

const none = (): GameLifecycleEffect => ({ type: "none" })

/**
 * Reduces independent LCU and Port 2999 evidence into one logical game.
 *
 * LCU is a control plane: losing it never ends a running capture. Port 2999
 * is game-process evidence: losing it suspends a game until terminal evidence
 * or a bounded abandonment timeout resolves the session.
 */
export class GameLifecycleCoordinator {
  private readonly options: GameLifecycleOptions
  private current: GameLifecycleSnapshot

  constructor(
    options: Partial<GameLifecycleOptions> = {},
    initial?: Partial<GameLifecycleSnapshot>,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.current = {
      stage: "idle",
      lcuConnected: false,
      portAvailable: false,
      ...initial,
    }
  }

  snapshot(): GameLifecycleSnapshot {
    return { ...this.current }
  }

  restore(snapshot: GameLifecycleSnapshot) {
    const interruptedFinalization = snapshot.stage === "finalizing"
    this.current = {
      ...snapshot,
      // A process restart cannot prove the old loopback feed is still alive.
      portAvailable: false,
      stage: interruptedFinalization
        ? "ending"
        : ACTIVE_STAGES.has(snapshot.stage) ? "suspended" : snapshot.stage,
      suspendedAt: snapshot.suspendedAt ?? Date.now(),
      terminalCandidateAt: interruptedFinalization
        ? snapshot.terminalCandidateAt ?? Date.now()
        : snapshot.terminalCandidateAt,
    }
  }

  observeLcuConnected(now = Date.now()): GameLifecycleEffect {
    this.current.lcuConnected = true
    this.current.lastLcuSeenAt = now
    return none()
  }

  observeLcuDisconnected(now = Date.now()): GameLifecycleEffect {
    this.current.lcuConnected = false
    if (this.isActive() && !this.current.portAvailable) {
      this.current.stage = "suspended"
      this.current.suspendedAt ??= now
    }
    return this.tick(now)
  }

  observeSession(
    phase: "ChampSelect" | "InProgress",
    gameId?: number,
    now = Date.now(),
  ): GameLifecycleEffect {
    this.current.lcuConnected = true
    this.current.lastLcuSeenAt = now
    this.current.lcuPhase = phase

    if (this.current.stage === "finalizing") return none()
    if (phase === "ChampSelect") {
      if (this.isActive()) {
        if (gameId !== undefined && this.current.gameId !== undefined &&
            gameId !== this.current.gameId) {
          return this.requestFinalization("complete", "next_game_started")
        }
        // A stale champ-select event must never regress an active game.
        return none()
      }
      this.current = {
        ...this.current,
        stage: "champ_select",
        gameId: gameId ?? this.current.gameId,
        startedAt: this.current.startedAt ?? now,
        terminalCandidateAt: undefined,
        terminalReason: undefined,
      }
      return none()
    }

    if (gameId !== undefined && this.current.gameId !== undefined &&
        gameId !== this.current.gameId && this.isActive()) {
      return this.requestFinalization("complete", "game_id_changed")
    }
    this.current.gameId = gameId ?? this.current.gameId
    this.current.startedAt ??= now
    this.current.terminalCandidateAt = undefined
    this.current.terminalReason = undefined
    this.current.stage = this.current.portAvailable
      ? "tracking"
      : this.current.trackingStartedAt === undefined ? "launching" : "suspended"
    if (this.current.stage === "suspended") this.current.suspendedAt ??= now
    return none()
  }

  observeLcuPhase(phase: string, now = Date.now()): GameLifecycleEffect {
    this.current.lcuConnected = true
    this.current.lastLcuSeenAt = now
    this.current.lcuPhase = phase
    if (this.current.stage === "finalizing") return none()

    if (phase === "ChampSelect") {
      if (this.isActive()) return none()
      this.current.stage = "champ_select"
      this.current.startedAt ??= now
      return none()
    }
    if (phase === "GameStart" || phase === "InProgress") {
      if (!this.isActive()) {
        this.current.stage = this.current.portAvailable ? "tracking" : "launching"
        this.current.startedAt ??= now
      } else if (this.current.portAvailable) {
        this.current.stage = "tracking"
      }
      this.current.terminalCandidateAt = undefined
      this.current.terminalReason = undefined
      return none()
    }
    if (phase === "Reconnect") {
      if (this.isActive() && !this.current.portAvailable) {
        this.current.stage = "suspended"
        this.current.suspendedAt ??= now
      }
      this.current.terminalCandidateAt = undefined
      this.current.terminalReason = undefined
      return none()
    }
    if (TERMINAL_PHASES.has(phase)) {
      if (!this.isActive()) return none()
      this.current.stage = "ending"
      this.current.terminalCandidateAt ??= now
      this.current.terminalReason = phase
      return this.tick(now)
    }
    if (NEUTRAL_PHASES.has(phase)) {
      if (this.current.stage === "champ_select") {
        const connected = this.current.lcuConnected
        const lastLcuSeenAt = this.current.lastLcuSeenAt
        this.current = {
          stage: "idle",
          lcuConnected: connected,
          lcuPhase: phase,
          portAvailable: false,
          lastLcuSeenAt,
        }
        return { type: "clear_draft" }
      }
      if (this.isActive()) {
        this.current.stage = "ending"
        this.current.terminalCandidateAt ??= now
        this.current.terminalReason = phase
        return this.tick(now)
      }
    }
    return none()
  }

  observePortAvailable(now = Date.now()): GameLifecycleEffect {
    this.current.portAvailable = true
    this.current.lastPortSeenAt = now
    this.current.suspendedAt = undefined
    if (this.current.stage === "champ_select") {
      // Port 2999 is authoritative proof that the game process spawned even
      // when LCU disconnected before it could emit GameStart/InProgress.
      this.current.stage = "tracking"
      this.current.trackingStartedAt ??= now
      return none()
    }
    if (this.isActive() && this.current.terminalCandidateAt === undefined) {
      this.current.stage = "tracking"
      this.current.trackingStartedAt ??= now
    }
    return none()
  }

  observePortUnavailable(now = Date.now()): GameLifecycleEffect {
    this.current.portAvailable = false
    if (this.isActive() && this.current.terminalCandidateAt === undefined) {
      this.current.stage = "suspended"
      this.current.suspendedAt ??= now
    }
    return this.tick(now)
  }

  observeStrongTerminal(
    reason: string,
    now = Date.now(),
    gameId?: number,
  ): GameLifecycleEffect {
    if (!this.isActive() || this.current.stage === "finalizing") return none()
    if (gameId !== undefined && this.current.gameId !== undefined &&
        gameId !== this.current.gameId) return none()
    this.current.terminalCandidateAt ??= now
    this.current.terminalReason = reason
    return this.requestFinalization("complete", reason)
  }

  tick(now = Date.now()): GameLifecycleEffect {
    if (this.current.stage === "finalizing") return none()
    if (this.current.terminalCandidateAt !== undefined &&
        !this.current.portAvailable &&
        now - this.current.terminalCandidateAt >= this.options.terminalGraceMs) {
      const outcome = this.current.lcuPhase === "TerminatedInError" ||
          this.current.terminalReason === "game_source_timeout" ||
          this.current.trackingStartedAt === undefined
        ? "aborted"
        : "complete"
      return this.requestFinalization(
        outcome,
        this.current.terminalReason ?? "terminal_phase",
      )
    }

    if ((this.current.stage === "suspended" || this.current.stage === "launching") &&
        this.current.startedAt !== undefined) {
      const reference = this.current.lastPortSeenAt ??
        this.current.suspendedAt ??
        this.current.startedAt
      if (now - reference >= this.options.abandonmentMs) {
        return this.requestFinalization("aborted", "game_source_timeout")
      }
    }
    if (this.current.stage === "champ_select" && !this.current.lcuConnected &&
        this.current.startedAt !== undefined &&
        now - this.current.startedAt >= this.options.abandonmentMs) {
      this.finalized(now)
      return { type: "clear_draft" }
    }
    return none()
  }

  finalized(now = Date.now()) {
    this.current = {
      stage: "idle",
      lcuConnected: this.current.lcuConnected,
      lcuPhase: this.current.lcuPhase,
      portAvailable: false,
      lastLcuSeenAt: this.current.lastLcuSeenAt,
      lastPortSeenAt: this.current.lastPortSeenAt,
      startedAt: undefined,
      trackingStartedAt: undefined,
      suspendedAt: undefined,
      terminalCandidateAt: undefined,
      terminalReason: undefined,
    }
    this.current.lastLcuSeenAt ??= now
  }

  private isActive() {
    return ACTIVE_STAGES.has(this.current.stage)
  }

  private requestFinalization(
    outcome: GameFinalizationOutcome,
    reason: string,
  ): GameLifecycleEffect {
    const gameId = this.current.gameId
    this.current.stage = "finalizing"
    this.current.terminalReason = reason
    return { type: "finalize", outcome, reason, gameId }
  }
}
