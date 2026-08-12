<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { registerInsightCharts } from "../../charts/register-insights"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"
import { boxplot } from "../../charts/statistics"
import type { SkillHistoryPoint } from "../../types/stats"
import { weekdayRecallScoreGroups } from "../../charts/evidence-adapters"

registerInsightCharts()

const props = defineProps<{ history: SkillHistoryPoint[] }>()
const groups = computed(() => weekdayRecallScoreGroups(props.history))
const eligibleGroups = computed(() => groups.value.filter((group) => group.eligible))
const learningGroups = computed(() => groups.value.filter((group) => !group.eligible))

const option = computed<EChartsCoreOption>(() => ({
  grid: { top: 20, right: 24, bottom: 34, left: 46 },
  tooltip: {
    trigger: "item",
    formatter: (raw: unknown) => {
      const item = raw as { dataIndex: number; value: number[] }
      const group = eligibleGroups.value[item.dataIndex]
      const median = item.value?.[2]
      if (!group || !Number.isFinite(median)) return "Insufficient evidence"
      return `<strong>${group.label}</strong><br/>${group.values.length} graded games<br/>Median Recall Score ${median.toFixed(1)}<br/>Box = middle 50% of games`
    },
  },
  xAxis: { type: "category", data: eligibleGroups.value.map((group) => group.label), boundaryGap: true },
  yAxis: {
    type: "value",
    min: 0,
    max: 100,
    axisLabel: { formatter: "{value}" },
    splitLine: { lineStyle: { color: CHART_STYLES.gridSoft } },
  },
  series: [{
    type: "boxplot",
    data: eligibleGroups.value.map((group) => boxplot(group.values)),
    itemStyle: { color: CHART_STYLES.liveArea, borderColor: CHART_COLOURS.live },
  }],
}))
</script>

<template>
  <div class="weekday-distribution">
    <BaseEChart
      v-if="eligibleGroups.length"
      :option="option"
      :ariaLabel="`Distribution of Recall Scores for ${eligibleGroups.length} weekdays with at least three graded matches. Each box shows the middle half of that weekday's scores.`"
      height="290px"
    />
    <p v-else class="learning-state">
      At least 3 graded matches on the same weekday are needed before Recall draws a distribution.
    </p>
    <div v-if="learningGroups.length" class="learning-days" aria-label="Weekdays still learning">
      <span>Still learning</span>
      <ul>
        <li v-for="group in learningGroups" :key="group.label">
          {{ group.label }} · {{ group.values.length }} / 3 matches
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.weekday-distribution {
  min-width: 0;
}

.learning-state {
  margin: var(--space-3) 0 0;
  padding: var(--space-4);
  border-left: 2px solid var(--gold);
  background: var(--surface-1);
  color: var(--text-secondary);
  font-size: var(--ui-text-label);
  line-height: 1.55;
}

.learning-days {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  margin-top: var(--space-2);
  color: var(--text-muted);
  font-size: var(--ui-text-label);
}

.learning-days > span {
  flex: 0 0 auto;
  color: var(--gold);
  font-weight: 600;
}

.learning-days ul {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

@container skill-insights (max-width: 500px) {
  .learning-days {
    display: grid;
    gap: var(--space-1);
  }
}
</style>
