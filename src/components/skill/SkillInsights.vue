<script setup lang="ts">
import { computed } from "vue"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import { faArrowDown, faArrowUp, faWandMagicSparkles } from "@fortawesome/free-solid-svg-icons"
import EffectChart from "./EffectChart.vue"
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

const sectionIntro = (section: InsightSection) => ({
  bestGamePattern: "What tends to look different in your strongest games.",
  conditions: "When and how you play can be associated with different results.",
  duration: "How different game lengths line up with your recorded results.",
  trends: "How your latest games compare with earlier games in this scope.",
  champions: "How champion picks line up with your usual Recall grade.",
  items: "How completed items line up with your recorded games.",
})[section.key] ?? section.method

function selectTakeaways(insights: SkillReportV2["insights"]) {
  const findings = [
    insights.bestGamePattern,
    insights.conditions,
    insights.duration,
    insights.trends,
    insights.champions,
    insights.items,
  ].flatMap((section) => section.findings)
    .filter((finding) =>
      finding.evidenceLevel === "comparative" &&
      (finding.confidence === "medium" || finding.confidence === "high") &&
      finding.interval && (finding.interval.low > 0 || finding.interval.high < 0),
    )

  return {
    strength: findings.filter((finding) => finding.effect > 0)
      .sort((left, right) => Math.abs(right.effect) - Math.abs(left.effect))[0],
    caution: findings.filter((finding) => finding.effect < 0)
      .sort((left, right) => Math.abs(right.effect) - Math.abs(left.effect))[0],
  }
}

const takeaways = computed(() => selectTakeaways(props.insights))

const takeawayEntries = computed(() => [takeaways.value.strength, takeaways.value.caution]
  .filter((finding): finding is NonNullable<typeof finding> => Boolean(finding))
  .map((finding) => ({ label: finding.title, value: finding.effect })))

const predictiveEntries = computed(() => props.insights.predictive.signals?.map((signal) => ({
  label: signal.feature,
  value: signal.marginalEffect * 100,
})) ?? [])

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
    <section
      v-if="takeawayEntries.length || predictiveEntries.length"
      class="takeaway-band"
    >
      <header class="section-head">
        <div>
          <h2>Top takeaways</h2>
          <p class="method">The clearest associations in this scope. They describe your recorded games, not causes.</p>
        </div>
      </header>
      <div class="takeaway-grid">
        <div v-if="takeaways.strength" class="takeaway positive">
          <FontAwesomeIcon :icon="faArrowUp" fixed-width />
          <div>
            <span>Stronger games</span>
            <strong>{{ takeaways.strength.title }}</strong>
            <p>{{ takeaways.strength.summary }}</p>
          </div>
        </div>
        <div v-if="takeaways.caution" class="takeaway negative">
          <FontAwesomeIcon :icon="faArrowDown" fixed-width />
          <div>
            <span>Weaker games</span>
            <strong>{{ takeaways.caution.title }}</strong>
            <p>{{ takeaways.caution.summary }}</p>
          </div>
        </div>
        <div v-if="predictiveEntries.length" class="takeaway predictive">
          <FontAwesomeIcon :icon="faWandMagicSparkles" fixed-width />
          <div>
            <span>Pregame signal</span>
            <strong>{{ predictiveEntries[0].label }}</strong>
            <p>Associated with an estimated {{ signalEffect(predictiveEntries[0].value / 100) }} win-chance movement.</p>
          </div>
        </div>
      </div>
      <EffectChart
        v-if="takeawayEntries.length"
        :entries="takeawayEntries"
        unit="grade"
      />
      <EffectChart
        v-if="predictiveEntries.length"
        :entries="predictiveEntries"
        unit="percentage-points"
      />
    </section>

    <section v-for="entry in sections" :key="entry.title" class="insight-band">
      <header class="section-head">
        <div>
          <h2>{{ entry.title }}</h2>
          <p v-if="entry.kind === 'predictive'" class="method">
            Signals available before a game starts, tested against later games.
          </p>
          <p v-else-if="entry.section" class="method">{{ sectionIntro(entry.section) }}</p>
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

.takeaway-band {
  padding: var(--space-4);
  border: 1px solid rgba(200, 170, 109, 0.45);
  background: var(--surface-1);
}

.takeaway-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.takeaway {
  display: flex;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-3);
  border-left: 3px solid var(--gold);
  background: var(--surface-2);
  font-size: 12px;
}

.takeaway.positive {
  border-color: var(--win);
}

.takeaway.negative {
  border-color: var(--loss);
}

.takeaway.predictive {
  border-color: var(--cyan);
}

.takeaway strong,
.takeaway span,
.takeaway p {
  display: block;
}

.takeaway strong {
  margin-top: 2px;
  color: var(--text-primary);
  font-family: var(--font-heading);
  font-size: 13px;
  font-weight: 500;
}

.takeaway span,
.takeaway p {
  color: var(--text-secondary);
}

.takeaway p {
  margin: var(--space-1) 0 0;
  line-height: 1.45;
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