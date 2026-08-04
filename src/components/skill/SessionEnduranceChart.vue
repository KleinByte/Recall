<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"
import { recallGradeFromScore } from "../../shared/recall-grade"
import type { SkillHistoryPoint } from "../../types/stats"

const props = defineProps<{ history: SkillHistoryPoint[] }>()

const buckets = computed(() => {
  const ordered = [...props.history].sort((left, right) => left.playedAt - right.playedAt)
  const values = Array.from({ length: 5 }, (_, index) => ({
    label: index === 4 ? "Game 5+" : `Game ${index + 1}`,
    games: 0,
    wins: 0,
    grades: [] as number[],
  }))
  let sessionGame = 0
  let previousEnd = -Infinity
  for (const game of ordered) {
    if (game.playedAt - previousEnd > 90 * 60_000) sessionGame = 1
    else sessionGame += 1
    const bucket = values[Math.min(4, sessionGame - 1)]
    bucket.games += 1
    bucket.wins += Number(game.win)
    if (game.gradeScore !== undefined) bucket.grades.push(game.gradeScore)
    previousEnd = game.playedAt + game.durationSecs * 1_000
  }
  return values.filter((bucket) => bucket.games > 0)
})

const option = computed<EChartsCoreOption>(() => ({
  grid: { top: 28, right: 48, bottom: 34, left: 46 },
  tooltip: { trigger: "axis" },
  legend: { top: 0, data: ["Win rate", "Recall score"] },
  xAxis: { type: "category", data: buckets.value.map((bucket) => bucket.label), axisTick: { show: false } },
  yAxis: [
    { type: "value", min: 0, max: 100, axisLabel: { formatter: "{value}%" }, splitLine: { lineStyle: { color: CHART_STYLES.gridSoft } } },
    { type: "value", axisLabel: { formatter: (value: number) => recallGradeFromScore(value) ?? "–" }, splitLine: { show: false } },
  ],
  series: [
    {
      name: "Win rate",
      type: "bar",
      data: buckets.value.map((bucket) => ({
        value: Math.round(bucket.wins / bucket.games * 100),
        itemStyle: { color: CHART_STYLES.liveFill, borderColor: CHART_COLOURS.live, borderWidth: 1, borderRadius: [3, 3, 0, 0] },
      })),
      barMaxWidth: 30,
    },
    {
      name: "Recall score",
      type: "line",
      yAxisIndex: 1,
      connectNulls: false,
      smooth: .28,
      data: buckets.value.map((bucket) => bucket.grades.length
        ? bucket.grades.reduce((sum, score) => sum + score, 0) / bucket.grades.length
        : null),
      symbolSize: 7,
      lineStyle: { color: CHART_COLOURS.accent, width: 2 },
      itemStyle: { color: CHART_COLOURS.accent },
    },
  ],
}))
</script>

<template>
  <BaseEChart
    :option="option"
    ariaLabel="Session endurance chart comparing win rate and average Recall score by game number within a session."
    height="300px"
  />
</template>
