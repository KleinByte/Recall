<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { registerInsightCharts } from "../../charts/register-insights"
import { escapeTooltip } from "../../charts/formatters"
import { CHART_COLOURS, CHART_SCORE_RAMP, CHART_STYLES } from "../../charts/recall-chart-theme"
import type { SkillHistoryPoint } from "../../types/stats"
import { calendarDays } from "../../charts/evidence-adapters"

registerInsightCharts()

const props = defineProps<{ history: SkillHistoryPoint[] }>()

const days = computed(() => {
  return calendarDays(props.history).map((day) => [
    day.date, day.roleFitScore, day.games, day.wins,
  ] as [string, number | null, number, number])
})

const range = computed<[string, string]>(() => {
  const dates = days.value.map((day) => day[0]).sort()
  return [dates[0] ?? new Date().toISOString().slice(0, 10), dates.at(-1) ?? new Date().toISOString().slice(0, 10)]
})

const option = computed<EChartsCoreOption>(() => ({
  tooltip: {
    formatter: (raw: unknown) => {
      const [date, score, games, wins] = (raw as { data: [string, number | null, number, number] }).data
      const roleFit = score === null
        ? "No graded games"
        : `Average RoleFit ${score.toFixed(1)}`
      return `<strong>${escapeTooltip(new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { dateStyle: "medium" }))}</strong><br/>${games} game${games === 1 ? "" : "s"} · ${wins}W<br/>${roleFit}`
    },
  },
  visualMap: {
    min: 0,
    max: 100,
    dimension: 1,
    calculable: false,
    orient: "horizontal",
    left: "center",
    bottom: 0,
    text: ["Higher RoleFit", "Lower RoleFit"],
    inRange: {
      color: [CHART_SCORE_RAMP[0], CHART_SCORE_RAMP[2], CHART_SCORE_RAMP[3], CHART_SCORE_RAMP[4]],
    },
  },
  calendar: {
    top: 28,
    left: 38,
    right: 20,
    bottom: 50,
    range: range.value,
    cellSize: ["auto", 18],
    splitLine: { lineStyle: { color: CHART_STYLES.gridStrong } },
    itemStyle: { color: CHART_COLOURS.surfaceInset, opacity: .55, borderColor: CHART_STYLES.gridSoft },
    dayLabel: { firstDay: 1, nameMap: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] },
    monthLabel: { color: CHART_COLOURS.textSubtle },
    yearLabel: { show: false },
  },
  series: [{ type: "heatmap", coordinateSystem: "calendar", data: days.value }],
}))
</script>

<template>
  <BaseEChart
    :option="option"
    ariaLabel="Play calendar colored by average RoleFit on a zero-to-one-hundred scale for each recorded day."
    height="230px"
  />
</template>
