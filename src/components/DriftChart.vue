<script setup lang="ts">
import { computed } from "vue"
import type { EChartsCoreOption } from "echarts/core"
import BaseEChart from "./charts/BaseEChart.vue"
import { CHART_COLOURS } from "../charts/recall-chart-theme"
import type { StyleAxis } from "../types/stats"
import { driftSeries } from "../charts/evidence-adapters"

const props = defineProps<{
  windows: { label: string; axes: StyleAxis[] }[]
}>()

const COLOURS = [
  CHART_COLOURS.gold,
  CHART_COLOURS.cyan,
  CHART_COLOURS.negative,
  CHART_COLOURS.textSecondary,
  CHART_COLOURS.cyanDark,
  CHART_COLOURS.goldBright,
]

const series = computed(() => (props.windows[0]?.axes ?? []).map((axis, index) => ({
  name: axis.label,
  type: "line" as const,
  data: driftSeries(props.windows, axis.key),
  symbolSize: 5,
  lineStyle: { color: COLOURS[index % COLOURS.length], width: 1.5 },
  itemStyle: { color: COLOURS[index % COLOURS.length] },
  smooth: 0.25,
  connectNulls: false,
})))

const option = computed<EChartsCoreOption>(() => ({
  grid: { left: 44, right: 16, top: 12, bottom: 32 },
  tooltip: { trigger: "axis" },
  xAxis: {
    type: "category",
    data: props.windows.map((window) => window.label),
    axisLabel: { fontSize: 11, hideOverlap: true },
  },
  yAxis: {
    type: "value",
    min: 0,
    max: 100,
    axisLabel: { fontSize: 11, formatter: (value: number) => `${value}%` },
  },
  series: series.value,
}))
</script>

<template>
  <div>
    <BaseEChart
      :option="option"
      ariaLabel="Playstyle measurements across consecutive game windows."
      height="200px"
    />
    <ul class="key">
      <li v-for="(set, index) in series" :key="set.name">
        <span class="swatch" :style="{ background: COLOURS[index % COLOURS.length] }" />
        <span class="muted">{{ set.name }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.key {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
  font-size: 11px;
}

.key li {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.swatch {
  width: 10px;
  height: 2px;
  border-radius: 1px;
}
</style>
