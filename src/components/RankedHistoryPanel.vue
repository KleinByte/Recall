<script setup lang="ts">
import { computed, ref, watch } from "vue"
import Panel from "./ui/Panel.vue"
import RankGraph from "./RankGraph.vue"
import {
  currentRankedSeason,
  pointsForSeason,
  seasonsWithRankedHistory,
} from "../helpers/ranked-seasons"
import { rankedQueueLabel } from "../helpers/ranked-queues"
import type { RankedHistory } from "../types/stats"

const props = withDefaults(defineProps<{
  histories: RankedHistory[]
  allowSeasonSelection?: boolean
  compact?: boolean
}>(), {
  allowSeasonSelection: false,
  compact: false,
})

const queues = computed(() => props.histories
  .filter((history) => history.points.length > 0)
  .map((history) => ({ queue: history.queue, label: rankedQueueLabel(history.queue) }))
  .sort((left, right) => {
    if (left.queue === "RANKED_SOLO_5x5") return -1
    if (right.queue === "RANKED_SOLO_5x5") return 1
    return left.label.localeCompare(right.label)
  }))

const selectedQueue = ref("RANKED_SOLO_5x5")
const selectedSeason = ref(props.allowSeasonSelection ? "all" : currentRankedSeason().id)
let initializedQueue = false

watch(queues, (available) => {
  if (!initializedQueue || !available.some((entry) => entry.queue === selectedQueue.value)) {
    const active = currentRankedSeason()
    const hasCurrentPoints = (queue: string) => {
      const history = props.histories.find((entry) => entry.queue === queue)
      return pointsForSeason(history?.points ?? [], active).length > 0
    }
    const preferred = props.allowSeasonSelection
      ? available.find((entry) => entry.queue === "RANKED_SOLO_5x5")
      : available.find((entry) =>
        entry.queue === "RANKED_SOLO_5x5" && hasCurrentPoints(entry.queue),
      ) ?? available.find((entry) => hasCurrentPoints(entry.queue))
    selectedQueue.value = preferred?.queue ?? available[0]?.queue ?? ""
    initializedQueue = true
  }
}, { immediate: true })

const activeSeason = computed(() => currentRankedSeason())
const selectedHistory = computed(() =>
  props.histories.find((history) => history.queue === selectedQueue.value),
)
const seasons = computed(() => seasonsWithRankedHistory(
  selectedHistory.value ? [selectedHistory.value] : [],
))
watch(seasons, (available) => {
  if (
    selectedSeason.value !== "all" &&
    !available.some((season) => season.id === selectedSeason.value)
  ) selectedSeason.value = "all"
})
const selectedSeasonDefinition = computed(() =>
  selectedSeason.value === "all"
    ? undefined
    : seasons.value.find((season) => season.id === selectedSeason.value) ??
      (selectedSeason.value === activeSeason.value.id ? activeSeason.value : undefined),
)
const points = computed(() => {
  const all = selectedHistory.value?.points ?? []
  const season = props.allowSeasonSelection
    ? selectedSeasonDefinition.value
    : activeSeason.value
  return season ? pointsForSeason(all, season) : all
})
const first = computed(() => points.value[0])
const latest = computed(() => points.value.at(-1))
const change = computed(() =>
  first.value && latest.value ? latest.value.points - first.value.points : 0,
)
const periodLabel = computed(() => props.allowSeasonSelection
  ? selectedSeasonDefinition.value?.label ?? "All seasons"
  : activeSeason.value.label,
)
const historyMeta = computed(() => {
  if (!first.value) return `${periodLabel.value} · no readings`
  const start = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(first.value.recordedAt))
  return `${periodLabel.value} · since ${start}`
})
</script>

<template>
  <Panel
    title="Rank over time"
    :meta="periodLabel"
    class="ranked-history-panel"
    :class="{ compact }"
  >
    <template #actions>
      <div class="rank-controls">
        <label class="rank-control" for="ranked-queue">
          <span class="control-label">Queue</span>
          <span class="select-well">
            <select id="ranked-queue" v-model="selectedQueue" class="instrument-select">
              <option v-for="queue in queues" :key="queue.queue" :value="queue.queue">
                {{ queue.label }}
              </option>
            </select>
          </span>
        </label>
        <label v-if="allowSeasonSelection" class="rank-control" for="ranked-season">
          <span class="control-label">Season</span>
          <span class="select-well">
            <select id="ranked-season" v-model="selectedSeason" class="instrument-select">
              <option value="all">All seasons</option>
              <option v-for="season in seasons" :key="season.id" :value="season.id">
                {{ season.label }}
              </option>
            </select>
          </span>
        </label>
      </div>
    </template>

    <template v-if="latest">
      <div class="rank-summary">
        <div>
          <div class="queue-rank">{{ latest.label }}</div>
          <span class="muted reading-meta">{{ historyMeta }}</span>
        </div>
        <div class="rank-current">
          <span class="numeric queue-lp">{{ latest.leaguePoints }} LP</span>
          <span
            v-if="points.length > 1"
            class="numeric rank-change"
            :class="change > 0 ? 'up' : change < 0 ? 'down' : ''"
          >
            {{ change > 0 ? "+" : "" }}{{ change }} LP
          </span>
          <span class="muted queue-record">{{ latest.wins }}W {{ latest.losses }}L</span>
        </div>
      </div>
      <RankGraph :points="points" :height="compact ? '150px' : '220px'" />
    </template>
    <p v-else class="muted empty-period">
      No {{ rankedQueueLabel(selectedQueue) }} readings were recorded during {{ periodLabel }}.
    </p>
  </Panel>
</template>

<style scoped>
.rank-controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  margin-left: auto;
}

.rank-control {
  display: grid;
  gap: 2px;
  min-width: 118px;
  cursor: pointer;
}

.control-label {
  padding-left: 7px;
  color: var(--ui-text-muted);
  font: var(--ui-text-micro) var(--font-heading);
  letter-spacing: 1.35px;
  line-height: 1;
  text-transform: uppercase;
}

.select-well {
  position: relative;
  display: block;
  overflow: hidden;
  border: 1px solid var(--ui-control-border);
  border-radius: var(--ui-radius-xs);
  background: var(--ui-surface-inset);
  box-shadow: var(--ui-shadow-inset);
  transition: border-color 120ms ease;
}

.select-well::after {
  content: "";
  position: absolute;
  top: 50%;
  right: 10px;
  width: 6px;
  height: 6px;
  border-right: 1px solid var(--ui-accent-strong);
  border-bottom: 1px solid var(--ui-accent-strong);
  pointer-events: none;
  transform: translateY(-70%) rotate(45deg);
}

.select-well:focus-within {
  border-color: var(--ui-focus-ring);
  box-shadow:
    var(--ui-shadow-inset),
    var(--ui-shadow-focus);
}

.instrument-select {
  width: 100%;
  min-height: 29px;
  padding: 4px 28px 4px 9px;
  appearance: none;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ui-control-text);
  font: var(--ui-text-label) var(--font-heading);
  letter-spacing: .55px;
  cursor: pointer;
}

.instrument-select option {
  background: var(--ui-shell);
  color: var(--ui-text);
}

.rank-summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-1);
}

.queue-rank {
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: 18px;
  letter-spacing: .4px;
}

.reading-meta,
.queue-record,
.rank-change {
  font-size: 11px;
}

.rank-current {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.queue-lp {
  color: var(--gold);
  font-size: 14px;
}

.rank-change.up { color: var(--win); }
.rank-change.down { color: var(--loss); }

.empty-period {
  min-height: 220px;
  display: grid;
  place-items: center;
  margin: 0;
  text-align: center;
  font-size: 12px;
}

.compact .rank-summary {
  align-items: center;
  margin-bottom: 0;
}

.compact .queue-rank {
  font-size: 16px;
}

.compact .empty-period {
  min-height: 150px;
}

@media (max-width: 620px) {
  .ranked-history-panel :deep(.head) { flex-wrap: wrap; }
  .rank-controls {
    flex-basis: 100%;
    justify-content: flex-start;
    width: 100%;
    margin-left: 0;
  }
  .rank-control { flex: 1 1 118px; }
}
</style>
