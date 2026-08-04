<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { escapeTooltip } from "../../charts/formatters"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"
import { championNameById } from "../../helpers/format"
import { recallGradeFromScore } from "../../shared/recall-grade"
import type { SkillHistoryPoint } from "../../types/stats"

const props = defineProps<{ history: SkillHistoryPoint[] }>()
const graded = computed(() => props.history.filter((game) => game.gradeScore !== undefined))

const trend = computed(() => {
  const groups = new Map<number, number[]>()
  for (const game of graded.value) {
    const minute = Math.floor(game.durationSecs / 300) * 5 + 2.5
    const scores = groups.get(minute) ?? []
    scores.push(game.gradeScore!)
    groups.set(minute, scores)
  }
  return [...groups.entries()]
    .filter(([, scores]) => scores.length >= 2)
    .sort(([left], [right]) => left - right)
    .map(([minute, scores]) => [minute, scores.reduce((sum, score) => sum + score, 0) / scores.length])
})

const option = computed<EChartsCoreOption>(() => ({
  grid: { top: 18, right: 24, bottom: 42, left: 48 },
  tooltip: {
    trigger: "item",
    formatter: (raw: unknown) => {
      const item = raw as { seriesName: string; dataIndex: number; value: number[] }
      if (item.seriesName === "5-minute average") return `<strong>${item.value[0]} minutes</strong><br/>Average ${recallGradeFromScore(item.value[1])} (${item.value[1].toFixed(2)})`
      const game = graded.value[item.dataIndex]
      return game ? `<strong>${escapeTooltip(championNameById(null, game.championId))}</strong><br/>${(game.durationSecs / 60).toFixed(1)} minutes · ${escapeTooltip(game.grade ?? "–")}<br/>${game.win ? "Win" : "Loss"}` : ""
    },
  },
  xAxis: { type: "value", name: "Minutes", min: 0 },
  yAxis: {
    type: "value",
    name: "Recall Grade",
    axisLabel: { formatter: (value: number) => recallGradeFromScore(value) ?? "D" },
    splitLine: { lineStyle: { color: CHART_STYLES.gridSoft } },
  },
  series: [
    {
      name: "Games",
      type: "scatter",
      symbolSize: 8,
      data: graded.value.map((game) => ({
        value: [game.durationSecs / 60, game.gradeScore],
        itemStyle: { color: game.win ? CHART_COLOURS.positive : CHART_COLOURS.negative, opacity: 0.65 },
      })),
    },
    {
      name: "5-minute average",
      type: "line",
      smooth: 0.35,
      symbolSize: 5,
      data: trend.value,
      lineStyle: { color: CHART_COLOURS.text, width: 2.5 },
      itemStyle: { color: CHART_COLOURS.accent },
    },
  ],
}))
</script>

<template>
  <BaseEChart
    :option="option"
    ariaLabel="Recall Grade by match duration. Green points are wins, red points are losses, and the line averages five-minute bands."
    height="310px"
  />
</template>
