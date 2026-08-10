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

export interface RecallV3CalibrationStatus {
  state: "calibrating" | "frozen"
  requiredMatches: number
  eligibleMatches: number
  largestScopeMatches: number
  scopeMatchCounts: Record<string, number>
  supportedScopes: string[]
  supportedModes: string[]
  recipeId?: string
  calibrationId?: string
  frozenAt?: number
  referenceMatches?: number
}

export interface RecallV3RebuildResult {
  canceled?: boolean
  recipeId?: string
  calibrationId?: string
  runId?: number
  total?: number
  processed?: number
  ready?: number
  nonready?: number
  errors?: number
}

export type ModeFamily = "sr" | "aram" | "classic" | "other"

export interface StatsFilter {
  mode?: TrackedMode
  modes?: TrackedMode[]
  modeFamily?: ModeFamily
  sinceMs?: number
  untilMs?: number
  championIds?: number[]
  roles?: string[]
  excludeQueueIds?: number[]
  excludeLeagueClassic?: boolean
}

export interface MatchQuery extends StatsFilter {
  modes?: TrackedMode[]
  rankedOnly?: boolean
  result?: "win" | "loss"
  /** Legacy/internal compatibility-score filter. */
  minGradeScore?: number
  /** Authoritative Recall v3 RoleFit filter (0-100). */
  minRoleFitScore?: number
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
  avgRoleFitScore?: number
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
  avgRoleFitScore?: number
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
  /** Games with enough comparison data for this metric. */
  games: number
}

export interface LobbyComparison {
  games: number
  metrics: LobbyMetric[]
}

/** One player on a recorded game's scoreboard. */
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
  roleFitScore?: number
  gradeRecipeId?: string
  gradeStatus?: string
  gradeEvidenceCoverage?: number
  gradeReferenceSampleCount?: number
  lane?: string
  role?: string
  /** The position champion select assigned, kept apart from Riot's post-game guess. */
  assignedPosition?: string
  resolvedPosition?: string
  positionResolverVersion?: number
  augments?: AugmentSelection[]
  extendedMetrics?: Record<string, number | boolean | string>
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
  labels: PerformanceLabel[]
}

export interface PerformanceLabel {
  id: string
  name: string
  category: string
  polarity: "positive" | "negative" | "mixed"
  tooltip: string
  evidence: Record<string, string | number | boolean>
  source: "match_v5" | "timeline"
  confidence: "exact" | "strong" | "inferred"
  priority: number
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
  /** Visible authoritative Recall v3 average; never reliability-shrunk. */
  roleFitScore?: number
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
  earlySignals: RankedChampion[]
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
  category:
    | "Performance"
    | "Combat"
    | "Economy"
    | "Objectives"
    | "Vision"
    | "Timeline"
    | "Special modes"
  format: "compact" | "decimal" | "percent" | "duration" | "per-minute"
  value: number
  gameId: number
  championId: number
  playedAt: number
  mode: TrackedMode
  source: "match" | "scoreboard" | "timeline"
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
  roleFitScore?: number
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
  riotMatchId?: string
  bookmarked?: boolean
  hasNote?: boolean
  tagNames?: string[]
  labelNames?: string[]
  experimentCount?: number
  /** Rank among the lobby by Recall grade; absent unless every player is graded. */
  lobbyPlace?: number
  lobbySize?: number
  eligibility?: {
    stored: true
    analyticsEligible: boolean
    gradeEligible: boolean
    timelineEligible: boolean
    reason: "eligible" | "unmatched" | "bot_or_tutorial" | "unsupported_mode" |
      "short_game" | "invalid_duration" | "incomplete_lobby" | "missing_core_metric" |
      "missing_source_fact" | "terminated" | "ineligible_for_progression" | "legacy_unknown" |
      "calibrating" | "position_unresolved"
    normalizedDurationSeconds: number | null
    durationQuality: "verified" | "source_reported" | "legacy" | "inconsistent" | "invalid"
    sourceFactsComplete: boolean
  }
  /** Scoreboard rows attached only for rich match-card responses. */
  participants?: ParticipantRow[]
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

export interface SkillHistoryPoint {
  gameId: number
  playedAt: number
  championId: number
  role?: string
  win: boolean
  grade?: string
  /** Legacy/internal compatibility normal score. */
  gradeScore?: number
  /** Authoritative Recall v3 score on a fixed 0-100 scale. */
  roleFitScore?: number
  durationSecs: number
}

export interface SkillGradeComponent {
  key:
    | "combat"
    | "participation"
    | "economy"
    | "survival"
    | "frontlining"
    | "farming"
    | "fighting"
    | "availability"
    | "resources"
    | "vision"
    | "objectives"
    | "control"
  label: string
  percentile: number
  weight: number
  contribution: number
  scope: "lobby" | "team" | "role"
}

export interface SkillGradeComponentPoint {
  gameId: number
  playedAt: number
  grade?: string
  gradeScore?: number
  compositePercentile: number
  components: SkillGradeComponent[]
}

export interface SkillChampionPoint {
  championId: number
  games: number
  wins: number
  winRate: number
  kda: number
  /** Legacy/internal compatibility normal score. */
  avgGradeScore?: number
  /** Average authoritative Recall v3 RoleFit score (0-100). */
  avgRoleFitScore?: number
  gradedGames: number
}

export type PerformanceConfidence = "learning" | "provisional" | "established"
export type PerformanceScoringContext = "profile" | "match"

export interface PerformanceMetricScore {
  key: string
  label: string
  score: number | null
  rawValue: number | null
  unit: string
  tier: "CORE" | "SECONDARY" | "DIAGNOSTIC" | "N/A"
  weight: number
  influence: number
  games: number
  eligibleGames: number
  coverage: number | null
  effectiveGames: number
  evidenceState: "observed" | "unavailable" | "no_opportunity" | "invalid" |
    "not_applicable" | "unknown" | "missing"
  evidenceReason?: string
  description: string
  formula: string
  comparison: string
  comparisonScope?: string
  referenceMatchCount?: number
}

export interface PerformanceDimensionScore {
  key: string
  label: string
  shortLabel: string
  description: string
  score: number | null
  recentScore?: number
  delta?: number
  games: number
  eligibleGames: number
  coverage: number | null
  effectiveGames: number
  confidence: PerformanceConfidence | null
  responsibilityWeight: number
  headlineEligible: boolean
  metrics: PerformanceMetricScore[]
}

export interface RviCoverage {
  eligibleGames: number
  observedGames: number
  gameRatio: number | null
  eligibleWeight: number
  observedWeight: number
  weightRatio: number | null
}

export interface RviScoreAggregate {
  score: number | null
  nEff: number
  confidence: PerformanceConfidence | null
  coverage: RviCoverage
}

export interface RviBootstrapConfidenceInterval {
  method: "deterministic_match_bootstrap_percentile"
  confidenceLevel: 0.95
  lower: number | null
  upper: number | null
  replicates: number
  seed: number | null
  observedGames: number
}

export interface RviHeadlineAggregate extends RviScoreAggregate {
  source: "role_fit"
  confidenceInterval95: RviBootstrapConfidenceInterval
}

export type PerformancePosition = "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY"
export type PerformancePrimaryArchetype =
  | "assassin"
  | "artillery"
  | "battlemage"
  | "burst_mage"
  | "catcher"
  | "diver"
  | "enchanter"
  | "juggernaut"
  | "marksman"
  | "skirmisher"
  | "vanguard"
  | "warden"
  | "specialist"

export type PerformanceScopeKind =
  | "overall"
  | "position"
  | "primary_archetype"
  | "champion_position"

export interface PerformanceScopeSummary {
  kind: PerformanceScopeKind
  key: string
  score: number
  headline: RviHeadlineAggregate
  games: number
  measuredGames: number
  coverage: number
  confidence: PerformanceConfidence
  position?: PerformancePosition
  primaryArchetype?: PerformancePrimaryArchetype
  championId?: number
}

export interface PerformanceProfileScopes {
  overall: PerformanceScopeSummary
  positions: PerformanceScopeSummary[]
  primaryArchetypes: PerformanceScopeSummary[]
  championPositions: PerformanceScopeSummary[]
}

export type RviResolvedWeighting =
  | { kind: "equal" }
  | { kind: "half_life"; halfLifeMs: number; referenceTime: number | null }

export interface RviConsistencySummary {
  median: number | null
  q1: number | null
  scaledMad: number | null
  nEff: number
  confidence: PerformanceConfidence | null
  coverage: RviCoverage
}

export interface RviVersatilityCategory {
  key: string
  weight: number
  share: number
}

export interface RviHillVersatility {
  effectiveCount: number | null
  entropy: number | null
  nEff: number
  confidence: PerformanceConfidence | null
  coverage: RviCoverage
  categories: RviVersatilityCategory[]
}

export interface PerformanceProfileAuxiliary {
  excludedFromHeadline: true
  consistency: RviConsistencySummary
  versatility: {
    champions: RviHillVersatility
    positions: RviHillVersatility
  }
}

export interface PerformanceProfile {
  algorithmVersion: number
  recipeId: string
  scoringContext: PerformanceScoringContext
  weighting: RviResolvedWeighting
  score: number
  headline: RviHeadlineAggregate
  recentHeadline?: RviHeadlineAggregate
  scopes: PerformanceProfileScopes
  auxiliary?: PerformanceProfileAuxiliary
  games: number
  recentGames: number
  measuredGames: number
  coverage: number
  confidence: PerformanceConfidence
  comparison: string
  dimensions: PerformanceDimensionScore[]
  strongestKey?: string
  growthKey?: string
  version?: number
}

export interface SkillDeathPoint {
  gameId: number
  playedAt: number
  timestamp: number
  x: number
  y: number
}

export interface SkillDeathMap {
  timelineGames: number
  deaths: SkillDeathPoint[]
}

export interface SkillReportV3 {
  version: 3
  generatedAt: number
  scope: { modes: TrackedMode[]; family: ModeFamily }
  overview: {
    summary: StatsSummary
    style?: SkillStyleReport
    performance?: PerformanceProfile
    deathMap?: SkillDeathMap
    grades: GradeCount[]
    lobby?: LobbyComparison
    contribution?: ContributionShare
    outcomes: { duration: BucketRow[]; hours: TimeBucketRow[]; weekdays: TimeBucketRow[] }
    pool?: {
      champions: number
      games: number
      coreShare: number
      top: Array<{ championId: number; games: number; wins: number }>
    }
    builds: Array<{ itemId: number; games: number }>
  }
  visuals: {
    history: SkillHistoryPoint[]
    gradeComponents: SkillGradeComponentPoint[]
    champions: SkillChampionPoint[]
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

/** @deprecated Use SkillReportV3; retained for existing renderer imports. */
export type SkillReportV2 = SkillReportV3
