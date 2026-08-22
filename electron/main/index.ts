import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  screen,
  shell,
  Tray,
} from "electron"
import electronUpdater from "electron-updater"
import { fileURLToPath } from "node:url"
import path from "node:path"
import os from "node:os"
import { rm } from "node:fs/promises"
import Store from "electron-store"
import { SettingsStore, type UiSettings } from "./settings-store.js"
import type { MinimapVisionDebugSnapshot, MinimapVisionDebugStatus } from "../../src/types/app.js"
import { MatchSourceRepository } from "./database/match-source-repo.js"
import { resolveDisplayTimezone } from "./matches/time-contract.js"
import {
  openDatabaseWithRecovery,
  type DatabaseRecovery,
} from "./database/recovery.js"
import {
  createUpdateSnapshot,
  restoreLatestUpdateSnapshot,
} from "./database/snapshots.js"
import {
  MatchesRepository,
  type MatchQuery,
  type StatsFilter,
} from "./database/matches-repo.js"
import {
  ChallengesRepository,
  type ChallengeFilter,
} from "./database/challenges-repo.js"
import { ProfileRepository } from "./database/profile-repo.js"
import { AccountProfileRepository } from "./database/account-profile-repo.js"
import {
  AccountProfileCapture,
  type AccountProfileSummoner,
} from "./account-profile-capture.js"
import { ParticipantsRepository } from "./database/participants-repo.js"
import { MasteryRepository } from "./database/mastery-repo.js"
import { LiveGameCaptureRepository } from "./database/live-game-capture-repo.js"
import { ChampSelectRepository } from "./database/champ-select-repo.js"
import { RankedRepository } from "./database/ranked-repo.js"
import { GoalsRepository, type GoalInput } from "./database/goals-repo.js"
import { rankToPoints, formatRank } from "./ranked/rank.js"
import { ChallengeSync } from "./challenges/challenge-sync.js"
import { InsightsRepository } from "./database/insights-repo.js"
import { RiotBackfillRepository } from "./database/riot-backfill-repo.js"
import {
  pickBestAndWorst,
  splitChampionSignals,
} from "./matches/insights.js"
import {
  type PerformanceScoringContext,
} from "./matches/performance-profile.js"
import { recordScopeForMatch } from "./matches/records.js"
import { championsNeededFor } from "./challenges/champion-needs.js"
import { championStatusFor } from "./challenges/pinned.js"
import { LcuClient } from "./lcu-client.js"
import { LcuDiscovery, type LcuCredentials } from "./lcu-discovery.js"
import { LcuEvents as LcuEventStream } from "./lcu-events.js"
import { MatchSync } from "./match-sync.js"
import { MatchGradingService } from "./matches/match-grading-service.js"
import { syncUntilRecorded } from "./post-game-sync.js"
import type {
  ChampionMasterySnapshot,
  MatchRow,
  ModeFamily,
  ParticipantRow,
} from "./matches/types.js"
import { migrateLegacyUserData } from "./migrate-user-data.js"
import {
  enrichLiveSessionNames,
  mergeInProgressSessionMetadata,
  needsInProgressMetadataRefresh,
  readLiveSession,
  type LivePhase,
  type LiveSession,
} from "./live-session.js"
import { GameClient, readLiveGameSnapshot } from "./game-client.js"
import {
  GameLifecycleCoordinator,
  type GameLifecycleEffect,
} from "./game-lifecycle-coordinator.js"
import {
  createRecallMinimapIntegration,
  type RecallMinimapIntegration,
} from "./minimap/recall-minimap-integration.js"
import type {
  MinimapDebugFrameEvent,
  MinimapTelemetryHealth,
} from "./minimap/minimap-telemetry-coordinator.js"
import {
  calibrationHintsFromLeagueSettings,
  readLeagueMinimapSettings,
} from "./minimap/league-minimap-settings.js"
import { MinimapTelemetryRepository } from "./database/minimap-telemetry-repo.js"
import { ActiveGameRepository } from "./database/active-game-repo.js"
import { LiveTempoTracker } from "./live-analysis.js"
import { fetchQueues } from "./matches/queues.js"
import { RiotHistoryBackfill } from "./riot/history-backfill.js"
import { canonicalPlatformId, regionalRouteFor } from "./riot/routing.js"
import { normalizeRiotApiKey } from "./riot/api-client.js"
import { BackupManager } from "./database/backup-manager.js"
import { DataTrustService } from "./database/data-trust.js"
import { ClearHistoryService } from "./database/clear-history-service.js"
import { DatabaseWriteCoordinator } from "./database-write-coordinator.js"
import { ExportService } from "./database/export-service.js"
import { ReviewRepository } from "./database/review-repo.js"
import { LcuTimelineService } from "./lcu-timeline-service.js"
import {
  evaluateMatchLabels,
  prioritizePerformanceLabels,
} from "./matches/labels.js"
import { evaluateTimelineLabels } from "./matches/timeline-labels.js"
import { ReviewService } from "./review/review-service.js"
import {
  recommendChampions,
  type RecommendationCandidate,
} from "./review/recommendations.js"
import type { ChampionChoiceObjective } from "./review/types.js"
import { latestSchemaVersion } from "./database/migrations.js"
import {
  mergeChampionCatalog,
  type ChampionCatalogEntry,
} from "./champion-catalog.js"

const { autoUpdater } = electronUpdater
import {
  createUpdaterService,
  registerUpdaterIpc,
  type UpdaterService,
} from "./updater.js"
import { registerDataTrustIpc } from "./ipc/data-trust-ipc.js"
import { LcuSessionGeneration } from "./lcu-session-generation.js"
import { AnalysisWorkerClient } from "./background/analysis-worker-client.js"
import { runStableAnalysis } from "./background/stable-analysis.js"
import {
  clearUpdateMarker,
  markUpdateInProgress,
  updateStartupState,
  type UpdateStartupState,
} from "./update-guard.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, "../..")

export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron")
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist")
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const OPEN_DEVTOOLS = Boolean(VITE_DEV_SERVER_URL) && process.env.RECALL_OPEN_DEVTOOLS === "1"
const MINIMAP_VISION_DEBUG_AVAILABLE =
  Boolean(VITE_DEV_SERVER_URL) && !app.isPackaged

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST

// A development container (or an explicit local debug session) can keep all
// Electron state, including the SQLite database and electron-store settings,
// outside the normal Recall profile. This must happen before any call that
// reads Electron paths or acquires the single-instance lock.
const isolatedUserDataDir = process.env.RECALL_USER_DATA_DIR?.trim()
if (isolatedUserDataDir) {
  app.setPath("userData", path.resolve(isolatedUserDataDir))
}

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith("6.1")) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === "win32") app.setAppUserModelId("com.kleinbyte.recall")

const updateStartup = updateStartupState(
  app.getPath("userData"),
  app.getVersion(),
)

if (updateStartup.kind === "normal" && !app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const preload = path.join(__dirname, "../preload/index.mjs")
const indexHtml = path.join(RENDERER_DIST, "index.html")

let store: Store
let settingsStore: SettingsStore
const START_HIDDEN_ARG = "--hidden"

function configureLoginItem(enabled: boolean) {
  if (!app.isPackaged || process.platform !== "win32") return
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: [START_HIDDEN_ARG],
  })
}

function getDatabasePath() {
  return path.join(app.getPath("userData"), "stats.db")
}

function getDatabaseBackupDir() {
  if (isolatedUserDataDir) {
    return path.join(app.getPath("userData"), "Recall Database Backups")
  }
  return path.join(app.getPath("appData"), "Recall Database Backups")
}

/** How long the client needs after a game before its history is readable. */
const PERIODIC_SYNC_INTERVAL_MS = 5 * 60_000
const LIVE_GAME_REFRESH_INTERVAL_MS = 1_000
const LCU_LIFECYCLE_REQUEST_TIMEOUT_MS = 1_500
const SESSION_RETRY_DELAY_MS = 10_000

interface TempoOverlayStatus {
  visible: boolean
  locked: boolean
  shortcutRegistered: boolean
}

type Summoner = AccountProfileSummoner

/** State tied to one connected League Client session. */
interface Session {
  credentials: LcuCredentials
  client: LcuClient
  events: LcuEventStream
  sync: MatchSync
  challengeSync: ChallengeSync
  summoner: Summoner
  regionalRoute?: string
  platformId?: string
  timer: NodeJS.Timeout
  lifecycleReconcile?: Promise<void>
}

/** State owned by the logical game/account rather than LCU's UI transport. */
interface ActiveGameRuntime {
  ownerPuuid: string
  gameClient: GameClient
  minimapTelemetry: RecallMinimapIntegration
  lifecycle: GameLifecycleCoordinator
  liveTimer: NodeJS.Timeout
  finalization?: Promise<void>
  lastJournalWriteAt: number
}

let session: Session | undefined
let activeGame: ActiveGameRuntime | undefined
let connectRetry: NodeJS.Timeout | undefined
let lcuDiscovery: LcuDiscovery | undefined
let tray: Tray | undefined
let tempoOverlayWindow: BrowserWindow | undefined
let tempoOverlayRequestedVisible = false
let tempoOverlayLocked = false
let tempoOverlayShortcutRegistered = false
let tempoOverlayMoveSave: NodeJS.Timeout | undefined
let minimapVisionDebugWindow: BrowserWindow | undefined
let minimapVisionDebugRequestedVisible = false
let minimapVisionDebugLocked = false
let minimapVisionDebugMoveSave: NodeJS.Timeout | undefined
let latestMinimapVisionDebug: MinimapVisionDebugSnapshot = {
  enabled: false,
  state: "idle",
  updatedAt: 0,
  proposals: [],
  detections: [],
  confirmed: [],
  camps: [],
  health: {
    achievedFps: 0,
    captureAttempts: 0,
    processedFrames: 0,
    rejectedFrames: 0,
    calibrationFailures: 0,
  },
}
let lastMinimapDebugPublishAt = 0
let minimapDebugGameId: number | undefined
let liveRevision = 0
let liveGameReading = false
let activeGameRestore: Promise<void> | undefined
let pendingFinishedGamePuuid: string | undefined
let liveSession: LiveSession = {
  phase: "Idle",
  benchChampionIds: [],
  allies: [],
  enemies: [],
  updatedAt: Date.now(),
}

/** Positions champion select gave our team, by cell, until the game id arrives. */
const assignedPositions = new Map<number, { championId: number; position: string }>()

/** Champion names from the durable catalog, refreshed whenever the client connects. */
let championNames: Map<number, string> | undefined

/**
 * Whether the app is genuinely shutting down.
 *
 * Closing the window hides it, so the only way out is the tray. Without this
 * flag the quit request would be swallowed by the same handler that hides.
 */
let quitting = false
let database: ReturnType<typeof openDatabaseWithRecovery>["database"] | undefined
let repository: MatchesRepository | undefined
let challenges: ChallengesRepository | undefined
let profiles: ProfileRepository | undefined
let participants: ParticipantsRepository | undefined
let masteryHistory: MasteryRepository | undefined
let liveGameCaptures: LiveGameCaptureRepository | undefined
const liveTempoTracker = new LiveTempoTracker()
let champSelect: ChampSelectRepository | undefined
let activeGames: ActiveGameRepository | undefined
let rankedHistory: RankedRepository | undefined
let goals: GoalsRepository | undefined
let insights: InsightsRepository | undefined
let riotBackfills: RiotBackfillRepository | undefined
let reviewRepository: ReviewRepository | undefined
let backupManager: BackupManager | undefined
let dataTrustService: DataTrustService | undefined
let timelineService: LcuTimelineService | undefined
let reviewService: ReviewService | undefined
let recall: MatchGradingService | undefined
let analysisWorker: AnalysisWorkerClient | undefined
let statsRevision = 0
let startupRestoreError: string | undefined
let startupRecovery: DatabaseRecovery | undefined
let riotBackfillAbort: AbortController | undefined
let riotBackfillTask: Promise<void> | undefined
let riotBackfillRevision = 0
let dailyBackupTask: Promise<void> | undefined
const databaseWrites = new DatabaseWriteCoordinator()
const lcuSessionGeneration = new LcuSessionGeneration()
let shutdownPrepared = false
let shutdownPreparing: Promise<void> | undefined

function trackDatabaseTask<T>(task: Promise<T>): Promise<T> {
  return databaseWrites.track(task)
}

function trackMinimapTelemetry(task: Promise<void>) {
  void trackDatabaseTask(task)
    .catch((error) => {
      console.warn(`Minimap telemetry failed: ${(error as Error).message}`)
    })
    .finally(() => {
      // A stream can fail before the first minimap frame exists. Publish the
      // settled health immediately so the debug overlay shows that failure
      // instead of waiting for the next live-client polling tick.
      publishMinimapDebugHealth()
    })
}

function collectionDisabled(): boolean {
  return databaseWrites.maintenanceActive ||
    settingsStore.getMain("collection-mode") === "disabled_after_clear"
}

function getDatabase() {
  if (!database) {
    const result = openDatabaseWithRecovery(getDatabasePath(), {
      backupDir: getDatabaseBackupDir(),
    })
    database = result.database
    if (result.recovery) {
      startupRecovery = result.recovery
      console.warn(
        `Recall recovered a corrupt database from ${result.recovery.sourcePath}. ` +
        `The damaged generation was preserved at ${result.recovery.quarantinedPath}.`,
      )
    }
  }
  return database
}

function getRepository(): MatchesRepository {
  if (!repository) repository = new MatchesRepository(getDatabase())
  return repository
}

function getChallenges(): ChallengesRepository {
  if (!challenges) challenges = new ChallengesRepository(getDatabase())
  return challenges
}

function getProfiles(): ProfileRepository {
  if (!profiles) profiles = new ProfileRepository(getDatabase())
  return profiles
}

function getAccountProfileCapture(): AccountProfileCapture {
  return new AccountProfileCapture(new AccountProfileRepository(getDatabase()))
}

function getParticipants(): ParticipantsRepository {
  if (!participants) participants = new ParticipantsRepository(getDatabase())
  return participants
}

function getMasteryHistory() {
  if (!masteryHistory) masteryHistory = new MasteryRepository(getDatabase())
  return masteryHistory
}

const MASTERY_CACHE_MAX_AGE_MS = 6 * 60 * 60_000

interface LcuChampionMastery {
  championId?: number
  championLevel?: number
  championPoints?: number
  championPointsSinceLastLevel?: number
  championPointsUntilNextLevel?: number
  tokensEarned?: number
  highestGrade?: string
}

const masteryKey = (participantPuuid: string, championId: number) =>
  `${participantPuuid}:${championId}`

function integerOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0
}

function attachCachedMasteries(ownerPuuid: string, rows: ParticipantRow[]) {
  return rows.map((row) => {
    const participantPuuid = row.participantPuuid ??
      (row.isPlayer === 1 ? ownerPuuid : undefined)
    const mastery = participantPuuid
      ? getMasteryHistory().get(ownerPuuid, participantPuuid, row.championId)
      : undefined
    return { ...row, participantPuuid, mastery }
  })
}

/**
 * Adds small, cached mastery projections to a review scoreboard.
 *
 * Riot's match payload says who played; the authenticated LCU mastery route
 * says how experienced that player is on the champion. Missing identities,
 * old matches, privacy/service failures and a closed client all degrade to an
 * ordinary scoreboard rather than making the review fail.
 */
async function attachPlayerMasteries(ownerPuuid: string, rows: ParticipantRow[]) {
  const cached = attachCachedMasteries(ownerPuuid, rows)
  if (!session) return cached

  const refresh = new Map<string, { participantPuuid: string; championId: number }>()
  const now = Date.now()
  for (const row of cached) {
    if (!row.participantPuuid) continue
    if (row.mastery && now - row.mastery.updatedAt < MASTERY_CACHE_MAX_AGE_MS) continue
    refresh.set(masteryKey(row.participantPuuid, row.championId), {
      participantPuuid: row.participantPuuid,
      championId: row.championId,
    })
  }

  await Promise.allSettled([...refresh.values()].map(async (entry) => {
    const payload = await session!.client.request<
      LcuChampionMastery[] | Record<string, LcuChampionMastery>
    >(`/lol-champion-mastery/v1/${encodeURIComponent(entry.participantPuuid)}/champion-mastery`)
    const masteries = Array.isArray(payload) ? payload : Object.values(payload ?? {})
    const found = masteries.find((mastery) => mastery.championId === entry.championId)
    if (!found) return

    const snapshot: ChampionMasterySnapshot = {
      championId: entry.championId,
      championLevel: integerOrZero(found.championLevel),
      championPoints: integerOrZero(found.championPoints),
      championPointsSinceLastLevel: integerOrZero(found.championPointsSinceLastLevel),
      championPointsUntilNextLevel: integerOrZero(found.championPointsUntilNextLevel),
      tokensEarned: integerOrZero(found.tokensEarned),
      highestGrade: typeof found.highestGrade === "string"
        ? found.highestGrade
        : undefined,
      updatedAt: now,
    }
    getMasteryHistory().upsert(ownerPuuid, entry.participantPuuid, snapshot)
  }))

  return attachCachedMasteries(ownerPuuid, rows)
}

function attachMatchCardDetails<T extends { gameId: number }>(
  ownerPuuid: string,
  rows: T[],
) {
  return rows.map((row) => ({
    ...row,
    participants: getParticipants().getMatchDetail(row.gameId, ownerPuuid).participants,
  }))
}

function getRankedHistory(): RankedRepository {
  if (!rankedHistory) rankedHistory = new RankedRepository(getDatabase())
  return rankedHistory
}

function getGoals(): GoalsRepository {
  if (!goals) goals = new GoalsRepository(getDatabase())
  return goals
}

function getInsights(): InsightsRepository {
  if (!insights) insights = new InsightsRepository(getDatabase())
  return insights
}

/** Recovers history recorded before the app was renamed to Recall. */
function adoptPreviousInstallData() {
  // A deliberately isolated debug profile must always start clean. Importing
  // the normal profile here would defeat the purpose of RECALL_USER_DATA_DIR.
  if (isolatedUserDataDir) return

  const currentDir = app.getPath("userData")
  const legacyDir = path.join(app.getPath("appData"), "lol-challenge-tracker")

  if (legacyDir === currentDir) return

  const { migrated } = migrateLegacyUserData(legacyDir, currentDir)
  if (migrated.length > 0) {
    console.log(`Carried over from the previous install: ${migrated.join(", ")}`)
  }
}

function getRiotBackfills(): RiotBackfillRepository {
  if (!riotBackfills) riotBackfills = new RiotBackfillRepository(getDatabase())
  return riotBackfills
}

function getReviewRepository() {
  if (!reviewRepository) reviewRepository = new ReviewRepository(getDatabase())
  return reviewRepository
}

function getBackupManager() {
  if (!backupManager) {
    backupManager = new BackupManager(getDatabasePath(), getDatabaseBackupDir())
  }
  return backupManager
}

function getMatchGradingService() {
  if (!recall) recall = new MatchGradingService(getDatabase())
  return recall
}

function getAnalysisWorker() {
  if (!analysisWorker) analysisWorker = new AnalysisWorkerClient()
  return analysisWorker
}

async function ensureRecallFrozen(win?: BrowserWindow) {
  const service = getMatchGradingService()
  const status = service.referenceStatus()
  if (collectionDisabled()) return status
  const needsDirectCutover = service.needsDirectCutover()
  // A recipe cutover must not freeze at process startup, before the signed-in
  // source-enrichment pass has had a chance to recover retained timelines.
  // The authenticated afterSync path below waits for that pass, then performs
  // the one-time rebuild and broadcasts the finished artifacts atomically.
  if (needsDirectCutover && !win) return status
  const hasRecoverableRawReferenceData = status.state === "calibrating" &&
    status.supportedScopes.length === 0 && service.hasRecoverableRawReferenceData()
  const needsAutomaticModeFreeze = service.needsAutomaticReferenceUpdate(status)
  if (!needsDirectCutover &&
      ((status.state === "frozen" && !needsAutomaticModeFreeze) ||
       (status.supportedScopes.length === 0 && !hasRecoverableRawReferenceData))) {
    return status
  }
  const backup = await getBackupManager().createAsync(getDatabase(), "pre-repair")
  const result = await trackDatabaseTask(getAnalysisWorker().ensureFrozenReference({
    databasePath: getDatabasePath(),
    backup: {
      path: backup.fileName,
      sha256: backup.sha256,
    },
  }))
  if ("processed" in result) {
    console.log(
      `Recall rebuilt ${result.processed} matches (${result.ready} ready, ${result.nonready} withheld)`,
    )
    if (win) {
      broadcast(win, "stats:updated", { inserted: 0, regraded: result.processed })
      broadcast(win, "performance-reference:updated", getMatchGradingService().referenceStatus())
      broadcast(win, "data-trust:updated")
    }
  } else if (needsDirectCutover && win) {
    broadcast(win, "stats:updated", { inserted: 0, regraded: 0 })
    broadcast(win, "performance-reference:updated", result)
    broadcast(win, "data-trust:updated")
  }
  return result
}

function getDataTrustService() {
  if (!dataTrustService) {
    dataTrustService = new DataTrustService(
      getDatabase(),
      getDatabasePath(),
      getBackupManager(),
    )
    if (startupRestoreError) dataTrustService.setStartupError(startupRestoreError)
  }
  return dataTrustService
}

function readRiotApiKey(): string | undefined {
  const encrypted = settingsStore.getMain("riot-api-key-encrypted")
  if (typeof encrypted !== "string" || !safeStorage.isEncryptionAvailable()) {
    return undefined
  }

  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"))
  } catch (error) {
    console.warn(
      `Could not decrypt the configured Riot API key: ${(error as Error).message}`,
    )
    return undefined
  }
}

function getLiveGameCaptures() {
  if (!liveGameCaptures) {
    liveGameCaptures = new LiveGameCaptureRepository(getDatabase())
  }
  return liveGameCaptures
}

function getChampSelect() {
  if (!champSelect) {
    champSelect = new ChampSelectRepository(getDatabase())
  }
  return champSelect
}

function getActiveGames() {
  if (!activeGames) activeGames = new ActiveGameRepository(getDatabase())
  return activeGames
}

function saveRiotAccount(
  summoner: Summoner,
  matchPuuid: string,
  regionalRoute: string,
  platformId: string,
) {
  getDatabase().prepare(
    `INSERT INTO riot_accounts
     (puuid, match_puuid, regional_route, platform_id,
      game_name, tag_line, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(puuid) DO UPDATE SET
       match_puuid = excluded.match_puuid,
       regional_route = excluded.regional_route,
       platform_id = excluded.platform_id,
       game_name = excluded.game_name,
       tag_line = excluded.tag_line,
       resolved_at = excluded.resolved_at`,
  ).run(
    summoner.puuid,
    matchPuuid,
    regionalRoute,
    platformId,
    summoner.gameName,
    summoner.tagLine,
    Date.now(),
  )
}

function getTimelineService(win: BrowserWindow) {
  if (!timelineService) {
    timelineService = new LcuTimelineService(
      getDatabase(),
      () => session?.client,
      (gameId) => broadcast(win, "timeline:updated", gameId),
      async (gameId, puuid, timeline) => {
        const match = getRepository().getMatch(gameId, puuid)
        if (!match) return
        const detail = getParticipants().getMatchDetail(gameId, puuid)
        const player = detail.participants.find((entry) => entry.isPlayer === 1)
        if (!player) return
        getMatchGradingService().refreshMetricObservations(gameId, puuid)
        const labels = prioritizePerformanceLabels([
          ...evaluateMatchLabels({
            match,
            player,
            participants: detail.participants,
          }),
          ...evaluateTimelineLabels({
            match,
            player,
            participants: detail.participants,
            timeline,
          }),
        ])
        getRepository().replacePerformanceLabels(gameId, puuid, labels)
        broadcast(win, "stats:updated", { inserted: 0, labelsUpdated: 1 })
        broadcastHeldRecords(win, match, puuid)
        broadcast(win, "review:updated", gameId)
      },
      getLiveGameCaptures(),
    )
  }
  return timelineService
}

function broadcastHeldRecords(
  win: BrowserWindow,
  match: MatchRow,
  puuid: string,
) {
  const records = getRepository()
    .getRecords({ puuid, ...recordScopeForMatch(match) })
    .filter((record) => record.gameId === match.gameId)
  broadcast(win, "match:records", { gameId: match.gameId, records })

  const announced = announcedRecordKeys.get(match.gameId) ?? new Set<string>()
  const newRecords = records.filter((record) => !announced.has(record.key))
  if (!newRecords.length) return
  for (const record of newRecords) announced.add(record.key)
  announcedRecordKeys.set(match.gameId, announced)

  broadcast(win, "record:notification", {
    gameId: match.gameId,
    records: newRecords,
    createdAt: Date.now(),
  })
}

const announcedRecordKeys = new Map<number, Set<string>>()

function getReviewService(win: BrowserWindow) {
  if (!reviewService) {
    reviewService = new ReviewService(
      getDatabase(),
      getRepository(),
      getParticipants(),
      getReviewRepository(),
      getTimelineService(win),
      getMatchGradingService(),
    )
  }
  return reviewService
}

async function createWindow(startHidden = false) {
  const win = new BrowserWindow({
    title: `Recall v${app.getVersion()}`,
    icon: path.join(process.env.VITE_PUBLIC, "favicon.ico"),
    frame: false,
    autoHideMenuBar: true,
    height: 940,
    width: OPEN_DEVTOOLS ? 1500 + 760 : 1500,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#0a1428",
    show: false,
    webPreferences: {
      preload,
      // The renderer reaches the client and database through IPC only, so it
      // needs neither Node access nor relaxed web security.
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    // DevTools adds a renderer and keeps the shared GPU process busy even
    // while Recall is behind a running game. Make it explicit for profiling
    // and ordinary game testing; set RECALL_OPEN_DEVTOOLS=1 when needed.
    if (OPEN_DEVTOOLS) win.webContents.openDevTools()
  } else {
    win.loadFile(indexHtml)
  }

  win.once("ready-to-show", () => {
    if (!startHidden) win.show()
  })

  // Closing hides Recall so it can keep recording games. Minimising remains a
  // normal taskbar action; the custom title bar should behave like Windows.
  win.on("close", (event) => {
    if (quitting) return
    event.preventDefault()
    win.hide()
  })

  win.on("maximize", () => broadcast(win, "window:maximized", true))
  win.on("unmaximize", () => broadcast(win, "window:maximized", false))

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) shell.openExternal(url)
    return { action: "deny" }
  })

  return win
}

async function showUpdateInProgress(
  update: Extract<UpdateStartupState, { kind: "updating" }>,
) {
  await app.whenReady()
  const win = new BrowserWindow({
    title: "Recall is updating",
    icon: path.join(process.env.VITE_PUBLIC, "favicon.ico"),
    frame: false,
    autoHideMenuBar: true,
    height: 700,
    width: 1080,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: "#030810",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  })

  win.once("ready-to-show", () => win.show())
  if (VITE_DEV_SERVER_URL) {
    await win.loadURL(
      `${VITE_DEV_SERVER_URL}?updating=${encodeURIComponent(update.targetVersion)}`,
    )
  } else {
    await win.loadFile(indexHtml, {
      query: { updating: update.targetVersion },
    })
  }
  // This guard process deliberately does not own Electron's single-instance
  // lock, so the newly installed executable can launch. Do not let an old
  // executable remain resident long enough to hold installer files forever.
  const poll = setInterval(() => {
    const state = updateStartupState(app.getPath("userData"), app.getVersion())
    if (state.kind === "normal") app.quit()
  }, 500)
  const timeout = setTimeout(() => app.quit(), 15_000)
  app.once("will-quit", () => {
    clearInterval(poll)
    clearTimeout(timeout)
  })
  app.on("window-all-closed", () => app.quit())
}

function broadcast(win: BrowserWindow, channel: string, payload?: unknown) {
  if (channel === "stats:updated") statsRevision += 1
  if (win.isDestroyed()) return
  win.webContents.send(channel, payload)
}

const TEMPO_OVERLAY_WIDTH = 360
const TEMPO_OVERLAY_HEIGHT = 232

function tempoOverlayStatus(): TempoOverlayStatus {
  return {
    visible: tempoOverlayRequestedVisible,
    locked: tempoOverlayLocked,
    shortcutRegistered: tempoOverlayShortcutRegistered,
  }
}

function sendTempoOverlayStatus(win: BrowserWindow) {
  const status = tempoOverlayStatus()
  broadcast(win, "tempo-overlay:status", status)
  if (tempoOverlayWindow && !tempoOverlayWindow.isDestroyed()) {
    tempoOverlayWindow.webContents.send("tempo-overlay:status", status)
  }
}

function fittedTempoOverlayPosition(position?: { x: number; y: number }) {
  const display = position
    ? screen.getDisplayMatching({
        x: position.x,
        y: position.y,
        width: TEMPO_OVERLAY_WIDTH,
        height: TEMPO_OVERLAY_HEIGHT,
      })
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  const fallback = {
    x: area.x + area.width - TEMPO_OVERLAY_WIDTH - 24,
    y: area.y + 24,
  }
  const requested = position ?? fallback
  return {
    x: Math.min(
      Math.max(requested.x, area.x),
      area.x + Math.max(0, area.width - TEMPO_OVERLAY_WIDTH),
    ),
    y: Math.min(
      Math.max(requested.y, area.y),
      area.y + Math.max(0, area.height - TEMPO_OVERLAY_HEIGHT),
    ),
  }
}

function saveTempoOverlayPosition() {
  if (!tempoOverlayWindow || tempoOverlayWindow.isDestroyed()) return
  const [x, y] = tempoOverlayWindow.getPosition()
  settingsStore.setMain("tempo-overlay-position", { x, y })
}

function keepTempoOverlayOnScreen() {
  if (!tempoOverlayWindow || tempoOverlayWindow.isDestroyed()) return
  const [x, y] = tempoOverlayWindow.getPosition()
  const fitted = fittedTempoOverlayPosition({ x, y })
  tempoOverlayWindow.setPosition(fitted.x, fitted.y)
}

function createTempoOverlayWindow(mainWindow: BrowserWindow) {
  if (tempoOverlayWindow && !tempoOverlayWindow.isDestroyed()) {
    return tempoOverlayWindow
  }

  const stored = settingsStore.getMain("tempo-overlay-position")
  const position = fittedTempoOverlayPosition(stored)
  const overlay = new BrowserWindow({
    title: "Recall Tempo Overlay",
    x: position.x,
    y: position.y,
    width: TEMPO_OVERLAY_WIDTH,
    height: TEMPO_OVERLAY_HEIGHT,
    frame: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    movable: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  })
  tempoOverlayWindow = overlay
  overlay.setAlwaysOnTop(true, "screen-saver")
  overlay.setMenuBarVisibility(false)

  overlay.on("move", () => {
    if (tempoOverlayMoveSave) clearTimeout(tempoOverlayMoveSave)
    tempoOverlayMoveSave = setTimeout(saveTempoOverlayPosition, 200)
  })
  overlay.on("page-title-updated", (event) => event.preventDefault())
  overlay.on("closed", () => {
    if (tempoOverlayMoveSave) clearTimeout(tempoOverlayMoveSave)
    tempoOverlayMoveSave = undefined
    tempoOverlayWindow = undefined
    tempoOverlayRequestedVisible = false
    tempoOverlayLocked = false
    sendTempoOverlayStatus(mainWindow)
  })
  overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  overlay.webContents.on("did-finish-load", () => {
    overlay.webContents.send("live:updated", liveSession)
    overlay.webContents.send("tempo-overlay:status", tempoOverlayStatus())
    if (tempoOverlayRequestedVisible) overlay.showInactive()
  })

  if (VITE_DEV_SERVER_URL) {
    const overlayUrl = new URL(VITE_DEV_SERVER_URL)
    overlayUrl.searchParams.set("surface", "tempo-overlay")
    void overlay.loadURL(overlayUrl.toString())
  } else {
    void overlay.loadFile(indexHtml, { query: { surface: "tempo-overlay" } })
  }

  return overlay
}

function setTempoOverlayLocked(mainWindow: BrowserWindow, locked: boolean) {
  const overlay = createTempoOverlayWindow(mainWindow)
  tempoOverlayLocked = locked
  if (locked) overlay.setIgnoreMouseEvents(true, { forward: true })
  else overlay.setIgnoreMouseEvents(false)
  sendTempoOverlayStatus(mainWindow)
  return tempoOverlayStatus()
}

function showTempoOverlay(mainWindow: BrowserWindow) {
  tempoOverlayRequestedVisible = true
  const overlay = createTempoOverlayWindow(mainWindow)
  // Every show begins in placement mode. Locking makes it click-through until
  // the next hide/show cycle, so the dial never traps gameplay input by accident.
  tempoOverlayLocked = false
  overlay.setIgnoreMouseEvents(false)
  if (!overlay.webContents.isLoadingMainFrame()) overlay.showInactive()
  sendTempoOverlayStatus(mainWindow)
  return tempoOverlayStatus()
}

function hideTempoOverlay(mainWindow: BrowserWindow) {
  tempoOverlayRequestedVisible = false
  tempoOverlayWindow?.hide()
  sendTempoOverlayStatus(mainWindow)
  return tempoOverlayStatus()
}

function toggleTempoOverlay(mainWindow: BrowserWindow) {
  return tempoOverlayRequestedVisible
    ? hideTempoOverlay(mainWindow)
    : showTempoOverlay(mainWindow)
}

function resetTempoOverlayPosition(mainWindow: BrowserWindow) {
  settingsStore.deleteMain("tempo-overlay-position")
  const overlay = createTempoOverlayWindow(mainWindow)
  const position = fittedTempoOverlayPosition()
  overlay.setPosition(position.x, position.y)
  saveTempoOverlayPosition()
  return tempoOverlayStatus()
}

const MINIMAP_DEBUG_OVERLAY_WIDTH = 430
const MINIMAP_DEBUG_OVERLAY_HEIGHT = 800

function minimapVisionDebugStatus(): MinimapVisionDebugStatus {
  if (!MINIMAP_VISION_DEBUG_AVAILABLE) {
    return { visible: false, locked: false }
  }
  return { visible: minimapVisionDebugRequestedVisible, locked: minimapVisionDebugLocked }
}

function sendMinimapVisionDebugUpdate(mainWindow: BrowserWindow) {
  const status = minimapVisionDebugStatus()
  broadcast(mainWindow, "minimap-vision-debug:status", status)
  if (minimapVisionDebugWindow && !minimapVisionDebugWindow.isDestroyed()) {
    minimapVisionDebugWindow.webContents.send("minimap-vision-debug:status", status)
    minimapVisionDebugWindow.webContents.send("minimap-vision-debug:update", latestMinimapVisionDebug)
  }
}

function fittedMinimapVisionDebugPosition(position?: { x: number; y: number }) {
  const display = position
    ? screen.getDisplayMatching({ x: position.x, y: position.y, width: MINIMAP_DEBUG_OVERLAY_WIDTH, height: MINIMAP_DEBUG_OVERLAY_HEIGHT })
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  const fallback = { x: area.x + 24, y: area.y + area.height - MINIMAP_DEBUG_OVERLAY_HEIGHT - 24 }
  const requested = position ?? fallback
  return {
    x: Math.min(Math.max(requested.x, area.x), area.x + Math.max(0, area.width - MINIMAP_DEBUG_OVERLAY_WIDTH)),
    y: Math.min(Math.max(requested.y, area.y), area.y + Math.max(0, area.height - MINIMAP_DEBUG_OVERLAY_HEIGHT)),
  }
}

function saveMinimapVisionDebugPosition() {
  if (!minimapVisionDebugWindow || minimapVisionDebugWindow.isDestroyed()) return
  const [x, y] = minimapVisionDebugWindow.getPosition()
  settingsStore.setMain("minimap-vision-overlay-position", { x, y })
}

function keepMinimapVisionDebugOnScreen() {
  if (!minimapVisionDebugWindow || minimapVisionDebugWindow.isDestroyed()) return
  const [x, y] = minimapVisionDebugWindow.getPosition()
  const fitted = fittedMinimapVisionDebugPosition({ x, y })
  minimapVisionDebugWindow.setPosition(fitted.x, fitted.y)
}

function createMinimapVisionDebugWindow(mainWindow: BrowserWindow) {
  if (minimapVisionDebugWindow && !minimapVisionDebugWindow.isDestroyed()) return minimapVisionDebugWindow
  const stored = settingsStore.getMain("minimap-vision-overlay-position")
  const position = fittedMinimapVisionDebugPosition(stored)
  const overlay = new BrowserWindow({
    title: "Recall Minimap CV Debug",
    x: position.x,
    y: position.y,
    width: MINIMAP_DEBUG_OVERLAY_WIDTH,
    height: MINIMAP_DEBUG_OVERLAY_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    movable: true,
    resizable: true,
    minWidth: 380,
    minHeight: 560,
    show: false,
    webPreferences: { preload, nodeIntegration: false, contextIsolation: true, webSecurity: true },
  })
  minimapVisionDebugWindow = overlay
  overlay.setAlwaysOnTop(true, "screen-saver")
  // Keep the diagnostic pixels out of ordinary desktop capture paths.
  overlay.setContentProtection(true)
  overlay.setMenuBarVisibility(false)
  overlay.on("move", () => {
    if (minimapVisionDebugMoveSave) clearTimeout(minimapVisionDebugMoveSave)
    minimapVisionDebugMoveSave = setTimeout(saveMinimapVisionDebugPosition, 200)
  })
  overlay.on("page-title-updated", (event) => event.preventDefault())
  overlay.on("closed", () => {
    if (minimapVisionDebugMoveSave) clearTimeout(minimapVisionDebugMoveSave)
    minimapVisionDebugMoveSave = undefined
    minimapVisionDebugWindow = undefined
    minimapVisionDebugRequestedVisible = false
    minimapVisionDebugLocked = false
    sendMinimapVisionDebugUpdate(mainWindow)
  })
  overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  overlay.webContents.on("did-finish-load", () => {
    overlay.webContents.send("minimap-vision-debug:status", minimapVisionDebugStatus())
    overlay.webContents.send("minimap-vision-debug:update", latestMinimapVisionDebug)
    if (minimapVisionDebugRequestedVisible) overlay.showInactive()
  })
  if (VITE_DEV_SERVER_URL) {
    const overlayUrl = new URL(VITE_DEV_SERVER_URL)
    overlayUrl.searchParams.set("surface", "minimap-vision-debug")
    void overlay.loadURL(overlayUrl.toString())
  } else {
    void overlay.loadFile(indexHtml, { query: { surface: "minimap-vision-debug" } })
  }
  return overlay
}

function setMinimapVisionDebugLocked(mainWindow: BrowserWindow, locked: boolean) {
  if (!MINIMAP_VISION_DEBUG_AVAILABLE ||
      settingsStore.getMain("minimap-vision-overlay-enabled") !== true) {
    return minimapVisionDebugStatus()
  }
  const overlay = createMinimapVisionDebugWindow(mainWindow)
  minimapVisionDebugLocked = locked
  overlay.setIgnoreMouseEvents(locked, { forward: true })
  sendMinimapVisionDebugUpdate(mainWindow)
  return minimapVisionDebugStatus()
}

function toggleMinimapVisionDebugOverlay(mainWindow: BrowserWindow) {
  if (!MINIMAP_VISION_DEBUG_AVAILABLE ||
      settingsStore.getMain("minimap-vision-overlay-enabled") !== true) {
    minimapVisionDebugRequestedVisible = false
    minimapVisionDebugWindow?.hide()
    return minimapVisionDebugStatus()
  }
  minimapVisionDebugRequestedVisible = !minimapVisionDebugRequestedVisible
  const overlay = createMinimapVisionDebugWindow(mainWindow)
  minimapVisionDebugLocked = false
  overlay.setIgnoreMouseEvents(false)
  if (minimapVisionDebugRequestedVisible && !overlay.webContents.isLoadingMainFrame()) overlay.showInactive()
  if (!minimapVisionDebugRequestedVisible) overlay.hide()
  if (activeGame) {
    trackMinimapTelemetry(activeGame.minimapTelemetry.update(liveSession))
  }
  sendMinimapVisionDebugUpdate(mainWindow)
  return minimapVisionDebugStatus()
}

function resetMinimapVisionDebugPosition(mainWindow: BrowserWindow) {
  if (!MINIMAP_VISION_DEBUG_AVAILABLE ||
      settingsStore.getMain("minimap-vision-overlay-enabled") !== true) {
    return minimapVisionDebugStatus()
  }
  settingsStore.deleteMain("minimap-vision-overlay-position")
  const overlay = createMinimapVisionDebugWindow(mainWindow)
  const position = fittedMinimapVisionDebugPosition()
  overlay.setPosition(position.x, position.y)
  saveMinimapVisionDebugPosition()
  return minimapVisionDebugStatus()
}


function minimapVisionHealthSnapshot(
  health: MinimapTelemetryHealth,
): MinimapVisionDebugSnapshot["health"] {
  return {
    achievedFps: health.achievedFps,
    captureAttempts: health.captureAttempts,
    processedFrames: health.processedFrames,
    rejectedFrames: health.rejectedFrames,
    calibrationFailures: health.calibrationFailures,
    startupAttempts: health.startupAttempts,
    nextRetryAt: health.nextRetryAt,
    eligibilityReason: health.eligibilityReason,
    backendState: health.backendState,
    sourceId: health.sourceId,
    sourceName: health.sourceName,
    discoveredWindowCount: health.discoveredWindowCount,
    candidateSourceCount: health.candidateSourceCount,
    candidateSourceNames: health.candidateSourceNames,
    sourceDiscoveryAttempts: health.sourceDiscoveryAttempts,
    captureMode: health.captureMode,
    captureStage: health.captureStage,
    frameDeliveryMode: health.frameDeliveryMode,
    paintEventCount: health.paintEventCount,
    paintSizeMismatchCount: health.paintSizeMismatchCount,
    snapshotCaptureCount: health.snapshotCaptureCount,
    lastPaintSize: health.lastPaintSize,
    rendererFrameSerial: health.rendererFrameSerial,
    lastErrorDetail: health.lastErrorDetail,
    rosterCount: health.rosterCount,
    templateCount: health.templateCount,
    localTemplateAvailable: health.localTemplateAvailable,
    templateErrorCode: health.templateErrorCode,
    calibrationCandidatesEvaluated: health.calibrationCandidatesEvaluated,
    calibrationCandidatesValid: health.calibrationCandidatesValid,
    calibrationBestScore: health.calibrationBestScore,
    calibrationFailureReason: health.calibrationFailureReason,
    calibrationVariance: health.calibrationVariance,
    calibrationEdgeDensity: health.calibrationEdgeDensity,
    calibrationColoredRatio: health.calibrationColoredRatio,
    visionEngine: health.visionEngine,
    opencvVersion: health.opencvVersion,
    visionWorkerState: health.visionWorkerState,
    visionWorkerRestarts: health.visionWorkerRestarts,
    visionProcessingMs: health.visionProcessingMs,
    visionChampionMs: health.visionChampionMs,
    visionCampMs: health.visionCampMs,
    inferredCampClears: health.inferredCampClears,
    clockSampleCount: health.clockSampleCount,
    clockReady: health.clockReady,
    lastErrorCode: health.lastErrorCode,
    lastEvidenceErrorCode: health.lastEvidenceErrorCode,
  }
}

function publishMinimapDebugFrame(event: MinimapDebugFrameEvent) {
  // PNG encoding and IPC are intentionally bounded; the capture loop remains
  // real-time while the overlay displays the latest available frame.
  const now = Date.now()
  if (now - lastMinimapDebugPublishAt < 333) return
  lastMinimapDebugPublishAt = now
  minimapDebugGameId = event.gameId
  const { sample, health, frame } = event
  latestMinimapVisionDebug = {
    enabled: true,
    state: health.state,
    updatedAt: Date.now(),
    frameSequence: frame.frameSequence,
    gameTimeMs: sample.gameTimeMs,
    // This is the canonical inner-map crop only. The desktop frame is never
    // sent to a renderer or persisted by this path.
    // Raw canonical pixels avoid synchronous PNG encoding and large base64
    // churn in Electron's main process while the diagnostic overlay is open.
    // webContents.send clones this bounded 320px ROI for the renderer.
    imageRgba: frame.data,
    imageWidth: frame.width,
    imageHeight: frame.height,
    calibration: sample.calibration,
    proposals: sample.markerProposals.slice(0, 32).map((proposal) => ({
      team: proposal.team,
      x: proposal.center.x,
      y: proposal.center.y,
      radius: proposal.radius,
      confidence: proposal.ringConfidence,
      diameterPx: proposal.diameterPx,
      aspectRatio: proposal.aspectRatio,
      fillRatio: proposal.fillRatio,
      proposalSource: proposal.proposalSource,
      ringSupport: proposal.ringSupport,
      ringSectors: proposal.ringSectors,
      identityCandidate: proposal.identityCandidate,
      identityScore: proposal.identityScore,
      identityMargin: proposal.identityMargin,
      identityAccepted: proposal.identityAccepted,
    })),
    detections: sample.detections.slice(0, 32).map((observation) => ({
      championName: observation.championName,
      team: observation.team,
      x: observation.position.x,
      y: observation.position.y,
      confidence: Math.min(1, observation.identityConfidence * observation.positionConfidence),
    })),
    confirmed: sample.confirmed.slice(0, 32).map((observation) => ({
      championName: observation.championName,
      team: observation.team,
      x: observation.position.x,
      y: observation.position.y,
      confidence: Math.min(1, observation.identityConfidence * observation.positionConfidence),
      continuity: observation.continuity,
    })),
    camps: sample.campStates.slice(0, 64).map((camp) => ({
      campKey: camp.campKey,
      state: camp.state,
      confidence: camp.sourceConfidence,
    })),
    health: minimapVisionHealthSnapshot(health),
  }
  if (minimapVisionDebugWindow && !minimapVisionDebugWindow.isDestroyed()) {
    minimapVisionDebugWindow.webContents.send("minimap-vision-debug:update", latestMinimapVisionDebug)
  }
}

function resetMinimapVisionDebugFrame(mainWindow: BrowserWindow) {
  minimapDebugGameId = undefined
  latestMinimapVisionDebug = {
    ...latestMinimapVisionDebug,
    state: activeGame?.minimapTelemetry.getHealth().state ?? "idle",
    updatedAt: Date.now(),
    frameSequence: undefined,
    gameTimeMs: undefined,
    imageRgba: undefined,
    imageWidth: undefined,
    imageHeight: undefined,
    calibration: undefined,
    proposals: [],
    detections: [],
    confirmed: [],
    camps: [],
    health: activeGame
      ? minimapVisionHealthSnapshot(activeGame.minimapTelemetry.getHealth())
      : latestMinimapVisionDebug.health,
  }
  sendMinimapVisionDebugUpdate(mainWindow)
}

function clearMinimapVisionDebugOverlay(mainWindow: BrowserWindow) {
  minimapDebugGameId = undefined
  minimapVisionDebugRequestedVisible = false
  minimapVisionDebugLocked = false
  latestMinimapVisionDebug = {
    enabled: false,
    state: "idle",
    updatedAt: Date.now(),
    proposals: [],
    detections: [],
    confirmed: [],
    camps: [],
    health: {
      achievedFps: 0,
      captureAttempts: 0,
      processedFrames: 0,
      rejectedFrames: 0,
      calibrationFailures: 0,
    },
  }
  // The debug surface is explicitly session-scoped. Destroying it at match
  // end releases its renderer/GPU resources; toggling it later recreates it.
  const debugWindow = minimapVisionDebugWindow
  if (debugWindow && !debugWindow.isDestroyed()) debugWindow.destroy()
  sendMinimapVisionDebugUpdate(mainWindow)
}

function publishMinimapDebugHealth() {
  if (!MINIMAP_VISION_DEBUG_AVAILABLE ||
      !minimapVisionDebugRequestedVisible || !activeGame ||
      settingsStore.getMain("minimap-vision-overlay-enabled") !== true) return
  const health = activeGame.minimapTelemetry.getHealth()
  latestMinimapVisionDebug = {
    ...latestMinimapVisionDebug,
    enabled: true,
    state: health.state,
    updatedAt: Date.now(),
    health: minimapVisionHealthSnapshot(health),
  }
  if (minimapVisionDebugWindow && !minimapVisionDebugWindow.isDestroyed()) {
    minimapVisionDebugWindow.webContents.send("minimap-vision-debug:update", latestMinimapVisionDebug)
  }
}

function broadcastLive(win: BrowserWindow) {
  broadcast(win, "live:updated", liveSession)
  if (tempoOverlayWindow && !tempoOverlayWindow.isDestroyed()) {
    tempoOverlayWindow.webContents.send("live:updated", liveSession)
  }
  if (liveSession.phase === "Idle" && tempoOverlayRequestedVisible) {
    hideTempoOverlay(win)
  }
  if (liveSession.phase === "Idle" ||
      (minimapDebugGameId !== undefined && liveSession.gameId !== minimapDebugGameId)) {
    if (minimapVisionDebugRequestedVisible || latestMinimapVisionDebug.enabled) {
      // Preserve the explicitly opened diagnostic surface between phases. This
      // lets users see eligibility/source errors before a match starts instead
      // of making the overlay appear broken by hiding it automatically.
      resetMinimapVisionDebugFrame(win)
    }
  } else {
    publishMinimapDebugHealth()
  }
}

/** Brings the window back from the tray, wherever it was left. */
function reveal(win: BrowserWindow) {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/**
 * Puts Recall in the notification area.
 *
 * The window hides rather than closes, so this is the only route back to it —
 * and the only way to actually quit.
 */
function createTray(win: BrowserWindow) {
  const icon = nativeImage.createFromPath(
    path.join(process.env.VITE_PUBLIC, "favicon.ico"),
  )

  tray = new Tray(icon)
  tray.setToolTip("Recall")

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Recall", click: () => reveal(win) },
      {
        label: "Show / hide Tempo overlay (Alt+T)",
        click: () => toggleTempoOverlay(win),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )

  tray.on("double-click", () => reveal(win))
}

function createMinimapIntegration(
  win: BrowserWindow,
  puuid: string,
  gameClient: GameClient,
) {
  return createRecallMinimapIntegration({
    gameClient,
    database: getDatabase(),
    puuid,
    getEnabled: () => !collectionDisabled() &&
      settingsStore.getMain("minimap-telemetry-enabled") !== false,
    getDataDragonVersion: () => settingsStore.getMain("ddragon-version"),
    onDataDragonVersionResolved: (version) => {
      settingsStore.setMain("ddragon-version", version)
    },
    onPathingReviewUpdated: (gameId) => {
      broadcast(win, "minimap:pathing-updated", gameId)
    },
    getDebugEnabled: () =>
      MINIMAP_VISION_DEBUG_AVAILABLE &&
      settingsStore.getMain("minimap-vision-debug-enabled") === true,
    getDebugOverlayEnabled: () =>
      MINIMAP_VISION_DEBUG_AVAILABLE &&
      settingsStore.getMain("minimap-vision-overlay-enabled") === true &&
      minimapVisionDebugRequestedVisible,
    onDebugFrame: publishMinimapDebugFrame,
    debugDirectory: path.join(app.getPath("userData"), "Minimap Vision Debug"),
    getCalibrationHints: async () => {
      const configured = process.env.RECALL_LEAGUE_GAME_CONFIG?.trim()
      const discoveredInstallDirectory = lcuDiscovery?.getInstallDirectory()
      const systemDrive = process.env.SystemDrive ?? "C:"
      const programFiles = process.env.ProgramFiles
      const candidates = [
        configured,
        discoveredInstallDirectory
          ? path.join(discoveredInstallDirectory, "Config", "game.cfg")
          : undefined,
        path.join(systemDrive, "Riot Games", "League of Legends", "Config", "game.cfg"),
        programFiles
          ? path.join(programFiles, "Riot Games", "League of Legends", "Config", "game.cfg")
          : undefined,
      ].filter((candidate): candidate is string => Boolean(candidate))
      let lastReadError: unknown
      for (const candidate of [...new Set(candidates)]) {
        try {
          const settings = await readLeagueMinimapSettings(candidate)
          return calibrationHintsFromLeagueSettings(settings)
        } catch (error) {
          lastReadError = error
          // Try the next known League installation location.
        }
      }
      throw lastReadError ?? new Error("league_game_config_unavailable")
    },
  })
}

function gameIdFromLifecycleEvent(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined
  const event = value as Record<string, unknown>
  const gameData = event.gameData && typeof event.gameData === "object"
    ? event.gameData as Record<string, unknown>
    : undefined
  for (const candidate of [event.gameId, gameData?.gameId]) {
    const gameId = typeof candidate === "string" ? Number(candidate) : candidate
    if (typeof gameId === "number" && Number.isSafeInteger(gameId) && gameId > 0) {
      return gameId
    }
  }
  return undefined
}

function persistActiveGame(runtime: ActiveGameRuntime, force = false) {
  if (activeGame !== runtime || collectionDisabled() || liveSession.phase === "Idle") {
    return
  }
  const now = Date.now()
  if (!force && now - runtime.lastJournalWriteAt < 10_000) return
  runtime.lastJournalWriteAt = now
  try {
    getActiveGames().save(runtime.ownerPuuid, liveSession, runtime.lifecycle.snapshot())
  } catch (error) {
    console.warn(`Could not persist active game journal: ${(error as Error).message}`)
  }
}

function clearActiveGameJournal(ownerPuuid: string) {
  try {
    getActiveGames().clear(ownerPuuid)
  } catch (error) {
    console.warn(`Could not clear active game journal: ${(error as Error).message}`)
  }
}

function createActiveGameRuntime(win: BrowserWindow, ownerPuuid: string) {
  const gameClient = new GameClient()
  const lifecycle = new GameLifecycleCoordinator()
  let runtime: ActiveGameRuntime
  runtime = {
    ownerPuuid,
    gameClient,
    minimapTelemetry: createMinimapIntegration(win, ownerPuuid, gameClient),
    lifecycle,
    liveTimer: setInterval(() => {
      if (activeGame !== runtime) return
      void refreshLiveGameData(win)
    }, LIVE_GAME_REFRESH_INTERVAL_MS),
    lastJournalWriteAt: 0,
  }
  activeGame = runtime
  return runtime
}

async function stopActiveGameRuntime(
  win: BrowserWindow,
  options: { clearJournal?: boolean; clearState?: boolean } = {},
) {
  const clearJournal = options.clearJournal !== false
  const clearState = options.clearState !== false
  const runtime = activeGame
  if (!runtime) {
    if (clearState) clearLiveSession(win)
    return
  }

  if (!clearJournal) persistActiveGame(runtime, true)
  activeGame = undefined
  clearInterval(runtime.liveTimer)
  if (clearJournal) clearActiveGameJournal(runtime.ownerPuuid)
  if (clearState) {
    clearMinimapVisionDebugOverlay(win)
    clearLiveSession(win)
  }

  try {
    if (runtime.finalization) await runtime.finalization
    else await trackDatabaseTask(runtime.minimapTelemetry.stop())
  } catch (error) {
    console.warn(`Could not stop active game capture: ${(error as Error).message}`)
  } finally {
    runtime.gameClient.close()
  }
}

async function ensureActiveGameRuntime(win: BrowserWindow, ownerPuuid: string) {
  if (activeGame?.ownerPuuid === ownerPuuid) return activeGame
  if (activeGame) await stopActiveGameRuntime(win)
  return createActiveGameRuntime(win, ownerPuuid)
}

function queueFinishedGameSync(win: BrowserWindow, ownerPuuid: string) {
  if (session?.summoner.puuid !== ownerPuuid) {
    pendingFinishedGamePuuid = ownerPuuid
    return
  }
  pendingFinishedGamePuuid = undefined
  void trackDatabaseTask(catchFinishedGame(win)).catch((error) => {
    console.warn(`Could not sync finished game: ${(error as Error).message}`)
  })
}

function finalizeActiveGame(
  win: BrowserWindow,
  runtime: ActiveGameRuntime,
  effect: Extract<GameLifecycleEffect, { type: "finalize" }>,
) {
  if (runtime.finalization) return runtime.finalization

  const operation = (async () => {
    try {
      if (effect.outcome === "complete") {
        await runtime.minimapTelemetry.completeMatch()
      } else {
        await runtime.minimapTelemetry.stop()
      }
    } catch (error) {
      console.warn(`Could not finalize active game capture: ${(error as Error).message}`)
    } finally {
      clearActiveGameJournal(runtime.ownerPuuid)
      if (activeGame === runtime) {
        runtime.lifecycle.finalized()
        clearMinimapVisionDebugOverlay(win)
        clearLiveSession(win)
      }
    }

    if (effect.outcome === "complete") {
      queueFinishedGameSync(win, runtime.ownerPuuid)
    }
  })()
  const tracked = trackDatabaseTask(operation)
  runtime.finalization = tracked
  const release = () => {
    if (runtime.finalization === tracked) runtime.finalization = undefined
  }
  void tracked.then(release, release)
  return tracked
}

async function applyLifecycleEffect(
  win: BrowserWindow,
  runtime: ActiveGameRuntime,
  effect: GameLifecycleEffect,
  forceJournal = false,
) {
  if (activeGame !== runtime) return
  if (effect.type === "clear_draft") {
    assignedPositions.clear()
    clearActiveGameJournal(runtime.ownerPuuid)
    if (liveSession.phase === "ChampSelect") clearLiveSession(win)
    return
  }
  if (effect.type === "finalize") {
    persistActiveGame(runtime, true)
    await finalizeActiveGame(win, runtime, effect)
    return
  }
  persistActiveGame(runtime, forceJournal)
}

function handleLcuPhase(win: BrowserWindow, phase: string) {
  const runtime = activeGame
  if (!runtime) return
  if (phase !== "ChampSelect" && phase !== "InProgress" && phase !== "GameStart") {
    // Invalidates metadata reads that began under a previous phase while Port
    // polling itself remains independent of LCU transport state.
    liveRevision += 1
  }
  const effect = runtime.lifecycle.observeLcuPhase(phase)
  void applyLifecycleEffect(win, runtime, effect, true)
  if (phase === "ChampSelect") void refreshLiveSession(win, "ChampSelect")
  else if (phase === "InProgress" || phase === "GameStart") {
    if (liveSession.phase !== "InProgress") {
      liveRevision += 1
      liveSession = liveSession.phase === "ChampSelect"
        ? { ...liveSession, phase: "InProgress", updatedAt: Date.now() }
        : {
            phase: "InProgress",
            benchChampionIds: [],
            allies: [],
            enemies: [],
            updatedAt: Date.now(),
          }
      trackMinimapTelemetry(runtime.minimapTelemetry.update(liveSession))
      persistActiveGame(runtime, true)
      broadcastLive(win)
    }
    if (needsInProgressMetadataRefresh(liveSession)) {
      void refreshLiveSession(win, "InProgress")
    }
    // Port 2999 is the first source available after the map spawns and is not
    // delayed behind LCU metadata or optional identity enrichment.
    void refreshLiveGameData(win)
  }
}

async function restoreActiveGameRuntime(win: BrowserWindow) {
  if (activeGameRestore) return activeGameRestore
  activeGameRestore = (async () => {
    if (collectionDisabled()) return
    const saved = getActiveGames().getLatest()
    if (!saved) return
    const runtime = await ensureActiveGameRuntime(win, saved.ownerPuuid)
    runtime.lifecycle.restore(saved.lifecycle)
    liveRevision += 1
    liveSession = saved.session
    trackMinimapTelemetry(runtime.minimapTelemetry.update(liveSession))
    broadcastLive(win)
    persistActiveGame(runtime, true)
    void refreshLiveGameData(win)
  })()
  return activeGameRestore
}

async function startSession(
  win: BrowserWindow,
  credentials: LcuCredentials,
  generation: number,
) {
  const isCurrent = () =>
    lcuSessionGeneration.isCurrent(generation) &&
    !quitting &&
    !collectionDisabled()
  if (!isCurrent()) return
  const client = new LcuClient(credentials)

  let summoner: Summoner
  let regionalRoute: string | undefined
  let platformId: string | undefined
  try {
    summoner = await client.request<Summoner>(
      "/lol-summoner/v1/current-summoner",
    )
    if (!isCurrent()) {
      client.close()
      return
    }
  } catch (error) {
    // The client is running but not ready — still signing in, or busy during a
    // game. Discovery will not fire again because the lockfile has not changed,
    // so retry here rather than waiting for a restart.
    console.warn(`Could not read current summoner: ${(error as Error).message}`)
    client.close()

    if (isCurrent()) {
      connectRetry = setTimeout(
        () => void startSession(win, credentials, generation),
        SESSION_RETRY_DELAY_MS,
      )
    }
    return
  }

  try {
    const locale = await client.request<{
      region?: string
      webRegion?: string
    }>("/riotclient/region-locale", {
      timeoutMs: LCU_LIFECYCLE_REQUEST_TIMEOUT_MS,
    })
    const platform = locale.region || locale.webRegion
    platformId = platform ? canonicalPlatformId(platform) : undefined
    regionalRoute = platform ? regionalRouteFor(platform) : undefined
  } catch (error) {
    console.warn(`Could not determine Riot API route: ${(error as Error).message}`)
  }

  if (!isCurrent()) {
    client.close()
    return
  }

  getAccountProfileCapture().record(summoner, {
    platformId,
    regionalRoute,
  })

  const sync = new MatchSync(
    client,
    getRepository(),
    summoner.puuid,
    getParticipants(),
    getChampSelect(),
    getLiveGameCaptures(),
    new MatchSourceRepository(getDatabase()),
    getMatchGradingService(),
  )
  const challengeSync = new ChallengeSync(
    client,
    getChallenges(),
    summoner.puuid,
  )
  const events = new LcuEventStream(credentials)
  const runtime = await ensureActiveGameRuntime(win, summoner.puuid)
  if (!isCurrent()) {
    client.close()
    return
  }
  runtime.lifecycle.observeLcuConnected()

  session = {
    credentials,
    client,
    events,
    sync,
    challengeSync,
    summoner,
    regionalRoute,
    platformId,
    timer: setInterval(() => void runSync(win), PERIODIC_SYNC_INTERVAL_MS),
  }

  events.on("end-of-game", (event: unknown) => {
    if (activeGame !== runtime || session?.events !== events) return
    broadcast(win, "end-of-game")
    const effect = runtime.lifecycle.observeStrongTerminal(
      "end_of_game_stats",
      Date.now(),
      gameIdFromLifecycleEvent(event),
    )
    void applyLifecycleEffect(win, runtime, effect)
  })
  events.on("pick", (championId: number | null) => {
    broadcast(win, "pick", championId)
  })
  events.on("champ-select", () => void refreshLiveSession(win, "ChampSelect"))
  events.on("game-start", (selections: unknown) => {
    broadcast(win, "game-start", selections)
  })
  events.on("phase", (phase: string) => handleLcuPhase(win, phase))
  events.on("connected", () => {
    if (activeGame !== runtime || session?.events !== events) return
    runtime.lifecycle.observeLcuConnected()
    persistActiveGame(runtime, true)
    void initialiseLiveSession(win)
  })
  events.on("disconnected", () => {
    if (activeGame !== runtime || session?.events !== events) return
    const effect = runtime.lifecycle.observeLcuDisconnected()
    void applyLifecycleEffect(win, runtime, effect, true)
  })
  events.start()

  broadcast(win, "lcu:status", { connected: true, summoner })
  void initialiseLiveSession(win)
  if (pendingFinishedGamePuuid === summoner.puuid) {
    queueFinishedGameSync(win, summoner.puuid)
  }
  // A configured Match-V5 key gives the recipe cutover one chance to enrich
  // the full stored history before its local reference is frozen. This is a
  // one-time cost: the direct-cutover predicate becomes false after rebuild.
  const riotApiKey = readRiotApiKey()
  if (getMatchGradingService().needsDirectCutover() && regionalRoute && riotApiKey) {
    await startRiotHistoryBackfill(win, true)
  } else if (regionalRoute && riotApiKey) {
    const history = getRiotBackfills().get(summoner.puuid, regionalRoute)
    // A normal disconnect persists "paused"; a process crash may leave the
    // durable row as "running". Resume either state from its exact Match-V5
    // offset without making a completed or never-requested import automatic.
    if (history?.status === "paused" || history?.status === "running") {
      void startRiotHistoryBackfill(win, false)
    }
  }
  if (!isCurrent() || session?.client !== client) return
  await runSync(win)
}

function stopSession(
  win: BrowserWindow,
  options: { preserveActiveGame?: boolean; preserveJournal?: boolean } = {},
): number {
  const generation = lcuSessionGeneration.invalidate()
  if (connectRetry) {
    clearTimeout(connectRetry)
    connectRetry = undefined
  }

  riotBackfillRevision += 1
  riotBackfillAbort?.abort()
  riotBackfillAbort = undefined
  const lcuSession = session
  if (lcuSession) {
    clearInterval(lcuSession.timer)
    lcuSession.events.stop()
    lcuSession.client.close()
    session = undefined
  }

  const runtime = activeGame
  if (options.preserveActiveGame && runtime) {
    const effect = runtime.lifecycle.observeLcuDisconnected()
    void applyLifecycleEffect(win, runtime, effect, true)
  } else {
    void stopActiveGameRuntime(win, {
      clearJournal: options.preserveJournal !== true,
    })
  }

  broadcast(win, "lcu:status", { connected: false, summoner: null })
  return generation
}

function clearLiveSession(win: BrowserWindow) {
  liveRevision += 1
  liveTempoTracker.reset()
  assignedPositions.clear()
  liveSession = { phase: "Idle", benchChampionIds: [], allies: [], enemies: [], updatedAt: Date.now() }
  broadcastLive(win)
}

/**
 * Champion select is the only place the client states the position it gave
 * each of our players. The roster is held by cell until the match can be named
 * (some client versions expose gameId immediately; others do so at game start).
 */
function rememberAssignedPositions(champSelectSession: LiveSession) {
  for (const player of champSelectSession.allies) {
    const championId = player.championId || player.championPickIntent
    if (!championId || !player.assignedPosition) continue
    assignedPositions.set(player.cellId, {
      championId,
      position: player.assignedPosition,
    })
  }
}

function storeAssignedPositions(gameId: number | undefined) {
  const ownerPuuid = activeGame?.ownerPuuid ?? session?.summoner.puuid
  if (!ownerPuuid || !gameId || assignedPositions.size === 0) return
  getChampSelect().record(gameId, ownerPuuid, [...assignedPositions.values()])
  assignedPositions.clear()
}

/** Reads a new, self-contained live snapshot without letting stale requests win. */
async function refreshLiveSession(
  win: BrowserWindow,
  phase: Exclude<LivePhase, "Idle">,
) {
  const lcuSession = session
  const runtime = activeGame
  if (!lcuSession || !runtime ||
      runtime.ownerPuuid !== lcuSession.summoner.puuid) return
  if (runtime.finalization) await runtime.finalization.catch(() => undefined)
  if (session !== lcuSession || activeGame !== runtime) return
  const revision = ++liveRevision
  try {
    const next = await readLiveSession(
      lcuSession.client,
      phase,
      lcuSession.summoner.puuid,
      {
        resolvePlayerNames: false,
        requestTimeoutMs: LCU_LIFECYCLE_REQUEST_TIMEOUT_MS,
      },
    )
    if (revision !== liveRevision || session !== lcuSession ||
        activeGame !== runtime) return

    const effect = runtime.lifecycle.observeSession(phase, next.gameId)
    if (effect.type === "finalize") {
      await applyLifecycleEffect(win, runtime, effect)
      if (session === lcuSession && activeGame === runtime) {
        void refreshLiveSession(win, phase)
      }
      return
    }
    if (phase === "ChampSelect" &&
        runtime.lifecycle.snapshot().stage !== "champ_select") {
      // A delayed draft payload must not replace an InProgress snapshot or
      // stop the capture that owns it.
      return
    }

    if (phase === "ChampSelect") {
      rememberAssignedPositions(next)
      storeAssignedPositions(next.gameId)
    }
    liveSession = phase === "InProgress" && liveSession.phase === "InProgress" &&
        (liveSession.gameId === undefined || next.gameId === undefined ||
          liveSession.gameId === next.gameId)
      ? mergeInProgressSessionMetadata(liveSession, next)
      : next
    trackMinimapTelemetry(runtime.minimapTelemetry.update(liveSession))
    persistActiveGame(runtime, true)
    broadcastLive(win)

    // Display names are useful UI decoration, but they must never hold up the
    // first game identity, Port 2999 poll, or minimap capture attempt.
    void enrichLiveSessionNames(
      lcuSession.client,
      next,
      LCU_LIFECYCLE_REQUEST_TIMEOUT_MS,
    ).then((enriched) => {
      if (revision !== liveRevision || session !== lcuSession ||
          activeGame !== runtime || liveSession.phase !== phase ||
          liveSession.gameId !== next.gameId) return
      liveSession = phase === "InProgress"
        ? mergeInProgressSessionMetadata(liveSession, enriched)
        : {
            ...liveSession,
            allies: enriched.allies,
            enemies: enriched.enemies,
            updatedAt: Math.max(liveSession.updatedAt, enriched.updatedAt),
          }
      trackMinimapTelemetry(runtime.minimapTelemetry.update(liveSession))
      persistActiveGame(runtime)
      broadcastLive(win)
    }).catch(() => undefined)

    if (phase === "InProgress") {
      storeAssignedPositions(next.gameId)
      void refreshLiveGameData(win)
    }
  } catch (error) {
    console.warn(`Could not refresh live game: ${(error as Error).message}`)
  }
}

/**
 * Adds the documented local game-client feed to the current live session.
 * A short single-flight guard avoids overlapping reads when the client is
 * briefly slow during loading or reconnecting.
 */
async function refreshLiveGameData(win: BrowserWindow) {
  const runtime = activeGame
  if (!runtime || liveGameReading || runtime.finalization) return
  const lifecycleStage = runtime.lifecycle.snapshot().stage
  const probingFromDraft = liveSession.phase === "ChampSelect" &&
    (lifecycleStage === "champ_select" || lifecycleStage === "launching" ||
      lifecycleStage === "suspended" || lifecycleStage === "tracking")
  if (liveSession.phase !== "InProgress" && !probingFromDraft) {
    const effect = runtime.lifecycle.tick()
    if (effect.type !== "none") {
      await applyLifecycleEffect(win, runtime, effect)
    }
    return
  }
  liveGameReading = true
  const startingPhase = liveSession.phase
  const startingRevision = liveRevision
  const expectedGameId = liveSession.gameId
  const lcuSession = session?.summoner.puuid === runtime.ownerPuuid
    ? session
    : undefined
  const metadataTask = startingPhase === "InProgress" &&
      needsInProgressMetadataRefresh(liveSession) && lcuSession
    ? readLiveSession(
        lcuSession.client,
        "InProgress",
        runtime.ownerPuuid,
        {
          resolvePlayerNames: false,
          requestTimeoutMs: LCU_LIFECYCLE_REQUEST_TIMEOUT_MS,
        },
      ).catch(() => undefined)
    : Promise.resolve(undefined)
  const stillCurrent = () => activeGame === runtime &&
    !runtime.finalization &&
    liveSession.phase === startingPhase &&
    liveRevision === startingRevision &&
    (expectedGameId === undefined || liveSession.gameId === expectedGameId)

  try {
    try {
      const game = await readLiveGameSnapshot(runtime.gameClient)
      if (stillCurrent()) {
        runtime.lifecycle.observePortAvailable()
        if (probingFromDraft) {
          // Port 2999 is stronger evidence than a missing LCU transition. Keep
          // the draft metadata/game id and begin the same capture immediately.
          liveRevision += 1
          liveSession = {
            ...liveSession,
            phase: "InProgress",
            updatedAt: game.updatedAt,
          }
        }
        game.analysis = liveTempoTracker.update(game)
        const captureGameId = liveSession.gameId ?? expectedGameId
        if (captureGameId !== undefined) {
          getLiveGameCaptures().record(captureGameId, runtime.ownerPuuid, game)
        }
        liveSession = {
          ...liveSession,
          gameType: liveSession.gameType ?? game.gameType,
          mapId: liveSession.mapId ?? game.mapNumber,
          game,
          updatedAt: game.updatedAt,
        }
        trackMinimapTelemetry(runtime.minimapTelemetry.update(liveSession))
        persistActiveGame(runtime, probingFromDraft)
        broadcastLive(win)
        if (probingFromDraft) {
          storeAssignedPositions(liveSession.gameId)
          if (lcuSession) void refreshLiveSession(win, "InProgress")
          return
        }
      }
    } catch {
      if (stillCurrent()) {
        const effect = runtime.lifecycle.observePortUnavailable()
        await applyLifecycleEffect(win, runtime, effect)
      }
    }

    const refreshed = await metadataTask
    if (!refreshed || !stillCurrent()) return
    const effect = runtime.lifecycle.observeSession("InProgress", refreshed.gameId)
    if (effect.type === "finalize") {
      await applyLifecycleEffect(win, runtime, effect)
      if (activeGame === runtime && session === lcuSession) {
        void refreshLiveSession(win, "InProgress")
      }
      return
    }
    liveSession = mergeInProgressSessionMetadata(liveSession, refreshed)
    storeAssignedPositions(liveSession.gameId)
    trackMinimapTelemetry(runtime.minimapTelemetry.update(liveSession))
    persistActiveGame(runtime, true)
    broadcastLive(win)
  } finally {
    liveGameReading = false
  }
}

/** Covers the case where Recall connects after champion select has begun. */
function initialiseLiveSession(win: BrowserWindow): Promise<void> {
  const lcuSession = session
  const runtime = activeGame
  if (!lcuSession || !runtime ||
      lcuSession.summoner.puuid !== runtime.ownerPuuid) return Promise.resolve()
  if (lcuSession.lifecycleReconcile) return lcuSession.lifecycleReconcile

  const reconcile = (async () => {
    try {
      const phase = await lcuSession.client.request<string>(
        "/lol-gameflow/v1/gameflow-phase",
        { timeoutMs: LCU_LIFECYCLE_REQUEST_TIMEOUT_MS },
      )
      if (session !== lcuSession || activeGame !== runtime) return
      lcuSession.events.reconcilePhase(phase)
      handleLcuPhase(win, phase)
    } catch {
      // The client moves through transitional phases quickly; the event stream
      // will provide the next stable state.
    }
  })().finally(() => {
    if (lcuSession.lifecycleReconcile === reconcile) {
      lcuSession.lifecycleReconcile = undefined
    }
  })
  lcuSession.lifecycleReconcile = reconcile
  return reconcile
}

/**
 * Records a game as soon as the client will admit to it.
 *
 * Both the end-of-game screen and leaving the game itself trigger this, and
 * either may arrive first, so a run already in flight is left alone rather
 * than starting a second one alongside it.
 */
let catchingGame = false

async function catchFinishedGame(win: BrowserWindow) {
  if (collectionDisabled() || catchingGame || !session) return
  const active = session
  catchingGame = true

  try {
    await syncUntilRecorded(async () => {
      if (collectionDisabled() || session !== active) return { inserted: 0 }

      await snapshotAccountProfile(win, active)
      if (session !== active || collectionDisabled()) return { inserted: 0 }
      const result = await active.sync.syncNow()
      if (session !== active || collectionDisabled()) return { inserted: 0 }
      await snapshotAccountProfile(win, active)
      if (session !== active || collectionDisabled()) return { inserted: 0 }
      if (result.inserted > 0) await afterSync(win, active, result)

      return result
    })
  } finally {
    catchingGame = false
  }
}

async function performFullSync(win: BrowserWindow, active: Session) {
  if (collectionDisabled() || session !== active) return

  await snapshotAccountProfile(win, active)
  if (collectionDisabled() || session !== active) return
  const result = await active.sync.syncNow()
  if (collectionDisabled() || session !== active) return
  await snapshotAccountProfile(win, active)
  if (collectionDisabled() || session !== active) return
  await afterSync(win, active, result)
  return result
}

let refreshAllTask: Promise<Awaited<ReturnType<typeof performFullSync>>> | undefined
let refreshAllSession: Session | undefined

async function refreshAll(win: BrowserWindow, active: Session) {
  if (refreshAllTask) {
    if (refreshAllSession === active) return refreshAllTask
    await refreshAllTask.catch(() => undefined)
    if (collectionDisabled() || session !== active) return
  }
  const task = performFullSync(win, active).finally(() => {
    if (refreshAllTask === task) {
      refreshAllTask = undefined
      refreshAllSession = undefined
    }
  })
  refreshAllSession = active
  refreshAllTask = task
  return task
}

async function runSync(win: BrowserWindow) {
  if (collectionDisabled() || !session) return
  return trackDatabaseTask(refreshAll(win, session))
}

/**
 * Starts or resumes the long Match-V5 import without blocking the renderer.
 *
 * Only one generation may write progress at a time. Replacing a key or
 * changing League accounts aborts and drains the previous generation first.
 */
async function startRiotHistoryBackfill(
  win: BrowserWindow,
  restart: boolean,
) {
  if (collectionDisabled()) return
  const revision = ++riotBackfillRevision
  riotBackfillAbort?.abort()
  const previous = riotBackfillTask
  if (previous) await previous.catch(() => undefined)
  if (revision !== riotBackfillRevision) return

  const active = session
  const apiKey = readRiotApiKey()
  if (!active || !active.regionalRoute || !apiKey) return

  const cached = getDatabase().prepare(
    "SELECT match_puuid AS matchPuuid FROM riot_accounts WHERE puuid = ?",
  ).get(active.summoner.puuid) as { matchPuuid?: string } | undefined
  const matchPuuid = cached?.matchPuuid || active.summoner.puuid
  saveRiotAccount(
    active.summoner,
    matchPuuid,
    active.regionalRoute,
    active.platformId ?? "",
  )

  const queues = await fetchQueues(active.client)
  if (collectionDisabled() || revision !== riotBackfillRevision || session !== active) return

  const controller = new AbortController()
  riotBackfillAbort = controller
  let announcedImported: number | undefined

  const backfill = new RiotHistoryBackfill(
    apiKey,
    active.regionalRoute,
    active.summoner.puuid,
    getRepository(),
    getParticipants(),
    queues,
    getRiotBackfills(),
    {
      champSelect: getChampSelect(),
      recall: getMatchGradingService(),
      sourceRepository: new MatchSourceRepository(getDatabase()),
      matchPuuid,
      riotId: {
        gameName: active.summoner.gameName,
        tagLine: active.summoner.tagLine,
      },
      onAccountResolved: (resolvedMatchPuuid) => {
        saveRiotAccount(
          active.summoner,
          resolvedMatchPuuid,
          active.regionalRoute!,
          active.platformId ?? "",
        )
      },
      onProgress: (state) => {
        if (revision !== riotBackfillRevision) return
        broadcast(win, "riot-history:updated", state)
        if (state.status === "complete") {
          getDataTrustService().recordSync(active.summoner.puuid, "riot_history", {
            success: true,
            seen: state.idsScanned,
            written: state.matchesImported,
          })
          if (state.matchesImported > 0) createDailyBackupIfNeeded(win)
          broadcast(win, "data-trust:updated")
        } else if (state.status === "error") {
          getDataTrustService().recordSync(active.summoner.puuid, "riot_history", {
            success: false,
            seen: state.idsScanned,
            written: state.matchesImported,
            error: state.lastError,
          })
          broadcast(win, "data-trust:updated")
        }
        if (announcedImported === undefined) {
          announcedImported = state.matchesImported
          return
        }

        const imported = state.matchesImported - announcedImported
        // Import progress has its own lightweight event. Rebuilding every
        // dashboard chart after each ten-match batch made app startup look
        // like a refresh loop, so publish the heavier stats event once when
        // this import run settles.
        if (imported > 0 && state.status !== "running") {
          announcedImported = state.matchesImported
          broadcast(win, "stats:updated", {
            inserted: imported,
            source: "riot-api",
          })
        }
      },
    },
  )
  getDataTrustService().recordAttempt(
    active.summoner.puuid,
    "riot_history",
  )

  let completed = false
  const task = trackDatabaseTask(
    backfill
      .run(restart, controller.signal)
      .then((state) => {
        completed = state.status === "complete"
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.warn(`Riot history import stopped: ${(error as Error).message}`)
        }
      }),
  )
  riotBackfillTask = task

  try {
    await task
    if (completed && revision === riotBackfillRevision && session === active) {
      await ensureRecallFrozen(win)
    }
  } finally {
    if (revision === riotBackfillRevision) {
      riotBackfillAbort = undefined
      riotBackfillTask = undefined
    }
  }
}

/** Tells the renderer what changed, and refreshes everything a game affects. */
async function afterSync(
  win: BrowserWindow,
  active: Session,
  result: { inserted: number },
) {
  const isCurrent = () => !collectionDisabled() && session === active
  if (!isCurrent()) return

  const needsDirectCutover = getMatchGradingService().needsDirectCutover()
  const timelineTask = getTimelineService(win)
    .queueRecentMatches(active.summoner.puuid)
  if (timelineTask) {
    const trackedTimelineTask = trackDatabaseTask(timelineTask)
    // During a recipe replacement, retained/source timelines need to be
    // present before the immutable local reference is rebuilt. Normal syncs
    // remain asynchronous after the cutover has completed.
    if (needsDirectCutover) await trackedTimelineTask
    if (!isCurrent()) return
  }
  // A periodic/local sync may overlap the one-time full-history enrichment.
  // Do not let that race freeze a partially enriched reference.
  if (needsDirectCutover && riotBackfillTask) {
    await riotBackfillTask.catch(() => undefined)
    if (!isCurrent()) return
  }
  let cutoverEnrichmentComplete = true
  if (needsDirectCutover && active.regionalRoute && readRiotApiKey()) {
    const enrichment = getRiotBackfills().get(
      active.summoner.puuid,
      active.regionalRoute,
    )
    // Keep the recipe in an honest building state after an interrupted or
    // failed full-history pass. Retrying the import resumes the cutover;
    // clearing the optional API key allows the retained/local-only fallback.
    cutoverEnrichmentComplete = enrichment?.status === "complete"
  }
  if (cutoverEnrichmentComplete) await ensureRecallFrozen(win)
  if (!isCurrent()) return

  if (result.inserted > 0) {
    broadcast(win, "stats:updated", result)

    const [latest] = getRepository().getRecentMatches(
      { puuid: active.summoner.puuid },
      result.inserted,
    )
    if (latest) {
      broadcast(win, "match:recorded", latest)
      broadcastHeldRecords(win, latest, active.summoner.puuid)
      broadcast(win, "review:updated", latest.gameId)
    }
    createDailyBackupIfNeeded(win)
  }
  getDataTrustService().recordSync(active.summoner.puuid, "league_client", {
    success: true,
    seen: result.inserted,
    written: result.inserted,
  })
  // Challenges are synced after matches so a challenge failure can never cost
  // us a recorded game.
  const challengeResult = await active.challengeSync.syncNow()
  if (!isCurrent()) return
  if (challengeResult.changed > 0) {
    broadcast(win, "challenges:updated", challengeResult)
  }

  await snapshotProfile(win, active)
  if (!isCurrent()) return
  await snapshotRanked(win, active)
}

/** Refreshes mutable LCU identity fields without allowing a stale session to write. */
async function snapshotAccountProfile(win: BrowserWindow, active: Session) {
  if (collectionDisabled() || session !== active) return

  try {
    const result = await getAccountProfileCapture().refresh(
      () => active.client.request<Summoner>(
        "/lol-summoner/v1/current-summoner",
      ),
      active.summoner.puuid,
      {
        platformId: active.platformId,
        regionalRoute: active.regionalRoute,
      },
      () => !collectionDisabled() && session === active,
    )
    if (result.state === "account_changed") {
      const generation = stopSession(win, { preserveActiveGame: true })
      void startSession(win, active.credentials, generation)
      return
    }
    if (result.state === "stale") return

    active.summoner = result.summoner
    if (result.state === "changed") {
      broadcast(win, "lcu:status", { connected: true, summoner: result.summoner })
    }
  } catch (error) {
    console.warn(`Account profile snapshot skipped: ${(error as Error).message}`)
  }
}

/**
 * Records where the player stands on the ladder.
 *
 * The client only ever reports the current standing, so a season's climb only
 * exists if it is written down as it happens.
 */
async function snapshotRanked(win: BrowserWindow, active: Session) {
  if (collectionDisabled() || session !== active) return

  try {
    const stats = await active.client.request<{
      queueMap?: Record<
        string,
        {
          tier?: string
          division?: string
          leaguePoints?: number
          wins?: number
          losses?: number
        }
      >
    }>("/lol-ranked/v1/current-ranked-stats")
    if (collectionDisabled() || session !== active) return

    const recordedAt = Date.now()
    let changed = false

    for (const [queue, entry] of Object.entries(stats.queueMap ?? {})) {
      // Unranked queues have nothing to plot.
      if (!entry.tier || entry.tier === "NONE") continue

      const stored = getRankedHistory().recordSnapshot({
        puuid: active.summoner.puuid,
        queue,
        recordedAt,
        tier: entry.tier,
        division: entry.division ?? "",
        leaguePoints: entry.leaguePoints ?? 0,
        wins: entry.wins ?? 0,
        losses: entry.losses ?? 0,
      })

      changed = changed || stored
    }

    if (changed) broadcast(win, "ranked:updated")
  } catch (error) {
    console.warn(`Ranked snapshot skipped: ${(error as Error).message}`)
  }
}

/** Records challenge standing so progress over time can be shown. */
async function snapshotProfile(win: BrowserWindow, active: Session) {
  if (collectionDisabled() || session !== active) return

  try {
    const summary = await active.client.request<{
      overallChallengeLevel: string
      totalChallengeScore: number
      positionPercentile?: number
      categoryProgress?: unknown[]
    }>("/lol-challenges/v1/summary-player-data/local-player")
    if (collectionDisabled() || session !== active) return

    const changed = getProfiles().recordSnapshot({
      puuid: active.summoner.puuid,
      recordedAt: Date.now(),
      overallLevel: summary.overallChallengeLevel ?? "NONE",
      totalScore: summary.totalChallengeScore ?? 0,
      percentile: summary.positionPercentile ?? null,
      categoryJson: JSON.stringify(summary.categoryProgress ?? []),
    })

    // Avoid restarting dashboard charts on every periodic sync when the
    // profile snapshot is identical to the one already stored.
    if (changed) broadcast(win, "profile:updated")
  } catch (error) {
    console.warn(`Profile snapshot skipped: ${(error as Error).message}`)
  }
}

function connectToLcu(win: BrowserWindow) {
  if (lcuDiscovery) return
  const discovery = new LcuDiscovery()
  lcuDiscovery = discovery

  discovery.on("connect", (credentials: LcuCredentials) => {
    // A new lockfile connection after maintenance is the explicit reconnect
    // described by the clear-history confirmation. The session that performed
    // the clear is stopped first and can never resume collection on its own.
    if (!databaseWrites.maintenanceActive &&
        settingsStore.getMain("collection-mode") === "disabled_after_clear") {
      settingsStore.setMain("collection-mode", "enabled")
    }
    const generation = stopSession(win, { preserveActiveGame: true })
    void startSession(win, credentials, generation)
  })

  discovery.on("disconnect", () => {
    stopSession(win, { preserveActiveGame: true })
  })

  discovery.start()
}

function stopLcuDiscovery() {
  lcuDiscovery?.stop()
  lcuDiscovery?.removeAllListeners()
  lcuDiscovery = undefined
}

function requireSession() {
  if (!session) throw new Error("The League Client is not connected")
  return session
}

/**
 * The account whose history is shown.
 *
 * Falls back to the last signed-in account so recorded stats stay readable
 * when the League client is closed.
 */
function currentPuuid(): string | undefined {
  if (session) {
    settingsStore.setMain("last-puuid", session.summoner.puuid)
    return session.summoner.puuid
  }
  if (activeGame) return activeGame.ownerPuuid
  return settingsStore.getMain("last-puuid")
}

function withPuuid<T extends object>(filter: T = {} as T): T & { puuid: string } {
  const puuid = currentPuuid()
  if (!puuid) throw new Error("No League account has been seen yet")
  return { ...filter, puuid }
}

/** Where a rank goal currently stands, in the same points a goal targets. */
function currentRankPoints(puuid: string, queue: string): number {
  const latest = getRankedHistory().getLatest(puuid, queue)
  if (!latest) return 0

  return rankToPoints(latest.tier, latest.division, latest.leaguePoints)
}

/** Challenge ids the player is chasing. Kept as a setting, not as history. */
function readPinned(): number[] {
  return settingsStore.getMain("pinned-challenges") ?? []
}

function storedChampionCatalog(): ChampionCatalogEntry[] {
  return mergeChampionCatalog(settingsStore.getMain("champion-catalog"))
}

function rememberChampionCatalog(fetched: unknown): ChampionCatalogEntry[] {
  const merged = mergeChampionCatalog(storedChampionCatalog(), fetched)
  settingsStore.setMain("champion-catalog", merged)
  championNames = new Map(merged.map((champion) => [champion.id, champion.name]))
  return merged
}

/** Returns the last complete catalog offline and refreshes it when League is open. */
async function loadChampionCatalog(): Promise<ChampionCatalogEntry[]> {
  const stored = storedChampionCatalog()
  championNames = new Map(stored.map((champion) => [champion.id, champion.name]))
  if (!session) return stored

  try {
    const fetched = await session.client.request<ChampionCatalogEntry[]>(
      `/lol-champions/v1/inventories/${session.summoner.summonerId}/champions-minimal`,
    )
    // Keep every positive-id entry the client returned. Hidden entries do not
    // belong in picker UIs, but remembering their names prevents an imported
    // match from ever regressing to a raw "Champion 123" label.
    return rememberChampionCatalog(fetched)
  } catch {
    return stored
  }
}

/** Champion names for recommendations, online or offline. */
async function championNameFor(championId: number): Promise<string | undefined> {
  const known = championNames?.get(championId)
  if (known) return known

  const catalog = await loadChampionCatalog()
  return catalog.find((champion) => champion.id === championId)?.name
}

function registerIpc(win: BrowserWindow, updaterService: UpdaterService) {
  ipcMain.on("app-ready", () => {
    void restoreActiveGameRuntime(win)
      .catch((error) => {
        console.warn(`Could not restore active game: ${(error as Error).message}`)
      })
      .finally(() => connectToLcu(win))
  })

  ipcMain.on("window:minimize", () => win.minimize())
  ipcMain.on("window:toggle-maximize", () => {
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on("window:close", () => win.close())
  ipcMain.handle("window:is-maximized", () => win.isMaximized())
  ipcMain.handle("tempo-overlay:status", () => tempoOverlayStatus())
  ipcMain.handle("tempo-overlay:toggle", () => toggleTempoOverlay(win))
  ipcMain.handle("tempo-overlay:lock", () => setTempoOverlayLocked(win, true))
  ipcMain.handle("tempo-overlay:reset-position", () => resetTempoOverlayPosition(win))
  ipcMain.handle("minimap-vision-debug:status", () => minimapVisionDebugStatus())
  ipcMain.handle("minimap-vision-debug:toggle", () => toggleMinimapVisionDebugOverlay(win))
  ipcMain.handle("minimap-vision-debug:lock", () => setMinimapVisionDebugLocked(win, true))
  ipcMain.handle("minimap-vision-debug:reset-position", () => resetMinimapVisionDebugPosition(win))

  registerUpdaterIpc(ipcMain, updaterService)

  ipcMain.handle("settings:ui:get", () => settingsStore.getRenderer("settings"))
  ipcMain.handle("settings:ui:set", (_event, value: UiSettings) =>
    settingsStore.setRenderer("settings", value))
  ipcMain.handle("settings:skill-view:get", () =>
    settingsStore.getRenderer("skill-view-preferences"))
  ipcMain.handle("settings:skill-view:set", (_event, value: unknown) =>
    settingsStore.setRenderer("skill-view-preferences", value))
  ipcMain.handle("settings:recommendation-objective:get", () =>
    settingsStore.getRenderer("recommendation-objective"))
  ipcMain.handle("settings:recommendation-objective:set", (_event, value: unknown) =>
    settingsStore.setRenderer("recommendation-objective", value))
  ipcMain.handle("settings:last-seen-patch-notes-version:get", () =>
    settingsStore.getRenderer("last-seen-patch-notes-version"))
  ipcMain.handle("settings:last-seen-patch-notes-version:set", (_event, value: unknown) =>
    settingsStore.setRenderer("last-seen-patch-notes-version", value))
  ipcMain.handle("settings:launch-at-login:get", () =>
    settingsStore.getRenderer("launch-at-login"))
  ipcMain.handle("settings:launch-at-login:set", (_event, value: unknown) => {
    const enabled = settingsStore.setRenderer("launch-at-login", value) as boolean
    configureLoginItem(enabled)
    return enabled
  })
  ipcMain.handle("settings:minimap-telemetry:get", () =>
    settingsStore.getRenderer("minimap-telemetry-enabled") ?? true)
  ipcMain.handle("settings:minimap-telemetry:set", (_event, value: unknown) => {
    const enabled = settingsStore.setRenderer("minimap-telemetry-enabled", value) as boolean
    if (activeGame) {
      trackMinimapTelemetry(activeGame.minimapTelemetry.update(liveSession))
    }
    return enabled
  })
  ipcMain.handle("settings:minimap-vision-debug:get", () =>
    MINIMAP_VISION_DEBUG_AVAILABLE &&
    (settingsStore.getRenderer("minimap-vision-debug-enabled") ?? false))
  ipcMain.handle("settings:minimap-vision-debug:set", (_event, value: unknown) =>
  {
    if (!MINIMAP_VISION_DEBUG_AVAILABLE) return false
    const enabled = settingsStore.setRenderer("minimap-vision-debug-enabled", value) as boolean
    if (activeGame) {
      trackMinimapTelemetry(activeGame.minimapTelemetry.update(liveSession))
    }
    return enabled
  })
  ipcMain.handle("settings:minimap-vision-overlay:get", () =>
    MINIMAP_VISION_DEBUG_AVAILABLE &&
    (settingsStore.getRenderer("minimap-vision-overlay-enabled") ?? false))
  ipcMain.handle("settings:minimap-vision-overlay:set", (_event, value: unknown) => {
    if (!MINIMAP_VISION_DEBUG_AVAILABLE) return false
    const enabled = settingsStore.setRenderer("minimap-vision-overlay-enabled", value) as boolean
    if (!enabled && (minimapVisionDebugRequestedVisible || latestMinimapVisionDebug.enabled)) {
      clearMinimapVisionDebugOverlay(win)
    }
    if (activeGame) {
      trackMinimapTelemetry(activeGame.minimapTelemetry.update(liveSession))
    }
    return enabled
  })
  ipcMain.handle("settings:display-timezone:get", () => {
    const override = settingsStore.getRenderer("display-timezone") as string | undefined
    return { timeZone: resolveDisplayTimezone(override), override }
  })
  ipcMain.handle("settings:display-timezone:set", (_event, value: unknown) => {
    const override = settingsStore.setRenderer("display-timezone", value) as string
    const timeZone = resolveDisplayTimezone(override)
    broadcast(win, "recall:timezone-changed", { timeZone, override })
    return { timeZone, override }
  })
  ipcMain.handle("settings:display-timezone:use-system", () => {
    settingsStore.deleteRenderer("display-timezone")
    const timeZone = resolveDisplayTimezone()
    broadcast(win, "recall:timezone-changed", { timeZone })
    return { timeZone }
  })
  ipcMain.handle("cache:aram-stats:get", () => settingsStore.getMain("aram-stats"))
  ipcMain.handle("cache:aram-stats:set", (_event, value: unknown) =>
    settingsStore.setMain("aram-stats", value))
  ipcMain.handle("cache:ddragon-version:get", () => settingsStore.getMain("ddragon-version"))
  ipcMain.handle("cache:ddragon-version:set", (_event, value: unknown) =>
    settingsStore.setMain("ddragon-version", value))

  ipcMain.handle("champions:catalog", () => loadChampionCatalog())

  registerDataTrustIpc(ipcMain, {
    getDataTrustService,
    getBackupManager,
    getDatabase,
    getReportContext: () => ({
      puuid: currentPuuid(),
      keyConfigured: settingsStore.getMain("riot-api-key-encrypted") !== undefined,
      keyProtected: safeStorage.isEncryptionAvailable(),
    }),
    trackDatabaseTask,
    normalizeBackupName: (value) => limitedString(value, "Backup name", 180),
    broadcastUpdated: (report) => broadcast(win, "data-trust:updated", report),
    scheduleApplicationRestart: () => {
      setImmediate(() => {
        quitting = true
        app.relaunch()
        app.quit()
      })
    },
  })

  ipcMain.handle("review:overview", () =>
    getReviewService(win).overview(withPuuid().puuid),
  )
  ipcMain.handle("review:jungle-pathing", (_event, rawGameId: unknown) => {
    const gameId = integer(rawGameId, "Game id")
    return new MinimapTelemetryRepository(getDatabase()).getReview(
      gameId,
      withPuuid().puuid,
    )
  })
  ipcMain.handle("stats:champion-jungle-clears", (_event, rawChampionId: unknown) => {
    const championId = integer(rawChampionId, "Champion id")
    return new MinimapTelemetryRepository(getDatabase()).getChampionJungleClearStats(
      withPuuid().puuid,
      championId,
    )
  })
  ipcMain.handle("augments:owner-summary", (_event, rawAugmentId: unknown, rawChampionId: unknown) =>
    getParticipants().getOwnerAugmentSummaries(
      withPuuid().puuid,
      rawAugmentId === undefined || rawAugmentId === null
        ? undefined
        : integer(rawAugmentId, "Augment id"),
      rawChampionId === undefined || rawChampionId === null
        ? undefined
        : integer(rawChampionId, "Champion id"),
    ),
  )
  ipcMain.handle("augments:cache-catalog", (_event, rawInput: unknown) => {
    if (!rawInput || typeof rawInput !== "object") {
      throw new Error("Augment catalog is invalid")
    }
    const input = rawInput as { dataVersion?: unknown; entries?: unknown }
    const dataVersion = limitedString(input.dataVersion, "Data version", 40)
    if (!dataVersion || !Array.isArray(input.entries) || input.entries.length > 1_000) {
      throw new Error("Augment catalog is invalid")
    }
    const entries = input.entries.map((rawEntry) => {
      if (!rawEntry || typeof rawEntry !== "object") {
        throw new Error("Augment entry is invalid")
      }
      const entry = rawEntry as Record<string, unknown>
      const optional = (value: unknown, label: string, maximum: number) =>
        value === undefined || value === null || value === ""
          ? undefined
          : limitedString(value, label, maximum)
      const iconPath = optional(entry.iconPath, "Augment icon", 500)
      if (
        iconPath &&
        !iconPath.startsWith(
          "https://raw.communitydragon.org/",
        )
      ) {
        throw new Error("Augment icon is invalid")
      }
      return {
        augmentId: integer(entry.augmentId, "Augment id"),
        name: limitedString(entry.name, "Augment name", 120),
        rarity: optional(entry.rarity, "Augment rarity", 32),
        iconPath,
      }
    })
    return getParticipants().cacheAugmentCatalog(dataVersion, entries)
  })
  ipcMain.handle("review:match", async (_event, rawGameId: unknown) => {
    const puuid = withPuuid().puuid
    const review = getReviewService(win).match(
      integer(rawGameId, "Game id"),
      puuid,
    )
    return {
      ...review,
      scoreboard: await attachPlayerMasteries(puuid, review.scoreboard),
    }
  })
  ipcMain.handle(
    "review:sessions",
    (_event, rawPage: unknown, rawPageSize: unknown) =>
      getReviewService(win).sessions(
        withPuuid().puuid,
        integer(rawPage, "Page"),
        integer(rawPageSize, "Page size"),
      ),
  )
  ipcMain.handle(
    "review:session-boundary",
    (_event, rawGameId: unknown, rawAction: unknown) => {
      const gameId = integer(rawGameId, "Game id")
      const action = rawAction === null
        ? null
        : oneOf(rawAction, ["split", "join"] as const, "Boundary action")
      const puuid = withPuuid().puuid
      if (!getRepository().getMatch(gameId, puuid)) throw new Error("Match not found")
      getReviewRepository().setBoundaryOverride(gameId, puuid, action)
      broadcast(win, "review:updated", gameId)
      return true
    },
  )

  ipcMain.handle(
    "recommendations:champions",
    async (
      _event,
      rawChampionIds: unknown,
      rawMode: unknown,
      rawObjective: unknown,
    ) => {
      if (!Array.isArray(rawChampionIds) || rawChampionIds.length > 200) {
        throw new Error("Champion options are invalid")
      }
      const championIds = [...new Set(rawChampionIds.map((value) =>
        integer(value, "Champion id"),
      ))]
      const mode = oneOf(rawMode, [
        "sr_ranked_solo", "sr_ranked_flex", "sr_normal", "sr_quickplay",
        "sr_swiftplay", "aram", "mayhem", "league_classic", "other",
      ] as const, "Mode")
      const objective = oneOf(rawObjective, [
        "best_overall", "recent_form", "challenges", "practice", "most_reliable",
      ] as const, "Objective") as ChampionChoiceObjective
      const puuid = withPuuid().puuid
      const all = getRepository().getAllMatches(puuid)
        .filter((match) => match.mode === mode)
      const candidates: RecommendationCandidate[] = await Promise.all(
        championIds.map(async (championId) => {
          const statuses = await Promise.resolve(
            readPinned().flatMap((id) => {
              const challenge = getChallenges().getById(id, puuid)
              if (!challenge) return []
              const status = championStatusFor(challenge, championId)
              return status && !status.completed ? [status.name] : []
            }),
          )
          return {
            championId,
            championName: (await championNameFor(championId)) ?? `Champion ${championId}`,
            incompleteChallengeNames: statuses,
            games: all.filter((match) => match.championId === championId).map((match) => ({
              championId,
              championName: "",
              playedAt: match.playedAt,
              win: match.win === 1,
              kills: match.kills,
              deaths: match.deaths,
              assists: match.assists,
              gradeScore: match.gradeScore,
              recallScore: match.recallScore,
            })),
          }
        }),
      )
      settingsStore.setMain("recommendation-objective", objective)
      return recommendChampions(candidates, objective)
    },
  )

  ipcMain.handle("timeline:get", (_event, rawGameId: unknown) =>
    getTimelineService(win).get(
      integer(rawGameId, "Game id"),
      withPuuid().puuid,
    ),
  )
  ipcMain.handle(
    "timeline:request",
    (_event, rawGameId: unknown, manualRetry: unknown) => {
      if (collectionDisabled()) throw new Error("History collection is disabled")
      return trackDatabaseTask(getTimelineService(win).request(
        integer(rawGameId, "Game id"),
        withPuuid().puuid,
        manualRetry === true,
      ))
    },
  )

  ipcMain.handle("annotations:get", (_event, rawGameId: unknown) =>
    getReviewRepository().getAnnotation(
      integer(rawGameId, "Game id"),
      withPuuid().puuid,
    ),
  )
  ipcMain.handle(
    "annotations:save",
    (_event, rawGameId: unknown, rawInput: unknown) => {
      const input = rawInput as Record<string, unknown>
      const gameId = integer(rawGameId, "Game id")
      const puuid = withPuuid().puuid
      if (!getRepository().getMatch(gameId, puuid)) throw new Error("Match not found")
      if (!Array.isArray(input?.tagIds)) throw new Error("Tags are invalid")
      const saved = getReviewRepository().saveAnnotation(gameId, puuid, {
        note: boundedText(input.note ?? "", "Note", 4_000),
        bookmarked: input.bookmarked === true,
        tagIds: input.tagIds.map((tagId) => integer(tagId, "Tag id")).slice(0, 20),
      })
      if (saved.bookmarked && !collectionDisabled()) {
        void trackDatabaseTask(getTimelineService(win).request(gameId, puuid))
      }
      broadcast(win, "review:updated", gameId)
      return saved
    },
  )
  ipcMain.handle("tags:list", () =>
    getReviewRepository().listTags(withPuuid().puuid),
  )
  ipcMain.handle(
    "tags:create",
    (_event, rawName: unknown, rawColor: unknown) => {
      const name = limitedString(rawName, "Tag name", 24)
      if (!name) throw new Error("Tag name is required")
      return getReviewRepository().createTag(
        withPuuid().puuid,
        name,
        typeof rawColor === "string" ? rawColor : undefined,
      )
    },
  )
  ipcMain.handle("tags:delete", (_event, rawId: unknown) =>
    getReviewRepository().deleteTag(
      integer(rawId, "Tag id"),
      withPuuid().puuid,
    ),
  )

  // A Riot key must never travel back to the renderer. Electron delegates
  // encryption to the operating system (DPAPI on Windows, Keychain on macOS)
  // and only the main process can retrieve it for future API requests.
  ipcMain.handle("riot-api-key:status", () => {
    const puuid = currentPuuid()
    return {
      configured: settingsStore.getMain("riot-api-key-encrypted") !== undefined,
      protected: safeStorage.isEncryptionAvailable(),
      history: puuid ? getRiotBackfills().getLatest(puuid) : undefined,
    }
  })

  ipcMain.handle("riot-api-key:save", (_event, value: unknown) => {
    const apiKey = normalizeRiotApiKey(value)
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure local storage is unavailable on this computer")
    }
    const encrypted = safeStorage.encryptString(apiKey).toString("base64")
    settingsStore.setMain("riot-api-key-encrypted", encrypted)
    return { configured: true }
  })

  ipcMain.handle("riot-api-key:clear", () => {
    riotBackfillRevision += 1
    riotBackfillAbort?.abort()
    riotBackfillAbort = undefined
    settingsStore.deleteMain("riot-api-key-encrypted")
    return { configured: false }
  })

  ipcMain.handle("riot-history:retry", () => {
    void startRiotHistoryBackfill(win, false)
    return true
  })

  ipcMain.handle("riot-history:reimport-details", () => {
    void startRiotHistoryBackfill(win, true)
    return true
  })

  ipcMain.handle("lcu:status", () => ({
    connected: session !== undefined,
    summoner: session?.summoner ?? null,
  }))

  ipcMain.handle("live:get", () => liveSession)
  ipcMain.handle("minimap-telemetry:health", () =>
    activeGame?.minimapTelemetry.getHealth() ?? {
      state: "idle",
      processedFrames: 0,
      droppedFrames: 0,
      averageProcessingMs: 0,
    })

  ipcMain.handle("lcu:request", (_event, requestPath: string) =>
    requireSession().client.request(requestPath),
  )

  ipcMain.handle("stats:summary", (_event, filter: Partial<MatchQuery>) =>
    getRepository().getSummary(withPuuid(filter)),
  )

  ipcMain.handle("stats:lifetime-totals", () =>
    getRepository().getLifetimeTotals(withPuuid().puuid),
  )

  ipcMain.handle("stats:champions", (_event, filter: Partial<StatsFilter>) =>
    getRepository().getChampionStats(withPuuid(filter)),
  )

  ipcMain.handle("stats:grades", (_event, filter: Partial<MatchQuery>) =>
    getRepository().getGradeDistribution(withPuuid(filter)),
  )

  ipcMain.handle(
    "stats:matches",
    (_event, filter: Partial<StatsFilter>, limit: number) => {
      const scoped = withPuuid(filter)
      return attachMatchCardDetails(
        scoped.puuid,
        getRepository().getRecentMatches(scoped, limit),
      )
    },
  )

  ipcMain.handle(
    "stats:form",
    (_event, filter: Partial<StatsFilter>, limit: number) =>
      getRepository().getRecentForm(withPuuid(filter), limit),
  )

  ipcMain.handle("stats:meta", () => {
    const repo = getRepository()
    const puuid = currentPuuid()

    return {
      databasePath: getDatabasePath(),
      totalMatches: puuid ? repo.countMatches(puuid) : 0,
      oldestPlayedAt: puuid ? repo.getOldestPlayedAt(puuid) : undefined,
      totalChallenges: puuid ? getChallenges().countChallenges(puuid) : 0,
    }
  })

  ipcMain.handle(
    "matches:list",
    (_event, query: Record<string, unknown>, page: number, pageSize: number) => {
      const puuid = withPuuid().puuid
      const result = getRepository().listMatches(
        { ...query, puuid },
        page,
        pageSize,
      )
      return {
        ...result,
        rows: attachMatchCardDetails(puuid, result.rows),
      }
    },
  )

  ipcMain.handle("matches:champions", () =>
    getRepository().getPlayedChampionIds(withPuuid().puuid),
  )

  ipcMain.handle(
    "insights:all",
    (_event, filter: Partial<StatsFilter>, family: ModeFamily) => {
      const scoped = withPuuid(filter)
      const repo = getInsights()
      const time = repo.getTimeOfDay(scoped)

      return {
        duration: repo.getDurationBuckets(scoped, family),
        hours: time.hours,
        weekdays: time.weekdays,
        streaks: repo.getStreakBehaviour(scoped),
        contribution: repo.getTeamContribution(scoped),
        pool: repo.getChampionPool(scoped),
        builds: repo.getBuildPatterns(scoped, 8),
      }
    },
  )

  ipcMain.handle("champions:ranked", (_event, filter: Partial<StatsFilter>) => {
    const scoped = withPuuid(filter)
    const repo = getRepository()

    const { main: ranked, earlySignals } = splitChampionSignals(
      repo.getChampionStats(scoped),
    )

    return { ranked, earlySignals, ...pickBestAndWorst(ranked, 3) }
  })

  ipcMain.handle(
    "stats:rvi",
    async (_event, filter: Partial<StatsFilter>, family: ModeFamily, scoringContext?: PerformanceScoringContext) => {
      const scoped = withPuuid(filter)
      return runStableAnalysis({
        expectedIdentity: scoped.puuid,
        currentIdentity: currentPuuid,
        currentRevision: () => statsRevision,
        task: async () => {
          // RVI is a career profile for the selected frozen recipe. At this hobby-
          // project scale, silently truncating it to a recent window is both
          // unnecessary and misleading.
          return getAnalysisWorker().buildPerformanceProfileFromDatabase({
            databasePath: getDatabasePath(),
            filter: scoped,
            family,
            scoringContext,
          })
        },
      })
    },
  )

  ipcMain.handle("performance-reference:status", () => getMatchGradingService().referenceStatus())

  ipcMain.handle("performance-reference:rebuild", async () => {
    if (collectionDisabled()) throw new Error("History collection is disabled")
    const confirmation = await dialog.showMessageBox(win, {
      type: "warning",
      title: "Recalibrate Recall?",
      message: "Refresh every eligible game mode from its recent complete matches?",
      detail: "Recall creates one verified backup, recalibrates each mode independently from up to its latest 100 games, and preserves the baseline used by older matches.",
      buttons: ["Recalibrate", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    if (confirmation.response !== 0) return { canceled: true }

    const finishMaintenance = databaseWrites.beginMaintenance("performance-reference-rebuild")
    try {
      riotBackfillRevision += 1
      riotBackfillAbort?.abort()
      riotBackfillAbort = undefined
      const activeBackfill = riotBackfillTask
      if (activeBackfill) await activeBackfill.catch(() => undefined)
      riotBackfillTask = undefined
      await databaseWrites.drain()

      const backup = await getBackupManager().createAsync(getDatabase(), "pre-repair")
      const result = await trackDatabaseTask(getAnalysisWorker().rebuildReference({
        databasePath: getDatabasePath(),
        backup: {
          path: backup.fileName,
          sha256: backup.sha256,
        },
      }, (progress) => {
        if (progress.processed === progress.total || progress.processed % 25 === 0) {
          broadcast(win, "performance-reference:progress", progress)
        }
      }))
      broadcast(win, "stats:updated", { inserted: 0, regraded: result.processed })
      broadcast(win, "performance-reference:updated", getMatchGradingService().referenceStatus())
      broadcast(win, "data-trust:updated")
      return result
    } finally {
      finishMaintenance()
    }
  })

  ipcMain.handle(
    "stats:skill-report",
    async (_event, filter: Partial<StatsFilter>, family: ModeFamily) => {
      const scoped = withPuuid(filter)
      return runStableAnalysis({
        expectedIdentity: scoped.puuid,
        currentIdentity: currentPuuid,
        currentRevision: () => statsRevision,
        task: () => getAnalysisWorker().buildSkillReportFromDatabase({
          databasePath: getDatabasePath(),
          filter: scoped,
          family,
          generatedAt: Date.now(),
        }),
      })
    },
  )

  ipcMain.handle("stats:records", (_event, filter: Partial<StatsFilter>) =>
    getRepository().getRecords(withPuuid(filter)),
  )

  ipcMain.handle("ranked:history", () => {
    const puuid = withPuuid().puuid
    const history = getRankedHistory()

    return history.getQueues(puuid).map((queue) => {
      const points = history.getHistory(puuid, queue).map((entry) => ({
        recordedAt: entry.recordedAt,
        points: rankToPoints(entry.tier, entry.division, entry.leaguePoints),
        label: formatRank(entry.tier, entry.division),
        leaguePoints: entry.leaguePoints,
        wins: entry.wins,
        losses: entry.losses,
      }))

      return { queue, points }
    })
  })

  ipcMain.handle("goals:list", () => {
    const puuid = withPuuid().puuid
    const stored = getGoals().list(puuid)
    if (stored.length === 0) return []

    const challenges = getChallenges().getAll({ puuid })
    const byId = new Map(
      challenges.map((challenge) => [String(challenge.challengeId), challenge]),
    )

    return stored.map((goal) => {
      const current =
        goal.kind === "challenge"
          ? (byId.get(goal.targetKey)?.currentValue ?? 0)
          : currentRankPoints(puuid, goal.targetKey)

      const progress =
        goal.targetValue <= 0 ? 1 : Math.min(1, current / goal.targetValue)

      // A goal reached is worth marking, so it stops being a to-do.
      if (progress >= 1 && !goal.achievedAt) getGoals().markAchieved(goal.id)

      return { ...goal, current, progress }
    })
  })

  ipcMain.handle("goals:add", (_event, goal: Omit<GoalInput, "puuid">) =>
    getGoals().add({ ...goal, puuid: withPuuid().puuid }),
  )

  ipcMain.handle("goals:remove", (_event, id: number) =>
    getGoals().remove(id, withPuuid().puuid),
  )

  ipcMain.handle(
    "challenges:list",
    (_event, filter: Partial<ChallengeFilter>) =>
      getChallenges().getAll({ ...filter, puuid: withPuuid().puuid }),
  )

  ipcMain.handle("challenges:detail", (_event, challengeId: number) =>
    getChallenges().getById(challengeId, withPuuid().puuid),
  )

  ipcMain.handle("challenges:history", (_event, challengeId: number) =>
    getChallenges().getHistory(challengeId, withPuuid().puuid),
  )

  ipcMain.handle("challenges:champion-needs", (_event, championIds: number[]) => {
    const puuid = withPuuid().puuid
    const all = getChallenges().getAll({ puuid, idListType: "CHAMPION" })
    return Object.fromEntries(championsNeededFor(all, championIds))
  })

  ipcMain.handle("challenges:pinned", () => readPinned())

  ipcMain.handle("challenges:pin", (_event, challengeId: number) => {
    const pinned = readPinned()
    if (!pinned.includes(challengeId)) {
      settingsStore.setMain("pinned-challenges", [...pinned, challengeId])
    }
    return readPinned()
  })

  ipcMain.handle("challenges:unpin", (_event, challengeId: number) => {
    settingsStore.setMain(
      "pinned-challenges",
      readPinned().filter((id) => id !== challengeId),
    )
    return readPinned()
  })

  /**
   * What the pinned challenges say about a champion.
   *
   * Only champion-tracked challenges can answer, so the rest are left out
   * rather than reported with nothing useful to say.
   */
  ipcMain.handle(
    "challenges:champion-status",
    (_event, championId: number) => {
      const pinned = readPinned()
      if (pinned.length === 0) return []

      const puuid = withPuuid().puuid
      const repo = getChallenges()

      return pinned
        .map((id) => repo.getById(id, puuid))
        .filter((challenge) => challenge !== undefined)
        .map((challenge) => championStatusFor(challenge!, championId))
        .filter((status) => status !== undefined)
    },
  )

  ipcMain.handle("profile:summary", async () => {
    const puuid = currentPuuid()
    const latest = puuid ? getProfiles().getLatest(puuid) : undefined

    let ranked: unknown = null
    let mastery: unknown = []

    if (session) {
      try {
        ranked = await session.client.request(
          "/lol-ranked/v1/current-ranked-stats",
        )
        mastery = await session.client.request(
          "/lol-champion-mastery/v1/local-player/champion-mastery",
        )
      } catch (error) {
        console.warn(`Profile read skipped: ${(error as Error).message}`)
      }
    }

    return { challenges: latest ?? null, ranked, mastery }
  })

  ipcMain.handle("profile:trend", (_event, sinceMs: number) =>
    getProfiles().getTrend(withPuuid().puuid, sinceMs),
  )

  ipcMain.handle("app:refresh-all", () => {
    if (!session) throw new Error("The League Client is not connected")
    return runSync(win)
  })

  ipcMain.handle("stats:sync", () => {
    if (!session || collectionDisabled()) return { fetched: 0, inserted: 0 }
    return runSync(win)
  })

  ipcMain.handle("stats:export", async () => {
    const puuid = withPuuid().puuid

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Export Match summary CSV",
      defaultPath: `recall-match-summary-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    })

    if (canceled || !filePath) return { exported: 0 }

    const result = await trackDatabaseTask(getAnalysisWorker().exportMatchSummary({
      databasePath: getDatabasePath(),
      puuid,
      filePath,
    }).then((exported) => {
      const now = Date.now()
      getDatabase().prepare(
        `INSERT INTO export_artifacts
         (kind, absolute_path, artifact_sha256, status, created_at, last_verified_at)
         VALUES ('match_summary_csv', ?, ?, 'present', ?, ?)
         ON CONFLICT(absolute_path) DO UPDATE SET artifact_sha256=excluded.artifact_sha256,
           status='present', last_verified_at=excluded.last_verified_at`,
      ).run(path.resolve(exported.filePath), exported.digest, now, now)
      return exported
    }))

    return { exported: result.exported, filePath: result.filePath }
  })

  ipcMain.handle("stats:full-backup", async () => {
    const warning = await dialog.showMessageBox(win, {
      type: "warning",
      buttons: ["Cancel", "Create full backup"],
      defaultId: 0,
      cancelId: 0,
      title: "Create full Recall backup",
      message: "This lossless backup contains raw source bodies and player identifiers.",
      detail: "It excludes the Riot API key, active-account pointer, machine preferences, and caches.",
    })
    if (warning.response !== 1) return { created: false }
    const selected = await dialog.showSaveDialog(win, {
      title: "Choose full backup name",
      defaultPath: `recall-${new Date().toISOString().slice(0, 10)}`,
    })
    if (selected.canceled || !selected.filePath) return { created: false }
    const target = selected.filePath.endsWith(".recall-backup")
      ? selected.filePath : `${selected.filePath}.recall-backup`
    const manifest = new ExportService(getDatabase(), getDatabasePath(), app.getVersion())
      .createFullBackup(target, settingsStore.snapshotRestorable())
    broadcast(win, "data-trust:updated")
    return { created: true, path: target, manifest }
  })

  ipcMain.handle("stats:clear", async () => {
    const puuid = withPuuid().puuid

    const { response } = await dialog.showMessageBox(win, {
      type: "warning",
      buttons: ["Cancel", "Clear active history (recoverable)"],
      defaultId: 0,
      cancelId: 0,
      title: "Clear active history (recoverable)",
      message: "Create a protected recovery point, then clear this account's active history?",
      detail:
        "Recall keeps the backup and existing exports. Collection stays disabled until you explicitly reconnect; " +
        "reconnecting may re-import matches still in the League client's recent history.",
    })

    if (response !== 1) return { deleted: 0 }

    const previousCollectionMode = settingsStore.getMain("collection-mode")
    const finishMaintenance = databaseWrites.beginMaintenance("clear-history")
    try {
      settingsStore.setMain("collection-mode", "disabled_after_clear")
      // Stop every producer before taking the recovery point. In particular,
      // a late post-game sync or timeline request must not repopulate this
      // account after the clear transaction commits.
      riotBackfillRevision += 1
      riotBackfillAbort?.abort()
      riotBackfillAbort = undefined
      const activeBackfill = riotBackfillTask
      stopSession(win)
      if (activeBackfill) await activeBackfill.catch(() => undefined)
      await databaseWrites.drain()
      riotBackfillTask = undefined

      const backup = await getBackupManager().createAsync(getDatabase(), "pre-clear")
      const result = new ClearHistoryService(getDatabase()).clear(puuid, backup)
      // Debug samples are bounded minimap-only artifacts, but are still
      // account-session evidence. Clear the dedicated root after the
      // transaction; failures do not invalidate the successful DB clear.
      await rm(path.join(app.getPath("userData"), "Minimap Vision Debug"), {
        recursive: true,
        force: true,
      }).catch(() => undefined)
      if (settingsStore.getMain("last-puuid") === puuid) {
        settingsStore.deleteMain("last-puuid")
      }
      broadcast(win, "stats:updated", { fetched: 0, inserted: 0 })
      broadcast(win, "performance-reference:updated", getMatchGradingService().referenceStatus())
      broadcast(win, "data-trust:updated")
      return result
    } catch (error) {
      if (previousCollectionMode === undefined) settingsStore.deleteMain("collection-mode")
      else settingsStore.setMain("collection-mode", previousCollectionMode)
      throw error
    } finally {
      finishMaintenance()
    }
  })
}

function createDailyBackupIfNeeded(win: BrowserWindow) {
  const today = new Date().toISOString().slice(0, 10)
  if (settingsStore.getMain("last-daily-backup") === today || dailyBackupTask) return
  const task = getBackupManager().createAsync(getDatabase(), "daily")
    .then(() => {
      settingsStore.setMain("last-daily-backup", today)
      broadcast(win, "data-trust:updated")
    })
    .catch((error) => {
      console.warn("Could not create daily backup", error)
    })
    .finally(() => {
      dailyBackupTask = undefined
    })
  dailyBackupTask = trackDatabaseTask(task)
}

function integer(value: unknown, label: string, minimum = 1) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new Error(`${label} is invalid`)
  }
  return Number(value)
}

function limitedString(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string") throw new Error(`${label} is invalid`)
  const trimmed = value.trim()
  if (trimmed.length > maximum) throw new Error(`${label} is too long`)
  return trimmed
}

function boundedText(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string") throw new Error(`${label} is invalid`)
  if (value.length > maximum) throw new Error(`${label} is too long`)
  return value
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label} is invalid`)
  }
  return value as T
}

async function prepareShutdown(
  win: BrowserWindow,
  createSnapshot: boolean,
) {
  if (shutdownPrepared) return

  quitting = true
  riotBackfillRevision += 1
  riotBackfillAbort?.abort()
  riotBackfillAbort = undefined
  stopLcuDiscovery()
  stopSession(win, { preserveJournal: true })

  // Aborted API requests still need one turn to record their durable paused
  // cursor. Local match/challenge syncs are also allowed to finish before the
  // database is checkpointed or closed.
  await databaseWrites.drain()
  riotBackfillTask = undefined

  try {
    if (database?.open && createSnapshot) {
      await getBackupManager().createAsync(database, "pre-update")
      createUpdateSnapshot(
        database,
        getDatabasePath(),
        getDatabaseBackupDir(),
      )
    }
    await analysisWorker?.close()
    analysisWorker = undefined
    if (database?.open) database.close()
    database = undefined
    shutdownPrepared = true
  } catch (error) {
    // The updater will report the failure and leave the running database open.
    quitting = false
    throw error
  }
}

async function main() {
  await app.whenReady()

  try {
    const restored = getBackupManager().applyRestoreIntent(latestSchemaVersion)
    if (restored) console.log("Restored the selected verified database backup")
  } catch (error) {
    startupRestoreError = (error as Error).message
    dialog.showErrorBox(
      "Recall could not restore the selected backup",
      `${(error as Error).message}\n\nThe existing database was retained.`,
    )
  }

  const restoredSnapshot = restoreLatestUpdateSnapshot(
    getDatabasePath(),
    getDatabaseBackupDir(),
  )
  if (restoredSnapshot) {
    console.log(`Restored database after update from ${restoredSnapshot}`)
  }

  // Must run before the database is opened so a renamed install keeps its
  // recorded games.
  adoptPreviousInstallData()
  // Constructing electron-store creates config.json, so it must happen only
  // after the previous installation has had a chance to copy that file.
  store = new Store()
  settingsStore = new SettingsStore(store)
  if (settingsStore.getMain("launch-at-login") === undefined) {
    settingsStore.setMain("launch-at-login", true)
  }
  configureLoginItem(settingsStore.getMain("launch-at-login") !== false)

  // Open and validate persistent data before showing the renderer. If startup
  // cannot continue, a half-initialised window would only emit a wall of "No
  // handler registered" errors because IPC registration happens afterwards.
  try {
    getRepository()
    await ensureRecallFrozen()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      "Could not initialise Recall's database:",
      error instanceof Error ? error.stack ?? error.message : error,
    )
    dialog.showErrorBox(
      "Recall could not open your history",
      `${message}\n\nYour database was left untouched at:\n${getDatabasePath()}`,
    )
    app.quit()
    return
  }

  const startHidden = app.isPackaged && process.argv.includes(START_HIDDEN_ARG)
  const win = await createWindow(startHidden)
  createTray(win)
  if (startupRecovery) {
    void dialog.showMessageBox(win, {
      type: "warning",
      title: "Recall recovered your history",
      message: "Recall found database corruption and opened the newest working backup.",
      detail:
        `Recovered from:\n${startupRecovery.sourcePath}\n\n` +
        `Damaged database preserved at:\n${startupRecovery.quarantinedPath}`,
      buttons: ["Continue"],
      defaultId: 0,
    })
  }

  const updater = createUpdaterService({
    updater: autoUpdater,
    isPackaged: app.isPackaged,
    publish: (status) => broadcast(win, "app:update-status", status),
    beforeInstall: () => prepareShutdown(win, true),
    beginInstall: (version) => markUpdateInProgress(
      app.getPath("userData"),
      version,
    ),
    cancelInstall: () => clearUpdateMarker(app.getPath("userData")),
  })

  registerIpc(win, updater)
  tempoOverlayShortcutRegistered = globalShortcut.register(
    "Alt+T",
    () => toggleTempoOverlay(win),
  )
  if (!tempoOverlayShortcutRegistered) {
    console.warn("Could not register the Alt+T Tempo overlay shortcut")
  }
  screen.on("display-removed", keepTempoOverlayOnScreen)
  screen.on("display-metrics-changed", keepTempoOverlayOnScreen)
  screen.on("display-removed", keepMinimapVisionDebugOnScreen)
  screen.on("display-metrics-changed", keepMinimapVisionDebugOnScreen)
  void updater.start()

  // A second launch reveals the running copy rather than starting another.
  app.on("second-instance", () => reveal(win))

  app.on("before-quit", (event) => {
    if (shutdownPrepared) return
    event.preventDefault()
    if (shutdownPreparing) return

    shutdownPreparing = prepareShutdown(win, false)
      .then(() => app.quit())
      .catch((error) => {
        shutdownPreparing = undefined
        quitting = false
        console.error(`Could not close Recall safely: ${(error as Error).message}`)
      })
  })

  app.on("will-quit", () => {
    globalShortcut.unregister("Alt+T")
    screen.removeListener("display-removed", keepTempoOverlayOnScreen)
    screen.removeListener("display-metrics-changed", keepTempoOverlayOnScreen)
    screen.removeListener("display-removed", keepMinimapVisionDebugOnScreen)
    screen.removeListener("display-metrics-changed", keepMinimapVisionDebugOnScreen)
  })

  // The window only hides, so this fires solely on a real quit. Recall must
  // not exit merely because its window went away.
  app.on("window-all-closed", () => {
    if (quitting) app.quit()
  })
}

if (updateStartup.kind === "updating") {
  void showUpdateInProgress(updateStartup)
} else {
  void main()
}
