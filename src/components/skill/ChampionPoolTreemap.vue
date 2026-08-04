<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { registerInsightCharts } from "../../charts/register-insights"
import { escapeTooltip } from "../../charts/formatters"
import { CHART_COLOURS, CHART_SCORE_RAMP, CHART_STYLES } from "../../charts/recall-chart-theme"
import { championNameById } from "../../helpers/format"
import { recallGradeFromScore } from "../../shared/recall-grade"
import type { SkillChampionPoint } from "../../types/stats"
import type { Champion } from "../../types/lol"

registerInsightCharts()

const props = defineProps<{ champions: SkillChampionPoint[]; catalog: Champion[] | null }>()

function colorFor(score?: number) {
  if (score === undefined) return CHART_COLOURS.neutral
  if (score >= 0.65) return CHART_SCORE_RAMP[4]
  if (score >= 0.15) return CHART_SCORE_RAMP[3]
  if (score >= -0.35) return CHART_SCORE_RAMP[2]
  return CHART_SCORE_RAMP[1]
}

const nodes = computed(() => props.champions
  .filter((champion) => champion.games > 0)
  .sort((left, right) => right.games - left.games)
  .map((champion) => ({
    name: championNameById(props.catalog, champion.championId),
    value: champion.games,
    itemStyle: { color: colorFor(champion.avgGradeScore), borderColor: CHART_COLOURS.surfaceInset, borderWidth: 2 },
    recall: champion,
  })))

const option = computed<EChartsCoreOption>(() => ({
  tooltip: {
    formatter: (raw: unknown) => {
      const item = raw as { name?: unknown; data?: { name?: unknown; recall?: SkillChampionPoint } }
      const champion = item.data?.recall
      if (!champion) return ""
      const name = item.data?.name ?? item.name ?? championNameById(props.catalog, champion.championId)
      return `<strong>${escapeTooltip(name)}</strong><br/>${champion.games} games · ${Math.round(champion.winRate * 100)}% win rate<br/>${champion.avgGradeScore === undefined ? "No graded games" : `Average ${escapeTooltip(recallGradeFromScore(champion.avgGradeScore) ?? "–")} (${champion.avgGradeScore.toFixed(2)})`}<br/>${champion.kda.toFixed(2)} KDA`
    },
  },
  series: [{
    type: "treemap",
    roam: false,
    nodeClick: false,
    breadcrumb: { show: false },
    label: {
      show: true,
      color: CHART_COLOURS.text,
      fontWeight: 600,
      textBorderWidth: 0,
      textShadowBlur: 4,
      textShadowColor: CHART_STYLES.labelShadow,
      formatter: (raw: unknown) => {
        const item = raw as { name: string; data: { recall: SkillChampionPoint } }
        return `${item.name}\n${item.data.recall.games} games`
      },
    },
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
