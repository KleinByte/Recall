<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { api } from "../helpers/api"
import { useApiEvents } from "../helpers/use-api-events"
import { useCoalescedTask } from "../helpers/use-coalesced-task"
import {
  championIconUrl,
  championNameById,
  formatDuration,
  modeLabel,
} from "../helpers/format"
import {
  itemIconUrl,
  loadGameAssets,
  normalizeAugmentId,
  timelineObjectiveIconUrl,
  type GameAssetCatalog,
} from "../helpers/game-assets"
import { focusReviewGameId } from "../helpers/navigation"
import {
  timelineChartDomain,
  timelineChartPoints,
  timelineChartX,
  timelineChartY,
  timelineGoldDifferenceAt,
  sampleTimelineEvents,
} from "../helpers/timeline-chart"
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
  OwnerAugmentSummary,
  TimelineEvent,
} from "../types/review"

const props = defineProps<{ champions: Champion[] | null }>()
const events = useApiEvents()
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
const timelineFilter = ref<"all" | "you" | "kills" | "objectives" | "items" | "levels" | "vision">("all")
const assets = ref<GameAssetCatalog>({ version: "latest", items: {}, augments: {}, abilities: {} })
const augmentSummary = ref<Record<number, OwnerAugmentSummary>>({})
let saveTimer: ReturnType<typeof setTimeout> | undefined
let annotationSavesInFlight = 0

const owner = computed(() =>
  review.value?.scoreboard.find((participant) => participant.isPlayer === 1),
)
const teams = computed(() => [100, 200].map((teamId) => ({
  teamId,
  players: review.value?.scoreboard.filter((player) => player.teamId === teamId) ?? [],
})))
const timelineDomain = computed(() => {
  const summary = review.value?.timeline.summary
  return timelineChartDomain(summary?.frames ?? [], summary?.events ?? [])
})
const timelinePoints = computed(() => {
  const frames = review.value?.timeline.summary?.frames ?? []
  if (frames.length < 2) return ""
  return timelineChartPoints(frames, timelineDomain.value)
})
const timelineMarkers = computed(() => {
  const summary = review.value?.timeline.summary
  if (!summary?.frames.length) return []
  const frames = summary.frames
  const ownerId = owner.value?.participantId
  const source = timelineFilter.value === "all"
    ? summary.events.filter((event) =>
      event.category === "kill" ||
      event.category === "objective" ||
      event.category === "game" ||
      (
        event.category === "item" &&
        event.participantId === ownerId &&
        ["ITEM_PURCHASED", "ITEM_TRANSFORMED", "ITEM_DESTROYED"].includes(event.type)
      ),
    )
    : filteredTimelineEvents.value
  const laneByBucket = new Map<number, number>()

  return sampleTimelineEvents(source, 90).map((event) => {
    const x = timelineChartX(event.timestamp, timelineDomain.value)
    const difference = timelineGoldDifferenceAt(event.timestamp, frames)
    const lineY = timelineChartY(difference, timelineDomain.value)
    const bucket = Math.round(x / 2)
    const lane = laneByBucket.get(bucket) ?? 0
    laneByBucket.set(bucket, lane + 1)
    const direction = lane % 2 === 0 ? -1 : 1
    const distance = Math.ceil((lane + 1) / 2) * 7
    return {
      event,
      x,
      y: Math.max(7, Math.min(93, lineY + direction * distance)),
    }
  })
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
    return events.filter((event) => event.category === "kill")
  }
  if (timelineFilter.value === "objectives") {
    return events.filter((event) =>
      event.category === "objective",
    )
  }
  if (timelineFilter.value === "items") return events.filter((event) => event.category === "item")
  if (timelineFilter.value === "levels") return events.filter((event) => event.category === "level")
  return events.filter((event) => event.category === "vision")
})

function participant(participantId?: number) {
  return review.value?.scoreboard.find((entry) => entry.participantId === participantId)
}

/**
 * Mayhem timelines currently report killerId 0. When the victim's opposing
 * team has exactly one member not listed as an assist, that missing member is
 * the killer; otherwise the event remains honestly unattributed.
 */
function killActor(event: TimelineEvent) {
  const direct = participant(event.participantId)
  if (direct) return direct
  const victim = participant(event.targetId)
  if (!victim) return undefined
  const assists = new Set(event.assistingParticipantIds ?? [])
  const candidates = review.value?.scoreboard.filter((entry) =>
    entry.teamId !== victim.teamId && !assists.has(entry.participantId),
  ) ?? []
  return candidates.length === 1 ? candidates[0] : undefined
}

function eventTime(timestamp: number) {
  return `${Math.floor(timestamp / 60_000)}:${String(Math.floor(timestamp / 1_000) % 60).padStart(2, "0")}`
}

function objectiveName(value?: string) {
  return (value ?? "Objective").replaceAll("_", " ").toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function itemId(event: TimelineEvent) {
  return event.itemId ?? event.afterId ?? event.beforeId
}

function itemName(event: TimelineEvent) {
  const id = itemId(event)
  return assets.value.items[id ?? 0]?.name ?? `Item ${id ?? "unknown"}`
}

function itemIcon(event: TimelineEvent) {
  const id = itemId(event)
  return assets.value.items[id ?? 0]?.icon ?? itemIconUrl(id, assets.value.version)
}

function abilityAsset(event: TimelineEvent) {
  if (event.type !== "SKILL_LEVEL_UP" || !event.skillSlot) return undefined
  const championId = participant(event.participantId)?.championId
  return championId ? assets.value.abilities[championId]?.[event.skillSlot - 1] : undefined
}

function abilityKey(skillSlot?: number) {
  return skillSlot && skillSlot >= 1 && skillSlot <= 4
    ? ["Q", "W", "E", "R"][skillSlot - 1]
    : "ability"
}

function timelineMarkerIcon(event: TimelineEvent) {
  if (event.category === "kill") {
    const actor = killActor(event)
    const target = participant(event.targetId)
    return championIconUrl(actor?.championId || target?.championId || 0)
  }
  if (event.category === "item") return itemIcon(event)
  if (event.type === "SKILL_LEVEL_UP") return abilityAsset(event)?.icon
  if (event.type === "LEVEL_UP") {
    return championIconUrl(participant(event.participantId)?.championId || 0)
  }
  if (event.category === "objective") {
    return timelineObjectiveIconUrl(event.type, event.objective, event.teamId)
  }
  return undefined
}

function timelineMarkerGlyph(event: TimelineEvent) {
  if (event.category === "objective") return "◆"
  if (event.category === "level") return "↑"
  if (event.category === "vision") return "◉"
  if (event.category === "game") return "■"
  return "•"
}

function timelineMarkerTitle(event: TimelineEvent) {
  const time = eventTime(event.timestamp)
  if (event.category === "kill") {
    const killer = killActor(event)?.summonerName
    const victim = participant(event.targetId)?.summonerName ?? `Player ${event.targetId}`
    return killer
      ? `${time} · ${killer} killed ${victim}`
      : `${time} · Mayhem takedown on ${victim}`
  }
  if (event.category === "item") {
    const player = participant(event.participantId)?.summonerName ?? `Player ${event.participantId}`
    return `${time} · ${player} · ${itemName(event)}`
  }
  if (event.type === "SKILL_LEVEL_UP") {
    const player = participant(event.participantId)?.summonerName ?? `Player ${event.participantId}`
    const ability = abilityAsset(event)?.name ?? abilityKey(event.skillSlot)
    return `${time} · ${player} ranked ${ability} (${abilityKey(event.skillSlot)})`
  }
  return `${time} · ${objectiveName(event.objective || event.type)}`
}

function timelineEventDescription(event: TimelineEvent) {
  if (event.type === "SKILL_LEVEL_UP") {
    return `ranked ${abilityAsset(event)?.name ?? abilityKey(event.skillSlot)} (${abilityKey(event.skillSlot)})`
  }
  if (event.type === "LEVEL_UP") return `reached level ${event.level ?? "?"}`
  return objectiveName(event.objective || event.type)
}

function augmentName(augmentId: number) {
  return assets.value.augments[augmentId]?.name ?? `Augment ${augmentId}`
}

function augmentIcon(augmentId: number, fallback?: string) {
  return assets.value.augments[augmentId]?.icon || fallback || "/recall-icon.png"
}

async function loadAugmentSummary(augmentId: number) {
  const result = (await api.getOwnerAugmentSummaries(augmentId))[0]
  if (result) augmentSummary.value = { ...augmentSummary.value, [augmentId]: result }
}

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

const refreshCurrent = useCoalescedTask(() => load(review.value?.match.gameId))

function queueNoteSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void saveAnnotation(), 750)
}

async function saveAnnotation() {
  const current = review.value
  if (!current) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = undefined
  const gameId = current.match.gameId
  annotationSavesInFlight += 1
  try {
    const annotation = await api.saveAnnotation(gameId, {
      note: current.annotation.note,
      bookmarked: current.annotation.bookmarked,
      tagIds: current.annotation.tags.map((tag) => tag.id),
    })
    if (review.value?.match.gameId === gameId) review.value.annotation = annotation
  } finally {
    annotationSavesInFlight -= 1
  }
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
  void loadGameAssets().then((catalog) => {
    assets.value = catalog
    const entries = Object.entries(catalog.augments).flatMap(([id, augment]) => {
      const augmentId = normalizeAugmentId(id)
      return augmentId !== undefined
        ? [{ augmentId, name: augment.name, iconPath: augment.icon, rarity: augment.rarity }]
        : []
    })
    if (entries.length) {
      void api.cacheAugmentCatalog({
        dataVersion: catalog.version,
        entries,
      }).catch((error) => console.warn("Could not cache augment catalog", error))
    }
  })
  events.on("review:updated", () => {
    if (!saveTimer && annotationSavesInFlight === 0) void refreshCurrent()
  })
  events.on("timeline:updated", (gameId: number) => {
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
        <div class="section-heading">
          <div><span class="eyebrow">Complete lobby</span><h2 class="section-title">Scoreboard</h2></div>
          <span class="muted">Items and augments are captured for every visible participant</span>
        </div>
        <div class="team-grid">
          <div v-for="team in teams" :key="team.teamId" class="score-team"
            :class="team.teamId === 100 ? 'blue' : 'red'">
            <div class="team-head">
              <strong>{{ team.teamId === 100 ? "Blue team" : "Red team" }}</strong>
              <span>{{ team.players.reduce((sum, player) => sum + player.kills, 0) }} kills</span>
            </div>
            <article v-for="player in team.players" :key="player.participantId"
              class="score-row" :class="{ owner: player.isPlayer }">
              <img class="champion-portrait" :src="championIconUrl(player.championId)"
                :alt="championNameById(champions, player.championId)" />
              <div class="player-block">
                <strong class="name">{{ player.summonerName || `Player ${player.participantId}` }}</strong>
                <span class="muted">Level {{ player.champLevel }} · {{ player.totalMinionsKilled + player.neutralMinions }} CS</span>
              </div>
              <div class="kda"><strong>{{ player.kills }}/{{ player.deaths }}/{{ player.assists }}</strong>
                <span>{{ player.damageToChampions.toLocaleString() }} damage</span></div>
              <div class="loadout" aria-label="Final items">
                <img v-for="(id, index) in player.items.filter(Boolean)" :key="`${id}-${index}`"
                  :src="assets.items[id]?.icon || itemIconUrl(id, assets.version)"
                  :title="assets.items[id]?.name || `Item ${id}`" alt="" />
              </div>
              <div v-if="player.augments?.length" class="augment-loadout" aria-label="Selected augments">
                <button v-for="augment in player.augments" :key="augment.slot"
                  :title="augmentName(augment.augmentId)"
                  @click="player.isPlayer && loadAugmentSummary(augment.augmentId)">
                  <img :src="augmentIcon(augment.augmentId, augment.iconPath)" alt="" />
                </button>
              </div>
              <div v-else class="augment-missing" title="This source did not include augments">—</div>
              <GradeBadge :grade="player.grade" />
            </article>
          </div>
        </div>
        <div v-if="owner?.augments?.length" class="owner-augment-context">
          <article v-for="augment in owner.augments" :key="augment.slot">
            <img :src="augmentIcon(augment.augmentId, augment.iconPath)" alt="" />
            <div><strong>{{ augmentName(augment.augmentId) }}</strong>
              <span v-if="augmentSummary[augment.augmentId]" class="muted">
                {{ augmentSummary[augment.augmentId].games }} personal games ·
                {{ augmentSummary[augment.augmentId].kda.toFixed(2) }} KDA ·
                {{ Math.round(augmentSummary[augment.augmentId].damagePerMinute).toLocaleString() }} DPM
              </span>
              <button v-else class="text-button" @click="loadAugmentSummary(augment.augmentId)">
                Show your non-win performance context
              </button>
            </div>
          </article>
          <p class="policy-note">Recall records selections, but does not calculate augment win rates or rank augments.</p>
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
        <div class="section-heading">
          <div><span class="eyebrow">Match chronology</span><h2 class="section-title">Timeline</h2></div>
          <span class="muted">Named events from Riot Match‑V5</span>
        </div>
        <div v-if="review.timeline.status === 'ready' && review.timeline.summary">
          <div class="gold-chart-wrap">
            <svg class="gold-chart" viewBox="0 0 100 100" preserveAspectRatio="none"
              aria-label="Team gold difference across the match">
              <line class="grid-line top" x1="0" y1="25" x2="100" y2="25" />
              <line class="grid-line" x1="0" y1="50" x2="100" y2="50" />
              <line class="grid-line bottom" x1="0" y1="75" x2="100" y2="75" />
              <polyline :points="timelinePoints" />
            </svg>
            <span
              v-for="marker in timelineMarkers"
              :key="marker.event.eventId"
              class="chart-marker"
              :class="marker.event.category"
              :style="{ left: `${marker.x}%`, top: `${marker.y}%` }"
              :title="timelineMarkerTitle(marker.event)"
              :aria-label="timelineMarkerTitle(marker.event)"
              role="img"
              tabindex="0"
            >
              <img
                v-if="timelineMarkerIcon(marker.event)"
                :src="timelineMarkerIcon(marker.event)"
                alt=""
              />
              <span v-else>{{ timelineMarkerGlyph(marker.event) }}</span>
            </span>
            <span class="chart-label blue">Blue lead</span>
            <span class="chart-label red">Red lead</span>
          </div>
          <div class="timeline-filters">
            <button v-for="filter in (['all', 'you', 'kills', 'objectives', 'items', 'levels', 'vision'] as const)"
              :key="filter" class="league-button" :class="{ active: timelineFilter === filter }"
              @click="timelineFilter = filter">
              {{ filter[0].toUpperCase() + filter.slice(1) }}
            </button>
          </div>
          <div class="events">
            <article v-for="event in filteredTimelineEvents.slice(0, 160)"
              :key="event.eventId" class="event-row" :class="event.category">
              <time>{{ eventTime(event.timestamp) }}</time>
              <template v-if="event.category === 'kill'">
                <img :src="championIconUrl(killActor(event)?.championId || participant(event.targetId)?.championId || 0)" alt="" />
                <div><strong>{{ killActor(event)?.summonerName || "Mayhem takedown" }}</strong>
                  <span>{{ killActor(event) ? "killed" : "on" }} <strong>{{ participant(event.targetId)?.summonerName || `Player ${event.targetId}` }}</strong>
                    <template v-if="event.assistingParticipantIds?.length">
                      · assisted by {{ event.assistingParticipantIds.map(id => participant(id)?.summonerName || `Player ${id}`).join(", ") }}
                    </template>
                  </span></div>
                <img class="victim" :src="championIconUrl(participant(event.targetId)?.championId || 0)" alt="" />
              </template>
              <template v-else-if="event.category === 'item'">
                <img :src="itemIcon(event)" :alt="itemName(event)" />
                <div><strong>{{ participant(event.participantId)?.summonerName || `Player ${event.participantId}` }}</strong>
                  <span>{{ event.type.replace("ITEM_", "").toLowerCase() }} {{ itemName(event) }}</span></div>
              </template>
              <template v-else>
                <img v-if="timelineMarkerIcon(event)" :src="timelineMarkerIcon(event)" alt="" />
                <span v-else class="event-glyph">{{ event.category === 'objective' ? '◆' : event.category === 'level' ? '↑' : '◉' }}</span>
                <div><strong>{{ participant(event.participantId)?.summonerName || (event.teamId ? `Team ${event.teamId}` : "Match") }}</strong>
                  <span>{{ timelineEventDescription(event) }}</span></div>
              </template>
            </article>
          </div>
          <div class="purchase-path">
            <strong>Your purchase path</strong>
            <figure v-for="event in review.timeline.summary.events.filter(event =>
              event.participantId === owner?.participantId && event.type.startsWith('ITEM_')
            )" :key="event.eventId" :title="itemName(event)">
              <img :src="itemIcon(event)" :alt="itemName(event)" />
              <figcaption>{{ eventTime(event.timestamp) }}</figcaption>
            </figure>
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
            ? 'Timeline queued until the League client is connected.'
            : 'Recent timelines come directly from the connected League client.') }}</p>
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
.hero { position: relative; overflow: hidden; border: 1px solid var(--border-strong); border-left: 4px solid var(--border-strong); background: linear-gradient(110deg, color-mix(in srgb, var(--surface-2) 94%, transparent), var(--surface-1)); box-shadow: 0 18px 44px rgba(0, 0, 0, .22); }.hero.won { border-left-color: var(--win); }.hero.lost { border-left-color: var(--loss); }
.hero > img { width: 64px; height: 64px; border-radius: var(--radius-sm); }.grow { flex: 1; }.eyebrow { color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .8px; }
.hero h2 { font: 20px var(--font-heading); color: var(--gold-bright); }.hero p { margin: 3px 0 0; }
.compact-session { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }.compact-session > div { display: flex; flex-direction: column; }.compact-session button { padding: var(--space-2) var(--space-3); }
.review-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.components, .baseline, .highlights, .scoreboard, .events, .turning-points { display: grid; gap: var(--space-2); }
.section-heading { display: flex; justify-content: space-between; align-items: end; gap: var(--space-3); margin-bottom: var(--space-3); }
.component { display: grid; grid-template-columns: minmax(140px, 1fr) 1fr 58px; align-items: center; gap: var(--space-3); }
.component div:first-child { display: flex; flex-direction: column; font-size: 12px; }.numeric { text-align: right; font-variant-numeric: tabular-nums; }
.highlight { display: flex; flex-direction: column; padding: var(--space-2); background: var(--surface-2); border-radius: var(--radius-sm); font-size: 12px; }
.baseline > div { display: grid; grid-template-columns: 1fr 70px 100px; gap: var(--space-2); font-size: 12px; }.positive { color: var(--win); }.negative, .error { color: var(--loss); }
.team-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.score-team { overflow: hidden; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-0); }
.score-team.blue { border-top: 2px solid #3b82c4; }.score-team.red { border-top: 2px solid #c95d65; }
.team-head { display: flex; justify-content: space-between; padding: 8px 10px; background: var(--surface-2); color: var(--text-secondary); font-size: 11px; text-transform: uppercase; letter-spacing: .7px; }
.score-row { display: grid; grid-template-columns: 38px minmax(92px, 1fr) 92px minmax(96px, 1fr) auto 34px; align-items: center; gap: 8px; min-height: 52px; padding: 6px 8px; font-size: 11px; border-bottom: 1px solid var(--border-subtle); }
.score-row:last-child { border-bottom: 0; }.score-row.owner { background: color-mix(in srgb, var(--gold) 13%, transparent); box-shadow: inset 3px 0 var(--gold); }
.champion-portrait { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; }.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.player-block, .kda { min-width: 0; display: flex; flex-direction: column; }.kda span { color: var(--text-muted); font-size: 10px; }
.loadout, .augment-loadout { display: flex; gap: 2px; flex-wrap: wrap; }.loadout img, .augment-loadout img { width: 22px; height: 22px; border-radius: 3px; object-fit: cover; background: var(--surface-3); }
.augment-loadout { max-width: 76px; }.augment-loadout button { display: contents; cursor: pointer; }.augment-missing { color: var(--text-muted); }
.owner-augment-context { display: flex; gap: var(--space-2); flex-wrap: wrap; padding-top: var(--space-3); }.owner-augment-context article { display: flex; gap: 8px; align-items: center; min-width: 200px; padding: 7px 9px; border: 1px solid var(--border-subtle); background: var(--surface-2); border-radius: var(--radius-sm); }.owner-augment-context article > img { width: 34px; height: 34px; border-radius: 50%; }.owner-augment-context article div { display: flex; flex-direction: column; }.text-button { padding: 0; border: 0; background: transparent; color: var(--gold); text-align: left; cursor: pointer; font-size: 10px; }.policy-note { flex-basis: 100%; margin: 2px 0 0; color: var(--text-muted); font-size: 10px; }
textarea { width: 100%; box-sizing: border-box; min-height: 110px; resize: vertical; background: var(--surface-0); color: var(--text-primary); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: var(--space-3); font: 12px var(--font-body); }
.tag-list, .inline, .experiment-outcome, .session-games { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-2); }.tag { border: 1px solid var(--border-subtle); background: var(--surface-2); color: var(--text-secondary); border-radius: 99px; padding: 4px 9px; }.tag.selected { color: var(--gold-bright); border-color: var(--gold); }
.inline input { flex: 1; }.experiment-outcome { justify-content: space-between; align-items: center; }.outcome-note { flex-basis: 100%; }
.gold-chart-wrap { position: relative; height: 220px; overflow: hidden; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: linear-gradient(180deg, color-mix(in srgb, var(--win-dim) 18%, var(--surface-0)) 0 50%, color-mix(in srgb, var(--loss-dim) 18%, var(--surface-0)) 50% 100%); }
.gold-chart { display: block; width: 100%; height: 100%; }.gold-chart line { stroke: var(--border-strong); stroke-width: .35; stroke-dasharray: 2 2; }.gold-chart .grid-line.top, .gold-chart .grid-line.bottom { stroke: var(--border-subtle); }.gold-chart polyline { fill: none; stroke: var(--gold); stroke-width: 2; vector-effect: non-scaling-stroke; filter: drop-shadow(0 0 3px rgba(200, 170, 109, .35)); }
.chart-marker { position: absolute; z-index: 2; display: grid; place-items: center; width: 22px; height: 22px; padding: 0; transform: translate(-50%, -50%); border: 2px solid var(--surface-0); border-radius: 50%; background: var(--surface-3); color: var(--gold-bright); box-shadow: 0 2px 7px rgba(0, 0, 0, .5); cursor: help; transition: width .12s ease, height .12s ease, z-index .12s ease; }.chart-marker:hover, .chart-marker:focus-visible { z-index: 5; width: 30px; height: 30px; outline: 2px solid var(--gold); }.chart-marker img { width: 100%; height: 100%; border-radius: inherit; object-fit: cover; }.chart-marker span { font: 10px var(--font-heading); }.chart-marker.objective { border-color: var(--gold); }.chart-marker.item { border-radius: var(--radius-sm); border-color: var(--win); }.chart-marker.game { border-color: var(--loss); }
.chart-label { position: absolute; left: 8px; z-index: 1; padding: 2px 5px; border-radius: 999px; background: color-mix(in srgb, var(--surface-0) 82%, transparent); font-size: 8px; letter-spacing: .8px; text-transform: uppercase; pointer-events: none; }.chart-label.blue { top: 7px; color: var(--win); }.chart-label.red { bottom: 7px; color: var(--loss); }
.timeline-filters { display: flex; gap: var(--space-2); margin-top: var(--space-2); flex-wrap: wrap; }.timeline-filters button { padding: 4px 8px; font-size: 10px; }
.events { max-height: 430px; overflow: auto; margin-top: var(--space-3); padding-left: 18px; font-size: 11px; color: var(--text-secondary); border-left: 1px solid var(--border-strong); }.event-row { position: relative; display: grid; grid-template-columns: 42px 30px minmax(0, 1fr) 28px; align-items: center; gap: 8px; min-height: 44px; padding: 4px 8px; border-bottom: 1px solid var(--border-subtle); background: color-mix(in srgb, var(--surface-1) 92%, transparent); }.event-row::before { content: ""; position: absolute; left: -22px; width: 7px; height: 7px; border: 2px solid var(--gold); border-radius: 50%; background: var(--surface-0); }.event-row time { color: var(--gold); font-variant-numeric: tabular-nums; }.event-row img { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; }.event-row .victim { filter: grayscale(.35); }.event-row > div { min-width: 0; display: flex; flex-direction: column; }.event-row > div span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.event-glyph { display: grid; place-items: center; width: 26px; height: 26px; border: 1px solid var(--border-strong); border-radius: 50%; color: var(--gold); }.turning-points { margin-top: var(--space-3); font-size: 12px; }
.purchase-path { display: flex; align-items: end; gap: 6px; flex-wrap: wrap; margin-top: var(--space-3); font-size: 10px; }.purchase-path strong { flex-basis: 100%; }.purchase-path figure { margin: 0; text-align: center; }.purchase-path img { display: block; width: 34px; height: 34px; border: 1px solid var(--border-strong); border-radius: 4px; }.purchase-path figcaption { margin-top: 2px; color: var(--text-muted); }
.session-list, .experiments-page { display: grid; gap: var(--space-3); }.session-head > div { display: flex; flex-direction: column; }.match-control { display: flex; align-items: center; position: relative; }.match-chip { display: flex; align-items: center; gap: 4px; background: var(--surface-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 3px; cursor: pointer; }.match-chip img { width: 30px; height: 30px; border-radius: var(--radius-sm); }.boundary summary { cursor: pointer; padding: 0 4px; }.boundary[open] { position: relative; }.boundary[open] > button { display: block; width: 110px; background: var(--surface-3); color: var(--text-primary); border: 1px solid var(--border-subtle); padding: 4px; font-size: 10px; cursor: pointer; }
.experiments-page { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }.experiments-page .card:first-child { display: grid; gap: var(--space-2); }.status { margin-left: var(--space-2); color: var(--gold); text-transform: uppercase; font-size: 10px; }
.scope-label { display: grid; gap: 4px; font-size: 11px; }.scope-label select { min-height: 72px; }.experiment-actions { display: flex; gap: var(--space-2); margin-top: var(--space-2); }.experiment-actions button { padding: 4px 8px; font-size: 10px; }
.bookmark-row { width: 100%; display: grid; grid-template-columns: 34px 1fr 36px; align-items: center; gap: var(--space-2); padding: var(--space-2); background: var(--surface-2); color: var(--text-primary); border: 1px solid var(--border-subtle); text-align: left; }.bookmark-row img { width: 32px; height: 32px; border-radius: 50%; }
@media (max-width: 1050px) { .team-grid { grid-template-columns: 1fr; } }
@media (max-width: 800px) { .review-grid { grid-template-columns: 1fr; }.page-head, .hero { align-items: flex-start; flex-wrap: wrap; }.score-row { grid-template-columns: 38px 1fr 82px 34px; }.score-row .loadout, .score-row .augment-loadout { display: none; }.section-heading { align-items: flex-start; flex-direction: column; }.event-row { grid-template-columns: 36px 26px minmax(0, 1fr); }.event-row .victim { display: none; } }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
</style>
