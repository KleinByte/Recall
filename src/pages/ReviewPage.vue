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
import { laneMatchups, positionIconUrl, positionLabel } from "../helpers/roles"
import { compareMatchup } from "../helpers/matchup"
import { publicAssetUrl } from "../helpers/assets"
import { summonerSpellIconUrl } from "../helpers/ddragon"
import {
  timelineChartDomain,
  timelineChartX,
  timelineTeamGoldAt,
  timelineTeamGoldPoints,
  timelineTeamGoldY,
  sampleTimelineEvents,
} from "../helpers/timeline-chart"
import GradeBadge from "../components/GradeBadge.vue"
import RunePage from "../components/RunePage.vue"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import {
  faArrowTrendDown,
  faArrowTrendUp,
  faBullseye,
  faChevronDown,
  faMedal,
  faSkullCrossbones,
} from "@fortawesome/free-solid-svg-icons"
import type { Champion } from "../types/lol"
import type { MatchRow, ParticipantRow } from "../types/stats"
import type { TrackedMode } from "../types/stats"
import type {
  AnnotationTag,
  ExperimentOutcomeValue,
  MatchReview,
  PracticeExperiment,
  ReviewSession,
  OwnerAugmentSummary,
  BaselineMetric,
  ReviewHighlight,
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
const timelineFilters = ["all", "you", "kills", "objectives", "items", "levels", "vision"] as const
const timelineCursorTimestamp = ref<number>()
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
const showsRoles = computed(() =>
  review.value?.match.modeFamily === "sr" || review.value?.match.modeFamily === "classic",
)

/** Every row stays independently open so two lanes can be compared at once. */
const openMatchups = ref<Record<string, boolean>>({})
const toggleMatchup = (key: string) => {
  openMatchups.value = { ...openMatchups.value, [key]: !openMatchups.value[key] }
}

const matchups = computed(() =>
  laneMatchups(
    teams.value[0].players,
    teams.value[1].players,
    showsRoles.value,
  ))

const teamKills = (teamId: number) =>
  teams.value.find((team) => team.teamId === teamId)?.players
    .reduce((sum, player) => sum + player.kills, 0) ?? 0
const timelineDomain = computed(() => {
  const summary = review.value?.timeline.summary
  return timelineChartDomain(summary?.frames ?? [], summary?.events ?? [])
})
const timelineBluePoints = computed(() => {
  const frames = review.value?.timeline.summary?.frames ?? []
  if (frames.length < 2) return ""
  return timelineTeamGoldPoints(frames, timelineDomain.value, "blue")
})
const timelineRedPoints = computed(() => {
  const frames = review.value?.timeline.summary?.frames ?? []
  if (frames.length < 2) return ""
  return timelineTeamGoldPoints(frames, timelineDomain.value, "red")
})
const finalTimelineFrame = computed(() => review.value?.timeline.summary?.frames.at(-1))
const finalGoldDifference = computed(() =>
  (finalTimelineFrame.value?.blueGold ?? 0) - (finalTimelineFrame.value?.redGold ?? 0),
)
const timelineGoldTicks = computed(() => [
  timelineDomain.value.maximumGold,
  timelineDomain.value.maximumGold / 2,
  0,
].map((gold) => ({ gold, y: timelineTeamGoldY(gold, timelineDomain.value) })))
const compactGold = (gold: number) => `${(gold / 1_000).toFixed(gold >= 10_000 ? 0 : 1)}k`
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
        event.category === "level" &&
        event.participantId === ownerId
      ) ||
      (
        event.category === "item" &&
        event.participantId === ownerId &&
        [
          "ITEM_PURCHASED",
          "ITEM_TRANSFORM",
          "ITEM_TRANSFORMED",
          "ITEM_ACQUIRED",
          "ITEM_OBSERVED",
        ].includes(event.type)
      ),
    )
    : filteredTimelineEvents.value
  const laneByBucket = new Map<number, number>()

  return sampleTimelineEvents(source, 90).map((event) => {
    const x = timelineChartX(event.timestamp, timelineDomain.value)
    const gold = timelineTeamGoldAt(event.timestamp, frames, event.teamId)
    const lineY = timelineTeamGoldY(gold, timelineDomain.value)
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
  if (timelineFilter.value === "all") {
    return events.filter((event) =>
      event.category !== "level" || event.participantId === owner.value?.participantId,
    )
  }
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
const timelineEventCounts = computed(() => {
  const counts = { kills: 0, objectives: 0, items: 0, levels: 0, vision: 0 }
  for (const event of review.value?.timeline.summary?.events ?? []) {
    if (event.category === "kill") counts.kills += 1
    if (event.category === "objective") counts.objectives += 1
    if (event.category === "item") counts.items += 1
    if (event.category === "level") counts.levels += 1
    if (event.category === "vision") counts.vision += 1
  }
  return counts
})
const missingTimelineCategories = computed(() => [
  timelineEventCounts.value.items === 0 ? "item" : undefined,
  timelineEventCounts.value.vision === 0 ? "vision" : undefined,
].filter((category): category is string => Boolean(category)))
const hasApproximateLevels = computed(() =>
  review.value?.timeline.summary?.events.some((event) =>
    event.category === "level" && event.approximate,
  ) ?? false,
)

function timelineFilterAvailable(filter: typeof timelineFilters[number]) {
  if (filter === "all" || filter === "you") return true
  return timelineEventCounts.value[filter] > 0
}

function timelineFilterTitle(filter: typeof timelineFilters[number]) {
  return timelineFilterAvailable(filter)
    ? `${timelineEventCounts.value[filter as keyof typeof timelineEventCounts.value] ?? ""} ${filter} events`.trim()
    : `The League Client did not include ${filter} events for this match.`
}

function participant(participantId?: number) {
  return review.value?.scoreboard.find((entry) => entry.participantId === participantId)
}

function participantByName(name?: string) {
  const normalized = name?.trim().toLocaleLowerCase()
  if (!normalized) return undefined
  return review.value?.scoreboard.find((entry) => {
    const candidate = entry.summonerName?.trim().toLocaleLowerCase()
    return candidate === normalized || candidate?.split("#")[0] === normalized.split("#")[0]
  })
}

function killActor(event: TimelineEvent) {
  return participant(event.participantId) ?? participantByName(event.actorName)
}

const killTarget = (event: TimelineEvent) => participant(event.targetId) ?? participantByName(event.targetName)
const killActorName = (event: TimelineEvent) => killActor(event)?.summonerName ?? event.actorName ?? "Unknown killer"
const killTargetName = (event: TimelineEvent) => killTarget(event)?.summonerName ?? event.targetName ?? `Player ${event.targetId ?? "unknown"}`

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
  const time = `${event.approximate ? "≈" : ""}${eventTime(event.timestamp)}`
  if (event.category === "kill") {
    const killer = killActor(event)?.summonerName
    const victim = killTargetName(event)
    return `${time} · ${killer ?? event.actorName ?? "Unknown killer"} killed ${victim}`
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
  if (event.type === "LEVEL_UP") {
    return `reached level ${event.level ?? "?"}${event.approximate ? " by this snapshot" : ""}`
  }
  return objectiveName(event.objective || event.type)
}

const timelineCursor = computed(() => {
  const timestamp = timelineCursorTimestamp.value
  const summary = review.value?.timeline.summary
  if (timestamp === undefined || !summary) return undefined
  const blueGold = timelineTeamGoldAt(timestamp, summary.frames, 100)
  const redGold = timelineTeamGoldAt(timestamp, summary.frames, 200)
  let blueKills = 0
  let redKills = 0
  for (const event of summary.events) {
    if (event.timestamp > timestamp || event.type !== "CHAMPION_KILL") continue
    const teamId = event.teamId ?? killActor(event)?.teamId
    if (teamId === 100) blueKills += 1
    if (teamId === 200) redKills += 1
  }
  return {
    timestamp,
    x: timelineChartX(timestamp, timelineDomain.value),
    blueGold,
    redGold,
    blueY: timelineTeamGoldY(blueGold, timelineDomain.value),
    redY: timelineTeamGoldY(redGold, timelineDomain.value),
    blueKills,
    redKills,
  }
})

function setTimelineCursor(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  timelineCursorTimestamp.value = ratio * timelineDomain.value.maximumTimestamp
}

function moveTimelineCursor(direction: number) {
  const step = 60_000
  const current = timelineCursorTimestamp.value ?? 0
  timelineCursorTimestamp.value = Math.max(0, Math.min(timelineDomain.value.maximumTimestamp, current + direction * step))
}

function augmentName(augmentId: number) {
  return assets.value.augments[augmentId]?.name ?? `Augment ${augmentId}`
}

function augmentIcon(augmentId: number, fallback?: string) {
  return assets.value.augments[augmentId]?.icon || fallback || publicAssetUrl("recall-icon.png")
}

async function loadAugmentSummary(augmentId: number) {
  const result = (await api.getOwnerAugmentSummaries(augmentId))[0]
  if (result) augmentSummary.value = { ...augmentSummary.value, [augmentId]: result }
}

async function load(gameId?: number) {
  busy.value = true
  error.value = ""
  timelineFilter.value = "all"
  openMatchups.value = {}
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

const gradePercentile = computed(() => Math.round((review.value?.grade?.compositePercentile ?? 0) * 100))
const gradeRingStyle = computed(() => ({
  "--grade-percent": `${Math.max(0, Math.min(100, gradePercentile.value)) * 3.6}deg`,
}))

const baselineDirectional = (metric: BaselineMetric) =>
  metric.difference * (metric.preferredDirection === "higher" ? 1 : -1)

const baselineRelative = (metric: BaselineMetric) =>
  baselineDirectional(metric) / Math.max(.01, Math.abs(metric.baseline))

const baselineBarStyle = (metric: BaselineMetric) => {
  const relative = Math.max(-.5, Math.min(.5, baselineRelative(metric)))
  const width = Math.max(2, Math.abs(relative) * 100)
  return {
    left: relative >= 0 ? "50%" : `${50 - width}%`,
    width: `${width}%`,
  }
}

const signedDifference = (metric: BaselineMetric) => {
  const directional = baselineDirectional(metric)
  return `${directional > 0 ? "+" : directional < 0 ? "−" : ""}${Math.abs(metric.difference).toFixed(1)}`
}

const baselineSummary = computed(() => {
  const metrics = review.value?.baseline?.metrics ?? []
  return metrics.reduce((summary, metric) => {
    const relative = baselineRelative(metric)
    if (relative > .03) summary.improved += 1
    else if (relative < -.03) summary.declined += 1
    else summary.steady += 1
    return summary
  }, { improved: 0, declined: 0, steady: 0 })
})

const formatComparison = (value: number) => Math.abs(value) >= 1_000
  ? Math.round(value).toLocaleString()
  : value.toFixed(Math.abs(value) >= 100 ? 0 : 1)

const highlightComponent = (highlight: ReviewHighlight) =>
  review.value?.grade?.components.find((component) => component.key === highlight.metricKey)

const highlightBaseline = (highlight: ReviewHighlight) =>
  review.value?.baseline?.metrics.find((metric) => metric.key === highlight.metricKey)

const highlightIcon = (highlight: ReviewHighlight) => {
  if (highlight.kind === "strength") return faMedal
  if (highlight.kind === "opportunity") return faBullseye
  if (highlight.kind === "improvement") return faArrowTrendUp
  return faArrowTrendDown
}

const highlightValue = (highlight: ReviewHighlight) => {
  const component = highlightComponent(highlight)
  if (component) return `${Math.round(component.percentile * 100)}th`
  const metric = highlightBaseline(highlight)
  return metric ? signedDifference(metric) : "—"
}

const highlightContext = (highlight: ReviewHighlight) => {
  const component = highlightComponent(highlight)
  if (component) return `${component.label} · lobby percentile`
  const metric = highlightBaseline(highlight)
  return metric ? `${metric.label} · versus your prior average` : highlight.title
}

const highlightMessage = (highlight: ReviewHighlight) => {
  if (highlight.kind === "strength") return "Your clearest advantage in this lobby."
  if (highlight.kind === "opportunity") return "The clearest place to recover value next game."
  if (highlight.kind === "improvement") return "Meaningfully ahead of your recent baseline."
  return "Below your recent baseline and worth reviewing."
}

const MATCHUP_GROUPS = [
  { label: "Combat", keys: ["kills", "deaths", "assists", "damage", "physical", "magic", "true"] },
  { label: "Resources", keys: ["champLevel", "cs", "goldEarned", "spree", "multiKill"] },
  { label: "Durability", keys: ["damageTaken", "mitigated", "heal", "healedOthers"] },
  { label: "Map impact", keys: ["cc", "vision", "wardsPlaced", "wardsKilled", "controlWards", "objectives", "turretDamage", "turretKills"] },
] as const

const matchupComparisonGroups = (left?: ParticipantRow, right?: ParticipantRow) => {
  const comparisons = compareMatchup(left, right)
  return MATCHUP_GROUPS.map((group) => ({
    label: group.label,
    rows: group.keys.flatMap((key) => {
      const comparison = comparisons.find((entry) => entry.key === key)
      return comparison ? [comparison] : []
    }),
  }))
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
        <section class="card grade-card">
          <div class="section-heading compact-heading">
            <div><span class="eyebrow">Performance model</span><h2 class="section-title">Why this grade</h2></div>
            <span v-if="review.grade" class="algorithm-label">Lobby-relative · weighted by role</span>
          </div>
          <p v-if="review.grade?.unavailableReason" class="muted">{{ review.grade.unavailableReason }}</p>
          <div v-else-if="review.grade" class="grade-story">
            <div class="grade-orbit" :style="gradeRingStyle">
              <div>
                <strong>{{ gradePercentile }}</strong>
                <span>lobby score</span>
              </div>
            </div>
            <div class="components">
              <div v-for="component in review.grade.components" :key="component.key" class="component">
                <div class="component-copy">
                  <strong>{{ component.label }}</strong>
                  <span>{{ Math.round(component.weight * 100) }}% influence</span>
                </div>
                <div class="track" :title="`${component.label}: ${percent(component.percentile)} ${component.scope} percentile`">
                  <span class="fill" :style="{ width: percent(component.percentile) }" />
                  <i class="median" aria-hidden="true" />
                </div>
                <strong class="component-percent">{{ percent(component.percentile) }}</strong>
              </div>
            </div>
          </div>
          <div v-if="review.highlights.length" class="highlights">
            <article v-for="highlight in review.highlights" :key="highlight.kind" class="highlight" :class="highlight.kind">
              <span class="highlight-icon"><FontAwesomeIcon :icon="highlightIcon(highlight)" aria-hidden="true" /></span>
              <span class="highlight-copy">
                <span class="highlight-title">{{ highlight.title }}</span>
                <strong>{{ highlightMessage(highlight) }}</strong>
                <small>{{ highlightContext(highlight) }}</small>
              </span>
              <strong class="highlight-value">{{ highlightValue(highlight) }}</strong>
            </article>
          </div>
        </section>

        <section class="card baseline-card">
          <div class="section-heading compact-heading">
            <div><span class="eyebrow">Personal context</span><h2 class="section-title">Against your prior games</h2></div>
            <span v-if="review.baseline" class="sample-badge">
              {{ review.baseline.games }} games · {{ review.baseline.confidence }} confidence
            </span>
          </div>
          <template v-if="review.baseline">
            <div class="baseline-summary" aria-label="Comparison summary">
              <span class="positive"><strong>{{ baselineSummary.improved }}</strong> improved</span>
              <span><strong>{{ baselineSummary.steady }}</strong> close</span>
              <span class="negative"><strong>{{ baselineSummary.declined }}</strong> declined</span>
            </div>
            <div class="baseline">
              <article v-for="metric in review.baseline.metrics" :key="metric.key" class="baseline-row">
                <header>
                  <strong>{{ metric.label }}</strong>
                  <span :class="{
                    positive: baselineDirectional(metric) > 0,
                    negative: baselineDirectional(metric) < 0,
                  }">
                    {{ baselineDirectional(metric) > 0 ? '▲' : baselineDirectional(metric) < 0 ? '▼' : '•' }}
                    {{ signedDifference(metric) }}
                  </span>
                </header>
                <div class="baseline-axis" aria-hidden="true">
                  <i class="zero" />
                  <span :class="baselineDirectional(metric) >= 0 ? 'positive' : 'negative'"
                    :style="baselineBarStyle(metric)" />
                </div>
                <footer>
                  <span><small>This match</small><strong>{{ formatComparison(metric.current) }}</strong></span>
                  <span><small>Prior average</small><strong>{{ formatComparison(metric.baseline) }}</strong></span>
                </footer>
              </article>
            </div>
            <p class="baseline-scope muted">Compared with {{ review.baseline.scope.replaceAll('_', ' ') }} matches before this game.</p>
          </template>
          <p v-else class="muted">No earlier matching games are available yet.</p>
        </section>
      </div>

      <section class="card">
        <div class="section-heading">
          <div><span class="eyebrow">Complete lobby</span><h2 class="section-title">Scoreboard</h2></div>
          <span v-if="showsRoles" class="muted">Each row is a lane matchup · open as many as you like to compare</span>
        </div>

        <div class="matchups" :class="{ roleless: !showsRoles }">
          <div class="matchup-columns muted">
            <span class="side-title blue">Blue team · {{ teamKills(100) }} kills</span>
            <span class="lane-title">{{ showsRoles ? "Role" : "" }}</span>
            <span class="side-title red">Red team · {{ teamKills(200) }} kills</span>
            <span />
          </div>

          <article v-for="row in matchups" :key="row.key" class="matchup"
            :class="{ open: openMatchups[row.key] }">
            <div class="matchup-row" role="button" tabindex="0" :aria-expanded="openMatchups[row.key] === true"
              @click="toggleMatchup(row.key)" @keydown.enter.prevent="toggleMatchup(row.key)"
              @keydown.space.prevent="toggleMatchup(row.key)">
              <div class="seat left" :class="{ owner: row.left?.isPlayer, vacant: !row.left }">
                <template v-if="row.left">
                  <div class="seat-body">
                    <div class="seat-identity">
                      <strong class="name" :title="row.left.summonerName">{{ row.left.summonerName || championNameById(champions, row.left.championId) }}</strong>
                      <span class="muted seat-line">
                        {{ row.left.kills }}/{{ row.left.deaths }}/{{ row.left.assists }} ·
                        {{ row.left.totalMinionsKilled + row.left.neutralMinions }} CS ·
                        {{ row.left.damageToChampions.toLocaleString() }} dmg
                      </span>
                    </div>
                    <div class="seat-kit">
                      <span class="score-spells" aria-label="Summoner spells">
                        <template v-for="spell in [row.left.spell1Id, row.left.spell2Id]" :key="spell">
                          <img v-if="summonerSpellIconUrl(spell)" :src="summonerSpellIconUrl(spell)" alt="" />
                        </template>
                      </span>
                      <RunePage :participant="row.left" :classic="review.match.modeFamily === 'classic'" align="left" compact />
                      <div class="loadout" aria-label="Final items">
                        <img v-for="(id, index) in row.left.items.filter(Boolean)" :key="`${id}-${index}`"
                          :src="assets.items[id]?.icon || itemIconUrl(id, assets.version)"
                          :title="assets.items[id]?.name || `Item ${id}`" alt="" />
                      </div>
                    </div>
                  </div>
                  <GradeBadge :grade="row.left.grade" />
                  <img class="champion-portrait" :src="championIconUrl(row.left.championId)"
                    :alt="championNameById(champions, row.left.championId)" />
                </template>
                <span v-else class="muted">No player</span>
              </div>

              <span v-if="showsRoles && row.position" class="lane">
                <img :src="positionIconUrl(row.position)" class="lane-icon" alt="" />
                <span>{{ positionLabel(row.position) }}</span>
              </span>
              <span v-else class="lane" aria-hidden="true" />

              <div class="seat right" :class="{ owner: row.right?.isPlayer, vacant: !row.right }">
                <template v-if="row.right">
                  <img class="champion-portrait" :src="championIconUrl(row.right.championId)"
                    :alt="championNameById(champions, row.right.championId)" />
                  <GradeBadge :grade="row.right.grade" />
                  <div class="seat-body">
                    <div class="seat-identity">
                      <strong class="name" :title="row.right.summonerName">{{ row.right.summonerName || championNameById(champions, row.right.championId) }}</strong>
                      <span class="muted seat-line">
                        {{ row.right.kills }}/{{ row.right.deaths }}/{{ row.right.assists }} ·
                        {{ row.right.totalMinionsKilled + row.right.neutralMinions }} CS ·
                        {{ row.right.damageToChampions.toLocaleString() }} dmg
                      </span>
                    </div>
                    <div class="seat-kit">
                      <div class="loadout" aria-label="Final items">
                        <img v-for="(id, index) in row.right.items.filter(Boolean)" :key="`${id}-${index}`"
                          :src="assets.items[id]?.icon || itemIconUrl(id, assets.version)"
                          :title="assets.items[id]?.name || `Item ${id}`" alt="" />
                      </div>
                      <RunePage :participant="row.right" :classic="review.match.modeFamily === 'classic'" align="right" compact />
                      <span class="score-spells" aria-label="Summoner spells">
                        <template v-for="spell in [row.right.spell1Id, row.right.spell2Id]" :key="spell">
                          <img v-if="summonerSpellIconUrl(spell)" :src="summonerSpellIconUrl(spell)" alt="" />
                        </template>
                      </span>
                    </div>
                  </div>
                </template>
                <span v-else class="muted">No player</span>
              </div>

              <FontAwesomeIcon :icon="faChevronDown" class="matchup-chevron" aria-hidden="true" />
            </div>

            <div v-if="openMatchups[row.key]" class="comparison">
              <header class="comparison-head">
                <strong>{{ row.left?.summonerName || 'Blue player' }}</strong>
                <span>{{ row.position ? `${positionLabel(row.position)} head-to-head` : 'Player comparison' }}</span>
                <strong>{{ row.right?.summonerName || 'Red player' }}</strong>
              </header>
              <div class="comparison-sheet">
                <section v-for="group in matchupComparisonGroups(row.left, row.right)" :key="group.label" class="compare-group">
                  <h4>{{ group.label }}</h4>
                  <div v-for="stat in group.rows" :key="stat.key" class="compare-row">
                    <span class="numeric compare-value" :class="{ ahead: stat.leads === 'left' }">
                      {{ stat.left.toLocaleString() }}
                    </span>
                    <span class="compare-label">{{ stat.label }}</span>
                    <span class="numeric compare-value" :class="{ ahead: stat.leads === 'right' }">
                      {{ stat.right.toLocaleString() }}
                    </span>
                  </div>
                </section>
              </div>

              <div v-if="row.left?.augments?.length || row.right?.augments?.length" class="compare-augments">
                <div class="augment-loadout" aria-label="Selected augments">
                  <button v-for="augment in row.left?.augments ?? []" :key="augment.slot"
                    :title="augmentName(augment.augmentId)"
                    @click="row.left?.isPlayer && loadAugmentSummary(augment.augmentId)">
                    <img :src="augmentIcon(augment.augmentId, augment.iconPath)" alt="" />
                  </button>
                </div>
                <span class="compare-label muted">Augments</span>
                <div class="augment-loadout" aria-label="Selected augments">
                  <button v-for="augment in row.right?.augments ?? []" :key="augment.slot"
                    :title="augmentName(augment.augmentId)"
                    @click="row.right?.isPlayer && loadAugmentSummary(augment.augmentId)">
                    <img :src="augmentIcon(augment.augmentId, augment.iconPath)" alt="" />
                  </button>
                </div>
              </div>

            </div>
          </article>
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
          <span class="muted">Events and periodic snapshots from the connected League Client</span>
        </div>
        <div v-if="review.timeline.status === 'ready' && review.timeline.summary">
          <div class="gold-chart-wrap" tabindex="0" aria-label="Interactive team gold chart. Use left and right arrow keys to inspect each minute."
            @pointermove="setTimelineCursor" @pointerleave="timelineCursorTimestamp = undefined"
            @focus="timelineCursorTimestamp ??= timelineDomain.maximumTimestamp"
            @keydown.left.prevent="moveTimelineCursor(-1)" @keydown.right.prevent="moveTimelineCursor(1)">
            <svg class="gold-chart" viewBox="0 0 100 100" preserveAspectRatio="none"
              aria-label="Blue and Red team total gold across the match">
              <line class="grid-line top" x1="0" y1="25" x2="100" y2="25" />
              <line class="grid-line" x1="0" y1="50" x2="100" y2="50" />
              <line class="grid-line bottom" x1="0" y1="75" x2="100" y2="75" />
              <polyline class="blue-series" :points="timelineBluePoints" />
              <polyline class="red-series" :points="timelineRedPoints" />
            </svg>
            <template v-if="timelineCursor">
              <span class="chart-crosshair" :style="{ left: `${timelineCursor.x}%` }" />
              <span class="cursor-dot blue" :style="{ left: `${timelineCursor.x}%`, top: `${timelineCursor.blueY}%` }" />
              <span class="cursor-dot red" :style="{ left: `${timelineCursor.x}%`, top: `${timelineCursor.redY}%` }" />
              <output class="chart-tooltip" :class="{ flip: timelineCursor.x > 68 }" :style="{ left: `${timelineCursor.x}%` }">
                <strong>{{ eventTime(timelineCursor.timestamp) }}</strong>
                <span class="blue">Blue {{ timelineCursor.blueGold.toLocaleString() }}g · {{ timelineCursor.blueKills }} kills</span>
                <span class="red">Red {{ timelineCursor.redGold.toLocaleString() }}g · {{ timelineCursor.redKills }} kills</span>
                <small>{{ Math.abs(timelineCursor.blueGold - timelineCursor.redGold).toLocaleString() }}g {{ timelineCursor.blueGold >= timelineCursor.redGold ? "Blue" : "Red" }} lead</small>
              </output>
            </template>
            <span
              v-for="tick in timelineGoldTicks"
              :key="tick.gold"
              class="gold-axis-label"
              :style="{ top: `${tick.y}%` }"
            >{{ compactGold(tick.gold) }}</span>
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
            <span class="time-axis start">0:00</span>
            <span class="time-axis end">{{ formatDuration(timelineDomain.maximumTimestamp / 1_000) }}</span>
          </div>
          <div v-if="finalTimelineFrame" class="gold-legend" aria-label="Final team gold totals">
            <span class="blue"><i />Blue <strong>{{ compactGold(finalTimelineFrame.blueGold) }}</strong></span>
            <span class="red"><i />Red <strong>{{ compactGold(finalTimelineFrame.redGold) }}</strong></span>
            <span class="difference" :class="finalGoldDifference >= 0 ? 'blue' : 'red'">
              {{ finalGoldDifference >= 0 ? "Blue" : "Red" }} finished
              {{ Math.abs(finalGoldDifference).toLocaleString() }}g ahead
            </span>
          </div>
          <div class="timeline-filters">
            <button v-for="filter in timelineFilters"
              :key="filter" class="league-button" :class="{ active: timelineFilter === filter }"
              :disabled="!timelineFilterAvailable(filter)"
              :title="timelineFilterTitle(filter)"
              @click="timelineFilter = filter">
              {{ filter[0].toUpperCase() + filter.slice(1) }}
            </button>
          </div>
          <p v-if="missingTimelineCategories.length || hasApproximateLevels" class="timeline-source-note">
            <template v-if="missingTimelineCategories.length">
              The League Client did not include {{ missingTimelineCategories.join(" or ") }} event timing for this match.
              Final builds and vision totals are shown in the scoreboard above.
            </template>
            <template v-if="hasApproximateLevels">
              Level times are reconstructed from periodic snapshots and marked ≈.
            </template>
          </p>
          <div class="events">
            <article v-for="event in filteredTimelineEvents.slice(0, 160)"
              :key="event.eventId" class="event-row" :class="event.category">
              <time>{{ event.approximate ? "≈" : "" }}{{ eventTime(event.timestamp) }}</time>
              <template v-if="event.category === 'kill'">
                <img :src="championIconUrl(killActor(event)?.championId || 0)" :alt="killActorName(event)" />
                <div><strong>{{ killActorName(event) }}</strong>
                  <span class="kill-summary"><FontAwesomeIcon :icon="faSkullCrossbones" class="kill-feed-icon" aria-label="killed" /> <strong>{{ killTargetName(event) }}</strong>
                    <template v-if="event.assistingParticipantIds?.length">
                      · assisted by {{ event.assistingParticipantIds.map(id => participant(id)?.summonerName || `Player ${id}`).join(", ") }}
                    </template>
                  </span></div>
                <img class="victim" :src="championIconUrl(killTarget(event)?.championId || 0)" :alt="killTargetName(event)" />
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
          <div v-if="review.timeline.summary.events.some(event =>
            event.participantId === owner?.participantId && event.type.startsWith('ITEM_')
          )" class="purchase-path">
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
            <option value="league_classic">League Classic</option>
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
.review-page { display: flex; flex-direction: column; gap: var(--space-4); max-width: 1380px; margin: 0 auto; }
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
.grade-card, .baseline-card { min-height: 380px; }
.components, .baseline, .highlights, .scoreboard, .events, .turning-points { display: grid; gap: var(--space-2); }
.section-heading { display: flex; justify-content: space-between; align-items: end; gap: var(--space-3); margin-bottom: var(--space-3); }
.compact-heading { align-items: start; margin-bottom: var(--space-3); }
.algorithm-label, .sample-badge { padding: 4px 8px; border: 1px solid var(--border-subtle); border-radius: 999px; color: var(--text-muted); background: var(--surface-1); font-size: 9px; text-transform: uppercase; letter-spacing: .6px; white-space: nowrap; }
.grade-story { display: grid; grid-template-columns: 104px minmax(0, 1fr); align-items: center; gap: var(--space-4); }
.grade-orbit { display: grid; place-items: center; width: 94px; height: 94px; border-radius: 50%; background: conic-gradient(var(--gold-bright) var(--grade-percent), var(--surface-3) 0); box-shadow: 0 0 24px rgba(200,170,109,.16); }
.grade-orbit::before { content: ""; grid-area: 1 / 1; width: 76px; height: 76px; border-radius: 50%; background: radial-gradient(circle at 50% 24%, var(--surface-2), var(--surface-0)); box-shadow: inset 0 0 0 1px var(--border-subtle); }
.grade-orbit > div { z-index: 1; grid-area: 1 / 1; display: flex; flex-direction: column; align-items: center; }
.grade-orbit strong { color: var(--gold-bright); font: 25px var(--font-display); line-height: 1; }
.grade-orbit span { margin-top: 4px; color: var(--text-muted); font-size: 9px; text-transform: uppercase; letter-spacing: .7px; }
.component { display: grid; grid-template-columns: minmax(76px, .8fr) 1.3fr 36px; align-items: center; gap: 8px; }
.component-copy { display: flex; flex-direction: column; min-width: 0; }
.component-copy strong { color: var(--text-secondary); font-size: 10px; }
.component-copy span { color: var(--text-muted); font-size: 9px; }
.component .track { position: relative; height: 6px; }
.component .median { position: absolute; left: 50%; top: -2px; width: 1px; height: 10px; background: rgba(255,255,255,.28); }
.component-percent { color: var(--text-primary); font-size: 10px; text-align: right; }
.numeric { text-align: right; font-variant-numeric: tabular-nums; }
.highlights { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: var(--space-4); }
.highlight { position: relative; display: grid; grid-template-columns: 28px minmax(0,1fr); gap: 7px; min-height: 82px; padding: 9px; overflow: hidden; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: linear-gradient(140deg, var(--surface-2), var(--surface-1)); }
.highlight::after { content: ""; position: absolute; right: -24px; bottom: -28px; width: 72px; height: 72px; border-radius: 50%; background: currentColor; opacity: .06; }
.highlight.strength, .highlight.improvement { color: var(--win); }.highlight.opportunity, .highlight.regression { color: var(--loss); }
.highlight-icon { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: color-mix(in srgb, currentColor 14%, transparent); }
.highlight-copy { display: flex; flex-direction: column; min-width: 0; }
.highlight-title { color: currentColor; font-size: 9px; text-transform: uppercase; letter-spacing: .7px; }
.highlight-copy strong { margin-top: 4px; color: var(--text-primary); font-size: 10px; line-height: 1.3; }
.highlight-copy small { margin-top: 4px; color: var(--text-muted); font-size: 9px; line-height: 1.35; }
.highlight-value { position: absolute; right: 8px; top: 7px; color: currentColor; font: 14px var(--font-heading); opacity: .92; }
.baseline-summary { display: grid; grid-template-columns: repeat(3, 1fr); margin-bottom: var(--space-3); overflow: hidden; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); }
.baseline-summary span { display: flex; justify-content: center; align-items: baseline; gap: 4px; padding: 7px; border-left: 1px solid var(--border-subtle); color: var(--text-muted); font-size: 9px; text-transform: uppercase; letter-spacing: .45px; }
.baseline-summary span:first-child { border-left: 0; }.baseline-summary strong { font-size: 13px; }
.baseline { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 12px; }
.baseline-row { display: grid; gap: 5px; padding-bottom: 7px; border-bottom: 1px solid var(--border-subtle); }
.baseline-row header, .baseline-row footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.baseline-row header > strong { color: var(--text-secondary); font-size: 10px; }.baseline-row header > span { font-size: 10px; font-weight: 700; }
.baseline-axis { position: relative; height: 5px; border-radius: 4px; background: var(--surface-3); }
.baseline-axis .zero { position: absolute; z-index: 1; left: 50%; top: -2px; width: 1px; height: 9px; background: var(--text-muted); opacity: .7; }
.baseline-axis > span { position: absolute; top: 0; height: 100%; border-radius: 4px; background: currentColor; }
.baseline-row footer span { display: flex; align-items: baseline; gap: 4px; }.baseline-row footer small { color: var(--text-muted); font-size: 9px; }.baseline-row footer strong { color: var(--text-primary); font-size: 10px; }
.baseline-scope { margin: var(--space-3) 0 0; font-size: 9px; text-align: right; }
.positive { color: var(--win); }.negative, .error { color: var(--loss); }
.matchups { --matchup-grid: minmax(0, 1fr) 108px minmax(0, 1fr) 18px; display: grid; gap: var(--space-1); }
.matchups.roleless { --matchup-grid: minmax(0, 1fr) 0 minmax(0, 1fr) 18px; }
.matchup-columns { display: grid; grid-template-columns: var(--matchup-grid); gap: 8px; padding: 0 10px 2px; font-family: var(--font-heading); font-size: 10px; letter-spacing: .8px; text-transform: uppercase; }
.side-title.blue { color: #7fb2e0; }.side-title.red { color: #e0918f; }
.side-title.red, .lane-title { text-align: center; }.side-title.red { text-align: right; }
.matchup { border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-0); overflow: visible; }
.matchup.open { border-color: var(--border-strong); }
.matchup-row { width: 100%; display: grid; grid-template-columns: var(--matchup-grid); align-items: center; gap: 8px; min-height: 62px; padding: 5px 10px; background: transparent; border: 0; color: inherit; text-align: left; font: inherit; font-size: 11px; cursor: pointer; }
.matchup-row:hover { background: var(--surface-2); }
.seat { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 3px 6px; border-radius: var(--radius-sm); }
.seat.right { flex-direction: row; justify-content: flex-end; text-align: right; }
.seat.owner { background: color-mix(in srgb, var(--gold) 13%, transparent); box-shadow: inset 3px 0 var(--gold); }
.seat.right.owner { box-shadow: inset -3px 0 var(--gold); }
.seat.vacant { justify-content: center; }
.seat-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 auto; }
.seat.right .seat-body { align-items: flex-end; }
.seat-identity { display: flex; align-items: baseline; gap: 7px; width: 100%; min-width: 0; }
.seat.right .seat-identity { flex-direction: row-reverse; }
.seat-identity .name { flex: 1 1 auto; min-width: 110px; color: var(--text-primary); font-size: 11px; }
.seat-line { flex: 0 0 auto; font-size: 9px; white-space: nowrap; }
.seat-kit { display: flex; align-items: center; gap: 4px; min-width: 0; width: 100%; }
.seat.right .seat-kit { justify-content: flex-end; }
.score-spells { display: grid; grid-template-columns: repeat(2, 16px); gap: 2px; flex: 0 0 auto; }
.score-spells img { width: 16px; height: 16px; border-radius: 3px; object-fit: cover; }
.seat.right .loadout { justify-content: flex-end; }
.lane { display: flex; flex-direction: column; align-items: center; gap: 2px; color: var(--text-secondary); font-family: var(--font-heading); font-size: 10px; letter-spacing: .6px; text-transform: uppercase; }
.lane-icon { width: 22px; height: 22px; opacity: .84; }
.matchup-chevron { color: var(--text-muted); font-size: 10px; transition: transform .15s ease; }
.matchup.open .matchup-chevron { transform: rotate(180deg); }
.comparison { display: grid; gap: 10px; padding: 10px 14px 12px; border-top: 1px solid var(--border-subtle); background: linear-gradient(180deg, color-mix(in srgb, var(--surface-1) 86%, #102740), var(--surface-0)); }
.comparison-head { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; padding-bottom: 7px; border-bottom: 1px solid var(--border-strong); font-size: 11px; }
.comparison-head strong:last-child { text-align: right; }.comparison-head span { color: var(--gold); text-transform: uppercase; letter-spacing: .7px; }
.comparison-sheet { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; }
.compare-group { min-width: 0; }.compare-group h4 { margin: 0 0 4px; padding-bottom: 4px; border-bottom: 1px solid var(--border-subtle); color: var(--gold); font: 10px var(--font-heading); letter-spacing: .8px; text-transform: uppercase; }
.compare-row { display: grid; grid-template-columns: 72px minmax(0, 1fr) 72px; align-items: center; min-height: 24px; border-bottom: 1px solid color-mix(in srgb, var(--border-subtle) 50%, transparent); font-size: 10px; }
.compare-row .compare-value:last-child { text-align: left; }
.compare-augments { display: grid; grid-template-columns: 62px minmax(0, 1fr) 150px minmax(0, 1fr) 62px; align-items: center; gap: 8px; font-size: 11px; }
.compare-augments { padding-top: var(--space-2); }
.compare-augments .augment-loadout:first-of-type { grid-column: 1 / 3; }
.compare-augments .augment-loadout:last-of-type { grid-column: 4 / 6; justify-content: flex-end; }
.compare-label { text-align: center; color: var(--text-muted); font-size: 9px; }
.compare-value { color: var(--text-secondary); }
.compare-value:first-child { text-align: right; }
.compare-value.ahead { color: var(--gold-bright); }
.champion-portrait { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; }.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loadout, .augment-loadout { display: flex; gap: 2px; flex-wrap: nowrap; }.loadout img, .augment-loadout img { width: 19px; height: 19px; border-radius: 3px; object-fit: cover; background: var(--surface-3); }
.augment-loadout { max-width: 76px; }.augment-loadout button { display: contents; cursor: pointer; }
.owner-augment-context { display: flex; gap: var(--space-2); flex-wrap: wrap; padding-top: var(--space-3); }.owner-augment-context article { display: flex; gap: 8px; align-items: center; min-width: 200px; padding: 7px 9px; border: 1px solid var(--border-subtle); background: var(--surface-2); border-radius: var(--radius-sm); }.owner-augment-context article > img { width: 34px; height: 34px; border-radius: 50%; }.owner-augment-context article div { display: flex; flex-direction: column; }.text-button { padding: 0; border: 0; background: transparent; color: var(--gold); text-align: left; cursor: pointer; font-size: 10px; }.policy-note { flex-basis: 100%; margin: 2px 0 0; color: var(--text-muted); font-size: 10px; }
textarea { width: 100%; box-sizing: border-box; min-height: 110px; resize: vertical; background: var(--surface-0); color: var(--text-primary); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: var(--space-3); font: 12px var(--font-body); }
.tag-list, .inline, .experiment-outcome, .session-games { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-2); }.tag { border: 1px solid var(--border-subtle); background: var(--surface-2); color: var(--text-secondary); border-radius: 99px; padding: 4px 9px; }.tag.selected { color: var(--gold-bright); border-color: var(--gold); }
.inline input { flex: 1; }.experiment-outcome { justify-content: space-between; align-items: center; }.outcome-note { flex-basis: 100%; }
.gold-chart-wrap { position: relative; height: 238px; overflow: hidden; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: linear-gradient(180deg, color-mix(in srgb, var(--surface-2) 82%, #0b2742) 0%, var(--surface-0) 58%, color-mix(in srgb, var(--surface-2) 84%, #35131c) 100%); }
.gold-chart-wrap:focus-visible { outline: 1px solid var(--gold); outline-offset: 2px; }
.gold-chart { display: block; width: 100%; height: 100%; }.gold-chart line { stroke: var(--border-strong); stroke-width: .35; stroke-dasharray: 2 2; }.gold-chart .grid-line.top, .gold-chart .grid-line.bottom { stroke: var(--border-subtle); }.gold-chart polyline { fill: none; stroke-width: 2.2; vector-effect: non-scaling-stroke; }.gold-chart .blue-series { stroke: #35b9dd; filter: drop-shadow(0 0 4px rgba(53, 185, 221, .45)); }.gold-chart .red-series { stroke: #e45868; filter: drop-shadow(0 0 4px rgba(228, 88, 104, .38)); }
.chart-marker { position: absolute; z-index: 2; display: grid; place-items: center; width: 22px; height: 22px; padding: 0; transform: translate(-50%, -50%); border: 2px solid var(--surface-0); border-radius: 50%; background: var(--surface-3); color: var(--gold-bright); box-shadow: 0 2px 7px rgba(0, 0, 0, .5); cursor: help; transition: width .12s ease, height .12s ease, z-index .12s ease; }.chart-marker:hover, .chart-marker:focus-visible { z-index: 5; width: 30px; height: 30px; outline: 2px solid var(--gold); }.chart-marker img { width: 100%; height: 100%; border-radius: inherit; object-fit: cover; }.chart-marker span { font: 10px var(--font-heading); }.chart-marker.objective { border-color: var(--gold); }.chart-marker.item { border-radius: var(--radius-sm); border-color: var(--win); }.chart-marker.game { border-color: var(--loss); }
.gold-axis-label { position: absolute; left: 7px; z-index: 1; transform: translateY(-50%); color: var(--text-muted); font-size: 8px; font-variant-numeric: tabular-nums; pointer-events: none; }.time-axis { position: absolute; bottom: 5px; z-index: 1; color: var(--text-muted); font-size: 8px; pointer-events: none; }.time-axis.start { left: 7px; }.time-axis.end { right: 7px; }.gold-legend { display: flex; align-items: center; gap: var(--space-3); min-height: 34px; padding: 6px 9px; border: 1px solid var(--border-subtle); border-top: 0; border-radius: 0 0 var(--radius-md) var(--radius-md); background: var(--surface-2); color: var(--text-secondary); font-size: 10px; }.gold-legend > span { display: inline-flex; align-items: center; gap: 5px; }.gold-legend i { width: 14px; height: 3px; border-radius: 2px; }.gold-legend .blue i { background: #35b9dd; }.gold-legend .red i { background: #e45868; }.gold-legend strong { color: var(--text-primary); }.gold-legend .difference { margin-left: auto; }.gold-legend .difference.blue { color: #60cbea; }.gold-legend .difference.red { color: #ef7b88; }
.chart-crosshair { position: absolute; z-index: 3; top: 0; bottom: 0; width: 1px; background: rgba(255,255,255,.48); pointer-events: none; }
.cursor-dot { position: absolute; z-index: 4; width: 9px; height: 9px; transform: translate(-50%,-50%); border: 2px solid var(--surface-0); border-radius: 50%; pointer-events: none; }.cursor-dot.blue { background: #35b9dd; }.cursor-dot.red { background: #e45868; }
.chart-tooltip { position: absolute; z-index: 8; top: 10px; display: flex; flex-direction: column; gap: 2px; min-width: 154px; padding: 8px 9px; transform: translateX(8px); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: rgba(5,12,24,.95); box-shadow: 0 8px 24px rgba(0,0,0,.45); color: var(--text-secondary); font-size: 9px; pointer-events: none; }.chart-tooltip.flip { transform: translateX(calc(-100% - 8px)); }.chart-tooltip strong { color: var(--gold-bright); }.chart-tooltip .blue { color: #60cbea; }.chart-tooltip .red { color: #ef7b88; }.chart-tooltip small { color: var(--text-muted); }
.timeline-filters { display: flex; gap: var(--space-2); margin-top: var(--space-2); flex-wrap: wrap; }.timeline-filters button { padding: 4px 8px; font-size: 10px; }
.timeline-filters button:disabled { opacity: .42; cursor: not-allowed; }.timeline-source-note { margin: var(--space-2) 0 0; color: var(--text-muted); font-size: 10px; }
.events { max-height: 430px; overflow: auto; margin-top: var(--space-3); padding-left: 18px; font-size: 11px; color: var(--text-secondary); border-left: 1px solid var(--border-strong); }.event-row { position: relative; display: grid; grid-template-columns: 42px 30px minmax(0, 1fr) 28px; align-items: center; gap: 8px; min-height: 44px; padding: 4px 8px; border-bottom: 1px solid var(--border-subtle); background: color-mix(in srgb, var(--surface-1) 92%, transparent); }.event-row::before { content: ""; position: absolute; left: -22px; width: 7px; height: 7px; border: 2px solid var(--gold); border-radius: 50%; background: var(--surface-0); }.event-row time { color: var(--gold); font-variant-numeric: tabular-nums; }.event-row img { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; }.event-row .victim { filter: grayscale(.35); }.event-row > div { min-width: 0; display: flex; flex-direction: column; }.event-row > div span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.event-glyph { display: grid; place-items: center; width: 26px; height: 26px; border: 1px solid var(--border-strong); border-radius: 50%; color: var(--gold); }.turning-points { margin-top: var(--space-3); font-size: 12px; }
.kill-summary { display: inline-flex; align-items: center; gap: 5px; }.kill-feed-icon { color: #c8aa6e; filter: drop-shadow(0 0 3px rgba(200,170,110,.45)); }
.purchase-path { display: flex; align-items: end; gap: 6px; flex-wrap: wrap; margin-top: var(--space-3); font-size: 10px; }.purchase-path strong { flex-basis: 100%; }.purchase-path figure { margin: 0; text-align: center; }.purchase-path img { display: block; width: 34px; height: 34px; border: 1px solid var(--border-strong); border-radius: 4px; }.purchase-path figcaption { margin-top: 2px; color: var(--text-muted); }
.session-list, .experiments-page { display: grid; gap: var(--space-3); }.session-head > div { display: flex; flex-direction: column; }.match-control { display: flex; align-items: center; position: relative; }.match-chip { display: flex; align-items: center; gap: 4px; background: var(--surface-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 3px; cursor: pointer; }.match-chip img { width: 30px; height: 30px; border-radius: var(--radius-sm); }.boundary summary { cursor: pointer; padding: 0 4px; }.boundary[open] { position: relative; }.boundary[open] > button { display: block; width: 110px; background: var(--surface-3); color: var(--text-primary); border: 1px solid var(--border-subtle); padding: 4px; font-size: 10px; cursor: pointer; }
.experiments-page { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }.experiments-page .card:first-child { display: grid; gap: var(--space-2); }.status { margin-left: var(--space-2); color: var(--gold); text-transform: uppercase; font-size: 10px; }
.scope-label { display: grid; gap: 4px; font-size: 11px; }.scope-label select { min-height: 72px; }.experiment-actions { display: flex; gap: var(--space-2); margin-top: var(--space-2); }.experiment-actions button { padding: 4px 8px; font-size: 10px; }
.bookmark-row { width: 100%; display: grid; grid-template-columns: 34px 1fr 36px; align-items: center; gap: var(--space-2); padding: var(--space-2); background: var(--surface-2); color: var(--text-primary); border: 1px solid var(--border-subtle); text-align: left; }.bookmark-row img { width: 32px; height: 32px; border-radius: 50%; }
@media (max-width: 1050px) { .matchups { --matchup-grid: minmax(0, 1fr) 84px minmax(0, 1fr) 18px; }.compare-augments { grid-template-columns: 54px minmax(0, 1fr) 118px minmax(0, 1fr) 54px; } }
@media (max-width: 800px) { .review-grid { grid-template-columns: 1fr; }.page-head, .hero { align-items: flex-start; flex-wrap: wrap; }.seat .loadout { display: none; }.section-heading { align-items: flex-start; flex-direction: column; }.event-row { grid-template-columns: 36px 26px minmax(0, 1fr); }.event-row .victim { display: none; } }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
</style>
