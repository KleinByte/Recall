<script setup lang="ts">
import { computed } from "vue"
import GradeBadge from "./GradeBadge.vue"
import {
  championIconUrl,
  championNameById,
  formatDuration,
  modeLabel,
} from "../helpers/format"
import type { Champion } from "../types/lol"
import type { MatchRow } from "../types/stats"

const props = defineProps<{
  match: MatchRow
  champions: Champion[] | null
}>()

const emit = defineEmits<{ (event: "dismiss"): void }>()

const champion = computed(() =>
  championNameById(props.champions, props.match.championId),
)

const kda = computed(
  () => `${props.match.kills}/${props.match.deaths}/${props.match.assists}`,
)
</script>

<template>
  <div class="banner" :class="match.win ? 'win' : 'loss'">
    <img :src="championIconUrl(match.championId)" :alt="champion" class="portrait" />

    <div class="body">
      <div class="headline">
        <strong>{{ match.win ? "Victory" : "Defeat" }}</strong>
        <span class="muted">
          {{ match.queueName ?? modeLabel(match.mode) }} ·
          {{ formatDuration(match.durationSecs) }}
        </span>
      </div>
      <div class="muted detail">
        {{ champion }} · {{ kda }} · {{ match.totalMinionsKilled }} CS
      </div>
    </div>

    <GradeBadge :grade="match.grade" size="lg" />

    <button class="close" title="Dismiss" @click="emit('dismiss')">×</button>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-4);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-left-width: 3px;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
}

.banner.win {
  border-left-color: var(--win);
}

.banner.loss {
  border-left-color: var(--loss);
}

.portrait {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

.body {
  flex: 1;
  min-width: 0;
}

.headline {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-size: 14px;
}

.headline strong {
  font-family: var(--font-heading);
  font-weight: 500;
  letter-spacing: 0.6px;
  color: var(--gold-bright);
}

.headline .muted,
.detail {
  font-size: 12px;
}

.detail {
  margin-top: 2px;
}

.close {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 0 var(--space-1);
}

.close:hover {
  color: var(--text-primary);
}
</style>
