<script setup lang="ts">
import { computed } from "vue"
import type { EChartsCoreOption } from "echarts/core"
import BaseEChart from "./charts/BaseEChart.vue"
import { CHART_COLOURS, CHART_STYLES } from "../charts/recall-chart-theme"
import { escapeTooltip } from "../charts/formatters"
import type { StyleAxis } from "../types/stats"

const props = defineProps<{
  axes: StyleAxis[]
  recent?: StyleAxis[]
  primaryLabel?: string
  secondaryLabel?: string
  height?: string
}>()

const valueFor = (axis: StyleAxis) => Math.round(axis.value * 100)

const option = computed<EChartsCoreOption>(() => {
  const seriesData: Array<{
    name: string
    value: number[]
    lineStyle: { color: string; width: number }
    itemStyle: { color: string }
    areaStyle: { color: string }
  }> = [{
    name: props.primaryLabel ?? "All games",
    value: props.axes.map(valueFor),
    lineStyle: { color: CHART_COLOURS.accent, width: 2 },
    itemStyle: { color: CHART_COLOURS.accent },
    areaStyle: { color: CHART_STYLES.accentAreaStrong },
  }]

  if (props.recent) {
    seriesData.push({
      name: props.secondaryLabel ?? "Last 10 games",
      value: props.axes.map((axis) =>
        valueFor(props.recent?.find((entry) => entry.key === axis.key) ?? axis),
      ),
      lineStyle: { color: CHART_COLOURS.live, width: 1.5 },
      itemStyle: { color: CHART_COLOURS.live },
      areaStyle: { color: CHART_STYLES.liveArea },
    })
  }

  return {
    tooltip: {
      trigger: "item",
      formatter: (raw: unknown) => {
        const item = raw as { name?: string; value?: number[] }
        const values = item.value ?? []
        return [
          `<strong>${escapeTooltip(item.name ?? "Playstyle")}</strong>`,
          ...props.axes.map((axis, index) =>
            `${escapeTooltip(axis.label)}: ${values[index] ?? 0}%<br><span style="color:${CHART_COLOURS.textSubtle}">${escapeTooltip(axis.description)}</span>`,
          ),
        ].join("<br>")
      },
    },
    legend: {
      show: seriesData.length > 1,
      bottom: 4,
      textStyle: { color: CHART_COLOURS.textSubtle },
    },
    radar: {
      center: ["50%", seriesData.length > 1 ? "47%" : "50%"],
      radius: seriesData.length > 1 ? "66%" : "72%",
      splitNumber: 5,
      indicator: props.axes.map((axis) => ({ name: axis.label, max: 100 })),
      axisName: {
        color: CHART_COLOURS.text,
        fontFamily: "BeaufortforLOL Medium, serif",
        fontSize: 13,
      },
      axisLine: { lineStyle: { color: CHART_STYLES.grid } },
      splitLine: { lineStyle: { color: CHART_STYLES.grid } },
      splitArea: { show: false },
    },
    series: [{
      type: "radar",
      symbolSize: 5,
      data: seriesData,
    }],
  }
})
</script>

<template>
  <BaseEChart
    :option="option"
    ariaLabel="Playstyle fingerprint across the displayed axes."
    :height="height ?? '360px'"
    class="radar"
  />
</template>

<style scoped>
.radar {
  max-width: 600px;
  margin: 0 auto;
}
</style>
