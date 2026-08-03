<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import GradeBadge from "../components/GradeBadge.vue"
import StatCard from "../components/StatCard.vue"
import { api } from "../helpers/api"
import { useApiEvents } from "../helpers/use-api-events"
import { useCoalescedTask } from "../helpers/use-coalesced-task"
import { openChampion } from "../helpers/navigation"
import {
  championIconUrl,
  formatDecimal,
  formatPercent,
  gradeFromScore,
} from "../helpers/format"
import type { Champion } from "../types/lol"
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

const stats = ref<ChampionStatRow[]>([])
const profile = ref<ProfileSummary | null>(null)
const needs = ref<Record<number, ChampionNeed[]>>({})
const ranking = ref<ChampionRanking | null>(null)
const sortKey = ref<SortKey>("rank")
const sortDirection = ref<SortDirection>("desc")
const search = ref("")
const filter = ref<FilterKey>("all")

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

const decorated = computed(() => {
  if (!props.champions) return []

  return props.champions.map((champion) => {
    const recorded = statsById.value.get(champion.id)
    const mastery = masteryById.value.get(champion.id)
    const championNeeds = needs.value[champion.id] ?? []
    const rank = rankById.value.get(champion.id)

    return {
      champion,
      needs: championNeeds,
      needCount: championNeeds.length,
      masteryLevel: mastery?.championLevel ?? 0,
      masteryPoints: mastery?.championPoints ?? 0,
      riotGrade: mastery?.highestGrade,
      games: recorded?.games ?? 0,
      wins: recorded?.wins ?? 0,
      winRate: recorded?.winRate ?? 0,
      kda: recorded?.kda ?? 0,
      adjustedGrade: rank?.adjustedGrade,
      confidence: rank?.confidence,
    }
  })
})

const filterCounts = computed(() => ({
  all: decorated.value.length,
  played: decorated.value.filter((row) => row.games > 0).length,
  untouched: decorated.value.filter((row) => row.games === 0).length,
  needs: decorated.value.filter((row) => row.needCount > 0).length,
}))

/** The headline numbers describe the whole collection, never the filtered view. */
const pool = computed(() => {
  const played = decorated.value.filter((row) => row.games > 0)
  const games = played.reduce((total, row) => total + row.games, 0)
  const wins = played.reduce((total, row) => total + row.wins, 0)
  const graded = decorated.value.filter((row) => row.adjustedGrade !== undefined)
  const gradeSum = graded.reduce((total, row) => total + (row.adjustedGrade ?? 0), 0)

  return {
    playedChampions: played.length,
    totalChampions: decorated.value.length,
    games,
    wins,
    losses: games - wins,
    winRate: games > 0 ? wins / games : 0,
    averageGrade: graded.length > 0 ? gradeSum / graded.length : undefined,
    needsTotal: decorated.value.reduce((total, row) => total + row.needCount, 0),
    needsChampions: filterCounts.value.needs,
  }
})

const rows = computed(() => {
  const needle = search.value.trim().toLowerCase()

  const combined = decorated.value.filter((row) => {
    if (needle && !row.champion.name.toLowerCase().includes(needle)) return false
    if (filter.value === "played") return row.games > 0
    if (filter.value === "untouched") return row.games === 0
    if (filter.value === "needs") return row.needCount > 0
    return true
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
          (a.adjustedGrade ?? -Infinity) - (b.adjustedGrade ?? -Infinity)
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

const isFiltered = computed(() => filter.value !== "all" || search.value !== "")

function clearFilters() {
  filter.value = "all"
  search.value = ""
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>Champions</h1>
        <p class="muted subtitle">
          Mastery, your recorded results, and which challenges each champion
          still counts toward.
        </p>
      </div>

      <input
        v-model="search"
        class="league-input search"
        type="search"
        placeholder="Search champions"
        aria-label="Search champions"
      />
    </header>

    <div v-if="!champions" class="card notice">
      <h2 class="section-title">Champion list unavailable</h2>
      <p class="muted">
        Start the League client so Recall can read your champion collection.
      </p>
    </div>

    <template v-else>
      <section class="kpis">
        <StatCard
          label="Champions played"
          :value="pool.playedChampions.toString()"
          :hint="`of ${pool.totalChampions} owned`"
        />
        <StatCard
          label="Pool win rate"
          :value="pool.games > 0 ? formatPercent(pool.winRate) : '–'"
          :hint="pool.games > 0 ? `${pool.wins}W · ${pool.losses}L` : 'Nothing recorded yet'"
          :tone="pool.games === 0 ? 'neutral' : pool.winRate >= 0.5 ? 'win' : 'loss'"
        />
        <StatCard
          label="Average grade"
          :value="gradeFromScore(pool.averageGrade) ?? '–'"
          hint="Across graded champions"
        />
        <StatCard
          label="Challenges remaining"
          :value="pool.needsTotal.toString()"
          :hint="`Spread over ${pool.needsChampions} champions`"
        />
      </section>

      <div class="card toolbar">
        <div class="chip-row" role="group" aria-label="Filter champions">
          <button
            v-for="option in FILTERS"
            :key="option.value"
            type="button"
            class="league-button chip"
            :class="{ active: filter === option.value }"
            :aria-pressed="filter === option.value"
            @click="filter = option.value"
          >
            {{ option.label }}
            <span class="chip-count numeric">{{ filterCounts[option.value] }}</span>
          </button>
        </div>

        <p class="muted result-count">
          {{ rows.length }} shown
          <button v-if="isFiltered" class="link" type="button" @click="clearFilters">
            Reset
          </button>
        </p>
      </div>

      <div class="card table-card">
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
                  <span class="champ-name">{{ row.champion.name }}</span>
                </td>
                <td>
                  <span v-if="row.adjustedGrade !== undefined" class="own-grade">
                    <GradeBadge :grade="gradeFromScore(row.adjustedGrade)" />
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

          <p v-if="rows.length === 0" class="muted empty">
            No champions match this view.
            <button class="link" type="button" @click="clearFilters">
              Reset the filters
            </button>
            to see everything.
          </p>
        </div>
      </div>

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
  gap: var(--space-4);
}

.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-4);
  flex-wrap: wrap;
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
  max-width: 60ch;
}

.search {
  width: 240px;
}

.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-3);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: var(--space-2) var(--space-3);
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

.result-count {
  margin: 0 0 0 auto;
  font-size: 11px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
}

.link {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--gold);
  font: inherit;
  padding: 0 0 0 var(--space-2);
  cursor: pointer;
  text-decoration: underline;
}

.link:hover {
  color: var(--gold-bright);
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
  padding: var(--space-5);
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}

.notice {
  max-width: 60ch;
}

.notice p {
  margin: 0;
  font-size: 13px;
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

@media (max-width: 1180px) {
  .riot-col,
  .need-names {
    display: none;
  }
}

@media (max-width: 900px) {
  th.mastery-col,
  td.mastery-col,
  th.rank-col,
  td.rank-col {
    display: none;
  }

  .search {
    width: 100%;
  }
}
</style>
