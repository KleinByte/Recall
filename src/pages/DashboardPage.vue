<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import ChallengeDetailModal from "../components/ChallengeDetailModal.vue"
import FormStrip from "../components/FormStrip.vue"
import GradeBadge from "../components/GradeBadge.vue"
import RankGraph from "../components/RankGraph.vue"
import StyleRadar from "../components/StyleRadar.vue"
import MiniBar from "../components/ui/MiniBar.vue"
import Panel from "../components/ui/Panel.vue"
import StatTile from "../components/ui/StatTile.vue"
import { api } from "../helpers/api"
import { challengeTierProgress } from "../helpers/challenges"
import { openChampion, openMatch } from "../helpers/navigation"
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
  ProfileSummary,
  RankedHistory,
  StatsSummary,
  StyleProfile,
} from "../types/stats"

const props = defineProps<{
  champions: Champion[] | null
  connected: boolean
}>()

const QUEUE_LABELS: Record<string, string> = {
  RANKED_SOLO_5x5: "Solo/Duo",
  RANKED_FLEX_SR: "Flex",
  RANKED_PREMADE_5x5: "Flex",
}

/** Midnight this morning, in the player's own timezone. */
function startOfToday(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

const profile = ref<ProfileSummary | null>(null)
const summary = ref<StatsSummary | null>(null)
const session = ref<StatsSummary | null>(null)
const form = ref<boolean[]>([])
const challenges = ref<ChallengeRow[]>([])
const recent = ref<MatchRow[]>([])
const ranked = ref<RankedHistory[]>([])
const ranking = ref<ChampionRanking | null>(null)
const style = ref<StyleProfile | undefined>(undefined)
const styleFamily = ref<ModeFamily>("aram")
const selectedChallenge = ref<ChallengeRow | null>(null)

async function load() {
  try {
    const since = startOfToday()

    const [
      nextProfile,
      nextSummary,
      nextSession,
      nextForm,
      nextChallenges,
      nextRecent,
      nextRanked,
      nextRanking,
    ] = await Promise.all([
      api.getProfile(),
      api.getSummary({}),
      api.getSummary({ sinceMs: since }),
      api.getForm({}, 20),
      api.listChallenges({}),
      api.getMatches({}, 6),
      api.getRankedHistory(),
      api.getRankedChampions({}),
    ])

    profile.value = nextProfile
    summary.value = nextSummary
    session.value = nextSession
    form.value = nextForm
    challenges.value = nextChallenges
    recent.value = nextRecent
    ranked.value = nextRanked
    ranking.value = nextRanking

    await loadStyle()
  } catch {
    // No account seen yet; the empty states cover this.
  }
}

/** The playstyle snapshot follows whichever family has been played most. */
async function loadStyle() {
  const [rift, abyss] = await Promise.all([
    api.getSummary({ modeFamily: "sr" }),
    api.getSummary({ modeFamily: "aram" }),
  ])

  styleFamily.value = rift.games > abyss.games ? "sr" : "aram"

  const report = await api.getStyleReport(
    { modeFamily: styleFamily.value },
    styleFamily.value,
  )
  style.value = report.career
}

onMounted(() => {
  void load()
  api.on("stats:updated", () => void load())
  api.on("challenges:updated", () => void load())
  api.on("profile:updated", () => void load())
  api.on("ranked:updated", () => void load())
  api.on("lcu:status", () => void load())
})

const hasGames = computed(() => (summary.value?.games ?? 0) > 0)
const averageGrade = computed(() => gradeFromScore(summary.value?.avgGradeScore))

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

const rankedQueues = computed(() =>
  ranked.value
    .filter((entry) => QUEUE_LABELS[entry.queue] && entry.points.length > 0)
    .map((entry) => ({
      ...entry,
      label: QUEUE_LABELS[entry.queue],
      latest: entry.points[entry.points.length - 1],
    })),
)

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

      <Panel v-if="form.length" title="Recent form">
        <FormStrip :results="form" />
      </Panel>

      <section class="dashboard-columns">
        <div class="dashboard-column">
          <Panel
            v-if="rankedQueues.length"
            title="Rank"
            :meta="rankedQueues[0].latest.label"
          >
            <div v-for="queue in rankedQueues" :key="queue.queue" class="queue">
              <div class="queue-head">
                <span class="muted queue-label">{{ queue.label }}</span>
                <span class="numeric">
                  {{ queue.latest.label }} · {{ queue.latest.leaguePoints }} LP
                </span>
              </div>
              <RankGraph v-if="queue.points.length > 1" :points="queue.points" />
            </div>
          </Panel>

          <Panel v-if="recent.length" title="Recent games">
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

        <div class="dashboard-column">
          <Panel
            v-if="style"
            title="Playstyle"
            :meta="styleFamily === 'sr' ? `Summoner's Rift` : 'ARAM'"
          >
            <StyleRadar :axes="style.axes" />
          </Panel>

          <Panel
            v-if="ranking?.best.length"
            title="Champions in form"
            meta="Weighted by how much you have played them"
          >
            <ul class="champion-list">
              <li
                v-for="row in ranking.best"
                :key="row.championId"
                class="champion"
                @click="openChampion(row.championId)"
              >
                <img
                  :src="championIconUrl(row.championId)"
                  :alt="championName(row.championId)"
                  class="portrait"
                />
                <span class="champion-name">
                  {{ championName(row.championId) }}
                </span>
                <span class="muted numeric small">
                  {{ row.games }} games · {{ formatPercent(row.winRate) }}
                </span>
                <GradeBadge :grade="gradeFromScore(row.adjustedGrade)" />
              </li>
            </ul>
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
  align-items: start;
}

.dashboard-column {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-4);
}

.queue + .queue {
  margin-top: var(--space-4);
}

.queue-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 12px;
  margin-bottom: var(--space-2);
}

.queue-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1.2px;
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
  grid-template-columns: 26px 1fr auto auto;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
}

.champion:hover {
  background: var(--surface-2);
}

.champion:hover .champion-name {
  color: var(--gold);
}

.champion-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.portrait {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
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
  .dashboard-columns {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
