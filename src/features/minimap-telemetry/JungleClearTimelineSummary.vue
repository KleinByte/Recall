<script setup lang="ts">
import { computed } from "vue"
import { campClearName } from "../../helpers/unified-playback"
import {
  deriveInitialJungleClear,
  FULL_CLEAR_CAMP_COUNT,
} from "../../shared/minimap/jungle-clear"
import type { CampClearEvent } from "../../shared/minimap/contracts"
import type { MinimapPathingReview } from "../../shared/minimap/review"

const props = defineProps<{
  review?: MinimapPathingReview
  timestamp: number
  loading?: boolean
  error?: string
}>()

const emit = defineEmits<{
  seek: [timestamp: number]
}>()

const initialClear = computed(() => deriveInitialJungleClear(
  props.review?.campClears ?? [],
))
const route = computed(() => initialClear.value.camps
  .map((clear) => campClearName(clear.campKey))
  .join(" → "))

function formatTime(milliseconds: number, tenths = false) {
  const totalSeconds = Math.max(0, milliseconds) / 1_000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = tenths
    ? (totalSeconds % 60).toFixed(1).padStart(4, "0")
    : String(Math.floor(totalSeconds % 60)).padStart(2, "0")
  return `${minutes}:${seconds}`
}

function sourceLabel(source: CampClearEvent["source"]) {
  if (source === "minimap_cv") return "Minimap CV"
  if (source === "live_client_inference") return "Live Client + position"
  return "Manual"
}

function splitTitle(clear: CampClearEvent, index: number) {
  return `Seek playback to split ${index + 1}, ${campClearName(clear.campKey)} at ${formatTime(clear.clearedAtMs, true)}`
}
</script>

<template>
  <section class="jungle-timeline-summary" aria-label="Jungle clear timeline summary">
    <header>
      <div>
        <span>Jungle clear</span>
        <h4>Your first clear</h4>
      </div>
      <small v-if="loading">Refreshing…</small>
      <small v-else-if="initialClear.camps.length">
        {{ initialClear.camps.length }} / {{ FULL_CLEAR_CAMP_COUNT }} camps
      </small>
    </header>

    <p v-if="loading && !review" class="status">Loading minimap evidence…</p>
    <p v-else-if="error && !review" class="status error">{{ error }}</p>
    <p v-else-if="initialClear.camps.length === 0" class="status">
      No local first-clear camps met the evidence threshold for this match.
    </p>

    <template v-else>
      <div class="clear-facts">
        <article :class="{ complete: initialClear.complete }">
          <span>First clear</span>
          <strong>
            {{ initialClear.clearTimeMs === undefined
              ? 'Incomplete'
              : formatTime(initialClear.clearTimeMs, true) }}
          </strong>
          <small>{{ initialClear.camps.length }} unique camps before 8:00</small>
        </article>
        <article>
          <span>Evidence</span>
          <strong>
            {{ initialClear.confidence === undefined
              ? '—'
              : `${Math.round(initialClear.confidence * 100)}%` }}
          </strong>
          <small>Combined source and attribution confidence</small>
        </article>
        <article class="route">
          <span>Route</span>
          <strong>{{ route }}</strong>
        </article>
      </div>

      <div class="clear-splits" aria-label="First clear camp splits">
        <button
          v-for="(clear, index) in initialClear.camps"
          :key="`${clear.campKey}:${clear.clearedAtMs}:${index}`"
          type="button"
          :class="{
            reached: clear.clearedAtMs <= timestamp,
            active: Math.abs(clear.clearedAtMs - timestamp) < 500,
          }"
          :title="splitTitle(clear, index)"
          :aria-label="splitTitle(clear, index)"
          @click="emit('seek', clear.clearedAtMs)"
        >
          <b>{{ clear.routeIndex === undefined ? index + 1 : clear.routeIndex + 1 }}</b>
          <span>
            <strong>{{ campClearName(clear.campKey) }}</strong>
            <small>{{ sourceLabel(clear.source) }} · {{ Math.round(Math.min(clear.sourceConfidence, clear.attributionConfidence) * 100) }}%</small>
          </span>
          <time>{{ formatTime(clear.clearedAtMs, true) }}</time>
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.jungle-timeline-summary {
  display: grid;
  gap: 10px;
  min-width: 0;
  margin-top: 10px;
  padding: 11px;
  border: 1px solid color-mix(in srgb, #69d8c5 28%, var(--ui-border));
  border-radius: var(--ui-radius-md);
  background: color-mix(in srgb, #69d8c5 4%, var(--ui-surface-panel-quiet));
}

header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 10px;
}

header > div { min-width: 0; }
header span,
.clear-facts span {
  color: var(--ui-text-muted);
  font-size: var(--ui-text-micro);
  letter-spacing: .65px;
  text-transform: uppercase;
}

h4 {
  margin: 2px 0 0;
  color: var(--ui-text-heading);
  font: 14px var(--ui-font-heading);
}

header > small {
  flex: 0 0 auto;
  color: #69d8c5;
  font-size: var(--ui-text-label);
}

.status {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: var(--ui-text-label);
  line-height: 1.45;
}

.status.error { color: var(--ui-warning); }

.clear-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: rgb(3 10 16 / 32%);
}

.clear-facts article {
  display: grid;
  align-content: start;
  gap: 2px;
  min-width: 0;
  padding: 8px 9px;
  border-left: 1px solid var(--ui-border);
}

.clear-facts article:first-child { border-left: 0; }
.clear-facts article.route {
  grid-column: 1 / -1;
  border-top: 1px solid var(--ui-border);
  border-left: 0;
}
.clear-facts strong {
  color: var(--ui-text-heading);
  font-size: var(--ui-text-label);
  line-height: 1.35;
}
.clear-facts article.complete > strong { color: var(--ui-positive); }
.clear-facts small { color: var(--ui-text-muted); font-size: var(--ui-text-micro); line-height: 1.35; }
.clear-facts .route strong { overflow-wrap: anywhere; }

.clear-splits {
  display: grid;
  gap: 5px;
}

.clear-splits button {
  display: grid;
  grid-template-columns: 25px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 6px 7px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-xs);
  background: rgb(3 10 16 / 38%);
  color: var(--ui-text-subtle);
  text-align: left;
  cursor: pointer;
}

.clear-splits button:hover,
.clear-splits button:focus-visible,
.clear-splits button.active {
  border-color: var(--ui-accent);
  outline: none;
}

.clear-splits button.reached { background: color-mix(in srgb, #69d8c5 7%, rgb(3 10 16 / 38%)); }
.clear-splits button > b {
  display: grid;
  place-items: center;
  width: 25px;
  height: 25px;
  border-radius: 50%;
  background: color-mix(in srgb, #69d8c5 28%, var(--ui-surface-panel-quiet));
  color: #9debdc;
  font: var(--ui-text-label) var(--ui-font-heading);
}
.clear-splits button.reached > b { background: #69d8c5; color: #041215; }
.clear-splits button > span { display: grid; min-width: 0; }
.clear-splits button > span > strong { color: var(--ui-text-heading); font-size: var(--ui-text-label); }
.clear-splits button > span > small { color: var(--ui-text-muted); font-size: var(--ui-text-micro); line-height: 1.35; }
.clear-splits time {
  color: var(--ui-text-subtle);
  font: var(--ui-text-label) var(--ui-font-heading);
  font-variant-numeric: tabular-nums;
}
</style>
