<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"
import { escapeTooltip } from "../../charts/formatters"
import { championNameById } from "../../helpers/format"
import type { SkillHistoryPoint } from "../../types/stats"
import type { Champion } from "../../types/lol"

const props = defineProps<{
  history: SkillHistoryPoint[]
  champions: Champion[] | null
}>()

const graded = computed(() => props.history.filter((game) => Number.isFinite(game.recallScore)))
const rollingWindow = computed(() => graded.value.length >= 14 ? 7 : graded.value.length >= 8 ? 5 : 3)
const rolling = computed(() => graded.value.map((_, index) => {
  if (index + 1 < rollingWindow.value) return null
  const values = graded.value
    .slice(index + 1 - rollingWindow.value, index + 1)
    .map((row) => row.recallScore!)
  return values.reduce((sum, value) => sum + value, 0) / values.length
}))

const option = computed<EChartsCoreOption>(() => ({
  grid: { top: 28, right: 28, bottom: graded.value.length > 30 ? 68 : 44, left: 48 },
  tooltip: {
    trigger: "axis",
    formatter: (params: Array<{ dataIndex: number }>) => {
      const game = graded.value[params[0]?.dataIndex]
      if (!game) return ""
      return [
        `<strong>${escapeTooltip(game.grade ?? "Ungraded")}</strong> · ${escapeTooltip(championNameById(props.champions, game.championId))}`,
        new Date(game.playedAt).toLocaleString(),
        `${game.win ? "Win" : "Loss"} · Recall Score ${game.recallScore?.toFixed(1)}`,
      ].join("<br/>")
    },
  },
  xAxis: {
    type: "category",
    boundaryGap: false,
    name: "Recorded graded matches · oldest to newest",
    nameLocation: "middle",
    nameGap: graded.value.length > 30 ? 50 : 30,
    data: graded.value.map((_, index) => `${index + 1}`),
    axisLabel: {
      hideOverlap: true,
      formatter: (value: string) => `#${value}`,
    },
  },
  yAxis: {
    type: "value",
    min: 0,
    max: 100,
    name: "Recall Score",
    axisLabel: { formatter: "{value}" },
    splitLine: { lineStyle: { color: CHART_STYLES.gridSoft } },
  },
  dataZoom: graded.value.length > 30 ? [{ type: "inside", start: Math.max(0, 100 - 30 / graded.value.length * 100), end: 100 }, { type: "slider", height: 18, bottom: 8 }] : [],
  series: [
    {
      name: "Match score",
      type: "scatter",
      symbolSize: graded.value.length > 70 ? 6 : 8,
      data: graded.value.map((game) => ({
        value: game.recallScore,
        symbol: game.win ? "circle" : "diamond",
        itemStyle: {
          color: game.win ? CHART_COLOURS.positive : CHART_COLOURS.negative,
          opacity: 0.82,
        },
      })),
      markLine: {
        symbol: "none",
        silent: true,
        data: [{ yAxis: 50, label: {
          formatter: "Reference midpoint",
          position: "insideEndTop",
          color: CHART_COLOURS.textMuted,
          backgroundColor: CHART_STYLES.labelBackdrop,
          borderRadius: 3,
          padding: [3, 5],
          textBorderWidth: 0,
        } }],
        lineStyle: { color: CHART_STYLES.zeroLine, type: "dashed", opacity: 0.62 },
      },
    },
    {
      name: `${rollingWindow.value}-match trend`,
      type: "line",
      smooth: 0.32,
      connectNulls: false,
      showSymbol: false,
      data: rolling.value,
      lineStyle: { color: CHART_COLOURS.accentStrong, width: 3 },
      areaStyle: { color: CHART_STYLES.accentArea },
    },
  ],
}))
</script>

<template>
  <div class="journey-chart">
    <BaseEChart
      :option="option"
      :ariaLabel="`Recall Scores for ${graded.length} recorded graded matches in chronological sequence. Circles are wins, diamonds are losses, and the line is a trailing ${rollingWindow}-match average.`"
      height="360px"
    />
    <ul class="result-key" aria-label="Match result symbols">
      <li><span class="win-dot" aria-hidden="true" /> Win</li>
      <li><span class="loss-dot" aria-hidden="true" /> Loss</li>
    </ul>
  </div>
</template>

<style scoped>
.journey-chart {
  position: relative;
  min-width: 0;
}

.result-key {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  margin: -4px 20px 0 0;
  padding: 0;
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  list-style: none;
}

.result-key li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.win-dot,
.loss-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  background: var(--win);
}

.win-dot { border-radius: 50%; }
.loss-dot { transform: rotate(45deg); background: var(--loss); }
</style>
