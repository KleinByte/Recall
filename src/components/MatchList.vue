<script setup lang="ts">
import GradeBadge from "./GradeBadge.vue"
import { faChevronRight } from "@fortawesome/free-solid-svg-icons"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import type { MatchRow } from "../types/stats"
import type { Champion } from "../types/lol"
import { openMatch } from "../helpers/navigation"
import {
  championIconUrl,
  championNameById,
  formatCompact,
  formatDecimal,
  formatDuration,
  formatRelativeDate,
  modeLabel,
} from "../helpers/format"

defineProps<{
  matches: MatchRow[]
  champions: Champion[] | null
}>()

const kda = (match: MatchRow) =>
  match.deaths === 0
    ? match.kills + match.assists
    : (match.kills + match.assists) / match.deaths
</script>

<template>
  <div class="match-list">
    <div
      v-for="match in matches"
      :key="match.gameId"
      class="match"
      :class="match.win ? 'won' : 'lost'"
    >
      <button class="row" @click="openMatch(match)">
        <GradeBadge :grade="match.grade" />

        <img
          class="icon"
          :src="championIconUrl(match.championId)"
          :alt="championNameById(champions, match.championId)"
          loading="lazy"
        />

        <div class="identity">
          <div class="champ">
            {{ championNameById(champions, match.championId) }}
          </div>
          <div class="meta muted">
            <span class="mode-tag">{{ match.queueName ?? modeLabel(match.mode) }}</span>
            <span>{{ formatDuration(match.durationSecs) }}</span>
            <span v-if="match.bookmarked" title="Bookmarked">★</span>
            <span v-if="match.hasNote" title="Has note">Note</span>
            <span v-if="match.experimentCount" title="Practice experiment">Experiment</span>
          </div>
          <div v-if="match.tagNames?.length" class="row-tags muted">
            {{ match.tagNames.join(" · ") }}
          </div>
        </div>

        <div class="result" :class="match.win ? 'win-text' : 'loss-text'">
          {{ match.win ? "Victory" : "Defeat" }}
        </div>

        <div class="kda numeric">
          {{ match.kills }} / {{ match.deaths }} / {{ match.assists }}
          <span class="muted ratio">{{ formatDecimal(kda(match), 2) }} KDA</span>
        </div>

        <div class="damage numeric muted">
          <template v-if="match.modeFamily === 'sr'">
            {{ formatDecimal(match.csPerMin ?? 0, 1) }} cs/m
          </template>
          <template v-else>
            {{ formatCompact(match.damageToChampions) }} dmg
          </template>
        </div>

        <div class="date muted">{{ formatRelativeDate(match.playedAt) }}</div>
        <FontAwesomeIcon :icon="faChevronRight" class="open-indicator" />
      </button>
    </div>

    <p v-if="matches.length === 0" class="muted empty">
      No matches recorded yet.
    </p>
  </div>
</template>

<style scoped>
.match-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.match {
  border: 1px solid var(--border-subtle);
  border-left-width: 3px;
  border-radius: var(--radius-sm);
  background: var(--surface-1);
  overflow: hidden;
}

.match.won {
  border-left-color: var(--win);
}

.match.lost {
  border-left-color: var(--loss);
}

.row {
  width: 100%;
  display: grid;
  grid-template-columns: 38px 40px minmax(140px, 1.5fr) 80px 1.2fr 1fr 90px 14px;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: none;
  color: inherit;
  text-align: left;
  font-family: var(--font-body);
  font-size: 13px;
  cursor: pointer;
}

.row:hover {
  background: var(--surface-2);
}

.icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--border-subtle);
}

.champ {
  color: var(--text-primary);
}

.meta {
  display: flex;
  gap: var(--space-2);
  font-size: 11px;
}

.mode-tag {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-1);
}

.row-tags { font-size: 10px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.result {
  font-family: var(--font-heading);
  font-size: 12px;
  letter-spacing: 0.8px;
}

.ratio {
  margin-left: var(--space-2);
  font-size: 11px;
}

.date {
  text-align: right;
  font-size: 11px;
}

.open-indicator {
  color: var(--text-muted);
  font-size: 11px;
}

@media (max-width: 780px) {
  .row {
    grid-template-columns: 34px 36px minmax(110px, 1fr) 1fr 14px;
    gap: var(--space-2);
  }

  .result,
  .damage,
  .date {
    display: none;
  }

  .icon {
    width: 36px;
    height: 36px;
  }
}

.detail {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-2) var(--space-4);
  margin: 0;
  padding: var(--space-3) var(--space-4) var(--space-4) 90px;
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-0);
  font-size: 12px;
}

.detail div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
}

.detail dt {
  color: var(--text-secondary);
}

.detail dd {
  margin: 0;
  color: var(--text-primary);
}

.empty {
  font-size: 12px;
  text-align: center;
  padding: var(--space-5);
}
</style>
