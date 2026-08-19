import type {
  CampKey,
  ChampionTemplateDescriptor,
} from "../../../src/shared/minimap/contracts.js"
import type { MinimapCalibrationHints } from "./calibration.js"
import {
  MinimapTelemetryRepository,
  type DatabaseLike,
  type PathingReviewData,
} from "../database/minimap-telemetry-repo.js"
import { PostGamePathingAnalysisService } from "../pathing/postgame-pathing-analysis-service.js"
import type { GameClientRequest } from "../jungle/live-jungle-evidence.js"
import {
  completeChampionTemplateRoster,
  DataDragonTemplateProvider,
} from "./data-dragon-template-provider.js"
import { ElectronDesktopCaptureBackend } from "./electron-desktop-capture-backend.js"
import type { MinimapCaptureBackend } from "./capture-backend.js"
import { MinimapDebugSampler } from "./minimap-debug-sampler.js"
import {
  MinimapTelemetryCoordinator,
  type MinimapDebugFrameEvent,
  type MinimapTelemetryContext,
} from "./minimap-telemetry-coordinator.js"

interface RecallLiveGamePlayerLike {
  championName: string
  riotId?: string
  isDead: boolean
  isLocal: boolean
}

interface RecallLiveGameLike {
  mapNumber?: number
  gameMode?: string
  gameType?: string
  activePlayer?: { riotId?: string }
  allies: RecallLiveGamePlayerLike[]
  enemies: RecallLiveGamePlayerLike[]
}

export interface RecallLiveSessionLike {
  phase: "Idle" | "ChampSelect" | "InProgress"
  gameId?: number
  mapId?: number
  queueId?: number
  gameMode?: string
  gameType?: string
  game?: RecallLiveGameLike
}

export interface RecallMinimapIntegrationOptions {
  gameClient: GameClientRequest
  database: DatabaseLike
  puuid: string
  getEnabled(): boolean
  getDataDragonVersion(): string | undefined
  getDebugEnabled?(): boolean
  getDebugOverlayEnabled?(): boolean
  onDebugFrame?(event: MinimapDebugFrameEvent): void
  getCalibrationHints?(): Promise<MinimapCalibrationHints>
  debugDirectory?: string
  getRoutePlan?(session: RecallLiveSessionLike): CampKey[] | undefined
  templateProvider?: Pick<DataDragonTemplateProvider, "load">
  captureBackend?: MinimapCaptureBackend
}

function normalizedIdentity(value?: string) {
  return value?.trim().toLocaleLowerCase()
}

function participantKey(
  team: "ally" | "enemy",
  player: RecallLiveGamePlayerLike,
  index: number,
) {
  return normalizedIdentity(player.riotId)
    ? `${team}:riot:${normalizedIdentity(player.riotId)}`
    : `${team}:slot:${index}:${player.championName.toLocaleLowerCase()}`
}

function rosterFor(session: RecallLiveSessionLike): ChampionTemplateDescriptor[] {
  const game = session.game
  if (!game) return []
  return [
    ...game.allies.map((player, index) => ({
      participantKey: participantKey("ally", player, index),
      championName: player.championName,
      team: "ally" as const,
      isLocal: player.isLocal,
    })),
    ...game.enemies.map((player, index) => ({
      participantKey: participantKey("enemy", player, index),
      championName: player.championName,
      team: "enemy" as const,
      isLocal: false,
    })),
  ]
}

export function isPracticeToolSession(session: RecallLiveSessionLike) {
  return [
    session.gameType,
    session.game?.gameType,
    session.gameMode,
    session.game?.gameMode,
  ].some((value) => /PRACTICE/i.test(value ?? ""))
}

export function hasAuthoritativeCaptureClassification(
  session: RecallLiveSessionLike,
) {
  if (isPracticeToolSession(session)) return true
  if (session.gameType?.trim() || session.game?.gameType?.trim()) return true
  return session.queueId !== undefined &&
    Number.isSafeInteger(session.queueId) &&
    session.queueId > 0
}

/**
 * Thin adapter around Recall's existing LiveSession/GameClient lifecycle.
 * It captures only rendered minimap observations while a match is active and
 * executes hidden-path reconstruction only through completeMatch().
 */
export class RecallMinimapIntegration {
  private readonly repository: MinimapTelemetryRepository
  private readonly coordinator: MinimapTelemetryCoordinator
  private readonly templates: Pick<DataDragonTemplateProvider, "load">
  private readonly postGame: PostGamePathingAnalysisService
  private lastRosterSignature = ""
  private lastGameId?: number
  private activeCaptureGameId?: number
  private lastCalibrationHintsGameId?: number
  private operation = Promise.resolve()

  constructor(private readonly options: RecallMinimapIntegrationOptions) {
    this.repository = new MinimapTelemetryRepository(options.database)
    this.repository.reconcileOrphanedCaptureSessions()
    const debugSampler = options.debugDirectory
      ? new MinimapDebugSampler(options.debugDirectory)
      : undefined
    this.coordinator = new MinimapTelemetryCoordinator(
      options.captureBackend ?? new ElectronDesktopCaptureBackend(),
      options.gameClient,
      this.repository,
      undefined,
      {},
      debugSampler,
      options.onDebugFrame,
    )
    this.templates = options.templateProvider ??
      new DataDragonTemplateProvider(options.getDataDragonVersion)
    this.postGame = new PostGamePathingAnalysisService(this.repository)
  }

  update(session: RecallLiveSessionLike) {
    this.operation = this.operation
      .catch(() => undefined)
      .then(() => this.applySession(session))
    return this.operation
  }

  completeMatch() {
    this.operation = this.operation
      .catch(() => undefined)
      .then(async () => {
        const gameId = this.lastGameId
        await this.coordinator.stop("complete")
        this.activeCaptureGameId = undefined
        this.lastCalibrationHintsGameId = undefined
        this.lastGameId = undefined
        if (gameId === undefined) return
        this.postGame.run({
          gameId,
          puuid: this.options.puuid,
          policy: { gameId, livePhase: "PostGame", matchCompleted: true },
        })
      })
    return this.operation
  }

  stop() {
    this.operation = this.operation
      .catch(() => undefined)
      .then(async () => {
        await this.coordinator.stop("aborted")
        this.lastGameId = undefined
        this.activeCaptureGameId = undefined
        this.lastCalibrationHintsGameId = undefined
      })
    return this.operation
  }

  getHealth() {
    return this.coordinator.getHealth()
  }

  getReview(gameId: number): PathingReviewData {
    return this.postGame.review(gameId, this.options.puuid)
  }

  private async applySession(session: RecallLiveSessionLike) {
    if (!this.options.getEnabled()) {
      await this.coordinator.stop("aborted")
      this.coordinator.resetFailedStart()
      return
    }
    const roster = rosterFor(session)
    const gameMode = session.gameMode ?? session.game?.gameMode
    const gameType = session.gameType ?? session.game?.gameType
    const isPracticeTool = isPracticeToolSession(session)
    const captureClassificationReady =
      hasAuthoritativeCaptureClassification(session)
    const mapNumber = session.game?.mapNumber ?? session.mapId
    const nextCaptureGameId = session.phase === "InProgress" &&
        session.gameId !== undefined && mapNumber === 11 &&
        captureClassificationReady && !isPracticeTool
      ? session.gameId
      : undefined

    if (this.activeCaptureGameId !== undefined &&
        this.activeCaptureGameId !== nextCaptureGameId) {
      await this.coordinator.stop("complete")
      this.activeCaptureGameId = undefined
    }
    if (session.phase === "InProgress" && isPracticeTool) {
      this.lastGameId = undefined
      this.lastCalibrationHintsGameId = undefined
    }
    if (session.phase === "InProgress" && session.gameId !== undefined &&
        captureClassificationReady && !isPracticeTool &&
        this.lastCalibrationHintsGameId !== session.gameId) {
      try {
        this.coordinator.setCalibrationHints(
          await this.options.getCalibrationHints?.() ?? {},
        )
        this.lastCalibrationHintsGameId = session.gameId
      } catch {
        // The visual locator remains conservative when game.cfg is unavailable.
        this.coordinator.setCalibrationHints({})
      }
    }
    const rosterSignature = JSON.stringify({
      version: this.options.getDataDragonVersion(),
      roster: roster.map((entry) => [
        entry.participantKey,
        entry.championName,
        entry.team,
        entry.isLocal,
      ]),
    })
    if (roster.length > 0 && rosterSignature !== this.lastRosterSignature) {
      const templates = completeChampionTemplateRoster(
        roster,
        await this.templates.load(roster),
      )
      this.coordinator.setTemplates(templates)
      if (templates.length === roster.length) this.lastRosterSignature = rosterSignature
    }
    if (session.phase === "InProgress" && isPracticeTool) {
      this.lastRosterSignature = ""
    }
    if (session.phase === "InProgress") {
      this.lastGameId = nextCaptureGameId
    }
    const local = roster.find((entry) => entry.isLocal)
    const gamePlayers = session.game
      ? [...session.game.allies, ...session.game.enemies]
      : []
    const deadParticipantKeys = gamePlayers.flatMap((player, index) => {
      if (!player.isDead) return []
      const team = index < (session.game?.allies.length ?? 0) ? "ally" : "enemy"
      const teamIndex = team === "ally"
        ? index
        : index - (session.game?.allies.length ?? 0)
      return [participantKey(team, player, teamIndex)]
    })
    const context: MinimapTelemetryContext = {
      phase: session.phase,
      gameId: session.gameId,
      mapNumber,
      gameMode,
      gameType,
      captureClassificationReady,
      isPracticeTool,
      debugEnabled: captureClassificationReady && !isPracticeTool &&
        this.options.getDebugEnabled?.() === true,
      debugOverlayEnabled: captureClassificationReady && !isPracticeTool &&
        this.options.getDebugOverlayEnabled?.() === true,
      puuid: this.options.puuid,
      localRiotId: session.game?.activePlayer?.riotId,
      localParticipantKey: local?.participantKey,
      deadParticipantKeys,
      routePlan: this.options.getRoutePlan?.(session),
    }
    await this.coordinator.updateContext(context)
    this.activeCaptureGameId = nextCaptureGameId
  }
}

export function createRecallMinimapIntegration(options: RecallMinimapIntegrationOptions) {
  return new RecallMinimapIntegration(options)
}
