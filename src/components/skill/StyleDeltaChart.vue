<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
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
    splitLine: { lineStyle: { color: "rgba(200, 170, 109, 0.14)" } },
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
      itemStyle: { color: change.value >= 0 ? "#0acbe6" : "#e84057", borderRadius: 3 },
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
