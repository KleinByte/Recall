<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import GradeBadge from "../components/GradeBadge.vue"
import ScrollArea from "../components/ui/ScrollArea.vue"
import { api } from "../helpers/api"
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

const stats = ref<ChampionStatRow[]>([])
const profile = ref<ProfileSummary | null>(null)
const needs = ref<Record<number, ChampionNeed[]>>({})
const ranking = ref<ChampionRanking | null>(null)
const sortKey = ref<SortKey>("rank")
const sortDirection = ref<SortDirection>("desc")
const search = ref("")

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

onMounted(() => {
  void load()
  api.on("stats:updated", () => void load())
  api.on("challenges:updated", () => void load())
  api.on("lcu:status", () => void load())
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

const rows = computed(() => {
  if (!props.champions) return []

  const needle = search.value.toLowerCase()

  const combined = props.champions
    .filter((champion) => !needle || champion.name.toLowerCase().includes(needle))
    .map((champion) => {
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
        winRate: recorded?.winRate ?? 0,
        kda: recorded?.kda ?? 0,
        adjustedGrade: rank?.adjustedGrade,
        confidence: rank?.confidence,
      }
    })

  const direction = sortDirection.value === "asc" ? 1 : -1

  return combined.sort((a, b) => {
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
      />
    </header>

    <div v-if="!champions" class="card notice">
      <h2 class="section-title">Champion list unavailable</h2>
      <p class="muted">
        Start the League client so Recall can read your champion collection.
      </p>
    </div>

    <ScrollArea v-else class="table-scroll" max-height="calc(100vh - 300px)">
      <table class="champions">
        <thead>
          <tr>
            <th class="champ-col sortable" :aria-sort="ariaSort('name')">
              <button type="button" @click="setSort('name')">
                Champion
                <span v-if="sortKey === 'name'">
                  {{ sortDirection === "asc" ? "↑" : "↓" }}
                </span>
              </button>
            </th>
            <th class="sortable" :aria-sort="ariaSort('rank')">
              <button type="button" @click="setSort('rank')">
                Your grade
                <span v-if="sortKey === 'rank'">
                  {{ sortDirection === "asc" ? "↑" : "↓" }}
                </span>
              </button>
            </th>
            <th class="sortable" :aria-sort="ariaSort('mastery')">
              <button type="button" @click="setSort('mastery')">
                Mastery
                <span v-if="sortKey === 'mastery'">
                  {{ sortDirection === "asc" ? "↑" : "↓" }}
                </span>
              </button>
            </th>
            <th class="sortable" :aria-sort="ariaSort('riotGrade')">
              <button type="button" @click="setSort('riotGrade')">
                Riot grade
                <span v-if="sortKey === 'riotGrade'">
                  {{ sortDirection === "asc" ? "↑" : "↓" }}
                </span>
              </button>
            </th>
            <th class="sortable" :aria-sort="ariaSort('games')">
              <button type="button" @click="setSort('games')">
                Games
                <span v-if="sortKey === 'games'">
                  {{ sortDirection === "asc" ? "↑" : "↓" }}
                </span>
              </button>
            </th>
            <th class="sortable" :aria-sort="ariaSort('winRate')">
              <button type="button" @click="setSort('winRate')">
                Win rate
                <span v-if="sortKey === 'winRate'">
                  {{ sortDirection === "asc" ? "↑" : "↓" }}
                </span>
              </button>
            </th>
            <th class="sortable" :aria-sort="ariaSort('kda')">
              <button type="button" @click="setSort('kda')">
                KDA
                <span v-if="sortKey === 'kda'">
                  {{ sortDirection === "asc" ? "↑" : "↓" }}
                </span>
              </button>
            </th>
            <th class="needs-col sortable" :aria-sort="ariaSort('needs')">
              <button type="button" @click="setSort('needs')">
                Challenges remaining
                <span v-if="sortKey === 'needs'">
                  {{ sortDirection === "asc" ? "↑" : "↓" }}
                </span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.champion.id"
            class="champion-row"
            :title="`Open ${row.champion.name}`"
            @click="openChampion(row.champion.id)"
          >
            <td class="champ-col">
              <img
                class="icon"
                :src="championIconUrl(row.champion.id)"
                :alt="row.champion.name"
                loading="lazy"
              />
              <span>{{ row.champion.name }}</span>
            </td>
            <td>
              <span v-if="row.adjustedGrade !== undefined" class="own-grade">
                <GradeBadge :grade="gradeFromScore(row.adjustedGrade)" />
                <span class="muted small">
                  {{ row.confidence ? CONFIDENCE_LABEL[row.confidence] : "" }}
                </span>
              </span>
              <span v-else class="muted">–</span>
            </td>
            <td class="numeric">
              <span v-if="row.masteryLevel">
                {{ row.masteryLevel }}
                <span class="muted small">
                  ({{ Math.round(row.masteryPoints / 1000) }}k)
                </span>
              </span>
              <span v-else class="muted">–</span>
            </td>
            <td>
              <GradeBadge :grade="row.riotGrade" />
            </td>
            <td class="numeric">
              <span :class="{ muted: row.games === 0 }">{{ row.games }}</span>
            </td>
            <td class="numeric">
              <span
                v-if="row.games > 0"
                :class="row.winRate >= 0.5 ? 'win-text' : 'loss-text'"
              >
                {{ formatPercent(row.winRate) }}
              </span>
              <span v-else class="muted">–</span>
            </td>
            <td class="numeric">
              <span v-if="row.games > 0">{{ formatDecimal(row.kda, 2) }}</span>
              <span v-else class="muted">–</span>
            </td>
            <td class="needs-col">
              <span v-if="row.needCount === 0" class="muted">All done</span>
              <span v-else class="needs" :title="row.needs.map((n) => n.name).join(', ')">
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
    </ScrollArea>

    <p class="muted footnote">
      Your grade weighs a champion's results against how much you have played
      them, so one strong game does not outrank a season. Riot grade is your
      best career grade from champion mastery.
    </p>
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
  width: 220px;
}

/* The table is contained rather than left to run the length of the page, so
   its header has to travel with the rows. */
.table-scroll {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-1);
  padding-right: 0;
  overflow: auto;
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
  font-size: 10px;
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
}

.champions th.sortable button:hover,
.champions th.sortable button:focus-visible,
.champions th[aria-sort]:not([aria-sort="none"]) button {
  color: var(--gold-bright);
}

.own-grade {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.champions td {
  text-align: right;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid rgba(200, 170, 109, 0.08);
}

.champions tbody tr:hover {
  background: var(--surface-2);
}

.champion-row {
  cursor: pointer;
}

.champion-row:hover .champ-col span {
  color: var(--gold);
}

.champ-col {
  text-align: left !important;
  width: 22%;
}

td.champ-col {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.needs-col {
  text-align: left !important;
  width: 30%;
}

.icon {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

.small {
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
</style>
