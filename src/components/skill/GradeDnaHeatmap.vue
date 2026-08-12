<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { registerInsightCharts } from "../../charts/register-insights"
import { escapeTooltip } from "../../charts/formatters"
import { CHART_COLOURS, CHART_SCORE_RAMP, CHART_STYLES } from "../../charts/recall-chart-theme"
import { championNameById } from "../../helpers/format"
import type { SkillGradeComponentPoint, SkillHistoryPoint } from "../../types/stats"
import type { Champion } from "../../types/lol"

registerInsightCharts()

const props = defineProps<{
  rows: SkillGradeComponentPoint[]
  history: SkillHistoryPoint[]
  champions: Champion[] | null
}>()

const games = computed(() => props.rows.slice(-30))
const historyByGame = computed(() => new Map(props.history.map((game) => [game.gameId, game])))
const components = computed(() => {
  const byKey = new Map<string, string>()
  for (const game of games.value) {
    for (const component of game.components) byKey.set(component.key, component.label)
  }
  return [...byKey.entries()].map(([key, label]) => ({ key, label }))
})

const heatData = computed(() => games.value.flatMap((game, x) => components.value.flatMap((axis, y) => {
  const component = game.components.find((entry) => entry.key === axis.key)
  return component ? [[
    x,
    y,
    component.contribution * 100,
    component.percentile * 100,
    component.weight * 100,
    component.scope,
  ]] : []
})))

const contributionCeiling = computed(() => Math.max(
  10,
  Math.ceil(Math.max(0, ...heatData.value.map((cell) => Number(cell[2]))) / 5) * 5,
))

const option = computed<EChartsCoreOption>(() => ({
  grid: { top: 20, right: 22, bottom: 64, left: 96 },
  tooltip: {
    position: "top",
    formatter: (raw: unknown) => {
      const item = raw as { data?: [number, number, number, number, number, string] }
      const [x = 0, y = 0, contribution = 0, score = 0, share = 0, scope = "lobby"] = item.data ?? []
      const game = games.value[x]
      const history = game ? historyByGame.value.get(game.gameId) : undefined
      const component = components.value[y]
      return game && component
        ? [
          `<strong>${escapeTooltip(component.label)}</strong>`,
          `Arm score ${score.toFixed(1)} / 100`,
          `Grade share ${share.toFixed(1)}%`,
          `Influence on the Grade mix ${contribution.toFixed(1)} points`,
          `${escapeTooltip(scope)} comparison · ${escapeTooltip(game.grade ?? "–")} · ${new Date(game.playedAt).toLocaleDateString()}`,
          history ? `${escapeTooltip(championNameById(props.champions, history.championId))} · ${history.win ? "Win" : "Loss"}` : "",
        ].join("<br/>")
        : ""
    },
  },
  xAxis: {
    type: "category",
    data: games.value.map((_, index) => `#${index + 1}`),
    name: "Recent graded matches · oldest to newest",
    axisTick: { show: false },
    splitArea: { show: true },
  },
  yAxis: {
    type: "category",
    data: components.value.map((axis) => axis.label),
    axisTick: { show: false },
    splitArea: { show: true },
  },
  visualMap: {
    min: 0,
    max: contributionCeiling.value,
    dimension: 2,
    calculable: false,
    orient: "horizontal",
    left: "center",
    bottom: 4,
    text: ["More Grade influence", "Less"],
    inRange: {
      color: [CHART_SCORE_RAMP[0], CHART_SCORE_RAMP[2], CHART_SCORE_RAMP[3], CHART_SCORE_RAMP[4]],
    },
  },
  series: [{
    type: "heatmap",
    data: heatData.value,
    label: {
      show: games.value.length <= 14,
      color: CHART_COLOURS.text,
      fontSize: 11,
      fontWeight: 700,
      backgroundColor: CHART_STYLES.labelBackdrop,
      borderRadius: 2,
      padding: [2, 3],
      textBorderWidth: 0,
      formatter: (raw: unknown) => `${(raw as { value: number[] }).value[2].toFixed(1)}`,
    },
    emphasis: { itemStyle: { shadowBlur: 10, shadowColor: CHART_STYLES.labelShadow } },
  }],
}))
</script>

<template>
  <BaseEChart
    :option="option"
    ariaLabel="Grade drivers chart showing which performance arms had the most influence on each match Grade. Brighter squares mean more influence."
    height="390px"
  />
</template>
