<script setup lang="ts">
import { computed, ref, watch } from "vue"
import GradeBadge from "./GradeBadge.vue"
import PerformanceRadar from "./skill/PerformanceRadar.vue"
import {
  Button as UiButton,
  Dialog as UiDialog,
  EmptyState,
  ScrollArea,
  Surface,
  TelemetryGrid,
} from "./ui"
import { api } from "../helpers/api"
import { closeChampion } from "../helpers/navigation"
import {
  championIconUrl,
  championNameById,
  formatCompact,
  formatDecimal,
  formatPercent,
  formatRelativeDate,
  GRADE_ORDER,
  modeLabel,
} from "../helpers/format"
import { recallGradeFromRecallScore } from "../shared/recall-grade"
import type { Champion } from "../types/lol"
import type {
  ChampionNeed,
  GradeCount,
  MatchRow,
  PerformanceProfile,
  StatsSummary,
} from "../types/stats"

type PerformanceFamily = "sr" | "aram" | "classic"

interface FamilyOption {
  family: PerformanceFamily
  label: string
  games: number
}

const FAMILY_OPTIONS: ReadonlyArray<Omit<FamilyOption, "games">> = [
  { family: "sr", label: "Summoner's Rift" },
  { family: "aram", label: "ARAM" },
  { family: "classic", label: "League Classic" },
]

const props = defineProps<{
  championId: number
  champions: Champion[] | null
}>()

const summary = ref<StatsSummary | null>(null)
const grades = ref<GradeCount[]>([])
const performance = ref<PerformanceProfile | undefined>(undefined)
const best = ref<MatchRow[]>([])
const worst = ref<MatchRow[]>([])
const needs = ref<ChampionNeed[]>([])
const family = ref<PerformanceFamily>("aram")
const availableFamilies = ref<FamilyOption[]>([])
const loading = ref(true)
const loadFailed = ref(false)
let requestGeneration = 0

function clearPerformance() {
  summary.value = null
  grades.value = []
  performance.value = undefined
  best.value = []
  worst.value = []
}

async function loadPerformanceScope(
  championId: number,
  selectedFamily: PerformanceFamily,
  request: number,
) {
  const filter = { championIds: [championId], modeFamily: selectedFamily }
  const [nextSummary, nextGrades, nextPerformance, bestGames, worstGames] =
    await Promise.all([
      api.getSummary(filter),
      api.getGradeDistribution(filter),
      api.getRviProfile(filter, selectedFamily),
      api.listMatches({ ...filter, sortBy: "grade", sortDir: "desc" }, 1, 3),
      api.listMatches({ ...filter, sortBy: "grade", sortDir: "asc" }, 1, 3),
    ])

  if (request !== requestGeneration) return
  summary.value = nextSummary
  grades.value = nextGrades
  performance.value = nextPerformance
  best.value = bestGames.rows.filter((row) => row.grade)
  worst.value = worstGames.rows.filter((row) => row.grade)
}

async function loadChampion(championId: number) {
  const request = ++requestGeneration
  loading.value = true
  loadFailed.value = false
  clearPerformance()
  needs.value = []
  availableFamilies.value = []

  try {
    const baseFilter = { championIds: [championId] }
    const [summaries, championNeeds] = await Promise.all([
      Promise.all(FAMILY_OPTIONS.map(async (option) => ({
        ...option,
        games: (await api.getSummary({
          ...baseFilter,
          modeFamily: option.family,
        })).games,
      }))),
      api.getChampionNeeds([championId]),
    ])

    if (request !== requestGeneration) return
    needs.value = championNeeds[championId] ?? []
    availableFamilies.value = summaries.filter((option) => option.games > 0)
    const selected = summaries.reduce((leader, option) =>
      option.games > leader.games ? option : leader)
    family.value = selected.family

    await loadPerformanceScope(championId, selected.family, request)
  } catch (error) {
    if (request !== requestGeneration) return
    console.warn("Could not load champion performance", error)
    clearPerformance()
    loadFailed.value = true
  } finally {
    if (request === requestGeneration) loading.value = false
  }
}

async function changeFamily() {
  const request = ++requestGeneration
  loading.value = true
  loadFailed.value = false
  clearPerformance()
  try {
    await loadPerformanceScope(props.championId, family.value, request)
  } catch (error) {
    if (request !== requestGeneration) return
    console.warn("Could not load champion mode", error)
    clearPerformance()
    loadFailed.value = true
  } finally {
    if (request === requestGeneration) loading.value = false
  }
}

watch(() => props.championId, loadChampion, { immediate: true })

const name = computed(() => championNameById(props.champions, props.championId))
const familyLabel = computed(() =>
  FAMILY_OPTIONS.find((option) => option.family === family.value)?.label ?? "League")
const averageGrade = computed(() => recallGradeFromRecallScore(summary.value?.averageRecallScore))
const hasGames = computed(() => (summary.value?.games ?? 0) > 0)
const championDimensions = computed(() =>
  (performance.value?.dimensions ?? []).filter((dimension) => !dimension.careerOnly))
const measuredDimensions = computed(() =>
  championDimensions.value.filter((dimension) => dimension.score !== null))
const canRenderRadar = computed(() => measuredDimensions.value.length >= 3)
const championRadarDimensions = computed(() => {
  const profile = performance.value
  if (!profile || profile.games > profile.recentGames) return championDimensions.value
  return championDimensions.value.map((dimension) => ({
    ...dimension,
    recentScore: undefined,
  }))
})

const confidenceLabel = computed(() => ({
  learning: "Learning confidence",
  provisional: "Provisional confidence",
  established: "Established confidence",
})[performance.value?.confidence ?? "learning"])

const measuredGameLabel = computed(() => {
  const games = performance.value?.measuredGames ?? 0
  return `${games} measured ${games === 1 ? "game" : "games"}`
})

type TelemetryReading = {
  label: string
  value: string
  hint?: string
  tone?: "neutral" | "win" | "loss"
}

const telemetryReadings = computed<TelemetryReading[]>(() => {
  if (!summary.value) return []
  return [
    {
      label: "Games",
      value: summary.value.games.toString(),
      hint: `${summary.value.wins}W · ${summary.value.losses}L`,
    },
    {
      label: "Win rate",
      value: formatPercent(summary.value.winRate),
      tone: summary.value.winRate >= 0.5 ? "win" : "loss",
    },
    {
      label: "Average Recall Score",
      value: summary.value.averageRecallScore?.toFixed(1) ?? "–",
      hint: `${averageGrade.value ?? "No grade"} · ${summary.value.gradedGames} graded`,
    },
    { label: "KDA", value: formatDecimal(summary.value.kda, 2) },
    { label: "Damage / game", value: formatCompact(summary.value.avgDamageToChampions) },
    { label: "Gold / game", value: formatCompact(summary.value.avgGold) },
    { label: "Deaths / game", value: formatDecimal(summary.value.avgDeaths, 1) },
  ]
})

const gradeBars = computed(() => {
  const byGrade = new Map(grades.value.map((entry) => [entry.grade, entry.count]))
  const highest = Math.max(1, ...grades.value.map((entry) => entry.count))

  return GRADE_ORDER.filter((grade) => byGrade.has(grade)).map((grade) => ({
    grade,
    count: byGrade.get(grade)!,
    share: (byGrade.get(grade)! / highest) * 100,
  }))
})
</script>

<template>
  <UiDialog
    labelled-by="champion-detail-title"
    size="wide"
    align="top"
    padding="none"
    @close="closeChampion()"
  >
    <div class="sheet">
      <header class="sheet-head">
        <img :src="championIconUrl(championId)" :alt="name" class="portrait" />
        <div>
          <h2 id="champion-detail-title" class="name">{{ name }}</h2>
          <p v-if="loading" class="muted line">Reading recorded games…</p>
          <p v-else-if="summary && hasGames" class="muted line">
            {{ summary.games }} games · {{ summary.wins }}W {{ summary.losses }}L
            · {{ formatPercent(summary.winRate) }} win rate
          </p>
          <p v-else class="muted line">No recorded games yet</p>
        </div>
        <GradeBadge v-if="averageGrade" :grade="averageGrade" size="lg" />
        <UiButton
          class="close"
          variant="ghost"
          icon-only
          size="compact"
          title="Close champion details"
          aria-label="Close champion details"
          @click="closeChampion()"
        >×</UiButton>
      </header>

      <EmptyState
        v-if="loading"
        compact
        title="Reading your games"
        :description="`Recall is assembling your ${name} profile.`"
      />

      <EmptyState
        v-else-if="loadFailed"
        compact
        tone="warning"
        title="Champion profile unavailable"
        description="The recorded games are still intact. Close this view and try opening the champion again."
      />

      <template v-else-if="hasGames">
        <Surface
          v-if="availableFamilies.length"
          as="section"
          variant="toolbar"
          padding="compact"
          class="scope-toolbar"
          aria-label="Champion performance scope"
        >
          <label>
            <span>Game mode</span>
            <select v-model="family" class="league-select" @change="changeFamily">
              <option
                v-for="option in availableFamilies"
                :key="option.family"
                :value="option.family"
              >
                {{ option.label }} · {{ option.games }}
              </option>
            </select>
          </label>
          <p class="muted">
            Every performance value below uses {{ familyLabel }} games only.
          </p>
        </Surface>

        <TelemetryGrid label="Champion telemetry" :readings="telemetryReadings" />

        <Surface v-if="performance" as="section" variant="inset" padding="compact" class="rvi-shell">
          <header class="rvi-head">
            <div>
              <p class="rvi-eyebrow">RVI profile</p>
              <h3>{{ name }} performance shape</h3>
              <p>
                {{ familyLabel }} · {{ measuredGameLabel }} · {{ confidenceLabel }}
              </p>
            </div>
          </header>

          <div class="rvi-compact">
            <PerformanceRadar
              v-if="canRenderRadar"
              :dimensions="championRadarDimensions"
              :primary-label="`${name} profile`"
              :secondary-label="`Recent ${name} form`"
              height="280px"
            />
            <div v-else class="partial-radar-note">
              <strong>Radar is still building</strong>
              <p>At least three measured RVI areas are needed to draw the profile.</p>
            </div>

            <ul class="rvi-arm-list" aria-label="Champion RVI area scores">
              <li v-for="dimension in championDimensions" :key="dimension.key">
                <strong>{{ dimension.label }}</strong>
                <strong class="numeric">{{ dimension.score ?? '—' }}</strong>
              </li>
            </ul>
          </div>

          <p class="rvi-reference muted">
            {{ performance.comparison }}. Missing evidence is unavailable, never zero.
          </p>
        </Surface>
        <EmptyState
          v-else
          compact
          title="RVI is still building"
          :description="`Recall has ${name} games in ${familyLabel}, but this selection does not yet have enough measured Grade and RVI evidence for a profile.`"
        />

        <Surface v-if="gradeBars.length" as="section" variant="quiet" padding="compact" class="block grades-block">
          <h3 class="block-title">Grade distribution</h3>
          <div class="grades">
            <div v-for="bar in gradeBars" :key="bar.grade" class="grade-row">
              <GradeBadge :grade="bar.grade" />
              <span class="track">
                <span class="fill" :style="{ width: `${bar.share}%` }" />
              </span>
              <span class="muted numeric count">{{ bar.count }}</span>
            </div>
          </div>
        </Surface>

        <div class="split">
          <Surface v-if="best.length" as="section" variant="inset" padding="compact" class="block game-block">
            <h3 class="block-title">Your best games</h3>
            <ul class="game-list">
              <li v-for="game in best" :key="game.gameId">
                <GradeBadge :grade="game.grade" />
                <span class="numeric">
                  {{ game.kills }}/{{ game.deaths }}/{{ game.assists }}
                </span>
                <span class="muted">{{ modeLabel(game.mode) }}</span>
                <span class="muted">{{ formatRelativeDate(game.playedAt) }}</span>
              </li>
            </ul>
          </Surface>

          <Surface v-if="worst.length" as="section" variant="inset" padding="compact" class="block game-block">
            <h3 class="block-title">Your worst games</h3>
            <ul class="game-list">
              <li v-for="game in worst" :key="game.gameId">
                <GradeBadge :grade="game.grade" />
                <span class="numeric">
                  {{ game.kills }}/{{ game.deaths }}/{{ game.assists }}
                </span>
                <span class="muted">{{ modeLabel(game.mode) }}</span>
                <span class="muted">{{ formatRelativeDate(game.playedAt) }}</span>
              </li>
            </ul>
          </Surface>
        </div>
      </template>

      <EmptyState
        v-else
        compact
        title="No recorded games yet"
        :description="`Recall has not recorded a game on ${name} yet.`"
      />

      <Surface v-if="needs.length" as="section" variant="inset" padding="compact" class="block needs-block">
        <h3 class="block-title">
          Challenges {{ name }} still counts towards ({{ needs.length }})
        </h3>
        <ScrollArea max-height="180px">
          <ul class="need-list">
            <li v-for="need in needs" :key="need.challengeId">
              <span class="need-name">{{ need.name }}</span>
              <span class="muted numeric">
                {{ formatCompact(need.currentValue) }}
                <template v-if="need.nextThreshold">
                  / {{ formatCompact(need.nextThreshold) }}
                </template>
              </span>
            </li>
          </ul>
        </ScrollArea>
      </Surface>
    </div>
  </UiDialog>
</template>

<style scoped>
.sheet {
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: 100%;
  gap: var(--ui-space-4);
  padding: var(--ui-space-5);
  overflow-y: auto;
  container: champion-detail / inline-size;
}

.sheet > * {
  flex: 0 0 auto;
}

.sheet-head {
  display: flex;
  align-items: center;
  gap: var(--ui-space-3);
  padding-bottom: var(--ui-space-3);
  border-bottom: 1px solid var(--ui-divider);
}

.portrait {
  width: 52px;
  height: 52px;
  border-radius: var(--ui-radius-md);
  border: 1px solid var(--ui-border-emphasis);
}

.name {
  font-family: var(--ui-font-display);
  font-size: 20px;
  margin: 0;
  color: var(--ui-text-heading);
  letter-spacing: 0.6px;
}

.line {
  margin: 2px 0 0;
  font-size: 12px;
}

.close {
  margin-left: auto;
  align-self: flex-start;
  font-size: 24px;
  line-height: 1;
}

.scope-toolbar {
  display: flex;
  align-items: end;
  gap: var(--ui-space-4);
}

.scope-toolbar label {
  display: grid;
  min-width: 210px;
  gap: 5px;
}

.scope-toolbar label > span {
  color: var(--ui-text-muted);
  font: var(--ui-label-size) var(--ui-font-heading);
  letter-spacing: 1.2px;
  text-transform: uppercase;
}

.scope-toolbar p {
  margin: 0 0 7px;
  font-size: 11px;
}

.rvi-shell {
  overflow: hidden;
}

.rvi-head {
  margin-bottom: var(--ui-space-2);
  padding-bottom: var(--ui-space-2);
  border-bottom: 1px solid var(--ui-divider);
}

.rvi-head h3,
.rvi-head p {
  margin: 0;
}

.rvi-head h3 {
  color: var(--ui-text-heading);
  font: 16px var(--ui-font-heading);
}

.rvi-head p:last-child {
  margin-top: 3px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.rvi-eyebrow {
  color: var(--ui-accent);
  font: 11px var(--ui-font-heading);
  letter-spacing: 1.2px;
  text-transform: uppercase;
}

.rvi-compact {
  display: grid;
  grid-template-columns: minmax(340px, 1.25fr) minmax(240px, .75fr);
  align-items: center;
  gap: var(--ui-space-4);
}

.rvi-arm-list {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.rvi-arm-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ui-space-3);
  min-height: 34px;
  border-bottom: 1px solid var(--ui-divider);
  color: var(--ui-text-subtle);
  font-size: 12px;
}

.rvi-arm-list li:last-child {
  border-bottom: 0;
}

.rvi-arm-list .numeric {
  color: var(--ui-text-heading);
  font-size: 16px;
}

.partial-radar-note {
  padding: var(--ui-space-5);
  text-align: center;
}

.partial-radar-note p,
.rvi-reference {
  margin: var(--ui-space-2) 0 0;
  font-size: 11px;
}

.grades-block {
  box-shadow: none;
}

.block-title {
  font-family: var(--ui-font-heading);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--ui-text-subtle);
  margin: 0 0 var(--ui-space-2);
}

.game-list,
.need-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-2);
  font-size: 12px;
}

.need-list li {
  display: flex;
  justify-content: space-between;
  gap: var(--ui-space-3);
}

.need-name {
  color: var(--ui-text-subtle);
}

.grades {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-2);
}

.grade-row {
  display: grid;
  grid-template-columns: 38px 1fr 28px;
  align-items: center;
  gap: var(--ui-space-2);
}

/* Only the difference from the global bar primitive. */
.track {
  height: 5px;
}

.count {
  text-align: right;
  font-size: 11px;
}

.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--ui-space-4);
}

.game-list li {
  display: flex;
  align-items: center;
  gap: var(--ui-space-3);
}

@container champion-detail (max-width: 720px) {
  .sheet-head { align-items: flex-start; flex-wrap: wrap; }
  .sheet-head .close { margin-left: auto; }
  .scope-toolbar { align-items: stretch; flex-direction: column; gap: var(--ui-space-2); }
  .scope-toolbar label { min-width: 0; }
  .scope-toolbar p { margin: 0; }
  .rvi-compact { grid-template-columns: minmax(0, 1fr); }
}

@container champion-detail (max-width: 480px) {
  .sheet { padding: var(--ui-space-4); }
  .portrait { width: 44px; height: 44px; }
  .game-list li { display: grid; grid-template-columns: 34px 1fr; gap: var(--ui-space-2); }
  .game-list li > :nth-child(n + 3) { grid-column: 2; }
}
</style>
