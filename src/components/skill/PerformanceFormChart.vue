<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { escapeTooltip } from "../../charts/formatters"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"
import { armFormComparisons } from "../../helpers/analyze-adapters"
import type { SkillGradeComponentPoint } from "../../types/stats"

const props = defineProps<{ rows: SkillGradeComponentPoint[] }>()

const compared = computed(() => armFormComparisons(props.rows))
const rows = computed(() => compared.value)

const extent = computed(() => Math.max(5, ...rows.value.map((row) => Math.ceil(Math.abs(row.delta!)))))
const option = computed<EChartsCoreOption>(() => ({
  grid: { top: 8, right: 28, bottom: 28, left: 96 },
  tooltip: {
    trigger: "item",
    formatter: (raw: unknown) => {
      const data = (raw as { data?: { value?: number; label?: string; baseline?: number; recent?: number } }).data
      return data
        ? `<strong>${escapeTooltip(data.label)}</strong><br/>Latest ${data.recent} · prior ${data.baseline}<br/>${data.value! > 0 ? "+" : ""}${data.value} arm points`
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
      baseline: Math.round(row.priorScore),
      recent: Math.round(row.recentScore),
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
        return `${value > 0 ? "+" : ""}${value.toFixed(1)}`
      },
    },
  }],
}))
</script>

<template>
  <div v-if="rows.length" class="form-chart">
    <BaseEChart
      :option="option"
      :ariaLabel="`RVI arm form comparing ${rows[0]?.recentGames ?? 0} latest measured games with the preceding ${rows[0]?.priorGames ?? 0} measured games. Career-only Range is excluded.`"
      :height="`${Math.max(250, rows.length * 38 + 60)}px`"
    />
    <ul class="accessible-summary">
      <li v-for="row in rows" :key="row.key">
        {{ row.label }}: {{ row.recentScore.toFixed(1) }} across {{ row.recentGames }} latest
        games versus {{ row.priorScore.toFixed(1) }} across {{ row.priorGames }} prior games.
      </li>
    </ul>
  </div>
  <p v-else class="empty-state">
    At least six measured games with the same Grade arm are needed to compare two separate windows.
  </p>
</template>

<style scoped>
.empty-state {
  margin: var(--space-5) 0;
  color: var(--text-muted);
  font-size: var(--ui-text-support);
  line-height: 1.55;
}

.accessible-summary {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
