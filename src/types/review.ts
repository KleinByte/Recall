import type { MatchRow, ParticipantRow, TrackedMode } from "./stats"

export type Confidence = "thin" | "fair" | "solid"
export type DataTrustState =
  | "healthy"
  | "syncing"
  | "local_only"
  | "needs_attention"

export interface SyncHealth {
  source: "league_client" | "riot_history" | "riot_timeline"
  firstObservedAt?: number
  lastAttemptAt?: number
  lastSuccessAt?: number
  lastError?: string
  itemsSeen: number
  itemsWritten: number
  running: boolean
}

export interface HistoryCoverage {
  status: "complete" | "running" | "observed" | "needs_attention"
  through?: number
  firstObservedAt?: number
  idsScanned: number
  downloaded: number
  imported: number
  skipped: number
}

export interface BackupSummary {
  fileName: string
  createdAt: number
  reason: "daily" | "manual" | "pre-update" | "pre-migration" | "pre-restore"
  schemaVersion: number
  matchCount: number
  sizeBytes: number
  sha256: string
  integrity: "ok" | "failed" | "unknown"
}

export interface DataTrustReport {
  state: DataTrustState
  database: {
    path: string
    sizeBytes: number
    schemaVersion: number
    matchCount: number
    oldestPlayedAt?: number
    newestPlayedAt?: number
    completeScoreboardPercent: number
    gradedPercent: number
    timelineCount: number
    captureManifestPercent: number
    augmentMatchCount: number
    schemaDriftMatchCount: number
    lastIntegrityCheck?: number
    integrity: "ok" | "failed" | "unknown"
  }
  leagueClient: SyncHealth
  riotHistory: SyncHealth & {
    keyConfigured: boolean
    keyProtected: boolean
    route?: string
    coverage: HistoryCoverage
    rateLimits: RateLimitWindow[]
    nextEligibleAt?: number
  }
  backups: BackupSummary[]
}

export interface RateLimitWindow {
  limit: number
  seconds: number
  used: number
  resetsAt?: number
}

export type GradeComponentKey =
  | "combat"
  | "participation"
  | "economy"
  | "survival"
  | "frontlining"
  | "farming"
  | "vision"
  | "objectives"

export interface GradeComponent {
  key: GradeComponentKey
  label: string
  percentile: number
  weight: number
  contribution: number
  scope: "lobby" | "team" | "role"
}

export interface GradeBreakdown {
  algorithmVersion: number
  compositePercentile: number
  components: GradeComponent[]
  unavailableReason?: string
}

export interface BaselineMetric {
  key: string
  label: string
  current: number
  baseline: number
  difference: number
  preferredDirection: "higher" | "lower"
}

export interface PersonalBaseline {
  scope: "champion_mode" | "role_mode" | "mode"
  games: number
  confidence: Confidence
  metrics: BaselineMetric[]
}

export interface ReviewHighlight {
  kind: "strength" | "opportunity" | "improvement" | "regression"
  title: string
  detail: string
  metricKey: string
}

export interface MatchAnnotation {
  gameId: number
  note: string
  bookmarked: boolean
  tags: AnnotationTag[]
  experimentOutcomes: ExperimentOutcome[]
  updatedAt?: number
}

export interface AnnotationTag {
  id: number
  name: string
  color: string
}

export interface MatchReview {
  match: MatchRow
  scoreboard: ParticipantRow[]
  grade?: GradeBreakdown
  baseline?: PersonalBaseline
  highlights: ReviewHighlight[]
  annotation: MatchAnnotation
  timeline: TimelineState
}

export interface ReviewOverview {
  latest?: MatchReview
  recentSession?: ReviewSession
  bookmarkCount: number
  activeExperimentCount: number
}

export interface OwnerAugmentSummary {
  augmentId: number
  games: number
  firstPlayedAt: number
  lastPlayedAt: number
  averageGrade?: number
  kda: number
  damagePerMinute: number
  champions: { championId: number; games: number }[]
}

export type SessionBoundaryAction = "split" | "join" | null

export interface ReviewSession {
  id: string
  startAt: number
  endAt: number
  playTimeSecs: number
  games: number
  wins: number
  losses: number
  winRate: number
  avgGradeScore?: number
  championCount: number
  bestMatch?: MatchRow
  lowestMatch?: MatchRow
  trend?: "improved" | "declined" | "stable"
  trendDelta?: number
  modes: { mode: TrackedMode; games: number; wins: number }[]
  champions: { championId: number; games: number; wins: number }[]
  matches?: MatchRow[]
}

export type ChampionChoiceObjective =
  | "best_overall"
  | "recent_form"
  | "challenges"
  | "practice"
  | "most_reliable"

export interface ChoiceSignal {
  key: "long_term" | "recent" | "reliability" | "novelty" | "challenges"
  label: string
  score: number
  weight: number
  contribution: number
}

export interface ChampionChoice {
  championId: number
  rank: number
  score: number
  games: number
  wins: number
  losses: number
  adjustedWinRate: number
  averageGrade?: number
  kda: number
  confidence: Confidence
  recentDirection: "up" | "down" | "stable" | "unknown"
  challengeNames: string[]
  signals: ChoiceSignal[]
}

export type TimelineStatus =
  | "not_requested"
  | "pending"
  | "loading"
  | "ready"
  | "unavailable"
  | "error"

export interface TimelineState {
  status: TimelineStatus
  summary?: TimelineSummary
  error?: string
  fetchedAt?: number
}

export interface TimelineFrame {
  timestamp: number
  blueGold: number
  redGold: number
  ownerGold: number
  ownerLevel: number
  ownerXp: number
  ownerCs: number
  participants: TimelineParticipantFrame[]
}

export interface TimelineParticipantFrame {
  participantId: number
  teamId?: number
  currentGold: number
  totalGold: number
  level: number
  xp: number
  minionsKilled: number
  jungleMinionsKilled: number
  position?: { x: number; y: number }
}

export interface TimelineEvent {
  eventId: string
  timestamp: number
  type: string
  category: "kill" | "item" | "objective" | "level" | "vision" | "game"
  participantId?: number
  assistingParticipantIds?: number[]
  teamId?: number
  targetId?: number
  itemId?: number
  beforeId?: number
  afterId?: number
  skillSlot?: number
  level?: number
  objective?: string
  killType?: string
  multiKillLength?: number
  bounty?: number
  shutdownBounty?: number
  wardType?: string
  laneType?: string
  position?: { x: number; y: number }
}

export interface TimelineSummary {
  frames: TimelineFrame[]
  events: TimelineEvent[]
  turningPoints: {
    timestamp: number
    swing: number
    beforeDifference: number
    afterDifference: number
  }[]
}

export type ExperimentStatus = "active" | "paused" | "completed"
export type ExperimentOutcomeValue =
  | "worked"
  | "mixed"
  | "did_not_work"
  | "unrated"

export interface PracticeExperiment {
  id: number
  name: string
  hypothesis: string
  championIds: number[]
  modes: TrackedMode[]
  status: ExperimentStatus
  startedAt: number
  endedAt?: number
  games?: number
  summary?: {
    winRate: number
    avgGrade?: number
    kda: number
    confidence: Confidence
    baselineGames: number
    baselineWinRate: number
    baselineAvgGrade?: number
    baselineKda: number
    baselineConfidence: Confidence
  }
}

export interface ExperimentOutcome {
  experimentId: number
  experimentName: string
  outcome: ExperimentOutcomeValue
  note: string
}
