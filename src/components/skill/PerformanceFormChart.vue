<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { escapeTooltip } from "../../charts/formatters"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"
import type { PerformanceProfile } from "../../types/stats"

const props = defineProps<{ profile: PerformanceProfile }>()

const rows = computed(() => props.profile.dimensions
  .filter((dimension) => dimension.recentScore !== undefined && dimension.delta !== undefined)
  .sort((left, right) => Math.abs(right.delta!) - Math.abs(left.delta!)))

const extent = computed(() => Math.max(5, ...rows.value.map((row) => Math.ceil(Math.abs(row.delta!)))))
const option = computed<EChartsCoreOption>(() => ({
  grid: { top: 8, right: 28, bottom: 28, left: 96 },
  tooltip: {
    trigger: "item",
    formatter: (raw: unknown) => {
      const data = (raw as { data?: { value?: number; label?: string; baseline?: number; recent?: number } }).data
      return data
        ? `<strong>${escapeTooltip(data.label)}</strong><br/>Recent ${data.recent} · profile ${data.baseline}<br/>${data.value! > 0 ? "+" : ""}${data.value} RVI points`
        : ""
    },
  },
  xAxis: {
    type: "value",
    min: -extent.value,
    max: extent.value,
    axisLabel: { formatter: (value: number) => `${value > 0 ? "+" : ""}${value}` },
    splitLine: { lineStyle: { color: CHART_STYLES.gridSoft } },
  },
  yAxis: {
    type: "category",
    data: rows.value.map((row) => row.shortLabel),
    axisTick: { show: false },
  },
  series: [{
    type: "bar",
    data: rows.value.map((row) => ({
      value: row.delta,
      label: row.label,
      baseline: row.score,
      recent: row.recentScore,
      itemStyle: { color: row.delta! >= 0 ? CHART_COLOURS.positive : CHART_COLOURS.negative, borderRadius: 3 },
    })),
    barMaxWidth: 18,
    label: {
      show: true,
      position: "outside",
      color: CHART_COLOURS.text,
      fontSize: 11,
      fontWeight: 700,
      textBorderWidth: 0,
      textShadowBlur: 4,
      textShadowColor: CHART_STYLES.labelShadow,
      formatter: (raw: unknown) => {
        const value = Number((raw as { value?: unknown }).value) || 0
        return `${value > 0 ? "+" : ""}${value}`
      },
    },
  }],
}))
</script>

<template>
  <BaseEChart
    :option="option"
    ariaLabel="RVI recent form by vector compared with the recorded profile."
    :height="`${Math.max(250, rows.length * 38 + 60)}px`"
  />
</template>
