<script setup lang="ts">
import { computed } from "vue"
import type { EChartsCoreOption } from "echarts/core"
import BaseEChart from "../charts/BaseEChart.vue"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"
import { escapeTooltip } from "../../charts/formatters"
import type { PerformanceDimensionScore } from "../../types/stats"
import { completeRecentRadar } from "../../charts/evidence-adapters"

const props = defineProps<{
  dimensions: PerformanceDimensionScore[]
  height?: string
  primaryLabel?: string
  secondaryLabel?: string
}>()

const option = computed<EChartsCoreOption>(() => {
  const recentValues = completeRecentRadar(props.dimensions)
  const hasRecent = recentValues !== undefined
  const series: Array<{
    name: string
    value: number[]
    lineStyle: { color: string; width: number }
    itemStyle: { color: string }
    areaStyle: { color: string }
  }> = [{
    name: props.primaryLabel ?? "Recorded profile",
    value: props.dimensions.map((dimension) => dimension.score),
    lineStyle: { color: CHART_COLOURS.accent, width: 2 },
    itemStyle: { color: CHART_COLOURS.accentStrong },
    areaStyle: { color: CHART_STYLES.accentAreaStrong },
  }]

  if (hasRecent) {
    series.push({
      name: props.secondaryLabel ?? "Recent form",
      value: recentValues!,
      lineStyle: { color: CHART_COLOURS.live, width: 1.5 },
      itemStyle: { color: CHART_COLOURS.live },
      areaStyle: { color: CHART_STYLES.liveArea },
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
            `${escapeTooltip(dimension.label)}: ${Number.isFinite(item.value?.[index]) ? Math.round(item.value![index]) : "Unavailable"}`,
          ),
        ].join("<br>")
      },
    },
    legend: {
      show: hasRecent,
      bottom: 0,
      textStyle: { color: CHART_COLOURS.textSubtle, fontSize: 10 },
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
      axisLine: { lineStyle: { color: CHART_STYLES.grid } },
      splitLine: { lineStyle: { color: CHART_STYLES.grid } },
      splitArea: { show: false },
    },
    series: [{ type: "radar", symbolSize: 4, data: series }],
  }
})
</script>

<template>
  <BaseEChart
    :option="option"
    ariaLabel="Recall Vector Index across the displayed performance vectors."
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
