<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { escapeTooltip } from "../../charts/formatters"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"
import { championNameById } from "../../helpers/format"
import type { Champion } from "../../types/lol"
import type { SkillChampionPoint } from "../../types/stats"

const props = defineProps<{
  champions: SkillChampionPoint[]
  catalog: Champion[] | null
  baseline?: number
}>()

const rows = computed(() => props.champions.filter((champion) =>
  champion.gradedGames > 0 && champion.averageRecallScore !== undefined,
))
const experienceCutoff = computed(() => {
  const games = rows.value.map((row) => row.games).sort((left, right) => left - right)
  return games[Math.floor(games.length / 2)] ?? 1
})
const performanceCutoff = computed(() => props.baseline ?? 50)

function quadrant(games: number, score: number) {
  if (games >= experienceCutoff.value && score >= performanceCutoff.value) return "Main"
  if (games < experienceCutoff.value && score >= performanceCutoff.value) return "Hidden gem"
  if (games >= experienceCutoff.value) return "Comfort trap"
  return "Unproven"
}

const option = computed<EChartsCoreOption>(() => ({
  grid: { top: 22, right: 28, bottom: 46, left: 52 },
  tooltip: {
    formatter: (raw: unknown) => {
      const values = (raw as { value?: Array<number | string> }).value ?? []
      return `<strong>${escapeTooltip(values[5])}</strong><br/>${escapeTooltip(values[6])}<br/>${values[0]} games · ${Number(values[1]).toFixed(1)} average Recall Score<br/>${Math.round(Number(values[3]) * 100)}% win rate · ${Number(values[4]).toFixed(2)} KDA`
    },
  },
  xAxis: {
    type: "value",
    min: 0,
    name: "Recorded games",
    nameLocation: "middle",
    nameGap: 30,
    splitLine: { lineStyle: { color: CHART_STYLES.gridSoft } },
  },
  yAxis: {
    type: "value",
    name: "Recall Score",
    min: 0,
    max: 100,
    splitLine: { lineStyle: { color: CHART_STYLES.gridSoft } },
  },
  series: [{
    type: "scatter",
    data: rows.value.map((champion) => [
      champion.games,
      champion.averageRecallScore!,
      champion.championId,
      champion.winRate,
      champion.kda,
      championNameById(props.catalog, champion.championId),
      quadrant(champion.games, champion.averageRecallScore!),
    ]),
    symbolSize: (value: unknown) => Math.min(38, 10 + Math.sqrt(Number((value as unknown[])[0]) || 1) * 3),
    itemStyle: { color: CHART_COLOURS.live, opacity: .66, borderColor: CHART_COLOURS.text, borderWidth: 1 },
    emphasis: { scale: 1.18 },
    markLine: {
      silent: true,
      symbol: ["none", "none"],
      lineStyle: { color: CHART_STYLES.gridStrong, type: "dashed" },
      data: [{ xAxis: experienceCutoff.value }, { yAxis: performanceCutoff.value }],
    },
  }],
}))
</script>

<template>
  <BaseEChart
    :option="option"
    ariaLabel="Champion efficiency quadrant. Experience is on the horizontal axis and average Recall Score on a zero-to-one-hundred scale is on the vertical axis."
    height="330px"
  />
</template>
