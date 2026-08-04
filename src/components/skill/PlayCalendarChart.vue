<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { registerInsightCharts } from "../../charts/register-insights"
import { escapeTooltip } from "../../charts/formatters"
import { CHART_COLOURS, CHART_SCORE_RAMP, CHART_STYLES } from "../../charts/recall-chart-theme"
import { recallGradeFromScore } from "../../shared/recall-grade"
import type { SkillHistoryPoint } from "../../types/stats"

registerInsightCharts()

const props = defineProps<{ history: SkillHistoryPoint[] }>()

const days = computed(() => {
  const grouped = new Map<string, { games: number; wins: number; scores: number[] }>()
  for (const game of props.history.slice(-365)) {
    const date = new Date(game.playedAt)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    const day = grouped.get(key) ?? { games: 0, wins: 0, scores: [] }
    day.games += 1
    day.wins += Number(game.win)
    if (game.gradeScore !== undefined) day.scores.push(game.gradeScore)
    grouped.set(key, day)
  }
  return [...grouped].map(([date, day]) => [
    date,
    day.scores.length ? day.scores.reduce((sum, score) => sum + score, 0) / day.scores.length : 0,
    day.games,
    day.wins,
  ] as [string, number, number, number])
})

const range = computed<[string, string]>(() => {
  const dates = days.value.map((day) => day[0]).sort()
  return [dates[0] ?? new Date().toISOString().slice(0, 10), dates.at(-1) ?? new Date().toISOString().slice(0, 10)]
})

const option = computed<EChartsCoreOption>(() => ({
  tooltip: {
    formatter: (raw: unknown) => {
      const [date, score, games, wins] = (raw as { data: [string, number, number, number] }).data
      return `<strong>${escapeTooltip(new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { dateStyle: "medium" }))}</strong><br/>${games} game${games === 1 ? "" : "s"} · ${wins}W<br/>Average ${escapeTooltip(recallGradeFromScore(score) ?? "ungraded")} (${score.toFixed(2)})`
    },
  },
  visualMap: {
    min: -1.5,
    max: 1.5,
    dimension: 1,
    calculable: false,
    orient: "horizontal",
    left: "center",
    bottom: 0,
    text: ["Stronger grade", "Weaker grade"],
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
    ariaLabel="Play calendar colored by average Recall Grade for each recorded day."
    height="230px"
  />
</template>
