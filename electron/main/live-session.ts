import type { LcuClient } from "./lcu-client.js"
import type { TrackedMode } from "./matches/types.js"

export type LivePhase = "Idle" | "ChampSelect" | "InProgress"

export interface LivePlayer {
  cellId: number
  championId: number
  championPickIntent: number
  summonerId?: number
  displayName?: string
  puuid?: string
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

function modeFor(queueId?: number, gameMode?: string, mapId?: number): TrackedMode | undefined {
  if (mapId === 12) return gameMode?.startsWith("KIWI") ? "mayhem" : "aram"
  if (mapId !== 11) return undefined
  if (queueId === 420) return "sr_ranked_solo"
  if (queueId === 440) return "sr_ranked_flex"
  if (queueId === 480) return "sr_swiftplay"
  if (queueId === 490) return "sr_quickplay"
  return "sr_normal"
}

function player(entry: Record<string, unknown>): LivePlayer {
  return {
    cellId: number(entry.cellId) ?? -1,
    championId: number(entry.championId) ?? 0,
    championPickIntent: number(entry.championPickIntent) ?? 0,
    summonerId: number(entry.summonerId),
    displayName: typeof entry.name === "string" ? entry.name : undefined,
    puuid: typeof entry.puuid === "string" ? entry.puuid : undefined,
  }
}

/**
 * Reads only state already shown by the local client. The deliberately loose
 * shape lets Recall degrade safely when Riot adds or removes LCU fields.
 */
export async function readLiveSession(client: LcuClient, phase: LivePhase): Promise<LiveSession> {
  if (phase === "Idle") return idle()

  const flow = await client.request<Record<string, any>>("/lol-gameflow/v1/session")
  const data = (flow.gameData ?? {}) as Record<string, any>
  const queue = (data.queue ?? {}) as Record<string, any>
  const queueId = number(queue.id) ?? number(data.queueId)
  const gameMode = typeof data.gameMode === "string" ? data.gameMode : undefined
  const mapId = number(data.mapId)
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
  } else {
    const selections = Array.isArray(data.playerChampionSelections)
      ? data.playerChampionSelections as Record<string, unknown>[]
      : []
    result.allies = selections.map((entry, index) => ({
      cellId: index,
      championId: number(entry.championId) ?? 0,
      championPickIntent: 0,
      puuid: typeof entry.puuid === "string" ? entry.puuid : undefined,
    }))
  }

  return result
}
