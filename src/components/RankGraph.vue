<script setup lang="ts">
import { computed } from "vue"
import type { EChartsCoreOption } from "echarts/core"
import BaseEChart from "./charts/BaseEChart.vue"
import { CHART_COLOURS } from "../charts/recall-chart-theme"
import { escapeTooltip } from "../charts/formatters"
import type { RankedPoint } from "../types/stats"

const props = defineProps<{ points: RankedPoint[] }>()

const labelFor = (value: number) => {
  const nearest = props.points.reduce((best, point) =>
    Math.abs(point.points - value) < Math.abs(best.points - value) ? point : best,
  )
  return nearest.label
}

const option = computed<EChartsCoreOption>(() => ({
  grid: { left: 76, right: 18, top: 12, bottom: 34 },
  tooltip: {
    trigger: "axis",
    formatter: (raw: unknown) => {
      const entry = (Array.isArray(raw) ? raw[0] : raw) as { dataIndex?: number }
      const point = props.points[entry?.dataIndex ?? 0]
      if (!point) return ""
      return [
        `<strong>${escapeTooltip(point.label)} · ${point.leaguePoints} LP</strong>`,
        `${point.wins}W ${point.losses}L`,
      ].join("<br>")
    },
  },
  xAxis: {
    type: "category",
    boundaryGap: false,
    data: props.points.map((point) => new Date(point.recordedAt).toLocaleDateString()),
    axisLabel: { fontSize: 10, hideOverlap: true },
  },
  yAxis: {
    type: "value",
    axisLabel: { fontSize: 10, formatter: (value: number) => labelFor(value) },
    splitNumber: 5,
  },
  series: [{
    name: "Rank",
    type: "line",
    data: props.points.map((point) => point.points),
    showSymbol: props.points.length <= 40,
    symbolSize: 5,
    lineStyle: { color: CHART_COLOURS.gold, width: 2 },
    itemStyle: { color: CHART_COLOURS.gold },
    areaStyle: { color: "rgba(200, 170, 109, 0.16)" },
    smooth: 0.2,
  }],
}))
</script>

<template>
  <BaseEChart
    :option="option"
    ariaLabel="Ranked tier and league-points history over time."
    height="240px"
  />
</template>
