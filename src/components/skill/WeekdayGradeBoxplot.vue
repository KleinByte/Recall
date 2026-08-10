<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { registerInsightCharts } from "../../charts/register-insights"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"
import { boxplot } from "../../charts/statistics"
import type { SkillHistoryPoint } from "../../types/stats"
import { weekdayRoleFitGroups } from "../../charts/evidence-adapters"

registerInsightCharts()

const props = defineProps<{ history: SkillHistoryPoint[] }>()
const groups = computed(() => weekdayRoleFitGroups(props.history))

const option = computed<EChartsCoreOption>(() => ({
  grid: { top: 20, right: 24, bottom: 34, left: 46 },
  tooltip: {
    trigger: "item",
    formatter: (raw: unknown) => {
      const item = raw as { dataIndex: number; value: number[] }
      const group = groups.value[item.dataIndex]
      const median = item.value?.[2]
      if (!group || !Number.isFinite(median)) return "Insufficient evidence"
      return `<strong>${group.label}</strong><br/>${group.values.length} graded games<br/>Median RoleFit ${median.toFixed(1)}<br/>Box = middle 50% of games`
    },
  },
  xAxis: { type: "category", data: groups.value.map((group) => group.label), boundaryGap: true },
  yAxis: {
    type: "value",
    min: 0,
    max: 100,
    axisLabel: { formatter: "{value}" },
    splitLine: { lineStyle: { color: CHART_STYLES.gridSoft } },
  },
  series: [{
    type: "boxplot",
    data: groups.value.map((group) => boxplot(group.values)),
    itemStyle: { color: CHART_STYLES.liveArea, borderColor: CHART_COLOURS.live },
  }],
}))
</script>

<template>
  <BaseEChart
    :option="option"
    ariaLabel="Distribution of RoleFit scores by weekday on a zero-to-one-hundred scale. Each box shows the middle half of graded games."
    height="290px"
  />
</template>
