export type TrackedMode =
  | "sr_ranked_solo"
  | "sr_ranked_flex"
  | "sr_normal"
  | "sr_quickplay"
  | "sr_swiftplay"
  | "aram"
  | "mayhem"
  | "other"

export type ModeFamily = "sr" | "aram" | "other"

export interface ModeInfo {
  mode: TrackedMode
  family: ModeFamily
  isRanked: boolean
  /** The client's own name for the queue, when it could be read. */
  queueName?: string
}

/**
 * One player in a recorded game.
 *
 * `puuid` is the account whose history this belongs to, not the participant's
 * own identity. The scoreboard is kept whole — names, builds and every
 * statistic the client reports — because once a game leaves the client's
 * twenty-game window none of it can ever be fetched again.
 */
export interface ParticipantRow {
  gameId: number
  puuid: string
  participantId: number
  teamId: number
  isPlayer: number
  championId: number
  win: number
  summonerName?: string
  profileIcon: number
  spell1Id: number
  spell2Id: number
  items: number[]
  perkPrimaryStyle: number
  perkSubStyle: number
  perks: number[]
  champLevel: number
  kills: number
  deaths: number
  assists: number
  goldEarned: number
  goldSpent: number
  damageToChampions: number
  totalDamageDealt: number
  magicDamageToChampions: number
  physicalDamageToChampions: number
  trueDamageToChampions: number
  damageTaken: number
  damageSelfMitigated: number
  totalHeal: number
  totalUnitsHealed: number
  timeCcingOthers: number
  largestKillingSpree: number
  largestMultiKill: number
  doubleKills: number
  tripleKills: number
  quadraKills: number
  pentaKills: number
  totalMinionsKilled: number
  neutralMinions: number
  visionScore: number
  wardsPlaced: number
  wardsKilled: number
  controlWards: number
  damageObjectives: number
  damageTurrets: number
  turretKills: number
  inhibitorKills: number
  longestTimeLiving: number
  firstBlood: number
  firstTower: number
  grade?: string
  gradeScore?: number
  lane?: string
  role?: string
}

/** One side of a recorded game. */
export interface TeamRow {
  gameId: number
  puuid: string
  teamId: number
  win: number
  /** Champion ids banned by this side, as JSON. */
  bans: string
  baronKills: number
  dragonKills: number
  heraldKills: number
  hordeKills: number
  towerKills: number
  inhibitorKills: number
  firstBlood: number
  firstTower: number
  firstBaron: number
  firstDragon: number
  firstInhibitor: number
}

/** Fields used from `participants[0].stats` in the LCU match history payload. */
export interface LcuParticipantStats {
  win: boolean
  kills: number
  deaths: number
  assists: number
  champLevel: number
  goldEarned: number
  totalDamageDealtToChampions: number
  totalDamageTaken: number
  damageSelfMitigated: number
  totalHeal: number
  totalUnitsHealed: number
  timeCCingOthers: number
  largestKillingSpree: number
  largestMultiKill: number
  doubleKills: number
  tripleKills: number
  quadraKills: number
  pentaKills: number
  totalMinionsKilled: number
  visionScore: number
  gameEndedInSurrender: boolean
  gameEndedInEarlySurrender: boolean
  neutralMinionsKilled: number
  wardsPlaced: number
  wardsKilled: number
  visionWardsBoughtInGame: number
  damageDealtToObjectives: number
  damageDealtToTurrets: number
  turretKills: number
  inhibitorKills: number
  firstBloodKill: boolean
}

/** Lane and role, present on Summoner's Rift games. */
export interface LcuTimeline {
  lane?: string
  role?: string
}

export interface LcuParticipant {
  championId: number
  stats: LcuParticipantStats
  timeline?: LcuTimeline
}

/**
 * A single game from
 * `/lol-match-history/v1/products/lol/{puuid}/matches`.
 *
 * This endpoint returns only the local player's participant, so
 * `participants[0]` is always the player whose history was requested.
 */
export interface LcuGame {
  gameId: number
  gameCreation: number
  gameDuration: number
  gameMode: string
  gameType: string
  gameVersion: string
  queueId: number
  mapId: number
  participants: LcuParticipant[]
}

/** One row of the `matches` table. */
export interface MatchRow {
  gameId: number
  puuid: string
  queueId: number
  gameMode: string
  mode: TrackedMode
  isMatched: number
  playedAt: number
  durationSecs: number
  gameVersion: string
  championId: number
  win: number
  kills: number
  deaths: number
  assists: number
  champLevel: number
  goldEarned: number
  damageToChampions: number
  damageTaken: number
  damageSelfMitigated: number
  totalHeal: number
  totalUnitsHealed: number
  timeCcingOthers: number
  largestKillingSpree: number
  largestMultiKill: number
  doubleKills: number
  tripleKills: number
  quadraKills: number
  pentaKills: number
  totalMinionsKilled: number
  visionScore: number
  endedInSurrender: number
  endedInEarlySurrender: number
  grade?: string
  gradeScore?: number
  modeFamily: ModeFamily
  isRanked: number
  lane?: string
  role?: string
  neutralMinions: number
  wardsPlaced: number
  wardsKilled: number
  controlWards: number
  damageObjectives: number
  damageTurrets: number
  turretKills: number
  inhibitorKills: number
  firstBlood: number
  csPerMin: number
  goldPerMin: number
  queueName?: string
}
