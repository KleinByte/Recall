<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { registerInsightCharts } from "../../charts/register-insights"
import { escapeTooltip } from "../../charts/formatters"
import { championNameById } from "../../helpers/format"
import { recallGradeFromScore } from "../../shared/recall-grade"
import type { SkillChampionPoint } from "../../types/stats"

registerInsightCharts()

const props = defineProps<{ champions: SkillChampionPoint[] }>()

function colorFor(score?: number) {
  if (score === undefined) return "#3c4659"
  if (score >= 0.65) return "#b78b3f"
  if (score >= 0.15) return "#087a8c"
  if (score >= -0.35) return "#31445f"
  return "#6b2d41"
}

const nodes = computed(() => props.champions
  .filter((champion) => champion.games > 0)
  .sort((left, right) => right.games - left.games)
  .map((champion) => ({
    name: championNameById(null, champion.championId),
    value: champion.games,
    itemStyle: { color: colorFor(champion.avgGradeScore), borderColor: "#091426", borderWidth: 2 },
    recall: champion,
  })))

const option = computed<EChartsCoreOption>(() => ({
  tooltip: {
    formatter: (raw: unknown) => {
      const node = (raw as { data: { name: string; recall: SkillChampionPoint } }).data
      const champion = node.recall
      return `<strong>${escapeTooltip(node.name)}</strong><br/>${champion.games} games · ${Math.round(champion.winRate * 100)}% win rate<br/>${champion.avgGradeScore === undefined ? "No graded games" : `Average ${escapeTooltip(recallGradeFromScore(champion.avgGradeScore) ?? "–")} (${champion.avgGradeScore.toFixed(2)})`}<br/>${champion.kda.toFixed(2)} KDA`
    },
  },
  series: [{
    type: "treemap",
    roam: false,
    nodeClick: false,
    breadcrumb: { show: false },
    label: { show: true, formatter: (raw: unknown) => {
      const item = raw as { name: string; data: { recall: SkillChampionPoint } }
      return `${item.name}\n${item.data.recall.games} games`
    } },
    upperLabel: { show: false },
    data: nodes.value,
  }],
}))
</script>

<template>
  <BaseEChart
    :option="option"
    ariaLabel="Champion pool treemap. Tile size represents games played and color represents average Recall Grade."
    height="360px"
  />
</template>
