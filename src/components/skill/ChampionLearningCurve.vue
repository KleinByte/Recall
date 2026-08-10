<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed, ref, watch } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"
import { championNameById } from "../../helpers/format"
import type { Champion } from "../../types/lol"
import type { SkillHistoryPoint } from "../../types/stats"

const props = defineProps<{ history: SkillHistoryPoint[]; catalog: Champion[] | null }>()

const options = computed(() => {
  const counts = new Map<number, number>()
  for (const game of props.history) {
    if (Number.isFinite(game.roleFitScore)) counts.set(game.championId, (counts.get(game.championId) ?? 0) + 1)
  }
  return [...counts]
    .filter(([, games]) => games >= 3)
    .sort((left, right) => right[1] - left[1])
    .map(([championId, games]) => ({ championId, games, name: championNameById(props.catalog, championId) }))
})

const selectedId = ref<number>()
watch(options, (next) => {
  if (!next.some((option) => option.championId === selectedId.value)) selectedId.value = next[0]?.championId
}, { immediate: true })

const games = computed(() => props.history
  .filter((game) => game.championId === selectedId.value && Number.isFinite(game.roleFitScore))
  .sort((left, right) => left.playedAt - right.playedAt))

const moving = computed(() => games.value.map((game, index) => {
  const window = games.value.slice(Math.max(0, index - 4), index + 1)
  return [index + 1, window.reduce((sum, entry) => sum + entry.roleFitScore!, 0) / window.length, game.win]
}))

const option = computed<EChartsCoreOption>(() => ({
  grid: { top: 20, right: 24, bottom: 42, left: 48 },
  tooltip: { trigger: "axis" },
  xAxis: { type: "value", min: 1, name: "Game on champion", nameLocation: "middle", nameGap: 28 },
  yAxis: {
    type: "value",
    name: "RoleFit",
    min: 0,
    max: 100,
    axisLabel: { formatter: "{value}" },
    splitLine: { lineStyle: { color: CHART_STYLES.gridSoft } },
  },
  series: [
    {
      name: "Game",
      type: "scatter",
      data: games.value.map((game, index) => ({
        value: [index + 1, game.roleFitScore],
        itemStyle: { color: game.win ? CHART_STYLES.positiveFill : CHART_STYLES.negativeFill },
      })),
      symbolSize: 6,
    },
    {
      name: "5-game form",
      type: "line",
      data: moving.value,
      smooth: .3,
      showSymbol: false,
      lineStyle: { color: CHART_COLOURS.accent, width: 2.5 },
    },
  ],
}))
</script>

<template>
  <div class="learning-curve">
    <label v-if="options.length" class="champion-control">
      <span>Champion</span>
      <select v-model="selectedId" class="league-select">
        <option v-for="option in options" :key="option.championId" :value="option.championId">
          {{ option.name }} · {{ option.games }} games
        </option>
      </select>
    </label>
    <BaseEChart
      v-if="games.length"
      :option="option"
      ariaLabel="Champion learning curve showing each graded match and a five-game moving RoleFit score on a zero-to-one-hundred scale."
      height="310px"
    />
    <p v-else class="muted empty">At least three graded games on one champion are needed.</p>
  </div>
</template>

<style scoped>
.champion-control { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); margin: -4px 0 var(--space-2); color: var(--text-muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
.champion-control .league-select { width: min(100%, 230px); }
.empty { margin: var(--space-5) 0; font-size: 12px; }
@media (max-width: 560px) { .champion-control { align-items: stretch; flex-direction: column; } .champion-control .league-select { width: 100%; } }
</style>
