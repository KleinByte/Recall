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
  timelineKillIconUrl,
  timelineObjectiveIconUrl,
  type GameAssetCatalog,
} from "../helpers/game-assets"
import { focusReviewGameId, reviewMatch } from "../helpers/navigation"
import { publicAssetUrl } from "../helpers/assets"
import { lobbyStandings } from "../helpers/match-detail"
import {
  timelineChartDomain,
  timelineChartX,
  timelineChartY,
  timelineGoldDifferencePoints,
  timelineTeamGoldAt,
  sampleTimelineEvents,
} from "../helpers/timeline-chart"
import GradeBadge from "../components/GradeBadge.vue"
import AugmentInsightCard from "../components/AugmentInsightCard.vue"
import MatchReviewHero from "../components/MatchReviewHero.vue"
import MatchStatsTable from "../components/MatchStatsTable.vue"
import ReviewScoreboard from "../components/ReviewScoreboard.vue"
import MatchDeathMap from "../components/MatchDeathMap.vue"
import MatchPlaybackMap from "../components/MatchPlaybackMap.vue"
import WinProbabilityChart from "../components/WinProbabilityChart.vue"
import RviPerformanceProfile from "../components/skill/PerformanceProfile.vue"
import MatchRviSummary from "../components/review/MatchRviSummary.vue"
import PageHeader from "../components/ui/PageHeader.vue"
import Tabs from "../components/ui/Tabs.vue"
import Button from "../components/ui/Button.vue"
import EmptyState from "../components/ui/EmptyState.vue"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import {
  faArrowTrendDown,
  faArrowTrendUp,
  faBullseye,
  faMedal,
} from "@fortawesome/free-solid-svg-icons"
import type { Champion } from "../types/lol"
import type {
  MatchRow,
  PerformanceDimensionScore,
  PerformanceProfile,
} from "../types/stats"
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
type MatchTab = "overview" | "stats" | "timeline" | "probability"
type InsightTab = "rvi" | "performance"
type TimelineMapView = "deaths" | "playback"
const tab = ref<Tab>("review")
const matchTab = ref<MatchTab>("overview")
const insightTab = ref<InsightTab>("rvi")
const timelineMapView = ref<TimelineMapView>("deaths")
const review = ref<MatchReview>()
const gameRvi = ref<PerformanceProfile>()
const careerRvi = ref<PerformanceProfile>()
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
const timelineCursorTimestamp = ref(0)
const assets = ref<GameAssetCatalog>({ version: "latest", items: {}, augments: {}, abilities: {} })
const augmentSummary = ref<Record<number, OwnerAugmentSummary>>({})
const augmentSummaryLoading = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | undefined
let annotationSavesInFlight = 0

const owner = computed(() =>
  review.value?.scoreboard.find((participant) => participant.isPlayer === 1),
)
const matchLobbyStanding = computed(() => {
  const current = review.value
  if (!current) return undefined
  if (current.match.lobbyPlace && current.match.lobbySize) {
    return { place: current.match.lobbyPlace, of: current.match.lobbySize }
  }
  const player = owner.value
  return player ? lobbyStandings(current.scoreboard).get(player.participantId) : undefined
})
const matchTabs: { id: MatchTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "stats", label: "Stats" },
  { id: "timeline", label: "Timeline" },
  { id: "probability", label: "Win Probability" },
]
const pageTabs = [
  { value: "review", label: "Current match" },
  { value: "sessions", label: "Sessions" },
  { value: "bookmarks", label: "Bookmarks" },
  { value: "experiments", label: "Experiments" },
]
const insightTabs = [
  { value: "rvi", label: "RVI" },
  { value: "performance", label: "Breakdown" },
]
const matchTabOptions = matchTabs.map((item) => ({ value: item.id, label: item.label }))
const timelineMapViewOptions = [
  { value: "deaths", label: "Deaths" },
  { value: "playback", label: "Playback" },
]

const rviDimensions = computed<PerformanceDimensionScore[]>(() =>
  (gameRvi.value?.dimensions ?? []).map((dimension) => ({
    ...dimension,
    recentScore: careerRvi.value?.dimensions.find((entry) => entry.key === dimension.key)?.score ?? undefined,
  })),
)
const gameRviPresentation = computed<PerformanceProfile | undefined>(() => gameRvi.value
  ? { ...gameRvi.value, dimensions: rviDimensions.value }
  : undefined)
const hasGameRviEvidence = computed(() =>
  gameRviPresentation.value?.dimensions.some((dimension) =>
    dimension.score !== null || dimension.metrics.length > 0) ?? false)

const matchBans = computed(() => (review.value?.teams ?? []).flatMap((team) => {
  try {
    return (JSON.parse(team.bans || "[]") as number[]).filter((id) => id > 0)
  } catch {
    return []
  }
}))
const timelineDomain = computed(() => {
  const summary = review.value?.timeline.summary
  return timelineChartDomain(summary?.frames ?? [], summary?.events ?? [])
})
const timelineDifferencePoints = computed(() => {
  const frames = review.value?.timeline.summary?.frames ?? []
  if (frames.length < 2) return ""
  return timelineGoldDifferencePoints(frames, timelineDomain.value)
})
const finalTimelineFrame = computed(() => review.value?.timeline.summary?.frames.at(-1))
const finalGoldDifference = computed(() =>
  (finalTimelineFrame.value?.blueGold ?? 0) - (finalTimelineFrame.value?.redGold ?? 0),
)
const timelineGoldTicks = computed(() => [
  timelineDomain.value.maximumDifference,
  timelineDomain.value.maximumDifference / 2,
  0,
  -timelineDomain.value.maximumDifference / 2,
  -timelineDomain.value.maximumDifference,
].map((gold) => ({ gold, y: timelineChartY(gold, timelineDomain.value) })))
const compactGold = (gold: number) => `${(gold / 1_000).toFixed(gold >= 10_000 ? 0 : 1)}k`
const signedCompactGold = (gold: number) => gold === 0
  ? "0"
  : `${gold > 0 ? "+" : "−"}${compactGold(Math.abs(gold))}`
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

const timelineTrackMeta = [
  { id: "kill", label: "Deaths", maximum: 60 },
  { id: "level", label: "Levels", maximum: 36 },
  { id: "item", label: "Items", maximum: 42 },
  { id: "objective", label: "Objectives", maximum: 30 },
  { id: "vision", label: "Vision", maximum: 30 },
  { id: "game", label: "Match", maximum: 10 },
] as const

const timelineTrackSource = computed(() => {
  const summary = review.value?.timeline.summary
  if (!summary) return []
  if (timelineFilter.value !== "all") return filteredTimelineEvents.value
  const ownerId = owner.value?.participantId
  return summary.events.filter((event) =>
    event.category === "kill" ||
    event.category === "objective" ||
    event.category === "game" ||
    (event.category === "level" && event.participantId === ownerId) ||
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
})

const timelineEventTracks = computed(() => timelineTrackMeta.flatMap((track) => {
  const events = timelineTrackSource.value.filter((event) => event.category === track.id)
  if (events.length === 0) return []
  const laneByBucket = new Map<number, number>()
  const markers = sampleTimelineEvents(events, track.maximum).map((event) => {
    const x = timelineChartX(event.timestamp, timelineDomain.value)
    const bucket = Math.round(x / 3)
    const lane = laneByBucket.get(bucket) ?? 0
    laneByBucket.set(bucket, lane + 1)
    return { event, x, top: [21, 10, 32][lane % 3] }
  })
  return [{ ...track, markers }]
}))
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
    return championIconUrl(killTarget(event)?.championId || 0)
  }
  if (event.category === "item") return itemIcon(event)
  if (event.type === "SKILL_LEVEL_UP") return abilityAsset(event)?.icon
  if (event.category === "objective") {
    return timelineObjectiveIconUrl(event.type, event.objective, event.teamId)
  }
  return undefined
}

function timelineMarkerGlyph(event: TimelineEvent) {
  if (event.category === "objective") return "◆"
  if (event.type === "LEVEL_UP") return `${event.approximate ? "≈" : ""}${event.level ?? "↑"}`
  if (event.type === "SKILL_LEVEL_UP") return abilityKey(event.skillSlot).toUpperCase()
  if (event.category === "level") return "↑"
  if (event.category === "vision") return "◉"
  if (event.category === "game") return "■"
  return "•"
}

function timelineMarkerClasses(event: TimelineEvent) {
  const victim = event.category === "kill" ? killTarget(event) : undefined
  return [
    event.category,
    victim?.teamId === 100 ? "blue-team" : victim?.teamId === 200 ? "red-team" : undefined,
    event.targetId === owner.value?.participantId || event.participantId === owner.value?.participantId
      ? "owner-event"
      : undefined,
  ]
}

function timelineMarkerTitle(event: TimelineEvent) {
  const time = `${event.approximate ? "≈" : ""}${eventTime(event.timestamp)}`
  if (event.category === "kill") {
    const killer = killActorName(event)
    return `${time} · ${killTargetName(event)} died to ${killer}`
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
  if (event.type === "LEVEL_UP") {
    const player = participant(event.participantId)?.summonerName ?? `Player ${event.participantId}`
    return `${time} · ${player} reached level ${event.level ?? "?"}`
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
  const difference = blueGold - redGold
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
    difference,
    differenceY: timelineChartY(difference, timelineDomain.value),
    blueKills,
    redKills,
  }
})

const timelineScrubbing = ref(false)

function setTimelineCursor(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  timelineCursorTimestamp.value = ratio * timelineDomain.value.maximumTimestamp
}

function beginTimelineScrub(event: PointerEvent) {
  timelineScrubbing.value = true
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  setTimelineCursor(event)
}

function updateTimelineScrub(event: PointerEvent) {
  if (timelineScrubbing.value) setTimelineCursor(event)
}

function endTimelineScrub(event: PointerEvent) {
  if (!timelineScrubbing.value) return
  setTimelineCursor(event)
  timelineScrubbing.value = false
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
}

function selectTimelineTimestamp(timestamp: number) {
  timelineCursorTimestamp.value = Math.max(
    0,
    Math.min(timelineDomain.value.maximumTimestamp, timestamp),
  )
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

async function loadAugmentSummaries() {
  augmentSummaryLoading.value = true
  try {
    const summaries = await api.getOwnerAugmentSummaries()
    augmentSummary.value = Object.fromEntries(
      summaries.map((summary) => [summary.augmentId, summary]),
    )
  } catch {
    augmentSummary.value = {}
  } finally {
    augmentSummaryLoading.value = false
  }
}

async function load(gameId?: number) {
  busy.value = true
  error.value = ""
  timelineFilter.value = "all"
  timelineCursorTimestamp.value = 0
  timelineMapView.value = "deaths"
  matchTab.value = "overview"
  insightTab.value = "rvi"
  augmentSummary.value = {}
  gameRvi.value = undefined
  careerRvi.value = undefined
  try {
    const overview = await api.getReviewOverview()
    const target = gameId ?? focusReviewGameId.value ?? overview.latest?.match.gameId
    review.value = target ? await api.getMatchReview(target) : undefined
    focusReviewGameId.value = null
    const current = review.value
    if (current?.scoreboard.some((participant) => participant.isPlayer === 1 && participant.augments?.length)) {
      void loadAugmentSummaries()
    }
    if (current && current.match.modeFamily !== "other") {
      const family = current.match.modeFamily
      const [singleResult, careerResult] = await Promise.allSettled([
        api.getRviProfile({
          modeFamily: family,
          sinceMs: current.match.playedAt - 1,
          untilMs: current.match.playedAt + 1,
        }, family, "match"),
        api.getRviProfile({ modeFamily: family }, family),
      ])
      gameRvi.value = singleResult.status === "fulfilled" ? singleResult.value : undefined
      careerRvi.value = careerResult.status === "fulfilled" ? careerResult.value : undefined
      if (!gameRvi.value?.dimensions.some((dimension) =>
        dimension.score !== null || dimension.metrics.length > 0)) insightTab.value = "performance"
    }
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
  if (component) return `${component.label} · similar-game percentile`
  const metric = highlightBaseline(highlight)
  return metric ? `${metric.label} · versus your prior average` : highlight.title
}

const highlightMessage = (highlight: ReviewHighlight) => {
  if (highlight.kind === "strength") return "Your clearest archetype-and-position strength."
  if (highlight.kind === "opportunity") return "The clearest place to recover value next game."
  if (highlight.kind === "improvement") return "Meaningfully ahead of your recent baseline."
  return "Below your recent baseline and worth reviewing."
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
  <div class="page review-page">
    <PageHeader
      title="Match Review"
      eyebrow="Performance archive"
      description="Turn permanent local history into concrete, measurable follow-up."
    >
      <template #actions>
        <Tabs v-model="tab" :options="pageTabs" label="Review areas" variant="compact" class="review-area-tabs" />
      </template>
    </PageHeader>

    <EmptyState
      v-if="error"
      compact
      tone="danger"
      title="Review unavailable"
      :description="error"
    />
    <EmptyState
      v-else-if="busy && !review"
      compact
      title="Loading your review"
      description="Recall is assembling the match evidence and timeline."
    />
    <EmptyState
      v-else-if="tab === 'review' && !review"
      compact
      title="No match selected"
      description="Your most recent recorded match will appear here once Recall has one to review."
    />

    <template v-if="tab === 'review' && review">
      <MatchReviewHero :review="review" :champions="champions" @bookmark="toggleBookmark" />

      <section class="insight-shell card" aria-label="Match insights">
        <Tabs v-model="insightTab" :options="insightTabs" label="Match insights" class="insight-tabs" />

        <div v-if="insightTab === 'rvi' && gameRviPresentation && hasGameRviEvidence" role="tabpanel">
          <MatchRviSummary
            :profile="gameRviPresentation"
            :grade="review.match.grade"
            :personal-score="careerRvi?.recallScoreAverage"
            :lobby-place="matchLobbyStanding?.place"
            :lobby-size="matchLobbyStanding?.of"
            :reference-matches="review.match.gradeReferenceSampleCount"
          />
        </div>
        <div v-else-if="insightTab === 'rvi'" class="rvi-empty" role="tabpanel">
          <strong>Match RVI evidence is unavailable</strong>
          <span>The selected Recall recipe has no inspectable metric observations for this game.</span>
          <Button size="compact" @click="insightTab = 'performance'">Open breakdown</Button>
        </div>
      </section>

      <div v-if="insightTab === 'performance'" class="review-grid insight-performance" role="tabpanel">
        <section class="card grade-card">
          <div class="section-heading compact-heading">
            <div><span class="eyebrow">Performance model</span><h2 class="section-title">Why this grade</h2></div>
            <span v-if="review.grade" class="algorithm-label">Compared by archetype and position</span>
          </div>
          <p v-if="review.grade?.unavailableReason" class="muted">{{ review.grade.unavailableReason }}</p>
          <div v-else-if="review.grade" class="grade-story">
            <div class="grade-score">
              <span>Recall Score</span>
              <strong>{{ gradePercentile }}</strong>
              <small>out of 100</small>
            </div>
            <div class="components">
              <div v-for="component in review.grade.components" :key="component.key" class="component">
                <div class="component-copy">
                  <strong>{{ component.label }}</strong>
                  <span>{{ Math.round(component.weight * 100) }}% influence</span>
                </div>
                <div class="track" :title="`${component.label}: ${percent(component.percentile)} similar-game percentile`">
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

        <RviPerformanceProfile
          v-if="gameRviPresentation && hasGameRviEvidence"
          class="match-rvi-evidence"
          :profile="gameRviPresentation"
          detail-only
        />
      </div>

      <section class="match-content-shell">
        <Tabs v-model="matchTab" :options="matchTabOptions" label="Match review sections" class="match-tabs">
          <template #after>
            <div v-if="matchBans.length" class="match-bans" aria-label="Champion bans">
              <span>Bans</span>
              <img v-for="championId in matchBans" :key="championId" :src="championIconUrl(championId)" alt="" />
            </div>
          </template>
        </Tabs>

        <div class="match-tab-surface">
      <section v-if="matchTab === 'overview'" class="scoreboard-section" role="tabpanel">
        <div class="section-heading scoreboard-heading">
          <h2 class="section-title">Scoreboard</h2>
        </div>
        <div class="scoreboard-scroll">
          <ReviewScoreboard
            :match="review.match"
            :participants="review.scoreboard"
            :teams="review.teams"
            :champions="champions"
            :assets="assets"
          />
        </div>

        <section v-if="owner?.augments?.length" class="owner-augment-context">
          <header>
            <div><span class="eyebrow">Mayhem loadout</span><h3>Your augments</h3></div>
            <span class="muted">{{ augmentSummaryLoading ? "Loading personal history…" : "Personal performance on each choice" }}</span>
          </header>
          <div class="augment-grid">
            <AugmentInsightCard
              v-for="augment in owner.augments"
              :key="augment.slot"
              :augment-id="augment.augmentId"
              :name="augmentName(augment.augmentId)"
              :icon="augmentIcon(augment.augmentId, augment.iconPath)"
              :description="assets.augments[augment.augmentId]?.description"
              :rarity="assets.augments[augment.augmentId]?.rarity || augment.rarity"
              :summary="augmentSummary[augment.augmentId]"
              compact
            />
          </div>
          <p class="policy-note">Recall shows your own post-game sample, grade, KDA, and damage. Augment win rates are excluded under Riot's policy.</p>
        </section>
      </section>

      <section v-if="matchTab === 'stats'" class="match-tab-panel" role="tabpanel">
        <div class="section-heading scoreboard-heading">
          <div><span class="eyebrow">Complete comparison</span><h2 class="section-title">Match stats</h2></div>
          <span class="muted">Row leaders are emphasized · your column is gold</span>
        </div>
        <MatchStatsTable :participants="review.scoreboard" :champions="champions" />
      </section>

      <div v-if="matchTab === 'overview'" class="review-grid annotation-grid">
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

      <section v-if="matchTab === 'timeline'" class="card match-tab-panel" role="tabpanel">
        <div v-if="review.timeline.status === 'ready' && review.timeline.summary">
          <div class="timeline-chronology">
          <div class="timeline-visuals">
            <div class="gold-chart-column">
              <header class="timeline-card-heading">
                <div><span class="eyebrow">Economy</span><h3>Team gold advantage</h3></div>
                <span class="muted">Blue + / Red −</span>
              </header>
              <div class="gold-chart-wrap" tabindex="0" aria-label="Interactive team gold advantage chart. Click or drag to select playback time; use left and right arrow keys to inspect each minute."
                @pointerdown="beginTimelineScrub"
                @pointermove="updateTimelineScrub"
                @pointerup="endTimelineScrub"
                @pointercancel="timelineScrubbing = false"
                @keydown.left.prevent="moveTimelineCursor(-1)" @keydown.right.prevent="moveTimelineCursor(1)">
                <svg class="gold-chart" viewBox="0 0 100 100" preserveAspectRatio="none"
                  aria-label="Blue versus Red team gold advantage across the match">
                  <defs>
                    <clipPath id="blue-advantage-clip"><rect x="0" y="0" width="100" height="50" /></clipPath>
                    <clipPath id="red-advantage-clip"><rect x="0" y="50" width="100" height="50" /></clipPath>
                  </defs>
                  <line v-for="tick in timelineGoldTicks" :key="tick.gold" class="grid-line"
                    x1="0" :y1="tick.y" x2="100" :y2="tick.y" />
                  <polygon class="advantage-fill blue" :points="`2,50 ${timelineDifferencePoints} 98,50`" clip-path="url(#blue-advantage-clip)" />
                  <polygon class="advantage-fill red" :points="`2,50 ${timelineDifferencePoints} 98,50`" clip-path="url(#red-advantage-clip)" />
                  <polyline class="blue-series" :points="timelineDifferencePoints" clip-path="url(#blue-advantage-clip)" />
                  <polyline class="red-series" :points="timelineDifferencePoints" clip-path="url(#red-advantage-clip)" />
                </svg>
                <template v-if="timelineCursor">
                  <span class="chart-crosshair" :style="{ left: `${timelineCursor.x}%` }" />
                  <span class="cursor-dot" :class="timelineCursor.difference >= 0 ? 'blue' : 'red'"
                    :style="{ left: `${timelineCursor.x}%`, top: `${timelineCursor.differenceY}%` }" />
                  <output class="chart-tooltip" :class="{ flip: timelineCursor.x > 68 }" :style="{ left: `${timelineCursor.x}%` }">
                    <strong>{{ eventTime(timelineCursor.timestamp) }}</strong>
                    <span class="blue">Blue {{ timelineCursor.blueGold.toLocaleString() }}g · {{ timelineCursor.blueKills }} kills</span>
                    <span class="red">Red {{ timelineCursor.redGold.toLocaleString() }}g · {{ timelineCursor.redKills }} kills</span>
                    <small>{{ Math.abs(timelineCursor.difference).toLocaleString() }}g {{ timelineCursor.difference >= 0 ? "Blue" : "Red" }} lead</small>
                  </output>
                </template>
                <span v-for="tick in timelineGoldTicks" :key="tick.gold" class="gold-axis-label"
                  :style="{ top: `${tick.y}%` }">{{ signedCompactGold(tick.gold) }}</span>
                <span class="time-axis start">0:00</span>
                <span class="time-axis end">{{ formatDuration(timelineDomain.maximumTimestamp / 1_000) }}</span>
              </div>
              <div v-if="timelineEventTracks.length" class="timeline-event-tracks" aria-label="Match events aligned to the gold timeline">
                <div v-for="track in timelineEventTracks" :key="track.id" class="timeline-event-track" :class="track.id">
                  <strong>{{ track.label }}</strong>
                  <button
                    v-for="marker in track.markers"
                    :key="marker.event.eventId"
                    type="button"
                    class="event-track-marker"
                    :class="timelineMarkerClasses(marker.event)"
                    :style="{ left: `${marker.x}%`, top: `${marker.top}px` }"
                    :title="timelineMarkerTitle(marker.event)"
                    :aria-label="timelineMarkerTitle(marker.event)"
                    @click="selectTimelineTimestamp(marker.event.timestamp)"
                  >
                    <img v-if="timelineMarkerIcon(marker.event)" :src="timelineMarkerIcon(marker.event)" alt="" />
                    <span v-else>{{ timelineMarkerGlyph(marker.event) }}</span>
                  </button>
                </div>
              </div>
              <div v-if="finalTimelineFrame" class="gold-legend" aria-label="Final team gold totals">
                <span class="blue"><i />Blue <strong>{{ compactGold(finalTimelineFrame.blueGold) }}</strong></span>
                <span class="red"><i />Red <strong>{{ compactGold(finalTimelineFrame.redGold) }}</strong></span>
                <span class="difference" :class="finalGoldDifference >= 0 ? 'blue' : 'red'">
                  {{ finalGoldDifference >= 0 ? "Blue" : "Red" }} finished
                  {{ Math.abs(finalGoldDifference).toLocaleString() }}g ahead
                </span>
              </div>
            </div>
            <div class="timeline-map-column">
              <Tabs
                v-model="timelineMapView"
                :options="timelineMapViewOptions"
                label="Timeline map"
                variant="compact"
                class="timeline-map-tabs"
              />
              <div class="timeline-map-pane" role="tabpanel">
                <MatchDeathMap
                  v-if="timelineMapView === 'deaths'"
                  :match="review.match"
                  :participants="review.scoreboard"
                  :events="review.timeline.summary.events"
                />
                <MatchPlaybackMap
                  v-else
                  compact
                  :match="review.match"
                  :participants="review.scoreboard"
                  :frames="review.timeline.summary.frames"
                  :events="review.timeline.summary.events"
                  v-model:timestamp="timelineCursorTimestamp"
                />
              </div>
            </div>
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
                <div class="kill-event">
                  <div class="kill-matchup" aria-label="Kill matchup">
                    <img
                      :src="championIconUrl(killActor(event)?.championId || 0)"
                      :alt="killActorName(event)"
                      :title="killActorName(event)"
                    />
                    <img class="kill-feed-icon" :src="timelineKillIconUrl()" alt="killed" />
                    <img
                      class="victim"
                      :src="championIconUrl(killTarget(event)?.championId || 0)"
                      :alt="killTargetName(event)"
                      :title="killTargetName(event)"
                    />
                  </div>
                  <div class="kill-copy">
                    <strong>
                      {{ championNameById(champions, killActor(event)?.championId || 0) }}
                      <span>defeated</span>
                      {{ championNameById(champions, killTarget(event)?.championId || 0) }}
                    </strong>
                    <span v-if="event.assistingParticipantIds?.length">
                      Assisted by {{ event.assistingParticipantIds.map(id => participant(id)?.summonerName || `Player ${id}`).join(", ") }}
                    </span>
                  </div>
                </div>
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

      <WinProbabilityChart
        v-if="matchTab === 'probability' && review.timeline.status === 'ready' && review.timeline.summary"
        :summary="review.timeline.summary"
        role="tabpanel"
      />
      <section v-else-if="matchTab === 'probability'" class="card timeline-empty match-tab-panel" role="tabpanel">
        <p class="muted">{{ review.timeline.error || 'Timeline snapshots are required before Recall can estimate win probability.' }}</p>
        <button class="league-button" :disabled="review.timeline.status === 'loading'" @click="loadTimeline(review.timeline.status === 'unavailable' || review.timeline.status === 'error')">
          {{ review.timeline.status === 'loading' ? 'Loading…' : 'Load timeline' }}
        </button>
      </section>
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
            <button class="match-chip" @click="tab = 'review'; reviewMatch(match.gameId)">
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
        @click="tab = 'review'; reviewMatch(match.gameId)">
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
            · compatibility {{ experiment.summary.avgGrade.toFixed(2) }}
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
.review-page { gap: var(--ui-space-4); max-width: 1480px; margin: 0 auto; }
.session-head { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-4); }
h2 { margin: 0; }
.bookmark, .timeline-empty button, .inline button, .experiments-page button { padding: var(--ui-space-2) var(--ui-space-3); }
.match-content-shell { min-width: 0; }
.match-tabs { position: relative; z-index: 1; align-items: center; min-height: 48px; }
.match-bans { display: flex; align-items: center; gap: 4px; min-width: max-content; margin-left: auto; padding: 0 14px; }.match-bans span { margin-right: 4px; color: var(--text-muted); font-size: 11px; letter-spacing: .65px; text-transform: uppercase; }.match-bans img { width: 25px; height: 25px; border: 1px solid var(--border-subtle); border-radius: 3px; object-fit: cover; filter: saturate(.72); }
.match-tab-surface { display: flex; flex-direction: column; gap: var(--ui-space-4); min-width: 0; padding: clamp(12px, 1.5vw, 18px); border: 1px solid var(--ui-border); border-top: 0; border-radius: 0 0 var(--ui-radius-lg) var(--ui-radius-lg); background: var(--ui-surface-panel); }
.match-tab-surface > .scoreboard-section, .match-tab-surface > .match-tab-panel { border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.insight-shell { padding: 0; overflow: hidden; }.insight-tabs { border: 0; border-bottom: 1px solid var(--ui-divider); border-radius: 0; }
.rvi-empty { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; min-height: 100px; padding: 18px; }.rvi-empty strong { color: var(--text-primary); }.rvi-empty span { flex: 1 1 280px; color: var(--text-muted); font-size: 11px; }.rvi-empty button { padding: 7px 10px; }
.insight-performance { grid-template-columns: repeat(auto-fit, minmax(min(100%, 520px), 1fr)); }.match-rvi-evidence { grid-column: 1 / -1; }.scoreboard-section, .match-tab-panel { min-width: 0; }.scoreboard-section { padding: 0; }.scoreboard-heading { padding-inline: 2px; }.scoreboard-scroll { overflow-x: auto; padding-bottom: 4px; }.annotation-grid { align-items: stretch; }
.eyebrow { color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .8px; }
.compact-session { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }.compact-session > div { display: flex; flex-direction: column; }.compact-session button { padding: var(--space-2) var(--space-3); }
.review-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.grade-card, .baseline-card { min-width: 0; min-height: 0; }
.components, .baseline, .highlights, .scoreboard, .events, .turning-points { display: grid; gap: var(--space-2); }
.section-heading { display: flex; justify-content: space-between; align-items: end; gap: var(--space-3); margin-bottom: var(--space-3); }
.compact-heading { align-items: start; flex-wrap: wrap; margin-bottom: var(--space-3); }
.compact-heading > * { min-width: 0; }
.algorithm-label, .sample-badge { max-width: 100%; padding: 4px 8px; border: 1px solid var(--border-subtle); border-radius: 999px; color: var(--text-muted); background: var(--surface-1); font-size: 11px; text-align: right; text-transform: uppercase; letter-spacing: .6px; white-space: normal; }
.grade-story { display: grid; grid-template-columns: minmax(92px, 112px) minmax(0, 1fr); align-items: center; gap: clamp(10px, 1.5vw, var(--space-4)); }
.grade-score { display: grid; justify-items: center; gap: 2px; padding: 13px 10px; border: 1px solid color-mix(in srgb, var(--gold) 36%, var(--border-subtle)); border-radius: var(--radius-md); background: color-mix(in srgb, var(--gold) 5%, var(--surface-1)); }
.grade-score span { color: var(--text-muted); font-size: var(--ui-text-label); letter-spacing: .55px; text-transform: uppercase; }
.grade-score strong { color: var(--gold-bright); font: 34px/1 var(--font-display); }
.grade-score small { color: var(--text-muted); font-size: var(--ui-text-label); }
.component { display: grid; grid-template-columns: minmax(76px, .8fr) 1.3fr 36px; align-items: center; gap: 8px; }
.component-copy { display: flex; flex-direction: column; min-width: 0; }
.component-copy strong { color: var(--text-secondary); font-size: 12px; }
.component-copy span { color: var(--text-muted); font-size: 11px; }
.component .track { position: relative; height: 6px; }
.component .median { position: absolute; left: 50%; top: -2px; width: 1px; height: 10px; background: rgba(255,255,255,.28); }
.component-percent { color: var(--text-primary); font-size: 11px; text-align: right; }
.numeric { text-align: right; font-variant-numeric: tabular-nums; }
.highlights { grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr)); margin-top: var(--space-4); }
.highlight { position: relative; display: grid; grid-template-columns: 28px minmax(0,1fr); gap: 7px; min-height: 82px; padding: 9px; overflow: hidden; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: linear-gradient(140deg, var(--surface-2), var(--surface-1)); }
.highlight::after { content: ""; position: absolute; right: -24px; bottom: -28px; width: 72px; height: 72px; border-radius: 50%; background: currentColor; opacity: .06; }
.highlight.strength, .highlight.improvement { color: var(--win); }.highlight.opportunity, .highlight.regression { color: var(--loss); }
.highlight-icon { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: color-mix(in srgb, currentColor 14%, transparent); }
.highlight-copy { display: flex; flex-direction: column; min-width: 0; }
.highlight-title { color: currentColor; font-size: 12px; text-transform: uppercase; letter-spacing: .7px; }
.highlight-copy strong { margin-top: 4px; color: var(--text-primary); font-size: 12px; line-height: 1.3; }
.highlight-copy small { margin-top: 4px; color: var(--text-muted); font-size: 11px; line-height: 1.35; }
.highlight-value { position: absolute; right: 8px; top: 7px; color: currentColor; font: 14px var(--font-heading); opacity: .92; }
.baseline-summary { display: grid; grid-template-columns: repeat(3, 1fr); margin-bottom: var(--space-3); overflow: hidden; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); }
.baseline-summary span { display: flex; justify-content: center; align-items: baseline; gap: 4px; padding: 7px; border-left: 1px solid var(--border-subtle); color: var(--text-muted); font-size: 12px; text-transform: uppercase; letter-spacing: .45px; }
.baseline-summary span:first-child { border-left: 0; }.baseline-summary strong { font-size: 13px; }
.baseline { grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: 7px 12px; }
.baseline-row { display: grid; gap: 5px; padding-bottom: 7px; border-bottom: 1px solid var(--border-subtle); }
.baseline-row header, .baseline-row footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.baseline-row header > strong { color: var(--text-secondary); font-size: 12px; }.baseline-row header > span { font-size: 11px; font-weight: 700; }
.baseline-axis { position: relative; height: 5px; border-radius: 4px; background: var(--surface-3); }
.baseline-axis .zero { position: absolute; z-index: 1; left: 50%; top: -2px; width: 1px; height: 9px; background: var(--text-muted); opacity: .7; }
.baseline-axis > span { position: absolute; top: 0; height: 100%; border-radius: 4px; background: currentColor; }
.baseline-row footer { flex-wrap: wrap; }.baseline-row footer span { display: flex; align-items: baseline; gap: 4px; min-width: 0; }.baseline-row footer small { color: var(--text-muted); font-size: 12px; }.baseline-row footer strong { color: var(--text-primary); font-size: 11px; }
.baseline-scope { margin: var(--space-3) 0 0; font-size: 11px; text-align: right; }
.positive { color: var(--win); }.negative, .error { color: var(--loss); }
.owner-augment-context { display: grid; gap: 9px; padding-top: var(--space-3); }.owner-augment-context > header { display: flex; align-items: end; justify-content: space-between; gap: var(--space-3); }.owner-augment-context h3 { margin: 2px 0 0; color: var(--text-primary); font: 14px var(--font-heading); }.owner-augment-context > header > span { font-size: 12px; }.augment-grid { display: grid; grid-template-columns: repeat(4, minmax(210px, 1fr)); gap: 8px; }.policy-note { margin: 0; color: var(--text-muted); font-size: 11px; }
textarea { width: 100%; box-sizing: border-box; min-height: 110px; resize: vertical; background: var(--surface-0); color: var(--text-primary); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: var(--space-3); font: 12px var(--font-body); }
.tag-list, .inline, .experiment-outcome, .session-games { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-2); }.tag { border: 1px solid var(--border-subtle); background: var(--surface-2); color: var(--text-secondary); border-radius: 99px; padding: 4px 9px; }.tag.selected { color: var(--gold-bright); border-color: var(--gold); }
.inline input { flex: 1; }.experiment-outcome { justify-content: space-between; align-items: center; }.outcome-note { flex-basis: 100%; }
.timeline-chronology { min-width: 0; }
.timeline-visuals { display: grid; grid-template-columns: minmax(0, 1fr) minmax(310px, 380px); align-items: start; gap: clamp(18px, 2.5vw, 34px); }
.timeline-map-column { min-width: 0; }.timeline-map-tabs { margin-bottom: 8px; }.timeline-map-pane { min-width: 0; }
.timeline-card-heading { display: flex; align-items: end; justify-content: space-between; gap: 10px; min-height: 34px; margin-bottom: 8px; }.timeline-card-heading h3 { margin: 1px 0 0; color: var(--gold-bright); font: 16px var(--font-heading); }.timeline-card-heading > span { font-size: 11px; }
.gold-chart-wrap { position: relative; height: 318px; overflow: hidden; touch-action: none; user-select: none; cursor: crosshair; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: linear-gradient(180deg, color-mix(in srgb, var(--surface-2) 82%, #0b2742) 0%, var(--surface-0) 50%, color-mix(in srgb, var(--surface-2) 84%, #35131c) 100%); }
.gold-chart-wrap:focus-visible { outline: 1px solid var(--gold); outline-offset: 2px; }
.gold-chart { display: block; width: 100%; height: 100%; }.gold-chart line { stroke: var(--border-strong); stroke-width: .35; stroke-dasharray: 2 2; }.gold-chart polyline { fill: none; stroke-width: 2.2; vector-effect: non-scaling-stroke; }.gold-chart .blue-series { stroke: #35b9dd; filter: drop-shadow(0 0 4px rgba(53, 185, 221, .45)); }.gold-chart .red-series { stroke: #e45868; filter: drop-shadow(0 0 4px rgba(228, 88, 104, .38)); }.advantage-fill.blue { fill: rgba(31, 126, 165, .28); }.advantage-fill.red { fill: rgba(172, 34, 59, .34); }
.timeline-event-tracks { border: 1px solid var(--border-subtle); border-top: 0; background: var(--surface-0); }
.timeline-event-track { position: relative; height: 43px; overflow: visible; border-bottom: 1px solid var(--border-subtle); background: linear-gradient(90deg, color-mix(in srgb, var(--surface-2) 90%, transparent), transparent 26%); }
.timeline-event-track:last-child { border-bottom: 0; }.timeline-event-track::after { content: ""; position: absolute; top: 50%; right: 0; left: 0; height: 1px; background: color-mix(in srgb, var(--border-strong) 55%, transparent); }
.timeline-event-track > strong { position: absolute; z-index: 1; top: 4px; left: 7px; color: var(--text-muted); font-size: var(--ui-text-micro); letter-spacing: .6px; text-transform: uppercase; pointer-events: none; }
.event-track-marker { position: absolute; z-index: 2; display: grid; place-items: center; box-sizing: border-box; width: 22px; height: 22px; padding: 0; transform: translate(-50%, -50%); border: 2px solid var(--surface-0); border-radius: 50%; background: var(--surface-3); color: var(--gold-bright); box-shadow: 0 2px 7px rgba(0, 0, 0, .55); cursor: pointer; transition: transform .12s ease, z-index .12s ease, filter .12s ease; }
.event-track-marker:hover, .event-track-marker:focus-visible { z-index: 8; transform: translate(-50%, -50%) scale(1.38); outline: 1px solid var(--gold); filter: brightness(1.12); }
.event-track-marker img { display: block; width: 100%; height: 100%; border-radius: inherit; object-fit: cover; }.event-track-marker > span { font: var(--ui-text-micro) var(--font-heading); line-height: 1; }
.event-track-marker.kill::after { content: "×"; position: absolute; right: -5px; bottom: -5px; display: grid; place-items: center; width: 14px; height: 14px; border: 1px solid var(--surface-0); border-radius: 50%; background: var(--loss); color: white; font: var(--ui-text-micro)/1 var(--font-heading); }
.event-track-marker.blue-team { border-color: #35b9dd; }.event-track-marker.red-team { border-color: #e45868; }.event-track-marker.owner-event { box-shadow: 0 0 0 1px var(--gold), 0 2px 8px rgba(0, 0, 0, .65); }
.event-track-marker.item { border-radius: var(--radius-sm); border-color: var(--win); }.event-track-marker.objective { border-color: var(--gold); }.event-track-marker.level { border-color: #8d7edb; background: #211d3c; }.event-track-marker.game { border-color: var(--loss); }
.gold-axis-label { position: absolute; left: 7px; z-index: 1; transform: translateY(-50%); color: var(--text-muted); font-size: var(--ui-text-micro); font-variant-numeric: tabular-nums; pointer-events: none; }.time-axis { position: absolute; bottom: 5px; z-index: 1; color: var(--text-muted); font-size: var(--ui-text-micro); pointer-events: none; }.time-axis.start { left: 7px; }.time-axis.end { right: 7px; }.gold-legend { display: flex; align-items: center; gap: var(--space-3); min-height: 34px; padding: 6px 9px; border: 1px solid var(--border-subtle); border-top: 0; border-radius: 0 0 var(--radius-md) var(--radius-md); background: var(--surface-2); color: var(--text-secondary); font-size: 12px; }.gold-legend > span { display: inline-flex; align-items: center; gap: 5px; }.gold-legend i { width: 14px; height: 3px; border-radius: 2px; }.gold-legend .blue i { background: #35b9dd; }.gold-legend .red i { background: #e45868; }.gold-legend strong { color: var(--text-primary); }.gold-legend .difference { margin-left: auto; }.gold-legend .difference.blue { color: #60cbea; }.gold-legend .difference.red { color: #ef7b88; }
.chart-crosshair { position: absolute; z-index: 3; top: 0; bottom: 0; width: 1px; background: rgba(255,255,255,.48); pointer-events: none; }
.cursor-dot { position: absolute; z-index: 4; width: 9px; height: 9px; transform: translate(-50%,-50%); border: 2px solid var(--surface-0); border-radius: 50%; pointer-events: none; }.cursor-dot.blue { background: #35b9dd; }.cursor-dot.red { background: #e45868; }
.chart-tooltip { position: absolute; z-index: 8; top: 10px; display: flex; flex-direction: column; gap: 2px; min-width: 154px; padding: 8px 9px; transform: translateX(8px); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: rgba(5,12,24,.95); box-shadow: 0 8px 24px rgba(0,0,0,.45); color: var(--text-secondary); font-size: 11px; pointer-events: none; }.chart-tooltip.flip { transform: translateX(calc(-100% - 8px)); }.chart-tooltip strong { color: var(--gold-bright); }.chart-tooltip .blue { color: #60cbea; }.chart-tooltip .red { color: #ef7b88; }.chart-tooltip small { color: var(--text-muted); }
.timeline-filters { display: flex; gap: var(--space-2); margin-top: var(--space-2); flex-wrap: wrap; }.timeline-filters button { padding: 4px 8px; font-size: 11px; }
.timeline-filters button:disabled { opacity: .42; cursor: not-allowed; }.timeline-source-note { margin: var(--space-2) 0 0; color: var(--text-muted); font-size: 11px; }
.events { max-height: 430px; overflow: auto; margin-top: var(--space-3); padding-left: 18px; font-size: 12px; color: var(--text-secondary); border-left: 1px solid var(--border-strong); }.event-row { position: relative; display: grid; grid-template-columns: 42px 30px minmax(0, 1fr); align-items: center; gap: 8px; min-height: 46px; padding: 5px 8px; border-bottom: 1px solid var(--border-subtle); background: color-mix(in srgb, var(--surface-1) 92%, transparent); }.event-row::before { content: ""; position: absolute; left: -22px; width: 7px; height: 7px; border: 2px solid var(--gold); border-radius: 50%; background: var(--surface-0); }.event-row time { color: var(--gold); font-variant-numeric: tabular-nums; }.event-row img { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; }.event-row .victim { filter: grayscale(.35); }.event-row > div { min-width: 0; display: flex; flex-direction: column; }.event-row > div span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.event-glyph { display: grid; place-items: center; width: 26px; height: 26px; border: 1px solid var(--border-strong); border-radius: 50%; color: var(--gold); }.turning-points { margin-top: var(--space-3); font-size: 12px; }
.event-row.kill .kill-event { grid-column: 2 / -1; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 11px; }
.kill-matchup { display: flex; align-items: center; gap: 5px; }.event-row .kill-matchup > img:not(.kill-feed-icon) { width: 32px; height: 32px; border: 1px solid var(--border-strong); }.event-row .kill-matchup .victim { border-color: color-mix(in srgb, var(--loss) 60%, var(--border-strong)); }
.event-row img.kill-feed-icon { width: 15px; height: 15px; border-radius: 0; object-fit: contain; filter: drop-shadow(0 0 3px rgba(200,170,110,.55)); }
.kill-copy { min-width: 0; }.kill-copy > strong { color: var(--text-primary); font-size: 11px; }.kill-copy > strong span { margin-inline: 4px; color: var(--gold); font-size: 11px; font-weight: 500; text-transform: uppercase; }.kill-copy > span { margin-top: 2px; color: var(--text-muted); font-size: 11px; }
.purchase-path { display: flex; align-items: end; gap: 6px; flex-wrap: wrap; margin-top: var(--space-3); font-size: 12px; }.purchase-path strong { flex-basis: 100%; }.purchase-path figure { margin: 0; text-align: center; }.purchase-path img { display: block; width: 34px; height: 34px; border: 1px solid var(--border-strong); border-radius: 4px; }.purchase-path figcaption { margin-top: 2px; color: var(--text-muted); }
.session-list, .experiments-page { display: grid; gap: var(--space-3); }.session-head > div { display: flex; flex-direction: column; }.match-control { display: flex; align-items: center; position: relative; }.match-chip { display: flex; align-items: center; gap: 4px; background: var(--surface-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 3px; cursor: pointer; }.match-chip img { width: 30px; height: 30px; border-radius: var(--radius-sm); }.boundary summary { cursor: pointer; padding: 0 4px; }.boundary[open] { position: relative; }.boundary[open] > button { display: block; width: 110px; background: var(--surface-3); color: var(--text-primary); border: 1px solid var(--border-subtle); padding: 4px; font-size: 12px; cursor: pointer; }
.experiments-page { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }.experiments-page .card:first-child { display: grid; gap: var(--space-2); }.status { margin-left: var(--space-2); color: var(--gold); text-transform: uppercase; font-size: 12px; }
.scope-label { display: grid; gap: 4px; font-size: 11px; }.scope-label select { min-height: 72px; }.experiment-actions { display: flex; gap: var(--space-2); margin-top: var(--space-2); }.experiment-actions button { padding: 4px 8px; font-size: 12px; }
.bookmark-row { width: 100%; display: grid; grid-template-columns: 34px 1fr 36px; align-items: center; gap: var(--space-2); padding: var(--space-2); background: var(--surface-2); color: var(--text-primary); border: 1px solid var(--border-subtle); text-align: left; }.bookmark-row img { width: 32px; height: 32px; border-radius: 50%; }
@media (max-width: 1120px) { .augment-grid { grid-template-columns: repeat(2, minmax(220px, 1fr)); }.timeline-visuals { grid-template-columns: 1fr; }.gold-chart-wrap { height: 280px; }.match-bans { display: none; } }
@media (max-width: 980px) { .rvi-review { grid-template-columns: 1fr; }.rvi-copy { padding: 16px 4px 0; }.rvi-copy p { max-width: 62ch; } }
@media (max-width: 800px) { .review-grid { grid-template-columns: 1fr; }.page-head { align-items: flex-start; flex-wrap: wrap; }.section-heading, .owner-augment-context > header { align-items: flex-start; flex-direction: column; }.event-row { grid-template-columns: 36px 26px minmax(0, 1fr); }.event-row.kill .kill-event { grid-column: 2 / -1; }.match-tabs > button { padding-inline: 14px; }.rvi-review { padding-inline: 14px; }.augment-grid { grid-template-columns: 1fr; } }
@media (max-width: 560px) { :deep(.review-area-tabs) { width: 100%; }.review-area-tabs :deep(button) { flex: 1 0 auto; min-width: max-content; padding-inline: 8px; font-size: var(--ui-text-label); letter-spacing: .5px; }.insight-tabs button { flex: 1 1 50%; min-width: 0; padding-inline: 10px; font-size: 12px; }.match-tab-surface { padding: 10px; }.grade-story { grid-template-columns: 1fr; }.grade-score { justify-self: start; min-width: 104px; }.baseline-summary span { flex-direction: column; align-items: center; gap: 1px; font-size: var(--ui-text-label); }.match-tabs > button { flex: 1 0 auto; padding-inline: 12px; }.gold-legend { align-items: flex-start; flex-wrap: wrap; }.gold-legend .difference { flex-basis: 100%; margin-left: 0; } }
@container recall-content (max-width: 1120px) { .augment-grid { grid-template-columns: repeat(2, minmax(220px, 1fr)); }.timeline-visuals { grid-template-columns: 1fr; }.gold-chart-wrap { height: 280px; }.match-bans { display: none; } }
@container recall-content (max-width: 980px) { .rvi-review { grid-template-columns: 1fr; }.rvi-copy { padding: 16px 4px 0; }.rvi-copy p { max-width: 62ch; } }
@container recall-content (max-width: 900px) { .review-grid { grid-template-columns: 1fr; }.section-heading, .owner-augment-context > header { align-items: flex-start; flex-direction: column; }.event-row { grid-template-columns: 36px 26px minmax(0, 1fr); }.event-row.kill .kill-event { grid-column: 2 / -1; }.rvi-review { padding-inline: 14px; }.augment-grid { grid-template-columns: 1fr; } }
@container recall-content (max-width: 560px) { .match-tab-surface { padding: 10px; }.grade-story { grid-template-columns: 1fr; }.grade-score { justify-self: start; min-width: 104px; }.baseline-summary span { flex-direction: column; align-items: center; gap: 1px; font-size: var(--ui-text-label); }.gold-legend { align-items: flex-start; flex-wrap: wrap; }.gold-legend .difference { flex-basis: 100%; margin-left: 0; } }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
</style>
