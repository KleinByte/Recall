<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import {
  escapeTooltip,
  formatGradeShift,
  formatSigned,
  numericChartValue,
} from "../../charts/formatters"

const props = defineProps<{
  entries: Array<{ label: string; value: number }>
  unit: "grade" | "percentage-points"
}>()

const formatValue = (value: number, precision = 1) => props.unit === "grade"
  ? formatGradeShift(value, precision)
  : `${formatSigned(value, precision)} pp`

const formatAxisValue = (value: number) => props.unit === "grade"
  ? formatSigned(value, 1)
  : `${formatSigned(value, 0)} pp`

const chartHeight = computed(() => `${Math.max(190, props.entries.length * 38 + 56)}px`)

const option = computed<EChartsCoreOption>(() => ({
  animationDuration: 520,
  grid: { top: 8, right: 28, bottom: 28, left: 118 },
  tooltip: {
    trigger: "axis",
    axisPointer: { type: "shadow" },
    formatter: (raw: unknown) => {
      const params = Array.isArray(raw) ? raw : [raw]
      const point = params[0] as {
        data?: unknown
        name?: string
        value?: unknown
      } | undefined
      const value = numericChartValue(point?.value) ?? numericChartValue(point?.data)
      return point && value !== undefined
        ? `<strong>${escapeTooltip(point.name ?? "Evidence")}</strong><br/>${formatValue(value)}`
        : ""
    },
  },
  xAxis: {
    type: "value",
    axisLabel: { formatter: formatAxisValue },
    splitLine: { lineStyle: { color: "rgba(200, 170, 109, 0.14)" } },
  },
  yAxis: {
    type: "category",
    data: props.entries.map((entry) => entry.label),
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { width: 104, overflow: "truncate" },
  },
  series: [{
    type: "bar",
    data: props.entries.map((entry) => ({
      value: entry.value,
      itemStyle: { color: entry.value >= 0 ? "#0acbe6" : "#e84057", borderRadius: 3 },
    })),
    barMaxWidth: 24,
    markLine: {
      symbol: "none",
      silent: true,
      label: { show: false },
      lineStyle: { color: "rgba(240, 230, 210, 0.42)", width: 1 },
      data: [{ xAxis: 0 }],
    },
  }],
}))
</script>

<template>
  <div class="effect-chart" :style="{ height: chartHeight }">
    <BaseEChart
      :option="option"
      :ariaLabel="`Estimated ${unit === 'grade' ? 'Recall grade' : 'win-rate'} effects`"
      :height="chartHeight"
    />
  </div>
</template>

<style scoped>
.effect-chart {
  position: relative;
  min-width: 0;
  overflow: hidden;
}
</style>
