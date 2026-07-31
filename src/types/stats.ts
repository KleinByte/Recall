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

export interface StatsFilter {
  mode?: TrackedMode
  modes?: TrackedMode[]
  modeFamily?: ModeFamily
  sinceMs?: number
}

export interface MatchQuery extends StatsFilter {
  modes?: TrackedMode[]
  rankedOnly?: boolean
  result?: "win" | "loss"
  championIds?: number[]
  minGradeScore?: number
  untilMs?: number
  minDurationSecs?: number
  sortBy?: "played_at" | "kda" | "damage" | "grade" | "duration"
  sortDir?: "asc" | "desc"
  bookmarked?: boolean
  hasNotes?: boolean
  tagIds?: number[]
  experimentId?: number
}

export interface MatchPage {
  rows: MatchRow[]
  total: number
  page: number
  pageSize: number
}

export interface ChallengeRow {
  challengeId: number
  puuid: string
  name: string
  description: string
  category: string
  idListType: string
  gameModes: string
  currentLevel: string
  nextLevel: string | null
  currentValue: number
  currentThreshold: number | null
  nextThreshold: number | null
  thresholds: string
  percentile: number | null
  pointsAwarded: number
  isCapstone: number
  isApex: number
  isRetired: number
  parentId: number | null
  iconPath: string | null
  completedIds: string
  updatedAt: number
}

export interface ChallengeFilter {
  category?: string
  level?: string
  includeRetired?: boolean
  idListType?: string
  search?: string
}

export interface ChallengeHistoryRow {
  challengeId: number
  recordedAt: number
  currentValue: number
  currentLevel: string
}

export interface ChampionNeed {
  challengeId: number
  name: string
  currentLevel: string
  currentValue: number
  nextThreshold: number | null
}

export interface CategoryProgress {
  category: string
  current: number
  max: number
  level: string
  positionPercentile: number
}

export interface ProfileSummary {
  challenges: {
    overallLevel: string
    totalScore: number
    percentile: number | null
    categoryJson: string
  } | null
  ranked: {
    queueMap?: Record<
      string,
      {
        tier: string
        division: string
        leaguePoints: number
        wins: number
        losses: number
      }
    >
  } | null
  mastery: {
    championId: number
    championLevel: number
    championPoints: number
    highestGrade?: string
  }[]
}

export interface StatsSummary {
  games: number
  wins: number
  losses: number
  winRate: number
  avgKills: number
  avgDeaths: number
  avgAssists: number
  kda: number
  avgDamageToChampions: number
  avgDamageTaken: number
  avgGold: number
  avgDurationSecs: number
  pentaKills: number
  currentStreak: number
  longestWinStreak: number
  avgGradeScore?: number
  gradedGames: number
}

export interface GradeCount {
  grade: string
  count: number
}

export interface ChampionStatRow {
  championId: number
  games: number
  wins: number
  winRate: number
  avgKills: number
  avgDeaths: number
  avgAssists: number
  kda: number
  avgDamageToChampions: number
  avgGradeScore?: number
  gradedGames: number
}

export interface StyleAxis {
  key: string
  label: string
  /** Fraction of the ring, always between 0 and 1. */
  value: number
  description: string
  formula: string
}

export interface StyleDetail {
  damagePerMin: number
  goldPerMin: number
  csPerMin: number
  visionPerMin: number
  avgDeaths: number
  avgLargestSpree: number
  doubleKills: number
  tripleKills: number
  quadraKills: number
  pentaKills: number
}

export interface StyleProfile {
  games: number
  axes: StyleAxis[]
  detail: StyleDetail
}

/** The career shape, the last few games, and what came before them. */
export interface StyleReport {
  career?: StyleProfile
  recent?: StyleProfile
  earlier?: StyleProfile
}

export interface SkillStyleReport {
  career: StyleProfile
  recent?: StyleProfile
  earlier?: StyleProfile
  drift: Array<{ label: string; axes: StyleAxis[] }>
}

export interface LobbyMetric {
  key: string
  label: string
  /** Average placing out of the lobby, where 1 is best. */
  averageRank: number
  /** 1 means top of every lobby, 0 means bottom of every lobby. */
  percentile: number
  scope: "role" | "lobby"
}

export interface LobbyComparison {
  games: number
  metrics: LobbyMetric[]
}

/** One player on a recorded game's scoreboard. */
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
  augments?: AugmentSelection[]
  extendedMetrics?: Record<string, number | boolean | string>
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

export interface TeamRow {
  gameId: number
  puuid: string
  teamId: number
  win: number
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

export interface MatchDetail {
  participants: ParticipantRow[]
  teams: TeamRow[]
}

export type Confidence = "thin" | "fair" | "solid"

export interface RankedChampion {
  championId: number
  games: number
  gradedGames: number
  winRate: number
  kda: number
  rawGrade?: number
  adjustedGrade: number
  confidence: Confidence
}

export interface BucketRow {
  label: string
  games: number
  wins: number
  winRate: number
  avgGradeScore?: number
}

export interface TimeBucketRow {
  label: string
  games: number
  wins: number
  winRate: number
}

export interface StreakBehaviour {
  afterWin: TimeBucketRow
  afterLoss: TimeBucketRow
}

export interface ContributionShare {
  games: number
  damageShare: number
  goldShare: number
  killShare: number
}

export interface ChampionPool {
  champions: number
  games: number
  coreShare: number
  coreWinRate: number
  restWinRate: number
}

export interface BuiltItem {
  itemId: number
  games: number
  wins: number
  winRate: number
}

export interface InsightsReport {
  duration: BucketRow[]
  hours: TimeBucketRow[]
  weekdays: TimeBucketRow[]
  streaks?: StreakBehaviour
  contribution?: ContributionShare
  pool?: ChampionPool
  builds: BuiltItem[]
}

export interface ChampionRanking {
  ranked: RankedChampion[]
  best: RankedChampion[]
  worst: RankedChampion[]
}

/** What a pinned challenge says about one champion. */
export interface ChampionStatus {
  challengeId: number
  name: string
  completed: boolean
  completedCount: number
}

export interface PersonalRecord {
  key: string
  label: string
  value: number
  gameId: number
  championId: number
  playedAt: number
  mode: TrackedMode
}

export interface RankedPoint {
  recordedAt: number
  points: number
  label: string
  leaguePoints: number
  wins: number
  losses: number
}

export interface RankedHistory {
  queue: string
  points: RankedPoint[]
}

export interface GoalInput {
  kind: "challenge" | "rank"
  targetKey: string
  targetValue: number
  label: string
}

export interface Goal extends GoalInput {
  id: number
  createdAt: number
  achievedAt?: number
  current: number
  progress: number
}

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
  riotMatchId?: string
  bookmarked?: boolean
  hasNote?: boolean
  tagNames?: string[]
  experimentCount?: number
}

export interface StatsMeta {
  databasePath: string
  totalMatches: number
  oldestPlayedAt?: number
}

export interface RiotHistoryBackfillState {
  puuid: string
  regionalRoute: string
  endTimeSeconds: number
  nextOffset: number
  idsScanned: number
  matchesDownloaded: number
  matchesImported: number
  matchesSkipped: number
  status: "idle" | "running" | "complete" | "error" | "paused"
  lastError?: string
  startedAt?: number
  updatedAt: number
  completedAt?: number
}

export interface SyncResult {
  fetched: number
  inserted: number
}

export interface Interval {
  low: number
  high: number
  level: 0.95
}

export type EvidenceLevel = "descriptive" | "comparative" | "experimental"
export type EvidenceConfidence = "insufficient" | "low" | "medium" | "high"

export interface InsightFinding {
  key: string
  title: string
  summary: string
  evidenceLevel: EvidenceLevel
  confidence: EvidenceConfidence
  games: number
  eligibleGames: number
  effect: number
  unit: "grade" | "probability" | "percentile" | "rate"
  interval?: Interval
  rateInterval?: Interval
  scope: string
  caveat?: string
  values?: Record<string, number>
}

export interface InsightSection {
  key: string
  title: string
  method: string
  eligible: boolean
  neededGames: number
  findings: InsightFinding[]
}

export interface PredictiveSignal {
  feature: string
  direction: "positive" | "negative"
  marginalEffect: number
}

export interface PredictiveSection {
  state: "insufficient" | "no-signal" | "ready" | "error"
  message?: string
  neededGames?: number
  signals?: PredictiveSignal[]
}

export interface SkillReportV2 {
  version: 2
  generatedAt: number
  scope: { modes: TrackedMode[]; family: ModeFamily }
  overview: {
    summary: StatsSummary
    style?: SkillStyleReport
    grades: GradeCount[]
    lobby?: LobbyComparison
    contribution?: ContributionShare
    outcomes: { duration: BucketRow[]; hours: TimeBucketRow[] }
    pool?: { champions: number; games: number; coreShare: number }
    builds: Array<{ itemId: number; games: number }>
  }
  insights: {
    bestGamePattern: InsightSection
    conditions: InsightSection
    predictive: PredictiveSection
    duration: InsightSection
    trends: InsightSection
    champions: InsightSection
    items: InsightSection
  }
}
