<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core"
import { computed, ref, watch } from "vue"
import BaseEChart from "../charts/BaseEChart.vue"
import { escapeTooltip } from "../../charts/formatters"
import { CHART_COLOURS, CHART_STYLES } from "../../charts/recall-chart-theme"
import { championNameById } from "../../helpers/format"
import { rollingRecallScores } from "../../helpers/analyze-adapters"
import type { Champion } from "../../types/lol"
import type { SkillHistoryPoint } from "../../types/stats"

const props = defineProps<{ history: SkillHistoryPoint[]; catalog: Champion[] | null }>()

const options = computed(() => {
  const counts = new Map<number, number>()
  for (const game of props.history) {
    if (Number.isFinite(game.recallScore)) counts.set(game.championId, (counts.get(game.championId) ?? 0) + 1)
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
  .filter((game) => game.championId === selectedId.value && Number.isFinite(game.recallScore))
  .sort((left, right) => left.playedAt - right.playedAt))

const movingScores = computed(() => rollingRecallScores(games.value))
const gameIndex = computed(() => new Map(games.value.map((game, index) => [game.gameId, index + 1])))
const gameById = computed(() => new Map(games.value.map((game) => [game.gameId, game])))
const moving = computed(() => movingScores.value.map((entry) => ({
  value: [gameIndex.value.get(entry.gameId)!, entry.average],
  game: gameById.value.get(entry.gameId)!,
})))

const rollingByGame = computed(() => new Map(moving.value.map((point) => [
  point.game.gameId,
  Number(point.value[1]),
])))

const championLabel = computed(() => selectedId.value === undefined
  ? "Champion"
  : championNameById(props.catalog, selectedId.value))

function roleLabel(role?: string) {
  if (!role) return "Role unavailable"
  if (role.toUpperCase() === "UTILITY") return "Support"
  if (role.toUpperCase() === "MIDDLE") return "Mid"
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase()
}

const option = computed<EChartsCoreOption>(() => ({
  grid: { top: 20, right: 24, bottom: 42, left: 48 },
  tooltip: {
    trigger: "item",
    formatter: (raw: unknown) => {
      const data = (raw as { data?: { game?: SkillHistoryPoint } }).data
      const game = data?.game
      if (!game) return ""
      const rolling = rollingByGame.value.get(game.gameId)
      return [
        `<strong>${escapeTooltip(championLabel.value)}</strong>`,
        escapeTooltip(new Date(game.playedAt).toLocaleDateString()),
        `${game.win ? "Win" : "Loss"} · ${escapeTooltip(roleLabel(game.role))}`,
        `${Number(game.recallScore).toFixed(1)} Recall Score`,
        rolling === undefined ? "5-game average not available yet" : `${rolling.toFixed(1)} five-game average`,
      ].join("<br/>")
    },
  },
  xAxis: {
    type: "value",
    min: 1,
    minInterval: 1,
    name: "Selected graded game",
    nameLocation: "middle",
    nameGap: 28,
  },
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
      name: "Recorded game",
      type: "scatter",
      data: games.value.map((game, index) => ({
        value: [index + 1, game.recallScore],
        game,
        itemStyle: { color: game.win ? CHART_STYLES.positiveFill : CHART_STYLES.negativeFill },
      })),
      symbolSize: 6,
    },
    {
      name: "5-game rolling average",
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
      :ariaLabel="`Champion score history showing ${games.length} graded games in the current selection. The five-game rolling average begins only at the fifth recorded game.`"
      height="310px"
    />
    <p v-if="games.length && games.length < 5" class="muted note">
      Individual scores are shown. Five graded games are needed before the rolling average begins.
    </p>
    <p v-else-if="!games.length" class="muted empty">
      At least three graded games on one champion are needed in this selection.
    </p>
    <ol v-if="games.length" class="accessible-summary">
      <li v-for="(game, index) in games" :key="game.gameId">
        Selected graded game {{ index + 1 }}: {{ game.recallScore?.toFixed(1) }} Recall Score,
        {{ game.win ? "win" : "loss" }}, played {{ new Date(game.playedAt).toLocaleDateString() }}.
      </li>
    </ol>
  </div>
</template>

<style scoped>
.champion-control { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); margin: -4px 0 var(--space-2); color: var(--text-muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
.champion-control .league-select { width: min(100%, 230px); }
.empty { margin: var(--space-5) 0; font-size: 12px; }
.note { margin: var(--space-2) 0 0; font-size: var(--ui-text-micro); line-height: 1.5; }
.accessible-summary { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
@container analyze-page (max-width: 560px) { .champion-control { align-items: stretch; flex-direction: column; } .champion-control .league-select { width: 100%; } }
</style>
