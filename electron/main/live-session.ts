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

const idle = (): LiveSession => ({
  phase: "Idle",
  benchChampionIds: [],
  allies: [],
  enemies: [],
  updatedAt: Date.now(),
})

const number = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined

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
          )
          .then(displayName)
          .catch(() => undefined)
        identities.set(entry.summonerId, pending)
      }

      return { ...entry, displayName: await pending }
    }),
  )
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
): Promise<LiveSession> {
  if (phase === "Idle") return idle()

  const flow = await client.request<Record<string, any>>("/lol-gameflow/v1/session")
  const data = (flow.gameData ?? {}) as Record<string, any>
  const queue = (data.queue ?? {}) as Record<string, any>
  const queueId = number(queue.id) ?? number(data.queueId)
  const gameMode =
    text(data.gameMode) ?? text(queue.gameMode) ?? text(queue.type)
  const mapId = number(data.mapId) ?? number(queue.mapId)
  const result: LiveSession = {
    phase,
    gameId: number(data.gameId),
    queueId,
    queueName: typeof queue.name === "string" ? queue.name : undefined,
    mode: modeFor(queueId, gameMode, mapId),
    gameMode,
    mapId,
    benchChampionIds: [],
    allies: [],
    enemies: [],
    updatedAt: Date.now(),
  }

  if (phase === "ChampSelect") {
    const select = await client.request<Record<string, any>>("/lol-champ-select/v1/session")
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
    if (queueId !== 420 && queueId !== 440) {
      result.allies = await resolveNames(client, result.allies)
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

    result.allies = await resolveNames(client, result.allies)
    result.enemies = await resolveNames(client, result.enemies)

    // Some older gameflow payloads omit team rosters but retain selections.
    if (result.allies.length === 0 && result.enemies.length === 0) {
      const selections = roster(data.playerChampionSelections, 0)
      result.allies = await resolveNames(client, selections)
      const selectedLocal = result.allies.find(
        (entry) => entry.puuid === localPuuid,
      )
      if (selectedLocal) result.localPlayerCellId = selectedLocal.cellId
    }
  }

  return result
}
