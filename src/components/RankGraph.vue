<script setup lang="ts">
import { computed } from "vue"
import type { EChartsCoreOption } from "echarts/core"
import BaseEChart from "./charts/BaseEChart.vue"
import { CHART_COLOURS } from "../charts/recall-chart-theme"
import { escapeTooltip } from "../charts/formatters"
import type { RankedPoint } from "../types/stats"

const props = withDefaults(defineProps<{
  points: RankedPoint[]
  height?: string
}>(), {
  height: "220px",
})

const DAY_MS = 24 * 60 * 60 * 1_000

const dateLabel = (value: number, options?: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(undefined, options ?? {
    month: "short",
    day: "numeric",
  }).format(new Date(value))

const labelFor = (value: number) => {
  const nearest = props.points.reduce((best, point) =>
    Math.abs(point.points - value) < Math.abs(best.points - value) ? point : best,
  )
  const estimatedLeaguePoints = Math.round(
    nearest.leaguePoints + value - nearest.points,
  )

  return estimatedLeaguePoints >= 0 && estimatedLeaguePoints <= 100
    ? `${nearest.label} · ${estimatedLeaguePoints}`
    : nearest.label
}

const option = computed<EChartsCoreOption>(() => {
  const pointValues = props.points.map((point) => point.points)
  const timestamps = props.points.map((point) => point.recordedAt)
  const lowest = Math.min(...pointValues)
  const highest = Math.max(...pointValues)
  const verticalPadding = Math.max(25, Math.ceil((highest - lowest) * 0.15))
  const onlyTimestamp = timestamps[0]

  return {
    grid: { left: 86, right: 18, top: 18, bottom: 34 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line" },
      formatter: (raw: unknown) => {
        const entry = (Array.isArray(raw) ? raw[0] : raw) as { dataIndex?: number }
        const point = props.points[entry?.dataIndex ?? 0]
        if (!point) return ""
        return [
          `<strong>${escapeTooltip(point.label)} · ${point.leaguePoints} LP</strong>`,
          escapeTooltip(dateLabel(point.recordedAt, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })),
          `${point.wins}W ${point.losses}L`,
        ].join("<br>")
      },
    },
    xAxis: {
      type: "time",
      min: timestamps.length === 1 ? onlyTimestamp - DAY_MS * 7 : undefined,
      max: timestamps.length === 1 ? onlyTimestamp + DAY_MS * 7 : undefined,
      boundaryGap: ["3%", "3%"],
      axisLabel: {
        fontSize: 11,
        hideOverlap: true,
        formatter: (value: number) => dateLabel(value),
      },
    },
    yAxis: {
      type: "value",
      min: Math.max(0, lowest - verticalPadding),
      max: highest + verticalPadding,
      axisLabel: {
        fontSize: 11,
        hideOverlap: true,
        formatter: (value: number) => labelFor(value),
      },
      splitNumber: 4,
    },
    series: [{
      name: "Rank",
      type: "line",
      data: props.points.map((point, index) => ({
        value: [point.recordedAt, point.points],
        symbolSize: index === props.points.length - 1 ? 9 : 5,
      })),
      showSymbol: props.points.length <= 40,
      symbol: "circle",
      step: "end",
      lineStyle: { color: CHART_COLOURS.gold, width: 2 },
      itemStyle: {
        color: CHART_COLOURS.goldBright,
        borderColor: CHART_COLOURS.gold,
        borderWidth: 2,
      },
      areaStyle: { color: "rgba(200, 170, 109, 0.16)" },
    }],
  }
})
</script>

<template>
  <BaseEChart
    :option="option"
    ariaLabel="Ranked tier and league-points history over time."
    :height="height"
  />
</template>
