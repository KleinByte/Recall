<script setup lang="ts">
import { computed } from "vue"
import type { EChartsCoreOption } from "echarts/core"
import BaseEChart from "./charts/BaseEChart.vue"

const props = defineProps<{
  score: number
  label: string
  direction: "up" | "steady" | "down"
}>()

const value = computed(() => Math.max(0, Math.min(100, props.score)))
const directionLabel = computed(() => props.direction === "up"
  ? "Lead building"
  : props.direction === "down"
    ? "Lead slipping"
    : "Pace stable")
const gaugeColor = computed(() => {
  if (value.value >= 68) return "#39d8b0"
  if (value.value >= 52) return "#41b9d7"
  if (value.value >= 38) return "#d7a740"
  return "#e05a68"
})
const style = computed(() => ({
  "--tempo-angle": `${160 + value.value * 2.2}deg`,
  "--tempo-color": gaugeColor.value,
}))

const option = computed<EChartsCoreOption>(() => ({
  series: [{
    type: "gauge",
    min: 0,
    max: 100,
    startAngle: 200,
    endAngle: -20,
    center: ["50%", "60%"],
    radius: "90%",
    splitNumber: 10,
    pointer: { show: false },
    anchor: { show: false },
    axisLine: {
      roundCap: false,
      lineStyle: {
        width: 8,
        color: [
          [.28, "#7b1c34"],
          [.46, "#d16849"],
          [.62, "#287fa0"],
          [.82, "#30b6aa"],
          [1, "#d6b04c"],
        ],
      },
    },
    axisTick: {
      distance: -15,
      splitNumber: 1,
      length: 4,
      lineStyle: { color: "rgba(212, 226, 235, .32)", width: 1 },
    },
    splitLine: {
      distance: -17,
      length: 8,
      lineStyle: { color: "rgba(216, 194, 126, .7)", width: 1 },
    },
    axisLabel: { show: false },
    title: { show: false },
    detail: { show: false },
    data: [{ value: Math.max(1, value.value) }],
  }],
}))
</script>

<template>
  <div class="tempo-gauge" :class="direction" :style="style">
    <div class="velocity-ring" aria-hidden="true" />
    <svg class="tempo-frame" viewBox="0 0 300 160" aria-hidden="true">
      <path class="outer" d="M43 126A112 112 0 0 1 257 126" />
      <path class="inner" d="M66 122A89 89 0 0 1 234 122" />
      <path class="left-cut" d="M40 127L57 127L68 143L49 139Z" />
      <path class="right-cut" d="M260 127L243 127L232 143L251 139Z" />
      <path class="tempo-mark" d="M150 3L159 14L153 26H147L141 14Z" />
    </svg>
    <BaseEChart
      class="tempo-chart"
      :option="option"
      height="160px"
      :ariaLabel="`Tempo ${score} out of 100, ${label}, ${directionLabel}`"
    />
    <span class="tempo-needle" aria-hidden="true"><i /></span>
    <span class="tempo-cap" aria-hidden="true" />
    <div class="tempo-readout">
      <span class="tempo-word">Tempo</span>
      <strong>{{ score }}</strong>
      <span class="tempo-label">{{ label }}</span>
      <small><b>{{ direction === "up" ? "↗" : direction === "down" ? "↘" : "→" }}</b> {{ directionLabel }}</small>
    </div>
  </div>
</template>

<style scoped>
.tempo-gauge {
  position: relative;
  width: min(100%, 310px);
  height: 160px;
  margin: -5px auto 0;
  isolation: isolate;
  background: radial-gradient(ellipse 52% 55% at 50% 63%, color-mix(in srgb, var(--tempo-color) 14%, transparent), transparent 68%);
}
.tempo-chart { position: relative; z-index: 1; }
.tempo-frame { position: absolute; z-index: 2; inset: 0; width: 100%; height: 160px; overflow: visible; pointer-events: none; }
.tempo-frame .outer, .tempo-frame .inner { fill: none; stroke: #8a7442; stroke-linecap: square; filter: drop-shadow(0 0 3px rgba(50, 188, 205, .2)); }
.tempo-frame .outer { stroke-width: 1.2; }.tempo-frame .inner { stroke-width: .7; opacity: .52; }
.left-cut, .right-cut, .tempo-mark { fill: #081623; stroke: #b79850; stroke-width: 1.1; }
.tempo-mark { fill: color-mix(in srgb, var(--tempo-color) 48%, #081623); filter: drop-shadow(0 0 5px var(--tempo-color)); }
.tempo-needle { position: absolute; z-index: 4; top: calc(60% - 2px); left: 50%; width: 72px; height: 4px; transform: rotate(var(--tempo-angle)); transform-origin: 0 50%; transition: transform .5s cubic-bezier(.18, .78, .3, 1); filter: drop-shadow(0 0 5px var(--tempo-color)); }
.tempo-needle::before { content: ""; position: absolute; inset: -3px -7px -3px 0; clip-path: polygon(0 35%, 78% 35%, 100% 50%, 78% 65%, 0 65%); background: #d9c37a; }
.tempo-needle i { position: absolute; z-index: 1; inset: 0 5px 0 6px; background: var(--tempo-color); }
.tempo-cap { position: absolute; z-index: 5; top: 60%; left: 50%; width: 16px; height: 16px; transform: translate(-50%, -50%) rotate(45deg); border: 2px solid #c6a85a; background: #07131e; box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--tempo-color) 55%, #07131e), 0 0 9px color-mix(in srgb, var(--tempo-color) 60%, transparent); }
.tempo-readout { position: absolute; z-index: 3; inset: auto 0 1px; display: grid; justify-items: center; line-height: 1; pointer-events: none; }
.tempo-word { color: var(--text-muted); font: 8px var(--font-heading); letter-spacing: 2px; text-transform: uppercase; }
.tempo-readout strong { margin-top: 2px; color: var(--tempo-color); font: 27px var(--font-display); text-shadow: 0 0 13px color-mix(in srgb, var(--tempo-color) 45%, transparent); }
.tempo-label { margin-top: 2px; color: var(--gold-bright); font: 10px var(--font-heading); letter-spacing: 1px; text-transform: uppercase; }
.tempo-readout small { margin-top: 4px; color: var(--text-muted); font-size: 9px; }.tempo-readout small b { color: var(--tempo-color); font-size: 12px; }
.velocity-ring { position: absolute; z-index: 0; inset: 13px 32px 8px; border-radius: 50%; opacity: .42; background: repeating-conic-gradient(from 232deg, var(--tempo-color) 0 1deg, transparent 1deg 8deg); mask: radial-gradient(ellipse, transparent 0 67%, #000 69% 72%, transparent 74%); }
.up .velocity-ring { animation: tempo-spin 8s linear infinite; }.down .velocity-ring { animation: tempo-spin-reverse 11s linear infinite; opacity: .3; }
@keyframes tempo-spin { to { transform: rotate(360deg); } }
@keyframes tempo-spin-reverse { to { transform: rotate(-360deg); } }
@media (prefers-reduced-motion: reduce) { .tempo-needle { transition: none; }.velocity-ring { animation: none !important; } }
</style>
