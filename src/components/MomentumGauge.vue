<script setup lang="ts">
import { computed } from "vue"
import type { EChartsCoreOption } from "echarts/core"
import BaseEChart from "./charts/BaseEChart.vue"

const props = defineProps<{
  score: number
  label: string
  streak: number
  overdriveTier?: "gold" | "emerald" | "diamond" | "master"
}>()

type GradientKey = readonly [position: number, color: string]

function rgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255] as const
}

function blend(from: string, to: string, amount: number) {
  const start = rgb(from)
  const end = rgb(to)
  const channel = (index: number) => Math.round(start[index] + (end[index] - start[index]) * amount)
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`
}

function gradientStops(keys: readonly GradientKey[], resolution = 24) {
  const stops: Array<[number, string]> = []
  for (let index = 0; index < keys.length - 1; index += 1) {
    const [startAt, startColor] = keys[index]
    const [endAt, endColor] = keys[index + 1]
    for (let step = 1; step <= resolution; step += 1) {
      const amount = step / resolution
      stops.push([
        startAt + (endAt - startAt) * amount,
        blend(startColor, endColor, amount),
      ])
    }
  }
  return stops
}

const standardArc = gradientStops([
  [0, "#4a0717"],
  [.18, "#8f1428"],
  [.34, "#d2494d"],
  [.51, "#17608f"],
  [.66, "#159194"],
  [.8, "#18a66e"],
  [.91, "#9c8130"],
  [1, "#e7bd55"],
], 18)

const value = computed(() => Math.max(0, Math.min(100, props.score)))
const derivedTier = computed(() => {
  if (value.value < 100 || props.streak < 3) return undefined
  if (props.streak >= 6) return "master"
  if (props.streak === 5) return "diamond"
  if (props.streak === 4) return "emerald"
  return "gold"
})
const tier = computed(() => props.overdriveTier ?? derivedTier.value)
const overdrive = computed(() => value.value >= 100 && tier.value !== undefined)
const tierPalette = computed(() => {
  switch (tier.value) {
    case "master": return {
      color: "#9254d6", bright: "#e0a4ff", shadow: "rgba(158, 79, 232, .96)", speed: ".52s",
      gradient: gradientStops([[0, "#411568"], [.22, "#bc76ef"], [.5, "#7434b5"], [.78, "#e0a4ff"], [1, "#42146b"]]),
    }
    case "diamond": return {
      color: "#1ea9d6", bright: "#8ceaff", shadow: "rgba(38, 190, 235, .96)", speed: ".66s",
      gradient: gradientStops([[0, "#07526f"], [.22, "#8ceaff"], [.5, "#148bb7"], [.78, "#68d8f5"], [1, "#064663"]]),
    }
    case "emerald": return {
      color: "#0fa76f", bright: "#67ecb5", shadow: "rgba(31, 196, 132, .94)", speed: ".8s",
      gradient: gradientStops([[0, "#07563c"], [.22, "#67ecb5"], [.5, "#0b8a5d"], [.78, "#45d99d"], [1, "#064b35"]]),
    }
    default: return {
      color: "#d3a238", bright: "#ffe08a", shadow: "rgba(255, 181, 47, .95)", speed: "1.05s",
      gradient: gradientStops([[0, "#795015"], [.22, "#ffe08a"], [.5, "#b9821e"], [.78, "#f5c557"], [1, "#70450f"]]),
    }
  }
})
const gaugeColor = computed(() => {
  if (value.value >= 80) return "#c89b3c"
  if (value.value >= 60) return "#16a36f"
  if (value.value >= 40) return "#087ea4"
  if (value.value >= 20) return "#c53f48"
  return "#7a1028"
})
const gaugeStyle = computed(() => ({
  "--needle-angle": `${150 + value.value * 2.4}deg`,
  "--gauge-color": overdrive.value ? tierPalette.value.bright : gaugeColor.value,
  "--tier-color": tierPalette.value.color,
  "--tier-bright": tierPalette.value.bright,
  "--tier-shadow": tierPalette.value.shadow,
  "--fire-speed": tierPalette.value.speed,
}))
const gaugeClass = computed(() => [
  { overdrive: overdrive.value },
  overdrive.value ? `tier-${tier.value}` : "",
  overdrive.value && props.streak >= 6
    ? "shake-hard"
    : overdrive.value && props.streak === 5
      ? "shake-medium"
      : overdrive.value && props.streak === 4
        ? "shake-soft"
        : "",
])

const option = computed<EChartsCoreOption>(() => ({
  series: [{
    type: "gauge",
    min: 0,
    max: 100,
    startAngle: 210,
    endAngle: -30,
    center: ["50%", "58%"],
    radius: "92%",
    splitNumber: 5,
    pointer: { show: false },
    anchor: { show: false },
    axisLine: {
      roundCap: true,
      lineStyle: {
        width: 10,
        color: overdrive.value ? tierPalette.value.gradient : standardArc,
        shadowBlur: overdrive.value ? 18 : 0,
        shadowColor: overdrive.value ? tierPalette.value.shadow : "transparent",
      },
    },
    axisTick: {
      distance: -16,
      splitNumber: 2,
      length: 3,
      lineStyle: { color: "rgba(240, 230, 210, .35)", width: 1 },
    },
    splitLine: {
      distance: -18,
      length: 7,
      lineStyle: { color: "#c8aa6d", width: 1 },
    },
    axisLabel: {
      distance: 17,
      color: "#6b819c",
      fontSize: 8,
      formatter: (tick: number) => tick === 0 || tick === 50 || tick === 100 ? String(tick) : "",
    },
    title: { show: false },
    detail: { show: false },
    // Keep a small critical-red sliver visible at zero without changing the
    // displayed score. An empty arc reads like missing data, not poor form.
    data: [{ value: Math.max(2, value.value) }],
  }],
}))
</script>

<template>
  <div class="momentum-gauge" :class="gaugeClass" :style="gaugeStyle">
    <div class="fire-ring" aria-hidden="true" />
    <svg class="arc-frame" viewBox="0 0 300 148" aria-hidden="true">
      <defs>
        <linearGradient id="arc-frame-gold" x1="0" y1="0" x2="1" y2="1">
          <stop class="frame-stop-dark" offset="0" />
          <stop class="frame-stop-bright" offset=".48" />
          <stop class="frame-stop-dark" offset="1" />
        </linearGradient>
      </defs>
      <path class="frame-outer" d="M82.5 125A78 78 0 1 1 217.5 125" />
      <path class="frame-inner" d="M99.8 115A58 58 0 1 1 200.2 115" />
      <g class="rank-crest">
        <path class="crest-wing crest-wing-left" d="M143 9L129 6L134 14L144 20L148 16Z" />
        <path class="crest-wing crest-wing-right" d="M157 9L171 6L166 14L156 20L152 16Z" />
        <path class="crest-shield" d="M150 1L160 7L158 18L150 26L142 18L140 7Z" />
        <path class="crest-inlay" d="M150 6L156 10L154 16L150 20L146 16L144 10Z" />
        <path class="crest-chevron" d="M146 11L150 14L154 11" />
      </g>
    </svg>
    <BaseEChart
      class="gauge-chart"
      :option="option"
      height="148px"
      :ariaLabel="`The Dial ${score} out of 100, ${label}`"
    />
    <svg class="needle" viewBox="0 0 160 24" aria-hidden="true">
      <path class="needle-edge" d="M0 8H91L105 2L160 12L105 22L91 16H0Z" />
      <path class="needle-core" d="M8 10.5H96L107 6.2L148 12L107 17.8L96 13.5H8Z" />
      <path class="needle-rune" d="M72 12H105L116 9.7L132 12L116 14.3L105 12Z" />
    </svg>
    <span class="needle-cap" aria-hidden="true" />
    <div class="readout">
      <strong>{{ score }}</strong>
      <span>{{ label }}</span>
      <small>{{ streak > 0 ? `${streak} win streak` : streak < 0 ? `${Math.abs(streak)} loss streak` : "No active streak" }}</small>
    </div>
  </div>
</template>

<style scoped>
.momentum-gauge {
  position: relative;
  width: min(100%, 300px);
  height: 148px;
  margin: -8px auto 0;
  isolation: isolate;
  background: radial-gradient(
    ellipse 48% 62% at 50% 58%,
    rgba(11, 45, 61, .34) 0 34%,
    rgba(5, 15, 26, .18) 56%,
    transparent 72%
  );
}

.gauge-chart {
  position: relative;
  z-index: 1;
}

.needle {
  position: absolute;
  z-index: 3;
  top: calc(58% - 12px);
  left: 50%;
  width: 68px;
  height: 24px;
  transform: rotate(var(--needle-angle, 150deg));
  transform-origin: 0 50%;
  transition: transform .55s cubic-bezier(.22, .8, .28, 1);
  overflow: visible;
  filter: drop-shadow(0 0 4px rgba(200, 155, 60, .48));
}

.arc-frame {
  position: absolute;
  z-index: 2;
  inset: 0;
  width: 100%;
  height: 148px;
  overflow: visible;
  pointer-events: none;
}

.frame-outer,
.frame-inner {
  fill: none;
  stroke: url(#arc-frame-gold);
  stroke-linecap: square;
  filter: drop-shadow(0 0 3px rgba(200, 155, 60, .26));
}

.frame-outer { stroke-width: 1.4; opacity: .86; }
.frame-inner { stroke-width: .8; opacity: .52; }

.crest-wing,
.crest-shield {
  fill: #07111f;
  stroke: url(#arc-frame-gold);
  stroke-width: 1.25;
  stroke-linejoin: bevel;
  filter: drop-shadow(0 0 4px rgba(200, 155, 60, .34));
}

.crest-wing { stroke-width: 1; }

.frame-stop-dark { stop-color: #715324; }
.frame-stop-bright { stop-color: #efd58c; }

.overdrive .frame-stop-dark { stop-color: var(--tier-color); }
.overdrive .frame-stop-bright { stop-color: var(--tier-bright); }

.crest-inlay {
  fill: #087ea4;
  stroke: #d9bd72;
  stroke-width: .7;
}

.crest-chevron {
  fill: none;
  stroke: #d9bd72;
  stroke-width: 1;
  stroke-linecap: square;
}

.overdrive .crest-inlay { fill: var(--tier-color); }

.needle-edge {
  fill: #c89b3c;
}

.needle-core {
  fill: #111c28;
  stroke: #f0d58a;
  stroke-width: .65;
}

.needle-rune {
  fill: #0a7898;
  stroke: #d9bd72;
  stroke-width: .75;
}

.needle-cap {
  position: absolute;
  z-index: 4;
  top: 58%;
  left: 50%;
  width: 14px;
  height: 14px;
  transform: translate(-50%, -50%);
  border: 2px solid #c8aa6d;
  border-radius: 50%;
  background: radial-gradient(circle at 38% 34%, #25a6c0 0 11%, #0b516b 15% 35%, #07111f 62%);
  box-shadow: 0 0 8px rgba(200, 170, 109, .65);
}

.readout {
  position: absolute;
  z-index: 2;
  inset: auto 0 2px;
  display: grid;
  justify-items: center;
  line-height: 1;
  pointer-events: none;
}

.readout strong {
  font: 24px var(--font-display);
  color: var(--gauge-color, var(--gold-bright));
  text-shadow: 0 0 12px rgba(10, 203, 230, .35);
}

.readout span {
  margin-top: 3px;
  color: var(--gold);
  font: 10px var(--font-heading);
  letter-spacing: .9px;
  text-transform: uppercase;
}

.readout small {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 9px;
}

.fire-ring {
  display: none;
}

.overdrive .fire-ring {
  position: absolute;
  z-index: 0;
  inset: -9px 2%;
  display: block;
  border-radius: 50%;
  background: conic-gradient(
    from 20deg,
    transparent 0 8%,
    var(--tier-color) 11%,
    var(--tier-bright) 15%,
    transparent 20% 34%,
    var(--tier-color) 39%,
    transparent 46% 65%,
    var(--tier-bright) 71%,
    var(--tier-color) 76%,
    transparent 82%
  );
  filter: blur(7px);
  opacity: .85;
  animation: fire-wheel var(--fire-speed) linear infinite, fire-breathe .42s ease-in-out infinite alternate;
  mask: radial-gradient(ellipse, transparent 0 58%, #000 62% 70%, transparent 75%);
}

.overdrive .needle {
  animation: needle-redline .13s steps(2, end) infinite;
  filter: drop-shadow(0 0 6px var(--tier-shadow));
}

.overdrive .arc-frame {
  animation: overdrive-frame-pulse .62s ease-in-out infinite alternate;
}

.overdrive .readout strong {
  color: var(--tier-bright);
  text-shadow: 0 0 8px var(--tier-color), 0 0 18px var(--tier-shadow);
}

.shake-soft { animation: gauge-shake-soft 1.35s linear infinite; }
.shake-medium { animation: gauge-shake-medium .86s linear infinite; }
.shake-hard { animation: gauge-shake-hard .5s linear infinite; }

@keyframes needle-redline {
  0%, 100% { transform: rotate(var(--needle-angle, 150deg)); }
  35% { transform: rotate(calc(var(--needle-angle, 150deg) - 1.7deg)); }
  70% { transform: rotate(calc(var(--needle-angle, 150deg) + .7deg)); }
}

@keyframes fire-wheel {
  to { transform: rotate(360deg); }
}

@keyframes fire-breathe {
  from { opacity: .58; scale: .985; }
  to { opacity: .95; scale: 1.035; }
}

@keyframes overdrive-frame-pulse {
  from { filter: drop-shadow(0 0 2px var(--tier-shadow)); }
  to { filter: drop-shadow(0 0 8px var(--tier-shadow)); }
}

@keyframes gauge-shake-soft {
  0%, 80%, 100% { transform: translate(0, 0); }
  84% { transform: translate(.5px, -.3px); }
  88% { transform: translate(-.7px, .35px); }
  92% { transform: translate(.35px, .2px); }
}

@keyframes gauge-shake-medium {
  0%, 68%, 100% { transform: translate(0, 0); }
  73% { transform: translate(1px, -.55px) rotate(.08deg); }
  78% { transform: translate(-1.2px, .65px) rotate(-.1deg); }
  83% { transform: translate(.8px, .4px); }
  88% { transform: translate(-.4px, -.25px); }
}

@keyframes gauge-shake-hard {
  0%, 52%, 100% { transform: translate(0, 0); }
  58% { transform: translate(1.7px, -.9px) rotate(.18deg); }
  65% { transform: translate(-1.9px, 1px) rotate(-.2deg); }
  72% { transform: translate(1.3px, .8px) rotate(.12deg); }
  79% { transform: translate(-1.1px, -.65px) rotate(-.1deg); }
  86% { transform: translate(.65px, .4px); }
}

@media (prefers-reduced-motion: reduce) {
  .needle { transition: none; }
  .overdrive,
  .overdrive .needle,
  .overdrive .fire-ring,
  .overdrive .arc-frame { animation: none; }
}
</style>
