<script setup lang="ts">
import GradeBadge from "../../components/GradeBadge.vue"
import {
  championIconUrl,
  championNameById,
  formatDecimal,
  formatPercent,
} from "../../helpers/format"
import { recallGradeFromRecallScore } from "../../shared/recall-grade"
import type { Champion } from "../../types/lol"
import type { RankedChampion } from "../../types/stats"

const props = defineProps<{
  rows: readonly RankedChampion[]
  champions: Champion[] | null
}>()

const emit = defineEmits<{
  openChampion: [championId: number]
}>()

const championName = (id: number) => championNameById(props.champions, id)

const confidenceLabel = (games: number) => {
  if (games >= 12) return "Strong read"
  if (games >= 5) return "Fair read"
  return "Early read"
}
</script>

<template>
  <p class="muted champion-intro">
    Your highest average Recall Score among champions with at least five graded games.
  </p>
  <ol class="champion-list">
    <li v-for="(row, index) in rows" :key="row.championId">
      <button
        type="button"
        class="champion"
        @click="emit('openChampion', row.championId)"
      >
        <span class="numeric champion-rank">{{ index + 1 }}</span>
        <img
          :src="championIconUrl(row.championId)"
          :alt="championName(row.championId)"
          class="portrait"
        />
        <span class="champion-copy">
          <strong class="champion-name">{{ championName(row.championId) }}</strong>
          <span class="muted champion-evidence">
            {{ confidenceLabel(row.gradedGames) }} · {{ row.gradedGames }} graded
          </span>
        </span>
        <span class="champion-stats">
          <span>
            <strong class="numeric">{{ row.games }}</strong>
            <small>games</small>
          </span>
          <span>
            <strong
              class="numeric"
              :class="row.winRate >= 0.5 ? 'win-text' : 'loss-text'"
            >{{ formatPercent(row.winRate) }}</strong>
            <small>win rate</small>
          </span>
          <span>
            <strong class="numeric">{{ formatDecimal(row.kda, 2) }}</strong>
            <small>KDA</small>
          </span>
        </span>
        <span class="champion-grade">
          <GradeBadge :grade="recallGradeFromRecallScore(row.recallScore)" size="lg" />
        </span>
      </button>
    </li>
  </ol>
  <p class="muted champion-footnote">Open a champion for its full breakdown.</p>
</template>

<style scoped>
.champion-list {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.champion-list > li { min-width: 0; }

.champion {
  position: relative;
  display: grid;
  grid-template-columns: 18px 42px minmax(0, 1fr) 52px;
  align-items: center;
  gap: var(--ui-space-2);
  width: 100%;
  padding: var(--ui-space-2);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ui-accent) 13%, transparent);
  border-radius: var(--ui-radius-sm);
  background: linear-gradient(
    105deg,
    color-mix(in srgb, var(--ui-sidebar) 88%, transparent),
    color-mix(in srgb, var(--ui-canvas) 54%, transparent)
  );
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: var(--ui-text-support);
  text-align: left;
  transition:
    border-color var(--instrument-motion-fast) ease,
    background var(--instrument-motion-fast) ease;
}

.champion:hover {
  border-color: var(--ui-border-emphasis);
  background: linear-gradient(
    105deg,
    color-mix(in srgb, var(--ui-surface-hover) 38%, transparent),
    color-mix(in srgb, var(--ui-sidebar) 80%, transparent)
  );
}

.champion:hover .champion-name { color: var(--ui-accent); }

.champion-name {
  display: block;
  overflow: hidden;
  color: var(--ui-text);
  font-family: var(--ui-font-heading);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.champion-intro,
.champion-footnote { font-size: var(--ui-text-micro); }

.champion-intro {
  max-width: 66ch;
  margin: 0 0 var(--ui-space-3);
}

.champion-footnote {
  margin: var(--ui-space-3) 0 0;
  text-align: right;
}

.champion-rank {
  color: var(--ui-text-heading);
  font-size: var(--ui-text-body);
  text-align: center;
}

.champion-copy { min-width: 0; }

.champion-evidence {
  display: block;
  margin-top: 2px;
  font-size: var(--ui-text-label);
}

.champion-stats {
  display: grid;
  grid-column: 3 / -1;
  grid-template-columns: repeat(3, minmax(54px, 1fr));
  gap: var(--ui-space-1);
}

.champion-grade {
  grid-column: 4;
  grid-row: 1;
  justify-self: end;
}

.champion-stats > span {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  padding-right: var(--ui-space-2);
  border-right: 1px solid var(--ui-border);
}

.champion-stats strong {
  color: var(--ui-text);
  font-size: var(--ui-text-support);
}

.champion-stats strong.win-text { color: var(--ui-live); }
.champion-stats strong.loss-text { color: var(--ui-negative); }

.champion-stats small {
  color: var(--ui-text-muted);
  font-size: var(--ui-text-micro);
  letter-spacing: .5px;
  text-transform: uppercase;
}

.portrait {
  width: 42px;
  height: 42px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  object-fit: cover;
}

@container (min-width: 650px) {
  .champion {
    grid-template-columns: 18px 42px minmax(84px, 1fr) minmax(168px, 1.2fr) 54px;
  }

  .champion-stats,
  .champion-grade {
    grid-column: auto;
    grid-row: auto;
  }
}

@container (max-width: 430px) {
  .champion { grid-template-columns: 18px 36px minmax(0, 1fr) 44px; }
  .portrait { width: 36px; height: 36px; }
  .champion-stats { grid-column: 1 / -1; }
}
</style>
