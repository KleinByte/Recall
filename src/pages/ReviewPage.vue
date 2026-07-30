<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { api } from "../helpers/api"
import {
  championIconUrl,
  championNameById,
  formatDuration,
  modeLabel,
} from "../helpers/format"
import { focusReviewGameId } from "../helpers/navigation"
import GradeBadge from "../components/GradeBadge.vue"
import type { Champion } from "../types/lol"
import type { MatchRow } from "../types/stats"
import type { TrackedMode } from "../types/stats"
import type {
  AnnotationTag,
  ExperimentOutcomeValue,
  MatchReview,
  PracticeExperiment,
  ReviewSession,
} from "../types/review"

const props = defineProps<{ champions: Champion[] | null }>()
type Tab = "review" | "sessions" | "bookmarks" | "experiments"
const tab = ref<Tab>("review")
const review = ref<MatchReview>()
const sessions = ref<ReviewSession[]>([])
const tags = ref<AnnotationTag[]>([])
const experiments = ref<PracticeExperiment[]>([])
const bookmarks = ref<MatchRow[]>([])
const busy = ref(false)
const error = ref("")
const newTag = ref("")
const experimentName = ref("")
const experimentHypothesis = ref("")
const experimentChampionIds = ref<number[]>([])
const experimentModes = ref<TrackedMode[]>([])
const timelineFilter = ref<"all" | "you" | "kills" | "objectives" | "items">("all")
let saveTimer: ReturnType<typeof setTimeout> | undefined

const owner = computed(() =>
  review.value?.scoreboard.find((participant) => participant.isPlayer === 1),
)
const timelinePoints = computed(() => {
  const frames = review.value?.timeline.summary?.frames ?? []
  if (frames.length < 2) return ""
  const differences = frames.map((frame) => frame.blueGold - frame.redGold)
  const max = Math.max(1_000, ...differences.map(Math.abs))
  return differences.map((difference, index) =>
    `${index * 100 / (differences.length - 1)},${50 - difference * 42 / max}`,
  ).join(" ")
})
const filteredTimelineEvents = computed(() => {
  const events = review.value?.timeline.summary?.events ?? []
  if (timelineFilter.value === "all") return events
  if (timelineFilter.value === "you") {
    return events.filter((event) =>
      event.participantId === owner.value?.participantId ||
      event.targetId === owner.value?.participantId ||
      event.assistingParticipantIds?.includes(owner.value?.participantId ?? -1),
    )
  }
  if (timelineFilter.value === "kills") {
    return events.filter((event) => event.type === "CHAMPION_KILL")
  }
  if (timelineFilter.value === "objectives") {
    return events.filter((event) =>
      event.type === "ELITE_MONSTER_KILL" || event.type === "BUILDING_KILL",
    )
  }
  return events.filter((event) => event.type.startsWith("ITEM_"))
})

async function load(gameId?: number) {
  busy.value = true
  error.value = ""
  try {
    const overview = await api.getReviewOverview()
    const target = gameId ?? focusReviewGameId.value ?? overview.latest?.match.gameId
    review.value = target ? await api.getMatchReview(target) : undefined
    focusReviewGameId.value = null
    const [sessionPage, storedTags, storedExperiments, bookmarkedPage] = await Promise.all([
      api.getReviewSessions(),
      api.listTags(),
      api.listExperiments(),
      api.listMatches({ bookmarked: true }, 1, 100),
    ])
    sessions.value = sessionPage.rows
    tags.value = storedTags
    experiments.value = storedExperiments
    bookmarks.value = bookmarkedPage.rows
  } catch (caught) {
    error.value = (caught as Error).message
  } finally {
    busy.value = false
  }
}

function queueNoteSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void saveAnnotation(), 750)
}

async function saveAnnotation() {
  if (!review.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = undefined
  review.value.annotation = await api.saveAnnotation(review.value.match.gameId, {
    note: review.value.annotation.note,
    bookmarked: review.value.annotation.bookmarked,
    tagIds: review.value.annotation.tags.map((tag) => tag.id),
  })
}

async function toggleBookmark() {
  if (!review.value) return
  review.value.annotation.bookmarked = !review.value.annotation.bookmarked
  await saveAnnotation()
  if (review.value.annotation.bookmarked) {
    review.value.timeline = await api.getTimeline(review.value.match.gameId)
  }
}

async function toggleTag(tag: AnnotationTag) {
  if (!review.value) return
  const selected = review.value.annotation.tags.some((entry) => entry.id === tag.id)
  review.value.annotation.tags = selected
    ? review.value.annotation.tags.filter((entry) => entry.id !== tag.id)
    : [...review.value.annotation.tags, tag].slice(0, 20)
  await saveAnnotation()
}

async function createTag() {
  if (!newTag.value.trim()) return
  tags.value = [...tags.value, await api.createTag(newTag.value)]
    .filter((tag, index, all) => all.findIndex((entry) => entry.id === tag.id) === index)
  newTag.value = ""
}

async function loadTimeline(retry = false) {
  if (!review.value) return
  review.value.timeline = { status: "loading" }
  review.value.timeline = await api.requestTimeline(review.value.match.gameId, retry)
}

async function setBoundary(gameId: number, action: "split" | "join" | null) {
  await api.setSessionBoundary(gameId, action)
  sessions.value = (await api.getReviewSessions()).rows
}

async function createExperiment() {
  if (!experimentName.value.trim()) return
  await api.createExperiment({
    name: experimentName.value,
    hypothesis: experimentHypothesis.value,
    championIds: experimentChampionIds.value,
    modes: experimentModes.value,
    status: "active",
  })
  experimentName.value = ""
  experimentHypothesis.value = ""
  experimentChampionIds.value = []
  experimentModes.value = []
  experiments.value = await api.listExperiments()
}

async function setExperimentStatus(
  experiment: PracticeExperiment,
  status: PracticeExperiment["status"],
) {
  await api.updateExperiment(experiment.id, {
    ...experiment,
    status,
  })
  experiments.value = await api.listExperiments()
}

async function updateOutcome(
  experimentId: number,
  outcome: ExperimentOutcomeValue,
  note?: string,
) {
  if (!review.value) return
  await api.setExperimentOutcome(
    review.value.match.gameId,
    experimentId,
    outcome,
    note ?? review.value.annotation.experimentOutcomes.find(
      (entry) => entry.experimentId === experimentId,
    )?.note ?? "",
  )
  review.value = await api.getMatchReview(review.value.match.gameId)
}

function date(value: number) {
  return new Date(value).toLocaleString()
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}

watch(focusReviewGameId, (gameId) => {
  if (gameId) {
    tab.value = "review"
    void nextTick(() => load(gameId))
  }
})

onMounted(() => {
  void load()
  api.on("review:updated", () => {
    if (!saveTimer) void load(review.value?.match.gameId)
  })
  api.on("timeline:updated", (gameId: number) => {
    if (review.value?.match.gameId === gameId) {
      void api.getTimeline(gameId).then((state) => {
        if (review.value) review.value.timeline = state
      })
    }
  })
})

onBeforeUnmount(() => {
  if (saveTimer) void saveAnnotation()
})
</script>

<template>
  <div class="review-page">
    <header class="page-head">
      <div>
        <h1>Review</h1>
        <p class="muted">Turn permanent local history into concrete, measurable follow-up.</p>
      </div>
      <div class="tabs" role="tablist">
        <button v-for="name in (['review', 'sessions', 'bookmarks', 'experiments'] as Tab[])"
          :key="name" class="league-button" :class="{ active: tab === name }"
          @click="tab = name">
          {{ name[0].toUpperCase() + name.slice(1) }}
        </button>
      </div>
    </header>

    <p v-if="error" class="error">{{ error }}</p>
    <div v-if="busy && !review" class="card muted">Loading your review…</div>

    <template v-if="tab === 'review' && review">
      <section class="hero card" :class="review.match.win ? 'won' : 'lost'">
        <img :src="championIconUrl(review.match.championId)"
          :alt="championNameById(champions, review.match.championId)" />
        <div class="grow">
          <div class="eyebrow">{{ date(review.match.playedAt) }} · {{ modeLabel(review.match.mode) }}</div>
          <h2>{{ review.match.win ? "Victory" : "Defeat" }} on
            {{ championNameById(champions, review.match.championId) }}</h2>
          <p class="muted">{{ review.match.kills }}/{{ review.match.deaths }}/{{ review.match.assists }}
            · {{ formatDuration(review.match.durationSecs) }} · {{ Math.round(review.match.damageToChampions / Math.max(1, review.match.durationSecs / 60)).toLocaleString() }} damage/min</p>
        </div>
        <GradeBadge :grade="review.match.grade" size="lg" />
        <button class="league-button bookmark" :aria-pressed="review.annotation.bookmarked"
          @click="toggleBookmark">{{ review.annotation.bookmarked ? "★ Bookmarked" : "☆ Bookmark" }}</button>
      </section>

      <section v-if="sessions[0]" class="card compact-session">
        <div>
          <span class="eyebrow">Recent session</span>
          <strong>{{ sessions[0].games }} games · {{ sessions[0].wins }}–{{ sessions[0].losses }}</strong>
          <span class="muted">{{ Math.round(sessions[0].winRate * 100) }}% win rate · {{ sessions[0].championCount }} champions</span>
        </div>
        <button class="league-button" @click="tab = 'sessions'">Review session</button>
      </section>

      <div class="review-grid">
        <section class="card">
          <h2 class="section-title">Why this grade</h2>
          <p v-if="review.grade?.unavailableReason" class="muted">{{ review.grade.unavailableReason }}</p>
          <div v-else-if="review.grade" class="components">
            <div v-for="component in review.grade.components" :key="component.key" class="component">
              <div><strong>{{ component.label }}</strong>
                <span class="muted">{{ percent(component.percentile) }} {{ component.scope }} · {{ Math.round(component.weight * 100) }}% weight</span></div>
              <div class="track"><span class="fill" :style="{ width: percent(component.percentile) }" /></div>
              <span class="numeric">+{{ component.contribution.toFixed(3) }}</span>
            </div>
          </div>
          <div class="highlights">
            <article v-for="highlight in review.highlights" :key="highlight.kind" class="highlight">
              <strong>{{ highlight.title }}</strong><span class="muted">{{ highlight.detail }}</span>
            </article>
          </div>
        </section>

        <section class="card">
          <h2 class="section-title">Against your prior games</h2>
          <p v-if="review.baseline" class="muted">
            {{ review.baseline.games }} earlier {{ review.baseline.scope.replace('_', ' ') }} games
            · {{ review.baseline.confidence }} confidence
          </p>
          <div v-if="review.baseline" class="baseline">
            <div v-for="metric in review.baseline.metrics" :key="metric.key">
              <span>{{ metric.label }}</span>
              <strong :class="{
                positive: metric.difference * (metric.preferredDirection === 'higher' ? 1 : -1) > 0,
                negative: metric.difference * (metric.preferredDirection === 'higher' ? 1 : -1) < 0,
              }">{{ metric.current.toFixed(1) }}</strong>
              <span class="muted">vs {{ metric.baseline.toFixed(1) }}</span>
            </div>
          </div>
          <p v-else class="muted">No earlier matching games are available yet.</p>
        </section>
      </div>

      <section class="card">
        <h2 class="section-title">Scoreboard</h2>
        <div class="scoreboard">
          <div v-for="player in review.scoreboard" :key="player.participantId"
            class="score-row" :class="{ owner: player.isPlayer }">
            <img :src="championIconUrl(player.championId)" alt="" />
            <span class="name">{{ player.summonerName || `Player ${player.participantId}` }}</span>
            <span>{{ player.kills }}/{{ player.deaths }}/{{ player.assists }}</span>
            <span>{{ player.damageToChampions.toLocaleString() }} dmg</span>
            <GradeBadge :grade="player.grade" />
          </div>
        </div>
      </section>

      <div class="review-grid">
        <section class="card">
          <h2 class="section-title">Notes and tags</h2>
          <textarea v-model="review.annotation.note" maxlength="4000"
            placeholder="What happened? What should you repeat or change?"
            @input="queueNoteSave" />
          <div class="tag-list">
            <button v-for="tag in tags" :key="tag.id" class="tag"
              :class="{ selected: review.annotation.tags.some(entry => entry.id === tag.id) }"
              @click="toggleTag(tag)">{{ tag.name }}</button>
          </div>
          <div class="inline">
            <input v-model="newTag" class="league-input" maxlength="24" placeholder="New tag"
              @keyup.enter="createTag" />
            <button class="league-button" @click="createTag">Add tag</button>
          </div>
        </section>

        <section class="card">
          <h2 class="section-title">Experiments</h2>
          <p v-if="review.annotation.experimentOutcomes.length === 0" class="muted">
            No active experiment matched this champion and mode.
          </p>
          <div v-for="outcome in review.annotation.experimentOutcomes"
            :key="outcome.experimentId" class="experiment-outcome">
            <strong>{{ outcome.experimentName }}</strong>
            <select class="league-select" :value="outcome.outcome"
              @change="updateOutcome(outcome.experimentId, ($event.target as HTMLSelectElement).value as ExperimentOutcomeValue)">
              <option value="unrated">Unrated</option><option value="worked">Worked</option>
              <option value="mixed">Mixed</option><option value="did_not_work">Did not work</option>
            </select>
            <input v-model="outcome.note" class="league-input outcome-note"
              maxlength="1000" placeholder="Optional outcome note"
              @blur="updateOutcome(outcome.experimentId, outcome.outcome, outcome.note)" />
          </div>
        </section>
      </div>

      <section class="card">
        <h2 class="section-title">Timeline</h2>
        <div v-if="review.timeline.status === 'ready' && review.timeline.summary">
          <svg class="gold-chart" viewBox="0 0 100 100" preserveAspectRatio="none"
            aria-label="Team gold difference across the match">
            <line x1="0" y1="50" x2="100" y2="50" />
            <polyline :points="timelinePoints" />
          </svg>
          <div class="timeline-filters">
            <button v-for="filter in (['all', 'you', 'kills', 'objectives', 'items'] as const)"
              :key="filter" class="league-button" :class="{ active: timelineFilter === filter }"
              @click="timelineFilter = filter">
              {{ filter[0].toUpperCase() + filter.slice(1) }}
            </button>
          </div>
          <div class="events">
            <span v-for="event in filteredTimelineEvents.slice(0, 80)"
              :key="`${event.timestamp}-${event.type}`">
              {{ Math.floor(event.timestamp / 60000) }}:{{ String(Math.floor(event.timestamp / 1000) % 60).padStart(2, '0') }}
              · {{ event.type.replaceAll('_', ' ').toLowerCase() }}
            </span>
          </div>
          <div class="purchase-path">
            <strong>Your purchase path</strong>
            <span v-for="event in review.timeline.summary.events.filter(event =>
              event.participantId === owner?.participantId && event.type.startsWith('ITEM_')
            )" :key="`item-${event.timestamp}-${event.itemId}`">
              {{ Math.floor(event.timestamp / 60000) }}m · item {{ event.itemId || event.afterId || event.beforeId }}
            </span>
          </div>
          <div v-if="review.timeline.summary.turningPoints.length" class="turning-points">
            <strong>Measured turning points</strong>
            <span v-for="point in review.timeline.summary.turningPoints" :key="point.timestamp">
              {{ Math.round(point.timestamp / 60000) }} min · {{ Math.abs(point.swing).toLocaleString() }} gold swing
            </span>
          </div>
        </div>
        <div v-else class="timeline-empty">
          <p class="muted">{{ review.timeline.error || (review.timeline.status === 'pending'
            ? 'Timeline queued. Add a Riot API key in Settings if needed.'
            : 'Timelines are fetched only when you ask or bookmark a match.') }}</p>
          <button class="league-button" :disabled="review.timeline.status === 'loading'"
            @click="loadTimeline(review.timeline.status === 'unavailable' || review.timeline.status === 'error')">
            {{ review.timeline.status === 'loading' ? 'Loading…' : 'Load timeline' }}
          </button>
        </div>
      </section>
    </template>

    <section v-else-if="tab === 'sessions'" class="session-list">
      <article v-for="session in sessions" :key="session.id" class="card">
        <div class="session-head"><div><strong>{{ date(session.startAt) }}</strong>
          <span class="muted">{{ session.games }} counted games · {{ formatDuration(session.playTimeSecs) }}</span></div>
          <strong>{{ session.wins }}–{{ session.losses }} · {{ Math.round(session.winRate * 100) }}%</strong></div>
        <p v-if="session.trend" class="muted">
          Performance {{ session.trend }}<template v-if="session.trendDelta"> ({{ session.trendDelta > 0 ? '+' : '' }}{{ session.trendDelta.toFixed(2) }})</template>
        </p>
        <div class="session-games">
          <div v-for="(match, index) in session.matches" :key="match.gameId" class="match-control">
            <button class="match-chip" @click="tab = 'review'; load(match.gameId)">
              <img :src="championIconUrl(match.championId)" alt="" />
              <GradeBadge :grade="match.grade" />
            </button>
            <details v-if="index > 0 || session !== sessions.at(-1)" class="boundary">
              <summary aria-label="Session boundary options">⋯</summary>
              <button @click="setBoundary(match.gameId, 'split')">Split here</button>
              <button @click="setBoundary(match.gameId, 'join')">Join previous</button>
              <button @click="setBoundary(match.gameId, null)">Automatic</button>
            </details>
          </div>
        </div>
      </article>
    </section>

    <section v-else-if="tab === 'bookmarks'" class="card">
      <h2 class="section-title">Bookmarks</h2>
      <p class="muted">Use the star on any review. Bookmarked games automatically queue their timeline.</p>
      <button v-for="match in bookmarks" :key="match.gameId" class="bookmark-row"
        @click="tab = 'review'; load(match.gameId)">
        <img :src="championIconUrl(match.championId)" alt="" />
        <span>{{ championNameById(champions, match.championId) }} · {{ modeLabel(match.mode) }} · {{ date(match.playedAt) }}</span>
        <GradeBadge :grade="match.grade" />
      </button>
      <p v-if="bookmarks.length === 0" class="muted">No bookmarked matches yet.</p>
    </section>

    <section v-else-if="tab === 'experiments'" class="experiments-page">
      <div class="card">
        <h2 class="section-title">New practice experiment</h2>
        <input v-model="experimentName" maxlength="80" class="league-input" placeholder="Experiment name" />
        <textarea v-model="experimentHypothesis" maxlength="500" placeholder="What measurable change are you trying?" />
        <label class="scope-label">Champion scope
          <select v-model="experimentChampionIds" class="league-select" multiple>
            <option v-for="champion in champions" :key="champion.id" :value="champion.id">
              {{ champion.name }}
            </option>
          </select>
          <span class="muted">Leave empty for all champions.</span>
        </label>
        <label class="scope-label">Mode scope
          <select v-model="experimentModes" class="league-select" multiple>
            <option value="aram">ARAM</option><option value="mayhem">ARAM: Mayhem</option>
            <option value="sr_ranked_solo">Ranked Solo</option><option value="sr_ranked_flex">Ranked Flex</option>
            <option value="sr_normal">Normal Draft</option><option value="sr_quickplay">Quickplay</option>
            <option value="sr_swiftplay">Swiftplay</option>
          </select>
          <span class="muted">Leave empty for all modes.</span>
        </label>
        <button class="league-button" @click="createExperiment">Start experiment</button>
      </div>
      <article v-for="experiment in experiments" :key="experiment.id" class="card experiment-card">
        <div><strong>{{ experiment.name }}</strong><span class="status">{{ experiment.status }}</span></div>
        <p class="muted">{{ experiment.hypothesis || "No hypothesis recorded." }}</p>
        <span class="muted">{{ experiment.games ?? 0 }} attached games · {{ experiment.status === 'active' ? 'New matching games attach automatically' : 'Not attaching new games' }}</span>
        <p v-if="experiment.summary" class="muted">
          {{ Math.round(experiment.summary.winRate * 100) }}% win rate ·
          {{ experiment.summary.kda.toFixed(2) }} KDA ·
          {{ experiment.summary.confidence }} confidence ·
          prior {{ Math.round(experiment.summary.baselineWinRate * 100) }}% /
          {{ experiment.summary.baselineKda.toFixed(2) }} KDA across
          {{ experiment.summary.baselineGames }} games
          <template v-if="experiment.summary.avgGrade !== undefined">
            · grade {{ experiment.summary.avgGrade.toFixed(2) }}
            vs {{ experiment.summary.baselineAvgGrade?.toFixed(2) ?? "—" }}
          </template>
          <template v-if="(experiment.games ?? 0) < 5"> · More games needed before describing improvement</template>
        </p>
        <div class="experiment-actions">
          <button v-if="experiment.status !== 'active'" class="league-button"
            @click="setExperimentStatus(experiment, 'active')">Resume</button>
          <button v-if="experiment.status === 'active'" class="league-button"
            @click="setExperimentStatus(experiment, 'paused')">Pause</button>
          <button v-if="experiment.status !== 'completed'" class="league-button"
            @click="setExperimentStatus(experiment, 'completed')">Complete</button>
        </div>
      </article>
    </section>

    <div v-else-if="!busy" class="card muted">Play or import a match to begin reviewing.</div>
  </div>
</template>

<style scoped>
.review-page { display: flex; flex-direction: column; gap: var(--space-4); max-width: 1180px; margin: 0 auto; }
.page-head, .hero, .session-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
h1 { margin: 0; font: 22px var(--font-display); color: var(--gold-bright); }
h2 { margin: 0; }
.page-head p { margin: 2px 0 0; font-size: 12px; }
.tabs { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.tabs button, .bookmark, .timeline-empty button, .inline button, .experiments-page button { padding: var(--space-2) var(--space-3); }
.hero { border-left: 3px solid var(--border-strong); }.hero.won { border-left-color: var(--win); }.hero.lost { border-left-color: var(--loss); }
.hero > img { width: 64px; height: 64px; border-radius: var(--radius-sm); }.grow { flex: 1; }.eyebrow { color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .8px; }
.hero h2 { font: 20px var(--font-heading); color: var(--gold-bright); }.hero p { margin: 3px 0 0; }
.compact-session { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }.compact-session > div { display: flex; flex-direction: column; }.compact-session button { padding: var(--space-2) var(--space-3); }
.review-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.components, .baseline, .highlights, .scoreboard, .events, .turning-points { display: grid; gap: var(--space-2); }
.component { display: grid; grid-template-columns: minmax(140px, 1fr) 1fr 58px; align-items: center; gap: var(--space-3); }
.component div:first-child { display: flex; flex-direction: column; font-size: 12px; }.numeric { text-align: right; font-variant-numeric: tabular-nums; }
.highlight { display: flex; flex-direction: column; padding: var(--space-2); background: var(--surface-2); border-radius: var(--radius-sm); font-size: 12px; }
.baseline > div { display: grid; grid-template-columns: 1fr 70px 100px; gap: var(--space-2); font-size: 12px; }.positive { color: var(--win); }.negative, .error { color: var(--loss); }
.score-row { display: grid; grid-template-columns: 30px minmax(120px, 1fr) 80px 110px 38px; align-items: center; gap: var(--space-2); padding: 5px var(--space-2); font-size: 12px; border-radius: var(--radius-sm); }
.score-row.owner { background: color-mix(in srgb, var(--gold) 12%, transparent); }.score-row img { width: 28px; height: 28px; border-radius: 50%; }.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
textarea { width: 100%; box-sizing: border-box; min-height: 110px; resize: vertical; background: var(--surface-0); color: var(--text-primary); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: var(--space-3); font: 12px var(--font-body); }
.tag-list, .inline, .experiment-outcome, .session-games { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-2); }.tag { border: 1px solid var(--border-subtle); background: var(--surface-2); color: var(--text-secondary); border-radius: 99px; padding: 4px 9px; }.tag.selected { color: var(--gold-bright); border-color: var(--gold); }
.inline input { flex: 1; }.experiment-outcome { justify-content: space-between; align-items: center; }.outcome-note { flex-basis: 100%; }
.gold-chart { width: 100%; height: 180px; background: var(--surface-0); border-radius: var(--radius-sm); }.gold-chart line { stroke: var(--border-strong); stroke-width: .5; }.gold-chart polyline { fill: none; stroke: var(--gold); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.timeline-filters { display: flex; gap: var(--space-2); margin-top: var(--space-2); flex-wrap: wrap; }.timeline-filters button { padding: 4px 8px; font-size: 10px; }
.events { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); max-height: 180px; overflow: auto; margin-top: var(--space-3); font-size: 11px; color: var(--text-secondary); }.turning-points { margin-top: var(--space-3); font-size: 12px; }
.purchase-path { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-3); font-size: 11px; }.purchase-path strong { flex-basis: 100%; }
.session-list, .experiments-page { display: grid; gap: var(--space-3); }.session-head > div { display: flex; flex-direction: column; }.match-control { display: flex; align-items: center; position: relative; }.match-chip { display: flex; align-items: center; gap: 4px; background: var(--surface-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 3px; cursor: pointer; }.match-chip img { width: 30px; height: 30px; border-radius: var(--radius-sm); }.boundary summary { cursor: pointer; padding: 0 4px; }.boundary[open] { position: relative; }.boundary[open] > button { display: block; width: 110px; background: var(--surface-3); color: var(--text-primary); border: 1px solid var(--border-subtle); padding: 4px; font-size: 10px; cursor: pointer; }
.experiments-page { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }.experiments-page .card:first-child { display: grid; gap: var(--space-2); }.status { margin-left: var(--space-2); color: var(--gold); text-transform: uppercase; font-size: 10px; }
.scope-label { display: grid; gap: 4px; font-size: 11px; }.scope-label select { min-height: 72px; }.experiment-actions { display: flex; gap: var(--space-2); margin-top: var(--space-2); }.experiment-actions button { padding: 4px 8px; font-size: 10px; }
.bookmark-row { width: 100%; display: grid; grid-template-columns: 34px 1fr 36px; align-items: center; gap: var(--space-2); padding: var(--space-2); background: var(--surface-2); color: var(--text-primary); border: 1px solid var(--border-subtle); text-align: left; }.bookmark-row img { width: 32px; height: 32px; border-radius: 50%; }
@media (max-width: 800px) { .review-grid { grid-template-columns: 1fr; }.page-head, .hero { align-items: flex-start; flex-wrap: wrap; }.score-row { grid-template-columns: 30px 1fr 70px 35px; }.score-row span:nth-of-type(3) { display: none; } }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
</style>
