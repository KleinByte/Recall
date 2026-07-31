<script setup lang="ts">
import { computed } from "vue"
import InsightFinding from "./InsightFinding.vue"
import type {
  InsightSection,
  ModeFamily,
  PredictiveSection,
  SkillReportV2,
} from "../../types/stats"

const props = defineProps<{
  insights: SkillReportV2["insights"]
  family: ModeFamily
  timezoneLabel: string
}>()

const sections = computed<Array<{
  title: string
  section?: InsightSection
  kind?: "predictive"
  time?: boolean
}>>(() => [
  { title: "Best-game pattern", section: props.insights.bestGamePattern },
  { title: "Playing conditions", section: props.insights.conditions, time: true },
  { title: "Predictive signals", kind: "predictive" },
  { title: "Game shape", section: props.insights.duration },
  { title: "Trends", section: props.insights.trends },
  { title: "Champion choices", section: props.insights.champions },
  { title: "Item associations", section: props.insights.items },
])

const currentGames = (section: InsightSection) =>
  Math.max(0, ...section.findings.map((finding) => finding.eligibleGames))

const predictiveCopy = (predictive: PredictiveSection) => ({
  insufficient: {
    title: "Not enough graded history for predictive signals",
    body: predictive.message ?? `${predictive.neededGames ?? 0} more graded games required.`,
  },
  "no-signal": {
    title: "No repeatable pregame signal yet",
    body: predictive.message ?? "Eligible history did not improve untouched chronological holdout predictions.",
  },
  ready: {
    title: "Repeatable pregame signals",
    body: predictive.message ?? "These pregame-known factors repeated on untouched chronological holdout games.",
  },
  error: {
    title: "Predictive analysis unavailable",
    body: predictive.message ?? "The model could not be evaluated for this scope.",
  },
})[predictive.state]

const signalEffect = (value: number) => `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)} pp`
</script>

<template>
  <div class="insights">
    <section v-for="entry in sections" :key="entry.title" class="insight-band">
      <header class="section-head">
        <div>
          <h2>{{ entry.title }}</h2>
          <p v-if="entry.kind === 'predictive'" class="method">
            Chronological ridge-logistic validation using pregame-known context only.
          </p>
          <p v-else-if="entry.section" class="method">{{ entry.section.method }}</p>
        </div>
        <span v-if="entry.time" class="timezone">
          Times use this device's current timezone: {{ timezoneLabel }}.
        </span>
      </header>

      <div v-if="entry.kind === 'predictive'" class="predictive-state">
        <h3>{{ predictiveCopy(insights.predictive).title }}</h3>
        <p>{{ predictiveCopy(insights.predictive).body }}</p>
        <ul v-if="insights.predictive.state === 'ready' && insights.predictive.signals?.length">
          <li v-for="signal in insights.predictive.signals" :key="signal.feature">
            <span>{{ signal.feature }}</span>
            <span class="numeric" :class="signal.direction">{{ signalEffect(signal.marginalEffect) }}</span>
          </li>
        </ul>
      </div>

      <div v-else-if="entry.section?.findings.length" class="finding-grid">
        <InsightFinding
          v-for="finding in entry.section.findings"
          :key="finding.key"
          :finding="finding"
        />
      </div>
      <p v-else-if="entry.section" class="sparse">
        {{ currentGames(entry.section) }} current; {{ entry.section.neededGames }} more eligible games required.
      </p>
      <p v-if="entry.section?.key === 'champions' && family === 'aram'" class="context-note">
        Champion assignment limits control over pool breadth in ARAM and Mayhem.
      </p>
      <p v-if="entry.section?.key === 'items'" class="context-note">
        Final inventory is observed; purchase order is not. Completion is associated with champion, role, duration, gold, and outcome.
      </p>
    </section>
  </div>
</template>

<style scoped>
.insights {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  min-width: 0;
}

.insight-band {
  min-width: 0;
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-subtle);
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-4);
  margin-bottom: var(--space-3);
}

h2 {
  margin: 0;
  color: var(--gold-bright);
  font-family: var(--font-heading);
  font-size: 16px;
  font-weight: 500;
}

.method,
.timezone,
.context-note,
.sparse {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.method {
  margin: var(--space-1) 0 0;
}

.timezone {
  max-width: 320px;
  text-align: right;
}

.finding-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-3);
  align-items: stretch;
}

.sparse {
  margin: 0;
  padding: var(--space-4) 0;
}

.predictive-state {
  padding: var(--space-4) 0;
}

.predictive-state h3 {
  margin: 0 0 var(--space-1);
  color: var(--text-primary);
  font-family: var(--font-heading);
  font-size: 13px;
  font-weight: 500;
}

.predictive-state p,
.context-note {
  margin: var(--space-1) 0 0;
}

.predictive-state ul {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-2) var(--space-4);
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
}

.predictive-state li {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: 12px;
}

.predictive-state .positive {
  color: var(--win);
}

.predictive-state .negative {
  color: var(--loss);
}

@media (max-width: 680px) {
  .section-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .timezone {
    max-width: none;
    text-align: left;
  }

  .finding-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>