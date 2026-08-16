<script setup lang="ts">
import { computed } from "vue"
import GradeBadge from "./GradeBadge.vue"
import Button from "./ui/Button.vue"
import Surface from "./ui/Surface.vue"
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
  <Surface
    as="section"
    variant="raised"
    padding="compact"
    class="banner"
    :class="match.win ? 'win' : 'loss'"
  >
    <img :src="championIconUrl(match.championId)" :alt="champion" class="portrait" />

    <div class="body">
      <div class="headline">
        <strong>{{ match.win ? "Victory" : "Defeat" }}</strong>
        <span class="match-meta">
          {{ match.queueName ?? modeLabel(match.mode) }} ·
          {{ formatDuration(match.durationSecs) }}
        </span>
      </div>
      <div class="match-detail">
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

    <GradeBadge :grade="match.grade" :status="match.gradeStatus" size="lg" />
    <Button class="review" variant="primary" size="compact" @click="emit('review', match.gameId)">
      Review game
    </Button>

    <Button
      class="close"
      variant="ghost"
      size="compact"
      icon-only
      title="Dismiss"
      aria-label="Dismiss post-game summary"
      @click="emit('dismiss')"
    >
      ×
    </Button>
  </Surface>
</template>

<style scoped>
.banner {
  display: flex;
  align-items: center;
  gap: var(--ui-space-3);
  margin-bottom: var(--ui-space-4);
  border-left-width: 3px;
}

.banner.win {
  border-left-color: var(--ui-positive);
}

.banner.loss {
  border-left-color: var(--ui-negative);
}

.portrait {
  width: 40px;
  height: 40px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  object-fit: cover;
}

.body {
  flex: 1;
  min-width: 0;
}

.record-callout {
  min-width: min(370px, 34vw);
  padding: 7px 10px;
  border: 1px solid color-mix(in srgb, var(--ui-accent) 55%, transparent);
  border-radius: var(--ui-radius-sm);
  background: linear-gradient(
    120deg,
    color-mix(in srgb, var(--ui-accent) 14%, transparent),
    color-mix(in srgb, var(--ui-live) 6%, transparent)
  );
  box-shadow: 0 0 18px color-mix(in srgb, var(--ui-accent) 8%, transparent);
  animation: record-arrival 520ms ease-out both;
}

.record-title {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-text-heading);
  font: 12px var(--ui-font-heading);
  letter-spacing: .65px;
  text-transform: uppercase;
}

.record-rune {
  color: var(--ui-live);
  text-shadow: 0 0 10px color-mix(in srgb, var(--ui-live) 70%, transparent);
}

.record-list {
  display: flex;
  gap: 4px 10px;
  flex-wrap: wrap;
  margin-top: 4px;
  color: var(--ui-text-subtle);
  font-size: 12px;
}

.record-list span:not(:last-child)::after {
  content: " ·";
  color: var(--ui-text-muted);
}

.record-list .more { color: var(--ui-text-heading); }

@keyframes record-arrival {
  from { opacity: 0; transform: translateY(6px) scale(.98); filter: brightness(1.7); }
  to { opacity: 1; transform: none; filter: none; }
}

.headline {
  display: flex;
  align-items: baseline;
  gap: var(--ui-space-2);
  font-size: 14px;
}

.headline strong {
  color: var(--ui-text-heading);
  font-family: var(--ui-font-heading);
  font-weight: 500;
  letter-spacing: 0.6px;
}

.match-meta,
.match-detail {
  color: var(--ui-text-subtle);
  font-size: 12px;
}

.match-detail {
  margin-top: 2px;
}

.close {
  font-size: 20px;
  line-height: 1;
}

.review {
  white-space: nowrap;
}

@container recall-content (max-width: 880px) {
  .banner { flex-wrap: wrap; }
  .record-callout { order: 3; width: 100%; min-width: 0; }
}

@container recall-content (max-width: 560px) {
  .banner { align-items: flex-start; }
  .body { flex-basis: calc(100% - 64px); }
  .headline { align-items: flex-start; flex-direction: column; gap: 1px; }
  .review { flex: 1 1 140px; }
}

@media (prefers-reduced-motion: reduce) {
  .record-callout { animation: none; }
}
</style>
