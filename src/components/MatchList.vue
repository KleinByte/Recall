<script setup lang="ts">
import GradeBadge from "./GradeBadge.vue"
import { faChevronRight } from "@fortawesome/free-solid-svg-icons"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import type { MatchRow } from "../types/stats"
import type { Champion } from "../types/lol"
import { openMatch } from "../helpers/navigation"
import { labelIcon } from "../helpers/label-icons"
import { positionIcon, positionLabel, resolvePosition } from "../helpers/roles"
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

// Lane-based modes assign positions; ARAM and Arena would report noise.
const position = (match: MatchRow) =>
  match.modeFamily === "sr" || match.modeFamily === "classic"
    ? resolvePosition(match.lane, match.role, match.assignedPosition)
    : undefined

const creepScore = (match: MatchRow) =>
  match.totalMinionsKilled + match.neutralMinions
</script>

<template>
  <div class="match-list">
    <div v-if="matches.length" class="columns muted" aria-hidden="true">
      <span></span>
      <span></span>
      <span>Champion</span>
      <span class="col-role">Role</span>
      <span class="col-result">Result</span>
      <span class="col-kda">K / D / A</span>
      <span class="col-cs">CS</span>
      <span class="col-damage">Damage</span>
      <span class="col-rank">Rank</span>
      <span class="col-date">Played</span>
      <span></span>
    </div>

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
          <div v-if="match.labelNames?.length" class="row-labels">
            <span v-for="label in match.labelNames.slice(0, 3)" :key="label" class="game-label">
              <FontAwesomeIcon :icon="labelIcon(label)" class="label-icon" aria-hidden="true" />
              {{ label }}
            </span>
          </div>
          <div v-else-if="match.tagNames?.length" class="row-tags muted">
            {{ match.tagNames.join(" · ") }}
          </div>
        </div>

        <div class="role" :class="{ muted: !position(match) }">
          <template v-if="position(match)">
            <FontAwesomeIcon :icon="positionIcon(position(match))" aria-hidden="true" />
            {{ positionLabel(position(match)) }}
          </template>
          <template v-else>—</template>
        </div>

        <div class="result" :class="match.win ? 'win-text' : 'loss-text'">
          {{ match.win ? "Victory" : "Defeat" }}
        </div>

        <div class="kda numeric">
          {{ match.kills }} / {{ match.deaths }} / {{ match.assists }}
          <span class="muted ratio">{{ formatDecimal(kda(match), 2) }} KDA</span>
        </div>

        <div class="cs numeric">
          {{ creepScore(match) }}
          <span class="muted sub">{{ formatDecimal(match.csPerMin ?? 0, 1) }}/m</span>
        </div>

        <div class="damage numeric muted">
          {{ formatCompact(match.damageToChampions) }}
        </div>

        <div class="rank numeric" :class="{ muted: !match.lobbyPlace }">
          <template v-if="match.lobbyPlace">
            <span :class="{ mvp: match.lobbyPlace === 1 }">{{ match.lobbyPlace }}</span>
            <span class="muted sub">of {{ match.lobbySize }}</span>
          </template>
          <template v-else>—</template>
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
  --match-grid: 34px 40px minmax(150px, 1.6fr) 78px 72px 116px 76px 72px 60px 82px 14px;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

/*
 * The header carries the row's borders as transparent so both boxes place
 * their first column on the same pixel.
 */
.columns {
  display: grid;
  grid-template-columns: var(--match-grid);
  align-items: end;
  gap: var(--space-3);
  padding: 0 var(--space-3) var(--space-1);
  border: 1px solid transparent;
  border-left-width: 3px;
  font-family: var(--font-heading);
  font-size: 10px;
  letter-spacing: 0.8px;
  text-transform: uppercase;
}

.columns .col-kda,
.columns .col-cs,
.columns .col-damage,
.columns .col-rank {
  text-align: center;
}

.columns .col-date {
  text-align: right;
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
  grid-template-columns: var(--match-grid);
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

.row-labels { display: flex; gap: 4px; margin-top: 3px; overflow: hidden; }
.game-label {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  padding: 1px 5px;
  border: 1px solid rgba(200, 170, 110, 0.34);
  border-radius: 999px;
  background: rgba(200, 170, 110, 0.08);
  color: var(--gold-bright);
  font-size: 9px;
  line-height: 1.35;
  white-space: nowrap;
}

.result {
  font-family: var(--font-heading);
  font-size: 12px;
  letter-spacing: 0.8px;
}

.role {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.kda,
.cs,
.damage,
.rank {
  text-align: center;
}

.cs,
.rank {
  color: var(--text-primary);
}

.sub {
  margin-left: 4px;
  font-size: 11px;
}

.mvp {
  color: var(--gold-bright);
  font-family: var(--font-heading);
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

@media (max-width: 1120px) {
  .match-list {
    --match-grid: 34px 40px minmax(140px, 1.6fr) 78px 72px 116px 76px 60px 82px 14px;
  }

  .col-damage,
  .damage {
    display: none;
  }
}

@media (max-width: 900px) {
  .match-list {
    --match-grid: 34px 36px minmax(110px, 1fr) 116px 82px 14px;
    gap: var(--space-2);
  }

  .col-role,
  .role,
  .col-result,
  .result,
  .col-cs,
  .cs,
  .col-rank,
  .rank {
    display: none;
  }

  .icon {
    width: 36px;
    height: 36px;
  }
}

.empty {
  font-size: 12px;
  text-align: center;
  padding: var(--space-5);
}
</style>
