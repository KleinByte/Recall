<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"
import type { SkillHistoryPoint } from "../../types/stats"
import { groupTimedGames } from "../../helpers/time-contract-core"

const props = defineProps<{ history: SkillHistoryPoint[] }>()

const buckets = computed(() => {
  const values = Array.from({ length: 5 }, (_, index) => ({
    label: index === 4 ? "Game 5+" : `Game ${index + 1}`,
    games: 0,
    wins: 0,
    grades: [] as number[],
  }))
  for (const session of groupTimedGames(props.history)) {
    if (session.kind !== "analytical") continue
    session.matches.forEach((game, index) => {
      const bucket = values[Math.min(4, index)]
      bucket.games += 1
      bucket.wins += Number(game.win)
      if (Number.isFinite(game.recallScore)) bucket.grades.push(game.recallScore!)
    })
  }
  return values.filter((bucket) => bucket.games > 0)
})

const option = computed<EChartsCoreOption>(() => ({
  grid: { top: 28, right: 48, bottom: 34, left: 46 },
  tooltip: { trigger: "axis" },
  legend: { top: 0, data: ["Win rate", "Recall Score"] },
  xAxis: { type: "category", data: buckets.value.map((bucket) => bucket.label), axisTick: { show: false } },
  yAxis: [
    { type: "value", min: 0, max: 100, axisLabel: { formatter: "{value}%" }, splitLine: { lineStyle: { color: CHART_STYLES.gridSoft } } },
    { type: "value", min: 0, max: 100, axisLabel: { formatter: "{value}" }, splitLine: { show: false } },
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
      name: "Recall Score",
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
    ariaLabel="Session endurance chart comparing win rate and average Recall Score on a zero-to-one-hundred scale by game number within a session."
    height="300px"
  />
</template>
