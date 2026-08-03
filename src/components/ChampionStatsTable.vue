<script setup lang="ts">
import { computed, ref } from "vue"
import type { ChampionStatRow } from "../types/stats"
import type { Champion } from "../types/lol"
import {
  championIconUrl,
  championNameById,
  formatCompact,
  formatDecimal,
  formatPercent,
} from "../helpers/format"

type SortKey = "games" | "winRate" | "kda"

const props = defineProps<{
  rows: ChampionStatRow[]
  champions: Champion[] | null
}>()

const sortKey = ref<SortKey>("games")
const minGames = ref(1)

const sorted = computed(() => {
  return props.rows
    .filter((row) => row.games >= minGames.value)
    .slice()
    .sort((a, b) => {
      const difference = b[sortKey.value] - a[sortKey.value]
      return difference !== 0 ? difference : b.games - a.games
    })
})

const setSort = (key: SortKey) => {
  sortKey.value = key
}
</script>

<template>
  <div class="table-wrap">
    <div class="controls">
      <label class="min-games">
        <span class="muted">Min games</span>
        <input
          v-model.number="minGames"
          class="league-input min-input"
          type="number"
          min="1"
        />
      </label>
    </div>

    <table class="champion-table">
      <thead>
        <tr>
          <th class="champ-col">Champion</th>
          <th class="sortable" :class="{ active: sortKey === 'games' }" @click="setSort('games')">
            Games
          </th>
          <th>W / L</th>
          <th
            class="sortable"
            :class="{ active: sortKey === 'winRate' }"
            @click="setSort('winRate')"
          >
            Win rate
          </th>
          <th class="sortable" :class="{ active: sortKey === 'kda' }" @click="setSort('kda')">
            KDA
          </th>
          <th>Avg K/D/A</th>
          <th>Avg dmg</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in sorted" :key="row.championId">
          <td class="champ-col">
            <img
              class="champ-icon"
              :src="championIconUrl(row.championId)"
              :alt="championNameById(champions, row.championId)"
              loading="lazy"
            />
            <span>{{ championNameById(champions, row.championId) }}</span>
          </td>
          <td class="numeric">{{ row.games }}</td>
          <td class="numeric">
            <span class="win-text">{{ row.wins }}</span>
            <span class="muted"> / </span>
            <span class="loss-text">{{ row.games - row.wins }}</span>
          </td>
          <td class="numeric" :class="row.winRate >= 0.5 ? 'win-text' : 'loss-text'">
            {{ formatPercent(row.winRate) }}
          </td>
          <td class="numeric">{{ formatDecimal(row.kda, 2) }}</td>
          <td class="numeric muted">
            {{ formatDecimal(row.avgKills) }} /
            {{ formatDecimal(row.avgDeaths) }} /
            {{ formatDecimal(row.avgAssists) }}
          </td>
          <td class="numeric muted">
            {{ formatCompact(row.avgDamageToChampions) }}
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="sorted.length === 0" class="muted empty">
      No champions match this filter.
    </p>
  </div>
</template>

<style scoped>
.table-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.controls {
  display: flex;
  justify-content: flex-end;
}

.min-games {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
}

.min-input {
  width: 64px;
}

.champion-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.champion-table th {
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

.champion-table th.sortable {
  cursor: pointer;
  user-select: none;
}

.champion-table th.sortable:hover {
  color: var(--gold);
}

.champion-table th.active {
  color: var(--gold-bright);
}

.champion-table td {
  text-align: right;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid rgba(200, 170, 109, 0.08);
}

.champion-table tbody tr:hover {
  background: var(--surface-2);
}

.champ-col {
  text-align: left !important;
  width: 40%;
}

td.champ-col {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.champ-icon {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

.empty {
  font-size: 12px;
  text-align: center;
  padding: var(--space-4);
}
</style>
