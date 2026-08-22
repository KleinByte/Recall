import type { LcuClient } from "./lcu-client.js"
import type { LiveGameSnapshot } from "./game-client.js"
import type { TrackedMode } from "./matches/types.js"
import { LEAGUE_CLASSIC_QUEUE_IDS } from "./matches/eligibility.js"

export type LivePhase = "Idle" | "ChampSelect" | "InProgress"

export interface LivePlayer {
  cellId: number
  championId: number
  championPickIntent: number
  summonerId?: number
  displayName?: string
  puuid?: string
  /** The client's own champion select assignment: TOP, JUNGLE, MIDDLE, BOTTOM or UTILITY. */
  assignedPosition?: string
}

export interface LiveSession {
  phase: LivePhase
  gameId?: number
  queueId?: number
  queueName?: string
  mode?: TrackedMode
  gameMode?: string
  gameType?: string
  mapId?: number
  secondsRemaining?: number
  localPlayerCellId?: number
  rerollsRemaining?: number
  benchChampionIds: number[]
  allies: LivePlayer[]
  enemies: LivePlayer[]
  game?: LiveGameSnapshot
  updatedAt: number
}

export interface ReadLiveSessionOptions {
  /** Identity enrichment is never required to start live capture. */
  resolvePlayerNames?: boolean
  requestTimeoutMs?: number
}

/**
 * Riot can emit InProgress before `/lol-gameflow/v1/session` has finished
 * populating its durable game identity and classification fields. Port 2999
 * repairs map/mode data later, but it does not expose the game id, so callers
 * must keep refreshing the LCU snapshot until these fields become usable.
 */
export function needsInProgressMetadataRefresh(session: LiveSession) {
  if (session.phase !== "InProgress") return false
  const mapKnown = session.mapId !== undefined || session.game?.mapNumber !== undefined
  const classificationKnown = session.queueId !== undefined ||
    Boolean(session.gameType?.trim()) || Boolean(session.game?.gameType?.trim())
  return session.gameId === undefined || !mapKnown || !classificationKnown
}

/**
 * Repairs eventual LCU metadata without discarding a newer Port 2999 snapshot.
 * Roster/queue fields come from the refreshed LCU document; rendered live-game
 * telemetry remains owned by the previous aggregate snapshot.
 */
export function mergeInProgressSessionMetadata(
  previous: LiveSession,
  refreshed: LiveSession,
): LiveSession {
  return {
    ...previous,
    ...refreshed,
    gameId: refreshed.gameId ?? previous.gameId,
    queueId: refreshed.queueId ?? previous.queueId,
    queueName: refreshed.queueName ?? previous.queueName,
    mode: refreshed.mode ?? previous.mode,
    gameMode: refreshed.gameMode ?? previous.gameMode ?? previous.game?.gameMode,
    gameType: refreshed.gameType ?? previous.gameType ?? previous.game?.gameType,
    mapId: refreshed.mapId ?? previous.mapId ?? previous.game?.mapNumber,
    localPlayerCellId: refreshed.localPlayerCellId ?? previous.localPlayerCellId,
    allies: refreshed.allies.length > 0 ? refreshed.allies : previous.allies,
    enemies: refreshed.enemies.length > 0 ? refreshed.enemies : previous.enemies,
    game: previous.game,
    updatedAt: Math.max(previous.updatedAt, refreshed.updatedAt),
  }
}

const idle = (): LiveSession => ({
  phase: "Idle",
  benchChampionIds: [],
  allies: [],
  enemies: [],
  updatedAt: Date.now(),
})

const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined

function modeFor(queueId?: number, gameMode?: string, mapId?: number): TrackedMode | undefined {
  if ((queueId !== undefined && LEAGUE_CLASSIC_QUEUE_IDS.some((id) => id === queueId)) || gameMode === "JADE") {
    return "league_classic"
  }
  if (mapId === 12) return gameMode?.startsWith("KIWI") ? "mayhem" : "aram"
  if (mapId !== 11) return undefined
  if (queueId === 420) return "sr_ranked_solo"
  if (queueId === 440) return "sr_ranked_flex"
  if (queueId === 480) return "sr_swiftplay"
  if (queueId === 490) return "sr_quickplay"
  return "sr_normal"
}

function player(entry: Record<string, unknown>): LivePlayer {
  const gameName = text(entry.gameName)
  const tagLine = text(entry.tagLine)
  return {
    cellId: number(entry.cellId) ?? -1,
    championId: number(entry.championId) ?? 0,
    championPickIntent: number(entry.championPickIntent) ?? 0,
    summonerId: number(entry.summonerId),
    displayName:
      gameName && tagLine
        ? `${gameName}#${tagLine}`
        : gameName ??
          text(entry.riotId) ??
          text(entry.summonerName) ??
          text(entry.name),
    puuid: text(entry.puuid),
    assignedPosition: text(entry.assignedPosition)?.toUpperCase(),
  }
}

interface SummonerIdentity {
  displayName?: string
  gameName?: string
  tagLine?: string
}

function displayName(identity: SummonerIdentity) {
  const gameName = text(identity.gameName)
  const tagLine = text(identity.tagLine)
  if (gameName && tagLine) return `${gameName}#${tagLine}`
  return gameName ?? text(identity.displayName)
}

async function resolveNames(
  client: LcuClient,
  players: LivePlayer[],
  requestTimeoutMs?: number,
): Promise<LivePlayer[]> {
  const identities = new Map<number, Promise<string | undefined>>()

  return Promise.all(
    players.map(async (entry) => {
      if (entry.displayName || !entry.summonerId) return entry

      let pending = identities.get(entry.summonerId)
      if (!pending) {
        pending = client
          .request<SummonerIdentity>(
            `/lol-summoner/v1/summoners/${entry.summonerId}`,
            { timeoutMs: requestTimeoutMs },
          )
          .then(displayName)
          .catch(() => undefined)
        identities.set(entry.summonerId, pending)
      }

      return { ...entry, displayName: await pending }
    }),
  )
}

/** Adds optional display names after the critical game identity has published. */
export async function enrichLiveSessionNames(
  client: LcuClient,
  session: LiveSession,
  requestTimeoutMs = 1_500,
): Promise<LiveSession> {
  if (session.queueId === 420 || session.queueId === 440) return session
  const [allies, enemies] = await Promise.all([
    resolveNames(client, session.allies, requestTimeoutMs),
    session.phase === "InProgress"
      ? resolveNames(client, session.enemies, requestTimeoutMs)
      : Promise.resolve(session.enemies),
  ])
  return { ...session, allies, enemies }
}

function roster(
  entries: unknown,
  cellOffset: number,
): LivePlayer[] {
  if (!Array.isArray(entries)) return []

  return entries.map((entry: Record<string, unknown>, index) => ({
    ...player(entry),
    cellId: cellOffset + index,
  }))
}

/**
 * Reads only state already shown by the local client. The deliberately loose
 * shape lets Recall degrade safely when Riot adds or removes LCU fields.
 */
export async function readLiveSession(
  client: LcuClient,
  phase: LivePhase,
  localPuuid?: string,
  options: ReadLiveSessionOptions = {},
): Promise<LiveSession> {
  if (phase === "Idle") return idle()

  const requestOptions = { timeoutMs: options.requestTimeoutMs }
  const flow = await client.request<Record<string, any>>(
    "/lol-gameflow/v1/session",
    requestOptions,
  )
  const data = (flow.gameData ?? {}) as Record<string, any>
  const queue = (data.queue ?? {}) as Record<string, any>
  const queueId = number(queue.id) ?? number(data.queueId)
  const gameType = text(queue.type) ?? text(data.gameType)
  const gameMode =
    text(data.gameMode) ?? text(queue.gameMode) ?? gameType
  const mapId = number(data.mapId) ?? number(queue.mapId)
  const result: LiveSession = {
    phase,
    gameId: number(data.gameId),
    queueId,
    queueName: typeof queue.name === "string" ? queue.name : undefined,
    mode: modeFor(queueId, gameMode, mapId),
    gameMode,
    gameType,
    mapId,
    benchChampionIds: [],
    allies: [],
    enemies: [],
    updatedAt: Date.now(),
  }

  if (phase === "ChampSelect") {
    const select = await client.request<Record<string, any>>(
      "/lol-champ-select/v1/session",
      requestOptions,
    )
    // Current champ-select sessions expose their own gameId. Prefer the
    // gameflow value when present, but do not wait for InProgress to persist
    // assignments when champ select already identifies the match.
    result.gameId ??= number(select.gameId)
    result.localPlayerCellId = number(select.localPlayerCellId)
    result.rerollsRemaining = number(select.rerollsRemaining)
    result.secondsRemaining = Math.max(0, Math.ceil((number(select.timer?.adjustedTimeLeftInPhase) ?? 0) / 1000))
    result.benchChampionIds = Array.isArray(select.benchChampions)
      ? select.benchChampions.filter((id: unknown): id is number => typeof id === "number")
      : []
    result.allies = Array.isArray(select.myTeam)
      ? select.myTeam.map((entry: Record<string, unknown>) => player(entry))
      : []
    result.enemies = Array.isArray(select.theirTeam)
      ? select.theirTeam.map((entry: Record<string, unknown>) => player(entry))
      : []

    // Ranked champion select intentionally hides teammate identities. In
    // queues where the client shows them, resolve missing Riot IDs through the
    // local summoner endpoint instead of spending Web API requests.
    if (options.resolvePlayerNames !== false && queueId !== 420 && queueId !== 440) {
      result.allies = await resolveNames(
        client,
        result.allies,
        options.requestTimeoutMs,
      )
    }
  } else {
    const teamOne = roster(data.teamOne, 0)
    const teamTwo = roster(data.teamTwo, 100)
    const localIsTeamTwo = teamTwo.some((entry) => entry.puuid === localPuuid)

    if (localIsTeamTwo) {
      result.allies = teamTwo
      result.enemies = teamOne
    } else {
      // The client normally supplies the local PUUID. Team one is a stable
      // fallback for older payloads where it is absent.
      result.allies = teamOne
      result.enemies = teamTwo
    }

    const local = result.allies.find((entry) => entry.puuid === localPuuid)
    if (local) result.localPlayerCellId = local.cellId

    if (options.resolvePlayerNames !== false) {
      result.allies = await resolveNames(
        client,
        result.allies,
        options.requestTimeoutMs,
      )
      result.enemies = await resolveNames(
        client,
        result.enemies,
        options.requestTimeoutMs,
      )
    }

    // Some older gameflow payloads omit team rosters but retain selections.
    if (result.allies.length === 0 && result.enemies.length === 0) {
      const selections = roster(data.playerChampionSelections, 0)
      result.allies = options.resolvePlayerNames === false
        ? selections
        : await resolveNames(client, selections, options.requestTimeoutMs)
      const selectedLocal = result.allies.find(
        (entry) => entry.puuid === localPuuid,
      )
      if (selectedLocal) result.localPlayerCellId = selectedLocal.cellId
    }
  }

  return result
}
