<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue"
import GradeBadge from "./GradeBadge.vue"
import { reviewMatch } from "../helpers/navigation"
import {
  championIconUrl,
  championNameById,
  formatCompact,
  formatDecimal,
  formatDuration,
  formatRelativeDate,
  modeLabel,
} from "../helpers/format"
import type { Champion } from "../types/lol"
import type { MatchRow } from "../types/stats"

const props = defineProps<{
  /** Newest game first, as the stats API returns it. */
  matches: MatchRow[]
  champions: Champion[] | null
}>()

/**
 * Recall Score is the authoritative frozen-reference percentile, so the trend uses
 * its fixed 0-100 scale rather than auto-scaling. A flat run stays flat instead
 * of being stretched by a rounding-sized difference.
 */
const SCORE_FLOOR = 0
const SCORE_CEILING = 100
const VIEW_WIDTH = 100
const VIEW_HEIGHT = 34
const VIEW_PAD = 3

/** SVG gradient ids are document-global, so each instance needs its own. */
let instances = 0
const gradientId = `form-trend-${++instances}`

const ordered = computed(() => [...props.matches].reverse())

const points = computed(() => {
  const count = ordered.value.length
  const span = VIEW_HEIGHT - VIEW_PAD * 2

  return ordered.value.map((match, index) => {
    const x = count === 1
      ? VIEW_WIDTH / 2
      : ((index + 0.5) / count) * VIEW_WIDTH
    const score = match.recallScore
    if (score === undefined) return { match, index, x, y: undefined }

    const clamped = Math.min(SCORE_CEILING, Math.max(SCORE_FLOOR, score))
    const ratio = (clamped - SCORE_FLOOR) / (SCORE_CEILING - SCORE_FLOOR)
    return { match, index, x, y: VIEW_PAD + (1 - ratio) * span }
  })
})

const graded = computed(() =>
  points.value.filter(
    (point): point is typeof point & { y: number } => point.y !== undefined,
  ),
)

const linePath = computed(() =>
  graded.value
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" "),
)

/** The area closes on the floor so the fill reads as depth, not a second series. */
const areaPath = computed(() => {
  if (graded.value.length < 2) return ""
  const first = graded.value[0]
  const last = graded.value[graded.value.length - 1]
  return [
    `${first.x.toFixed(2)},${VIEW_HEIGHT}`,
    linePath.value,
    `${last.x.toFixed(2)},${VIEW_HEIGHT}`,
  ].join(" ")
})

const midline = VIEW_PAD + (VIEW_HEIGHT - VIEW_PAD * 2) / 2

const activeIndex = ref<number | null>(null)
const popoverStyle = ref<Record<string, string>>({})
let activeTrigger: HTMLElement | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined

const activeMatch = computed(() =>
  activeIndex.value === null ? undefined : ordered.value[activeIndex.value])

const championName = (championId: number) =>
  championNameById(props.champions, championId)

function place() {
  if (!activeTrigger) return
  const rect = activeTrigger.getBoundingClientRect()
  const gutter = 12
  const width = Math.min(268, window.innerWidth - gutter * 2)
  const centred = rect.left + rect.width / 2 - width / 2
  const left = Math.max(
    gutter,
    Math.min(centred, window.innerWidth - width - gutter),
  )
  const opensAbove = rect.top > 230

  popoverStyle.value = {
    left: `${left}px`,
    width: `${width}px`,
    ...(opensAbove
      ? { bottom: `${window.innerHeight - rect.top + 8}px`, top: "auto" }
      : { top: `${rect.bottom + 8}px`, bottom: "auto" }),
  }
}

function open(index: number, event: Event) {
  if (closeTimer) clearTimeout(closeTimer)
  activeTrigger = event.currentTarget as HTMLElement
  activeIndex.value = index
  place()
  window.addEventListener("scroll", place, true)
  window.addEventListener("resize", place)
}

function close() {
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = setTimeout(() => {
    activeIndex.value = null
    activeTrigger = undefined
    window.removeEventListener("scroll", place, true)
    window.removeEventListener("resize", place)
  }, 80)
}

onBeforeUnmount(() => {
  if (closeTimer) clearTimeout(closeTimer)
  window.removeEventListener("scroll", place, true)
  window.removeEventListener("resize", place)
})
</script>

<template>
  <div class="form-strip">
    <div v-if="ordered.length === 0" class="empty muted">No games recorded</div>

    <template v-else>
      <div class="trend-shell">
        <svg
          class="trend"
          :viewBox="`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`"
          preserveAspectRatio="none"
          role="img"
          aria-label="Performance grade across the recent form window"
        >
          <defs>
            <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--gold)" stop-opacity="0.26" />
              <stop offset="100%" stop-color="var(--gold)" stop-opacity="0" />
            </linearGradient>
          </defs>

          <line
            class="midline"
            x1="0"
            :y1="midline"
            :x2="VIEW_WIDTH"
            :y2="midline"
            vector-effect="non-scaling-stroke"
          />

          <polygon v-if="areaPath" :points="areaPath" :fill="`url(#${gradientId})`" />

          <polyline
            v-if="graded.length > 1"
            class="line"
            :points="linePath"
            vector-effect="non-scaling-stroke"
          />
        </svg>

        <span
          v-for="point in graded"
          :key="point.index"
          class="trend-node"
          :class="{ active: activeIndex === point.index }"
          :style="{
            left: `${point.x}%`,
            top: `${(point.y / VIEW_HEIGHT) * 100}%`,
          }"
          aria-hidden="true"
        />
      </div>

      <div class="pills" :style="{ '--count': String(ordered.length) }">
        <span v-for="point in points" :key="point.match.gameId" class="slot">
          <button
            type="button"
            class="pill"
            :class="{
              win: point.match.win === 1,
              loss: point.match.win !== 1,
              latest: point.index === ordered.length - 1,
              active: activeIndex === point.index,
            }"
            :aria-label="`${point.match.win === 1 ? 'Win' : 'Loss'} on ${championName(point.match.championId)}, open the review`"
            @mouseenter="open(point.index, $event)"
            @focus="open(point.index, $event)"
            @mouseleave="close"
            @blur="close"
            @click="reviewMatch(point.match.gameId)"
          >
            {{ point.match.win === 1 ? "W" : "L" }}
          </button>
        </span>
      </div>
    </template>

    <Teleport to="body">
      <aside v-if="activeMatch" class="form-popover" :style="popoverStyle">
        <header class="pop-head">
          <img
            class="pop-portrait"
            :src="championIconUrl(activeMatch.championId)"
            :alt="championName(activeMatch.championId)"
          />
          <div class="pop-title">
            <strong>{{ championName(activeMatch.championId) }}</strong>
            <small class="muted">
              {{ activeMatch.queueName ?? modeLabel(activeMatch.mode) }} ·
              {{ formatRelativeDate(activeMatch.playedAt) }}
            </small>
          </div>
          <GradeBadge :grade="activeMatch.grade" :status="activeMatch.gradeStatus" />
        </header>

        <div class="pop-stats">
          <div>
            <span class="muted">Result</span>
            <strong :class="activeMatch.win === 1 ? 'win-text' : 'loss-text'">
              {{ activeMatch.win === 1 ? "Victory" : "Defeat" }}
            </strong>
          </div>
          <div>
            <span class="muted">KDA</span>
            <strong class="numeric">
              {{ activeMatch.kills }}/{{ activeMatch.deaths }}/{{ activeMatch.assists }}
            </strong>
          </div>
          <div>
            <span class="muted">Damage</span>
            <strong class="numeric">
              {{ formatCompact(activeMatch.damageToChampions) }}
            </strong>
          </div>
          <div>
            <span class="muted">CS/min</span>
            <strong class="numeric">
              {{ formatDecimal(activeMatch.csPerMin, 1) }}
            </strong>
          </div>
          <div>
            <span class="muted">Gold/min</span>
            <strong class="numeric">{{ Math.round(activeMatch.goldPerMin) }}</strong>
          </div>
          <div>
            <span class="muted">Length</span>
            <strong class="numeric">
              {{ formatDuration(activeMatch.durationSecs) }}
            </strong>
          </div>
        </div>

        <footer class="muted pop-foot">Click to open the review</footer>
      </aside>
    </Teleport>
  </div>
</template>

<style scoped>
.form-strip {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.trend-shell {
  position: relative;
  height: 46px;
}

.trend {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.midline {
  stroke: var(--border-subtle);
  stroke-width: 1;
  stroke-dasharray: 2 4;
}

.line {
  fill: none;
  stroke: var(--gold);
  stroke-width: 1.25;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.trend-node {
  position: absolute;
  width: 6px;
  height: 6px;
  pointer-events: none;
  background: var(--gold-mid);
  border: 1px solid rgba(4, 9, 16, .82);
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(200, 170, 109, .16);
  transform: translate(-50%, -50%);
  transition:
    width .12s ease,
    height .12s ease,
    background .12s ease,
    box-shadow .12s ease;
}

.trend-node.active {
  width: 9px;
  height: 9px;
  background: var(--gold-bright);
  box-shadow:
    0 0 0 2px rgba(200, 170, 109, .18),
    0 0 10px rgba(240, 211, 116, .48);
}

/* No gap between cells, so each pill centres exactly under its trend point. */
.pills {
  display: grid;
  grid-template-columns: repeat(var(--count), minmax(0, 1fr));
}

.slot {
  display: block;
  padding-inline: 2px;
  min-width: 0;
}

.pill {
  display: grid;
  place-items: center;
  width: 100%;
  height: 26px;
  padding: 0;
  font-family: var(--font-display);
  font-size: 11px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  cursor: pointer;
  transition:
    transform 0.12s ease,
    box-shadow 0.12s ease,
    border-color 0.12s ease;
}

.pill.win {
  background: linear-gradient(180deg, rgba(10, 203, 230, 0.22), var(--win-dim));
  border-color: rgba(10, 203, 230, 0.55);
  color: var(--win);
}

.pill.loss {
  background: linear-gradient(180deg, rgba(232, 64, 87, 0.2), var(--loss-dim));
  border-color: rgba(232, 64, 87, 0.5);
  color: var(--loss);
}

.pill.latest {
  box-shadow: inset 0 0 0 1px var(--gold-faint);
}

.pill:hover,
.pill.active,
.pill:focus-visible {
  transform: translateY(-2px);
  border-color: var(--gold);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.36);
  outline: none;
}

.empty {
  font-size: 12px;
}

.form-popover {
  position: fixed;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  background:
    radial-gradient(circle at 25% 0, rgba(35, 71, 94, 0.34), transparent 40%),
    linear-gradient(145deg, #080d17, #101725);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.68);
  color: var(--text-primary);
  pointer-events: none;
}

.pop-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.pop-portrait {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

.pop-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin-right: auto;
}

.pop-title strong {
  font-family: var(--font-heading);
  font-size: 13px;
  letter-spacing: 0.4px;
  color: var(--gold-bright);
}

.pop-title small {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pop-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-subtle);
}

.pop-stats > div {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.pop-stats span {
  font-size: 11px;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.pop-stats strong {
  font-size: 12px;
  font-weight: 500;
}

.pop-foot {
  font-size: 12px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
}
</style>
