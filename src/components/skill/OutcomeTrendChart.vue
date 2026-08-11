<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { escapeTooltip } from "../../charts/formatters"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"

const props = defineProps<{
  rows: Array<{ label: string; games: number; wins?: number; winRate: number }>
}>()

const option = computed<EChartsCoreOption>(() => ({
  animationDuration: 520,
  grid: { top: 12, right: 48, bottom: 34, left: 42 },
  tooltip: {
    trigger: "axis",
    axisPointer: { type: "cross" },
    formatter: (params: Array<{ dataIndex: number }>) => {
      const row = props.rows[params[0]?.dataIndex]
      if (!row) return ""
      const wins = row.wins ?? Math.round(row.winRate * row.games)
      return `<strong>${escapeTooltip(row.label)}</strong><br/>${row.games} games<br/>${wins} wins · ${Math.round(row.winRate * 100)}% win rate`
    },
  },
  xAxis: {
    type: "category",
    data: props.rows.map((row) => row.label),
    axisTick: { alignWithLabel: true },
    axisLabel: { fontSize: 11 },
  },
  yAxis: [
    {
      type: "value",
      name: "Games",
      minInterval: 1,
      axisLabel: { formatter: (value: number) => `${Math.round(value)}` },
      splitLine: { show: false },
    },
    {
      type: "value",
      name: "Win rate",
      min: 0,
      max: 100,
      axisLabel: { formatter: (value: number) => `${value}%` },
      splitLine: { lineStyle: { color: CHART_STYLES.grid } },
    },
  ],
  series: [
    {
      name: "Recorded games",
      type: "bar",
      yAxisIndex: 0,
      barMaxWidth: 32,
      data: props.rows.map((row) => ({
        value: row.games,
        itemStyle: {
          color: row.games === 0 ? CHART_STYLES.neutralFill : row.winRate >= 0.5
            ? CHART_STYLES.positiveFill
            : CHART_STYLES.negativeFill,
          borderColor: row.winRate >= 0.5 ? CHART_COLOURS.positive : CHART_COLOURS.negative,
          borderWidth: 1,
          borderRadius: [4, 4, 0, 0],
        },
      })),
    },
    {
      name: "Recorded win rate",
      type: "line",
      yAxisIndex: 1,
      smooth: 0.32,
      connectNulls: false,
      symbolSize: 8,
      lineStyle: { color: CHART_COLOURS.live, width: 2.5 },
      itemStyle: { color: CHART_COLOURS.text, borderColor: CHART_COLOURS.live, borderWidth: 2 },
      areaStyle: { color: CHART_STYLES.liveArea },
      data: props.rows.map((row) => row.games ? Math.round(row.winRate * 100) : null),
    },
  ],
}))
</script>

<template>
  <div class="outcome-trend">
    <BaseEChart :option="option" ariaLabel="Games played and win rate by Recall grade band" />
  </div>
  <ul class="outcome-key">
    <li v-for="row in rows" :key="row.label" :class="{ empty: !row.games }">
      <span class="band-label">{{ row.label }}</span>
      <span class="numeric rate" :class="row.winRate >= 0.5 ? 'positive' : 'negative'">
        {{ row.games ? `${Math.round(row.winRate * 100)}%` : "–" }}
      </span>
      <span class="muted numeric">{{ row.games }} games</span>
    </li>
  </ul>
</template>

<style scoped>
.outcome-trend {
  height: 240px;
  position: relative;
}

.outcome-key {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: var(--space-2);
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
  font-size: 11px;
}

.outcome-key li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2);
  padding: var(--space-2);
  border-left: 2px solid var(--cyan);
  background: var(--surface-2);
}

.outcome-key .band-label { color: var(--text-primary); }
.outcome-key .rate { font-size: 12px; }
.outcome-key .positive { color: var(--win); }
.outcome-key .negative { color: var(--loss); }
.outcome-key .empty { border-left-color: var(--border-subtle); opacity: 0.55; }
</style>
