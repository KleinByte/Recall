<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import ChallengeDetailModal from "../components/ChallengeDetailModal.vue"
import FormStrip from "../components/FormStrip.vue"
import GradeBadge from "../components/GradeBadge.vue"
import MomentumGauge from "../components/MomentumGauge.vue"
import RankedHistoryPanel from "../components/RankedHistoryPanel.vue"
import PerformanceRadar from "../components/skill/PerformanceRadar.vue"
import MiniBar from "../components/ui/MiniBar.vue"
import Panel from "../components/ui/Panel.vue"
import StatTile from "../components/ui/StatTile.vue"
import { api } from "../helpers/api"
import { useApiEvents } from "../helpers/use-api-events"
import { useCoalescedTask } from "../helpers/use-coalesced-task"
import { challengeTierProgress } from "../helpers/challenges"
import { openChampion, openMatch } from "../helpers/navigation"
import { performanceMomentum } from "../helpers/momentum"
import {
  championIconUrl,
  championNameById,
  formatDecimal,
  formatDuration,
  formatPercent,
  formatRelativeDate,
  formatStreak,
  gradeFromScore,
  modeLabel,
} from "../helpers/format"
import type { Champion } from "../types/lol"
import type {
  CategoryProgress,
  ChallengeRow,
  ChampionRanking,
  MatchRow,
  ModeFamily,
  PerformanceProfile,
  ProfileSummary,
  RankedHistory,
  StatsSummary,
} from "../types/stats"

const props = defineProps<{
  champions: Champion[] | null
  connected: boolean
}>()
const events = useApiEvents()

/** Midnight this morning, in the player's own timezone. */
function startOfToday(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

const profile = ref<ProfileSummary | null>(null)
const summary = ref<StatsSummary | null>(null)
const session = ref<StatsSummary | null>(null)
const form = ref<MatchRow[]>([])
const challenges = ref<ChallengeRow[]>([])
const recent = ref<MatchRow[]>([])
const momentumMatches = ref<MatchRow[]>([])
const ranked = ref<RankedHistory[]>([])
const ranking = ref<ChampionRanking | null>(null)
const rviProfile = ref<PerformanceProfile | undefined>(undefined)
const rviFamily = ref<ModeFamily>("aram")
const selectedChallenge = ref<ChallengeRow | null>(null)
const momentumClock = ref(Date.now())
let momentumExpiryTimer: ReturnType<typeof setTimeout> | undefined

function scheduleMomentumExpiry(matches: MatchRow[]) {
  if (momentumExpiryTimer !== undefined) clearTimeout(momentumExpiryTimer)
  momentumExpiryTimer = undefined
  momentumClock.value = Date.now()
  const expiresAt = performanceMomentum(matches, momentumClock.value).sessionExpiresAt
  if (expiresAt === undefined || expiresAt <= momentumClock.value) return
  momentumExpiryTimer = setTimeout(() => {
    momentumExpiryTimer = undefined
    momentumClock.value = Date.now()
  }, expiresAt - momentumClock.value + 50)
}

onBeforeUnmount(() => {
  if (momentumExpiryTimer !== undefined) clearTimeout(momentumExpiryTimer)
})

async function loadStats() {
  const since = startOfToday()
  const [
    nextSummary,
    nextSession,
    nextForm,
    nextRecent,
    nextMomentumMatches,
    nextRanking,
  ] = await Promise.all([
      api.getSummary({}),
      api.getSummary({ sinceMs: since }),
      api.getMatches({}, 20),
      api.getMatches({}, 6),
      api.getMatches({}, 10),
      api.getRankedChampions({}),
  ])

  summary.value = nextSummary
  session.value = nextSession
  form.value = nextForm
  recent.value = nextRecent
  momentumMatches.value = nextMomentumMatches
  scheduleMomentumExpiry(nextMomentumMatches)
  ranking.value = nextRanking
  await loadRvi()
}

async function loadProfile() {
  profile.value = await api.getProfile()
}

async function loadChallenges() {
  challenges.value = await api.listChallenges({})
}

async function loadRanked() {
  ranked.value = await api.getRankedHistory()
}

async function loadAll() {
  await Promise.all([loadStats(), loadProfile(), loadChallenges(), loadRanked()])
}

/** The dashboard RVI snapshot follows whichever family has been played most. */
async function loadRvi() {
  const [rift, abyss, classic] = await Promise.all([
    api.getSummary({ modeFamily: "sr" }),
    api.getSummary({ modeFamily: "aram" }),
    api.getSummary({ modeFamily: "classic" }),
  ])

  rviFamily.value = [
    { family: "sr" as const, games: rift.games },
    { family: "aram" as const, games: abyss.games },
    { family: "classic" as const, games: classic.games },
  ].reduce((best, entry) => entry.games > best.games ? entry : best).family
  rviProfile.value = await api.getRviProfile(
    { modeFamily: rviFamily.value },
    rviFamily.value,
  )
}

type RefreshScope = "all" | "stats" | "profile" | "challenges" | "ranked"
const pendingRefreshes = new Set<RefreshScope>()
const refresh = useCoalescedTask(async () => {
  const scopes = new Set(pendingRefreshes)
  pendingRefreshes.clear()
  try {
    if (scopes.has("all")) {
      await loadAll()
      return
    }
    const tasks: Promise<void>[] = []
    if (scopes.has("stats")) tasks.push(loadStats())
    if (scopes.has("profile")) tasks.push(loadProfile())
    if (scopes.has("challenges")) tasks.push(loadChallenges())
    if (scopes.has("ranked")) tasks.push(loadRanked())
    await Promise.all(tasks)
  } catch {
    // No account seen yet; the empty states cover this.
  }
})

function queueRefresh(scope: RefreshScope) {
  pendingRefreshes.add(scope)
  void refresh()
}

onMounted(() => {
  queueRefresh("all")
  events.on("stats:updated", () => queueRefresh("stats"))
  events.on("challenges:updated", () => queueRefresh("challenges"))
  events.on("profile:updated", () => queueRefresh("profile"))
  events.on("ranked:updated", () => queueRefresh("ranked"))
})

const hasGames = computed(() => (summary.value?.games ?? 0) > 0)
const averageGrade = computed(() => gradeFromScore(summary.value?.avgGradeScore))
const momentum = computed(() => performanceMomentum(
  momentumMatches.value,
  momentumClock.value,
))
const recentFormWins = computed(() => form.value.filter((game) => game.win === 1).length)
const recentFormRate = computed(() => form.value.length
  ? recentFormWins.value / form.value.length
  : 0)

const confidenceLabel = (games: number) => {
  if (games >= 12) return "Strong read"
  if (games >= 5) return "Fair read"
  return "Early read"
}

const playedToday = computed(() => session.value?.games ?? 0)

/** League points won or lost since midnight, across the ranked queues. */
const lpToday = computed(() => {
  const since = startOfToday()
  let change = 0

  for (const queue of ranked.value) {
    const today = queue.points.filter((point) => point.recordedAt >= since)
    if (today.length < 2) continue
    change += today[today.length - 1].points - today[0].points
  }

  return change
})

const sessionTime = computed(() => {
  const seconds = (session.value?.avgDurationSecs ?? 0) * playedToday.value
  return seconds > 0 ? formatDuration(seconds) : "–"
})

const categories = computed<CategoryProgress[]>(() => {
  const raw = profile.value?.challenges?.categoryJson
  if (!raw) return []
  try {
    return JSON.parse(raw) as CategoryProgress[]
  } catch {
    return []
  }
})

/**
 * Challenges closest to their next tier.
 *
 * Retired challenges are excluded because no amount of play advances them.
 */
const nearlyThere = computed(() =>
  challenges.value
    .filter(
      (challenge) =>
        challenge.category !== "LEGACY" &&
        challenge.isRetired === 0 &&
        challenge.nextThreshold !== null &&
        challenge.nextThreshold > challenge.currentValue,
    )
    .map((challenge) => ({
      ...challenge,
      remaining: challenge.nextThreshold! - challenge.currentValue,
      progress: challengeTierProgress(challenge),
    }))
    .sort((a, b) => b.progress - a.progress)
    .slice(0, 6),
)

const championName = (id: number) => championNameById(props.champions, id)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>Dashboard</h1>
        <p class="muted subtitle">
          Everything Recall has recorded, across every tracked mode.
        </p>
      </div>

      <div v-if="profile?.challenges" class="overall">
        <div class="overall-level">{{ profile.challenges.overallLevel }}</div>
        <div class="muted overall-meta">
          {{ profile.challenges.totalScore.toLocaleString() }} points
          <span v-if="profile.challenges.percentile !== null">
            · top {{ formatDecimal(profile.challenges.percentile) }}%
          </span>
        </div>
      </div>
    </header>

    <div v-if="!connected && !hasGames" class="card notice">
      <h2 class="section-title">League client not detected</h2>
      <p class="muted">
        Start the client to record games and challenge progress. Anything
        already recorded stays saved.
      </p>
    </div>

    <template v-if="hasGames">
      <section class="kpis">
        <StatTile
          label="Today"
          :value="playedToday ? `${session!.wins}W ${session!.losses}L` : '–'"
          :hint="playedToday ? `${playedToday} games · ${sessionTime}` : 'No games yet today'"
          :tone="playedToday && session!.winRate >= 0.5 ? 'win' : playedToday ? 'loss' : 'neutral'"
        />
        <StatTile
          label="LP today"
          :value="lpToday === 0 ? '–' : `${lpToday > 0 ? '+' : ''}${lpToday}`"
          :tone="lpToday > 0 ? 'win' : lpToday < 0 ? 'loss' : 'neutral'"
        />
        <StatTile
          label="Streak"
          :value="formatStreak(summary!.currentStreak)"
          :tone="summary!.currentStreak >= 0 ? 'win' : 'loss'"
          :hint="`best ${summary!.longestWinStreak}`"
        />
        <StatTile
          label="Games recorded"
          :value="summary!.games.toString()"
          :hint="`${summary!.wins}W · ${summary!.losses}L`"
        />
        <StatTile
          label="Win rate"
          :value="formatPercent(summary!.winRate)"
          :tone="summary!.winRate >= 0.5 ? 'win' : 'loss'"
        />
        <StatTile label="KDA" :value="formatDecimal(summary!.kda, 2)" />
        <StatTile
          label="Avg grade"
          :value="averageGrade ?? '–'"
          :hint="`${summary!.gradedGames} graded`"
        />
      </section>

      <section v-if="form.length" class="form-momentum-grid">
        <Panel title="Recent form" :meta="`${form.length} games`" class="form-panel">
          <div class="form-summary">
            <div>
              <strong>{{ recentFormWins }}W · {{ form.length - recentFormWins }}L</strong>
              <span class="muted">Oldest to newest · hover for detail</span>
            </div>
            <strong class="form-rate">{{ formatPercent(recentFormRate) }}</strong>
          </div>
          <FormStrip :matches="form" :champions="champions" />
        </Panel>

        <Panel title="The Dial" :meta="momentum.label" class="momentum-panel">
          <MomentumGauge
            :score="momentum.score"
            :label="momentum.label"
            :streak="momentum.streak"
            :overdrive-tier="momentum.overdriveTier"
          />
        </Panel>
      </section>

      <section class="dashboard-columns">
        <div class="dashboard-column left-column">
          <RankedHistoryPanel
            v-if="ranked.length"
            :histories="ranked"
            class="rank-panel"
          />

          <Panel v-if="recent.length" title="Recent games" class="recent-panel">
            <ul class="game-list">
              <li
                v-for="game in recent"
                :key="game.gameId"
                class="game"
                :class="game.win ? 'won' : 'lost'"
                @click="openMatch(game)"
              >
                <GradeBadge :grade="game.grade" />
                <img
                  :src="championIconUrl(game.championId)"
                  :alt="championName(game.championId)"
                  class="portrait"
                />
                <div class="game-body">
                  <div class="game-name">{{ championName(game.championId) }}</div>
                  <div class="muted game-meta">
                    {{ game.queueName ?? modeLabel(game.mode) }} ·
                    {{ formatDuration(game.durationSecs) }}
                  </div>
                </div>
                <div class="numeric game-kda">
                  {{ game.kills }}/{{ game.deaths }}/{{ game.assists }}
                </div>
                <div class="muted game-date">
                  {{ formatRelativeDate(game.playedAt) }}
                </div>
              </li>
            </ul>
          </Panel>
        </div>

        <div class="dashboard-column right-column">
          <Panel
            v-if="rviProfile"
            title="Recall Vector Index"
            :meta="`${rviProfile.score} · ${rviFamily === 'sr' ? `Summoner's Rift` : rviFamily === 'classic' ? 'League Classic' : 'ARAM'}`"
            class="rvi-panel"
          >
            <PerformanceRadar :dimensions="rviProfile.dimensions" height="270px" />
          </Panel>

          <Panel
            v-if="ranking?.best.length"
            title="Champions in form"
            meta="Performance adjusted for sample size"
            class="champions-panel"
          >
            <p class="muted champion-intro">
              Your strongest Recall grades, with one-game standouts pulled
              back toward your usual performance.
            </p>
            <ol class="champion-list">
              <li v-for="(row, index) in ranking.best" :key="row.championId">
                <button
                  type="button"
                  class="champion"
                  @click="openChampion(row.championId)"
                >
                  <span class="numeric champion-rank">{{ index + 1 }}</span>
                  <img
                    :src="championIconUrl(row.championId)"
                    :alt="championName(row.championId)"
                    class="portrait"
                  />
                  <span class="champion-copy">
                    <strong class="champion-name">{{ championName(row.championId) }}</strong>
                    <span class="muted champion-evidence">
                      {{ confidenceLabel(row.gradedGames) }} · {{ row.gradedGames }} graded
                    </span>
                  </span>
                  <span class="champion-stats">
                    <span>
                      <strong class="numeric">{{ row.games }}</strong>
                      <small>games</small>
                    </span>
                    <span>
                      <strong
                        class="numeric"
                        :class="row.winRate >= 0.5 ? 'win-text' : 'loss-text'"
                      >{{ formatPercent(row.winRate) }}</strong>
                      <small>win rate</small>
                    </span>
                    <span>
                      <strong class="numeric">{{ formatDecimal(row.kda, 2) }}</strong>
                      <small>KDA</small>
                    </span>
                  </span>
                  <GradeBadge :grade="gradeFromScore(row.adjustedGrade)" size="lg" />
                </button>
              </li>
            </ol>
            <p class="muted champion-footnote">Open a champion for its full breakdown.</p>
          </Panel>
        </div>
      </section>
    </template>

    <Panel v-if="categories.length" title="Challenge categories">
      <div class="categories">
        <div v-for="entry in categories" :key="entry.category" class="category">
          <div class="category-head">
            <span class="category-name">{{ entry.category }}</span>
            <span class="muted numeric small">
              {{ entry.current.toLocaleString() }} /
              {{ entry.max.toLocaleString() }}
            </span>
          </div>
          <MiniBar :value="entry.current / Math.max(1, entry.max)" />
          <div class="muted category-foot">
            {{ entry.level }} · top {{ formatDecimal(entry.positionPercentile) }}%
          </div>
        </div>
      </div>
    </Panel>

    <Panel v-if="nearlyThere.length" title="Closest to the next tier">
      <div class="near-list">
        <button
          v-for="entry in nearlyThere"
          :key="entry.challengeId"
          class="near"
          :title="`View details for ${entry.name}`"
          @click="selectedChallenge = entry"
        >
          <GradeBadge :grade="entry.currentLevel.slice(0, 1)" />
          <div class="near-body">
            <div class="near-name">{{ entry.name }}</div>
            <MiniBar :value="entry.progress" />
          </div>
          <div class="muted numeric small">
            {{ formatDecimal(entry.remaining, 0) }} to go
          </div>
        </button>
      </div>
    </Panel>

    <ChallengeDetailModal
      v-if="selectedChallenge"
      :challenge="selectedChallenge"
      @close="selectedChallenge = null"
    />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-5);
  flex-wrap: wrap;
}

h1 {
  font-family: var(--font-display);
  font-size: 22px;
  letter-spacing: 1px;
  margin: 0;
  color: var(--gold-bright);
}

.subtitle {
  margin: var(--space-1) 0 0;
  font-size: 12px;
}

.overall {
  text-align: right;
}

.overall-level {
  font-family: var(--font-display);
  font-size: 20px;
  color: var(--gold);
  letter-spacing: 1px;
}

.overall-meta {
  font-size: 12px;
}

.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(138px, 1fr));
  grid-auto-rows: 1fr;
  gap: var(--space-3);
}

.dashboard-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  align-items: stretch;
}

.form-momentum-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(270px, .8fr);
  gap: var(--space-4);
  align-items: stretch;
}

.form-panel,
.momentum-panel {
  height: 204px;
  box-sizing: border-box;
  overflow: hidden;
}

.momentum-panel :deep(.head) {
  position: relative;
  z-index: 6;
}

.form-summary {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.form-summary > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.form-summary > div > strong,
.form-rate {
  color: var(--gold-bright);
  font: 19px var(--font-display);
  letter-spacing: .5px;
}

.form-summary span {
  font-size: 12px;
}

.form-rate {
  color: var(--win);
  font-size: 23px;
}

.dashboard-column {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  gap: var(--space-4);
}

.rank-panel,
.rvi-panel {
  height: 340px;
}

.recent-panel,
.champions-panel {
  height: 100%;
}

.game-list,
.champion-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.game {
  display: grid;
  grid-template-columns: 34px 28px 1fr auto auto;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  border-left: 2px solid transparent;
  cursor: pointer;
  font-size: 12px;
}

.game.won {
  border-left-color: var(--win);
}

.game.lost {
  border-left-color: var(--loss);
}

.game:hover {
  background: var(--surface-2);
}

.game:hover .game-name {
  color: var(--gold);
}

.game-name {
  font-size: 13px;
}

.game-meta,
.game-date {
  font-size: 11px;
}

.game-kda {
  color: var(--text-primary);
}

.champion {
  display: grid;
  grid-template-columns: 18px 42px minmax(84px, 1fr) minmax(168px, 1.2fr) 54px;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2);
  background: linear-gradient(105deg, var(--surface-2), rgba(20, 36, 61, .45));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
}

.champion:hover {
  border-color: var(--border-strong);
  background: linear-gradient(105deg, var(--surface-3), var(--surface-2));
}

.champion:hover .champion-name {
  color: var(--gold);
}

.champion-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.champion-list {
  gap: var(--space-2);
}

.champion-list > li {
  min-width: 0;
}

.champion-intro,
.champion-footnote {
  font-size: 11px;
}

.champion-intro {
  margin: 0 0 var(--space-3);
  max-width: 66ch;
}

.champion-footnote {
  margin: var(--space-3) 0 0;
  text-align: right;
}

.champion-rank {
  color: var(--gold);
  font-size: 14px;
  text-align: center;
}

.champion-copy {
  min-width: 0;
}

.champion-evidence {
  display: block;
  margin-top: 2px;
  font-size: 12px;
}

.champion-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(54px, 1fr));
  gap: var(--space-1);
}

.champion-stats > span {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  padding-right: var(--space-2);
  border-right: 1px solid var(--border-subtle);
}

.champion-stats strong {
  color: var(--text-primary);
  font-size: 13px;
}

.champion-stats strong.win-text {
  color: var(--win);
}

.champion-stats strong.loss-text {
  color: var(--loss);
}

.champion-stats small {
  color: var(--text-muted);
  font-size: 11px;
  letter-spacing: .5px;
  text-transform: uppercase;
}

.portrait {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

.champion .portrait {
  width: 42px;
  height: 42px;
}

.small {
  font-size: 11px;
}

.categories {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  grid-auto-rows: 1fr;
  gap: var(--space-4);
}

.category-head {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: var(--space-2);
}

.category-foot {
  font-size: 11px;
  margin-top: var(--space-1);
}

.near-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  grid-auto-rows: 1fr;
  gap: var(--space-3);
}

.near {
  display: grid;
  grid-template-columns: 34px 1fr auto;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  padding: var(--space-2);
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.near:hover {
  background: var(--surface-2);
  border-color: var(--border-subtle);
}

.near:hover .near-name {
  color: var(--gold);
}

.near-name {
  font-size: 13px;
  margin-bottom: var(--space-1);
}

.notice {
  max-width: 60ch;
}

@media (max-width: 820px) {
  .form-momentum-grid {
    grid-template-columns: minmax(0, 1.25fr) minmax(250px, .75fr);
  }

  .dashboard-columns {
    grid-template-columns: minmax(0, 1fr);
  }

  .dashboard-column {
    grid-template-rows: auto;
  }

  .rank-panel,
  .rvi-panel {
    height: auto;
    min-height: 340px;
  }
}

@media (max-width: 620px) {
  .form-momentum-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .form-panel,
  .momentum-panel {
    height: auto;
    min-height: 190px;
  }

  .champion {
    grid-template-columns: 18px 42px minmax(0, 1fr) 54px;
  }

  .champion-stats {
    grid-column: 2 / -1;
  }
}
</style>
