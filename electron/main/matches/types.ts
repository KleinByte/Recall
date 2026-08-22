import type {
  GradeCoreField,
  GradeCoreSource,
} from "./grade-core-facts.js"

export type TrackedMode =
  | "sr_ranked_solo"
  | "sr_ranked_flex"
  | "sr_normal"
  | "sr_quickplay"
  | "sr_swiftplay"
  | "urf"
  | "aram"
  | "mayhem"
  | "league_classic"
  | "other"

export type ModeFamily = "sr" | "aram" | "classic" | "other"

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
  /** The scoreboard participant's identity, when Riot exposed it. */
  participantPuuid?: string
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
  runeSelections?: RuneSelection[]
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
  gradeAlgorithmVersion?: number
  recallScore?: number
  gradeRecipeId?: string
  gradeStatus?: string
  gradeEvidenceCoverage?: number
  gradeReferenceSampleCount?: number
  /** Whether every canonical core fact was observed before numeric fallback coercion. */
  gradeCoreComplete?: 0 | 1
  /** Payload family that established completeness (or the legacy policy). */
  gradeCoreSource?: GradeCoreSource
  /** Stable source-field names that were absent or malformed. */
  gradeCoreMissingFields?: GradeCoreField[]
  /** Version of the completeness contract used by the mapper. */
  gradeCoreContractVersion?: number
  lane?: string
  role?: string
  /** The position champion select assigned, kept apart from Riot's post-game guess. */
  assignedPosition?: string
  /** Source-specific facts retained separately so zero never means absent. */
  eligibleForProgression?: number
  timePlayedSecs?: number
  controlWardsPurchased?: number
  detectorWardsPlaced?: number
  totalHealsOnTeammates?: number
  totalDamageShieldedOnTeammates?: number
  damageDealtToBuildings?: number
  lcuLane?: string
  lcuRole?: string
  matchV5TeamPosition?: string
  matchV5IndividualPosition?: string
  resolvedPosition?: string
  positionResolverVersion?: number
  augments?: AugmentSelection[]
  extendedMetrics?: Record<string, number | boolean | string>
  /** Latest mastery snapshot Recall could read for this player/champion. */
  mastery?: ChampionMasterySnapshot
}

export interface RuneSelection {
  runeId: number
  slot: number
  var1: number
  var2: number
  var3: number
  count?: number
  kind?: "modern" | "classic"
}

export interface ChampionMasterySnapshot {
  championId: number
  championLevel: number
  championPoints: number
  championPointsSinceLastLevel: number
  championPointsUntilNextLevel: number
  tokensEarned: number
  highestGrade?: string
  updatedAt: number
}

export interface AugmentSelection {
  slot: number
  augmentId: number
  selectedAtMs?: number
  source: "league_client" | "match_v5" | "timeline"
  name?: string
  rarity?: string
  iconPath?: string
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
  spell1Id?: number
  spell2Id?: number
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
  mapId?: number
  gameType?: string
  gameEndTimestamp?: number
  endOfGameResult?: string
  ownerEligibleForProgression?: number
  durationQuality?: "verified" | "source_reported" | "legacy" | "inconsistent" | "invalid"
  resolvedPosition?: string
  positionResolverVersion?: number
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
  gradeAlgorithmVersion?: number
  recallScore?: number
  gradeRecipeId?: string
  gradeStatus?: string
  gradeEvidenceCoverage?: number
  gradeReferenceSampleCount?: number
  modeFamily: ModeFamily
  isRanked: number
  lane?: string
  role?: string
  /** The position champion select assigned, kept apart from Riot's post-game guess. */
  assignedPosition?: string
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
  /** Canonical platform-prefixed Match-V5 id, for example NA1_123456789. */
  riotMatchId?: string
  bookmarked?: boolean
  hasNote?: boolean
  tagNames?: string[]
  /** Highest-priority automatically awarded Match-V5 labels. */
  labelNames?: string[]
  /** Rank among the lobby by Recall grade; absent unless every player is graded. */
  lobbyPlace?: number
  lobbySize?: number
  /** Versioned eligibility metadata added by the data-integrity rollout. */
  eligibility?: import("./eligibility.js").MatchEligibilityResult
  /** Scoreboard rows attached only for rich match-card responses. */
  participants?: ParticipantRow[]
}

export type PerformanceLabelPolarity = "positive" | "negative" | "mixed"
export type PerformanceLabelConfidence = "exact" | "strong" | "inferred"

export interface PerformanceLabel {
  id: string
  name: string
  category: string
  polarity: PerformanceLabelPolarity
  tooltip: string
  evidence: Record<string, string | number | boolean>
  source: "match_v5" | "timeline"
  confidence: PerformanceLabelConfidence
  priority: number
  evaluatorVersion?: number
}
