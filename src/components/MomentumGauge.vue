<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"

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
type Phase = "idle" | "igniting" | "promoting" | "rupturing" | "burning" | "discharging"

interface TierEffectProfile {
  level: number
  crackLevel: number
  sparkCount: number
  color: string
  bright: string
  shadow: string
  speed: string
  shakeAmp: string
  shakePeriod: string
  sparkDuration: string
  sparkDistance: string
  glowRadius: string
  cooldownMs: number
  gradient: ReturnType<typeof gradientStops>
}

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
const derivedTier = computed<Tier | undefined>(() => {
  if (value.value < 100 || props.streak < 3) return undefined
  if (props.streak >= 6) return "master"
  if (props.streak === 5) return "diamond"
  if (props.streak === 4) return "emerald"
  return "gold"
})
const requestedTier = computed<Tier | undefined>(() => props.overdriveTier ?? derivedTier.value)
const tier = computed<Tier | undefined>(() => value.value >= 100 ? requestedTier.value : undefined)
const overdrive = computed(() => tier.value !== undefined)
const maxed = computed(() => value.value >= 100)

const TIER_EFFECTS = {
  gold: {
    level: 1, crackLevel: 1, sparkCount: 3,
    color: "#d3a238", bright: "#ffe08a", shadow: "rgba(255, 181, 47, .95)", speed: "1.05s",
    shakeAmp: ".24px", shakePeriod: "1.9s", sparkDuration: "2.8s", sparkDistance: "25px",
    glowRadius: "7px", cooldownMs: 650,
    gradient: gradientStops([[0, "#a06a1a"], [.35, "#ffe08a"], [.65, "#c1892a"], [1, "#f5c557"]]),
  },
  emerald: {
    level: 2, crackLevel: 2, sparkCount: 5,
    color: "#0fa76f", bright: "#67ecb5", shadow: "rgba(31, 196, 132, .94)", speed: ".8s",
    shakeAmp: ".48px", shakePeriod: "1.42s", sparkDuration: "2.35s", sparkDistance: "34px",
    glowRadius: "9px", cooldownMs: 800,
    gradient: gradientStops([[0, "#0b7a51"], [.35, "#67ecb5"], [.65, "#10935f"], [1, "#45d99d"]]),
  },
  diamond: {
    level: 3, crackLevel: 3, sparkCount: 8,
    color: "#1ea9d6", bright: "#8ceaff", shadow: "rgba(38, 190, 235, .96)", speed: ".66s",
    shakeAmp: ".78px", shakePeriod: "1.02s", sparkDuration: "1.9s", sparkDistance: "43px",
    glowRadius: "12px", cooldownMs: 1000,
    gradient: gradientStops([[0, "#0d78a1"], [.35, "#8ceaff"], [.65, "#1b98c4"], [1, "#68d8f5"]]),
  },
  master: {
    level: 4, crackLevel: 4, sparkCount: 12,
    color: "#9254d6", bright: "#e0a4ff", shadow: "rgba(158, 79, 232, .96)", speed: ".52s",
    shakeAmp: "1.12px", shakePeriod: ".72s", sparkDuration: "1.45s", sparkDistance: "54px",
    glowRadius: "15px", cooldownMs: 1300,
    gradient: gradientStops([[0, "#6d2fa8"], [.35, "#bc76ef"], [.65, "#8b46c9"], [1, "#e0a4ff"]]),
  },
} satisfies Record<Tier, TierEffectProfile>

/* ---------- overdrive choreography: charge → promote/rupture → sustain → discharge ---------- */
const prefersReducedMotion = ref(
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
)
let motionQuery: MediaQueryList | undefined
const syncMotionPreference = (event: MediaQueryListEvent) => {
  prefersReducedMotion.value = event.matches
}

const phase = ref<Phase>("idle")
let phaseTimer: ReturnType<typeof setTimeout> | undefined
const lastTier = ref<Tier>("gold")
const departingTier = ref<Tier>("gold")
let phaseInitialized = false

function schedulePhase(next: Phase, delay: number) {
  clearTimeout(phaseTimer)
  phaseTimer = setTimeout(() => { phase.value = next }, delay)
}

watch(tier, (next, previous) => {
  clearTimeout(phaseTimer)

  if (!phaseInitialized) {
    phaseInitialized = true
    if (next) lastTier.value = next
    phase.value = next ? "burning" : "idle"
    return
  }

  if (prefersReducedMotion.value) {
    if (next) lastTier.value = next
    phase.value = next ? "burning" : "idle"
    return
  }

  if (next && previous) {
    const promoted = TIER_EFFECTS[next].level > TIER_EFFECTS[previous].level
    if (promoted) {
      lastTier.value = next
      phase.value = next === "master" ? "rupturing" : "promoting"
      schedulePhase("burning", next === "master" ? 1050 : 950)
      return
    }

    if (TIER_EFFECTS[next].level < TIER_EFFECTS[previous].level) {
      departingTier.value = previous
      phase.value = "discharging"
      lastTier.value = next
      schedulePhase("burning", TIER_EFFECTS[previous].cooldownMs)
      return
    }

    lastTier.value = next
    phase.value = "burning"
    return
  }

  if (next) {
    lastTier.value = next
    phase.value = next === "master" ? "rupturing" : "igniting"
    schedulePhase("burning", next === "master" ? 1050 : 950)
    return
  }

  if (previous) {
    departingTier.value = previous
    lastTier.value = previous
    phase.value = "discharging"
    schedulePhase("idle", TIER_EFFECTS[previous].cooldownMs)
  } else {
    phase.value = "idle"
  }
}, { immediate: true })

watch(prefersReducedMotion, reduced => {
  if (!reduced) return
  clearTimeout(phaseTimer)
  cancelAnimationFrame(scoreRaf)
  displayScore.value = Math.round(props.score)
  if (tier.value) lastTier.value = tier.value
  phase.value = tier.value ? "burning" : "idle"
})

const overdriveActive = computed(() =>
  phase.value === "igniting" || phase.value === "promoting" ||
  phase.value === "rupturing" || phase.value === "burning",
)
const displayTier = computed(() =>
  phase.value === "discharging" ? departingTier.value : tier.value ?? lastTier.value,
)
const tierEffectProfile = computed(() => TIER_EFFECTS[displayTier.value])

onMounted(() => {
  motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
  prefersReducedMotion.value = motionQuery.matches
  motionQuery.addEventListener("change", syncMotionPreference)
})

/* ---------- charge cells ---------- */
const CELL_COUNT = 20
const cells = computed(() => {
  // Switching back to the score spectrum at discharge start lets the inline
  // fills drain out of the departing tier color during the cooldown itself.
  const spectrum = overdriveActive.value ? tierEffectProfile.value.gradient : scoreSpectrum
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

const sparks = computed(() => {
  const profile = tierEffectProfile.value
  return Array.from({ length: 12 }, (_, index) => ({
    active: index < profile.sparkCount,
    style: {
      "--spark-angle": `${-165 + index * 30 + (index % 2 ? 7 : 0)}deg`,
      "--spark-delay": `${(index * -.19).toFixed(2)}s`,
      "--spark-return-delay": `${Math.round(index * profile.cooldownMs * .012)}ms`,
      "--spark-scale": `${.72 + (index % 4) * .12}`,
    },
  }))
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
  if (prefersReducedMotion.value) {
    displayScore.value = Math.round(next)
    return
  }
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
  motionQuery?.removeEventListener("change", syncMotionPreference)
})

const scoreColor = computed(() => {
  if (value.value >= 80) return "#c89b3c"
  if (value.value >= 60) return "#16a36f"
  if (value.value >= 40) return "#087ea4"
  if (value.value >= 20) return "#c53f48"
  return "#a33049"
})
const gaugeStyle = computed(() => ({
  "--score-color": overdrive.value ? tierEffectProfile.value.bright : scoreColor.value,
  "--tier-color": tierEffectProfile.value.color,
  "--tier-bright": tierEffectProfile.value.bright,
  "--tier-shadow": tierEffectProfile.value.shadow,
  "--surge-speed": tierEffectProfile.value.speed,
  "--effect-level": tierEffectProfile.value.level,
  "--shake-amp": tierEffectProfile.value.shakeAmp,
  "--shake-period": tierEffectProfile.value.shakePeriod,
  "--spark-duration": tierEffectProfile.value.sparkDuration,
  "--spark-distance": tierEffectProfile.value.sparkDistance,
  "--gem-glow-radius": tierEffectProfile.value.glowRadius,
  "--discharge-duration": `${tierEffectProfile.value.cooldownMs}ms`,
  "--discharge-animation-duration": `${Math.max(360, tierEffectProfile.value.cooldownMs - 180)}ms`,
}))
const gaugeClass = computed(() => [
  `phase-${phase.value}`,
  `tier-${displayTier.value}`,
  `crack-level-${tierEffectProfile.value.crackLevel}`,
  {
    overdrive: overdriveActive.value,
    discharging: phase.value === "discharging",
    maxed: maxed.value,
  },
])

const ariaLabel = computed(() => `${props.title ?? "The Dial"} ${props.score} out of 100, ${props.label}`)
const tierAccessibleName: Record<Tier, string> = {
  gold: "Gold",
  emerald: "Emerald",
  diamond: "Blue",
  master: "Purple",
}
const ariaValueText = computed(() => tier.value
  ? `${Math.round(value.value)} out of 100, ${props.label}, ${tierAccessibleName[tier.value]} Overdrive`
  : `${Math.round(value.value)} out of 100, ${props.label}, not in Overdrive`)
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
    :aria-valuetext="ariaValueText"
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
    </div>
    <div class="core-sparks" aria-hidden="true">
      <span
        v-for="(spark, index) in sparks"
        :key="`core-spark-${index}`"
        class="core-spark"
        :class="{ active: spark.active }"
        :style="spark.style"
      />
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
        <radialGradient :id="`energy-${uid}`">
          <stop offset="0" stop-color="#ffffff" />
          <stop class="energy-stop" offset=".35" />
          <stop class="energy-stop-tail" offset="1" />
        </radialGradient>
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
        <path class="gem-energy-core" d="M160 86L178 97V119L160 130L142 119V97Z" :fill="`url(#energy-${uid})`" />
        <path class="gem-body" d="M160 79L186 94V122L160 137L134 122V94Z" :fill="`url(#glass-${uid})`" />
        <g class="gem-shards">
          <path class="gem-shard gem-shard-left" d="M160 79L160 137L134 122V94Z" :fill="`url(#glass-${uid})`" />
          <path class="gem-shard gem-shard-right" d="M160 79L186 94V122L160 137Z" :fill="`url(#glass-${uid})`" />
        </g>
        <g :clip-path="`url(#gem-clip-${uid})`">
          <rect class="gem-shine" x="144" y="73" width="16" height="70" :fill="`url(#shine-${uid})`" />
        </g>
        <path
          class="gem-facets"
          d="M160 92.05L174.3 100.3V115.7L160 123.95L145.7 115.7V100.3ZM160 79V92.05M186 94L174.3 100.3M186 122L174.3 115.7M160 137V123.95M134 122L145.7 115.7M134 94L145.7 100.3"
        />
        <g class="gem-cracks" aria-hidden="true" :clip-path="`url(#gem-clip-${uid})`">
          <path class="gem-crack" pathLength="1" d="M160 80L157 94L162 103L158 112L160 136" />
          <path class="gem-crack" pathLength="1" d="M161 103L171 97L179 98M158 112L148 119L138 118" />
          <path class="gem-crack" pathLength="1" d="M157 94L148 91L141 84M171 97L175 87L183 82M148 119L145 130" />
          <path class="gem-crack" pathLength="1" d="M160 91L168 84M162 103L180 111L188 110M158 112L151 103L137 101M160 122L169 132" />
        </g>
      </g>
      <g v-if="displayTier === 'master'" class="master-rupture" aria-hidden="true">
        <path class="rupture-ring" :d="hexPath(31)" transform="translate(160 108)" />
        <path
          v-for="n in 6"
          :key="`rupture-rune-${n}`"
          class="rupture-rune"
          d="M-2 5L0 -5L2 5M-1 1H1"
          :style="{ '--rune-index': n - 1 }"
          :transform="`translate(160 108) rotate(${(n - 1) * 60}) translate(0 -29)`"
        />
        <path class="rupture-rays" d="M160 73V85M160 131V143M125 108H139M181 108H195M136 84L146 94M174 122L184 132M184 84L174 94M146 122L136 132" />
      </g>
    </svg>
    <template v-if="phase === 'igniting' || phase === 'promoting' || phase === 'rupturing' || phase === 'discharging'">
      <span v-if="phase !== 'discharging'" class="ignite-flash" aria-hidden="true" />
      <span v-else class="containment-flash" aria-hidden="true" />
      <svg class="hex-shock" :class="{ imploding: phase === 'discharging' }" viewBox="-150 -150 300 300" aria-hidden="true">
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

/* Full Overdrive charge: a resonance wave rolls cell to cell through the ring. */
.overdrive.maxed .hex-cell.lit {
  animation: cell-surge 2.4s ease-in-out infinite;
  animation-delay: calc(var(--i) * -.12s);
}

.phase-discharging .hex-cell {
  transition-duration: var(--discharge-animation-duration);
  transition-delay: calc(var(--i) * 9ms);
}

.phase-discharging .hex-cell.lit {
  animation: cell-discharge var(--discharge-animation-duration) ease-in forwards;
  animation-delay: calc(var(--i) * 9ms);
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

.phase-discharging .cap-vein {
  animation: cap-vein-discharge var(--discharge-duration) ease-in both;
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
  transition: stroke .6s ease, filter .6s ease, opacity .45s ease;
  filter: drop-shadow(0 0 5px rgba(200, 155, 60, .3));
}

.gem-energy-core {
  opacity: 0;
  transform-box: fill-box;
  transform-origin: center;
  transition: opacity .45s ease;
}

.energy-stop { stop-color: var(--tier-bright); }
.energy-stop-tail { stop-color: var(--tier-color); stop-opacity: 0; }

.gem-shard {
  opacity: 0;
  stroke: var(--tier-bright);
  stroke-width: .8;
  stroke-linejoin: bevel;
  transform-box: fill-box;
  transition: opacity .25s ease, transform .5s cubic-bezier(.2, 1.2, .4, 1);
}

.gem-shard-left { transform-origin: right center; }
.gem-shard-right { transform-origin: left center; }

.gem-facets {
  fill: none;
  stroke: rgba(200, 170, 109, .3);
  stroke-width: .6;
}

.gem-crack {
  fill: none;
  stroke: var(--tier-bright);
  stroke-width: 1.05;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  opacity: 0;
  filter: drop-shadow(0 0 2px var(--tier-shadow));
  transition: stroke-dashoffset .58s ease-out, opacity .35s ease;
}

.overdrive.crack-level-1 .gem-crack:nth-child(1),
.overdrive.crack-level-2 .gem-crack:nth-child(-n + 2),
.overdrive.crack-level-3 .gem-crack:nth-child(-n + 3),
.overdrive.crack-level-4 .gem-crack:nth-child(-n + 4) {
  stroke-dashoffset: 0;
  opacity: .9;
}

.overdrive .gem-crack:nth-child(2) { transition-delay: .1s; }
.overdrive .gem-crack:nth-child(3) { transition-delay: .18s; }
.overdrive .gem-crack:nth-child(4) { transition-delay: .26s; }

.phase-discharging .gem-crack {
  opacity: 0;
}

.phase-discharging.crack-level-1 .gem-crack:nth-child(1),
.phase-discharging.crack-level-2 .gem-crack:nth-child(-n + 2),
.phase-discharging.crack-level-3 .gem-crack:nth-child(-n + 3),
.phase-discharging.crack-level-4 .gem-crack:nth-child(-n + 4) {
  opacity: .9;
  animation: crack-reseal var(--discharge-animation-duration) ease-in forwards;
}

.phase-discharging .gem-crack:nth-child(2) { animation-delay: 60ms; }
.phase-discharging .gem-crack:nth-child(3) { animation-delay: 110ms; }
.phase-discharging .gem-crack:nth-child(4) { animation-delay: 160ms; }

.gem-stop-a { stop-color: var(--dial-navy-500); transition: stop-color var(--instrument-motion-material) ease; }
.gem-stop-b { stop-color: var(--dial-navy-650); transition: stop-color var(--instrument-motion-material) ease; }
.gem-stop-c { stop-color: var(--dial-ink-950); transition: stop-color var(--instrument-motion-material) ease; }

.gem-shine {
  transform: translateX(-56px) skewX(-18deg);
  animation: gem-shine var(--instrument-motion-ambient) ease-in-out infinite;
}

.overdrive .gem-body {
  stroke: var(--tier-bright);
  filter: drop-shadow(0 0 var(--gem-glow-radius) var(--tier-shadow));
  animation: gem-resonate calc(var(--surge-speed) * 1.3) ease-in-out infinite alternate;
}

.overdrive .gem-stop-a { stop-color: color-mix(in srgb, var(--tier-color) 55%, #0a1c2c); }
.overdrive .gem-stop-b { stop-color: color-mix(in srgb, var(--tier-color) 25%, #0a1c2c); }

.phase-igniting .core-gem,
.phase-promoting .core-gem {
  animation: gem-kick .55s cubic-bezier(.3, 1.6, .4, 1);
}

.tier-master.overdrive .gem-body { opacity: .18; }
.tier-master.overdrive .gem-energy-core { opacity: .95; }
.tier-master.overdrive .gem-shard { opacity: 1; }
.tier-master.phase-burning .gem-shard-left { transform: translateX(-3px) rotate(-1.8deg); }
.tier-master.phase-burning .gem-shard-right { transform: translateX(3px) rotate(1.8deg); }

.tier-master.phase-rupturing .gem-body { opacity: .12; }
.tier-master.phase-rupturing .gem-energy-core {
  opacity: 1;
  animation: energy-core-rupture 1.05s ease-out both;
}
.tier-master.phase-rupturing .gem-shard { opacity: 1; }
.tier-master.phase-rupturing .gem-shard-left { animation: gem-rupture-left 1.05s cubic-bezier(.2, .8, .3, 1) both; }
.tier-master.phase-rupturing .gem-shard-right { animation: gem-rupture-right 1.05s cubic-bezier(.2, .8, .3, 1) both; }

.tier-master.phase-discharging .gem-body {
  opacity: .18;
  animation: gem-body-restore var(--discharge-duration) ease-in both;
}
.tier-master.phase-discharging .gem-energy-core {
  opacity: 1;
  animation: energy-core-contain var(--discharge-duration) ease-in both;
}
.tier-master.phase-discharging .gem-shard { opacity: 1; }
.tier-master.phase-discharging .gem-shard-left { animation: gem-reassemble-left var(--discharge-duration) ease-in-out both; }
.tier-master.phase-discharging .gem-shard-right { animation: gem-reassemble-right var(--discharge-duration) ease-in-out both; }

.phase-discharging:not(.tier-master) .gem-body {
  animation: gem-glow-contract var(--discharge-duration) ease-in both;
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

/* ---------- overdrive halo: hex glyph orbit and comet ---------- */
.hex-halo {
  display: none;
}

.overdrive .hex-halo,
.phase-discharging .hex-halo {
  position: absolute;
  z-index: 0;
  inset: 0;
  display: block;
  transform-origin: 50% 56.5%;
  pointer-events: none;
}

.phase-igniting .hex-halo,
.phase-promoting .hex-halo,
.phase-rupturing .hex-halo {
  animation: halo-ignite .95s cubic-bezier(.2, 1.3, .4, 1);
}

.phase-discharging .hex-halo {
  animation: halo-discharge var(--discharge-duration) ease-in forwards;
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

.phase-discharging .halo-band-orbit {
  animation: orbit-retract var(--discharge-duration) ease-in both;
}

.phase-discharging .halo-hexes {
  animation: orbit-retract var(--discharge-duration) ease-in both;
}

.phase-discharging .comet-orbit {
  animation: comet-absorb var(--discharge-duration) ease-in both;
}

/* ---------- gem-origin spark emitter ---------- */
.core-sparks {
  position: absolute;
  z-index: 2;
  top: 108px;
  left: 50%;
  display: none;
  width: 0;
  height: 0;
  pointer-events: none;
}

.overdrive .core-sparks,
.phase-discharging .core-sparks {
  display: block;
}

.core-spark {
  position: absolute;
  top: -2px;
  left: -2px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #fff, var(--tier-bright) 45%, transparent 72%);
  box-shadow: 0 0 5px var(--tier-shadow);
  opacity: 0;
}

.overdrive .core-spark.active {
  animation: spark-emit var(--spark-duration) var(--spark-delay) ease-out infinite;
}

.phase-discharging .core-spark.active {
  animation: spark-converge var(--discharge-animation-duration) var(--spark-return-delay) ease-in both;
}

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

.containment-flash {
  position: absolute;
  z-index: 5;
  inset: 0;
  background: radial-gradient(ellipse 42% 52% at 50% 63.5%, transparent 18%, var(--tier-color) 32%, transparent 64%);
  mix-blend-mode: screen;
  pointer-events: none;
  animation: containment-flash var(--discharge-duration) ease-in forwards;
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

/* ---------- tier-driven instrument vibration ---------- */
.phase-burning.overdrive .gauge-svg,
.phase-promoting.overdrive .gauge-svg,
.phase-rupturing.overdrive .gauge-svg {
  animation: core-shake var(--shake-period) linear infinite;
}

.phase-discharging .gauge-svg {
  animation: shake-damp var(--discharge-duration) ease-out both;
}

.hex-shock.imploding .shock-hex {
  animation: shock-implode var(--discharge-animation-duration) ease-in forwards;
}

.hex-shock.imploding .shock-hex-late {
  animation-delay: 70ms;
}

/* ---------- Master rupture runes ---------- */
.master-rupture {
  pointer-events: none;
  opacity: 0;
  transform-box: view-box;
  transform-origin: 160px 108px;
}

.tier-master .master-rupture {
  color: var(--tier-bright);
}

.rupture-ring,
.rupture-rune,
.rupture-rays {
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.rupture-ring { stroke-width: 1.2; }
.rupture-rune { stroke-width: 1; }
.rupture-rays { stroke-width: 1.35; }

.phase-rupturing.tier-master .master-rupture {
  animation: master-rupture 1.05s cubic-bezier(.15, .7, .2, 1) both;
}

.phase-discharging.tier-master .master-rupture {
  animation: rune-implode var(--discharge-duration) ease-in both;
}

@keyframes core-shake {
  0%, 58%, 100% { transform: translate(0, 0); }
  66% { transform: translate(var(--shake-amp), calc(var(--shake-amp) * -.6)); }
  74% { transform: translate(calc(var(--shake-amp) * -1.1), calc(var(--shake-amp) * .6)); }
  82% { transform: translate(calc(var(--shake-amp) * .7), calc(var(--shake-amp) * .4)); }
  90% { transform: translate(calc(var(--shake-amp) * -.4), calc(var(--shake-amp) * -.25)); }
}

@keyframes shake-damp {
  0% { transform: translate(var(--shake-amp), calc(var(--shake-amp) * -.55)); }
  18% { transform: translate(calc(var(--shake-amp) * -.72), calc(var(--shake-amp) * .45)); }
  38% { transform: translate(calc(var(--shake-amp) * .42), calc(var(--shake-amp) * -.25)); }
  62% { transform: translate(calc(var(--shake-amp) * -.18), calc(var(--shake-amp) * .1)); }
  100% { transform: translate(0, 0); }
}

@keyframes cell-charge {
  from { opacity: .5; filter: drop-shadow(0 0 1px var(--cell-glow)); }
  to { opacity: 1; filter: drop-shadow(0 0 5px var(--cell-glow)) brightness(1.35); }
}

@keyframes cell-surge {
  0%, 100% { filter: drop-shadow(0 0 2px var(--cell-glow)) brightness(1); }
  50% { filter: drop-shadow(0 0 6px var(--cell-glow)) brightness(1.6); }
}

@keyframes cell-discharge {
  0% { opacity: 1; filter: drop-shadow(0 0 5px var(--cell-glow)) brightness(1.45); }
  60% { opacity: .72; filter: drop-shadow(0 0 2px var(--cell-glow)) brightness(1.05); }
  100% { opacity: .45; filter: none; }
}

@keyframes cap-vein-discharge {
  0% { stroke: var(--tier-bright); filter: drop-shadow(0 0 3.5px var(--tier-shadow)); }
  70% { stroke: var(--tier-color); filter: drop-shadow(0 0 1px var(--tier-shadow)); }
  100% { stroke: var(--dial-energy-700); filter: none; }
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

@keyframes gem-glow-contract {
  0% { filter: drop-shadow(0 0 var(--gem-glow-radius) var(--tier-shadow)); }
  70% { filter: drop-shadow(0 0 3px var(--tier-shadow)); }
  100% { filter: drop-shadow(0 0 5px rgba(200, 155, 60, .3)); }
}

@keyframes crack-reseal {
  0% { opacity: .95; stroke-dashoffset: 0; }
  65% { opacity: .7; }
  100% { opacity: 0; stroke-dashoffset: -1; }
}

@keyframes gem-rupture-left {
  0% { transform: translateX(0) rotate(0); }
  38% { transform: translateX(-5px) rotate(-3deg); }
  66%, 100% { transform: translateX(-3px) rotate(-1.8deg); }
}

@keyframes gem-rupture-right {
  0% { transform: translateX(0) rotate(0); }
  38% { transform: translateX(5px) rotate(3deg); }
  66%, 100% { transform: translateX(3px) rotate(1.8deg); }
}

@keyframes gem-reassemble-left {
  0% { transform: translateX(-3px) rotate(-1.8deg); }
  72% { transform: translateX(.5px) rotate(.3deg); }
  100% { transform: translateX(0) rotate(0); }
}

@keyframes gem-reassemble-right {
  0% { transform: translateX(3px) rotate(1.8deg); }
  72% { transform: translateX(-.5px) rotate(-.3deg); }
  100% { transform: translateX(0) rotate(0); }
}

@keyframes energy-core-rupture {
  0% { opacity: .45; transform: scale(.76); filter: brightness(1); }
  32% { opacity: 1; transform: scale(1.2); filter: brightness(2.1); }
  100% { opacity: .95; transform: scale(1); filter: brightness(1.2); }
}

@keyframes energy-core-contain {
  0% { opacity: 1; transform: scale(1.08); filter: brightness(1.65); }
  72% { opacity: .38; transform: scale(.82); filter: brightness(1); }
  100% { opacity: 0; transform: scale(.68); filter: brightness(.8); }
}

@keyframes gem-body-restore {
  0%, 62% { opacity: .18; }
  100% { opacity: 1; }
}

@keyframes ignite-flash {
  0% { opacity: .9; }
  100% { opacity: 0; }
}

@keyframes containment-flash {
  0% { opacity: .08; transform: scale(1.22); }
  45% { opacity: .42; }
  100% { opacity: 0; transform: scale(.42); }
}

@keyframes shock-expand {
  0% { opacity: .95; transform: scale(.3) rotate(var(--shock-angle, 0deg)); }
  100% { opacity: 0; transform: scale(3.4) rotate(calc(var(--shock-angle, 0deg) + 24deg)); }
}

@keyframes shock-implode {
  0% { opacity: 0; transform: scale(3.1) rotate(calc(var(--shock-angle, 0deg) + 20deg)); }
  24% { opacity: .68; }
  100% { opacity: 0; transform: scale(.26) rotate(var(--shock-angle, 0deg)); }
}

@keyframes master-rupture {
  0% { opacity: 0; transform: scale(.45) rotate(-12deg); filter: brightness(2); }
  22% { opacity: 1; }
  72% { opacity: .62; }
  100% { opacity: 0; transform: scale(1.62) rotate(18deg); filter: brightness(1); }
}

@keyframes rune-implode {
  0% { opacity: 0; transform: scale(1.55) rotate(18deg); }
  24% { opacity: .72; }
  76% { opacity: .5; }
  100% { opacity: 0; transform: scale(.18) rotate(-8deg); }
}

@keyframes halo-ignite {
  0% { opacity: 0; transform: scale(.82); filter: blur(4px) brightness(2); }
  60% { opacity: 1; transform: scale(1.04); }
  100% { opacity: 1; transform: scale(1); filter: blur(0) brightness(1); }
}

@keyframes halo-discharge {
  0% { opacity: 1; transform: scale(1); filter: none; }
  64% { opacity: .62; transform: scale(.9); }
  100% { opacity: 0; transform: scale(.55); filter: blur(2px) saturate(.35); }
}

@keyframes orbit-spin {
  to { transform: rotate(360deg); }
}

@keyframes orbit-retract {
  0% { opacity: 1; transform: rotate(0) scale(1); }
  100% { opacity: 0; transform: rotate(110deg) scale(.35); }
}

@keyframes comet-absorb {
  0% { opacity: 1; transform: rotate(0) scale(1); }
  60% { opacity: .75; }
  100% { opacity: 0; transform: rotate(220deg) scale(.12); }
}

@keyframes spark-emit {
  0% {
    opacity: 0;
    transform: rotate(var(--spark-angle)) translateX(5px) scale(.25);
  }
  18% { opacity: .96; }
  72% { opacity: .62; }
  100% {
    opacity: 0;
    transform: rotate(var(--spark-angle)) translateX(var(--spark-distance)) scale(var(--spark-scale));
  }
}

@keyframes spark-converge {
  0% {
    opacity: 0;
    transform: rotate(var(--spark-angle)) translateX(var(--spark-distance)) scale(var(--spark-scale));
  }
  24% { opacity: .82; }
  78% { opacity: .5; }
  100% {
    opacity: 0;
    transform: rotate(var(--spark-angle)) translateX(3px) scale(.18);
  }
}

@media (prefers-reduced-motion: reduce) {
  .momentum-gauge,
  .momentum-gauge * {
    animation: none !important;
    transition: none !important;
  }
  .momentum-gauge .gem-crack { transition: none !important; }
  .core-sparks,
  .master-rupture,
  .ignite-flash,
  .containment-flash,
  .hex-shock { display: none; }
}
</style>
