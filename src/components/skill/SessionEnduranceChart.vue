<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"
import { escapeTooltip } from "../../charts/formatters"
import { gradeSessionPositionAnalysis } from "../../helpers/analyze-adapters"
import type { SkillGradeComponentPoint, SkillHistoryPoint } from "../../types/stats"

const props = defineProps<{
  rows: SkillGradeComponentPoint[]
  history: SkillHistoryPoint[]
}>()

const analysis = computed(() => gradeSessionPositionAnalysis(props.rows, props.history))
const buckets = computed(() => analysis.value.buckets)
const thinBuckets = computed(() => buckets.value.filter((bucket) => bucket.games < 3).length)
const ariaLabel = computed(() => [
  `Comparison of game order across ${analysis.value.sessions} play sessions.`,
  "Each point states its exact result and graded-game sample.",
  analysis.value.usesStableOrdinal
    ? "Session position was recorded before page filters."
    : "Position is order among selected measured games only.",
].join(" "))

const option = computed<EChartsCoreOption>(() => ({
  grid: { top: 28, right: 48, bottom: 34, left: 46 },
  tooltip: {
    trigger: "axis",
    formatter: (raw: unknown) => {
      const params = Array.isArray(raw) ? raw as Array<{ dataIndex?: number }> : []
      const bucket = buckets.value[params[0]?.dataIndex ?? -1]
      if (!bucket) return ""
      const outcome = bucket.outcomeGames
        ? `${Math.round(bucket.wins / bucket.outcomeGames * 100)}% win rate · ${bucket.outcomeGames} results`
        : "Results unavailable"
      const score = !bucket.scoreSampleSufficient
        ? `Recall Score distribution withheld · ${bucket.gradedGames} graded game${bucket.gradedGames === 1 ? "" : "s"}`
        : `${bucket.medianRecallScore!.toFixed(1)} typical Recall Score · middle half ${bucket.lowerQuartileRecallScore!.toFixed(1)}–${bucket.upperQuartileRecallScore!.toFixed(1)} · ${bucket.gradedGames} graded games`
      return `<strong>${escapeTooltip(bucket.label)}</strong><br/>${outcome}<br/>${score}`
    },
  },
  legend: { top: 0, data: ["Recorded win rate", "Middle half", "Typical Recall Score"] },
  xAxis: { type: "category", data: buckets.value.map((bucket) => bucket.label), axisTick: { show: false } },
  yAxis: [
    { type: "value", min: 0, max: 100, axisLabel: { formatter: "{value}%" }, splitLine: { lineStyle: { color: CHART_STYLES.gridSoft } } },
    { type: "value", min: 0, max: 100, axisLabel: { formatter: "{value}" }, splitLine: { show: false } },
  ],
  series: [
    {
      name: "Recorded win rate",
      type: "line",
      data: buckets.value.map((bucket) => ({
        value: bucket.outcomeGames ? Math.round(bucket.wins / bucket.outcomeGames * 100) : null,
        itemStyle: { color: CHART_COLOURS.live, borderColor: CHART_COLOURS.text, borderWidth: 1 },
      })),
      connectNulls: false,
      symbol: "diamond",
      symbolSize: 8,
      lineStyle: { color: CHART_COLOURS.live, width: 1.5, type: "dashed" },
    },
    {
      name: "Score range floor",
      type: "bar",
      yAxisIndex: 1,
      stack: "score-iqr",
      barMaxWidth: 22,
      data: buckets.value.map((bucket) => bucket.scoreSampleSufficient
        ? bucket.lowerQuartileRecallScore
        : null),
      itemStyle: { color: "transparent" },
      emphasis: { disabled: true },
      tooltip: { show: false },
    },
    {
      name: "Middle half",
      type: "bar",
      yAxisIndex: 1,
      stack: "score-iqr",
      barMaxWidth: 22,
      data: buckets.value.map((bucket) => bucket.scoreSampleSufficient
        ? bucket.upperQuartileRecallScore! - bucket.lowerQuartileRecallScore!
        : null),
      itemStyle: {
        color: CHART_STYLES.liveFill,
        borderColor: CHART_COLOURS.accent,
        borderWidth: 1,
        borderRadius: 3,
      },
    },
    {
      name: "Typical Recall Score",
      type: "scatter",
      yAxisIndex: 1,
      data: buckets.value.map((bucket) => bucket.medianRecallScore),
      symbol: "circle",
      symbolSize: 9,
      itemStyle: { color: CHART_COLOURS.accent, borderColor: CHART_COLOURS.text, borderWidth: 1 },
    },
  ],
}))
</script>

<template>
  <div class="session-chart">
    <BaseEChart
      v-if="analysis.comparable"
      :option="option"
      :ariaLabel="ariaLabel"
      height="300px"
    />
    <p v-else class="empty-state">
      At least three measured games in two different session positions are needed for this comparison.
    </p>
    <p v-if="analysis.comparable" class="sample-note">
      {{ analysis.usesStableOrdinal
        ? "Session position was recorded before these page filters were applied."
        : "Older records show order among selected measured games, not the original session position." }}
      This is an association, not evidence that longer sessions caused the result.
      <template v-if="thinBuckets">
        {{ thinBuckets }} position{{ thinBuckets === 1 ? " does" : "s do" }} not have enough games to show a score range.
      </template>
    </p>
    <table v-if="analysis.comparable" class="accessible-table">
      <caption>Session position samples</caption>
      <thead><tr><th>Position</th><th>Results</th><th>Win rate</th><th>Graded</th><th>Typical score</th><th>Middle half</th></tr></thead>
      <tbody>
        <tr v-for="bucket in buckets" :key="bucket.ordinal">
          <th>{{ bucket.label }}</th>
          <td>{{ bucket.outcomeGames }}</td>
          <td>{{ bucket.outcomeGames ? `${Math.round(bucket.wins / bucket.outcomeGames * 100)}%` : "N/A" }}</td>
          <td>{{ bucket.gradedGames }}</td>
          <td>{{ bucket.medianRecallScore?.toFixed(1) ?? "Withheld" }}</td>
          <td>{{ bucket.scoreSampleSufficient ? `${bucket.lowerQuartileRecallScore?.toFixed(1)}–${bucket.upperQuartileRecallScore?.toFixed(1)}` : "Withheld" }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.sample-note,
.empty-state {
  margin: var(--space-2) 0 0;
  color: var(--text-muted);
  font-size: var(--ui-text-micro);
  line-height: 1.5;
}

.empty-state { margin: var(--space-5) 0; font-size: var(--ui-text-support); }

.accessible-table {
  position: fixed;
  top: 0;
  left: 0;
  width: 1px;
  max-width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  transform: scale(0);
  transform-origin: top left;
  white-space: nowrap;
}
</style>
