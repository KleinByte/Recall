<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"

/**
 * Hextech Resonance Core — a charge-cell gauge.
 * Twenty hex-faceted cells ignite around a 240° ring as the score climbs,
 * feeding a faceted hextech crystal that holds the readout. At full charge a
 * resonance wave rolls through the cells; on Overdrive the ring's end studs
 * ignite and the whole core ascends to the streak tier's color.
 */
const props = defineProps<{
  score: number
  label: string
  streak: number
  overdriveTier?: "gold" | "emerald" | "diamond" | "master"
  title?: string
  detail?: string
}>()

type Tier = "gold" | "emerald" | "diamond" | "master"
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
  const stops: Array<[number, string]> = [[keys[0][0], blend(keys[0][1], keys[0][1], 0)]]
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

function colorFrom(stops: Array<[number, string]>, at: number) {
  for (const [position, color] of stops) {
    if (at <= position) return color
  }
  return stops[stops.length - 1][1]
}

const scoreSpectrum = gradientStops([
  [0, "#4a0717"],
  [.18, "#8f1428"],
  [.34, "#d2494d"],
  [.51, "#17608f"],
  [.66, "#159194"],
  [.8, "#18a66e"],
  [.91, "#9c8130"],
  [1, "#e7bd55"],
], 18)

/* ---------- geometry: 240° ring pivoting on (160, 96) ---------- */
const CX = 160
const CY = 96

function polar(angle: number, radius: number) {
  const rad = (angle * Math.PI) / 180
  return `${(CX + radius * Math.cos(rad)).toFixed(2)} ${(CY - radius * Math.sin(rad)).toFixed(2)}`
}

function angleAt(score: number) {
  return 210 - score * 2.4
}

function arcSpan(from: number, to: number, radius: number) {
  const large = Math.abs(from - to) > 180 ? 1 : 0
  return `M${polar(from, radius)}A${radius} ${radius} 0 ${large} 1 ${polar(to, radius)}`
}

function cellWedge(from: number, to: number, outer: number, inner: number) {
  return `M${polar(from, outer)}A${outer} ${outer} 0 0 1 ${polar(to, outer)}`
    + `L${polar(to, inner)}A${inner} ${inner} 0 0 0 ${polar(from, inner)}Z`
}

// Regular hexagon path centered on (0, 0), flat top point up.
function hexPath(radius: number) {
  const points = Array.from({ length: 6 }, (_, k) => {
    const rad = ((90 - k * 60) * Math.PI) / 180
    return `${(radius * Math.cos(rad)).toFixed(2)} ${(-radius * Math.sin(rad)).toFixed(2)}`
  })
  return `M${points.join("L")}Z`
}

const uid = `core-${Math.floor(Math.random() * 0xffffff).toString(16)}`

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
const maxed = computed(() => value.value >= 100)

/* ---------- overdrive choreography: idle → igniting → burning → cooling ---------- */
const phase = ref<"idle" | "igniting" | "burning" | "cooling">("idle")
let phaseTimer: ReturnType<typeof setTimeout> | undefined
watch(overdrive, (on, was) => {
  clearTimeout(phaseTimer)
  if (on) {
    if (was === undefined) {
      phase.value = "burning"
      return
    }
    phase.value = "igniting"
    phaseTimer = setTimeout(() => { phase.value = "burning" }, 950)
  } else if (was) {
    phase.value = "cooling"
    phaseTimer = setTimeout(() => { phase.value = "idle" }, 1000)
  }
}, { immediate: true })

const overdriveActive = computed(() => phase.value === "igniting" || phase.value === "burning")

// Cooling keeps the last tier so the wind-down plays in its own colors.
const lastTier = ref<Tier>("gold")
watch(tier, next => { if (next) lastTier.value = next }, { immediate: true })
const displayTier = computed(() => tier.value ?? lastTier.value)

const tierPalette = computed(() => {
  switch (displayTier.value) {
    case "master": return {
      color: "#9254d6", bright: "#e0a4ff", shadow: "rgba(158, 79, 232, .96)", speed: ".52s",
      gradient: gradientStops([[0, "#6d2fa8"], [.35, "#bc76ef"], [.65, "#8b46c9"], [1, "#e0a4ff"]]),
    }
    case "diamond": return {
      color: "#1ea9d6", bright: "#8ceaff", shadow: "rgba(38, 190, 235, .96)", speed: ".66s",
      gradient: gradientStops([[0, "#0d78a1"], [.35, "#8ceaff"], [.65, "#1b98c4"], [1, "#68d8f5"]]),
    }
    case "emerald": return {
      color: "#0fa76f", bright: "#67ecb5", shadow: "rgba(31, 196, 132, .94)", speed: ".8s",
      gradient: gradientStops([[0, "#0b7a51"], [.35, "#67ecb5"], [.65, "#10935f"], [1, "#45d99d"]]),
    }
    default: return {
      color: "#d3a238", bright: "#ffe08a", shadow: "rgba(255, 181, 47, .95)", speed: "1.05s",
      gradient: gradientStops([[0, "#a06a1a"], [.35, "#ffe08a"], [.65, "#c1892a"], [1, "#f5c557"]]),
    }
  }
})

/* ---------- charge cells ---------- */
const CELL_COUNT = 20
const cells = computed(() => {
  const spectrum = overdriveActive.value ? tierPalette.value.gradient : scoreSpectrum
  const litCount = Math.max(1, Math.round(value.value / 5))
  return Array.from({ length: CELL_COUNT }, (_, index) => {
    const from = 210 - index * 12 - 1.7
    const to = 210 - (index + 1) * 12 + 1.7
    const lit = index < litCount
    const color = colorFrom(spectrum, (index + .5) / CELL_COUNT)
    return {
      d: cellWedge(from, to, 76, 62),
      lit,
      frontier: lit && index === litCount - 1 && value.value < 100,
      fill: lit ? color : "#0b141f",
      glow: color,
    }
  })
})

const tickLabels = [0, 50, 100].map(tick => {
  const [x, y] = polar(angleAt(tick), 46).split(" ").map(Number)
  return { tick, x, y: y + 3 }
})

/* ---------- readout: tweened score with a pop on change ---------- */
const displayScore = ref(Math.round(props.score))
const popKey = ref(props.score)
let scoreRaf = 0
watch(() => props.score, next => {
  popKey.value = next
  cancelAnimationFrame(scoreRaf)
  const from = displayScore.value
  const startedAt = performance.now()
  const step = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / 650)
    const eased = 1 - (1 - progress) ** 3
    displayScore.value = Math.round(from + (next - from) * eased)
    if (progress < 1) scoreRaf = requestAnimationFrame(step)
  }
  scoreRaf = requestAnimationFrame(step)
})

onBeforeUnmount(() => {
  clearTimeout(phaseTimer)
  cancelAnimationFrame(scoreRaf)
})

const scoreColor = computed(() => {
  if (value.value >= 80) return "#c89b3c"
  if (value.value >= 60) return "#16a36f"
  if (value.value >= 40) return "#087ea4"
  if (value.value >= 20) return "#c53f48"
  return "#a33049"
})
const gaugeStyle = computed(() => ({
  "--score-color": overdriveActive.value ? tierPalette.value.bright : scoreColor.value,
  "--tier-color": tierPalette.value.color,
  "--tier-bright": tierPalette.value.bright,
  "--tier-shadow": tierPalette.value.shadow,
  "--surge-speed": tierPalette.value.speed,
}))
const gaugeClass = computed(() => [
  `phase-${phase.value}`,
  {
    overdrive: overdriveActive.value,
    cooling: phase.value === "cooling",
    maxed: maxed.value,
  },
  phase.value === "burning" && props.streak >= 6
    ? "shake-hard"
    : phase.value === "burning" && props.streak === 5
      ? "shake-medium"
      : phase.value === "burning" && props.streak === 4
        ? "shake-soft"
        : "",
])

const ariaLabel = computed(() => `${props.title ?? "The Dial"} ${props.score} out of 100, ${props.label}`)
const streakText = computed(() =>
  props.detail ?? (props.streak > 0
    ? `${props.streak} win streak`
    : props.streak < 0
      ? `${Math.abs(props.streak)} loss streak`
      : "No active streak"),
)
</script>

<template>
  <div
    class="momentum-gauge"
    :class="gaugeClass"
    :style="gaugeStyle"
    role="meter"
    :aria-label="ariaLabel"
    :aria-valuenow="value"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <div class="hex-halo" aria-hidden="true">
      <!-- Square view-box centered on the core: rotation origin, view-box
           center, and viewport center coincide, so orbits can never drift. -->
      <svg class="halo-svg" viewBox="-150 -150 300 300">
        <defs>
          <linearGradient :id="`comet-${uid}`" gradientUnits="userSpaceOnUse" x1="0" y1="-92" x2="-59.14" y2="-70.49">
            <stop class="comet-stop-head" offset="0" />
            <stop class="comet-stop-tail" offset="1" />
          </linearGradient>
        </defs>
        <g class="halo-band-orbit">
          <circle class="halo-band" cx="0" cy="0" r="96" pathLength="120" />
        </g>
        <g class="halo-hexes">
          <path
            v-for="n in 6"
            :key="`halo-hex-${n}`"
            class="halo-hex"
            :d="hexPath(6)"
            :transform="`rotate(${n * 60}) translate(0 -87)`"
          />
        </g>
        <g class="comet-orbit">
          <path class="comet-tail" d="M0 -92A92 92 0 0 0 -59.14 -70.49" :stroke="`url(#comet-${uid})`" />
          <circle class="comet-head" cx="0" cy="-92" r="3.2" />
        </g>
      </svg>
      <span v-for="n in 7" :key="`ember-${n}`" class="ember" />
    </div>
    <svg class="gauge-svg" viewBox="0 0 320 170" aria-hidden="true">
      <defs>
        <linearGradient :id="`glass-${uid}`" x1="0" y1="0" x2="0" y2="1">
          <stop class="gem-stop-a" offset="0" />
          <stop class="gem-stop-b" offset=".55" />
          <stop class="gem-stop-c" offset="1" />
        </linearGradient>
        <linearGradient :id="`shine-${uid}`" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="rgba(255,255,255,0)" />
          <stop offset=".5" stop-color="rgba(235,250,255,.5)" />
          <stop offset="1" stop-color="rgba(255,255,255,0)" />
        </linearGradient>
        <clipPath :id="`gem-clip-${uid}`">
          <path d="M160 79L186 94V122L160 137L134 122V94Z" />
        </clipPath>
      </defs>
      <g class="ring-frame">
        <path class="frame-line" :d="arcSpan(212, -32, 81.5)" />
        <path class="frame-line frame-line-inner" :d="arcSpan(212, -32, 55.5)" />
      </g>
      <g class="cells">
        <path
          v-for="(cell, index) in cells"
          :key="index"
          class="hex-cell"
          :class="{ lit: cell.lit, frontier: cell.frontier }"
          :d="cell.d"
          :fill="cell.fill"
          :style="{ '--i': index, '--cell-glow': cell.glow }"
        />
      </g>
      <text
        v-for="item in tickLabels"
        :key="item.tick"
        class="tick-label"
        :x="item.x" :y="item.y"
      >{{ item.tick }}</text>
      <!-- Art-deco prong terminals cap the ring ends; the vein lights with the tier.
           Local +x continues the arc tangent, local y spans the band radially. -->
      <g class="end-cap" transform="translate(103.7 136.5) rotate(60)">
        <path class="cap-plate" d="M-1.5 -8.5L3 -8.5L6.5 -4.5L6.5 4.5L3 8.5L-1.5 8.5Z" />
        <path class="cap-blade" d="M6.5 -3.4L14.5 -1.6L18 0L14.5 1.6L6.5 3.4Z" />
        <path class="cap-vein" d="M7.5 0H14.8" />
        <path class="cap-rivet" :d="hexPath(1.7)" transform="translate(2.2 0)" />
      </g>
      <g class="end-cap" transform="translate(216.3 136.5) rotate(120)">
        <path class="cap-plate" d="M-1.5 -8.5L3 -8.5L6.5 -4.5L6.5 4.5L3 8.5L-1.5 8.5Z" />
        <path class="cap-blade" d="M6.5 -3.4L14.5 -1.6L18 0L14.5 1.6L6.5 3.4Z" />
        <path class="cap-vein" d="M7.5 0H14.8" />
        <path class="cap-rivet" :d="hexPath(1.7)" transform="translate(2.2 0)" />
      </g>
      <g class="core-gem">
        <path class="gem-body" d="M160 79L186 94V122L160 137L134 122V94Z" :fill="`url(#glass-${uid})`" />
        <g :clip-path="`url(#gem-clip-${uid})`">
          <rect class="gem-shine" x="144" y="73" width="16" height="70" :fill="`url(#shine-${uid})`" />
        </g>
        <path
          class="gem-facets"
          d="M160 92.05L174.3 100.3V115.7L160 123.95L145.7 115.7V100.3ZM160 79V92.05M186 94L174.3 100.3M186 122L174.3 115.7M160 137V123.95M134 122L145.7 115.7M134 94L145.7 100.3"
        />
      </g>
    </svg>
    <template v-if="phase === 'igniting'">
      <span class="ignite-flash" aria-hidden="true" />
      <svg class="hex-shock" viewBox="-150 -150 300 300" aria-hidden="true">
        <path class="shock-hex" :d="hexPath(42)" />
        <path class="shock-hex shock-hex-late" :d="hexPath(42)" />
      </svg>
    </template>
    <div class="core-readout">
      <strong :key="popKey">{{ displayScore }}</strong>
    </div>
    <div class="core-label">{{ label }}</div>
    <div class="core-detail">{{ streakText }}</div>
  </div>
</template>

<style scoped>
.momentum-gauge {
  position: relative;
  width: min(100%, 320px);
  height: 170px;
  margin: -8px auto 0;
  isolation: isolate;
  background: radial-gradient(
    ellipse 48% 62% at 50% 56.5%,
    rgba(11, 45, 61, .34) 0 34%,
    rgba(5, 15, 26, .18) 56%,
    transparent 72%
  );
}

.gauge-svg {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  height: 170px;
  overflow: visible;
}

/* ---------- ring frame + charge cells ---------- */
.frame-line {
  fill: none;
  stroke: var(--instrument-border);
  stroke-width: 1.2;
  filter: drop-shadow(0 0 3px rgba(200, 155, 60, .25));
}

.frame-line-inner {
  stroke-width: .7;
  opacity: .6;
}

.hex-cell {
  stroke: rgba(200, 170, 109, .14);
  stroke-width: .7;
  transition: fill .45s ease, filter .45s ease, opacity .45s ease;
  transition-delay: calc(var(--i) * 26ms);
}

.hex-cell.lit {
  stroke: rgba(200, 170, 109, .42);
  filter: drop-shadow(0 0 2.5px var(--cell-glow));
}

/* The charging cell sputters like an unstable hextech coil. */
.hex-cell.frontier {
  animation: cell-charge .85s steps(3, jump-none) infinite alternate;
}

/* Full charge: a resonance wave rolls cell to cell through the ring. */
.maxed .hex-cell.lit {
  animation: cell-surge 2.4s ease-in-out infinite;
  animation-delay: calc(var(--i) * -.12s);
}

.tick-label {
  fill: var(--dial-readout-muted);
  font: 10px var(--font-heading);
  text-anchor: middle;
}

/* ---------- ring end terminals: veins light with the tier in Overdrive ---------- */
.cap-plate {
  fill: var(--dial-ink-800);
  stroke: var(--instrument-border-strong);
  stroke-width: 1.1;
  stroke-linejoin: bevel;
}

.cap-blade {
  fill: var(--dial-navy-700);
  stroke: var(--instrument-border);
  stroke-width: .9;
  stroke-linejoin: bevel;
}

.cap-vein {
  fill: none;
  stroke: var(--dial-energy-700);
  stroke-width: 1.5;
  stroke-linecap: round;
  transition: stroke .6s ease, filter .6s ease;
}

.cap-rivet {
  fill: var(--dial-metal-500);
}

.overdrive .cap-vein {
  stroke: var(--tier-bright);
  filter: drop-shadow(0 0 3.5px var(--tier-shadow));
}

/* ---------- hextech crystal core ---------- */
.core-gem {
  transform-box: fill-box;
  transform-origin: 50% 50%;
}

.gem-body {
  stroke: var(--dial-metal-500);
  stroke-width: 1.3;
  stroke-linejoin: bevel;
  transition: stroke .6s ease, filter .6s ease;
  filter: drop-shadow(0 0 5px rgba(200, 155, 60, .3));
}

.gem-facets {
  fill: none;
  stroke: rgba(200, 170, 109, .3);
  stroke-width: .6;
}

.gem-stop-a { stop-color: var(--dial-navy-500); transition: stop-color var(--instrument-motion-material) ease; }
.gem-stop-b { stop-color: var(--dial-navy-650); transition: stop-color var(--instrument-motion-material) ease; }
.gem-stop-c { stop-color: var(--dial-ink-950); transition: stop-color var(--instrument-motion-material) ease; }

.gem-shine {
  transform: translateX(-56px) skewX(-18deg);
  animation: gem-shine var(--instrument-motion-ambient) ease-in-out infinite;
}

.overdrive .gem-body {
  stroke: var(--tier-bright);
  filter: drop-shadow(0 0 7px var(--tier-shadow));
  animation: gem-resonate calc(var(--surge-speed) * 1.3) ease-in-out infinite alternate;
}

.overdrive .gem-stop-a { stop-color: color-mix(in srgb, var(--tier-color) 55%, #0a1c2c); }
.overdrive .gem-stop-b { stop-color: color-mix(in srgb, var(--tier-color) 25%, #0a1c2c); }

.phase-igniting .core-gem {
  animation: gem-kick .55s cubic-bezier(.3, 1.6, .4, 1);
}

/* ---------- readout ---------- */
.core-readout {
  position: absolute;
  z-index: 3;
  top: 108px;
  left: 50%;
  display: grid;
  place-items: center;
  width: 80px;
  height: 34px;
  transform: translate(-50%, -50%);
  line-height: 1;
  pointer-events: none;
}

.core-readout strong {
  font: 26px var(--font-display);
  color: var(--score-color, var(--gold-bright));
  text-shadow: 0 0 10px rgba(10, 203, 230, .35);
  transition: color .6s ease, text-shadow .6s ease;
  animation: score-pop .45s cubic-bezier(.2, 1.4, .4, 1);
}

.core-label {
  position: absolute;
  z-index: 3;
  top: 143px;
  left: 50%;
  width: 140px;
  transform: translateX(-50%);
  color: var(--dial-metal-500);
  font: 11px var(--font-heading);
  line-height: 1;
  letter-spacing: .8px;
  text-align: center;
  text-transform: uppercase;
  pointer-events: none;
}

.overdrive .core-readout strong {
  color: var(--tier-bright);
  text-shadow: 0 0 8px var(--tier-color), 0 0 16px var(--tier-shadow);
}

.core-detail {
  position: absolute;
  z-index: 2;
  inset: auto 0 2px;
  color: var(--text-muted);
  font-size: 11.5px;
  line-height: 1;
  text-align: center;
  pointer-events: none;
}

/* ---------- overdrive halo: hex glyph orbit, comet, embers ---------- */
.hex-halo {
  display: none;
}

.overdrive .hex-halo,
.cooling .hex-halo {
  position: absolute;
  z-index: 0;
  inset: 0;
  display: block;
  transform-origin: 50% 56.5%;
  pointer-events: none;
}

.phase-igniting .hex-halo {
  animation: halo-ignite .95s cubic-bezier(.2, 1.3, .4, 1);
}

.cooling .hex-halo {
  animation: halo-cool 1s ease-in forwards;
}

.halo-svg {
  position: absolute;
  top: 96px;
  left: 50%;
  width: 320px;
  height: 320px;
  transform: translate(-50%, -50%);
  mask: linear-gradient(180deg, #000 0 calc(50% + 2px), transparent calc(50% + 66px));
}

.halo-band-orbit,
.halo-hexes,
.comet-orbit {
  transform-box: view-box;
  transform-origin: 0 0;
}

.halo-band-orbit {
  animation: orbit-spin calc(var(--surge-speed) * 24) linear infinite;
}

.halo-band {
  fill: none;
  stroke: var(--tier-color);
  stroke-width: .8;
  stroke-dasharray: 5.6 4.4;
  opacity: .5;
}

.halo-hexes {
  animation: orbit-spin calc(var(--surge-speed) * 16) linear infinite reverse;
}

.halo-hex {
  fill: none;
  stroke: var(--tier-bright);
  stroke-width: 1;
  opacity: .75;
  filter: drop-shadow(0 0 3px var(--tier-shadow));
}

.comet-orbit {
  animation: orbit-spin calc(var(--surge-speed) * 5) linear infinite;
}

.comet-tail {
  fill: none;
  stroke-width: 3;
  stroke-linecap: round;
}

.comet-stop-head { stop-color: var(--tier-bright, #ffe08a); }
.comet-stop-tail { stop-color: transparent; }

.comet-head {
  fill: #fdfeff;
  filter: drop-shadow(0 0 5px var(--tier-shadow)) drop-shadow(0 0 10px var(--tier-shadow));
}

.ember {
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #fff, var(--tier-bright) 45%, transparent 72%);
  box-shadow: 0 0 6px var(--tier-shadow);
  opacity: 0;
  animation: ember-float var(--ember-dur, 2.6s) ease-in infinite;
  animation-delay: var(--ember-delay, 0s);
}

.ember:nth-of-type(1) { left: 10%; top: 60%; --ember-delay: 0s; --ember-dur: 2.4s; --ember-sway: 5px; }
.ember:nth-of-type(2) { left: 20%; top: 34%; --ember-delay: .6s; --ember-dur: 2.8s; --ember-sway: -4px; }
.ember:nth-of-type(3) { left: 33%; top: 16%; --ember-delay: 1.1s; --ember-dur: 2.2s; --ember-sway: 6px; }
.ember:nth-of-type(4) { left: 50%; top: 9%; --ember-delay: 1.5s; --ember-dur: 3s; --ember-sway: -5px; }
.ember:nth-of-type(5) { left: 66%; top: 16%; --ember-delay: 2s; --ember-dur: 2.5s; --ember-sway: 4px; }
.ember:nth-of-type(6) { left: 80%; top: 34%; --ember-delay: 2.4s; --ember-dur: 2.9s; --ember-sway: -6px; }
.ember:nth-of-type(7) { left: 89%; top: 60%; --ember-delay: 2.8s; --ember-dur: 2.3s; --ember-sway: 5px; }

/* ---------- ignition burst ---------- */
.ignite-flash {
  position: absolute;
  z-index: 5;
  inset: 0;
  background: radial-gradient(ellipse 55% 70% at 50% 56.5%, var(--tier-bright), transparent 62%);
  mix-blend-mode: screen;
  pointer-events: none;
  animation: ignite-flash .55s ease-out forwards;
}

.hex-shock {
  position: absolute;
  z-index: 4;
  top: 96px;
  left: 50%;
  width: 320px;
  height: 320px;
  transform: translate(-50%, -50%);
  overflow: visible;
  pointer-events: none;
}

.shock-hex {
  fill: none;
  stroke: var(--tier-bright);
  stroke-width: 2;
  transform-box: view-box;
  transform-origin: 0 0;
  opacity: 0;
  filter: drop-shadow(0 0 8px var(--tier-shadow));
  animation: shock-expand .7s cubic-bezier(.2, .7, .3, 1) forwards;
}

.shock-hex-late {
  stroke-width: 1;
  --shock-angle: 30deg;
  animation-delay: .18s;
}

/* ---------- streak shakes ---------- */
.shake-soft { --shake-amp: .5px; animation: core-shake 1.3s linear infinite; }
.shake-medium { --shake-amp: 1px; animation: core-shake .85s linear infinite; }
.shake-hard { --shake-amp: 1.8px; animation: core-shake .5s linear infinite; }

@keyframes core-shake {
  0%, 58%, 100% { transform: translate(0, 0); }
  66% { transform: translate(var(--shake-amp), calc(var(--shake-amp) * -.6)); }
  74% { transform: translate(calc(var(--shake-amp) * -1.1), calc(var(--shake-amp) * .6)); }
  82% { transform: translate(calc(var(--shake-amp) * .7), calc(var(--shake-amp) * .4)); }
  90% { transform: translate(calc(var(--shake-amp) * -.4), calc(var(--shake-amp) * -.25)); }
}

@keyframes cell-charge {
  from { opacity: .5; filter: drop-shadow(0 0 1px var(--cell-glow)); }
  to { opacity: 1; filter: drop-shadow(0 0 5px var(--cell-glow)) brightness(1.35); }
}

@keyframes cell-surge {
  0%, 100% { filter: drop-shadow(0 0 2px var(--cell-glow)) brightness(1); }
  50% { filter: drop-shadow(0 0 6px var(--cell-glow)) brightness(1.6); }
}

@keyframes score-pop {
  0% { transform: scale(1.3); filter: brightness(1.7); }
  100% { transform: scale(1); filter: brightness(1); }
}

@keyframes gem-shine {
  0% { transform: translateX(-56px) skewX(-18deg); }
  45%, 100% { transform: translateX(104px) skewX(-18deg); }
}

@keyframes gem-kick {
  0% { transform: scale(1); }
  40% { transform: scale(1.14); }
  100% { transform: scale(1); }
}

@keyframes gem-resonate {
  from { filter: drop-shadow(0 0 4px var(--tier-shadow)); }
  to { filter: drop-shadow(0 0 11px var(--tier-shadow)); }
}

@keyframes ignite-flash {
  0% { opacity: .9; }
  100% { opacity: 0; }
}

@keyframes shock-expand {
  0% { opacity: .95; transform: scale(.3) rotate(var(--shock-angle, 0deg)); }
  100% { opacity: 0; transform: scale(3.4) rotate(calc(var(--shock-angle, 0deg) + 24deg)); }
}

@keyframes halo-ignite {
  0% { opacity: 0; transform: scale(.82); filter: blur(4px) brightness(2); }
  60% { opacity: 1; transform: scale(1.04); }
  100% { opacity: 1; transform: scale(1); filter: blur(0) brightness(1); }
}

@keyframes halo-cool {
  0% { opacity: 1; transform: scale(1); filter: none; }
  100% { opacity: 0; transform: scale(.93); filter: blur(3px) saturate(.35); }
}

@keyframes orbit-spin {
  to { transform: rotate(360deg); }
}

@keyframes ember-float {
  0% { opacity: 0; transform: translate3d(0, 6px, 0) scale(.6); }
  12% { opacity: .95; }
  55% { opacity: .7; transform: translate3d(var(--ember-sway, 4px), -14px, 0) scale(.85); }
  100% { opacity: 0; transform: translate3d(calc(var(--ember-sway, 4px) * -.6), -30px, 0) scale(.4); }
}

@media (prefers-reduced-motion: reduce) {
  .momentum-gauge,
  .momentum-gauge .hex-cell,
  .momentum-gauge .gem-shine,
  .momentum-gauge .core-gem,
  .momentum-gauge .gem-body,
  .momentum-gauge .hex-halo,
  .momentum-gauge .hex-halo *,
  .momentum-gauge .ignite-flash,
  .momentum-gauge .shock-hex,
  .momentum-gauge .core-readout strong,
  .momentum-gauge .ember { animation: none; }
  .hex-cell { transition-delay: 0s; }
}
</style>
