<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { registerInsightCharts } from "../../charts/register-insights"
import { escapeTooltip } from "../../charts/formatters"
import { CHART_COLOURS, CHART_SCORE_RAMP, CHART_STYLES } from "../../charts/recall-chart-theme"
import type { SkillGradeComponentPoint } from "../../types/stats"

registerInsightCharts()

const props = defineProps<{ rows: SkillGradeComponentPoint[] }>()

const games = computed(() => props.rows.slice(-30))
const components = computed(() => {
  const byKey = new Map<string, string>()
  for (const game of games.value) {
    for (const component of game.components) byKey.set(component.key, component.label)
  }
  return [...byKey.entries()].map(([key, label]) => ({ key, label }))
})

const heatData = computed(() => games.value.flatMap((game, x) => components.value.flatMap((axis, y) => {
  const component = game.components.find((entry) => entry.key === axis.key)
  return component ? [[x, y, Math.round(component.percentile * 100), component.scope]] : []
})))

const option = computed<EChartsCoreOption>(() => ({
  grid: { top: 20, right: 22, bottom: 64, left: 96 },
  tooltip: {
    position: "top",
    formatter: (raw: unknown) => {
      const item = raw as { data?: [number, number, number, string] }
      const [x = 0, y = 0, value = 0, scope = "lobby"] = item.data ?? []
      const game = games.value[x]
      const component = components.value[y]
      return game && component
        ? `<strong>${escapeTooltip(component.label)}</strong><br/>${value}th percentile vs ${escapeTooltip(scope)}<br/>${escapeTooltip(game.grade ?? "–")} · ${new Date(game.playedAt).toLocaleDateString()}`
        : ""
    },
  },
  xAxis: {
    type: "category",
    data: games.value.map((game) => game.grade ?? "–"),
    name: "Recent games",
    axisTick: { show: false },
    splitArea: { show: true },
  },
  yAxis: {
    type: "category",
    data: components.value.map((axis) => axis.label),
    axisTick: { show: false },
    splitArea: { show: true },
  },
  visualMap: {
    min: 0,
    max: 100,
    dimension: 2,
    calculable: false,
    orient: "horizontal",
    left: "center",
    bottom: 4,
    text: ["Leads peers", "Trails peers"],
    inRange: {
      color: [CHART_SCORE_RAMP[0], CHART_SCORE_RAMP[2], CHART_SCORE_RAMP[3], CHART_SCORE_RAMP[4]],
    },
  },
  series: [{
    type: "heatmap",
    data: heatData.value,
    label: {
      show: games.value.length <= 14,
      color: CHART_COLOURS.text,
      fontSize: 10,
      fontWeight: 700,
      backgroundColor: CHART_STYLES.labelBackdrop,
      borderRadius: 2,
      padding: [2, 3],
      textBorderWidth: 0,
      formatter: (raw: unknown) => `${(raw as { value: number[] }).value[2]}`,
    },
    emphasis: { itemStyle: { shadowBlur: 10, shadowColor: CHART_STYLES.labelShadow } },
  }],
}))
</script>

<template>
  <BaseEChart
    :option="option"
    ariaLabel="Grade DNA heatmap showing the percentile of each Recall Grade component in recent matches."
    height="390px"
  />
</template>
