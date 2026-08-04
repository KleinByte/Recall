<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { registerInsightCharts } from "../../charts/register-insights"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"
import { boxplot } from "../../charts/statistics"
import { recallGradeFromScore } from "../../shared/recall-grade"
import type { SkillHistoryPoint } from "../../types/stats"

registerInsightCharts()

const props = defineProps<{ history: SkillHistoryPoint[] }>()
const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const groups = computed(() => labels.map((_, index) => props.history
  .filter((game) => ((new Date(game.playedAt).getDay() + 6) % 7) === index && game.gradeScore !== undefined)
  .map((game) => game.gradeScore!)))

const option = computed<EChartsCoreOption>(() => ({
  grid: { top: 20, right: 24, bottom: 34, left: 46 },
  tooltip: {
    trigger: "item",
    formatter: (raw: unknown) => {
      const item = raw as { dataIndex: number; value: number[] }
      const values = groups.value[item.dataIndex] ?? []
      const median = item.value?.[2] ?? 0
      return `<strong>${labels[item.dataIndex]}</strong><br/>${values.length} graded games<br/>Median ${recallGradeFromScore(median)} (${median.toFixed(2)})<br/>Box = middle 50% of games`
    },
  },
  xAxis: { type: "category", data: labels, boundaryGap: true },
  yAxis: {
    type: "value",
    axisLabel: { formatter: (value: number) => recallGradeFromScore(value) ?? "D" },
    splitLine: { lineStyle: { color: CHART_STYLES.gridSoft } },
  },
  series: [{
    type: "boxplot",
    data: groups.value.map((values) => values.length ? boxplot(values) : [0, 0, 0, 0, 0]),
    itemStyle: { color: CHART_STYLES.liveArea, borderColor: CHART_COLOURS.live },
  }],
}))
</script>

<template>
  <BaseEChart
    :option="option"
    ariaLabel="Distribution of Recall Grade scores by weekday. Each box shows the middle half of graded games."
    height="290px"
  />
</template>
