<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import MatchList from "../components/MatchList.vue"
import Pagination from "../components/Pagination.vue"
import {
  Button,
  EmptyState,
  Field,
  PageHeader,
  StatTile,
  Surface,
} from "../components/ui"
import { api } from "../helpers/api"
import { useApiEvents } from "../helpers/use-api-events"
import { useCoalescedTask } from "../helpers/use-coalesced-task"
import {
  formatDecimal,
  formatPercent,
  modeLabel,
} from "../helpers/format"
import {
  RECALL_SCORE_THRESHOLDS,
  recallGradeFromRecallScore,
  type RecallGrade,
} from "../shared/recall-grade"
import type { Champion } from "../types/lol"
import type {
  MatchQuery,
  MatchRow,
  StatsSummary,
  TrackedMode,
} from "../types/stats"
import type { AnnotationTag, PracticeExperiment } from "../types/review"

const props = defineProps<{
  champions: Champion[] | null
  connected: boolean
}>()
const events = useApiEvents()

const MODES: { value: TrackedMode; label: string }[] = [
  { value: "sr_ranked_solo", label: "Ranked Solo" },
  { value: "sr_ranked_flex", label: "Ranked Flex" },
  { value: "sr_normal", label: "Normal" },
  { value: "sr_quickplay", label: "Quickplay" },
  { value: "sr_swiftplay", label: "Swiftplay" },
  { value: "aram", label: "ARAM" },
  { value: "mayhem", label: "Mayhem" },
  { value: "league_classic", label: "League Classic" },
  { value: "other", label: "Other" },
]

const RANGES = [
  { label: "All time", days: null },
  { label: "30 days", days: 30 },
  { label: "7 days", days: 7 },
]

const recallScoreMinimum = (grade: RecallGrade) =>
  RECALL_SCORE_THRESHOLDS.find(([candidate]) => candidate === grade)?.[1]

const GRADES = [
  { label: "Any grade", score: undefined },
  { label: "A- or better", score: recallScoreMinimum("A-") },
  { label: "S- or better", score: recallScoreMinimum("S-") },
]

const SORTS: { value: MatchQuery["sortBy"]; label: string }[] = [
  { value: "played_at", label: "Date" },
  { value: "kda", label: "KDA" },
  { value: "damage", label: "Damage" },
  { value: "grade", label: "Grade" },
  { value: "duration", label: "Duration" },
]

const selectedModes = ref<TrackedMode[]>([])
const rangeDays = ref<number | null>(null)
const result = ref<"win" | "loss" | undefined>(undefined)
const championId = ref<number | undefined>(undefined)
const minRecallScore = ref<number | undefined>(undefined)
const excludeRemakes = ref(true)
const sortBy = ref<MatchQuery["sortBy"]>("played_at")
const sortDir = ref<"asc" | "desc">("desc")
const bookmarked = ref(false)
const hasNotes = ref(false)
const tagId = ref<number>()
const experimentId = ref<number>()
const tags = ref<AnnotationTag[]>([])
const experiments = ref<PracticeExperiment[]>([])

const page = ref(1)
const pageSize = ref(25)

const rows = ref<MatchRow[]>([])
const total = ref(0)
const summary = ref<StatsSummary | null>(null)
const playedChampionIds = ref<number[]>([])
const loading = ref(false)

const query = computed<MatchQuery>(() => ({
  modes: selectedModes.value.length ? selectedModes.value : undefined,
  sinceMs:
    rangeDays.value === null
      ? undefined
      : Date.now() - rangeDays.value * 86_400_000,
  result: result.value,
  championIds: championId.value ? [championId.value] : undefined,
  minRecallScore: minRecallScore.value,
  minDurationSecs: excludeRemakes.value ? 300 : undefined,
  sortBy: sortBy.value,
  sortDir: sortDir.value,
  bookmarked: bookmarked.value || undefined,
  hasNotes: hasNotes.value || undefined,
  tagIds: tagId.value ? [tagId.value] : undefined,
  experimentId: experimentId.value,
}))

async function load() {
  loading.value = true
  try {
    const [pageResult, summaryResult] = await Promise.all([
      api.listMatches(query.value, page.value, pageSize.value),
      // The summary uses the same query, so it always describes these rows.
      api.getSummary(query.value),
    ])

    rows.value = pageResult.rows
    total.value = pageResult.total
    page.value = pageResult.page
    summary.value = summaryResult
  } catch (error) {
    console.warn("Could not load match history", error)
    rows.value = []
    total.value = 0
    summary.value = null
  } finally {
    loading.value = false
  }
}

async function loadPlayedChampions() {
  try {
    playedChampionIds.value = await api.getPlayedChampionIds()
  } catch {
    playedChampionIds.value = []
  }
}

const refreshMatches = useCoalescedTask(load)
const refreshChampionIds = useCoalescedTask(loadPlayedChampions)

onMounted(async () => {
  await refreshChampionIds()
  void refreshMatches()
  events.on("stats:updated", () => {
    void refreshChampionIds()
    void refreshMatches()
  })
  events.on("lcu:status", () => void refreshMatches())
  void api.listTags().then((rows) => { tags.value = rows })
  void api.listExperiments().then((rows) => { experiments.value = rows })
  events.on("review:updated", () => void refreshMatches())
})

// Any filter change starts again from the first page.
watch(query, () => {
  if (page.value !== 1) page.value = 1
  else void refreshMatches()
})

watch([page, pageSize], () => void refreshMatches())

const toggleMode = (mode: TrackedMode) => {
  selectedModes.value = selectedModes.value.includes(mode)
    ? selectedModes.value.filter((entry) => entry !== mode)
    : [...selectedModes.value, mode]
}

const championOptions = computed(() => {
  if (!props.champions) return []
  const played = new Set(playedChampionIds.value)
  return props.champions
    .filter((champion) => played.has(champion.id))
    .sort((a, b) => a.name.localeCompare(b.name))
})

const hasFilters = computed(
  () =>
    selectedModes.value.length > 0 ||
    rangeDays.value !== null ||
    result.value !== undefined ||
    championId.value !== undefined ||
    minRecallScore.value !== undefined ||
    bookmarked.value ||
    hasNotes.value ||
    tagId.value !== undefined ||
    experimentId.value !== undefined,
)

const clearFilters = () => {
  selectedModes.value = []
  rangeDays.value = null
  result.value = undefined
  championId.value = undefined
  minRecallScore.value = undefined
  bookmarked.value = false
  hasNotes.value = false
  tagId.value = undefined
  experimentId.value = undefined
}

const averageGrade = computed(() => recallGradeFromRecallScore(summary.value?.averageRecallScore))
</script>

<template>
  <div class="page">
    <PageHeader
      title="Matches"
      eyebrow="Performance archive"
      description="Every game Recall has recorded, across all tracked modes."
    />

    <Surface
      as="section"
      variant="toolbar"
      padding="compact"
      class="filters"
      aria-label="Match filters"
    >
      <div class="mode-row">
        <Button
          v-for="mode in MODES"
          :key="mode.value"
          class="chip"
          size="compact"
          :active="selectedModes.includes(mode.value)"
          @click="toggleMode(mode.value)"
        >
          {{ mode.label }}
        </Button>
      </div>

      <div class="control-row">
        <Field label="Range" compact>
          <select v-model="rangeDays" class="league-select">
            <option v-for="range in RANGES" :key="range.label" :value="range.days">
              {{ range.label }}
            </option>
          </select>
        </Field>

        <Field label="Result" compact>
          <select v-model="result" class="league-select">
            <option :value="undefined">Any</option>
            <option value="win">Wins</option>
            <option value="loss">Losses</option>
          </select>
        </Field>

        <Field label="Champion" compact>
          <select v-model="championId" class="league-select">
            <option :value="undefined">Any champion</option>
            <option
              v-for="champion in championOptions"
              :key="champion.id"
              :value="champion.id"
            >
              {{ champion.name }}
            </option>
          </select>
        </Field>

        <Field label="Grade" compact>
          <select v-model="minRecallScore" class="league-select">
            <option
              v-for="option in GRADES"
              :key="option.label"
              :value="option.score"
            >
              {{ option.label }}
            </option>
          </select>
        </Field>

        <Field label="Sort" compact>
          <select v-model="sortBy" class="league-select">
            <option v-for="option in SORTS" :key="option.label" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </Field>

        <Button
          class="dir"
          size="compact"
          icon-only
          :title="sortDir === 'desc' ? 'Descending' : 'Ascending'"
          :aria-label="sortDir === 'desc' ? 'Sort descending' : 'Sort ascending'"
          @click="sortDir = sortDir === 'desc' ? 'asc' : 'desc'"
        >
          {{ sortDir === "desc" ? "↓" : "↑" }}
        </Button>

        <label class="toggle">
          <input type="checkbox" v-model="excludeRemakes" />
          <span>Hide remakes</span>
        </label>

        <label class="toggle">
          <input v-model="bookmarked" type="checkbox" />
          <span>Bookmarked</span>
        </label>

        <label class="toggle">
          <input v-model="hasNotes" type="checkbox" />
          <span>Has notes</span>
        </label>

        <Field v-if="tags.length" label="Tag" compact>
          <select v-model="tagId" class="league-select">
            <option :value="undefined">Any tag</option>
            <option v-for="tag in tags" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
          </select>
        </Field>

        <Field v-if="experiments.length" label="Experiment" compact>
          <select v-model="experimentId" class="league-select">
            <option :value="undefined">Any experiment</option>
            <option v-for="experiment in experiments" :key="experiment.id" :value="experiment.id">
              {{ experiment.name }}
            </option>
          </select>
        </Field>

        <Button
          v-if="hasFilters"
          class="clear"
          variant="ghost"
          size="compact"
          @click="clearFilters"
        >
          Clear filters
        </Button>
      </div>
    </Surface>

    <Surface
      v-if="summary && summary.games > 0"
      as="section"
      variant="quiet"
      padding="compact"
      class="kpis"
      aria-label="Filtered match summary"
    >
      <StatTile density="compact" label="Games" :value="summary.games.toString()" />
      <StatTile
        density="compact"
        label="Win rate"
        :value="formatPercent(summary.winRate)"
        :tone="summary.winRate >= 0.5 ? 'win' : 'loss'"
      />
      <StatTile density="compact" label="KDA" :value="formatDecimal(summary.kda, 2)" />
      <StatTile
        density="compact"
        label="Average Recall Score"
        :value="summary.averageRecallScore?.toFixed(1) ?? '–'"
        :hint="averageGrade ?? 'No grade'"
      />
    </Surface>

    <EmptyState
      v-if="total === 0 && !loading"
      class="notice"
      :title="hasFilters ? 'No matches for these filters' : 'No matches recorded yet'"
      :description="hasFilters
        ? 'Nothing recorded matches the current selection.'
        : 'Recall records games as you play and keeps them permanently. Add a Riot API key in Settings to import every older match Riot still exposes; without one, the League client fallback provides 20 games.'"
    >
      <template v-if="hasFilters" #actions>
        <Button size="compact" @click="clearFilters">Clear filters</Button>
      </template>
    </EmptyState>

    <template v-else>
      <Pagination
        v-model:page="page"
        v-model:pageSize="pageSize"
        :total="total"
      />

      <MatchList :matches="rows" :champions="champions" />

      <Pagination
        v-model:page="page"
        v-model:pageSize="pageSize"
        :total="total"
      />
    </template>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-5);
  width: min(100%, 1480px);
  margin-inline: auto;
}

.filters {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-3);
}

.mode-row {
  display: flex;
  gap: var(--ui-space-1);
  flex-wrap: wrap;
}

.control-row {
  display: flex;
  gap: var(--ui-space-3);
  align-items: flex-end;
  flex-wrap: wrap;
}

.control-row > :deep(.ui-field) { flex: 1 1 130px; }
.dir { flex: 0 0 auto; }

.toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
  cursor: pointer;
  padding-bottom: var(--space-2);
}

.toggle input {
  accent-color: var(--gold);
}

.clear {
  margin-left: auto;
}

.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-3);
}

.notice {
  max-width: 62ch;
}

@container recall-content (max-width: 760px) {
  .page { gap: var(--ui-space-4); }
  .control-row { align-items: stretch; }
  .control-row > :deep(.ui-field) { flex-basis: calc(50% - var(--ui-space-2)); }
  .dir { align-self: end; }
  .toggle { flex: 1 1 130px; padding: var(--ui-space-2) 0 0; }
  .clear { margin-left: 0; }
}

@container recall-content (max-width: 430px) {
  .mode-row > :deep(.ui-button) { flex: 1 1 calc(50% - var(--ui-space-1)); }
  .control-row > :deep(.ui-field) { flex-basis: 100%; }
}
</style>
