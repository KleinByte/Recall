<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"
import { escapeTooltip } from "../../charts/formatters"
import { championNameById } from "../../helpers/format"
import type { SkillHistoryPoint } from "../../types/stats"

const props = defineProps<{ history: SkillHistoryPoint[] }>()

const graded = computed(() => props.history.filter((game) => Number.isFinite(game.roleFitScore)))

const option = computed<EChartsCoreOption>(() => ({
  grid: { top: 18, right: 28, bottom: graded.value.length > 30 ? 64 : 36, left: 46 },
  tooltip: {
    trigger: "axis",
    formatter: (params: Array<{ dataIndex: number }>) => {
      const game = graded.value[params[0]?.dataIndex]
      if (!game) return ""
      return [
        `<strong>${escapeTooltip(game.grade ?? "Ungraded")}</strong> · ${escapeTooltip(championNameById(null, game.championId))}`,
        new Date(game.playedAt).toLocaleString(),
        `${game.win ? "Win" : "Loss"} · RoleFit ${game.roleFitScore?.toFixed(1)}`,
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
    min: 0,
    max: 100,
    name: "RoleFit",
    axisLabel: { formatter: "{value}" },
    splitLine: { lineStyle: { color: CHART_STYLES.gridSoft } },
  },
  dataZoom: graded.value.length > 30 ? [{ type: "inside", start: Math.max(0, 100 - 30 / graded.value.length * 100), end: 100 }, { type: "slider", height: 18, bottom: 8 }] : [],
  series: [{
    name: "RoleFit",
    type: "line",
    smooth: 0.24,
    showSymbol: graded.value.length <= 45,
    symbolSize: 7,
    data: graded.value.map((game) => ({
      value: game.roleFitScore,
      itemStyle: { color: game.win ? CHART_COLOURS.positive : CHART_COLOURS.negative },
    })),
    lineStyle: { color: CHART_COLOURS.accentStrong, width: 2 },
    areaStyle: { color: CHART_STYLES.accentArea },
    markLine: {
      symbol: "none",
      silent: true,
      data: [{ yAxis: 50, label: {
        formatter: "Frozen-reference median",
        position: "insideEndTop",
        color: CHART_COLOURS.live,
        backgroundColor: CHART_STYLES.labelBackdrop,
        borderRadius: 3,
        padding: [3, 5],
        textBorderWidth: 0,
      } }],
      lineStyle: { color: CHART_COLOURS.live, type: "dashed", opacity: 0.62 },
    },
  }],
}))
</script>

<template>
  <BaseEChart
    :option="option"
    ariaLabel="Recall Grade journey across recorded matches on the zero-to-one-hundred RoleFit scale. Green points are wins and red points are losses."
    height="360px"
  />
</template>
