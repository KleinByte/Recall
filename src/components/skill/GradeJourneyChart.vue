<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { CHART_COLOURS } from "../../charts/recall-chart-theme"
import { escapeTooltip } from "../../charts/formatters"
import { recallGradeFromScore } from "../../shared/recall-grade"
import { championNameById } from "../../helpers/format"
import type { SkillHistoryPoint } from "../../types/stats"

const props = defineProps<{ history: SkillHistoryPoint[] }>()

const graded = computed(() => props.history.filter((game) => game.gradeScore !== undefined))

const option = computed<EChartsCoreOption>(() => ({
  grid: { top: 18, right: 28, bottom: graded.value.length > 30 ? 64 : 36, left: 46 },
  tooltip: {
    trigger: "axis",
    formatter: (params: Array<{ dataIndex: number }>) => {
      const game = graded.value[params[0]?.dataIndex]
      if (!game) return ""
      return [
        `<strong>${escapeTooltip(game.grade ?? recallGradeFromScore(game.gradeScore) ?? "Ungraded")}</strong> · ${escapeTooltip(championNameById(null, game.championId))}`,
        new Date(game.playedAt).toLocaleString(),
        `${game.win ? "Win" : "Loss"} · Recall score ${game.gradeScore?.toFixed(2)}`,
      ].join("<br/>")
    },
  },
  xAxis: {
    type: "category",
    boundaryGap: false,
    data: graded.value.map((game) => new Date(game.playedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })),
    axisLabel: { hideOverlap: true },
  },
  yAxis: {
    type: "value",
    min: (value: { min: number }) => Math.min(-1.6, Math.floor(value.min * 2) / 2),
    max: (value: { max: number }) => Math.max(1.6, Math.ceil(value.max * 2) / 2),
    axisLabel: { formatter: (value: number) => recallGradeFromScore(value) ?? "D" },
    splitLine: { lineStyle: { color: "rgba(200, 170, 109, 0.12)" } },
  },
  dataZoom: graded.value.length > 30 ? [{ type: "inside", start: Math.max(0, 100 - 30 / graded.value.length * 100), end: 100 }, { type: "slider", height: 18, bottom: 8 }] : [],
  series: [{
    name: "Recall score",
    type: "line",
    smooth: 0.24,
    showSymbol: graded.value.length <= 45,
    symbolSize: 7,
    data: graded.value.map((game) => ({
      value: game.gradeScore,
      itemStyle: { color: game.win ? CHART_COLOURS.positive : CHART_COLOURS.negative },
    })),
    lineStyle: { color: CHART_COLOURS.goldBright, width: 2 },
    areaStyle: { color: "rgba(200, 170, 109, 0.11)" },
    markLine: {
      symbol: "none",
      silent: true,
      data: [{ yAxis: 0, label: {
        formatter: "Lobby average",
        position: "insideEndTop",
        color: CHART_COLOURS.cyan,
        backgroundColor: "rgba(6, 14, 28, .82)",
        borderRadius: 3,
        padding: [3, 5],
        textBorderWidth: 0,
      } }],
      lineStyle: { color: CHART_COLOURS.cyan, type: "dashed", opacity: 0.62 },
    },
  }],
}))
</script>

<template>
  <BaseEChart
    :option="option"
    ariaLabel="Recall Grade journey across recorded matches. Green points are wins and red points are losses."
    height="360px"
  />
</template>
