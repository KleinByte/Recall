<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { championNameById } from "../../helpers/format"
import { matchInspectorContext } from "../../helpers/analyze-adapters"
import type { Champion } from "../../types/lol"
import type { SkillGradeComponentPoint, SkillHistoryPoint } from "../../types/stats"

const props = defineProps<{
  rows: SkillGradeComponentPoint[]
  history: SkillHistoryPoint[]
  catalog: Champion[] | null
}>()

const games = computed(() => [...props.rows]
  .sort((left, right) => left.playedAt - right.playedAt || left.gameId - right.gameId)
  .slice(-24))
const historyByGame = computed(() => new Map(props.history.map((game) => [game.gameId, game])))
const selectedId = ref<number>()

watch(games, (next) => {
  if (!next.some((game) => game.gameId === selectedId.value)) {
    selectedId.value = next.at(-1)?.gameId
  }
}, { immediate: true })

const selected = computed(() => games.value.find((game) => game.gameId === selectedId.value))
const context = computed(() => selected.value
  ? matchInspectorContext(selected.value, historyByGame.value.get(selected.value.gameId))
  : undefined)
const orderedComponents = computed(() => selected.value?.components ?? [])
const contributionSegments = computed(() => {
  let offset = 0
  const total = orderedComponents.value.reduce((sum, component) => sum + component.contribution, 0)
  return orderedComponents.value.map((component, index) => {
    const start = offset
    const width = total > 0 ? component.contribution / total * 100 : 0
    offset += width
    return {
      key: component.key,
      label: component.label,
      style: {
        left: `${Math.min(100, start)}%`,
        width: `${Math.min(100 - start, width)}%`,
        background: `hsl(${188 + index * 24} 72% ${55 + index % 2 * 7}%)`,
      },
    }
  })
})

function dateLabel(playedAt: number) {
  return new Date(playedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function roleLabel(role?: string) {
  if (!role) return undefined
  const normalized = role.toUpperCase()
  if (normalized === "UTILITY") return "Support"
  if (normalized === "MIDDLE") return "Mid"
  if (normalized === "BOTTOM") return "Bottom"
  return normalized.charAt(0) + normalized.slice(1).toLowerCase()
}
</script>

<template>
  <div v-if="selected && context" class="grade-inspector">
    <div class="inspector-toolbar">
      <label class="match-control">
        <span>Measured match</span>
        <select v-model="selectedId" class="league-select">
          <option v-for="game in games" :key="game.gameId" :value="game.gameId">
            {{ dateLabel(game.playedAt) }} · {{ game.grade ?? "No letter" }} ·
            {{ Math.round(game.compositePercentile * 100) }}
          </option>
        </select>
      </label>
      <div class="selected-summary">
        <span class="score-label">Recall Score</span>
        <strong>{{ Math.round(context.recallScore) }}</strong>
        <span v-if="selected.grade" class="grade-chip">{{ selected.grade }}</span>
        <span class="outcome-chip" :class="context.outcome">
          {{ context.outcome === "win" ? "Win" : context.outcome === "loss" ? "Loss" : "Result unavailable" }}
        </span>
      </div>
    </div>

    <p class="match-context">
      {{ dateLabel(selected.playedAt) }}
      <template v-if="context.championId">
        · {{ championNameById(catalog, context.championId) }}
      </template>
      <template v-if="roleLabel(context.role)"> · {{ roleLabel(context.role) }}</template>
      · {{ orderedComponents.length }} measured arms
    </p>

    <div
      class="contribution-track"
      role="img"
      :aria-label="`How ${orderedComponents.length} measured arms contributed to this match Grade. The final Recall Score is ${Math.round(context.recallScore)}.`"
    >
      <span
        v-for="segment in contributionSegments"
        :key="segment.key"
        class="contribution-segment"
        :style="segment.style"
        :title="segment.label"
      />
    </div>
    <p class="calibration-note">
      The strip shows how much each arm counted toward this match's Grade. Recall combines the arm
      results, then compares the performance with similar saved games to produce the score above.
    </p>

    <ol class="arm-contributions" aria-label="Grade arm contributions">
      <li v-for="component in orderedComponents" :key="component.key">
        <div class="arm-head">
          <strong>{{ component.label }}</strong>
          <span>{{ Math.round(component.percentile * 100) }} arm score</span>
        </div>
        <div class="arm-bar" aria-hidden="true">
          <span :style="{ width: `${Math.max(1, component.percentile * 100)}%` }" />
        </div>
        <p>
          Counted for {{ Math.round(component.weight * 100) }}% of this Grade ·
          {{ (component.contribution * 100).toFixed(1) }} points in the mix
        </p>
      </li>
    </ol>
  </div>
  <p v-else class="empty-state">No measured Grade breakdowns are available in this selection.</p>
</template>

<style scoped>
.grade-inspector { min-width: 0; }

.inspector-toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-3);
}

.match-control {
  display: grid;
  flex: 1 1 260px;
  gap: 5px;
  max-width: 360px;
  color: var(--text-muted);
  font-size: var(--ui-text-micro);
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.selected-summary {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 7px;
  min-width: 0;
}

.score-label {
  color: var(--text-muted);
  font-size: var(--ui-text-support);
}

.selected-summary > strong {
  color: var(--gold-bright);
  font-family: var(--font-display);
  font-size: 26px;
  line-height: 1;
}

.grade-chip,
.outcome-chip {
  padding: 3px 7px;
  border: 1px solid var(--ui-divider);
  border-radius: 999px;
  color: var(--text-secondary);
  background: rgba(3, 10, 20, .38);
  font-size: var(--ui-text-micro);
  font-weight: 700;
}

.outcome-chip.win { border-color: rgba(45, 212, 135, .32); color: var(--win); }
.outcome-chip.loss { border-color: rgba(244, 94, 110, .28); color: var(--loss); }
.outcome-chip.unavailable { color: var(--text-muted); }

.match-context {
  margin: var(--space-3) 0 var(--space-2);
  color: var(--text-muted);
  font-size: var(--ui-text-support);
}

.calibration-note {
  margin: 7px 0 0;
  color: var(--text-muted);
  font-size: var(--ui-text-micro);
  line-height: 1.45;
}

.contribution-track {
  position: relative;
  height: 13px;
  overflow: hidden;
  border: 1px solid rgba(200, 170, 109, .2);
  border-radius: 999px;
  background: rgba(3, 10, 20, .7);
}

.contribution-segment {
  position: absolute;
  top: 0;
  bottom: 0;
  border-right: 1px solid rgba(3, 10, 20, .7);
}

.arm-contributions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
}

.arm-contributions li {
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid rgba(200, 170, 109, .13);
  border-radius: 7px;
  background: rgba(3, 10, 20, .26);
}

.arm-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  font-size: var(--ui-text-support);
}

.arm-head strong {
  overflow: hidden;
  color: var(--text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.arm-head span { flex: none; color: var(--gold); font-variant-numeric: tabular-nums; }

.arm-bar {
  height: 3px;
  margin: 7px 0 6px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, .07);
}

.arm-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(10, 203, 230, .58), var(--cyan));
}

.arm-contributions p,
.empty-state {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--ui-text-micro);
  line-height: 1.45;
}

.empty-state { margin: var(--space-5) 0; font-size: var(--ui-text-support); }

@container analyze-page (max-width: 680px) {
  .inspector-toolbar { align-items: stretch; flex-direction: column; }
  .match-control { flex-basis: auto; width: 100%; max-width: none; }
  .selected-summary { justify-content: flex-start; }
  .arm-contributions { grid-template-columns: minmax(0, 1fr); }
}
</style>
