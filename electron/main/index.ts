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
import { championsNeededFor } from "./challenges/champion-needs.js"
import { championStatusFor, overlayContentFor } from "./challenges/pinned.js"
import { Overlay, type OverlayPosition } from "./overlay.js"
import { LcuClient } from "./lcu-client.js"
import { LcuDiscovery, type LcuCredentials } from "./lcu-discovery.js"
import { LcuEvents as LcuEventStream } from "./lcu-events.js"
import { MatchSync } from "./match-sync.js"
import { syncUntilRecorded } from "./post-game-sync.js"
import { buildStyleProfile } from "./matches/style.js"
import type { ModeFamily } from "./matches/types.js"
import { migrateLegacyUserData } from "./migrate-user-data.js"
import { createSingleFlightRefresh } from "./full-refresh.js"
import { readLiveSession, type LivePhase, type LiveSession } from "./live-session.js"
import { fetchQueues } from "./matches/queues.js"
import { RiotHistoryBackfill } from "./riot/history-backfill.js"
import { regionalRouteFor } from "./riot/routing.js"

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
if (process.platform === "win32") app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const preload = path.join(__dirname, "../preload/index.mjs")
const indexHtml = path.join(RENDERER_DIST, "index.html")

let store: Store
const RIOT_API_KEY_STORE = "riot-api-key-encrypted"

function getDatabasePath() {
  return path.join(app.getPath("userData"), "stats.db")
}

function getDatabaseBackupDir() {
  return path.join(app.getPath("appData"), "Recall Database Backups")
}

/** How long the client needs after a game before its history is readable. */
const PERIODIC_SYNC_INTERVAL_MS = 5 * 60_000
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
  timer: NodeJS.Timeout
}

let session: Session | undefined
let connectRetry: NodeJS.Timeout | undefined
let tray: Tray | undefined
let overlay: Overlay | undefined
let overlayRevision = 0
let liveRevision = 0
let liveSession: LiveSession = {
  phase: "Idle",
  benchChampionIds: [],
  allies: [],
  enemies: [],
  updatedAt: Date.now(),
}

/** Champion names, read from the client once per session for the overlay. */
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
let rankedHistory: RankedRepository | undefined
let goals: GoalsRepository | undefined
let insights: InsightsRepository | undefined
let riotBackfills: RiotBackfillRepository | undefined
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
    database = openDatabase(getDatabasePath())
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

async function createWindow() {
  const win = new BrowserWindow({
    title: "Recall",
    icon: path.join(process.env.VITE_PUBLIC, "favicon.ico"),
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

  // Closing and minimising both hide the window. Recall is only useful if it
  // is running when a game ends, so the default has to be to stay running.
  win.on("close", (event) => {
    if (quitting) return
    event.preventDefault()
    win.hide()
  })

  win.on("minimize", (event: Electron.Event) => {
    event.preventDefault()
    win.hide()
  })

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
    regionalRoute = platform ? regionalRouteFor(platform) : undefined
  } catch (error) {
    console.warn(`Could not determine Riot API route: ${(error as Error).message}`)
  }

  const sync = new MatchSync(
    client,
    getRepository(),
    summoner.puuid,
    getParticipants(),
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
    if (phase === "InProgress") void refreshLiveSession(win, "InProgress")
  })
  events.start()

  session = {
    client,
    events,
    sync,
    challengeSync,
    summoner,
    regionalRoute,
    timer: setInterval(() => void runSync(win), PERIODIC_SYNC_INTERVAL_MS),
  }

  broadcast(win, "lcu:status", { connected: true, summoner })
  void initialiseLiveSession(win)
  await runSync(win)
  void startRiotHistoryBackfill(win, false)
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
  session.events.stop()
  session.client.close()
  session = undefined
  championNames = undefined
  hideOverlay()
  clearLiveSession(win)

  broadcast(win, "lcu:status", { connected: false, summoner: null })
}

function clearLiveSession(win: BrowserWindow) {
  liveRevision += 1
  liveSession = { phase: "Idle", benchChampionIds: [], allies: [], enemies: [], updatedAt: Date.now() }
  broadcast(win, "live:updated", liveSession)
}

/** Reads a new, self-contained live snapshot without letting stale requests win. */
async function refreshLiveSession(win: BrowserWindow, phase: LivePhase) {
  if (!session) return
  const revision = ++liveRevision
  try {
    const next = await readLiveSession(session.client, phase)
    if (revision !== liveRevision) return
    liveSession = next
    broadcast(win, "live:updated", liveSession)
  } catch (error) {
    console.warn(`Could not refresh live game: ${(error as Error).message}`)
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

  const backfill = new RiotHistoryBackfill(
    apiKey,
    active.regionalRoute,
    active.summoner.puuid,
    getRepository(),
    getParticipants(),
    queues,
    getRiotBackfills(),
    {
      onProgress: (state) => {
        if (revision !== riotBackfillRevision) return
        broadcast(win, "riot-history:updated", state)
        if (announcedImported === undefined) {
          announcedImported = state.matchesImported
          return
        }

        const imported = state.matchesImported - announcedImported
        if (
          imported > 0 &&
          (imported >= 10 || state.status !== "running")
        ) {
          announcedImported = state.matchesImported
          broadcast(win, "stats:updated", {
            inserted: imported,
            source: "riot-api",
          })
        }
      },
    },
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

    // The newest game is the one just played, and it now carries a grade.
    const [latest] = getRepository().getRecentMatches(
      { puuid: session.summoner.puuid },
      1,
    )
    if (latest) broadcast(win, "match:recorded", latest)
  }

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

    getProfiles().recordSnapshot({
      puuid: session.summoner.puuid,
      recordedAt: Date.now(),
      overallLevel: summary.overallChallengeLevel ?? "NONE",
      totalScore: summary.totalChallengeScore ?? 0,
      percentile: summary.positionPercentile ?? null,
      categoryJson: JSON.stringify(summary.categoryProgress ?? []),
    })

    // The dashboard may have rendered before this first snapshot existed, so
    // it is told to refresh even when the score has not moved.
    broadcast(win, "profile:updated")
  } catch (error) {
    console.warn(`Profile snapshot skipped: ${(error as Error).message}`)
  }
}

function connectToLcu(win: BrowserWindow) {
  const discovery = new LcuDiscovery()

  discovery.on("connect", (credentials: LcuCredentials) => {
    stopSession(win)
    void startSession(win, credentials)
  })

  discovery.on("disconnect", () => stopSession(win))

  discovery.start()
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

/** Champion names for the overlay, fetched once and reused. */
async function championNameFor(championId: number): Promise<string | undefined> {
  if (!session) return undefined

  if (!championNames) {
    try {
      const champions = await session.client.request<
        { id: number; name: string }[]
      >(
        `/lol-champions/v1/inventories/${session.summoner.summonerId}/champions-minimal`,
      )
      championNames = new Map(
        champions.map((champion) => [champion.id, champion.name]),
      )
    } catch {
      return undefined
    }
  }

  return championNames.get(championId)
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

  registerUpdaterIpc(ipcMain, updaterService)

  ipcMain.on("store-set", (_event, key: string, value: unknown) => {
    store.set(key, value)
  })

  ipcMain.handle("store-get", (_event, key: string) => store.get(key))

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
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("Enter an API key before saving")
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure local storage is unavailable on this computer")
    }
    const encrypted = safeStorage.encryptString(value.trim()).toString("base64")
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

  ipcMain.handle("matches:detail", (_event, gameId: number) =>
    getParticipants().getMatchDetail(gameId, withPuuid().puuid),
  )

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
        "This removes local matches, scoreboards, and Riot import progress. " +
        "Saving an API key again can re-import matches Riot still exposes.",
    })

    if (response !== 1) return { deleted: 0 }

    riotBackfillRevision += 1
    riotBackfillAbort?.abort()
    riotBackfillAbort = undefined
    const activeBackfill = riotBackfillTask
    if (activeBackfill) await activeBackfill.catch(() => undefined)
    riotBackfillTask = undefined
    getParticipants().deleteAll(puuid)
    getRiotBackfills().deleteAll(puuid)
    const deleted = getRepository().deleteAll(puuid)
    broadcast(win, "stats:updated", { fetched: 0, inserted: 0 })

    return { deleted }
  })
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
  stopSession(win)

  // Aborted API requests still need one turn to record their durable paused
  // cursor. Local match/challenge syncs are also allowed to finish before the
  // database is checkpointed or closed.
  await Promise.allSettled([...databaseTasks])
  riotBackfillTask = undefined

  try {
    if (database?.open && createSnapshot) {
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
