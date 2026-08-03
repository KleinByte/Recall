<script setup lang="ts">
import { computed } from "vue"
import type { EChartsCoreOption } from "echarts/core"
import BaseEChart from "../charts/BaseEChart.vue"
import { CHART_COLOURS } from "../../charts/recall-chart-theme"
import { escapeTooltip } from "../../charts/formatters"
import type { PerformanceDimensionScore } from "../../types/stats"

const props = defineProps<{
  dimensions: PerformanceDimensionScore[]
  height?: string
  primaryLabel?: string
  secondaryLabel?: string
}>()

const option = computed<EChartsCoreOption>(() => {
  const hasRecent = props.dimensions.some((dimension) => dimension.recentScore !== undefined)
  const series: Array<{
    name: string
    value: number[]
    lineStyle: { color: string; width: number }
    itemStyle: { color: string }
    areaStyle: { color: string }
  }> = [{
    name: props.primaryLabel ?? "Recorded profile",
    value: props.dimensions.map((dimension) => dimension.score),
    lineStyle: { color: CHART_COLOURS.gold, width: 2 },
    itemStyle: { color: CHART_COLOURS.goldBright },
    areaStyle: { color: "rgba(200, 170, 109, 0.20)" },
  }]

  if (hasRecent) {
    series.push({
      name: props.secondaryLabel ?? "Recent form",
      value: props.dimensions.map((dimension) => dimension.recentScore ?? dimension.score),
      lineStyle: { color: CHART_COLOURS.cyan, width: 1.5 },
      itemStyle: { color: CHART_COLOURS.cyan },
      areaStyle: { color: "rgba(10, 203, 230, 0.09)" },
    })
  }

  return {
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (raw: unknown) => {
        const item = raw as { name?: string; value?: number[] }
        return [
          `<strong>${escapeTooltip(item.name ?? "Recall Vector Index")}</strong>`,
          ...props.dimensions.map((dimension, index) =>
            `${escapeTooltip(dimension.label)}: ${Math.round(item.value?.[index] ?? 0)}`,
          ),
        ].join("<br>")
      },
    },
    legend: {
      show: hasRecent,
      bottom: 0,
      textStyle: { color: CHART_COLOURS.textSecondary, fontSize: 10 },
    },
    radar: {
      center: ["50%", hasRecent ? "46%" : "50%"],
      radius: hasRecent ? "62%" : "68%",
      splitNumber: 4,
      indicator: props.dimensions.map((dimension) => ({ name: dimension.shortLabel, max: 100 })),
      axisName: {
        color: CHART_COLOURS.text,
        fontFamily: "BeaufortforLOL Medium, serif",
        fontSize: 11,
      },
      axisLine: { lineStyle: { color: "rgba(200, 170, 109, 0.18)" } },
      splitLine: { lineStyle: { color: "rgba(200, 170, 109, 0.18)" } },
      splitArea: { show: false },
    },
    series: [{ type: "radar", symbolSize: 4, data: series }],
  }
})
</script>

<template>
  <BaseEChart
    :option="option"
    ariaLabel="Recall Vector Index across eight performance vectors."
    :height="height ?? '300px'"
    class="performance-radar"
  />
</template>

<style scoped>
.performance-radar {
  max-width: 520px;
  margin-inline: auto;
}
</style>
