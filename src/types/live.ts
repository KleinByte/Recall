import type { TrackedMode } from "./stats"

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

export interface LiveGameItem {
  itemId: number
  name: string
  count: number
  price: number
  canUse: boolean
  consumable: boolean
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
  scores: {
    kills: number
    deaths: number
    assists: number
    creepScore: number
    wardScore: number
  }
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
  multiKill?: number
}

export interface LiveResourceAnalysis {
  allyGold: number
  enemyGold: number
  difference: number
  quality: "building" | "fair" | "strong"
  source: "estimated"
}

export interface LiveWinConfidence {
  percent: number
  label: "Strongly favored" | "Favored" | "Even" | "Under pressure" | "Long shot"
  factors: string[]
}

export interface LiveTempoAnalysis {
  score: number
  label: "Surging" | "Building" | "Stable" | "Slipping" | "Collapsing" |
    "Double Kill" | "Triple Kill" | "Quadra Kill" | "Pentakill"
  direction: "up" | "steady" | "down"
  leadDelta: number
  factors: string[]
  surgeTier?: "gold" | "emerald" | "diamond" | "master"
}

export interface LiveGameAnalysis {
  resources: LiveResourceAnalysis
  winConfidence: LiveWinConfidence
  tempo: LiveTempoAnalysis
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
  }
  allies: LiveGamePlayer[]
  enemies: LiveGamePlayer[]
  events: LiveGameEvent[]
  analysis?: LiveGameAnalysis
  updatedAt: number
  error?: string
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
