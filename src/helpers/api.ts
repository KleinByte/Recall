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
  PersonalRecord,
  ProfileSummary,
  RankedHistory,
  StatsFilter,
  StatsMeta,
  StatsSummary,
  StyleAxis,
  StyleReport,
  SyncResult,
} from "../types/stats"
import type { LiveSession } from "../types/live"

const ipc = () => window.ipcRenderer

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

  getStatus(): Promise<{ connected: boolean; summoner: Summoner | null }> {
    return invoke("lcu:status")
  },

  getLiveSession(): Promise<LiveSession> {
    return invoke("live:get")
  },

  getSummoner(): Promise<Summoner> {
    return lcuRequest<Summoner>("/lol-summoner/v1/current-summoner")
  },

  async getChampions(summonerId: number): Promise<Champion[]> {
    const champions = await lcuRequest<Champion[]>(
      `/lol-champions/v1/inventories/${summonerId}/champions-minimal`,
    )

    // The first entry is the "None" placeholder champion.
    return champions
      .slice(1)
      .filter((champion) => champion.isVisibleInClient)
      .sort((a, b) => a.name.localeCompare(b.name))
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

  getRiotApiKeyStatus(): Promise<{ configured: boolean; protected: boolean }> {
    return invoke("riot-api-key:status")
  },

  saveRiotApiKey(value: string): Promise<{ configured: boolean }> {
    return invoke("riot-api-key:save", value)
  },

  clearRiotApiKey(): Promise<{ configured: boolean }> {
    return invoke("riot-api-key:clear")
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

  getUpdateStatus(): Promise<UpdateStatus> {
    return invoke("app:update-status")
  },

  retryUpdate(): Promise<void> {
    return invoke("app:update-retry")
  },

  installUpdate(): Promise<boolean> {
    return invoke("app:update-install")
  },

  onUpdateStatus(listener: (status: UpdateStatus) => void) {
    ipc().on("app:update-status", (_event, status: UpdateStatus) => listener(status))
  },

  on(channel: string, listener: (...args: any[]) => void) {
    ipc().on(channel, (_event, ...args) => listener(...args))
  },
}

export type { AramStats, Challenge }
