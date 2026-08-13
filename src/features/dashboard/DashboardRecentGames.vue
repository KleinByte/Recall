<script setup lang="ts">
import GradeBadge from "../../components/GradeBadge.vue"
import {
  championIconUrl,
  championNameById,
  formatDuration,
  formatRelativeDate,
  modeLabel,
} from "../../helpers/format"
import type { Champion } from "../../types/lol"
import type { MatchRow } from "../../types/stats"

const props = defineProps<{
  games: readonly MatchRow[]
  champions: Champion[] | null
}>()

const emit = defineEmits<{
  openMatch: [match: MatchRow]
}>()

const championName = (id: number) => championNameById(props.champions, id)
</script>

<template>
  <ul class="game-list">
    <li
      v-for="game in games"
      :key="game.gameId"
      class="game"
      :class="game.win ? 'won' : 'lost'"
      @click="emit('openMatch', game)"
    >
      <GradeBadge :grade="game.grade" />
      <img
        :src="championIconUrl(game.championId)"
        :alt="championName(game.championId)"
        class="portrait"
      />
      <div class="game-body">
        <div class="game-name">{{ championName(game.championId) }}</div>
        <div class="muted game-meta">
          {{ game.queueName ?? modeLabel(game.mode) }} ·
          {{ formatDuration(game.durationSecs) }}
        </div>
      </div>
      <div class="numeric game-kda">
        {{ game.kills }}/{{ game.deaths }}/{{ game.assists }}
      </div>
      <div class="muted game-date">
        {{ formatRelativeDate(game.playedAt) }}
      </div>
    </li>
  </ul>
</template>

<style scoped>
.game-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.game {
  position: relative;
  display: grid;
  grid-template-columns: 34px 28px 1fr auto auto;
  align-items: center;
  gap: var(--ui-space-3);
  min-height: 48px;
  padding: 7px 9px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ui-accent) 10%, transparent);
  border-radius: var(--ui-radius-sm);
  background: color-mix(in srgb, var(--ui-canvas) 36%, transparent);
  cursor: pointer;
  font-size: var(--ui-text-label);
  transition:
    border-color var(--instrument-motion-fast) ease,
    background var(--instrument-motion-fast) ease;
}

.game::before {
  content: "";
  position: absolute;
  inset: 7px auto 7px 0;
  width: 2px;
  background: transparent;
}

.game.won { --game-state: var(--ui-live); }
.game.lost { --game-state: var(--ui-negative); }
.game.won::before,
.game.lost::before { background: var(--game-state); }

.game:hover {
  border-color: var(--ui-border);
  background: color-mix(in srgb, var(--ui-surface-hover) 20%, transparent);
}

.game:hover .game-name { color: var(--ui-accent); }

.game-name {
  color: var(--ui-text);
  font: var(--ui-text-support) var(--ui-font-heading);
}

.game-meta,
.game-date { font-size: var(--ui-text-micro); }
.game-kda { color: var(--ui-text-heading); }

.portrait {
  width: 26px;
  height: 26px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  object-fit: cover;
}

@media (max-width: 620px) {
  .game {
    grid-template-columns: 34px 28px minmax(0, 1fr) auto;
    gap: var(--ui-space-2);
  }

  .game-date { display: none; }
}
</style>
