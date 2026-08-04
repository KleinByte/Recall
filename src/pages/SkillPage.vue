<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from "vue"
import ChampionPicker from "../components/ChampionPicker.vue"
import SkillOverview from "../components/skill/SkillOverview.vue"
import {
  Button as UiButton,
  EmptyState,
  Field as UiField,
  PageHeader,
  Surface,
  Tabs as UiTabs,
} from "../components/ui"
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
const tabModel = computed<string>({
  get: () => tab.value,
  set: (value) => { tab.value = value as SkillTab },
})
const tabOptions = [
  { value: "overview", label: "Overview" },
  { value: "insights", label: "Insights" },
  { value: "analyze", label: "Analyze" },
]
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
    <PageHeader
      title="Skill"
      eyebrow="Performance laboratory"
      description="Measurements and evidence from your recorded games."
    />

    <Surface as="section" variant="toolbar" padding="compact" class="filters" aria-label="Skill report filters">
      <div class="control-row">
        <UiField label="Game mode" compact>
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
        </UiField>

        <UiField label="Season" compact>
          <select v-model="season" class="league-select" @change="applyFilters">
            <option :value="undefined">All seasons</option>
            <option v-for="year in seasonOptions" :key="year" :value="year">{{ year }} season</option>
          </select>
        </UiField>

        <UiField label="Role" compact>
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
        </UiField>

        <div class="champion-field">
          <span class="field-caption">Champion</span>
          <ChampionPicker
            v-model="championId"
            :champions="championOptions"
            @change="applyFilters"
          />
        </div>

        <UiButton v-if="hasDetailFilters" class="clear" variant="ghost" @click="clearDetailFilters">
          Clear filters
        </UiButton>
      </div>
      <p class="filter-note muted">
        Every chart and finding below uses this exact selection.
      </p>
    </Surface>

    <section class="skill-view" aria-label="Skill analysis">
      <UiTabs v-model="tabModel" :options="tabOptions" label="Skill view" />
      <Surface variant="quiet" padding="compact" class="skill-tab-surface">
        <EmptyState
          v-if="loading && !report"
          compact
          title="Loading Skill report"
          description="Recall is assembling the measurements for this selection."
        />

        <EmptyState
          v-else-if="failed"
          compact
          tone="warning"
          title="Skill report unavailable"
          description="The recorded matches are still intact. Try this scope again."
        />

        <EmptyState
          v-else-if="!report?.overview.summary.games"
          compact
          title="Nothing recorded for this scope yet"
          :description="`Play a game in ${selectedScope.label} with Recall running, or import Riot history from Settings.`"
        />

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
      </Surface>
    </section>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-4);
  container: recall-content / inline-size;
}

.control-row {
  display: grid;
  grid-template-columns:
    minmax(150px, 1.05fr)
    minmax(135px, .8fr)
    minmax(135px, .8fr)
    minmax(210px, 1.25fr)
    auto;
  align-items: end;
  gap: var(--ui-space-3);
}

.champion-field { display: grid; align-content: start; gap: 5px; min-width: 0; }
.field-caption { color: var(--ui-text-muted); font: var(--ui-label-size) var(--ui-font-heading); letter-spacing: 1.2px; text-transform: uppercase; }
.control-row :deep(.league-select:disabled) { cursor: not-allowed; opacity: .55; }
.clear { min-height: 34px; }
.filter-note { margin: var(--ui-space-2) 0 0; font-size: 11px; }

.skill-view { min-width: 0; }
.skill-tab-surface { border-top: 0; border-radius: 0 0 var(--ui-radius-md) var(--ui-radius-md); box-shadow: none; }

@container recall-content (max-width: 920px) {
  .control-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .clear { justify-self: start; }
}

@container recall-content (max-width: 520px) {
  .page { gap: var(--ui-space-3); }
  .control-row { grid-template-columns: minmax(0, 1fr); }
  .clear { width: 100%; }
  .filter-note { line-height: 1.45; }
}
</style>
