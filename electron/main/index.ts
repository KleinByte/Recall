import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  shell,
  Tray,
} from "electron"
import electronUpdater from "electron-updater"
import { fileURLToPath } from "node:url"
import { writeFileSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import Store from "electron-store"
import { openDatabase } from "./database/connection.js"
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
import type { ChallengeRow } from "./challenges/types.js"
import { ProfileRepository } from "./database/profile-repo.js"
import { ParticipantsRepository } from "./database/participants-repo.js"
import { LiveGameCaptureRepository } from "./database/live-game-capture-repo.js"
import { ChampSelectRepository } from "./database/champ-select-repo.js"
import { RankedRepository } from "./database/ranked-repo.js"
import { GoalsRepository, type GoalInput } from "./database/goals-repo.js"
import { rankToPoints, formatRank } from "./ranked/rank.js"
import { ChallengeSync } from "./challenges/challenge-sync.js"
import { InsightsRepository } from "./database/insights-repo.js"
import { RiotBackfillRepository } from "./database/riot-backfill-repo.js"
import {
  matchAxes,
  pickBestAndWorst,
  rankChampions,
} from "./matches/insights.js"
import { buildSkillReport } from "./matches/skill-report.js"
import { buildPerformanceProfile } from "./matches/performance-profile.js"
import { championsNeededFor } from "./challenges/champion-needs.js"
import { championStatusFor, overlayContentFor } from "./challenges/pinned.js"
import { Overlay, type OverlayPosition } from "./overlay.js"
import { LcuClient } from "./lcu-client.js"
import { LcuDiscovery, type LcuCredentials } from "./lcu-discovery.js"
import { LcuEvents as LcuEventStream } from "./lcu-events.js"
import { MatchSync } from "./match-sync.js"
import { syncUntilRecorded } from "./post-game-sync.js"
import { buildStyleProfile } from "./matches/style.js"
import type { ModeFamily, TrackedMode } from "./matches/types.js"
import { migrateLegacyUserData } from "./migrate-user-data.js"
import { createSingleFlightRefresh } from "./full-refresh.js"
import { readLiveSession, type LivePhase, type LiveSession } from "./live-session.js"
import { GameClient, readLiveGameSnapshot } from "./game-client.js"
import { fetchQueues } from "./matches/queues.js"
import { RiotHistoryBackfill } from "./riot/history-backfill.js"
import { canonicalPlatformId, regionalRouteFor } from "./riot/routing.js"
import { normalizeRiotApiKey } from "./riot/api-client.js"
import { BackupManager } from "./database/backup-manager.js"
import { DataTrustService } from "./database/data-trust.js"
import {
  ReviewRepository,
  type ExperimentInput,
  type ExperimentOutcome,
} from "./database/review-repo.js"
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

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, "../..")

export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron")
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist")
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith("6.1")) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === "win32") app.setAppUserModelId("com.kleinbyte.recall")

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const preload = path.join(__dirname, "../preload/index.mjs")
const indexHtml = path.join(RENDERER_DIST, "index.html")

let store: Store
const RIOT_API_KEY_STORE = "riot-api-key-encrypted"
const CHAMPION_CATALOG_STORE = "champion-catalog"

function getDatabasePath() {
  return path.join(app.getPath("userData"), "stats.db")
}

function getDatabaseBackupDir() {
  return path.join(app.getPath("appData"), "Recall Database Backups")
}

/** How long the client needs after a game before its history is readable. */
const PERIODIC_SYNC_INTERVAL_MS = 5 * 60_000
const LIVE_GAME_REFRESH_INTERVAL_MS = 2_000
const SESSION_RETRY_DELAY_MS = 10_000

interface Summoner {
  puuid: string
  gameName: string
  tagLine: string
  summonerId: number
  profileIconId: number
  summonerLevel: number
}

/** State tied to one connected League Client session. */
interface Session {
  client: LcuClient
  events: LcuEventStream
  sync: MatchSync
  challengeSync: ChallengeSync
  summoner: Summoner
  regionalRoute?: string
  platformId?: string
  timer: NodeJS.Timeout
  liveTimer: NodeJS.Timeout
  gameClient: GameClient
}

let session: Session | undefined
let connectRetry: NodeJS.Timeout | undefined
let lcuDiscovery: LcuDiscovery | undefined
let tray: Tray | undefined
let overlay: Overlay | undefined
let overlayRevision = 0
let liveRevision = 0
let liveGameReading = false
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
let database: ReturnType<typeof openDatabase> | undefined
let repository: MatchesRepository | undefined
let challenges: ChallengesRepository | undefined
let profiles: ProfileRepository | undefined
let participants: ParticipantsRepository | undefined
let liveGameCaptures: LiveGameCaptureRepository | undefined
let champSelect: ChampSelectRepository | undefined
let rankedHistory: RankedRepository | undefined
let goals: GoalsRepository | undefined
let insights: InsightsRepository | undefined
let riotBackfills: RiotBackfillRepository | undefined
let reviewRepository: ReviewRepository | undefined
let backupManager: BackupManager | undefined
let dataTrustService: DataTrustService | undefined
let timelineService: LcuTimelineService | undefined
let reviewService: ReviewService | undefined
let startupRestoreError: string | undefined
let riotBackfillAbort: AbortController | undefined
let riotBackfillTask: Promise<void> | undefined
let riotBackfillRevision = 0
const databaseTasks = new Set<Promise<unknown>>()
let shutdownPrepared = false
let shutdownPreparing: Promise<void> | undefined

function trackDatabaseTask<T>(task: Promise<T>): Promise<T> {
  databaseTasks.add(task)
  void task.then(
    () => databaseTasks.delete(task),
    () => databaseTasks.delete(task),
  )
  return task
}

function getDatabase() {
  if (!database) {
    database = openDatabase(getDatabasePath(), {
      backupDir: getDatabaseBackupDir(),
    })
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

function getParticipants(): ParticipantsRepository {
  if (!participants) participants = new ParticipantsRepository(getDatabase())
  return participants
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
  const encrypted = store.get(RIOT_API_KEY_STORE)
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
        const labels = prioritizePerformanceLabels([
          ...evaluateMatchLabels({
            match,
            player,
            participants: detail.participants,
            teams: detail.teams,
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
      },
      getLiveGameCaptures(),
    )
  }
  return timelineService
}

function getReviewService(win: BrowserWindow) {
  if (!reviewService) {
    reviewService = new ReviewService(
      getDatabase(),
      getRepository(),
      getParticipants(),
      getReviewRepository(),
      getTimelineService(win),
    )
  }
  return reviewService
}

async function createWindow() {
  const win = new BrowserWindow({
    title: `Recall v${app.getVersion()}`,
    icon: path.join(process.env.VITE_PUBLIC, "favicon.ico"),
    frame: false,
    autoHideMenuBar: true,
    height: 940,
    width: VITE_DEV_SERVER_URL ? 1500 + 760 : 1500,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#0a1428",
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
    win.webContents.openDevTools()
  } else {
    win.loadFile(indexHtml)
  }

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

function broadcast(win: BrowserWindow, channel: string, payload?: unknown) {
  if (win.isDestroyed()) return
  win.webContents.send(channel, payload)
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

async function startSession(win: BrowserWindow, credentials: LcuCredentials) {
  const client = new LcuClient(credentials)

  let summoner: Summoner
  let regionalRoute: string | undefined
  let platformId: string | undefined
  try {
    summoner = await client.request<Summoner>(
      "/lol-summoner/v1/current-summoner",
    )
  } catch (error) {
    // The client is running but not ready — still signing in, or busy during a
    // game. Discovery will not fire again because the lockfile has not changed,
    // so retry here rather than waiting for a restart.
    console.warn(`Could not read current summoner: ${(error as Error).message}`)
    client.close()

    connectRetry = setTimeout(
      () => void startSession(win, credentials),
      SESSION_RETRY_DELAY_MS,
    )
    return
  }

  try {
    const locale = await client.request<{
      region?: string
      webRegion?: string
    }>("/riotclient/region-locale")
    const platform = locale.region || locale.webRegion
    platformId = platform ? canonicalPlatformId(platform) : undefined
    regionalRoute = platform ? regionalRouteFor(platform) : undefined
  } catch (error) {
    console.warn(`Could not determine Riot API route: ${(error as Error).message}`)
  }

  const sync = new MatchSync(
    client,
    getRepository(),
    summoner.puuid,
    getParticipants(),
    getChampSelect(),
    getLiveGameCaptures(),
  )
  const challengeSync = new ChallengeSync(
    client,
    getChallenges(),
    summoner.puuid,
  )
  const events = new LcuEventStream(credentials)

  events.on("end-of-game", () => {
    broadcast(win, "end-of-game")
    void trackDatabaseTask(catchFinishedGame(win))
  })
  events.on("game-end", () => {
    clearLiveSession(win)
    void trackDatabaseTask(catchFinishedGame(win))
  })
  events.on("pick", (championId: number | null) => {
    broadcast(win, "pick", championId)
    void updateOverlay(championId)
  })
  events.on("champ-select", () => void refreshLiveSession(win, "ChampSelect"))
  events.on("game-start", (selections: unknown) => {
    broadcast(win, "game-start", selections)
    hideOverlay()
    void refreshLiveSession(win, "InProgress")
  })
  events.on("phase", (phase: string) => {
    if (phase === "ChampSelect") void refreshLiveSession(win, "ChampSelect")
    else if (phase === "InProgress") void refreshLiveSession(win, "InProgress")
    else if (liveSession.phase === "ChampSelect" && phase !== "GameStart") {
      // A dodge returns through Lobby/Matchmaking without ever producing a
      // game id. Do not let that draft's champions leak into the next game.
      assignedPositions.clear()
    }
  })
  events.start()

  const gameClient = new GameClient()
  session = {
    client,
    events,
    sync,
    challengeSync,
    summoner,
    regionalRoute,
    platformId,
    timer: setInterval(() => void runSync(win), PERIODIC_SYNC_INTERVAL_MS),
    liveTimer: setInterval(
      () => void refreshLiveGameData(win),
      LIVE_GAME_REFRESH_INTERVAL_MS,
    ),
    gameClient,
  }

  broadcast(win, "lcu:status", { connected: true, summoner })
  void initialiseLiveSession(win)
  await runSync(win)
}

function stopSession(win: BrowserWindow) {
  if (connectRetry) {
    clearTimeout(connectRetry)
    connectRetry = undefined
  }

  if (!session) return

  riotBackfillRevision += 1
  riotBackfillAbort?.abort()
  riotBackfillAbort = undefined
  clearInterval(session.timer)
  clearInterval(session.liveTimer)
  session.events.stop()
  session.client.close()
  session.gameClient.close()
  session = undefined
  hideOverlay()
  clearLiveSession(win)

  broadcast(win, "lcu:status", { connected: false, summoner: null })
}

function clearLiveSession(win: BrowserWindow) {
  liveRevision += 1
  assignedPositions.clear()
  liveSession = { phase: "Idle", benchChampionIds: [], allies: [], enemies: [], updatedAt: Date.now() }
  broadcast(win, "live:updated", liveSession)
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
  if (!session || !gameId || assignedPositions.size === 0) return
  getChampSelect().record(gameId, session.summoner.puuid, [...assignedPositions.values()])
  assignedPositions.clear()
}

/** Reads a new, self-contained live snapshot without letting stale requests win. */
async function refreshLiveSession(win: BrowserWindow, phase: LivePhase) {
  if (!session) return
  const revision = ++liveRevision
  try {
    const next = await readLiveSession(
      session.client,
      phase,
      session.summoner.puuid,
    )
    if (revision !== liveRevision) return
    if (phase === "ChampSelect") {
      rememberAssignedPositions(next)
      storeAssignedPositions(next.gameId)
    }
    liveSession = next
    broadcast(win, "live:updated", liveSession)
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
  if (!session || liveSession.phase !== "InProgress" || liveGameReading) return
  liveGameReading = true
  const expectedGameId = liveSession.gameId

  try {
    const game = await readLiveGameSnapshot(session.gameClient)
    if (
      !session ||
      liveSession.phase !== "InProgress" ||
      liveSession.gameId !== expectedGameId
    ) return
    if (expectedGameId !== undefined) {
      getLiveGameCaptures().record(
        expectedGameId,
        session.summoner.puuid,
        game,
      )
    }
    liveSession = {
      ...liveSession,
      game,
      updatedAt: game.updatedAt,
    }
    broadcast(win, "live:updated", liveSession)
  } catch {
    // Port 2999 is unavailable during the loading transition and immediately
    // after a game. Preserve the latest good snapshot and retry quietly.
  } finally {
    liveGameReading = false
  }
}

/** Covers the case where Recall connects after champion select has begun. */
async function initialiseLiveSession(win: BrowserWindow) {
  if (!session) return
  try {
    const phase = await session.client.request<string>("/lol-gameflow/v1/gameflow-phase")
    if (phase === "ChampSelect") await refreshLiveSession(win, "ChampSelect")
    if (phase === "InProgress") await refreshLiveSession(win, "InProgress")
  } catch {
    // The client moves through transitional phases quickly; the event stream
    // will provide the next stable state.
  }
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
  if (catchingGame || !session) return
  catchingGame = true

  try {
    await syncUntilRecorded(async () => {
      if (!session) return { inserted: 0 }

      const result = await session.sync.syncNow()
      if (result.inserted > 0) await afterSync(win, result)

      return result
    })
  } finally {
    catchingGame = false
  }
}

async function performFullSync(win: BrowserWindow) {
  if (!session) return

  const result = await session.sync.syncNow()
  await afterSync(win, result)
  return result
}

const refreshAll = createSingleFlightRefresh(performFullSync)

async function runSync(win: BrowserWindow) {
  return trackDatabaseTask(refreshAll(win))
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
  const revision = ++riotBackfillRevision
  riotBackfillAbort?.abort()
  const previous = riotBackfillTask
  if (previous) await previous.catch(() => undefined)
  if (revision !== riotBackfillRevision) return

  const active = session
  const apiKey = readRiotApiKey()
  if (!active || !active.regionalRoute || !apiKey) return

  const queues = await fetchQueues(active.client)
  if (revision !== riotBackfillRevision || session !== active) return

  const controller = new AbortController()
  riotBackfillAbort = controller
  let announcedImported: number | undefined
  let attachedImported: number | undefined

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
      riotId: {
        gameName: active.summoner.gameName,
        tagLine: active.summoner.tagLine,
      },
      onAccountResolved: (matchPuuid) => {
        saveRiotAccount(
          active.summoner,
          matchPuuid,
          active.regionalRoute!,
          active.platformId ?? "",
        )
      },
      onProgress: (state) => {
        if (revision !== riotBackfillRevision) return
        broadcast(win, "riot-history:updated", state)
        if (attachedImported === undefined) {
          attachedImported = state.matchesImported
        } else if (state.matchesImported > attachedImported) {
          const added = state.matchesImported - attachedImported
          attachedImported = state.matchesImported
          for (const match of getRepository().getRecentMatches(
            { puuid: active.summoner.puuid },
            added,
          )) getReviewRepository().attachMatchingExperiments(match)
        }
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

  const task = trackDatabaseTask(
    backfill
      .run(restart, controller.signal)
      .then(() => undefined)
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.warn(`Riot history import stopped: ${(error as Error).message}`)
        }
      }),
  )
  riotBackfillTask = task

  try {
    await task
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
  result: { inserted: number },
) {
  if (!session) return

  if (result.inserted > 0) {
    broadcast(win, "stats:updated", result)

    // Every newly inserted game is checked against active experiment scopes;
    // the newest one drives the post-game banner.
    const recent = getRepository().getRecentMatches(
      { puuid: session.summoner.puuid },
      result.inserted,
    )
    const [latest] = recent
    for (const match of recent) getReviewRepository().attachMatchingExperiments(match)
    if (latest) {
      broadcast(win, "match:recorded", latest)
      broadcast(win, "review:updated", latest.gameId)
    }
    createDailyBackupIfNeeded(win)
  }
  getDataTrustService().recordSync(session.summoner.puuid, "league_client", {
    success: true,
    seen: result.inserted,
    written: result.inserted,
  })
  getTimelineService(win).queueRecentMatches(session.summoner.puuid)

  // Challenges are synced after matches so a challenge failure can never cost
  // us a recorded game.
  const challengeResult = await session.challengeSync.syncNow()
  if (challengeResult.changed > 0) {
    broadcast(win, "challenges:updated", challengeResult)
  }

  await snapshotProfile(win)
  await snapshotRanked(win)
}

/**
 * Records where the player stands on the ladder.
 *
 * The client only ever reports the current standing, so a season's climb only
 * exists if it is written down as it happens.
 */
async function snapshotRanked(win: BrowserWindow) {
  if (!session) return

  try {
    const stats = await session.client.request<{
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

    const recordedAt = Date.now()
    let changed = false

    for (const [queue, entry] of Object.entries(stats.queueMap ?? {})) {
      // Unranked queues have nothing to plot.
      if (!entry.tier || entry.tier === "NONE") continue

      const stored = getRankedHistory().recordSnapshot({
        puuid: session.summoner.puuid,
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
async function snapshotProfile(win: BrowserWindow) {
  if (!session) return

  try {
    const summary = await session.client.request<{
      overallChallengeLevel: string
      totalChallengeScore: number
      positionPercentile?: number
      categoryProgress?: unknown[]
    }>("/lol-challenges/v1/summary-player-data/local-player")

    const changed = getProfiles().recordSnapshot({
      puuid: session.summoner.puuid,
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
    stopSession(win)
    void startSession(win, credentials)
  })

  discovery.on("disconnect", () => stopSession(win))

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
    store.set("last-puuid", session.summoner.puuid)
    return session.summoner.puuid
  }
  return store.get("last-puuid") as string | undefined
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
  const stored = store.get("pinned-challenges")
  return Array.isArray(stored) ? (stored as number[]) : []
}

function getOverlay(): Overlay {
  if (!overlay) {
    overlay = new Overlay(
      preload,
      indexHtml,
      VITE_DEV_SERVER_URL,
      () => store.get("overlay-position") as OverlayPosition | undefined,
      (position) => store.set("overlay-position", position),
    )
  }
  return overlay
}

function hideOverlay() {
  overlayRevision += 1
  getOverlay().hide()
}

function storedChampionCatalog(): ChampionCatalogEntry[] {
  return mergeChampionCatalog(store.get(CHAMPION_CATALOG_STORE))
}

function rememberChampionCatalog(fetched: unknown): ChampionCatalogEntry[] {
  const merged = mergeChampionCatalog(storedChampionCatalog(), fetched)
  store.set(CHAMPION_CATALOG_STORE, merged)
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

/** Champion names for overlays and recommendations, online or offline. */
async function championNameFor(championId: number): Promise<string | undefined> {
  const known = championNames?.get(championId)
  if (known) return known

  const catalog = await loadChampionCatalog()
  return catalog.find((champion) => champion.id === championId)?.name
}

/**
 * Puts the overlay over the client, or takes it away.
 *
 * It appears only while a champion is held and a pinned challenge has an
 * opinion about it, so it never covers the client without cause.
 */
async function updateOverlay(championId: number | null) {
  const revision = ++overlayRevision
  const puuid = currentPuuid()
  if (!puuid) {
    if (revision === overlayRevision) getOverlay().hide()
    return
  }

  const pinnedIds = readPinned()
  if (pinnedIds.length === 0) {
    if (revision === overlayRevision) getOverlay().hide()
    return
  }

  const repo = getChallenges()
  const pinned = pinnedIds
    .map((id) => repo.getById(id, puuid))
    .filter((challenge): challenge is ChallengeRow => challenge !== undefined)

  const content = overlayContentFor(pinned, championId)

  if (!content) {
    if (revision === overlayRevision) getOverlay().hide()
    return
  }

  const championName = await championNameFor(content.championId)
  if (revision !== overlayRevision) return

  getOverlay().show({
    ...content,
    championName,
  })
}

function registerIpc(win: BrowserWindow, updaterService: UpdaterService) {
  ipcMain.on("app-ready", () => connectToLcu(win))

  ipcMain.on("window:minimize", () => win.minimize())
  ipcMain.on("window:toggle-maximize", () => {
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on("window:close", () => win.close())
  ipcMain.handle("window:is-maximized", () => win.isMaximized())

  registerUpdaterIpc(ipcMain, updaterService)

  ipcMain.on("store-set", (_event, key: string, value: unknown) => {
    store.set(key, value)
  })

  ipcMain.handle("store-get", (_event, key: string) => store.get(key))

  ipcMain.handle("champions:catalog", () => loadChampionCatalog())

  ipcMain.handle("data-trust:get", () =>
    getDataTrustService().report(
      currentPuuid(),
      typeof store.get(RIOT_API_KEY_STORE) === "string",
      safeStorage.isEncryptionAvailable(),
    ),
  )

  ipcMain.handle("data-trust:check", () => {
    const service = getDataTrustService()
    service.check()
    const report = service.report(
      currentPuuid(),
      typeof store.get(RIOT_API_KEY_STORE) === "string",
      safeStorage.isEncryptionAvailable(),
    )
    broadcast(win, "data-trust:updated", report)
    return report
  })

  ipcMain.handle("backups:list", () => getBackupManager().list())
  ipcMain.handle("backups:create", () => {
    const backup = getBackupManager().create(getDatabase(), "manual")
    broadcast(win, "data-trust:updated")
    return backup
  })
  ipcMain.handle("backups:delete", (_event, fileName: unknown) => {
    const deleted = getBackupManager().delete(
      limitedString(fileName, "Backup name", 180),
    )
    broadcast(win, "data-trust:updated")
    return deleted
  })
  ipcMain.handle("backups:restore", (_event, fileName: unknown) => {
    getBackupManager().prepareRestore(
      getDatabase(),
      limitedString(fileName, "Backup name", 180),
    )
    setImmediate(() => {
      quitting = true
      app.relaunch()
      app.quit()
    })
    return true
  })

  ipcMain.handle("review:overview", () =>
    getReviewService(win).overview(withPuuid().puuid),
  )
  ipcMain.handle("augments:owner-summary", (_event, rawAugmentId: unknown) =>
    getParticipants().getOwnerAugmentSummaries(
      withPuuid().puuid,
      rawAugmentId === undefined || rawAugmentId === null
        ? undefined
        : integer(rawAugmentId, "Augment id"),
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
  ipcMain.handle("review:match", (_event, rawGameId: unknown) =>
    getReviewService(win).match(
      integer(rawGameId, "Game id"),
      withPuuid().puuid,
    ),
  )
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
        "sr_swiftplay", "aram", "mayhem", "other",
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
            })),
          }
        }),
      )
      store.set("recommendation-objective", objective)
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
    (_event, rawGameId: unknown, manualRetry: unknown) =>
      getTimelineService(win).request(
        integer(rawGameId, "Game id"),
        withPuuid().puuid,
        manualRetry === true,
      ),
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
      if (saved.bookmarked) void getTimelineService(win).request(gameId, puuid)
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

  ipcMain.handle("experiments:list", () =>
    getReviewRepository().listExperiments(withPuuid().puuid),
  )
  const experimentInput = (raw: unknown): ExperimentInput => {
    const input = raw as Record<string, unknown>
    if (!Array.isArray(input?.championIds) || !Array.isArray(input?.modes)) {
      throw new Error("Experiment scope is invalid")
    }
    const name = limitedString(input.name, "Experiment name", 80)
    if (!name) throw new Error("Experiment name is required")
    return {
      name,
      hypothesis: boundedText(input.hypothesis ?? "", "Hypothesis", 500),
      championIds: input.championIds.map((id) => integer(id, "Champion id")),
      modes: input.modes.map((mode) => oneOf(mode, [
        "sr_ranked_solo", "sr_ranked_flex", "sr_normal", "sr_quickplay",
        "sr_swiftplay", "aram", "mayhem", "other",
      ] as const, "Mode")) as TrackedMode[],
      status: input.status === undefined
        ? undefined
        : oneOf(input.status, ["active", "paused", "completed"] as const, "Status"),
    }
  }
  ipcMain.handle("experiments:create", (_event, rawInput: unknown) => {
    const input = experimentInput(rawInput)
    const created = getReviewRepository().createExperiment(withPuuid().puuid, input)
    broadcast(win, "review:updated")
    return created
  })
  ipcMain.handle(
    "experiments:update",
    (_event, rawId: unknown, rawInput: unknown) => {
      const updated = getReviewRepository().updateExperiment(
        integer(rawId, "Experiment id"),
        withPuuid().puuid,
        experimentInput(rawInput),
      )
      broadcast(win, "review:updated")
      return updated
    },
  )
  ipcMain.handle(
    "experiments:set-match-outcome",
    (
      _event,
      rawGameId: unknown,
      rawExperimentId: unknown,
      rawOutcome: unknown,
      rawNote: unknown,
    ) => {
      const updated = getReviewRepository().setExperimentOutcome(
        integer(rawGameId, "Game id"),
        withPuuid().puuid,
        integer(rawExperimentId, "Experiment id"),
        oneOf(rawOutcome, [
          "worked", "mixed", "did_not_work", "unrated",
        ] as const, "Outcome") as ExperimentOutcome,
        boundedText(rawNote ?? "", "Outcome note", 1_000),
      )
      broadcast(win, "review:updated", rawGameId)
      return updated
    },
  )

  // A Riot key must never travel back to the renderer. Electron delegates
  // encryption to the operating system (DPAPI on Windows, Keychain on macOS)
  // and only the main process can retrieve it for future API requests.
  ipcMain.handle("riot-api-key:status", () => {
    const puuid = currentPuuid()
    return {
      configured: typeof store.get(RIOT_API_KEY_STORE) === "string",
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
    store.set(RIOT_API_KEY_STORE, encrypted)
    void startRiotHistoryBackfill(win, true)
    return { configured: true }
  })

  ipcMain.handle("riot-api-key:clear", () => {
    riotBackfillRevision += 1
    riotBackfillAbort?.abort()
    riotBackfillAbort = undefined
    store.delete(RIOT_API_KEY_STORE)
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

  ipcMain.handle("lcu:request", (_event, requestPath: string) =>
    requireSession().client.request(requestPath),
  )

  ipcMain.handle("stats:summary", (_event, filter: Partial<MatchQuery>) =>
    getRepository().getSummary(withPuuid(filter)),
  )

  ipcMain.handle("stats:champions", (_event, filter: Partial<StatsFilter>) =>
    getRepository().getChampionStats(withPuuid(filter)),
  )

  ipcMain.handle("stats:grades", (_event, filter: Partial<MatchQuery>) =>
    getRepository().getGradeDistribution(withPuuid(filter)),
  )

  ipcMain.handle(
    "stats:matches",
    (_event, filter: Partial<StatsFilter>, limit: number) =>
      getRepository().getRecentMatches(withPuuid(filter), limit),
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
    (_event, query: Record<string, unknown>, page: number, pageSize: number) =>
      getRepository().listMatches(
        { ...query, puuid: withPuuid().puuid },
        page,
        pageSize,
      ),
  )

  ipcMain.handle("matches:champions", () =>
    getRepository().getPlayedChampionIds(withPuuid().puuid),
  )

  ipcMain.handle(
    "stats:lobby",
    (_event, filter: Partial<StatsFilter>) =>
      getParticipants().getLobbyComparison(withPuuid(filter)),
  )

  ipcMain.handle("matches:detail", (_event, gameId: number) => {
    const puuid = withPuuid().puuid
    return {
      ...getParticipants().getMatchDetail(gameId, puuid),
      labels: getRepository().getPerformanceLabels(gameId, puuid),
    }
  })

  ipcMain.handle(
    "stats:drift",
    (_event, query: Partial<MatchQuery>, family: ModeFamily) => {
      const scoped = withPuuid(query)
      const repo = getRepository()

      const size = 10
      const maxWindows = 6
      const total = repo.getSummary(scoped).games

      const windows: { label: string; axes: unknown[] }[] = []

      for (let index = 0; index < maxWindows; index += 1) {
        const offset = index * size
        if (offset >= total) break

        const profile = buildStyleProfile(
          repo.getStyleAverages(scoped, { limit: size, offset }),
          family,
        )
        if (!profile) break

        windows.push({
          label: `${offset + 1}\u2013${offset + size} ago`,
          axes: profile.axes,
        })
      }

      // Read left to right as oldest to newest, the way a trend is read.
      return windows.reverse()
    },
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

    // Champions are judged against how the player performs generally, so a
    // thin sample lands near their own average rather than at an extreme.
    const baseline = repo.getSummary(scoped).avgGradeScore ?? 0
    const ranked = rankChampions(repo.getChampionStats(scoped), baseline)

    return { ranked, ...pickBestAndWorst(ranked, 3) }
  })

  ipcMain.handle(
    "stats:rvi",
    (_event, filter: Partial<StatsFilter>, family: ModeFamily) => {
      const scoped = withPuuid(filter)
      const insightsRepo = getInsights()
      return buildPerformanceProfile({
        family,
        observations: insightsRepo.getObservations(scoped),
        gradeComponentHistory: insightsRepo.getGradeComponentHistory(scoped, 240),
        timelineHistory: insightsRepo.getRviTimelineHistory(scoped, 240),
      })
    },
  )

  ipcMain.handle(
    "stats:skill-report",
    (_event, filter: Partial<StatsFilter>, family: ModeFamily) => {
      const scoped = withPuuid(filter)
      const repo = getRepository()
      const insightsRepo = getInsights()
      const timeOfDay = insightsRepo.getTimeOfDay(scoped)
      const careerStyle = buildStyleProfile(repo.getStyleAverages(scoped), family)
      const recentStyle = buildStyleProfile(
        repo.getStyleAverages(scoped, { limit: 10 }),
        family,
      )
      const earlierStyle = buildStyleProfile(
        repo.getStyleAverages(scoped, { offset: 10 }),
        family,
      )

      return buildSkillReport({
        modes: filter.modes ?? (filter.mode ? [filter.mode] : []),
        family,
        generatedAt: Date.now(),
        summary: repo.getSummary(scoped),
        style: careerStyle
          ? { career: careerStyle, recent: recentStyle, earlier: earlierStyle }
          : undefined,
        grades: repo.getGradeDistribution(scoped),
        lobby: getParticipants().getLobbyComparison(scoped),
        contribution: insightsRepo.getTeamContribution(scoped),
        duration: insightsRepo.getDurationBuckets(scoped, family),
        hours: timeOfDay.hours,
        weekdays: timeOfDay.weekdays,
        pool: insightsRepo.getChampionPool(scoped),
        builds: insightsRepo.getBuildPatterns(scoped, 8),
        observations: insightsRepo.getObservations(scoped),
        championStats: repo.getChampionStats(scoped),
        itemObservations: insightsRepo.getFinalItemObservations(scoped),
        gradeComponentHistory: insightsRepo.getGradeComponentHistory(scoped),
        performanceComponentHistory: insightsRepo.getGradeComponentHistory(scoped, 240),
        performanceTimelineHistory: insightsRepo.getRviTimelineHistory(scoped, 240),
      })
    },
  )

  ipcMain.handle(
    "matches:axes",
    (_event, gameId: number, family: ModeFamily) => {
      const puuid = withPuuid().puuid
      const detail = getParticipants().getMatchDetail(gameId, puuid)
      const mine = detail.participants.find((row) => row.isPlayer === 1)

      if (!mine) return { axes: [] }

      return {
        axes: matchAxes(
          mine,
          getRepository().getMatchDuration(gameId, puuid),
          family,
        ),
      }
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
    "stats:style",
    (_event, query: Partial<MatchQuery>, family: ModeFamily) => {
      const repo = getRepository()
      const scoped = withPuuid(query)

      // The most recent games, against everything that came before them.
      const recentGames = 10

      return {
        career: buildStyleProfile(repo.getStyleAverages(scoped), family),
        recent: buildStyleProfile(
          repo.getStyleAverages(scoped, { limit: recentGames }),
          family,
        ),
        earlier: buildStyleProfile(
          repo.getStyleAverages(scoped, { offset: recentGames }),
          family,
        ),
      }
    },
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
      store.set("pinned-challenges", [...pinned, challengeId])
    }
    return readPinned()
  })

  ipcMain.handle("challenges:unpin", (_event, challengeId: number) => {
    store.set(
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

  ipcMain.handle("stats:sync", async () => {
    if (!session) return { fetched: 0, inserted: 0 }

    const result = await session.sync.syncNow()
    broadcast(win, "stats:updated", result)
    return result
  })

  ipcMain.handle("stats:export", async () => {
    const puuid = withPuuid().puuid

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Export ARAM history",
      defaultPath: `aram-history-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    })

    if (canceled || !filePath) return { exported: 0 }

    const matches = getRepository().getAllMatches(puuid)
    writeFileSync(filePath, JSON.stringify(matches, null, 2), "utf8")

    return { exported: matches.length, filePath }
  })

  ipcMain.handle("stats:clear", async () => {
    const puuid = withPuuid().puuid

    const { response } = await dialog.showMessageBox(win, {
      type: "warning",
      buttons: ["Cancel", "Delete all history"],
      defaultId: 0,
      cancelId: 0,
      title: "Delete recorded history",
      message: "Delete all recorded match history?",
      detail:
        "This removes local matches, scoreboards, live captures, and Riot import progress. " +
        "Saving an API key again can re-import matches Riot still exposes.",
    })

    if (response !== 1) return { deleted: 0 }

    riotBackfillRevision += 1
    riotBackfillAbort?.abort()
    riotBackfillAbort = undefined
    const activeBackfill = riotBackfillTask
    if (activeBackfill) await activeBackfill.catch(() => undefined)
    riotBackfillTask = undefined
    getLiveGameCaptures().deleteAll(puuid)
    getChampSelect().deleteAll(puuid)
    getParticipants().deleteAll(puuid)
    getRiotBackfills().deleteAll(puuid)
    const deleted = getRepository().deleteAll(puuid)
    broadcast(win, "stats:updated", { fetched: 0, inserted: 0 })

    return { deleted }
  })
}

function createDailyBackupIfNeeded(win: BrowserWindow) {
  const today = new Date().toISOString().slice(0, 10)
  if (store.get("last-daily-backup") === today) return
  getBackupManager().create(getDatabase(), "daily")
  store.set("last-daily-backup", today)
  broadcast(win, "data-trust:updated")
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
  hideOverlay()
  riotBackfillRevision += 1
  riotBackfillAbort?.abort()
  riotBackfillAbort = undefined
  stopLcuDiscovery()
  stopSession(win)

  // Aborted API requests still need one turn to record their durable paused
  // cursor. Local match/challenge syncs are also allowed to finish before the
  // database is checkpointed or closed.
  await Promise.allSettled([...databaseTasks])
  riotBackfillTask = undefined

  try {
    if (database?.open && createSnapshot) {
      getBackupManager().create(database, "pre-update")
      createUpdateSnapshot(
        database,
        getDatabasePath(),
        getDatabaseBackupDir(),
      )
    }
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

  // Open and validate persistent data before showing the renderer. If startup
  // cannot continue, a half-initialised window would only emit a wall of "No
  // handler registered" errors because IPC registration happens afterwards.
  try {
    getRepository()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Could not initialise Recall's database: ${message}`)
    dialog.showErrorBox(
      "Recall could not open your history",
      `${message}\n\nYour database was left untouched at:\n${getDatabasePath()}`,
    )
    app.quit()
    return
  }

  const win = await createWindow()
  createTray(win)

  const updater = createUpdaterService({
    updater: autoUpdater,
    isPackaged: app.isPackaged,
    publish: (status) => broadcast(win, "app:update-status", status),
    beforeInstall: () => prepareShutdown(win, true),
  })

  registerIpc(win, updater)
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

  // The window only hides, so this fires solely on a real quit. Recall must
  // not exit merely because its window went away.
  app.on("window-all-closed", () => {
    if (quitting) app.quit()
  })
}

app.commandLine.appendSwitch("ignore-certificate-errors")

void main()
