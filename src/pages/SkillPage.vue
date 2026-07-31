<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from "vue"
import SkillOverview from "../components/skill/SkillOverview.vue"
import { api } from "../helpers/api"
import {
  filterForSkillScope,
  SKILL_SCOPES,
  type SkillScopeId,
} from "../helpers/skill-scopes"
import type { Champion } from "../types/lol"
import type { SkillReportV2, StatsFilter } from "../types/stats"

const SkillInsights = defineAsyncComponent(() => import("../components/skill/SkillInsights.vue"))

const props = defineProps<{
  champions: Champion[] | null
  connected: boolean
}>()

type SkillTab = "overview" | "insights"

const ROLES = [
  { value: "TOP", label: "Top" },
  { value: "JUNGLE", label: "Jungle" },
  { value: "MIDDLE", label: "Mid" },
  { value: "BOTTOM", label: "Bot" },
  { value: "UTILITY", label: "Support" },
]

const scopeId = ref<SkillScopeId>("riftAll")
const season = ref<number | undefined>(undefined)
const role = ref<string | undefined>(undefined)
const championId = ref<number | undefined>(undefined)
const tab = ref<SkillTab>("overview")
const counts = ref<Record<SkillScopeId, number>>(
  Object.fromEntries(SKILL_SCOPES.map((scope) => [scope.id, 0])) as Record<SkillScopeId, number>,
)
const report = ref<SkillReportV2 | null>(null)
const loading = ref(true)
const failed = ref(false)
const oldestPlayedAt = ref<number | undefined>()
const playedChampionIds = ref<number[]>([])
let choseInitialScope = false

const selectedScope = computed(() =>
  SKILL_SCOPES.find((scope) => scope.id === scopeId.value)!,
)
const riftScopes = computed(() =>
  SKILL_SCOPES.filter((scope) => scope.primary === "rift"),
)
const otherScopes = computed(() =>
  SKILL_SCOPES.filter((scope) => scope.primary !== "rift"),
)
const seasonOptions = computed(() => {
  const newest = new Date().getFullYear()
  const oldest = oldestPlayedAt.value
    ? new Date(oldestPlayedAt.value).getFullYear()
    : newest
  return Array.from({ length: newest - oldest + 1 }, (_, index) => newest - index)
})
const championOptions = computed(() => {
  const played = new Set(playedChampionIds.value)
  return (props.champions ?? [])
    .filter((champion) => played.has(champion.id))
    .sort((left, right) => left.name.localeCompare(right.name))
})
const hasDetailFilters = computed(() =>
  season.value !== undefined || role.value !== undefined || championId.value !== undefined,
)
const timezoneLabel = Intl.DateTimeFormat().resolvedOptions().timeZone || "local time"

function detailFilter(): StatsFilter {
  const filter: StatsFilter = {}
  if (season.value !== undefined) {
    filter.sinceMs = new Date(season.value, 0, 1).getTime()
    filter.untilMs = new Date(season.value + 1, 0, 1).getTime() - 1
  }
  if (role.value !== undefined && selectedScope.value.family === "sr") {
    filter.roles = [role.value]
  }
  if (championId.value !== undefined) filter.championIds = [championId.value]
  return filter
}

function currentFilter(scope: SkillScopeId = scopeId.value): StatsFilter {
  return { ...filterForSkillScope(scope), ...detailFilter() }
}

async function loadCounts() {
  const summaries = await Promise.all(
    SKILL_SCOPES.map((scope) => api.getSummary(currentFilter(scope.id))),
  )

  counts.value = Object.fromEntries(
    SKILL_SCOPES.map((scope, index) => [scope.id, summaries[index].games]),
  ) as Record<SkillScopeId, number>

  if (!choseInitialScope) {
    const candidates: SkillScopeId[] = ["riftAll", "aram", "mayhem"]
    scopeId.value = candidates.reduce((best, id) =>
      counts.value[id] > counts.value[best] ? id : best,
    )
    choseInitialScope = true
  }
}

async function loadReport() {
  loading.value = true
  failed.value = false
  try {
    const scope = selectedScope.value
    report.value = await api.getSkillReport(
      currentFilter(scope.id),
      scope.family,
    )
  } catch (error) {
    console.warn("Could not load Skill report", error)
    report.value = null
    failed.value = true
  } finally {
    loading.value = false
  }
}

async function applyFilters() {
  if (selectedScope.value.family !== "sr") role.value = undefined
  await Promise.all([loadCounts(), loadReport()])
}

async function clearDetailFilters() {
  season.value = undefined
  role.value = undefined
  championId.value = undefined
  await applyFilters()
}

onMounted(async () => {
  try {
    const [meta, championIds] = await Promise.all([
      api.getStatsMeta(),
      api.getPlayedChampionIds(),
    ])
    oldestPlayedAt.value = meta.oldestPlayedAt
    playedChampionIds.value = championIds
    await loadCounts()
  } catch {
    // The normal empty state handles an account without recorded matches.
  }
  await loadReport()
  api.on("stats:updated", () => void applyFilters())
  api.on("lcu:status", () => void loadReport())
})
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>Skill</h1>
        <p class="muted subtitle">Measurements and evidence from your recorded games.</p>
      </div>

    </header>

    <section class="filters card" aria-label="Skill report filters">
      <div class="control-row">
        <label class="field">
          <span class="muted field-label">Game mode</span>
          <select v-model="scopeId" class="league-select" @change="applyFilters">
            <optgroup label="Summoner's Rift">
              <option v-for="scope in riftScopes" :key="scope.id" :value="scope.id">
                {{ scope.label }} · {{ counts[scope.id] }}
              </option>
            </optgroup>
            <optgroup label="Howling Abyss">
              <option v-for="scope in otherScopes" :key="scope.id" :value="scope.id">
                {{ scope.label }} · {{ counts[scope.id] }}
              </option>
            </optgroup>
          </select>
        </label>

        <label class="field">
          <span class="muted field-label">Season</span>
          <select v-model="season" class="league-select" @change="applyFilters">
            <option :value="undefined">All seasons</option>
            <option v-for="year in seasonOptions" :key="year" :value="year">{{ year }} season</option>
          </select>
        </label>

        <label class="field">
          <span class="muted field-label">Role</span>
          <select
            v-model="role"
            class="league-select"
            :disabled="selectedScope.family !== 'sr'"
            @change="applyFilters"
          >
            <option :value="undefined">Any role</option>
            <option v-for="option in ROLES" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>

        <label class="field champion-field">
          <span class="muted field-label">Champion</span>
          <select v-model="championId" class="league-select" @change="applyFilters">
            <option :value="undefined">Any champion</option>
            <option v-for="champion in championOptions" :key="champion.id" :value="champion.id">
              {{ champion.name }}
            </option>
          </select>
        </label>

        <button v-if="hasDetailFilters" class="league-button clear" @click="clearDetailFilters">
          Clear filters
        </button>
      </div>
      <p class="filter-note muted">
        Every chart and finding below uses this exact selection.
      </p>
    </section>

    <nav class="tab-row" aria-label="Skill view">
      <button
        class="tab-button"
        :class="{ active: tab === 'overview' }"
        :aria-pressed="tab === 'overview'"
        @click="tab = 'overview'"
      >
        Overview
      </button>
      <button
        class="tab-button"
        :class="{ active: tab === 'insights' }"
        :aria-pressed="tab === 'insights'"
        @click="tab = 'insights'"
      >
        Insights
      </button>
    </nav>

    <div v-if="loading && !report" class="card notice muted">Loading Skill report…</div>

    <div v-else-if="failed" class="card notice">
      <h2 class="section-title">Skill report unavailable</h2>
      <p class="muted">The recorded matches are still intact. Try this scope again.</p>
    </div>

    <div v-else-if="!report?.overview.summary.games" class="card notice">
      <h2 class="section-title">Nothing recorded for this scope yet</h2>
      <p class="muted">
        Play a game in {{ selectedScope.label }} with Recall running, or import Riot
        history from Settings.
      </p>
    </div>

    <SkillOverview
      v-else-if="report && tab === 'overview'"
      :overview="report.overview"
      :family="report.scope.family"
      :champions="champions"
    />
    <SkillInsights
      v-else-if="report"
      :report="report"
      :timezone-label="timezoneLabel"
      :champions="champions"
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
  margin: 0;
  color: var(--gold-bright);
  font-family: var(--font-display);
  font-size: 22px;
  letter-spacing: 1px;
}

.subtitle {
  margin: var(--space-1) 0 0;
  font-size: 12px;
}

.filters { padding: var(--space-3) var(--space-4); }
.control-row { display: flex; align-items: end; flex-wrap: wrap; gap: var(--space-3); }
.field { display: grid; flex: 1 1 160px; gap: var(--space-1); min-width: 150px; }
.champion-field { flex-grow: 1.2; min-width: 190px; }
.field-label { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.field .league-select { width: 100%; }
.field .league-select:disabled { cursor: not-allowed; opacity: .55; }
.clear { min-height: 34px; }
.filter-note { margin: var(--space-2) 0 0; font-size: 11px; }

.tab-row {
  display: flex;
  gap: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

.tab-button {
  min-width: 88px;
  min-height: 34px;
  padding: 0 var(--space-2);
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  font-family: var(--font-heading);
  font-size: 12px;
  cursor: pointer;
}

.tab-button:hover,
.tab-button.active {
  color: var(--gold-bright);
}

.tab-button.active {
  border-bottom-color: var(--gold);
}

.notice {
  padding: var(--space-5);
}

.notice p {
  margin-bottom: 0;
}

@media (max-width: 760px) {
  .field { flex-basis: 150px; }
  .champion-field { flex-basis: 190px; }
}
</style>
