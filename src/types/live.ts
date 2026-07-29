import type { TrackedMode } from "./stats"

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
