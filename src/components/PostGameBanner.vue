<script setup lang="ts">
import { computed } from "vue"
import GradeBadge from "./GradeBadge.vue"
import {
  championIconUrl,
  championNameById,
  formatDuration,
  formatRecordValue,
  modeLabel,
} from "../helpers/format"
import type { Champion } from "../types/lol"
import type { MatchRow, PersonalRecord } from "../types/stats"

const props = defineProps<{
  match: MatchRow
  records: PersonalRecord[]
  champions: Champion[] | null
}>()

const emit = defineEmits<{
  (event: "dismiss"): void
  (event: "review", gameId: number): void
}>()

const champion = computed(() =>
  championNameById(props.champions, props.match.championId),
)

const kda = computed(
  () => `${props.match.kills}/${props.match.deaths}/${props.match.assists}`,
)
const visibleRecords = computed(() => props.records.slice(0, 3))
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

    <div v-if="records.length" class="record-callout" aria-live="polite">
      <div class="record-title">
        <span class="record-rune" aria-hidden="true">◆</span>
        <strong>{{ records.length }} new personal {{ records.length === 1 ? "record" : "records" }}</strong>
      </div>
      <div class="record-list">
        <span v-for="record in visibleRecords" :key="record.key">
          {{ record.label }} · {{ formatRecordValue(record) }}
        </span>
        <span v-if="records.length > visibleRecords.length" class="more">
          +{{ records.length - visibleRecords.length }} more
        </span>
      </div>
    </div>

    <GradeBadge :grade="match.grade" size="lg" />
    <button class="league-button review" @click="emit('review', match.gameId)">
      Review game
    </button>

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

.record-callout {
  min-width: min(370px, 34vw);
  padding: 7px 10px;
  border: 1px solid color-mix(in srgb, var(--gold) 55%, transparent);
  border-radius: var(--radius-sm);
  background: linear-gradient(120deg, rgba(200, 170, 109, .14), rgba(10, 200, 220, .06));
  box-shadow: 0 0 18px rgba(200, 170, 109, .08);
  animation: record-arrival 520ms ease-out both;
}

.record-title {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--gold-bright);
  font: 10px var(--font-heading);
  letter-spacing: .65px;
  text-transform: uppercase;
}

.record-rune {
  color: var(--cyan);
  text-shadow: 0 0 10px rgba(10, 200, 220, .7);
}

.record-list {
  display: flex;
  gap: 4px 10px;
  flex-wrap: wrap;
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 10px;
}

.record-list span:not(:last-child)::after {
  content: " ·";
  color: var(--text-muted);
}

.record-list .more { color: var(--gold-bright); }

@keyframes record-arrival {
  from { opacity: 0; transform: translateY(6px) scale(.98); filter: brightness(1.7); }
  to { opacity: 1; transform: none; filter: none; }
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

.review {
  padding: var(--space-2) var(--space-3);
  white-space: nowrap;
}

@media (max-width: 1050px) {
  .banner { flex-wrap: wrap; }
  .record-callout { order: 3; width: 100%; min-width: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .record-callout { animation: none; }
}
</style>
