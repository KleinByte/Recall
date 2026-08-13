<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import GradeBadge from "../components/GradeBadge.vue"
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
import { openChampion } from "../helpers/navigation"
import {
  championIconUrl,
  formatDecimal,
  formatPercent,
} from "../helpers/format"
import {
  PRIMARY_ARCHETYPES,
  PRIMARY_ARCHETYPE_LABELS,
  type PrimaryArchetype,
} from "../shared/champion-archetypes"
import { recallGradeFromRecallScore } from "../shared/recall-grade"
import {
  ChampionRoles,
  type Champion,
  type ChampionRole,
} from "../types/lol"
import type {
  ChampionNeed,
  ChampionRanking,
  ChampionStatRow,
  Confidence,
  ProfileSummary,
} from "../types/stats"

const props = defineProps<{
  champions: Champion[] | null
  connected: boolean
}>()
const events = useApiEvents()

type SortKey =
  | "name"
  | "rank"
  | "mastery"
  | "riotGrade"
  | "games"
  | "winRate"
  | "kda"
  | "needs"

type SortDirection = "asc" | "desc"

type FilterKey = "all" | "played" | "untouched" | "needs"
type ArchetypeFilter = "all" | PrimaryArchetype
type ClassFilter = "all" | ChampionRole

const RIOT_GRADE_ORDER = [
  "D-", "D", "D+",
  "C-", "C", "C+",
  "B-", "B", "B+",
  "A-", "A", "A+",
  "S-", "S", "S+",
]

/** How much play stands behind a champion's grade. */
const CONFIDENCE_LABEL: Record<Confidence, string> = {
  thin: "1–2 games",
  fair: "3–4 games",
  solid: "5+ games",
}

/** Filled pips give confidence a shape you can scan straight down the column. */
const CONFIDENCE_PIPS: Record<Confidence, number> = {
  thin: 1,
  fair: 2,
  solid: 3,
}

const FILTERS: { value: FilterKey; label: string }[] = [
  { value: "all", label: "All" },
  { value: "played", label: "Played" },
  { value: "untouched", label: "Untouched" },
  { value: "needs", label: "Has challenges" },
]

const CHAMPION_ROLE_LABELS: Readonly<Record<ChampionRole, string>> = Object.freeze({
  assassin: "Assassin",
  fighter: "Fighter",
  mage: "Mage",
  marksman: "Marksman",
  support: "Support",
  tank: "Tank",
})

const stats = ref<ChampionStatRow[]>([])
const profile = ref<ProfileSummary | null>(null)
const needs = ref<Record<number, ChampionNeed[]>>({})
const ranking = ref<ChampionRanking | null>(null)
const sortKey = ref<SortKey>("rank")
const sortDirection = ref<SortDirection>("desc")
const search = ref("")
const filter = ref<FilterKey>("all")
const archetype = ref<ArchetypeFilter>("all")
const championClass = ref<ClassFilter>("all")

function setSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDirection.value = sortDirection.value === "desc" ? "asc" : "desc"
    return
  }

  sortKey.value = key
  sortDirection.value = key === "name" ? "asc" : "desc"
}

function ariaSort(key: SortKey) {
  if (sortKey.value !== key) return "none" as const
  return sortDirection.value === "asc"
    ? "ascending" as const
    : "descending" as const
}

/** An idle marker on every column advertises that the table sorts. */
function sortIcon(key: SortKey) {
  if (sortKey.value !== key) return "↕"
  return sortDirection.value === "asc" ? "↑" : "↓"
}

function masteryPointsLabel(points: number) {
  if (points >= 1_000_000) return `${(points / 1_000_000).toFixed(1)}M`
  if (points >= 1_000) return `${Math.round(points / 1_000)}k`
  return points.toString()
}

async function load() {
  if (!props.champions) return

  try {
    const ids = props.champions.map((champion) => champion.id)
    const [nextStats, nextProfile, nextNeeds, nextRanking] = await Promise.all([
      api.getChampionStats({}),
      api.getProfile(),
      api.getChampionNeeds(ids),
      api.getRankedChampions({}),
    ])

    stats.value = nextStats
    profile.value = nextProfile
    needs.value = nextNeeds
    ranking.value = nextRanking
  } catch {
    stats.value = []
  }
}

const refresh = useCoalescedTask(load)

onMounted(() => {
  void refresh()
  events.on("stats:updated", () => void refresh())
  events.on("challenges:updated", () => void refresh())
  events.on("lcu:status", () => void refresh())
})

const masteryById = computed(() => {
  const map = new Map<
    number,
    { championLevel: number; championPoints: number; highestGrade?: string }
  >()
  for (const entry of profile.value?.mastery ?? []) {
    map.set(entry.championId, entry)
  }
  return map
})

const statsById = computed(() => {
  const map = new Map<number, ChampionStatRow>()
  for (const row of stats.value) map.set(row.championId, row)
  return map
})

const rankById = computed(() => {
  const map = new Map<number, ChampionRanking["ranked"][number]>()
  for (const row of ranking.value?.ranked ?? []) map.set(row.championId, row)
  return map
})

const earlyById = computed(() => new Map(
  (ranking.value?.earlySignals ?? []).map((row) => [row.championId, row]),
))

const decorated = computed(() => {
  if (!props.champions) return []

  return props.champions.map((champion) => {
    const recorded = statsById.value.get(champion.id)
    const mastery = masteryById.value.get(champion.id)
    const championNeeds = needs.value[champion.id] ?? []
    const rank = rankById.value.get(champion.id)
    const earlySignal = earlyById.value.get(champion.id)

    return {
      champion,
      needs: championNeeds,
      needCount: championNeeds.length,
      masteryLevel: mastery?.championLevel ?? 0,
      masteryPoints: mastery?.championPoints ?? 0,
      riotGrade: mastery?.highestGrade,
      games: recorded?.games ?? 0,
      gradedGames: recorded?.gradedGames ?? 0,
      wins: recorded?.wins ?? 0,
      winRate: recorded?.winRate ?? 0,
      kda: recorded?.kda ?? 0,
      recallScore: rank?.recallScore ?? recorded?.averageRecallScore,
      confidence: rank?.confidence,
      earlySignal,
    }
  })
})

type DecoratedChampion = typeof decorated.value[number]

const archetypeLabel = (value?: PrimaryArchetype) => value
  ? PRIMARY_ARCHETYPE_LABELS[value]
  : "Unclassified"

const roleLabel = (value: ChampionRole) => CHAMPION_ROLE_LABELS[value]

const championTaxonomyLabel = (champion: Champion) => [
  archetypeLabel(champion.primaryArchetype),
  champion.roles.map(roleLabel).join(" / "),
].filter(Boolean).join(" · ")

function matchesSearch(row: DecoratedChampion, needle: string) {
  if (!needle) return true
  const searchable = [
    row.champion.name,
    row.champion.alias,
    archetypeLabel(row.champion.primaryArchetype),
    ...row.champion.roles.map(roleLabel),
  ].join(" ").toLowerCase()
  return searchable.includes(needle)
}

function matchesStatus(row: DecoratedChampion, value: FilterKey) {
  if (value === "played") return row.games > 0
  if (value === "untouched") return row.games === 0
  if (value === "needs") return row.needCount > 0
  return true
}

function matchesArchetype(row: DecoratedChampion, value: ArchetypeFilter) {
  return value === "all" || row.champion.primaryArchetype === value
}

function matchesClass(row: DecoratedChampion, value: ClassFilter) {
  return value === "all" || row.champion.roles.includes(value)
}

const searchNeedle = computed(() => search.value.trim().toLowerCase())

/** Each facet count respects every active control except its own dimension. */
const filterCounts = computed(() => {
  const candidates = decorated.value.filter((row) =>
    matchesSearch(row, searchNeedle.value) &&
    matchesArchetype(row, archetype.value) &&
    matchesClass(row, championClass.value))
  return {
    all: candidates.length,
    played: candidates.filter((row) => matchesStatus(row, "played")).length,
    untouched: candidates.filter((row) => matchesStatus(row, "untouched")).length,
    needs: candidates.filter((row) => matchesStatus(row, "needs")).length,
  }
})

const archetypeCounts = computed(() => Object.fromEntries(PRIMARY_ARCHETYPES.map((value) => [
  value,
  decorated.value.filter((row) =>
    matchesSearch(row, searchNeedle.value) &&
    matchesStatus(row, filter.value) &&
    matchesClass(row, championClass.value) &&
    matchesArchetype(row, value)).length,
])))

const classCounts = computed(() => Object.fromEntries(ChampionRoles.map((value) => [
  value,
  decorated.value.filter((row) =>
    matchesSearch(row, searchNeedle.value) &&
    matchesStatus(row, filter.value) &&
    matchesArchetype(row, archetype.value) &&
    matchesClass(row, value)).length,
])))

/** The headline numbers describe the whole collection, never the filtered view. */
const pool = computed(() => {
  const played = decorated.value.filter((row) => row.games > 0)
  const games = played.reduce((total, row) => total + row.games, 0)
  const wins = played.reduce((total, row) => total + row.wins, 0)
  const graded = decorated.value.filter((row) => row.recallScore !== undefined)
  const recallScoreWeight = graded.reduce((total, row) => total + row.gradedGames, 0)
  const recallScoreSum = graded.reduce((total, row) =>
    total + row.recallScore! * row.gradedGames, 0)

  return {
    playedChampions: played.length,
    totalChampions: decorated.value.length,
    games,
    wins,
    losses: games - wins,
    winRate: games > 0 ? wins / games : 0,
    averageRecallScore: recallScoreWeight > 0 ? recallScoreSum / recallScoreWeight : undefined,
    needsTotal: decorated.value.reduce((total, row) => total + row.needCount, 0),
    needsChampions: filterCounts.value.needs,
  }
})

const rows = computed(() => {
  const combined = decorated.value.filter((row) => {
    return matchesSearch(row, searchNeedle.value) &&
      matchesStatus(row, filter.value) &&
      matchesArchetype(row, archetype.value) &&
      matchesClass(row, championClass.value)
  })

  const direction = sortDirection.value === "asc" ? 1 : -1

  return [...combined].sort((a, b) => {
    let comparison: number
    switch (sortKey.value) {
      case "name":
        comparison = a.champion.name.localeCompare(b.champion.name)
        break
      case "rank":
        // Champions never played have no ranking and sink to the bottom.
        comparison =
          (a.recallScore ?? -Infinity) - (b.recallScore ?? -Infinity)
        break
      case "mastery":
        comparison = a.masteryPoints - b.masteryPoints
        break
      case "riotGrade":
        comparison = RIOT_GRADE_ORDER.indexOf(a.riotGrade ?? "") -
          RIOT_GRADE_ORDER.indexOf(b.riotGrade ?? "")
        break
      case "games":
        comparison = a.games - b.games
        break
      case "winRate":
        comparison = a.winRate - b.winRate
        break
      case "kda":
        comparison = a.kda - b.kda
        break
      case "needs":
        comparison = a.needCount - b.needCount
        break
    }

    return (
      comparison * direction ||
      a.champion.name.localeCompare(b.champion.name)
    )
  })
})

const isFiltered = computed(() =>
  filter.value !== "all" || archetype.value !== "all" ||
  championClass.value !== "all" || search.value !== "")

function clearFilters() {
  filter.value = "all"
  archetype.value = "all"
  championClass.value = "all"
  search.value = ""
}
</script>

<template>
  <div class="page">
    <PageHeader
      title="Champions"
      eyebrow="Mastery archive"
      description="Mastery, recorded results, and the challenges each champion still counts toward."
    >
      <template #actions>
        <Field label="Search champions" compact class="search-field">
          <input
            v-model="search"
            class="league-input search"
            type="search"
            placeholder="Champion name"
            aria-label="Search champions"
          />
        </Field>
      </template>
    </PageHeader>

    <EmptyState
      v-if="!champions"
      class="notice"
      title="Champion list unavailable"
      description="Start the League client so Recall can read your champion collection."
    />

    <template v-else>
      <Surface
        as="section"
        variant="quiet"
        padding="compact"
        class="kpis"
        aria-label="Champion pool summary"
      >
        <StatTile
          density="compact"
          label="Champions played"
          :value="pool.playedChampions.toString()"
          :hint="`of ${pool.totalChampions} owned`"
        />
        <StatTile
          density="compact"
          label="Pool win rate"
          :value="pool.games > 0 ? formatPercent(pool.winRate) : '–'"
          :hint="pool.games > 0 ? `${pool.wins}W · ${pool.losses}L` : 'Nothing recorded yet'"
          :tone="pool.games === 0 ? 'neutral' : pool.winRate >= 0.5 ? 'win' : 'loss'"
        />
        <StatTile
          density="compact"
          label="Average Recall Score"
          :value="pool.averageRecallScore?.toFixed(1) ?? '–'"
          :hint="recallGradeFromRecallScore(pool.averageRecallScore) ?? 'No grade'"
        />
        <StatTile
          density="compact"
          label="Challenges remaining"
          :value="pool.needsTotal.toString()"
          :hint="`Spread over ${pool.needsChampions} champions`"
        />
      </Surface>

      <Surface
        as="section"
        variant="toolbar"
        padding="compact"
        class="toolbar"
        aria-label="Champion table controls"
      >
        <div class="chip-row" role="group" aria-label="Filter champions by collection status">
          <Button
            v-for="option in FILTERS"
            :key="option.value"
            type="button"
            class="chip"
            size="compact"
            :active="filter === option.value"
            :aria-pressed="filter === option.value"
            @click="filter = option.value"
          >
            {{ option.label }}
            <span class="chip-count numeric">{{ filterCounts[option.value] }}</span>
          </Button>
        </div>

        <div class="taxonomy-filters">
          <Field label="Archetype" compact>
            <select v-model="archetype" class="league-select" aria-label="Filter by archetype">
              <option value="all">Any archetype</option>
              <option v-for="value in PRIMARY_ARCHETYPES" :key="value" :value="value">
                {{ PRIMARY_ARCHETYPE_LABELS[value] }} · {{ archetypeCounts[value] }}
              </option>
            </select>
          </Field>
          <Field label="Riot class" compact>
            <select v-model="championClass" class="league-select" aria-label="Filter by Riot class">
              <option value="all">Any class</option>
              <option v-for="value in ChampionRoles" :key="value" :value="value">
                {{ CHAMPION_ROLE_LABELS[value] }} · {{ classCounts[value] }}
              </option>
            </select>
          </Field>
        </div>

        <p class="muted result-count">
          {{ rows.length }} shown
          <Button
            v-if="isFiltered"
            variant="ghost"
            size="compact"
            type="button"
            @click="clearFilters"
          >
            Reset
          </Button>
        </p>
      </Surface>

      <Surface variant="inset" padding="none" class="table-card">
        <div class="table-scroll">
          <table class="champions">
            <thead>
              <tr>
                <th class="rank-col" scope="col">
                  <span class="sr-only">Position</span>
                </th>
                <th class="champ-col sortable" scope="col" :aria-sort="ariaSort('name')">
                  <button type="button" @click="setSort('name')">
                    Champion
                    <span class="arrow" :class="{ idle: sortKey !== 'name' }">
                      {{ sortIcon("name") }}
                    </span>
                  </button>
                </th>
                <th class="sortable" scope="col" :aria-sort="ariaSort('rank')">
                  <button type="button" @click="setSort('rank')">
                    Your grade
                    <span class="arrow" :class="{ idle: sortKey !== 'rank' }">
                      {{ sortIcon("rank") }}
                    </span>
                  </button>
                </th>
                <th class="mastery-col sortable" scope="col" :aria-sort="ariaSort('mastery')">
                  <button type="button" @click="setSort('mastery')">
                    Mastery
                    <span class="arrow" :class="{ idle: sortKey !== 'mastery' }">
                      {{ sortIcon("mastery") }}
                    </span>
                  </button>
                </th>
                <th class="riot-col sortable" scope="col" :aria-sort="ariaSort('riotGrade')">
                  <button type="button" @click="setSort('riotGrade')">
                    Riot grade
                    <span class="arrow" :class="{ idle: sortKey !== 'riotGrade' }">
                      {{ sortIcon("riotGrade") }}
                    </span>
                  </button>
                </th>
                <th class="sortable" scope="col" :aria-sort="ariaSort('games')">
                  <button type="button" @click="setSort('games')">
                    Games
                    <span class="arrow" :class="{ idle: sortKey !== 'games' }">
                      {{ sortIcon("games") }}
                    </span>
                  </button>
                </th>
                <th class="rate-col sortable" scope="col" :aria-sort="ariaSort('winRate')">
                  <button type="button" @click="setSort('winRate')">
                    Win rate
                    <span class="arrow" :class="{ idle: sortKey !== 'winRate' }">
                      {{ sortIcon("winRate") }}
                    </span>
                  </button>
                </th>
                <th class="sortable" scope="col" :aria-sort="ariaSort('kda')">
                  <button type="button" @click="setSort('kda')">
                    KDA
                    <span class="arrow" :class="{ idle: sortKey !== 'kda' }">
                      {{ sortIcon("kda") }}
                    </span>
                  </button>
                </th>
                <th class="needs-col sortable" scope="col" :aria-sort="ariaSort('needs')">
                  <button type="button" @click="setSort('needs')">
                    Challenges remaining
                    <span class="arrow" :class="{ idle: sortKey !== 'needs' }">
                      {{ sortIcon("needs") }}
                    </span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, index) in rows"
                :key="row.champion.id"
                class="champion-row"
                :class="{ untouched: row.games === 0 }"
                tabindex="0"
                :aria-label="`Open ${row.champion.name}`"
                @click="openChampion(row.champion.id)"
                @keydown.enter.prevent="openChampion(row.champion.id)"
                @keydown.space.prevent="openChampion(row.champion.id)"
              >
                <td class="rank-col numeric">{{ index + 1 }}</td>
                <td class="champ-col">
                  <img
                    class="icon"
                    :src="championIconUrl(row.champion.id)"
                    :alt="row.champion.name"
                    loading="lazy"
                  />
                  <span class="champ-copy">
                    <span class="champ-name">{{ row.champion.name }}</span>
                    <small>{{ championTaxonomyLabel(row.champion) }}</small>
                  </span>
                </td>
                <td>
                  <span v-if="row.recallScore !== undefined" class="own-grade">
                    <GradeBadge :grade="recallGradeFromRecallScore(row.recallScore)" />
                    <span
                      v-if="row.confidence"
                      class="confidence"
                      :title="`Based on ${CONFIDENCE_LABEL[row.confidence]}`"
                    >
                      <i
                        v-for="pip in 3"
                        :key="pip"
                        class="pip"
                        :class="{ on: pip <= CONFIDENCE_PIPS[row.confidence] }"
                      />
                    </span>
                  </span>
                  <span v-else-if="row.earlySignal" class="early-signal">
                    Early signal · {{ row.earlySignal.gradedGames }} graded
                  </span>
                  <span v-else class="muted">–</span>
                </td>
                <td class="mastery-col">
                  <span v-if="row.masteryLevel" class="mastery">
                    <span class="mastery-level numeric">{{ row.masteryLevel }}</span>
                    <span class="muted small numeric">
                      {{ masteryPointsLabel(row.masteryPoints) }}
                    </span>
                  </span>
                  <span v-else class="muted">–</span>
                </td>
                <td class="riot-col">
                  <GradeBadge :grade="row.riotGrade" />
                </td>
                <td class="numeric">
                  <span :class="{ muted: row.games === 0 }">{{ row.games }}</span>
                </td>
                <td class="rate-col">
                  <span v-if="row.games > 0" class="rate">
                    <span
                      class="numeric"
                      :class="row.winRate >= 0.5 ? 'win-text' : 'loss-text'"
                    >
                      {{ formatPercent(row.winRate) }}
                    </span>
                    <span class="rate-track" aria-hidden="true">
                      <span
                        class="rate-fill"
                        :class="row.winRate >= 0.5 ? 'win-fill' : 'loss-fill'"
                        :style="{ width: `${Math.round(row.winRate * 100)}%` }"
                      />
                    </span>
                  </span>
                  <span v-else class="muted">–</span>
                </td>
                <td class="numeric">
                  <span v-if="row.games > 0">{{ formatDecimal(row.kda, 2) }}</span>
                  <span v-else class="muted">–</span>
                </td>
                <td class="needs-col">
                  <span v-if="row.needCount === 0" class="muted done">All done</span>
                  <span
                    v-else
                    class="needs"
                    :title="row.needs.map((n) => n.name).join(', ')"
                  >
                    <span class="need-count numeric">{{ row.needCount }}</span>
                    <span class="muted need-names">
                      {{ row.needs.slice(0, 2).map((n) => n.name).join(", ")
                      }}{{ row.needs.length > 2 ? "…" : "" }}
                    </span>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>

          <EmptyState
            v-if="rows.length === 0"
            compact
            class="empty"
            title="No champions match this view"
            description="Reset the filters to return to your full champion collection."
          >
            <template #actions>
              <Button size="compact" @click="clearFilters">Reset filters</Button>
            </template>
          </EmptyState>
        </div>
      </Surface>

      <p class="muted footnote">
        Your grade weighs a champion's results against how much you have played
        them, so one strong game does not outrank a season. Riot grade is your
        best career grade from champion mastery.
      </p>
    </template>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-5);
}

.search-field { width: min(280px, 34vw); }
.search { width: 100%; }

.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-3);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--ui-space-3);
  flex-wrap: wrap;
}

.chip-row {
  display: flex;
  gap: var(--space-1);
  flex-wrap: wrap;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 30px;
  font-size: 12px;
}

.chip-count {
  font-size: 11px;
  color: var(--text-muted);
}

.chip.active .chip-count {
  color: var(--gold);
}

.taxonomy-filters {
  display: flex;
  align-items: end;
  gap: var(--ui-space-2);
  flex-wrap: wrap;
}

.taxonomy-filters :deep(.league-select) {
  min-width: 154px;
}

.result-count {
  margin: 0 0 0 auto;
  font-size: 11px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
}

/* The table is contained rather than left to run the length of the page, so
   its header has to travel with the rows. */
.table-card {
  padding: 0;
  overflow: hidden;
}

.table-scroll {
  overflow: auto;
  max-height: clamp(320px, calc(100vh - 430px), 1100px);
}

.champions {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.champions th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--surface-2);
  text-align: right;
  font-family: var(--font-heading);
  font-size: 12px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--text-secondary);
  font-weight: 500;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  white-space: nowrap;
}

.champions th.sortable button {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  padding: 0;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.12s ease;
}

.champions th.sortable button:hover,
.champions th.sortable button:focus-visible,
.champions th[aria-sort]:not([aria-sort="none"]) button {
  color: var(--gold-bright);
}

.arrow {
  display: inline-block;
  min-width: 9px;
  color: var(--gold);
}

.arrow.idle {
  color: transparent;
}

.champions th.sortable button:hover .arrow.idle {
  color: var(--text-muted);
}

.champions td {
  text-align: right;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid rgba(200, 170, 109, 0.08);
}

.champions tbody tr:last-child td {
  border-bottom: 0;
}

.champion-row {
  cursor: pointer;
  transition: background 0.12s ease, box-shadow 0.12s ease;
}

.champion-row:hover,
.champion-row:focus-visible {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--gold) 9%, transparent),
    transparent 46%
  );
  box-shadow: inset 3px 0 var(--gold);
  outline: none;
}

.champion-row:focus-visible {
  box-shadow: inset 3px 0 var(--gold-bright);
}

.champion-row:hover .champ-name,
.champion-row:focus-visible .champ-name {
  color: var(--gold-bright);
}

.champion-row:hover .icon,
.champion-row:focus-visible .icon {
  border-color: var(--border-strong);
  transform: scale(1.06);
}

/* Champions with no recorded games recede so the played pool reads first. */
.champion-row.untouched .champ-name,
.champion-row.untouched .icon {
  opacity: 0.7;
}

.champion-row.untouched:hover .champ-name,
.champion-row.untouched:hover .icon,
.champion-row.untouched:focus-visible .champ-name,
.champion-row.untouched:focus-visible .icon {
  opacity: 1;
}

th.rank-col,
td.rank-col {
  width: 46px;
  text-align: right;
  padding-right: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.champ-col {
  text-align: left !important;
  width: 20%;
}

td.champ-col {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.icon {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  transition: border-color 0.12s ease, transform 0.12s ease, opacity 0.12s ease;
}

.champ-name {
  font-family: var(--font-heading);
  letter-spacing: 0.3px;
  transition: color 0.12s ease, opacity 0.12s ease;
}

.champ-copy {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.champ-copy small {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.own-grade {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.confidence {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.pip {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--surface-3);
}

.pip.on {
  background: var(--gold);
}

.mastery {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.mastery-level {
  display: grid;
  place-items: center;
  min-width: 24px;
  padding: 1px 5px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--gold-bright);
  font-size: 11px;
}

.rate {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  min-width: 62px;
}

.rate-track {
  display: block;
  width: 100%;
  height: 3px;
  border-radius: 2px;
  background: var(--surface-3);
  overflow: hidden;
}

.rate-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
}

.rate-fill.win-fill {
  background: var(--win);
}

.rate-fill.loss-fill {
  background: var(--loss);
}

.needs-col {
  text-align: left !important;
  width: 28%;
}

.small {
  font-size: 11px;
}

.done {
  font-size: 11px;
}

.needs {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.need-count {
  display: grid;
  place-items: center;
  min-width: 22px;
  padding: 1px 5px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--gold);
  font-size: 11px;
}

.need-names {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  margin: var(--ui-space-4);
}

.notice {
  max-width: 60ch;
}

.footnote {
  font-size: 11px;
  margin: 0;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

@container recall-content (max-width: 1180px) {
  .riot-col,
  .need-names {
    display: none;
  }
}

@container recall-content (max-width: 900px) {
  th.mastery-col,
  td.mastery-col,
  th.rank-col,
  td.rank-col {
    display: none;
  }

  .search-field { width: 100%; }
  .toolbar { align-items: stretch; }
  .chip-row { flex: 1 1 100%; }
  .taxonomy-filters { flex: 1 1 100%; }
  .taxonomy-filters :deep(.ui-field) { flex: 1 1 180px; }
  .taxonomy-filters :deep(.league-select) { width: 100%; }
  .result-count { display: flex; align-items: center; margin-left: 0; }
}

@container recall-content (max-width: 520px) {
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .chip-row > :deep(.ui-button) { flex: 1 1 calc(50% - var(--ui-space-1)); }
}
</style>
