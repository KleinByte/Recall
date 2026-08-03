import type { AramStats, Challenge, Champion, Summoner } from "../types/lol"
import type { RawChallenge } from "../types/lcu"
import type { UpdateStatus } from "../types/update"
import type {
  ChallengeFilter,
  ChallengeHistoryRow,
  ChallengeRow,
  ChampionNeed,
  ChampionRanking,
  ChampionStatRow,
  ChampionStatus,
  Goal,
  GoalInput,
  GradeCount,
  InsightsReport,
  LobbyComparison,
  MatchDetail,
  MatchPage,
  MatchQuery,
  MatchRow,
  ModeFamily,
  PerformanceProfile,
  PersonalRecord,
  ProfileSummary,
  RankedHistory,
  RiotHistoryBackfillState,
  SkillReportV2,
  StatsFilter,
  StatsMeta,
  StatsSummary,
  StyleAxis,
  StyleReport,
  SyncResult,
  TrackedMode,
} from "../types/stats"
import type { LiveSession } from "../types/live"
import type {
  AnnotationTag,
  BackupSummary,
  ChampionChoice,
  ChampionChoiceObjective,
  DataTrustReport,
  ExperimentOutcomeValue,
  MatchAnnotation,
  MatchReview,
  OwnerAugmentSummary,
  PracticeExperiment,
  ReviewOverview,
  ReviewSession,
  SessionBoundaryAction,
  TimelineState,
} from "../types/review"

const ipc = () => window.ipcRenderer

type IpcSubscriber = (...args: any[]) => void

interface IpcChannelSubscription {
  renderer: typeof window.ipcRenderer
  subscribers: Set<IpcSubscriber>
  subscriptionId: string
  wrapped: (_event: unknown, ...args: any[]) => void
}

/** One native Electron listener per channel, fanned out to active Vue owners. */
const ipcSubscriptions = new Map<string, IpcChannelSubscription>()
const ipcSubscriptionOwner = `recall-renderer-${Math.random().toString(36).slice(2)}`

function subscribe(channel: string, subscriber: IpcSubscriber) {
  let subscription = ipcSubscriptions.get(channel)
  if (!subscription) {
    const renderer = ipc()
    const subscribers = new Set<IpcSubscriber>()
    const wrapped = (_event: unknown, ...args: any[]) => {
      for (const listener of [...subscribers]) listener(...args)
    }
    const subscriptionId = `${ipcSubscriptionOwner}:${channel}`
    subscription = { renderer, subscribers, subscriptionId, wrapped }
    ipcSubscriptions.set(channel, subscription)
    renderer.on(channel, wrapped, subscriptionId)
  }

  subscription.subscribers.add(subscriber)
  return () => {
    const current = ipcSubscriptions.get(channel)
    if (!current) return
    current.subscribers.delete(subscriber)
    // Keep the single channel bridge warm for the renderer lifetime. Page
    // navigation and Vue HMR can then add/remove owners without repeatedly
    // crossing Electron's context bridge. The module HMR disposer below owns
    // the native bridge itself.
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const [channel, subscription] of ipcSubscriptions) {
      subscription.renderer.off(channel, subscription.wrapped, subscription.subscriptionId)
    }
    ipcSubscriptions.clear()
  })
}

/**
 * Copies a value to plain data.
 *
 * Electron clones every IPC argument with the structured clone algorithm,
 * which rejects proxies. Filters are built straight from component state, so
 * anything held in a `ref` arrives here as a reactive proxy and would
 * otherwise fail to send.
 */
export function toPlainPayload<T>(value: T): T {
  if (Array.isArray(value)) return value.map(toPlainPayload) as T

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toPlainPayload(entry)]),
    ) as T
  }

  return value
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipc().invoke(channel, ...args.map(toPlainPayload)) as Promise<T>

const send = (channel: string, ...args: unknown[]) =>
  ipc().send(channel, ...args.map(toPlainPayload))

/** Reads a path from the League Client through the main process. */
function lcuRequest<T>(path: string): Promise<T> {
  return invoke<T>("lcu:request", path)
}

export const api = {
  notifyReady() {
    send("app-ready")
  },

  minimizeWindow() {
    send("window:minimize")
  },

  toggleMaximizeWindow() {
    send("window:toggle-maximize")
  },

  closeWindow() {
    send("window:close")
  },

  isWindowMaximized(): Promise<boolean> {
    return invoke("window:is-maximized")
  },

  getStatus(): Promise<{ connected: boolean; summoner: Summoner | null }> {
    return invoke("lcu:status")
  },

  getLiveSession(): Promise<LiveSession> {
    return invoke("live:get")
  },

  getSummoner(): Promise<Summoner> {
    return lcuRequest<Summoner>("/lol-summoner/v1/current-summoner")
  },

  async getChampions(): Promise<Champion[]> {
    const champions = await invoke<Champion[]>("champions:catalog")
    return champions.filter((champion) => champion.isVisibleInClient)
  },

  getChallenges(): Promise<Record<string, RawChallenge>> {
    return lcuRequest("/lol-challenges/v1/challenges/local-player")
  },

  getSetting<T>(key: string): Promise<T | undefined> {
    return invoke<T | undefined>("store-get", key)
  },

  setSetting(key: string, value: unknown) {
    send("store-set", key, value)
  },

  getRiotApiKeyStatus(): Promise<{
    configured: boolean
    protected: boolean
    history?: RiotHistoryBackfillState
  }> {
    return invoke("riot-api-key:status")
  },

  saveRiotApiKey(value: string): Promise<{ configured: boolean }> {
    return invoke("riot-api-key:save", value)
  },

  clearRiotApiKey(): Promise<{ configured: boolean }> {
    return invoke("riot-api-key:clear")
  },

  retryRiotHistory(): Promise<boolean> {
    return invoke("riot-history:retry")
  },

  reimportRiotDetails(): Promise<boolean> {
    return invoke("riot-history:reimport-details")
  },

  getSummary(filter: Partial<MatchQuery>): Promise<StatsSummary> {
    return invoke("stats:summary", filter)
  },

  getChampionStats(filter: Partial<StatsFilter>): Promise<ChampionStatRow[]> {
    return invoke("stats:champions", filter)
  },

  getGradeDistribution(filter: Partial<MatchQuery>): Promise<GradeCount[]> {
    return invoke("stats:grades", filter)
  },

  getMatches(
    filter: Partial<StatsFilter>,
    limit: number,
  ): Promise<MatchRow[]> {
    return invoke("stats:matches", filter, limit)
  },

  getForm(filter: Partial<StatsFilter>, limit: number): Promise<boolean[]> {
    return invoke("stats:form", filter, limit)
  },

  getStatsMeta(): Promise<StatsMeta> {
    return invoke("stats:meta")
  },

  listMatches(
    query: MatchQuery,
    page: number,
    pageSize: number,
  ): Promise<MatchPage> {
    return invoke("matches:list", query, page, pageSize)
  },

  getPlayedChampionIds(): Promise<number[]> {
    return invoke("matches:champions")
  },

  getStyleReport(
    query: Partial<MatchQuery>,
    family: ModeFamily,
  ): Promise<StyleReport> {
    return invoke("stats:style", query, family)
  },

  getLobbyComparison(
    filter: Partial<StatsFilter>,
  ): Promise<LobbyComparison | undefined> {
    return invoke("stats:lobby", filter)
  },

  getMatchDetail(gameId: number): Promise<MatchDetail> {
    return invoke("matches:detail", gameId)
  },

  getInsights(
    filter: Partial<StatsFilter>,
    family: ModeFamily,
  ): Promise<InsightsReport> {
    return invoke("insights:all", filter, family)
  },

  getSkillReport(
    filter: Partial<StatsFilter>,
    family: ModeFamily,
  ): Promise<SkillReportV2> {
    return invoke("stats:skill-report", filter, family)
  },

  getRviProfile(
    filter: Partial<StatsFilter>,
    family: ModeFamily,
  ): Promise<PerformanceProfile | undefined> {
    return invoke("stats:rvi", filter, family)
  },

  getDrift(
    query: Partial<MatchQuery>,
    family: ModeFamily,
  ): Promise<{ label: string; axes: StyleAxis[] }[]> {
    return invoke("stats:drift", query, family)
  },

  getRankedChampions(
    filter: Partial<StatsFilter>,
  ): Promise<ChampionRanking> {
    return invoke("champions:ranked", filter)
  },

  getMatchAxes(
    gameId: number,
    family: ModeFamily,
  ): Promise<{ axes: StyleAxis[] }> {
    return invoke("matches:axes", gameId, family)
  },

  getRecords(filter: Partial<StatsFilter>): Promise<PersonalRecord[]> {
    return invoke("stats:records", filter)
  },

  getRankedHistory(): Promise<RankedHistory[]> {
    return invoke("ranked:history")
  },

  listGoals(): Promise<Goal[]> {
    return invoke("goals:list")
  },

  addGoal(goal: GoalInput): Promise<number> {
    return invoke("goals:add", goal)
  },

  removeGoal(id: number): Promise<boolean> {
    return invoke("goals:remove", id)
  },

  listChallenges(filter: ChallengeFilter): Promise<ChallengeRow[]> {
    return invoke("challenges:list", filter)
  },

  getChallenge(challengeId: number): Promise<ChallengeRow | undefined> {
    return invoke("challenges:detail", challengeId)
  },

  getChallengeHistory(challengeId: number): Promise<ChallengeHistoryRow[]> {
    return invoke("challenges:history", challengeId)
  },

  getChampionNeeds(
    championIds: number[],
  ): Promise<Record<number, ChampionNeed[]>> {
    return invoke("challenges:champion-needs", championIds)
  },

  getPinnedChallenges(): Promise<number[]> {
    return invoke("challenges:pinned")
  },

  pinChallenge(challengeId: number): Promise<number[]> {
    return invoke("challenges:pin", challengeId)
  },

  unpinChallenge(challengeId: number): Promise<number[]> {
    return invoke("challenges:unpin", challengeId)
  },

  getChampionStatus(championId: number): Promise<ChampionStatus[]> {
    return invoke("challenges:champion-status", championId)
  },

  getProfile(): Promise<ProfileSummary> {
    return invoke("profile:summary")
  },

  syncNow(): Promise<SyncResult> {
    return invoke("stats:sync")
  },

  refreshAll(): Promise<SyncResult> {
    return invoke("app:refresh-all")
  },

  exportHistory(): Promise<{ exported: number; filePath?: string }> {
    return invoke("stats:export")
  },

  clearHistory(): Promise<{ deleted: number }> {
    return invoke("stats:clear")
  },

  getDataTrust(): Promise<DataTrustReport> {
    return invoke("data-trust:get")
  },

  checkDataTrust(): Promise<DataTrustReport> {
    return invoke("data-trust:check")
  },

  listBackups(): Promise<BackupSummary[]> {
    return invoke("backups:list")
  },

  createBackup(): Promise<BackupSummary> {
    return invoke("backups:create")
  },

  restoreBackup(fileName: string): Promise<boolean> {
    return invoke("backups:restore", fileName)
  },

  deleteBackup(fileName: string): Promise<boolean> {
    return invoke("backups:delete", fileName)
  },

  getReviewOverview(): Promise<ReviewOverview> {
    return invoke("review:overview")
  },

  getMatchReview(gameId: number): Promise<MatchReview> {
    return invoke("review:match", gameId)
  },

  getOwnerAugmentSummaries(
    augmentId?: number,
    championId?: number,
  ): Promise<OwnerAugmentSummary[]> {
    return invoke("augments:owner-summary", augmentId, championId)
  },

  cacheAugmentCatalog(input: {
    dataVersion: string
    entries: { augmentId: number; name: string; rarity?: string; iconPath?: string }[]
  }): Promise<number> {
    return invoke("augments:cache-catalog", input)
  },

  getReviewSessions(page = 1, pageSize = 20): Promise<{
    rows: ReviewSession[]
    total: number
    page: number
    pageSize: number
  }> {
    return invoke("review:sessions", page, pageSize)
  },

  setSessionBoundary(gameId: number, action: SessionBoundaryAction): Promise<boolean> {
    return invoke("review:session-boundary", gameId, action)
  },

  getChampionRecommendations(
    championIds: number[],
    mode: TrackedMode,
    objective: ChampionChoiceObjective,
  ): Promise<ChampionChoice[]> {
    return invoke("recommendations:champions", championIds, mode, objective)
  },

  getTimeline(gameId: number): Promise<TimelineState> {
    return invoke("timeline:get", gameId)
  },

  requestTimeline(gameId: number, manualRetry = false): Promise<TimelineState> {
    return invoke("timeline:request", gameId, manualRetry)
  },

  getAnnotation(gameId: number): Promise<MatchAnnotation> {
    return invoke("annotations:get", gameId)
  },

  saveAnnotation(
    gameId: number,
    input: { note: string; bookmarked: boolean; tagIds: number[] },
  ): Promise<MatchAnnotation> {
    return invoke("annotations:save", gameId, input)
  },

  listTags(): Promise<AnnotationTag[]> {
    return invoke("tags:list")
  },

  createTag(name: string, color?: string): Promise<AnnotationTag> {
    return invoke("tags:create", name, color)
  },

  deleteTag(id: number): Promise<boolean> {
    return invoke("tags:delete", id)
  },

  listExperiments(): Promise<PracticeExperiment[]> {
    return invoke("experiments:list")
  },

  createExperiment(input: Omit<PracticeExperiment, "id" | "startedAt">) {
    return invoke<PracticeExperiment>("experiments:create", input)
  },

  updateExperiment(id: number, input: Omit<PracticeExperiment, "id" | "startedAt">) {
    return invoke<PracticeExperiment | undefined>("experiments:update", id, input)
  },

  setExperimentOutcome(
    gameId: number,
    experimentId: number,
    outcome: ExperimentOutcomeValue,
    note: string,
  ): Promise<boolean> {
    return invoke(
      "experiments:set-match-outcome",
      gameId,
      experimentId,
      outcome,
      note,
    )
  },

  getUpdateStatus(): Promise<UpdateStatus> {
    return invoke("app:update-status")
  },

  checkForUpdates(): Promise<void> {
    return invoke("app:update-check")
  },

  retryUpdate(): Promise<void> {
    return invoke("app:update-retry")
  },

  installUpdate(): Promise<boolean> {
    return invoke("app:update-install")
  },

  onUpdateStatus(listener: (status: UpdateStatus) => void) {
    return subscribe("app:update-status", (status: UpdateStatus) => listener(status))
  },

  on(channel: string, listener: (...args: any[]) => void) {
    return subscribe(channel, listener)
  },
}

export type { AramStats, Challenge }
