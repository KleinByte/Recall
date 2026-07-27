<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import MatchList from "../components/MatchList.vue"
import Pagination from "../components/Pagination.vue"
import StatCard from "../components/StatCard.vue"
import { api } from "../helpers/api"
import {
  formatDecimal,
  formatPercent,
  gradeFromScore,
  modeLabel,
} from "../helpers/format"
import type { Champion } from "../types/lol"
import type {
  MatchQuery,
  MatchRow,
  StatsSummary,
  TrackedMode,
} from "../types/stats"

const props = defineProps<{
  champions: Champion[] | null
  connected: boolean
}>()

const MODES: { value: TrackedMode; label: string }[] = [
  { value: "sr_ranked_solo", label: "Ranked Solo" },
  { value: "sr_ranked_flex", label: "Ranked Flex" },
  { value: "sr_normal", label: "Normal" },
  { value: "sr_quickplay", label: "Quickplay" },
  { value: "sr_swiftplay", label: "Swiftplay" },
  { value: "aram", label: "ARAM" },
  { value: "mayhem", label: "Mayhem" },
]

const RANGES = [
  { label: "All time", days: null },
  { label: "30 days", days: 30 },
  { label: "7 days", days: 7 },
]

const GRADES = [
  { label: "Any grade", score: undefined },
  { label: "A- or better", score: 0.2 },
  { label: "S- or better", score: 0.95 },
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
const minGradeScore = ref<number | undefined>(undefined)
const excludeRemakes = ref(true)
const sortBy = ref<MatchQuery["sortBy"]>("played_at")
const sortDir = ref<"asc" | "desc">("desc")

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
  minGradeScore: minGradeScore.value,
  minDurationSecs: excludeRemakes.value ? 300 : undefined,
  sortBy: sortBy.value,
  sortDir: sortDir.value,
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

onMounted(async () => {
  try {
    playedChampionIds.value = await api.getPlayedChampionIds()
  } catch {
    playedChampionIds.value = []
  }
  void load()
  api.on("stats:updated", () => void load())
  api.on("lcu:status", () => void load())
})

// Any filter change starts again from the first page.
watch(query, () => {
  page.value = 1
  void load()
})

watch([page, pageSize], () => void load())

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
    minGradeScore.value !== undefined,
)

const clearFilters = () => {
  selectedModes.value = []
  rangeDays.value = null
  result.value = undefined
  championId.value = undefined
  minGradeScore.value = undefined
}

const averageGrade = computed(() => gradeFromScore(summary.value?.avgGradeScore))
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>Matches</h1>
        <p class="muted subtitle">
          Every game Recall has recorded, across all tracked modes.
        </p>
      </div>
    </header>

    <div class="filters card">
      <div class="mode-row">
        <button
          v-for="mode in MODES"
          :key="mode.value"
          class="league-button chip"
          :class="{ active: selectedModes.includes(mode.value) }"
          @click="toggleMode(mode.value)"
        >
          {{ mode.label }}
        </button>
      </div>

      <div class="control-row">
        <label class="field">
          <span class="muted field-label">Range</span>
          <select v-model="rangeDays" class="league-select">
            <option v-for="range in RANGES" :key="range.label" :value="range.days">
              {{ range.label }}
            </option>
          </select>
        </label>

        <label class="field">
          <span class="muted field-label">Result</span>
          <select v-model="result" class="league-select">
            <option :value="undefined">Any</option>
            <option value="win">Wins</option>
            <option value="loss">Losses</option>
          </select>
        </label>

        <label class="field">
          <span class="muted field-label">Champion</span>
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
        </label>

        <label class="field">
          <span class="muted field-label">Grade</span>
          <select v-model="minGradeScore" class="league-select">
            <option
              v-for="option in GRADES"
              :key="option.label"
              :value="option.score"
            >
              {{ option.label }}
            </option>
          </select>
        </label>

        <label class="field">
          <span class="muted field-label">Sort</span>
          <select v-model="sortBy" class="league-select">
            <option v-for="option in SORTS" :key="option.label" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>

        <button
          class="league-button dir"
          :title="sortDir === 'desc' ? 'Descending' : 'Ascending'"
          @click="sortDir = sortDir === 'desc' ? 'asc' : 'desc'"
        >
          {{ sortDir === "desc" ? "↓" : "↑" }}
        </button>

        <label class="toggle">
          <input type="checkbox" v-model="excludeRemakes" />
          <span>Hide remakes</span>
        </label>

        <button
          v-if="hasFilters"
          class="league-button clear"
          @click="clearFilters"
        >
          Clear filters
        </button>
      </div>
    </div>

    <section v-if="summary && summary.games > 0" class="kpis">
      <StatCard label="Games" :value="summary.games.toString()" />
      <StatCard
        label="Win rate"
        :value="formatPercent(summary.winRate)"
        :tone="summary.winRate >= 0.5 ? 'win' : 'loss'"
      />
      <StatCard label="KDA" :value="formatDecimal(summary.kda, 2)" />
      <StatCard label="Avg grade" :value="averageGrade ?? '–'" />
    </section>

    <div v-if="total === 0 && !loading" class="card notice">
      <template v-if="hasFilters">
        <h2 class="section-title">No matches for these filters</h2>
        <p class="muted">
          Nothing recorded matches the current selection.
          <button class="link" @click="clearFilters">Clear the filters</button>
          to see everything.
        </p>
      </template>
      <template v-else>
        <h2 class="section-title">No matches recorded yet</h2>
        <p class="muted">
          Recall records games from the moment it is installed and keeps them
          permanently. The League client can only ever hand over its most recent
          20 games, so history before that cannot be recovered.
        </p>
      </template>
    </div>

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
  gap: var(--space-4);
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

.filters {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}

.mode-row {
  display: flex;
  gap: var(--space-1);
  flex-wrap: wrap;
}

.chip {
  padding: var(--space-2) var(--space-3);
}

.control-row {
  display: flex;
  gap: var(--space-3);
  align-items: flex-end;
  flex-wrap: wrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.field-label {
  font-size: 10px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
}

.dir {
  padding: var(--space-2) var(--space-3);
}

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
  padding: var(--space-2) var(--space-3);
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

.notice p {
  margin: 0;
  font-size: 13px;
}

.link {
  background: none;
  border: none;
  padding: 0;
  color: var(--gold);
  cursor: pointer;
  font: inherit;
  text-decoration: underline;
}
</style>
