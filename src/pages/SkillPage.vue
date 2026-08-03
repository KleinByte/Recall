<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from "vue"
import ChampionPicker from "../components/ChampionPicker.vue"
import SkillOverview from "../components/skill/SkillOverview.vue"
import { api } from "../helpers/api"
import { useApiEvents } from "../helpers/use-api-events"
import { useCoalescedTask } from "../helpers/use-coalesced-task"
import {
  filterForSkillScope,
  SKILL_SCOPES,
  type SkillScopeId,
} from "../helpers/skill-scopes"
import type { Champion } from "../types/lol"
import type { RankedHistory, SkillReportV2, StatsFilter } from "../types/stats"

const SkillInsights = defineAsyncComponent(() => import("../components/skill/SkillInsights.vue"))
const SkillAnalyze = defineAsyncComponent(() => import("../components/skill/SkillAnalyze.vue"))
const events = useApiEvents()

const props = defineProps<{
  champions: Champion[] | null
  connected: boolean
}>()

type SkillTab = "overview" | "insights" | "analyze"

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
const ranked = ref<RankedHistory[]>([])
const loading = ref(true)
const failed = ref(false)
const oldestPlayedAt = ref<number | undefined>()
const playedChampionIds = ref<number[]>([])
let choseInitialScope = false
let countsRequest = 0
let reportRequest = 0

const selectedScope = computed(() =>
  SKILL_SCOPES.find((scope) => scope.id === scopeId.value)!,
)
const riftScopes = computed(() =>
  SKILL_SCOPES.filter((scope) => scope.primary === "rift"),
)
const abyssScopes = computed(() =>
  SKILL_SCOPES.filter((scope) => scope.primary === "aram" || scope.primary === "mayhem"),
)
const classicScopes = computed(() =>
  SKILL_SCOPES.filter((scope) => scope.primary === "classic"),
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
  if (role.value !== undefined && (selectedScope.value.family === "sr" || selectedScope.value.family === "classic")) {
    filter.roles = [role.value]
  }
  if (championId.value !== undefined) filter.championIds = [championId.value]
  return filter
}

function currentFilter(scope: SkillScopeId = scopeId.value): StatsFilter {
  return { ...filterForSkillScope(scope), ...detailFilter() }
}

async function loadCounts() {
  const request = ++countsRequest
  const summaries = await Promise.all(
    SKILL_SCOPES.map((scope) => api.getSummary(currentFilter(scope.id))),
  )

  if (request !== countsRequest) return

  counts.value = Object.fromEntries(
    SKILL_SCOPES.map((scope, index) => [scope.id, summaries[index].games]),
  ) as Record<SkillScopeId, number>

  if (!choseInitialScope) {
    const candidates: SkillScopeId[] = ["riftAll", "aram", "mayhem", "leagueClassic"]
    scopeId.value = candidates.reduce((best, id) =>
      counts.value[id] > counts.value[best] ? id : best,
    )
    choseInitialScope = true
  }
}

async function loadReport() {
  const request = ++reportRequest
  loading.value = true
  failed.value = false
  try {
    const scope = selectedScope.value
    const nextReport = await api.getSkillReport(
      currentFilter(scope.id),
      scope.family,
    )
    if (request === reportRequest) report.value = nextReport
  } catch (error) {
    if (request !== reportRequest) return
    console.warn("Could not load Skill report", error)
    report.value = null
    failed.value = true
  } finally {
    if (request === reportRequest) loading.value = false
  }
}

async function applyFilters() {
  if (selectedScope.value.family !== "sr" && selectedScope.value.family !== "classic") role.value = undefined
  await Promise.all([loadCounts(), loadReport()])
}

async function clearDetailFilters() {
  season.value = undefined
  role.value = undefined
  championId.value = undefined
  await applyFilters()
}

const refreshAll = useCoalescedTask(applyFilters)
const refreshReport = useCoalescedTask(loadReport)

onMounted(async () => {
  try {
    const [meta, championIds, rankedHistory] = await Promise.all([
      api.getStatsMeta(),
      api.getPlayedChampionIds(),
      api.getRankedHistory(),
    ])
    oldestPlayedAt.value = meta.oldestPlayedAt
    playedChampionIds.value = championIds
    ranked.value = rankedHistory
    await loadCounts()
  } catch {
    // The normal empty state handles an account without recorded matches.
  }
  await loadReport()
  events.on("stats:updated", () => void refreshAll())
  events.on("ranked:updated", async () => {
    ranked.value = await api.getRankedHistory()
  })
  events.on("lcu:status", () => void refreshReport())
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
              <option v-for="scope in abyssScopes" :key="scope.id" :value="scope.id">
                {{ scope.label }} · {{ counts[scope.id] }}
              </option>
            </optgroup>
            <optgroup label="League Classic">
              <option v-for="scope in classicScopes" :key="scope.id" :value="scope.id">
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
            :disabled="selectedScope.family !== 'sr' && selectedScope.family !== 'classic'"
            @change="applyFilters"
          >
            <option :value="undefined">Any role</option>
            <option v-for="option in ROLES" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>

        <div class="field champion-field">
          <span class="muted field-label">Champion</span>
          <ChampionPicker
            v-model="championId"
            :champions="championOptions"
            @change="applyFilters"
          />
        </div>

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
      <button
        class="tab-button"
        :class="{ active: tab === 'analyze' }"
        :aria-pressed="tab === 'analyze'"
        @click="tab = 'analyze'"
      >
        Analyze
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
      :ranked="ranked"
    />
    <SkillInsights
      v-else-if="report && tab === 'insights'"
      :report="report"
      :timezone-label="timezoneLabel"
      :champions="champions"
    />
    <SkillAnalyze
      v-else-if="report && tab === 'analyze'"
      :report="report"
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
.control-row {
  display: grid;
  grid-template-columns:
    minmax(150px, 1.05fr)
    minmax(135px, .8fr)
    minmax(135px, .8fr)
    minmax(210px, 1.25fr)
    auto;
  align-items: end;
  gap: var(--space-3);
}

.field { display: grid; gap: var(--space-1); min-width: 0; }
.champion-field { min-width: 0; }
.field-label { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
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

@media (max-width: 1050px) {
  .control-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .clear { justify-self: start; }
}

@media (max-width: 560px) {
  .page { gap: var(--space-3); }
  .filters { padding: var(--space-3); }
  .control-row { grid-template-columns: minmax(0, 1fr); }
  .clear { width: 100%; }
  .filter-note { line-height: 1.45; }
}
</style>
