import { computed, onBeforeUnmount, ref } from "vue"
import { api } from "../../helpers/api"
import { focusReviewGameId } from "../../helpers/navigation"
import { useCoalescedTask } from "../../helpers/use-coalesced-task"
import type { MatchRow, PerformanceDimensionScore, PerformanceProfile, TrackedMode } from "../../types/stats"
import type {
  AnnotationTag,
  ExperimentOutcomeValue,
  MatchReview,
  OwnerAugmentSummary,
  PracticeExperiment,
  ReviewSession,
} from "../../types/review"

interface ReviewPageDataOptions {
  resetMatchView: () => void
  showPerformanceBreakdown: () => void
}

/**
 * Owns the current-review data lifecycle and mutations. Presentation-only
 * state remains in ReviewPage so changing tabs never changes what is loaded.
 */
export function useReviewPageData(options: ReviewPageDataOptions) {
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
  const augmentSummary = ref<Record<number, OwnerAugmentSummary>>({})
  const augmentSummaryLoading = ref(false)
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let annotationSavesInFlight = 0

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
    options.resetMatchView()
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
          dimension.score !== null || dimension.metrics.length > 0)) options.showPerformanceBreakdown()
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

  async function refreshTimeline(gameId: number) {
    if (review.value?.match.gameId !== gameId) return
    const timeline = await api.getTimeline(gameId)
    if (review.value) review.value.timeline = timeline
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

  function refreshCurrentWhenIdle() {
    if (!saveTimer && annotationSavesInFlight === 0) void refreshCurrent()
  }

  onBeforeUnmount(() => {
    if (saveTimer) void saveAnnotation()
  })

  return {
    review,
    careerRvi,
    sessions,
    tags,
    experiments,
    bookmarks,
    busy,
    error,
    newTag,
    experimentName,
    experimentHypothesis,
    experimentChampionIds,
    experimentModes,
    augmentSummary,
    augmentSummaryLoading,
    gameRviPresentation,
    hasGameRviEvidence,
    load,
    queueNoteSave,
    toggleBookmark,
    toggleTag,
    createTag,
    loadTimeline,
    refreshTimeline,
    setBoundary,
    createExperiment,
    setExperimentStatus,
    updateOutcome,
    refreshCurrentWhenIdle,
  }
}
