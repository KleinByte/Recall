<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { escapeTooltip } from "../../charts/formatters"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"
import { championIconUrl, championNameById } from "../../helpers/format"
import { championAnalysisPoints, MIN_CHAMPION_SAMPLE } from "../../helpers/analyze-adapters"
import type { Champion } from "../../types/lol"
import type { SkillChampionPoint } from "../../types/stats"

const props = defineProps<{
  champions: SkillChampionPoint[]
  catalog: Champion[] | null
  baseline?: number
  randomized?: boolean
}>()

const rows = computed(() => championAnalysisPoints(props.champions))
const excluded = computed(() => props.champions.filter((champion) =>
  champion.gradedGames > 0 && champion.gradedGames < MIN_CHAMPION_SAMPLE).length)
const experienceCutoff = computed(() => {
  const games = rows.value.map((row) => row.gradedGames).sort((left, right) => left - right)
  return games[Math.floor(games.length / 2)] ?? 1
})
const performanceCutoff = computed(() => props.baseline ?? 50)

function quadrant(games: number, score: number) {
  const sample = games >= experienceCutoff.value ? "Larger sample" : "Smaller sample"
  const result = score >= performanceCutoff.value ? "above selection" : "below selection"
  return `${sample} · ${result}`
}

const option = computed<EChartsCoreOption>(() => ({
  grid: { top: 22, right: 28, bottom: 46, left: 52 },
  tooltip: {
    formatter: (raw: unknown) => {
      const values = (raw as { value?: Array<number | string> }).value ?? []
      return `<strong>${escapeTooltip(values[5])}</strong><br/>${escapeTooltip(values[6])}<br/>${values[0]} graded games · ${Number(values[1]).toFixed(1)} average Recall Score<br/>${Math.round(Number(values[3]) * 100)}% win rate · ${Number(values[4]).toFixed(2)} KDA<br/>${Math.round(Number(values[7]) * 100)}% Grade coverage · ${escapeTooltip(values[8])}`
    },
  },
  xAxis: {
    type: "value",
    min: 0,
    name: "Graded games",
    nameLocation: "middle",
    nameGap: 30,
    splitLine: { lineStyle: { color: CHART_STYLES.gridSoft } },
  },
  yAxis: {
    type: "value",
    name: "Recall Score",
    min: 0,
    max: 100,
    splitLine: { lineStyle: { color: CHART_STYLES.gridSoft } },
  },
  series: [{
    type: "scatter",
    data: rows.value.map((champion) => ({
      value: [
        champion.gradedGames,
        champion.averageRecallScore!,
        champion.championId,
        champion.winRate,
        champion.kda,
        championNameById(props.catalog, champion.championId),
        quadrant(champion.gradedGames, champion.averageRecallScore!),
        champion.coverage,
        champion.sampleLabel,
      ],
      symbol: `image://${championIconUrl(champion.championId)}`,
      symbolSize: 30,
      symbolKeepAspect: true,
    })),
    itemStyle: {
      color: CHART_COLOURS.live,
      opacity: 1,
      borderColor: CHART_COLOURS.text,
      borderWidth: 1,
      shadowBlur: 5,
      shadowColor: "rgba(0, 0, 0, .55)",
    },
    emphasis: { scale: 1.22 },
    markLine: {
      silent: true,
      symbol: ["none", "none"],
      label: { show: false },
      lineStyle: { color: CHART_STYLES.gridStrong, type: "dashed" },
      data: [{ xAxis: experienceCutoff.value }, { yAxis: performanceCutoff.value }],
    },
  }],
}))
</script>

<template>
  <div class="champion-results">
    <BaseEChart
      v-if="rows.length"
      :option="option"
      :ariaLabel="`Champion results for ${rows.length} champions with at least ${MIN_CHAMPION_SAMPLE} graded games. Graded sample size is on the horizontal axis and average Recall Score on a zero-to-one-hundred scale is on the vertical axis.`"
      height="330px"
    />
    <p v-else class="empty-state">
      At least {{ MIN_CHAMPION_SAMPLE }} graded games on one champion are needed for this comparison.
    </p>
    <p v-if="excluded" class="sample-note">
      {{ excluded }} champion{{ excluded === 1 ? "" : "s" }} with fewer than
      {{ MIN_CHAMPION_SAMPLE }} graded games {{ excluded === 1 ? "is" : "are" }} not plotted.
    </p>
    <p v-if="randomized" class="sample-note">
      In random-pick modes, this is a descriptive result by champion—not a recommendation or a measure of champion choice.
    </p>
    <ul class="accessible-summary">
      <li v-for="champion in rows" :key="champion.championId">
        {{ championNameById(catalog, champion.championId) }}: {{ champion.gradedGames }} graded
        games, {{ champion.averageRecallScore?.toFixed(1) }} average Recall Score,
        {{ Math.round(champion.coverage * 100) }} percent Grade coverage.
      </li>
    </ul>
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
