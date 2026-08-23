<script setup lang="ts">
import { computed, ref, watch } from "vue"
import GradeBadge from "../components/GradeBadge.vue"
import PerformanceRadar from "../components/skill/PerformanceRadar.vue"
import {
  Button as UiButton,
  EmptyState,
  ScrollArea,
  Surface,
  TelemetryGrid,
} from "../components/ui"
import { api } from "../helpers/api"
import {
  canGoBack,
  goBack,
  goTo,
  reviewMatch,
} from "../helpers/navigation"
import {
  championIconUrl,
  championNameById,
  formatCompact,
  formatDecimal,
  formatDuration,
  formatPercent,
  formatRecordValue,
  formatRelativeDate,
  GRADE_ORDER,
  modeLabel,
} from "../helpers/format"
import {
  PRIMARY_ARCHETYPE_LABELS,
  type PrimaryArchetype,
} from "../shared/champion-archetypes"
import { recallGradeFromRecallScore } from "../shared/recall-grade"
import type { ChampionJungleClearStats } from "../shared/minimap/jungle-clear"
import type { Champion, ChampionRole } from "../types/lol"
import type {
  ChampionNeed,
  ChampionPerformanceSnapshot,
  GradeCount,
  MatchRow,
  PerformanceProfile,
  PersonalRecord,
  ProfileSummary,
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

const CHAMPION_ROLE_LABELS: Readonly<Record<ChampionRole, string>> = Object.freeze({
  assassin: "Assassin",
  fighter: "Fighter",
  mage: "Mage",
  marksman: "Marksman",
  support: "Support",
  tank: "Tank",
})

const props = defineProps<{
  championId: number
  champions: Champion[] | null
}>()

const summary = ref<StatsSummary | null>(null)
const snapshot = ref<ChampionPerformanceSnapshot | undefined>(undefined)
const grades = ref<GradeCount[]>([])
const performance = ref<PerformanceProfile | undefined>(undefined)
const recent = ref<MatchRow[]>([])
const best = ref<MatchRow[]>([])
const worst = ref<MatchRow[]>([])
const records = ref<PersonalRecord[]>([])
const profile = ref<ProfileSummary | null>(null)
const needs = ref<ChampionNeed[]>([])
const jungleClears = ref<ChampionJungleClearStats | null>(null)
const family = ref<PerformanceFamily>("aram")
const availableFamilies = ref<FamilyOption[]>([])
const loading = ref(true)
const loadFailed = ref(false)
let requestGeneration = 0

function clearScopedPerformance() {
  summary.value = null
  snapshot.value = undefined
  grades.value = []
  performance.value = undefined
  recent.value = []
  best.value = []
  worst.value = []
  records.value = []
}

async function loadPerformanceScope(
  championId: number,
  selectedFamily: PerformanceFamily,
  request: number,
) {
  const filter = { championIds: [championId], modeFamily: selectedFamily }
  const [
    nextSummary,
    nextSnapshot,
    nextGrades,
    nextPerformance,
    recentGames,
    bestGames,
    worstGames,
    nextRecords,
  ] = await Promise.all([
    api.getSummary(filter),
    api.getChampionPerformanceSnapshot(filter),
    api.getGradeDistribution(filter),
    api.getRviProfile(filter, selectedFamily),
    api.listMatches({ ...filter, sortBy: "played_at", sortDir: "desc" }, 1, 8),
    api.listMatches({ ...filter, sortBy: "grade", sortDir: "desc" }, 1, 3),
    api.listMatches({ ...filter, sortBy: "grade", sortDir: "asc" }, 1, 3),
    api.getRecords(filter),
  ])

  if (request !== requestGeneration) return
  summary.value = nextSummary
  snapshot.value = nextSnapshot
  grades.value = nextGrades
  performance.value = nextPerformance
  recent.value = recentGames.rows
  best.value = bestGames.rows.filter((row) => row.grade)
  worst.value = worstGames.rows.filter((row) => row.grade)
  records.value = nextRecords
}

async function loadChampion(championId: number) {
  const request = ++requestGeneration
  loading.value = true
  loadFailed.value = false
  clearScopedPerformance()
  profile.value = null
  needs.value = []
  jungleClears.value = null
  availableFamilies.value = []

  try {
    const baseFilter = { championIds: [championId] }
    const [summaries, nextProfile, championNeeds, nextJungleClears] = await Promise.all([
      Promise.all(FAMILY_OPTIONS.map(async (option) => ({
        ...option,
        games: (await api.getSummary({
          ...baseFilter,
          modeFamily: option.family,
        })).games,
      }))),
      api.getProfile().catch(() => null),
      api.getChampionNeeds([championId]).catch(
        (): Record<number, ChampionNeed[]> => ({}),
      ),
      api.getChampionJungleClearStats(championId).catch((error) => {
        console.warn("Could not load champion jungle clears", error)
        return null
      }),
    ])

    if (request !== requestGeneration) return
    profile.value = nextProfile
    needs.value = championNeeds[championId] ?? []
    jungleClears.value = nextJungleClears
    availableFamilies.value = summaries.filter((option) => option.games > 0)
    const selected = summaries.reduce((leader, option) =>
      option.games > leader.games ? option : leader)
    family.value = selected.family

    await loadPerformanceScope(championId, selected.family, request)
  } catch (error) {
    if (request !== requestGeneration) return
    console.warn("Could not load champion performance", error)
    clearScopedPerformance()
    loadFailed.value = true
  } finally {
    if (request === requestGeneration) loading.value = false
  }
}

async function changeFamily() {
  const request = ++requestGeneration
  loading.value = true
  loadFailed.value = false
  clearScopedPerformance()
  try {
    await loadPerformanceScope(props.championId, family.value, request)
  } catch (error) {
    if (request !== requestGeneration) return
    console.warn("Could not load champion mode", error)
    clearScopedPerformance()
    loadFailed.value = true
  } finally {
    if (request === requestGeneration) loading.value = false
  }
}

watch(() => props.championId, loadChampion, { immediate: true })

const champion = computed(() =>
  props.champions?.find((entry) => entry.id === props.championId))
const name = computed(() => championNameById(props.champions, props.championId))
const familyLabel = computed(() =>
  FAMILY_OPTIONS.find((option) => option.family === family.value)?.label ?? "League")
const averageGrade = computed(() => recallGradeFromRecallScore(summary.value?.averageRecallScore))
const hasGames = computed(() => (summary.value?.games ?? 0) > 0)
const mastery = computed(() =>
  profile.value?.mastery.find((entry) => entry.championId === props.championId))
const taxonomy = computed(() => {
  const entry = champion.value
  if (!entry) return "Champion performance profile"
  const archetype = entry.primaryArchetype
    ? PRIMARY_ARCHETYPE_LABELS[entry.primaryArchetype as PrimaryArchetype]
    : "Unclassified"
  const roles = entry.roles.map((role) => CHAMPION_ROLE_LABELS[role]).join(" / ")
  return [archetype, roles].filter(Boolean).join(" · ")
})

const championDimensions = computed(() =>
  (performance.value?.dimensions ?? []).filter((dimension) => !dimension.careerOnly))
const measuredDimensions = computed(() =>
  championDimensions.value.filter((dimension) => dimension.score !== null))
const canRenderRadar = computed(() => measuredDimensions.value.length >= 3)
const championRadarDimensions = computed(() => {
  const current = performance.value
  if (!current || current.games > current.recentGames) return championDimensions.value
  return championDimensions.value.map((dimension) => ({
    ...dimension,
    recentScore: undefined,
  }))
})

const confidenceLabel = computed(() => ({
  learning: "Learning",
  provisional: "Provisional",
  established: "Established",
})[performance.value?.confidence ?? "learning"])

const gradedCoverage = computed(() => {
  if (!summary.value?.games) return 0
  return summary.value.gradedGames / summary.value.games
})

const telemetryReadings = computed(() => {
  if (!summary.value) return []
  return [
    {
      label: "KDA",
      value: formatDecimal(summary.value.kda, 2),
      hint: `${formatDecimal(summary.value.avgKills, 1)} / ${formatDecimal(summary.value.avgDeaths, 1)} / ${formatDecimal(summary.value.avgAssists, 1)}`,
    },
    { label: "Damage / game", value: formatCompact(summary.value.avgDamageToChampions) },
    { label: "Gold / game", value: formatCompact(summary.value.avgGold) },
    { label: "CS / min", value: snapshot.value ? formatDecimal(snapshot.value.csPerMin, 1) : "–" },
    { label: "Vision / min", value: snapshot.value ? formatDecimal(snapshot.value.visionPerMin, 1) : "–" },
    { label: "Deaths / game", value: formatDecimal(summary.value.avgDeaths, 1) },
    {
      label: "Graded coverage",
      value: formatPercent(gradedCoverage.value),
      hint: `${summary.value.gradedGames} of ${summary.value.games} games`,
    },
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

const recentJungleClears = computed(() => jungleClears.value?.samples.slice(0, 8) ?? [])
const visibleRecords = computed(() => records.value.slice(0, 8))

function masteryPointsLabel(points: number) {
  if (points >= 1_000_000) return `${(points / 1_000_000).toFixed(1)}M`
  if (points >= 1_000) return `${Math.round(points / 1_000)}k`
  return points.toString()
}

function clearTime(milliseconds?: number) {
  return milliseconds === undefined ? "—" : formatDuration(milliseconds / 1_000)
}

function clearCampName(campKey: string) {
  return campKey.split("_").map((part) =>
    part.charAt(0).toUpperCase() + part.slice(1)).join(" ")
}

function backToOrigin() {
  if (canGoBack.value) goBack()
  else goTo("champions")
}
</script>

<template>
  <div class="champion-page">
    <nav class="breadcrumb" aria-label="Champion breadcrumb">
      <UiButton variant="ghost" size="compact" type="button" @click="backToOrigin">
        ← Back
      </UiButton>
      <span aria-hidden="true">/</span>
      <span>Champions</span>
      <span aria-hidden="true">/</span>
      <strong>{{ name }}</strong>
    </nav>

    <header class="champion-hero">
      <img :src="championIconUrl(championId)" :alt="name" class="portrait" />
      <div class="hero-identity">
        <p class="eyebrow">Champion performance profile</p>
        <h1>{{ name }}</h1>
        <p class="muted taxonomy">{{ taxonomy }}</p>
        <div v-if="mastery" class="mastery-line">
          <span>Mastery {{ mastery.championLevel }}</span>
          <span>{{ masteryPointsLabel(mastery.championPoints) }} points</span>
          <span v-if="mastery.highestGrade">Riot grade {{ mastery.highestGrade }}</span>
        </div>
      </div>

      <div v-if="summary && hasGames" class="hero-performance" aria-label="Scoped champion result">
        <p class="hero-scope">{{ familyLabel }} only</p>
        <GradeBadge v-if="averageGrade" :grade="averageGrade" size="lg" />
        <div class="hero-score">
          <strong class="numeric">{{ summary.averageRecallScore?.toFixed(1) ?? "–" }}</strong>
          <span>Recall Score</span>
        </div>
        <dl>
          <div><dt>Confidence</dt><dd>{{ performance ? confidenceLabel : "Building" }}</dd></div>
          <div><dt>Games</dt><dd class="numeric">{{ summary.games }}</dd></div>
          <div><dt>Record</dt><dd class="numeric">{{ summary.wins }}W · {{ summary.losses }}L</dd></div>
          <div><dt>Win rate</dt><dd class="numeric">{{ formatPercent(summary.winRate) }}</dd></div>
        </dl>
      </div>
    </header>

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
        Scoped view: every performance statistic below uses {{ familyLabel }} games only.
      </p>
    </Surface>

    <EmptyState
      v-if="loading"
      title="Reading your games"
      :description="`Recall is assembling your ${name} profile for ${familyLabel}.`"
    />

    <EmptyState
      v-else-if="loadFailed"
      tone="warning"
      title="Champion profile unavailable"
      description="The recorded games are still intact. Return to Champions and try this profile again."
    />

    <template v-else-if="hasGames">
      <section class="profile-section" aria-labelledby="snapshot-title">
        <header class="section-head">
          <div>
            <p class="eyebrow">{{ familyLabel }} only</p>
            <h2 id="snapshot-title">Performance snapshot</h2>
          </div>
          <span class="muted">Career averages in the selected scope</span>
        </header>
        <TelemetryGrid label="Scoped champion telemetry" :readings="telemetryReadings" :columns="4" />
      </section>

      <Surface as="section" variant="inset" padding="compact" class="profile-section rvi-shell">
        <header class="section-head rvi-head">
          <div>
            <p class="eyebrow">{{ familyLabel }} only</p>
            <h2>RVI profile</h2>
            <p class="muted">
              {{ performance?.measuredGames ?? 0 }} measured games · {{ performance ? confidenceLabel : "Learning" }} confidence
            </p>
          </div>
          <strong v-if="performance" class="rvi-score numeric">{{ performance.score }}</strong>
        </header>

        <template v-if="performance">
          <div class="rvi-layout">
            <PerformanceRadar
              v-if="canRenderRadar"
              :dimensions="championRadarDimensions"
              :primary-label="`${name} profile`"
              :secondary-label="`Recent ${name} form`"
              height="300px"
            />
            <div v-else class="partial-radar-note">
              <strong>Radar is still building</strong>
              <p>At least three measured RVI areas are needed to draw the profile.</p>
            </div>

            <ul class="rvi-arm-list" aria-label="Champion RVI area scores">
              <li v-for="dimension in championDimensions" :key="dimension.key">
                <span>
                  <strong>{{ dimension.label }}</strong>
                  <small>{{ dimension.eligibleGames }} eligible · {{ dimension.confidence ?? "learning" }}</small>
                </span>
                <strong class="numeric">{{ dimension.score ?? "—" }}</strong>
              </li>
            </ul>
          </div>
          <p class="rvi-reference muted">
            {{ performance.comparison }}. Missing evidence is unavailable, never zero.
          </p>
        </template>
        <EmptyState
          v-else
          compact
          title="RVI is still building"
          :description="`This ${familyLabel} scope does not yet have enough measured Grade and RVI evidence for a profile.`"
        />
      </Surface>

      <section v-if="recent.length" class="profile-section" aria-labelledby="recent-form-title">
        <header class="section-head">
          <div>
            <p class="eyebrow">{{ familyLabel }} only</p>
            <h2 id="recent-form-title">Recent form</h2>
          </div>
          <span class="muted">Open any match in Review</span>
        </header>
        <div class="recent-grid">
          <button
            v-for="game in recent"
            :key="game.gameId"
            type="button"
            class="match-card"
            @click="reviewMatch(game.gameId)"
          >
            <span class="result" :class="game.win ? 'win' : 'loss'">{{ game.win ? "W" : "L" }}</span>
            <span class="match-main">
              <strong class="numeric">{{ game.kills }}/{{ game.deaths }}/{{ game.assists }}</strong>
              <small>{{ modeLabel(game.mode) }} · {{ formatRelativeDate(game.playedAt) }}</small>
            </span>
            <span class="match-score">
              <GradeBadge :grade="game.grade" />
              <small class="numeric">{{ game.recallScore?.toFixed(1) ?? "–" }}</small>
            </span>
          </button>
        </div>
      </section>

      <div class="profile-split">
        <Surface as="section" variant="quiet" padding="compact" class="profile-section grades-block">
          <header class="section-head compact-head">
            <div>
              <p class="eyebrow">{{ familyLabel }} only</p>
              <h2>Grade distribution</h2>
            </div>
            <span class="muted numeric">{{ summary?.gradedGames ?? 0 }} graded</span>
          </header>
          <div v-if="gradeBars.length" class="grades">
            <div v-for="bar in gradeBars" :key="bar.grade" class="grade-row">
              <GradeBadge :grade="bar.grade" />
              <span class="track"><span class="fill" :style="{ width: `${bar.share}%` }" /></span>
              <span class="muted numeric count">{{ bar.count }}</span>
            </div>
          </div>
          <p v-else class="muted empty-copy">No graded games in this scope yet.</p>
        </Surface>

        <Surface as="section" variant="quiet" padding="compact" class="profile-section records-block">
          <header class="section-head compact-head">
            <div>
              <p class="eyebrow">{{ familyLabel }} only</p>
              <h2>Personal records</h2>
            </div>
            <span class="muted">Best stored marks</span>
          </header>
          <div v-if="visibleRecords.length" class="record-list">
            <button
              v-for="record in visibleRecords"
              :key="record.key"
              type="button"
              @click="reviewMatch(record.gameId)"
            >
              <span><strong>{{ record.label }}</strong><small>{{ formatRelativeDate(record.playedAt) }}</small></span>
              <strong class="numeric">{{ formatRecordValue(record) }}</strong>
            </button>
          </div>
          <p v-else class="muted empty-copy">No eligible personal records in this scope.</p>
        </Surface>
      </div>

      <div class="profile-split performance-extremes">
        <Surface as="section" variant="inset" padding="compact" class="profile-section">
          <header class="section-head compact-head">
            <div><p class="eyebrow">{{ familyLabel }} only</p><h2>Best-graded performances</h2></div>
          </header>
          <div class="performance-list">
            <button v-for="game in best" :key="game.gameId" type="button" @click="reviewMatch(game.gameId)">
              <GradeBadge :grade="game.grade" />
              <span><strong class="numeric">{{ game.kills }}/{{ game.deaths }}/{{ game.assists }}</strong><small>{{ formatRelativeDate(game.playedAt) }}</small></span>
              <strong class="numeric">{{ game.recallScore?.toFixed(1) ?? "–" }}</strong>
            </button>
          </div>
        </Surface>

        <Surface as="section" variant="inset" padding="compact" class="profile-section">
          <header class="section-head compact-head">
            <div><p class="eyebrow">{{ familyLabel }} only</p><h2>Lowest-graded performances</h2></div>
          </header>
          <div class="performance-list">
            <button v-for="game in worst" :key="game.gameId" type="button" @click="reviewMatch(game.gameId)">
              <GradeBadge :grade="game.grade" />
              <span><strong class="numeric">{{ game.kills }}/{{ game.deaths }}/{{ game.assists }}</strong><small>{{ formatRelativeDate(game.playedAt) }}</small></span>
              <strong class="numeric">{{ game.recallScore?.toFixed(1) ?? "–" }}</strong>
            </button>
          </div>
        </Surface>
      </div>

      <Surface
        v-if="jungleClears && jungleClears.jungleGames > 0"
        as="section"
        variant="inset"
        padding="compact"
        class="profile-section jungle-clear-shell"
        aria-label="Jungle clear analytics"
      >
        <header class="section-head">
          <div>
            <p class="eyebrow">Summoner's Rift jungle</p>
            <h2>First full clear analytics</h2>
            <p class="muted">Six unique non-river camps completed before 8:00.</p>
          </div>
          <span class="jungle-sample-badge">
            {{ jungleClears.samples.length }} measured / {{ jungleClears.jungleGames }} jungle games
          </span>
        </header>

        <div class="jungle-clear-metrics">
          <article><span>Complete clears</span><strong>{{ jungleClears.samples.length }}</strong><small>{{ jungleClears.telemetryGames }} with evidence</small></article>
          <article><span>Average</span><strong>{{ clearTime(jungleClears.averageClearTimeMs) }}</strong><small>Sixth camp time</small></article>
          <article><span>Fastest</span><strong>{{ clearTime(jungleClears.fastest?.clearTimeMs) }}</strong><small>{{ jungleClears.fastest ? formatRelativeDate(jungleClears.fastest.playedAt) : "No sample" }}</small></article>
          <article><span>Longest</span><strong>{{ clearTime(jungleClears.longest?.clearTimeMs) }}</strong><small>{{ jungleClears.longest ? formatRelativeDate(jungleClears.longest.playedAt) : "No sample" }}</small></article>
        </div>

        <div v-if="recentJungleClears.length" class="jungle-table-shell">
          <table>
            <thead><tr><th>Date</th><th>Time</th><th>Route</th><th>Evidence</th><th /></tr></thead>
            <tbody>
              <tr v-for="sample in recentJungleClears" :key="sample.gameId">
                <td>{{ formatRelativeDate(sample.playedAt) }}</td>
                <td><strong class="numeric">{{ clearTime(sample.clearTimeMs) }}</strong></td>
                <td class="jungle-route">{{ sample.route.map(clearCampName).join(" → ") }}</td>
                <td>{{ Math.round(sample.confidence * 100) }}%</td>
                <td><button type="button" class="text-link" @click="reviewMatch(sample.gameId)">Review</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="muted empty-copy">
          No complete six-camp first clear met the telemetry requirements yet.
        </p>
        <p class="muted evidence-policy">
          Partial routes remain in match Review but are excluded from these aggregates.
        </p>
      </Surface>
    </template>

    <EmptyState
      v-else-if="!loading && !loadFailed"
      title="No recorded games yet"
      :description="`Recall has not recorded a game on ${name} yet.`"
    />

    <details v-if="needs.length" class="challenge-details">
      <summary>Challenge eligibility <span>({{ needs.length }})</span></summary>
      <p class="muted">Secondary collection goals that {{ name }} can still advance.</p>
      <ScrollArea max-height="220px">
        <ul class="need-list">
          <li v-for="need in needs" :key="need.challengeId">
            <span>{{ need.name }}</span>
            <span class="muted numeric">
              {{ formatCompact(need.currentValue) }}
              <template v-if="need.nextThreshold"> / {{ formatCompact(need.nextThreshold) }}</template>
            </span>
          </li>
        </ul>
      </ScrollArea>
    </details>
  </div>
</template>

<style scoped>
.champion-page {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-5);
  min-width: 0;
  container: champion-detail / inline-size;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: var(--ui-space-2);
  color: var(--ui-text-muted);
  font-size: 12px;
}

.breadcrumb strong { color: var(--ui-text-subtle); }

.champion-hero {
  display: grid;
  grid-template-columns: auto minmax(240px, 1fr) minmax(390px, auto);
  align-items: center;
  gap: var(--ui-space-5);
  padding: var(--ui-space-5);
  overflow: hidden;
  border: 1px solid var(--ui-border-emphasis);
  border-radius: var(--ui-radius-lg);
  background:
    linear-gradient(110deg, color-mix(in srgb, var(--ui-accent) 12%, transparent), transparent 48%),
    var(--ui-surface-panel);
  box-shadow: var(--ui-shadow-raised);
}

.portrait {
  width: 104px;
  height: 104px;
  border: 1px solid var(--ui-accent);
  border-radius: var(--ui-radius-lg);
  box-shadow: 0 0 28px color-mix(in srgb, var(--ui-accent) 18%, transparent);
}

.eyebrow {
  margin: 0;
  color: var(--ui-accent);
  font: 11px var(--ui-font-heading);
  letter-spacing: 1.3px;
  text-transform: uppercase;
}

.hero-identity h1 {
  margin: 3px 0;
  color: var(--ui-text-heading);
  font: 34px var(--ui-font-display);
  letter-spacing: .8px;
}

.taxonomy { margin: 0; font-size: 12px; }

.mastery-line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: var(--ui-space-3);
}

.mastery-line span,
.jungle-sample-badge {
  padding: 4px 8px;
  border: 1px solid color-mix(in srgb, var(--ui-accent) 30%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-accent) 7%, transparent);
  color: var(--ui-text-subtle);
  font-size: 11px;
}

.hero-performance {
  display: grid;
  grid-template-columns: auto auto;
  align-items: center;
  gap: var(--ui-space-3);
  padding-left: var(--ui-space-5);
  border-left: 1px solid var(--ui-divider);
}
.hero-scope {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--ui-text-muted);
  font: var(--ui-label-size) var(--ui-font-heading);
  letter-spacing: 1.2px;
  text-transform: uppercase;
}

.hero-score { display: grid; }
.hero-score strong { color: var(--ui-text-heading); font: 30px var(--ui-font-display); }
.hero-score span { color: var(--ui-text-muted); font-size: 11px; text-transform: uppercase; }
.hero-performance dl {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(4, minmax(68px, 1fr));
  gap: var(--ui-space-3);
  margin: 0;
}
.hero-performance dl div { display: grid; gap: 2px; }
.hero-performance dt { color: var(--ui-text-muted); font-size: 11px; text-transform: uppercase; }
.hero-performance dd { margin: 0; color: var(--ui-text-subtle); font-size: 12px; }

.scope-toolbar { display: flex; align-items: end; gap: var(--ui-space-4); }
.scope-toolbar label { display: grid; min-width: 230px; gap: 5px; }
.scope-toolbar label > span { color: var(--ui-text-muted); font: var(--ui-label-size) var(--ui-font-heading); letter-spacing: 1.2px; text-transform: uppercase; }
.scope-toolbar p { margin: 0 0 7px; font-size: 11px; }

.profile-section { min-width: 0; }
.section-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--ui-space-3);
  margin-bottom: var(--ui-space-3);
  padding-bottom: var(--ui-space-2);
  border-bottom: 1px solid var(--ui-divider);
}
.section-head h2 { margin: 2px 0 0; color: var(--ui-text-heading); font: 18px var(--ui-font-heading); }
.section-head p:last-child { margin: 3px 0 0; font-size: 11px; }
.section-head > span { font-size: 11px; }
.compact-head { align-items: center; }

.rvi-score { color: var(--ui-accent-strong); font: 32px var(--ui-font-display); }
.rvi-layout { display: grid; grid-template-columns: minmax(340px, 1.25fr) minmax(250px, .75fr); align-items: center; gap: var(--ui-space-5); }
.rvi-arm-list { display: grid; margin: 0; padding: 0; list-style: none; }
.rvi-arm-list li { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-3); min-height: 48px; border-bottom: 1px solid var(--ui-divider); }
.rvi-arm-list li:last-child { border-bottom: 0; }
.rvi-arm-list li > span { display: grid; gap: 2px; color: var(--ui-text-subtle); font-size: 12px; }
.rvi-arm-list small { color: var(--ui-text-muted); font-size: 11px; }
.rvi-arm-list .numeric { color: var(--ui-text-heading); font-size: 18px; }
.partial-radar-note { padding: var(--ui-space-5); text-align: center; }
.partial-radar-note p, .rvi-reference { margin: var(--ui-space-2) 0 0; font-size: 11px; }

.recent-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--ui-space-2); }
.match-card,
.record-list button,
.performance-list button {
  border: 1px solid var(--ui-divider);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-inset);
  color: var(--ui-text);
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}
.match-card:hover,
.match-card:focus-visible,
.record-list button:hover,
.record-list button:focus-visible,
.performance-list button:hover,
.performance-list button:focus-visible { border-color: var(--ui-accent); background: var(--ui-surface-hover); outline: none; }
.match-card { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--ui-space-2); padding: 10px; text-align: left; }
.result { display: grid; place-items: center; width: 25px; height: 25px; border-radius: 50%; font: 12px var(--ui-font-heading); }
.result.win { background: color-mix(in srgb, var(--ui-positive) 16%, transparent); color: var(--ui-positive); }
.result.loss { background: color-mix(in srgb, var(--ui-negative) 16%, transparent); color: var(--ui-negative); }
.match-main, .match-score { display: grid; gap: 2px; }
.match-main small, .match-score small { color: var(--ui-text-muted); font-size: 11px; }
.match-score { justify-items: end; }

.profile-split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ui-space-4); }
.grades { display: grid; gap: var(--ui-space-2); }
.grade-row { display: grid; grid-template-columns: 38px 1fr 28px; align-items: center; gap: var(--ui-space-2); }
.track { height: 5px; }
.count { text-align: right; font-size: 11px; }
.empty-copy { margin: var(--ui-space-3) 0; font-size: 11px; }

.record-list,
.performance-list { display: grid; }
.record-list button,
.performance-list button { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-3); padding: 9px 10px; border-radius: 0; border-width: 0 0 1px; text-align: left; }
.record-list button:last-child,
.performance-list button:last-child { border-bottom: 0; }
.record-list button > span,
.performance-list button > span { display: grid; gap: 2px; }
.record-list small,
.performance-list small { color: var(--ui-text-muted); font-size: 11px; }
.performance-list button { display: grid; grid-template-columns: 36px 1fr auto; }

.jungle-clear-shell { display: grid; gap: var(--ui-space-3); overflow: hidden; }
.jungle-clear-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--ui-divider); border-radius: var(--ui-radius-sm); background: var(--ui-surface-inset); }
.jungle-clear-metrics article { display: grid; gap: 3px; padding: var(--ui-space-3); border-right: 1px solid var(--ui-divider); }
.jungle-clear-metrics article:last-child { border-right: 0; }
.jungle-clear-metrics span, .jungle-clear-metrics small { color: var(--ui-text-muted); font-size: 11px; }
.jungle-clear-metrics span { font-family: var(--ui-font-heading); letter-spacing: 1px; text-transform: uppercase; }
.jungle-clear-metrics strong { color: var(--ui-text-heading); font: 22px var(--ui-font-display); }
.jungle-table-shell { overflow-x: auto; border: 1px solid var(--ui-divider); border-radius: var(--ui-radius-sm); }
.jungle-table-shell table { width: 100%; min-width: 650px; border-collapse: collapse; font-size: 11px; }
.jungle-table-shell th, .jungle-table-shell td { padding: 8px 9px; border-bottom: 1px solid var(--ui-divider); text-align: left; }
.jungle-table-shell th { color: var(--ui-text-muted); font: 11px var(--ui-font-heading); letter-spacing: .8px; text-transform: uppercase; }
.jungle-table-shell tbody tr:last-child td { border-bottom: 0; }
.jungle-route { max-width: 420px; color: var(--ui-text-subtle); }
.text-link { border: 0; background: transparent; color: var(--ui-accent-strong); cursor: pointer; font: 11px var(--ui-font-heading); text-transform: uppercase; }
.evidence-policy { margin: 0; font-size: 11px; }

.challenge-details { padding: var(--ui-space-3) var(--ui-space-4); border: 1px solid var(--ui-divider); border-radius: var(--ui-radius-md); background: var(--ui-surface-panel-quiet); }
.challenge-details summary { color: var(--ui-text-subtle); cursor: pointer; font: 13px var(--ui-font-heading); }
.challenge-details summary span { color: var(--ui-text-muted); }
.challenge-details > p { margin: var(--ui-space-2) 0; font-size: 11px; }
.need-list { display: grid; gap: var(--ui-space-2); margin: 0; padding: 0; list-style: none; }
.need-list li { display: flex; justify-content: space-between; gap: var(--ui-space-3); font-size: 12px; }

@container champion-detail (max-width: 1000px) {
  .champion-hero { grid-template-columns: auto minmax(0, 1fr); }
  .hero-performance { grid-column: 1 / -1; grid-template-columns: auto 1fr; padding: var(--ui-space-4) 0 0; border-top: 1px solid var(--ui-divider); border-left: 0; }
  .recent-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@container champion-detail (max-width: 720px) {
  .champion-hero { align-items: start; gap: var(--ui-space-3); padding: var(--ui-space-4); }
  .portrait { width: 72px; height: 72px; }
  .hero-identity h1 { font-size: 27px; }
  .hero-performance dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .scope-toolbar, .section-head { align-items: stretch; flex-direction: column; }
  .scope-toolbar label { min-width: 0; }
  .scope-toolbar p { margin: 0; }
  .rvi-layout, .profile-split { grid-template-columns: minmax(0, 1fr); }
  .jungle-clear-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .jungle-clear-metrics article:nth-child(2) { border-right: 0; }
  .jungle-clear-metrics article:nth-child(-n + 2) { border-bottom: 1px solid var(--ui-divider); }
}

@container champion-detail (max-width: 460px) {
  .breadcrumb span:not(:last-child) { display: none; }
  .champion-hero { grid-template-columns: 56px minmax(0, 1fr); }
  .portrait { width: 56px; height: 56px; }
  .mastery-line span { width: fit-content; }
  .recent-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
