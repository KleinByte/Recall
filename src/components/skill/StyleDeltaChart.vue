<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"
import {
  escapeTooltip,
  formatSigned,
  numericChartValue,
} from "../../charts/formatters"
import type { StyleAxis } from "../../types/stats"

const props = defineProps<{
  baseline: StyleAxis[]
  recent: StyleAxis[]
}>()

const changes = computed(() => props.baseline.map((axis) => ({
  label: axis.label,
  value: Math.round(((props.recent.find((entry) => entry.key === axis.key)?.value ?? axis.value) - axis.value) * 100),
})))

const option = computed<EChartsCoreOption>(() => ({
  animationDuration: 520,
  grid: { top: 8, right: 24, bottom: 28, left: 92 },
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
        ? `<strong>${escapeTooltip(point.name ?? "Playstyle change")}</strong><br/>${formatSigned(value, 0)} pp`
        : ""
    },
  },
  xAxis: {
    type: "value",
    axisLabel: { formatter: (value: number) => `${formatSigned(value, 0)} pp` },
    splitLine: { lineStyle: { color: CHART_STYLES.grid } },
  },
  yAxis: {
    type: "category",
    data: changes.value.map((change) => change.label),
    axisLine: { show: false },
    axisTick: { show: false },
  },
  series: [{
    type: "bar",
    data: changes.value.map((change) => ({
      value: change.value,
      itemStyle: { color: change.value >= 0 ? CHART_COLOURS.live : CHART_COLOURS.negative, borderRadius: 3 },
    })),
    barMaxWidth: 24,
    markLine: {
      symbol: "none",
      silent: true,
      label: { show: false },
      lineStyle: { color: CHART_STYLES.zeroLine, width: 1 },
      data: [{ xAxis: 0 }],
    },
  }],
}))
</script>

<template>
  <div class="style-delta">
    <BaseEChart :option="option" ariaLabel="Changes in play style compared with the baseline period" />
  </div>
</template>

<style scoped>
.style-delta {
  height: 260px;
  position: relative;
}
</style>
