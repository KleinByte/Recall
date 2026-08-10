<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import ChallengeDetailModal from "../components/ChallengeDetailModal.vue"
import FormStrip from "../components/FormStrip.vue"
import GradeBadge from "../components/GradeBadge.vue"
import MomentumGauge from "../components/MomentumGauge.vue"
import RankedHistoryPanel from "../components/RankedHistoryPanel.vue"
import PerformanceRadar from "../components/skill/PerformanceRadar.vue"
import EmptyState from "../components/ui/EmptyState.vue"
import MiniBar from "../components/ui/MiniBar.vue"
import Panel from "../components/ui/Panel.vue"
import TelemetryBoard from "../components/ui/TelemetryBoard.vue"
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
  modeLabel,
} from "../helpers/format"
import { recallGradeFromRoleFitScore } from "../shared/recall-grade"
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
const averageGrade = computed(() => recallGradeFromRoleFitScore(summary.value?.avgRoleFitScore))
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

type TelemetryReading = {
  label: string
  value: string
  hint?: string
  tone?: "win" | "loss"
}

const sessionTelemetry = computed<TelemetryReading[]>(() => [
  {
    label: "Today",
    value: playedToday.value ? `${session.value!.wins}W ${session.value!.losses}L` : "–",
    hint: playedToday.value ? `${playedToday.value} games · ${sessionTime.value}` : "No games yet",
    tone: playedToday.value
      ? session.value!.winRate >= 0.5 ? "win" : "loss"
      : undefined,
  },
  {
    label: "LP today",
    value: lpToday.value === 0 ? "–" : `${lpToday.value > 0 ? "+" : ""}${lpToday.value}`,
    tone: lpToday.value > 0 ? "win" : lpToday.value < 0 ? "loss" : undefined,
  },
  {
    label: "Streak",
    value: formatStreak(summary.value!.currentStreak),
    hint: `Best ${summary.value!.longestWinStreak}`,
    tone: summary.value!.currentStreak >= 0 ? "win" : "loss",
  },
])

const archiveTelemetry = computed<TelemetryReading[]>(() => [
  {
    label: "Games",
    value: summary.value!.games.toString(),
    hint: `${summary.value!.wins}W · ${summary.value!.losses}L`,
  },
  {
    label: "Win rate",
    value: formatPercent(summary.value!.winRate),
    tone: summary.value!.winRate >= 0.5 ? "win" : "loss",
  },
  { label: "KDA", value: formatDecimal(summary.value!.kda, 2) },
  {
    label: "Avg RoleFit",
    value: summary.value!.avgRoleFitScore?.toFixed(1) ?? "–",
    hint: `${averageGrade.value ?? "No grade"} · ${summary.value!.gradedGames} graded`,
  },
])

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
    <header class="page-head dashboard-hero">
      <div class="hero-copy">
        <span class="hero-kicker">Recall performance archive</span>
        <h1>Performance dashboard</h1>
        <p class="muted subtitle">
          Your current form, long-term profile, and next objectives in one command deck.
        </p>
      </div>

      <div v-if="profile?.challenges" class="overall">
        <span class="overall-kicker">Challenge standing</span>
        <div class="overall-readout">
          <div class="overall-level">{{ profile.challenges.overallLevel }}</div>
          <div class="muted overall-meta">
            {{ profile.challenges.totalScore.toLocaleString() }} points
            <span v-if="profile.challenges.percentile !== null">
              · top {{ formatDecimal(profile.challenges.percentile) }}%
            </span>
          </div>
        </div>
      </div>
    </header>

    <EmptyState
      v-if="!connected && !hasGames"
      class="notice"
      title="League client not detected"
      description="Start the client to record games and challenge progress. Anything already recorded stays saved."
    />

    <template v-if="hasGames">
      <section class="status-deck" aria-labelledby="status-deck-title">
        <header class="deck-heading">
          <div>
            <span class="deck-kicker">Current readings</span>
            <h2 id="status-deck-title">Performance telemetry</h2>
          </div>
          <span class="muted">Live session and all recorded games</span>
        </header>
        <TelemetryBoard
          label="Current and recorded performance readings"
          :banks="[
            { label: 'Session', readings: sessionTelemetry },
            { label: 'Archive', readings: archiveTelemetry },
          ]"
        />
      </section>

      <section v-if="form.length" class="form-momentum-grid">
        <Panel title="The Dial" :meta="momentum.label" class="momentum-panel">
          <span v-for="corner in ['tl', 'tr', 'bl', 'br']" :key="corner" class="corner-brace" :class="corner" aria-hidden="true" />
          <MomentumGauge
            :score="momentum.score"
            :label="momentum.label"
            :streak="momentum.streak"
            :overdrive-tier="momentum.overdriveTier"
          />
        </Panel>

        <Panel title="Recent form" :meta="`${form.length} games`" class="dashboard-panel form-panel">
          <div class="form-summary">
            <div>
              <strong>{{ recentFormWins }}W · {{ form.length - recentFormWins }}L</strong>
              <span class="muted">Oldest to newest · hover for detail</span>
            </div>
            <strong class="form-rate">{{ formatPercent(recentFormRate) }}</strong>
          </div>
          <FormStrip :matches="form" :champions="champions" />
        </Panel>
      </section>

      <section class="dashboard-grid" aria-label="Performance analysis">
        <RankedHistoryPanel
          v-if="ranked.length"
          :histories="ranked"
          class="dashboard-panel rank-panel"
        />

        <Panel
          v-if="rviProfile"
          title="Recall Vector Index"
          :meta="`${rviProfile.score} · ${rviFamily === 'sr' ? `Summoner's Rift` : rviFamily === 'classic' ? 'League Classic' : 'ARAM'}`"
          class="dashboard-panel rvi-panel"
        >
          <PerformanceRadar :dimensions="rviProfile.dimensions" height="270px" />
        </Panel>

        <Panel v-if="recent.length" title="Recent games" class="dashboard-panel recent-panel">
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

        <Panel
            v-if="ranking?.best.length"
            title="Champions in form"
            meta="Performance adjusted for sample size"
            class="dashboard-panel champions-panel"
          >
            <p class="muted champion-intro">
              Your highest average RoleFit among champions with at least five graded games.
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
                  <span class="champion-grade">
                    <GradeBadge :grade="recallGradeFromRoleFitScore(row.roleFitScore)" size="lg" />
                  </span>
                </button>
              </li>
            </ol>
            <p class="muted champion-footnote">Open a champion for its full breakdown.</p>
        </Panel>

      </section>
    </template>

    <section v-if="categories.length || nearlyThere.length" class="challenge-deck" aria-labelledby="challenge-deck-title">
      <header class="deck-heading">
        <div>
          <span class="deck-kicker">Progression archive</span>
          <h2 id="challenge-deck-title">Challenge objectives</h2>
        </div>
        <span class="muted">Long-term progress and nearest upgrades</span>
      </header>
      <div class="challenge-grid">
        <Panel v-if="categories.length" title="Challenge categories" class="dashboard-panel categories-panel">
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

        <Panel v-if="nearlyThere.length" title="Closest to the next tier" class="dashboard-panel near-panel">
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
      </div>
    </section>

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
  gap: clamp(var(--space-4), 2vw, var(--space-5));
}

.page-head {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-5);
  flex-wrap: wrap;
}

.dashboard-hero {
  min-height: 104px;
  padding: 18px 20px !important;
  overflow: hidden;
  border: 1px solid var(--instrument-border-soft) !important;
  border-radius: var(--radius-md);
  background:
    linear-gradient(90deg, rgba(200, 170, 109, .05), transparent 38%),
    var(--instrument-surface);
  box-shadow: 0 12px 28px rgba(0, 0, 0, .2);
}

.dashboard-hero::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: linear-gradient(180deg, transparent, var(--dial-metal-500) 28% 72%, transparent);
}

.dashboard-hero::after {
  content: "";
  position: absolute;
  right: -70px;
  bottom: -105px;
  width: 260px;
  height: 180px;
  border: 1px solid rgba(200, 170, 109, .07);
  transform: rotate(-30deg);
  pointer-events: none;
}

.hero-copy { min-width: 0; }
.hero-kicker,
.deck-kicker,
.overall-kicker {
  color: var(--dial-readout-muted);
  font: 10px var(--font-heading);
  letter-spacing: 1.7px;
  text-transform: uppercase;
}

h1 {
  font-family: var(--font-display);
  font-size: clamp(24px, 2.4vw, 32px);
  line-height: 1.05;
  letter-spacing: .8px;
  margin: 3px 0 0;
  color: var(--gold-bright);
}

.subtitle {
  max-width: 66ch;
  margin: 6px 0 0;
  font-size: 13px;
}

.overall {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
  min-width: 190px;
  padding: 10px 13px;
  border: 1px solid var(--instrument-border-soft);
  border-right-color: var(--instrument-border-strong);
  border-radius: var(--radius-sm);
  background: rgba(6, 13, 22, .5);
  text-align: right;
}

.overall-readout { display: flex; align-items: baseline; justify-content: flex-end; gap: 10px; }
.overall-level {
  font-family: var(--font-display);
  font-size: 24px;
  line-height: 1;
  color: var(--instrument-title);
  letter-spacing: .7px;
}

.overall-meta {
  max-width: 130px;
  font-size: 11px;
  line-height: 1.3;
}

.status-deck,
.challenge-deck {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.deck-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 0 3px 8px;
  border-bottom: 1px solid var(--ui-divider);
}

.deck-heading h2 {
  margin: 2px 0 0;
  color: var(--ui-text-heading);
  font: 15px var(--font-heading);
  letter-spacing: 1.2px;
  text-transform: uppercase;
}

.deck-heading > span { font-size: 11px; text-align: right; }

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  align-items: stretch;
}

.form-momentum-grid {
  display: grid;
  grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
  gap: var(--space-4);
  align-items: stretch;
}

.form-panel,
.momentum-panel {
  height: 220px;
  box-sizing: border-box;
  overflow: hidden;
}

.dashboard-panel {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border-color: var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface-panel-quiet);
  box-shadow: var(--ui-shadow-panel);
}

.dashboard-panel::before {
  content: "";
  position: absolute;
  z-index: 1;
  inset: 0 22% auto;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--ui-border-emphasis), transparent);
  pointer-events: none;
}

.dashboard-panel :deep(.head) {
  align-items: center;
  min-height: 29px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--ui-divider);
}

.dashboard-panel :deep(.section-title) {
  color: var(--ui-text-heading);
  letter-spacing: 1.65px;
}

.dashboard-panel :deep(.meta) { color: var(--ui-text-muted); }

/* Hextech reliquary plate: chamfered gold frame over an engraved hex lattice. */
.momentum-panel {
  --chamfer: var(--instrument-chamfer-md);
  position: relative;
  isolation: isolate;
  padding: 12px 16px 15px;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: var(--instrument-shadow-raised);
  clip-path: polygon(
    var(--chamfer) 0, calc(100% - var(--chamfer)) 0, 100% var(--chamfer),
    100% calc(100% - var(--chamfer)), calc(100% - var(--chamfer)) 100%,
    var(--chamfer) 100%, 0 calc(100% - var(--chamfer)), 0 var(--chamfer)
  );
}

.momentum-panel::before {
  content: "";
  position: absolute;
  z-index: -2;
  inset: 0;
  background: var(--instrument-frame);
}

.momentum-panel::after {
  content: "";
  position: absolute;
  z-index: -1;
  inset: 1.4px;
  clip-path: polygon(
    15px 0, calc(100% - 15px) 0, 100% 15px,
    100% calc(100% - 15px), calc(100% - 15px) 100%,
    15px 100%, 0 calc(100% - 15px), 0 15px
  );
  background:
    var(--instrument-surface-energized),
    var(--instrument-lattice),
    var(--instrument-lattice-reverse),
    var(--instrument-surface);
}

.momentum-panel .corner-brace {
  position: absolute;
  z-index: 5;
  width: 24px;
  height: 24px;
  background: linear-gradient(135deg, transparent 11.5px, var(--instrument-border-strong) 12px, var(--instrument-border-strong) 13.2px, transparent 13.8px);
  pointer-events: none;
}

.momentum-panel .corner-brace.tl { top: 4px; left: 4px; }
.momentum-panel .corner-brace.tr { top: 4px; right: 4px; transform: scaleX(-1); }
.momentum-panel .corner-brace.bl { bottom: 4px; left: 4px; transform: scaleY(-1); }
.momentum-panel .corner-brace.br { bottom: 4px; right: 4px; transform: scale(-1); }

.momentum-panel :deep(.head) {
  position: relative;
  z-index: 6;
  justify-content: center;
  margin-bottom: 12px;
}

/* The gauge shows its own label; the plaque only carries the title. */
.momentum-panel :deep(.head .meta) {
  display: none;
}

.momentum-panel :deep(.section-title) {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: var(--instrument-title);
  font-size: 12px;
  letter-spacing: 2.4px;
  text-transform: uppercase;
}

.momentum-panel :deep(.section-title)::before,
.momentum-panel :deep(.section-title)::after {
  content: "";
  flex: none;
  width: 36px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--instrument-border-strong));
}

.momentum-panel :deep(.section-title)::after {
  background: linear-gradient(270deg, transparent, var(--instrument-border-strong));
}

/* Engraved divider under the plaque, anchored by a nexus-crystal stud. */
.momentum-panel :deep(.head)::after {
  content: "";
  position: absolute;
  right: 10%;
  bottom: -6px;
  left: 10%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--instrument-border) 22%, var(--instrument-border) 78%, transparent);
}

.momentum-panel :deep(.head)::before {
  content: "";
  position: absolute;
  bottom: -10.5px;
  left: 50%;
  width: 9px;
  height: 9px;
  border: 1px solid var(--dial-metal-300);
  background: radial-gradient(circle at 32% 28%, var(--dial-energy-100) 0 14%, var(--dial-energy-400) 36%, var(--dial-energy-600) 64%, var(--dial-energy-800));
  box-shadow: var(--instrument-shadow-energy);
  transform: translateX(-50%) rotate(45deg);
}

.form-summary {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
  padding: 2px 2px 10px;
  border-bottom: 1px solid rgba(200, 170, 109, .1);
}

.form-summary > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.form-summary > div > strong,
.form-rate {
  color: var(--instrument-title);
  font: 19px var(--font-display);
  letter-spacing: .5px;
}

.form-summary span {
  font-size: 12px;
}

.form-rate {
  color: var(--instrument-energy);
  font-size: 23px;
}

.rank-panel,
.rvi-panel {
  height: 360px;
}

.recent-panel,
.champions-panel {
  min-height: 0;
}

.champions-panel {
  container-type: inline-size;
}

.game-list,
.champion-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.game {
  position: relative;
  display: grid;
  grid-template-columns: 34px 28px 1fr auto auto;
  align-items: center;
  gap: var(--space-3);
  min-height: 48px;
  padding: 7px 9px;
  overflow: hidden;
  border: 1px solid rgba(200, 170, 109, .1);
  border-radius: var(--radius-sm);
  background: rgba(6, 13, 22, .36);
  cursor: pointer;
  font-size: 12px;
  transition: border-color var(--instrument-motion-fast) ease, background var(--instrument-motion-fast) ease;
}

.game::before {
  content: "";
  position: absolute;
  inset: 7px auto 7px 0;
  width: 2px;
  background: transparent;
}

.game.won {
  --game-state: var(--win);
}

.game.lost {
  --game-state: var(--loss);
}

.game.won::before,
.game.lost::before { background: var(--game-state); }

.game:hover {
  border-color: var(--instrument-border-soft);
  background: rgba(23, 64, 92, .2);
}

.game:hover .game-name {
  color: var(--gold);
}

.game-name {
  color: var(--text-primary);
  font: 13px var(--font-heading);
}

.game-meta,
.game-date {
  font-size: 11px;
}

.game-kda {
  color: var(--instrument-title);
}

.champion {
  position: relative;
  display: grid;
  grid-template-columns: 18px 42px minmax(0, 1fr) 52px;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2);
  overflow: hidden;
  background: linear-gradient(105deg, rgba(14, 26, 42, .88), rgba(6, 13, 22, .54));
  border: 1px solid rgba(200, 170, 109, .13);
  border-radius: var(--radius-sm);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  transition: border-color var(--instrument-motion-fast) ease, background var(--instrument-motion-fast) ease;
}

.champion:hover {
  border-color: var(--instrument-border);
  background: linear-gradient(105deg, rgba(23, 64, 92, .38), rgba(14, 26, 42, .8));
}

.champion:hover .champion-name {
  color: var(--gold);
}

.champion-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-family: var(--font-heading);
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
  color: var(--instrument-title);
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
  grid-column: 3 / -1;
  gap: var(--space-1);
}

.champion-grade {
  grid-column: 4;
  grid-row: 1;
  justify-self: end;
}

.champion-stats > span {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  padding-right: var(--space-2);
  border-right: 1px solid var(--instrument-border-soft);
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
  border: 1px solid var(--instrument-border-soft);
  object-fit: cover;
}

.champion .portrait {
  width: 42px;
  height: 42px;
}

@container (min-width: 650px) {
  .champion {
    grid-template-columns: 18px 42px minmax(84px, 1fr) minmax(168px, 1.2fr) 54px;
  }

  .champion-stats,
  .champion-grade {
    grid-column: auto;
    grid-row: auto;
  }
}

@container (max-width: 430px) {
  .champion { grid-template-columns: 18px 36px minmax(0, 1fr) 44px; }
  .champion .portrait { width: 36px; height: 36px; }
  .champion-stats { grid-column: 1 / -1; }
}

.small {
  font-size: 11px;
}

.challenge-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(340px, .9fr);
  gap: var(--space-4);
  align-items: stretch;
}

.categories-panel,
.near-panel { min-height: 0; }

.categories {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
  grid-auto-rows: 1fr;
  gap: 9px;
}

.category {
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(200, 170, 109, .11);
  border-radius: var(--radius-sm);
  background: rgba(6, 13, 22, .34);
}

.category-head {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: 12px;
  margin-bottom: var(--space-2);
}

.category-name { color: var(--text-primary); font-family: var(--font-heading); }

.category-foot {
  font-size: 11px;
  margin-top: var(--space-1);
}

.near-list {
  display: grid;
  grid-template-columns: 1fr;
  grid-auto-rows: 1fr;
  gap: 7px;
}

.near {
  position: relative;
  display: grid;
  grid-template-columns: 34px 1fr auto;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  overflow: hidden;
  background: rgba(6, 13, 22, .34);
  border: 1px solid rgba(200, 170, 109, .11);
  border-radius: var(--radius-sm);
  padding: 9px;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.near:hover {
  background: rgba(23, 64, 92, .22);
  border-color: var(--instrument-border);
}

.near:hover .near-name {
  color: var(--gold);
}

.near-name {
  color: var(--text-primary);
  font: 13px var(--font-heading);
  margin-bottom: var(--space-1);
}

.notice {
  max-width: 60ch;
}

@media (max-width: 1100px) {
  .challenge-grid { grid-template-columns: 1fr; }
}

@media (max-width: 980px) {
  .dashboard-grid { grid-template-columns: minmax(0, 1fr); }

  .rank-panel,
  .rvi-panel {
    height: auto;
    min-height: 360px;
  }
}

@media (max-width: 760px) {
  .form-momentum-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .form-panel,
  .momentum-panel {
    height: auto;
    min-height: 210px;
  }

  .deck-heading { align-items: flex-start; flex-direction: column; gap: 4px; }
  .deck-heading > span { text-align: left; }
}

@media (max-width: 620px) {
  .game { grid-template-columns: 34px 28px minmax(0, 1fr) auto; gap: var(--space-2); }
  .game-date { display: none; }

  .dashboard-hero { align-items: flex-start; padding: 16px !important; }
  .overall { width: 100%; align-items: flex-start; text-align: left; }
  .overall-readout { justify-content: flex-start; }
  .overall-meta { max-width: none; }
}

@media (max-width: 500px) {
  .near { grid-template-columns: 34px minmax(0, 1fr); }
  .near > .small { grid-column: 2; }
}

</style>
