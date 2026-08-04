<script setup lang="ts">
import { computed, ref } from "vue"
import { CHART_COLOURS } from "../charts/recall-chart-theme"
import {
  reviewWinProbability,
  winProbabilityLabel,
} from "../helpers/review-win-probability"
import type { TimelineSummary } from "../types/review"

const props = defineProps<{ summary: TimelineSummary }>()
const inspectedIndex = ref<number>()
const points = computed(() => reviewWinProbability(props.summary))
const maximumTime = computed(() => Math.max(1, points.value.at(-1)?.timestamp ?? 1))
const x = (timestamp: number) => timestamp / maximumTime.value * 100
const line = computed(() => points.value.map((point) => `${x(point.timestamp)},${100 - point.blue}`).join(" "))
const inspected = computed(() => inspectedIndex.value === undefined ? undefined : points.value[inspectedIndex.value])
const final = computed(() => points.value.at(-1))

function inspect(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const timestamp = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * maximumTime.value
  let best = 0
  points.value.forEach((point, index) => {
    if (Math.abs(point.timestamp - timestamp) < Math.abs(points.value[best].timestamp - timestamp)) best = index
  })
  inspectedIndex.value = best
}

function move(direction: number) {
  const current = inspectedIndex.value ?? points.value.length - 1
  inspectedIndex.value = Math.max(0, Math.min(points.value.length - 1, current + direction))
}

const time = (timestamp: number) =>
  `${Math.floor(timestamp / 60_000)}:${String(Math.floor(timestamp / 1_000) % 60).padStart(2, "0")}`
</script>

<template>
  <section class="probability-panel">
    <header>
      <div>
        <span class="eyebrow">Retrospective estimate</span>
        <h2>Win probability</h2>
        <p>Uses only gold, kills, objectives, and match time known at each snapshot.</p>
      </div>
      <div v-if="final" class="final-reading">
        <span>Final model reading</span>
        <strong>{{ final.blue }}% Blue</strong>
        <small>{{ winProbabilityLabel(final.blue) }}</small>
      </div>
    </header>

    <div
      v-if="points.length"
      class="probability-chart"
      tabindex="0"
      aria-label="Interactive retrospective win probability chart. Use left and right arrow keys to inspect snapshots."
      @pointermove="inspect"
      @pointerleave="inspectedIndex = undefined"
      @focus="inspectedIndex ??= points.length - 1"
      @keydown.left.prevent="move(-1)"
      @keydown.right.prevent="move(1)"
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="probability-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" :stop-color="CHART_COLOURS.teamBlue" stop-opacity=".28" />
            <stop offset="1" :stop-color="CHART_COLOURS.teamBlue" stop-opacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1="25" x2="100" y2="25" />
        <line class="even-line" x1="0" y1="50" x2="100" y2="50" />
        <line x1="0" y1="75" x2="100" y2="75" />
        <polygon :points="`0,100 ${line} 100,100`" fill="url(#probability-fill)" />
        <polyline :points="line" />
      </svg>
      <span class="axis blue">Blue 100%</span>
      <span class="axis even">Even</span>
      <span class="axis red">Red 100%</span>
      <template v-if="inspected">
        <span class="crosshair" :style="{ left: `${x(inspected.timestamp)}%` }" />
        <span class="point" :style="{ left: `${x(inspected.timestamp)}%`, top: `${100 - inspected.blue}%` }" />
        <output class="tooltip" :class="{ flip: x(inspected.timestamp) > 68 }" :style="{ left: `${x(inspected.timestamp)}%` }">
          <strong>{{ time(inspected.timestamp) }}</strong>
          <span class="blue-copy">Blue {{ inspected.blue }}%</span>
          <span class="red-copy">Red {{ inspected.red }}%</span>
          <small>{{ Math.abs(inspected.goldDifference).toLocaleString() }}g {{ inspected.goldDifference >= 0 ? "Blue" : "Red" }} lead · {{ Math.abs(inspected.killDifference) }} kill gap</small>
        </output>
      </template>
      <span class="time start">0:00</span>
      <span class="time end">{{ time(maximumTime) }}</span>
    </div>
    <p v-else class="empty">Timeline snapshots are required to estimate win probability.</p>

    <footer>
      <span><i class="blue-dot" />Blue probability</span>
      <span><i class="red-dot" />Red is the remaining probability</span>
      <small>Estimate, not a prediction guarantee</small>
    </footer>
  </section>
</template>

<style scoped>
.probability-panel {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface-panel);
  box-shadow: var(--ui-shadow-panel);
}
.probability-panel > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--ui-divider);
}
.eyebrow { color: var(--ui-accent); font-size: 11px; letter-spacing: .8px; text-transform: uppercase; }
.probability-panel h2 { margin: 3px 0 2px; color: var(--ui-text-heading); font: 18px var(--ui-font-heading); }
.probability-panel header p { margin: 0; color: var(--ui-text-muted); font-size: 12px; }
.final-reading { display: flex; flex-direction: column; align-items: flex-end; }
.final-reading span { color: var(--ui-text-muted); font-size: 10px; text-transform: uppercase; }
.final-reading strong { color: var(--ui-team-blue); font: 22px var(--ui-font-display); }
.final-reading small { color: var(--ui-text-subtle); font-size: 11px; }
.probability-chart {
  position: relative;
  height: 360px;
  overflow: hidden;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--ui-team-blue) 20%, transparent),
    transparent 49%,
    color-mix(in srgb, var(--ui-team-red) 18%, transparent)
  );
}
.probability-chart:focus-visible { outline: 2px solid var(--ui-focus-ring); outline-offset: -2px; }
.probability-chart svg { width: 100%; height: 100%; }
.probability-chart svg line { stroke: var(--ui-border-emphasis); stroke-width: .35; stroke-dasharray: 2 2; }
.probability-chart svg .even-line { stroke: color-mix(in srgb, var(--ui-accent) 45%, transparent); }
.probability-chart svg polyline {
  fill: none;
  stroke: var(--ui-team-blue);
  stroke-width: 2.1;
  vector-effect: non-scaling-stroke;
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--ui-team-blue) 42%, transparent));
}
.axis { position: absolute; left: 8px; z-index: 1; color: var(--ui-text-muted); font-size: 10px; pointer-events: none; }
.axis.blue { top: 7px; color: var(--ui-team-blue); }
.axis.even { top: 50%; transform: translateY(-50%); }
.axis.red { bottom: 7px; color: var(--ui-team-red); }
.time { position: absolute; bottom: 7px; color: var(--ui-text-muted); font-size: 10px; }
.time.start { left: 8px; }
.time.end { right: 8px; }
.crosshair { position: absolute; top: 0; bottom: 0; width: 1px; background: color-mix(in srgb, var(--ui-text) 45%, transparent); pointer-events: none; }
.point {
  position: absolute;
  width: 10px;
  height: 10px;
  transform: translate(-50%,-50%);
  border: 2px solid var(--ui-canvas);
  border-radius: 50%;
  background: var(--ui-team-blue);
  box-shadow: 0 0 9px color-mix(in srgb, var(--ui-team-blue) 60%, transparent);
  pointer-events: none;
}
.tooltip {
  position: absolute;
  z-index: 3;
  top: 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 170px;
  padding: 9px 10px;
  transform: translateX(9px);
  border: 1px solid var(--ui-border-emphasis);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-overlay);
  box-shadow: var(--ui-shadow-raised);
  color: var(--ui-text-subtle);
  font-size: 11px;
  pointer-events: none;
}
.tooltip.flip { transform: translateX(calc(-100% - 9px)); }
.tooltip strong { color: var(--ui-text-heading); }
.blue-copy { color: var(--ui-team-blue); }
.red-copy { color: var(--ui-team-red); }
.tooltip small { color: var(--ui-text-muted); }
.probability-panel > footer {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 9px 14px;
  border-top: 1px solid var(--ui-divider);
  color: var(--ui-text-subtle);
  font-size: 11px;
}
.probability-panel footer span { display: inline-flex; align-items: center; gap: 5px; }
.probability-panel footer i { width: 8px; height: 8px; border-radius: 50%; }
.blue-dot { background: var(--ui-team-blue); }
.red-dot { background: var(--ui-team-red); }
.probability-panel footer small { margin-left: auto; color: var(--ui-text-muted); }
.empty { padding: 50px 18px; color: var(--ui-text-muted); text-align: center; }
</style>
