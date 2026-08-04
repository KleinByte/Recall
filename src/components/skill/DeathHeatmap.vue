<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed, ref } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { escapeTooltip } from "../../charts/formatters"
import type { SkillDeathMap, SkillDeathPoint } from "../../types/stats"

type DeathPhase = "all" | "early" | "mid" | "late"
type VisualizationMode = "heat" | "dots"

const props = defineProps<{ map: SkillDeathMap }>()
const phase = ref<DeathPhase>("all")
const visualization = ref<VisualizationMode>("heat")

const phases: Array<{ key: DeathPhase; label: string; detail: string }> = [
  { key: "all", label: "All", detail: "all game" },
  { key: "early", label: "Early", detail: "before 15 min" },
  { key: "mid", label: "Mid", detail: "15–30 min" },
  { key: "late", label: "Late", detail: "after 30 min" },
]
const visualizationModes: Array<{ key: VisualizationMode; label: string }> = [
  { key: "heat", label: "Heat overlay" },
  { key: "dots", label: "Death dots" },
]

const HEAT_STOPS = [
  { at: 0, color: [44, 202, 255] },
  { at: .3, color: [69, 226, 167] },
  { at: .58, color: [255, 216, 102] },
  { at: .8, color: [255, 126, 69] },
  { at: 1, color: [255, 48, 88] },
] as const

function heatColor(intensity: number) {
  const upperIndex = HEAT_STOPS.findIndex((stop) => intensity <= stop.at)
  const upper = HEAT_STOPS[upperIndex < 0 ? HEAT_STOPS.length - 1 : upperIndex]
  const lower = HEAT_STOPS[Math.max(0, (upperIndex < 0 ? HEAT_STOPS.length - 1 : upperIndex) - 1)]
  const range = upper.at - lower.at
  const amount = range > 0 ? (intensity - lower.at) / range : 0
  const channels = upper.color.map((channel, index) =>
    Math.round(lower.color[index] + (channel - lower.color[index]) * amount),
  )
  return `rgb(${channels.join(", ")})`
}

function phaseFor(death: SkillDeathPoint): Exclude<DeathPhase, "all"> {
  if (death.timestamp < 15 * 60_000) return "early"
  if (death.timestamp < 30 * 60_000) return "mid"
  return "late"
}

const phaseCounts = computed(() => {
  const counts = { all: props.map.deaths.length, early: 0, mid: 0, late: 0 }
  for (const death of props.map.deaths) counts[phaseFor(death)] += 1
  return counts
})

const visibleDeaths = computed(() => phase.value === "all"
  ? props.map.deaths
  : props.map.deaths.filter((death) => phaseFor(death) === phase.value))

const visibleGames = computed(() => new Set(visibleDeaths.value.map((death) => death.gameId)).size)

const BIN_SIZE = 475
const densityPoints = computed(() => {
  const bins = new Map<string, { x: number; y: number; count: number; timestamp: number }>()
  for (const death of visibleDeaths.value) {
    const key = `${Math.floor(death.x / BIN_SIZE)}:${Math.floor(death.y / BIN_SIZE)}`
    const bin = bins.get(key) ?? { x: 0, y: 0, count: 0, timestamp: 0 }
    bin.x += death.x
    bin.y += death.y
    bin.timestamp += death.timestamp
    bin.count += 1
    bins.set(key, bin)
  }

  const maxCount = Math.max(1, ...[...bins.values()].map((bin) => bin.count))
  return [...bins.values()].map((bin) => {
    const intensity = Math.log1p(bin.count) / Math.log1p(maxCount)
    const color = heatColor(intensity)
    return {
      value: [bin.x / bin.count, bin.y / bin.count, bin.count, bin.timestamp / bin.count],
      itemStyle: {
        color,
        opacity: .8 + intensity * .16,
        shadowBlur: 5 + intensity * 10,
        shadowColor: color,
        borderColor: "rgba(255, 255, 255, .72)",
        borderWidth: .6,
      },
    }
  })
})

const maxDensity = computed(() => Math.max(
  1,
  ...densityPoints.value.map((point) => Number(point.value[2]) || 1),
))

function pointSize(raw: unknown) {
  const values = Array.isArray(raw) ? raw : []
  const count = typeof values[2] === "number" ? values[2] : 1
  const normalized = Math.sqrt(count / maxDensity.value)
  return 5 + normalized * 13
}

const rankedHotspots = computed(() => [...densityPoints.value].sort((left, right) =>
  right.value[2] - left.value[2] || left.value[3] - right.value[3],
))
const chartPoints = computed(() => [...rankedHotspots.value].reverse())

const HEAT_BIN_SIZE = 250
const HEAT_RADIUS = 3
const HEAT_SIGMA = 1.35
const HEAT_CELL_COUNT = Math.ceil(15_000 / HEAT_BIN_SIZE)
const heatAxisCategories = Array.from({ length: HEAT_CELL_COUNT }, (_, index) => String(index))
const heatPoints = computed(() => {
  const cells = new Map<string, {
    density: number
    deaths: number
    timestamp: number
    games: Set<number>
  }>()

  for (const death of visibleDeaths.value) {
    const centerX = Math.floor(death.x / HEAT_BIN_SIZE)
    const centerY = Math.floor(death.y / HEAT_BIN_SIZE)
    for (let offsetX = -HEAT_RADIUS; offsetX <= HEAT_RADIUS; offsetX += 1) {
      for (let offsetY = -HEAT_RADIUS; offsetY <= HEAT_RADIUS; offsetY += 1) {
        const x = centerX + offsetX
        const y = centerY + offsetY
        if (x < 0 || y < 0 || x >= HEAT_CELL_COUNT || y >= HEAT_CELL_COUNT) continue
        const distanceSquared = offsetX ** 2 + offsetY ** 2
        const weight = Math.exp(-distanceSquared / (2 * HEAT_SIGMA ** 2))
        const key = `${x}:${y}`
        const cell = cells.get(key) ?? {
          density: 0,
          deaths: 0,
          timestamp: 0,
          games: new Set<number>(),
        }
        cell.density += weight
        cell.deaths += 1
        cell.timestamp += death.timestamp
        cell.games.add(death.gameId)
        cells.set(key, cell)
      }
    }
  }

  return [...cells.entries()].map(([key, cell]) => {
    const [x, y] = key.split(":").map(Number)
    return [
      x,
      y,
      cell.density,
      cell.deaths,
      cell.timestamp / cell.deaths,
      cell.games.size,
    ]
  })
})

const maxHeatDensity = computed(() => Math.max(1, ...heatPoints.value.map((point) => point[2])))

function areaForCoordinates(x: number, y: number) {
  if (x < 3_200 && y < 3_200) return "Blue base"
  if (x > 11_800 && y > 11_800) return "Red base"
  if (Math.abs(y - x) < 1_700) return "Mid lane"
  return y > x ? "Top-side Rift" : "Bot-side Rift"
}

function hotspotArea(point: { value: number[] }) {
  return areaForCoordinates(point.value[0], point.value[1])
}

const option = computed<EChartsCoreOption>(() => ({
  backgroundColor: "transparent",
  grid: { top: 0, right: 0, bottom: 0, left: 0 },
  tooltip: {
    trigger: "item",
    confine: true,
    formatter: (raw: unknown) => {
      const item = raw as { data?: number[] | { value?: number[] } }
      const values = Array.isArray(item.data) ? item.data : item.data?.value ?? []
      if (visualization.value === "heat") {
        const nearbyDeaths = Number(values[3]) || 0
        const averageMinute = (Number(values[4]) || 0) / 60_000
        const games = Number(values[5]) || 0
        const share = visibleDeaths.value.length > 0 ? nearbyDeaths / visibleDeaths.value.length : 0
        const x = ((Number(values[0]) || 0) + .5) * HEAT_BIN_SIZE
        const y = ((Number(values[1]) || 0) + .5) * HEAT_BIN_SIZE
        return [
          `<strong>${escapeTooltip(areaForCoordinates(x, y))}</strong>`,
          `${nearbyDeaths} nearby death${nearbyDeaths === 1 ? "" : "s"} across ${games} game${games === 1 ? "" : "s"}`,
          `${Math.round(share * 100)}% of deaths in this selection`,
          `Average death · ${escapeTooltip(averageMinute.toFixed(1))} min`,
        ].join("<br/>")
      }
      const count = Number(values[2]) || 0
      const averageMinute = (Number(values[3]) || 0) / 60_000
      const share = visibleDeaths.value.length > 0 ? count / visibleDeaths.value.length : 0
      return [
        `<strong>${count} death${count === 1 ? "" : "s"}</strong> in this area`,
        `${Math.round(share * 100)}% of visible deaths`,
        `Average time · ${escapeTooltip(averageMinute.toFixed(1))} min`,
      ].join("<br/>")
    },
  },
  // ECharts requires Cartesian heatmaps to use category axes. The hidden
  // second axis pair overlays the value axes used by the precise dot view.
  xAxis: [
    { type: "value", min: 0, max: 15_000, show: false },
    { type: "category", data: heatAxisCategories, boundaryGap: true, show: false },
  ],
  yAxis: [
    { type: "value", min: 0, max: 15_000, show: false },
    { type: "category", data: heatAxisCategories, boundaryGap: true, show: false },
  ],
  visualMap: visualization.value === "heat" ? {
    show: false,
    min: 0,
    max: maxHeatDensity.value,
    dimension: 2,
    seriesIndex: 0,
    inRange: {
      color: [
        "rgba(44, 202, 255, .04)",
        "rgba(44, 202, 255, .28)",
        "rgba(69, 226, 167, .48)",
        "rgba(255, 216, 102, .64)",
        "rgba(255, 126, 69, .78)",
        "rgba(255, 48, 88, .9)",
      ],
    },
  } : [],
  series: visualization.value === "heat" ? [{
    name: "Death density",
    type: "heatmap",
    xAxisIndex: 1,
    yAxisIndex: 1,
    data: heatPoints.value,
    progressive: 1_000,
    emphasis: { disabled: true },
    itemStyle: { borderWidth: 0 },
    z: 1,
  }] : [{
    name: "Deaths",
    type: "scatter",
    symbolSize: (raw: unknown) => pointSize(raw),
    data: chartPoints.value,
    emphasis: { scale: 1.16 },
    z: 1,
  }],
}))

const ariaLabel = computed(() =>
  `Summoner's Rift death density map showing ${visibleDeaths.value.length} deaths across ${visibleGames.value} games for the selected ${phases.find((entry) => entry.key === phase.value)?.detail} phase as a ${visualization.value === "heat" ? "continuous heat overlay" : "clustered dot view"}.`,
)
</script>

<template>
  <section class="card death-map-panel">
    <header class="death-map-head">
      <div>
        <p class="eyebrow">Positioning</p>
        <h2 class="section-title">Death density</h2>
        <p class="muted map-summary">
          {{ visibleDeaths.length }} deaths across {{ visibleGames }} games
          <span v-if="phase !== 'all'"> · {{ phases.find((entry) => entry.key === phase)?.detail }}</span>
        </p>
      </div>
      <div class="heatmap-controls">
        <div class="phase-picker" aria-label="Death map game phase">
          <button
            v-for="entry in phases"
            :key="entry.key"
            type="button"
            class="phase-button"
            :class="{ active: phase === entry.key }"
            :aria-pressed="phase === entry.key"
            :title="`${entry.detail} · ${phaseCounts[entry.key]} deaths`"
            @click="phase = entry.key"
          >
            {{ entry.label }}
            <span>{{ phaseCounts[entry.key] }}</span>
          </button>
        </div>
        <div class="view-picker" aria-label="Death map visualization">
          <button
            v-for="entry in visualizationModes"
            :key="entry.key"
            type="button"
            class="view-button"
            :class="{ active: visualization === entry.key }"
            :aria-pressed="visualization === entry.key"
            @click="visualization = entry.key"
          >
            {{ entry.label }}
          </button>
        </div>
      </div>
    </header>

    <div class="map-layout">
      <div class="map-stage">
        <BaseEChart
          class="map-chart"
          :option="option"
          :ariaLabel="ariaLabel"
          :replaceMerge="['series', 'visualMap']"
          height="100%"
        />
        <span class="base-label red-base">Red base</span>
        <span class="base-label blue-base">Blue base</span>
        <div v-if="visibleDeaths.length === 0" class="empty-phase">
          No deaths recorded in this phase.
        </div>
      </div>
      <aside class="hotspot-aside">
        <div>
          <p class="aside-label">Most repeated locations</p>
          <h3>Hot zones</h3>
        </div>
        <ol v-if="rankedHotspots.length" class="hotspot-list" aria-label="Ranked death hotspots">
          <li v-for="(hotspot, index) in rankedHotspots.slice(0, 5)" :key="`${hotspot.value[0]}:${hotspot.value[1]}`">
            <span class="hotspot-rank">{{ index + 1 }}</span>
            <span class="hotspot-area">{{ hotspotArea(hotspot) }}</span>
            <strong class="numeric">{{ hotspot.value[2] }}</strong>
            <span class="muted">deaths · avg {{ (hotspot.value[3] / 60_000).toFixed(1) }} min</span>
          </li>
        </ol>
        <p v-else class="muted no-hotspots">No hotspots in this phase.</p>
        <p class="muted map-note">
          {{ visualization === "heat" ? "Warmer areas show greater continuous death density." : "Brighter dots contain more deaths." }}
          Uses the mode, season, role, and champion filters above. {{ map.timelineGames }} timeline games are available.
        </p>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.death-map-panel {
  padding: var(--space-4);
  min-width: 0;
}

.death-map-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.eyebrow {
  margin: 0 0 3px;
  color: var(--gold, #c8aa6d);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
}

.section-title,
.map-summary,
.map-note {
  margin: 0;
}

.map-summary {
  margin-top: 3px;
  font-size: 11px;
}

.phase-picker {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  border: 1px solid rgba(200, 170, 109, .18);
  border-radius: 8px;
  background: rgba(3, 10, 20, .48);
}

.heatmap-controls {
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.view-picker {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  border: 1px solid rgba(200, 170, 109, .2);
  border-radius: 8px;
  background: rgba(3, 10, 20, .48);
}

.view-button {
  min-height: 28px;
  padding: 4px 9px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted, #a09b8c);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.view-button:hover,
.view-button.active {
  background: rgba(44, 202, 255, .13);
  color: var(--text-primary, #f0e6d2);
}

.phase-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 4px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted, #a09b8c);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.phase-button span {
  color: var(--text-faint, #6b6863);
  font-variant-numeric: tabular-nums;
}

.phase-button:hover,
.phase-button.active {
  background: rgba(200, 170, 109, .15);
  color: var(--text, #f0e6d2);
}

.phase-button.active span {
  color: var(--gold, #c8aa6d);
}

.map-layout {
  display: grid;
  grid-template-columns: minmax(420px, 1.55fr) minmax(220px, .65fr);
  align-items: start;
  gap: clamp(16px, 2.5vw, 30px);
}

.map-stage {
  position: relative;
  justify-self: end;
  width: 100%;
  max-width: 780px;
  aspect-ratio: 1;
  overflow: hidden;
  border: 1px solid rgba(200, 170, 109, .24);
  border-radius: 10px;
  background-image:
    linear-gradient(rgba(1, 7, 13, .16), rgba(1, 7, 13, .28)),
    url("/summoners-rift-base.webp");
  background-position: center;
  background-size: 100% 100%;
  box-shadow: inset 0 0 36px rgba(0, 0, 0, .4);
}

.map-chart {
  position: absolute;
  inset: 0;
}

.base-label {
  position: absolute;
  z-index: 3;
  padding: 3px 6px;
  border-radius: 4px;
  background: rgba(2, 9, 16, .7);
  color: rgba(240, 230, 210, .76);
  font-size: 11px;
  letter-spacing: .04em;
  pointer-events: none;
}

.red-base {
  top: 8px;
  right: 8px;
}

.blue-base {
  bottom: 8px;
  left: 8px;
}

.empty-phase {
  position: absolute;
  z-index: 4;
  top: 50%;
  left: 50%;
  padding: 8px 11px;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(200, 170, 109, .32);
  border-radius: 7px;
  background: rgba(3, 10, 20, .88);
  color: #f0e6d2;
  font-size: 11px;
  pointer-events: none;
}

.map-note {
  margin: auto 0 0;
  padding-top: var(--space-3);
  border-top: 1px solid rgba(200, 170, 109, .12);
  font-size: 12px;
  line-height: 1.45;
}

.hotspot-aside {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: var(--space-3);
  border: 1px solid rgba(200, 170, 109, .14);
  border-radius: 9px;
  background: linear-gradient(180deg, rgba(12, 25, 43, .78), rgba(3, 10, 20, .42));
}

.aside-label {
  margin: 0 0 4px;
  color: var(--cyan, #0acbe6);
  font-size: 10px;
  letter-spacing: .12em;
  text-transform: uppercase;
}

.hotspot-aside h3 {
  margin: 0;
  color: var(--text-primary, #f0e6d2);
  font-family: var(--font-heading);
  font-size: 14px;
}

.no-hotspots { margin: var(--space-4) 0; font-size: 11px; }

.hotspot-list {
  display: grid;
  gap: 6px;
  margin: var(--space-3) 0;
  padding: 0;
  list-style: none;
}

.hotspot-list li {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  align-items: center;
  gap: 2px 7px;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid rgba(200, 170, 109, .12);
  border-radius: 6px;
  background: rgba(3, 10, 20, .36);
  font-size: 12px;
}

.hotspot-rank {
  grid-row: 1 / span 2;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(255, 126, 69, .16);
  color: #ff9b57;
  font-size: 11px;
  font-weight: 700;
}

.hotspot-area {
  overflow: hidden;
  color: var(--text-primary, #f0e6d2);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hotspot-list li > .muted {
  grid-column: 2 / span 2;
  font-size: 11px;
}

@media (max-width: 920px) {
  .map-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .map-stage {
    justify-self: center;
    max-width: 720px;
  }

  .hotspot-aside {
    min-height: 0;
  }

  .hotspot-list {
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }
}

@media (max-width: 560px) {
  .death-map-panel {
    padding: var(--space-3);
  }

  .death-map-head {
    align-items: stretch;
  }

  .phase-picker {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    width: 100%;
  }

  .heatmap-controls,
  .view-picker {
    width: 100%;
  }

  .view-button {
    flex: 1;
  }

  .phase-button {
    justify-content: center;
    padding-inline: 4px;
  }

  .map-stage {
    border-radius: 7px;
  }

  .hotspot-list {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
