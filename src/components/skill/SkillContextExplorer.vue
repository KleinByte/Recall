<script setup lang="ts">
import { ref } from "vue"
import DurationGradeScatter from "./DurationGradeScatter.vue"
import OutcomeTrendChart from "./OutcomeTrendChart.vue"
import WeekdayGradeBoxplot from "./WeekdayGradeBoxplot.vue"
import type { BucketRow, SkillHistoryPoint, TimeBucketRow } from "../../types/stats"
import type { Champion } from "../../types/lol"

defineProps<{
  history: SkillHistoryPoint[]
  outcomes: {
    duration: BucketRow[]
    hours: TimeBucketRow[]
    weekdays: TimeBucketRow[]
  }
  timezoneLabel: string
  champions: Champion[] | null
}>()

type ContextView = "weekday" | "time" | "duration"

const view = ref<ContextView>("weekday")
const open = ref(false)
const views: Array<{ key: ContextView; label: string }> = [
  { key: "weekday", label: "Day of week" },
  { key: "time", label: "Time of day" },
  { key: "duration", label: "Game length" },
]

function updateOpen(event: Event) {
  open.value = (event.currentTarget as HTMLDetailsElement).open
}
</script>

<template>
  <details class="context-explorer" @toggle="updateOpen">
    <summary>
      <span>
        <strong>Context explorer</strong>
        <small>Check when and in what kinds of games your results change.</small>
      </span>
      <span class="summary-action">{{ open ? "Close" : "Explore" }}</span>
    </summary>

    <div class="explorer-body">
      <div class="context-tabs" role="group" aria-label="Choose a performance context">
        <button
          v-for="item in views"
          :key="item.key"
          type="button"
          :aria-pressed="view === item.key"
          @click="view = item.key"
        >
          {{ item.label }}
        </button>
      </div>

      <section
        v-if="view === 'weekday'"
        aria-label="Recall Score by weekday"
      >
        <header>
          <div>
            <h3>Recall Score by weekday</h3>
            <p>Each box shows the usual spread of your scores on that day. A weekday needs at least 3 graded matches to appear.</p>
          </div>
          <span>{{ timezoneLabel }}</span>
        </header>
        <WeekdayGradeBoxplot :history="history" />
      </section>

      <section
        v-else-if="view === 'time'"
        aria-label="Recorded outcomes by time of day"
      >
        <header>
          <div>
            <h3>Recorded outcomes by time of day</h3>
            <p>Bars show how often you played; the line shows how often those games were wins. Check the game count before trusting a small time window.</p>
          </div>
          <span>{{ timezoneLabel }}</span>
        </header>
        <OutcomeTrendChart
          :rows="outcomes.hours"
          aria-label="Games played and recorded win rate by local time of day"
        />
      </section>

      <section
        v-else
        aria-label="Recall Score by game length"
      >
        <header>
          <div>
            <h3>Recall Score by game length</h3>
            <p>Each dot is one graded game. When at least 5 games land in the same five-minute range, the line shows the typical score for that game length.</p>
          </div>
        </header>
        <DurationGradeScatter :history="history" :champions="champions" />
      </section>
    </div>
  </details>
</template>

<style scoped>
.context-explorer {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--surface-1) 78%, transparent);
}

.context-explorer > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 62px;
  gap: var(--space-4);
  padding: 10px var(--space-4);
  cursor: pointer;
  user-select: none;
}

.context-explorer > summary > span:first-child {
  display: grid;
  gap: 3px;
}

.context-explorer summary strong {
  color: var(--text-primary);
  font-family: var(--font-heading);
  font-size: 14px;
  font-weight: 600;
}

.context-explorer summary small {
  color: var(--text-muted);
  font-size: var(--ui-text-label);
}

.summary-action {
  color: var(--cyan);
  font-size: var(--ui-text-label);
  text-transform: uppercase;
  letter-spacing: .08em;
}

.context-explorer[open] > summary {
  border-bottom: 1px solid var(--border-subtle);
}

.explorer-body {
  padding: var(--space-4);
}

.context-tabs {
  display: inline-flex;
  max-width: 100%;
  overflow-x: auto;
  padding: 3px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.context-tabs button {
  min-height: 36px;
  padding: 6px 14px;
  border: 0;
  border-radius: calc(var(--radius-sm) - 2px);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: var(--ui-text-label);
  cursor: pointer;
  white-space: nowrap;
}

.context-tabs button[aria-pressed="true"] {
  background: color-mix(in srgb, var(--cyan) 12%, var(--surface-3));
  color: var(--text-primary);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cyan) 40%, transparent);
}

.explorer-body section {
  min-width: 0;
  padding-top: var(--space-4);
}

.explorer-body section > header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-2);
}

.explorer-body h3,
.explorer-body p {
  margin: 0;
}

.explorer-body h3 {
  color: var(--gold-bright);
  font-family: var(--font-heading);
  font-size: 14px;
}

.explorer-body p,
.explorer-body header > span {
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  line-height: 1.5;
}

.explorer-body p {
  margin-top: 4px;
}

.explorer-body header > span {
  flex: 0 0 auto;
}

@container skill-insights (max-width: 520px) {
  .context-explorer > summary,
  .explorer-body section > header {
    align-items: flex-start;
  }

  .context-explorer summary small {
    display: none;
  }

  .explorer-body {
    padding: var(--space-3);
  }

  .context-tabs {
    display: flex;
  }

  .context-tabs button {
    flex: 1 0 auto;
    padding-inline: 10px;
  }
}
</style>
