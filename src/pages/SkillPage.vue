<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import SkillOverview from "../components/skill/SkillOverview.vue"
import { api } from "../helpers/api"
import {
  filterForSkillScope,
  SKILL_SCOPES,
  type SkillScopeId,
} from "../helpers/skill-scopes"
import type { Champion } from "../types/lol"
import type { SkillReportV2 } from "../types/stats"

defineProps<{
  champions: Champion[] | null
  connected: boolean
}>()

type PrimaryMode = "rift" | "aram" | "mayhem"

const PRIMARY_MODES: Array<{ id: PrimaryMode; label: string }> = [
  { id: "rift", label: "Summoner's Rift" },
  { id: "aram", label: "ARAM" },
  { id: "mayhem", label: "Mayhem" },
]

const primary = ref<PrimaryMode>("rift")
const scopeId = ref<SkillScopeId>("riftAll")
const counts = ref<Record<SkillScopeId, number>>(
  Object.fromEntries(SKILL_SCOPES.map((scope) => [scope.id, 0])) as Record<SkillScopeId, number>,
)
const report = ref<SkillReportV2 | null>(null)
const loading = ref(true)
const failed = ref(false)

const selectedScope = computed(() =>
  SKILL_SCOPES.find((scope) => scope.id === scopeId.value)!,
)
const riftScopes = computed(() =>
  SKILL_SCOPES.filter((scope) => scope.primary === "rift"),
)
const primaryCount = (mode: PrimaryMode) =>
  counts.value[mode === "rift" ? "riftAll" : mode]

async function loadCounts() {
  const summaries = await Promise.all(
    SKILL_SCOPES.map((scope) => api.getSummary(filterForSkillScope(scope.id))),
  )

  counts.value = Object.fromEntries(
    SKILL_SCOPES.map((scope, index) => [scope.id, summaries[index].games]),
  ) as Record<SkillScopeId, number>

  const busiest = PRIMARY_MODES.reduce((best, mode) =>
    primaryCount(mode.id) > primaryCount(best.id) ? mode : best,
  )
  primary.value = busiest.id
  scopeId.value = busiest.id === "rift" ? "riftAll" : busiest.id
}

async function loadReport() {
  loading.value = true
  failed.value = false
  try {
    const scope = selectedScope.value
    report.value = await api.getSkillReport(
      filterForSkillScope(scope.id),
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

async function selectPrimary(mode: PrimaryMode) {
  if (primary.value === mode) return
  primary.value = mode
  scopeId.value = mode === "rift" ? "riftAll" : mode
  await loadReport()
}

async function selectScope(nextScopeId: SkillScopeId) {
  if (scopeId.value === nextScopeId) return
  scopeId.value = nextScopeId
  await loadReport()
}

onMounted(async () => {
  try {
    await loadCounts()
  } catch {
    // The normal empty state handles an account without recorded matches.
  }
  await loadReport()
  api.on("stats:updated", () => void loadReport())
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

      <div class="scope-picker" aria-label="Game mode scope">
        <div class="scope-row primary-row">
          <button
            v-for="mode in PRIMARY_MODES"
            :key="mode.id"
            class="league-button scope-button"
            :class="{ active: primary === mode.id }"
            @click="selectPrimary(mode.id)"
          >
            <span>{{ mode.label }}</span>
            <span class="muted count">{{ primaryCount(mode.id) }}</span>
          </button>
        </div>

        <div v-if="primary === 'rift'" class="scope-row secondary-row">
          <button
            v-for="scope in riftScopes"
            :key="scope.id"
            class="league-button scope-button secondary"
            :class="{ active: scopeId === scope.id }"
            @click="selectScope(scope.id)"
          >
            <span>{{ scope.label }}</span>
            <span class="muted count">{{ counts[scope.id] }}</span>
          </button>
        </div>
      </div>
    </header>

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
      v-else-if="report"
      :overview="report.overview"
      :family="report.scope.family"
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

.scope-picker {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-1);
  max-width: min(100%, 760px);
}

.scope-row {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.scope-button {
  min-height: 34px;
  padding: var(--space-2) var(--space-3);
  white-space: normal;
}

.scope-button.secondary {
  min-width: 92px;
  font-size: 11px;
}

.count {
  margin-left: var(--space-2);
  font-size: 10px;
}

.notice {
  padding: var(--space-5);
}

.notice p {
  margin-bottom: 0;
}

@media (max-width: 760px) {
  .scope-picker,
  .scope-row {
    align-items: stretch;
    justify-content: flex-start;
    width: 100%;
  }

  .primary-row .scope-button {
    flex: 1 1 140px;
  }

  .secondary-row .scope-button {
    flex: 1 1 100px;
  }
}
</style>