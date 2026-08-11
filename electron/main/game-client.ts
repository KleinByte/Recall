import { Agent, request } from "node:https"
import type { LiveGameAnalysis } from "./live-analysis.js"

export interface LiveGameItem {
  itemId: number
  name: string
  count: number
  price: number
  canUse: boolean
  consumable: boolean
}

export interface LiveGameScores {
  kills: number
  deaths: number
  assists: number
  creepScore: number
  wardScore: number
}

export interface LiveGameRunePage {
  primaryStyleId?: number
  secondaryStyleId?: number
  /** The six gameplay runes in the order selected by the client. */
  generalRuneIds: number[]
  /** The three offense, flex, and defense bonus shards. */
  statRuneIds: number[]
}

export interface LiveGamePlayer {
  championName: string
  riotId?: string
  team: string
  position?: string
  level: number
  isDead: boolean
  respawnTimer: number
  isLocal: boolean
  scores: LiveGameScores
  items: LiveGameItem[]
  summonerSpells: string[]
  keystone?: string
}

export interface LiveGameEvent {
  id: number
  name: string
  time: number
  killerName?: string
  victimName?: string
  assisters: string[]
  result?: string
  /** Present on the Live Client Data `Multikill` event (2 through 5). */
  multiKill?: number
}

export interface LiveGameSnapshot {
  available: boolean
  gameTime: number
  gameMode?: string
  mapName?: string
  mapNumber?: number
  localTeam?: string
  activePlayer?: {
    riotId?: string
    championName?: string
    currentGold: number
    level: number
    abilityHaste: number
    /** Full local rune page from Riot's in-game Active Player feed. */
    runes?: LiveGameRunePage
  }
  allies: LiveGamePlayer[]
  enemies: LiveGamePlayer[]
  events: LiveGameEvent[]
  /** Local, explainable estimates derived from fields available to both teams. */
  analysis?: LiveGameAnalysis
  updatedAt: number
  error?: string
}

interface GameClientLike {
  request<T>(path: string): Promise<T>
}

interface RawItem {
  itemID?: number
  displayName?: string
  count?: number
  price?: number
  canUse?: boolean
  consumable?: boolean
}

interface RawPlayer {
  championName?: string
  riotId?: string
  riotIdGameName?: string
  riotIdTagLine?: string
  summonerName?: string
  team?: string
  position?: string
  level?: number
  isDead?: boolean
  respawnTimer?: number
  items?: RawItem[]
  scores?: Partial<LiveGameScores>
  summonerSpells?: {
    summonerSpellOne?: { displayName?: string }
    summonerSpellTwo?: { displayName?: string }
  }
  runes?: { keystone?: { displayName?: string } }
}

interface RawActivePlayer {
  riotId?: string
  riotIdGameName?: string
  riotIdTagLine?: string
  summonerName?: string
  currentGold?: number
  level?: number
  championStats?: { abilityHaste?: number }
  fullRunes?: RawFullRunes
}

interface RawRune {
  id?: number
}

interface RawFullRunes {
  primaryRuneTree?: RawRune
  secondaryRuneTree?: RawRune
  generalRunes?: RawRune[]
  statRunes?: RawRune[]
}

interface RawEvent {
  EventID?: number
  EventName?: string
  EventTime?: number
  KillerName?: string
  VictimName?: string
  Assisters?: string[]
  Result?: string
  KillStreak?: number
}

const number = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined

const runeId = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined

function mapRunePage(value?: RawFullRunes): LiveGameRunePage | undefined {
  if (!value) return undefined
  const generalRuneIds = (value.generalRunes ?? [])
    .flatMap((entry) => runeId(entry.id) ?? [])
  const statRuneIds = (value.statRunes ?? [])
    .flatMap((entry) => runeId(entry.id) ?? [])
  const primaryStyleId = runeId(value.primaryRuneTree?.id)
  const secondaryStyleId = runeId(value.secondaryRuneTree?.id)

  if (!primaryStyleId && !secondaryStyleId &&
      generalRuneIds.length === 0 && statRuneIds.length === 0) {
    return undefined
  }
  return {
    primaryStyleId,
    secondaryStyleId,
    generalRuneIds,
    statRuneIds,
  }
}

function riotId(value: {
  riotId?: string
  riotIdGameName?: string
  riotIdTagLine?: string
  summonerName?: string
}) {
  const gameName = text(value.riotIdGameName)
  const tagLine = text(value.riotIdTagLine)
  return text(value.riotId) ??
    (gameName && tagLine ? `${gameName}#${tagLine}` : gameName) ??
    text(value.summonerName)
}

function identity(value?: string) {
  return value?.trim().toLocaleLowerCase()
}

function mapPlayer(entry: RawPlayer, activeRiotId?: string): LiveGamePlayer {
  const spells = [
    entry.summonerSpells?.summonerSpellOne?.displayName,
    entry.summonerSpells?.summonerSpellTwo?.displayName,
  ].filter((value): value is string => Boolean(value))
  const entryRiotId = riotId(entry)

  return {
    championName: text(entry.championName) ?? "Unknown",
    riotId: entryRiotId,
    team: text(entry.team) ?? "UNKNOWN",
    position: text(entry.position),
    level: number(entry.level),
    isDead: entry.isDead === true,
    respawnTimer: number(entry.respawnTimer),
    isLocal: Boolean(
      activeRiotId &&
      identity(entryRiotId) === identity(activeRiotId),
    ),
    scores: {
      kills: number(entry.scores?.kills),
      deaths: number(entry.scores?.deaths),
      assists: number(entry.scores?.assists),
      creepScore: number(entry.scores?.creepScore),
      wardScore: number(entry.scores?.wardScore),
    },
    items: (entry.items ?? []).map((item) => ({
      itemId: number(item.itemID),
      name: text(item.displayName) ?? `Item ${number(item.itemID)}`,
      count: Math.max(1, number(item.count, 1)),
      price: number(item.price),
      canUse: item.canUse === true,
      consumable: item.consumable === true,
    })).filter((item) => item.itemId > 0),
    summonerSpells: spells,
    keystone: text(entry.runes?.keystone?.displayName),
  }
}

export async function readLiveGameSnapshot(
  client: GameClientLike,
): Promise<LiveGameSnapshot> {
  const [stats, active, players, eventData] = await Promise.all([
    client.request<Record<string, unknown>>("/liveclientdata/gamestats"),
    client.request<RawActivePlayer>("/liveclientdata/activeplayer"),
    client.request<RawPlayer[]>("/liveclientdata/playerlist"),
    client.request<{ Events?: RawEvent[] }>("/liveclientdata/eventdata"),
  ])
  const activeRiotId = riotId(active)
  const runePage = mapRunePage(active.fullRunes)
  const mappedPlayers = players.map((entry) => mapPlayer(entry, activeRiotId))
  const local = mappedPlayers.find((entry) => entry.isLocal)
  const allies = local
    ? mappedPlayers.filter((entry) => entry.team === local.team)
    : mappedPlayers
  const enemies = local
    ? mappedPlayers.filter((entry) => entry.team !== local.team)
    : []

  return {
    available: true,
    gameTime: number(stats.gameTime),
    gameMode: text(stats.gameMode),
    mapName: text(stats.mapName),
    mapNumber: number(stats.mapNumber) || undefined,
    localTeam: local?.team,
    activePlayer: {
      riotId: activeRiotId,
      championName: local?.championName,
      currentGold: number(active.currentGold),
      level: number(active.level),
      abilityHaste: number(active.championStats?.abilityHaste),
      ...(runePage ? { runes: runePage } : {}),
    },
    allies,
    enemies,
    events: (eventData.Events ?? []).map((event, index) => ({
      id: number(event.EventID, index),
      name: text(event.EventName) ?? "Event",
      time: number(event.EventTime),
      killerName: text(event.KillerName),
      victimName: text(event.VictimName),
      assisters: Array.isArray(event.Assisters)
        ? event.Assisters.filter((entry): entry is string => typeof entry === "string")
        : [],
      result: text(event.Result),
      multiKill: number(event.KillStreak) || undefined,
    })),
    updatedAt: Date.now(),
  }
}

/**
 * Reads the documented local game-client API. TLS verification is disabled
 * only for Riot's loopback certificate and never process-wide.
 */
export class GameClient {
  private readonly agent = new Agent({ rejectUnauthorized: false })

  request<T>(path: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port: 2999,
          path,
          method: "GET",
          agent: this.agent,
          headers: { accept: "application/json" },
          timeout: 1_500,
        },
        (res) => {
          const status = res.statusCode ?? 0
          const chunks: Buffer[] = []
          res.on("data", (chunk: Buffer) => chunks.push(chunk))
          res.on("end", () => {
            if (status < 200 || status >= 300) {
              reject(new Error(`Game Client returned ${status} for ${path}`))
              return
            }
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T)
            } catch (error) {
              reject(error)
            }
          })
        },
      )
      req.on("timeout", () => req.destroy(new Error("Game Client request timed out")))
      req.on("error", reject)
      req.end()
    })
  }

  close() {
    this.agent.destroy()
  }
}
