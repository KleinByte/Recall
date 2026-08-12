<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { escapeTooltip } from "../../charts/formatters"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"
import { championNameById } from "../../helpers/format"
import type { SkillHistoryPoint } from "../../types/stats"
import type { Champion } from "../../types/lol"
import { durationRecallScoreBins, MIN_DURATION_TREND_GAMES } from "../../charts/evidence-adapters"

const props = defineProps<{
  history: SkillHistoryPoint[]
  champions: Champion[] | null
}>()
const graded = computed(() => props.history.filter((game) => Number.isFinite(game.recallScore)))
const durationBins = computed(() => durationRecallScoreBins(graded.value))
const measuredBins = computed(() => durationBins.value.filter((bin) => bin.median !== null))

const option = computed<EChartsCoreOption>(() => ({
  grid: { top: 18, right: 24, bottom: 42, left: 48 },
  tooltip: {
    trigger: "item",
    formatter: (raw: unknown) => {
      const item = raw as { seriesName: string; dataIndex: number; value: number[] }
      if (item.seriesName === "5-minute median") {
        const bin = durationBins.value[item.dataIndex]
        return bin && bin.median !== null
          ? `<strong>${escapeTooltip(bin.label)}</strong><br/>Median Recall Score ${bin.median.toFixed(1)}<br/>${bin.games} graded matches`
          : "Insufficient evidence"
      }
      const game = graded.value[item.dataIndex]
      return game ? `<strong>${escapeTooltip(championNameById(props.champions, game.championId))}</strong><br/>${(game.durationSecs / 60).toFixed(1)} minutes · ${escapeTooltip(game.grade ?? "–")} · Recall Score ${game.recallScore?.toFixed(1)}<br/>${game.win ? "Win" : "Loss"}` : ""
    },
  },
  xAxis: { type: "value", name: "Minutes", min: 0 },
  yAxis: {
    type: "value",
    name: "Recall Score",
    min: 0,
    max: 100,
    axisLabel: { formatter: "{value}" },
    splitLine: { lineStyle: { color: CHART_STYLES.gridSoft } },
  },
  series: [
    {
      name: "Games",
      type: "scatter",
      symbolSize: 8,
      data: graded.value.map((game) => ({
        value: [game.durationSecs / 60, game.recallScore],
        symbol: game.win ? "circle" : "diamond",
        itemStyle: { color: game.win ? CHART_COLOURS.positive : CHART_COLOURS.negative, opacity: 0.65 },
      })),
    },
    {
      name: "5-minute median",
      type: "line",
      smooth: false,
      connectNulls: false,
      symbolSize: 5,
      data: durationBins.value.map((bin) => [bin.minute, bin.median]),
      lineStyle: { color: CHART_COLOURS.text, width: 2.5 },
      itemStyle: { color: CHART_COLOURS.accent },
    },
  ],
}))
</script>

<template>
  <div class="duration-chart">
    <BaseEChart
      :option="option"
      :ariaLabel="`Recall Score by match duration for ${graded.length} graded matches. Circles are wins and diamonds are losses. The unsmoothed line shows the median only for five-minute bins with at least ${MIN_DURATION_TREND_GAMES} matches; ${measuredBins.length} bins qualify.`"
      height="310px"
    />
    <ul class="duration-key" aria-label="Duration chart legend">
      <li><span class="win-dot" aria-hidden="true" /> Win</li>
      <li><span class="loss-dot" aria-hidden="true" /> Loss</li>
      <li><span class="median-line" aria-hidden="true" /> 5-minute median · 5+ matches</li>
    </ul>
    <p v-if="!measuredBins.length" class="learning-note">
      No five-minute duration band has 5 graded matches yet, so Recall is showing matches without a trend line.
    </p>
  </div>
</template>

<style scoped>
.duration-chart {
  min-width: 0;
}

.duration-key {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  margin: -2px 18px 0;
  padding: 0;
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  list-style: none;
}

.duration-key li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.win-dot,
.loss-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  background: var(--win);
}

.win-dot { border-radius: 50%; }
.loss-dot { transform: rotate(45deg); background: var(--loss); }

.median-line {
  width: 17px;
  height: 2px;
  background: var(--text-primary);
}

.learning-note {
  margin: var(--space-3) 0 0;
  padding: var(--space-3);
  border-left: 2px solid var(--gold);
  background: var(--surface-1);
  color: var(--text-secondary);
  font-size: var(--ui-text-label);
  line-height: 1.5;
}
</style>
