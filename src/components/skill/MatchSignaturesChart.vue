<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { registerInsightCharts } from "../../charts/register-insights"
import { escapeTooltip } from "../../charts/formatters"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"
import type { SkillGradeComponentPoint, SkillHistoryPoint } from "../../types/stats"

registerInsightCharts()

const props = defineProps<{
  rows: SkillGradeComponentPoint[]
  history: SkillHistoryPoint[]
}>()

const games = computed(() => props.rows.slice(-24))
const historyByGame = computed(() => new Map(props.history.map((game) => [game.gameId, game])))
const axes = computed(() => {
  const labels = new Map<string, string>()
  for (const game of games.value) {
    for (const component of game.components) labels.set(component.key, component.label)
  }
  return [...labels].map(([key, label]) => ({ key, label }))
})

const signatures = computed(() => games.value.map((game) => {
  const history = historyByGame.value.get(game.gameId)
  return {
    value: axes.value.map((axis) => Math.round(
      (game.components.find((component) => component.key === axis.key)?.percentile ?? .5) * 100,
    )),
    game,
    history,
    lineStyle: {
      color: history?.win ? CHART_COLOURS.positive : CHART_COLOURS.negative,
      opacity: history?.win ? .46 : .32,
      width: history?.win ? 1.5 : 1,
    },
  }
}))

const option = computed<EChartsCoreOption>(() => ({
  tooltip: {
    trigger: "item",
    formatter: (raw: unknown) => {
      const data = (raw as { data?: typeof signatures.value[number] }).data
      if (!data) return ""
      const strongest = data.value
        .map((value, index) => ({ value, label: axes.value[index]?.label }))
        .sort((left, right) => right.value - left.value)[0]
      return [
        `<strong>${escapeTooltip(data.history?.win ? "Win" : "Loss")} · ${escapeTooltip(data.game.grade ?? "ungraded")}</strong>`,
        escapeTooltip(new Date(data.game.playedAt).toLocaleDateString()),
        strongest ? `Strongest signal · ${escapeTooltip(strongest.label)} ${strongest.value}th` : "",
      ].filter(Boolean).join("<br/>")
    },
  },
  parallel: { top: 34, right: 48, bottom: 28, left: 48, parallelAxisDefault: { nameGap: 10 } },
  parallelAxis: axes.value.map((axis, index) => ({
    dim: index,
    name: axis.label,
    min: 0,
    max: 100,
    nameLocation: "end",
    axisLabel: { show: index === 0 || index === axes.value.length - 1 },
    splitLine: { lineStyle: { color: CHART_STYLES.gridSoft } },
  })),
  series: [{
    type: "parallel",
    data: signatures.value,
    smooth: .12,
    inactiveOpacity: .04,
    activeOpacity: .9,
  }],
}))
</script>

<template>
  <BaseEChart
    :option="option"
    ariaLabel="Match signatures. Each line is one game's Recall Grade component percentiles; green lines are wins and red lines are losses."
    height="410px"
  />
</template>
