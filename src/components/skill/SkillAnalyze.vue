<script setup lang="ts">
import { computed } from "vue"
import Panel from "../ui/Panel.vue"
import ChampionLearningCurve from "./ChampionLearningCurve.vue"
import ChampionQuadrantChart from "./ChampionQuadrantChart.vue"
import DeathHeatmap from "./DeathHeatmap.vue"
import MatchSignaturesChart from "./MatchSignaturesChart.vue"
import PerformanceFormChart from "./PerformanceFormChart.vue"
import SessionEnduranceChart from "./SessionEnduranceChart.vue"
import { classifyRviIdentity } from "../../helpers/rvi-identity"
import type { Champion } from "../../types/lol"
import type { SkillReportV2 } from "../../types/stats"

const props = defineProps<{ report: SkillReportV2; champions: Champion[] | null }>()

const profile = computed(() => props.report.overview.performance)
const identity = computed(() => profile.value ? classifyRviIdentity(profile.value) : undefined)
const measuredMovement = computed(() => profile.value?.dimensions
  .flatMap((dimension) => dimension.delta === undefined ? [] : [dimension.delta]) ?? [])
const averageMovement = computed(() => measuredMovement.value.length
  ? measuredMovement.value.reduce((sum, value) => sum + value, 0) / measuredMovement.value.length
  : undefined)
const form = computed(() => {
  const movement = averageMovement.value
  if (movement === undefined) return { label: "Learning", detail: "More measured games are needed", tone: "neutral" }
  if (movement >= 3) return { label: "Rising", detail: `+${movement.toFixed(1)} average vector movement`, tone: "positive" }
  if (movement <= -3) return { label: "Cooling", detail: `${movement.toFixed(1)} average vector movement`, tone: "negative" }
  return { label: "Holding", detail: `${movement > 0 ? "+" : ""}${movement.toFixed(1)} average vector movement`, tone: "neutral" }
})
const sessionCount = computed(() => {
  const ordered = [...props.report.visuals.history].sort((left, right) => left.playedAt - right.playedAt)
  let sessions = 0
  let previousEnd = -Infinity
  for (const game of ordered) {
    if (game.playedAt - previousEnd > 90 * 60_000) sessions += 1
    previousEnd = game.playedAt + game.durationSecs * 1_000
  }
  return sessions
})
</script>

<template>
  <div class="analyze-page">
    <section class="analysis-hero card">
      <div>
        <p class="eyebrow">Recall analysis lab</p>
        <h2>Patterns you can act on.</h2>
        <p>
          These views use only games inside the filters above. RVI form comes from the measured
          vector model; match signatures and champion charts use Recall Grade evidence.
        </p>
      </div>
      <dl class="hero-stats">
        <div>
          <dt>RVI playstyle</dt>
          <dd>{{ identity?.label ?? "Learning" }}</dd>
          <small>{{ profile?.measuredGames ?? 0 }} measured games</small>
        </div>
        <div>
          <dt>Current form</dt>
          <dd :class="form.tone">{{ form.label }}</dd>
          <small>{{ form.detail }}</small>
        </div>
        <div>
          <dt>Recorded rhythm</dt>
          <dd>{{ sessionCount }} sessions</dd>
          <small>{{ report.visuals.history.length }} recent games analyzed</small>
        </div>
      </dl>
    </section>

    <DeathHeatmap
      v-if="report.scope.family === 'sr' && report.overview.deathMap"
      :map="report.overview.deathMap"
    />

    <section class="analysis-grid">
      <Panel
        v-if="profile"
        title="Performance form"
        :meta="`Recent ${profile.recentGames} vs recorded profile`"
        class="analysis-panel"
      >
        <p class="chart-copy">Which RVI vectors are moving, with sample stabilization already applied.</p>
        <PerformanceFormChart :profile="profile" />
      </Panel>

      <Panel
        v-if="report.visuals.history.length"
        title="Session endurance"
        :meta="`${sessionCount} recorded sessions`"
        class="analysis-panel"
      >
        <p class="chart-copy">See whether results or Recall form change as a session gets longer.</p>
        <SessionEnduranceChart :history="report.visuals.history" />
      </Panel>

      <Panel
        v-if="report.visuals.gradeComponents.length"
        title="Match signatures"
        meta="Last 24 measured games"
        class="analysis-panel wide"
      >
        <p class="chart-copy">
          Every line is one game's eight Recall Grade signals. Green is a win, red is a loss;
          hover a line to isolate its shape. These are per-match comparison percentiles, not RVI vector scores.
        </p>
        <MatchSignaturesChart
          :rows="report.visuals.gradeComponents"
          :history="report.visuals.history"
        />
      </Panel>

      <Panel
        v-if="report.visuals.champions.length"
        title="Champion efficiency"
        meta="Experience × Recall performance"
        class="analysis-panel"
      >
        <p class="chart-copy">Find established mains, promising hidden gems, and comfort picks that may not be paying off.</p>
        <ChampionQuadrantChart
          :champions="report.visuals.champions"
          :catalog="champions"
          :baseline="report.overview.summary.avgGradeScore"
        />
      </Panel>

      <Panel
        v-if="report.visuals.history.length"
        title="Champion learning curve"
        meta="Five-game moving form"
        class="analysis-panel"
      >
        <p class="chart-copy">Separate early volatility from the point where your performance begins to settle.</p>
        <ChampionLearningCurve :history="report.visuals.history" :catalog="champions" />
      </Panel>
    </section>
  </div>
</template>

<style scoped>
.analyze-page { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
.analysis-hero { display: grid; grid-template-columns: minmax(280px, 1.2fr) minmax(380px, 1fr); align-items: center; gap: clamp(24px, 4vw, 52px); padding: clamp(22px, 3.5vw, 38px); overflow: hidden; background: radial-gradient(circle at 0 50%, rgba(10, 203, 230, .1), transparent 38%), linear-gradient(120deg, rgba(15, 28, 51, .98), rgba(8, 18, 34, .98)); }
.eyebrow { margin: 0 0 var(--space-2); color: var(--cyan); font-size: 9px; font-weight: 700; letter-spacing: .15em; text-transform: uppercase; }
.analysis-hero h2 { margin: 0; color: var(--gold-bright); font-family: var(--font-display); font-size: clamp(22px, 3vw, 34px); font-weight: 500; }
.analysis-hero > div > p:last-child { max-width: 680px; margin: var(--space-3) 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.65; }
.hero-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); margin: 0; }
.hero-stats div { min-width: 0; padding-left: var(--space-3); border-left: 1px solid rgba(200, 170, 109, .25); }
.hero-stats dt { color: var(--text-muted); font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }
.hero-stats dd { overflow: hidden; margin: 6px 0 3px; color: var(--text-primary); font-family: var(--font-heading); font-size: 16px; text-overflow: ellipsis; white-space: nowrap; }
.hero-stats small { display: block; color: var(--text-muted); font-size: 9px; line-height: 1.4; }
.positive { color: var(--win) !important; }
.negative { color: var(--loss) !important; }
.analysis-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); align-items: stretch; }
.analysis-panel { display: flex; flex-direction: column; min-width: 0; height: 100%; }
.wide { grid-column: 1 / -1; }
.chart-copy { max-width: 720px; margin: -4px 0 var(--space-2); color: var(--text-muted); font-size: 10px; line-height: 1.5; }
@media (max-width: 900px) { .analysis-hero { grid-template-columns: minmax(0, 1fr); } .analysis-grid { grid-template-columns: minmax(0, 1fr); } .wide { grid-column: auto; } }
@media (max-width: 560px) { .hero-stats { grid-template-columns: minmax(0, 1fr); } .hero-stats div { padding: var(--space-2) 0 0; border-top: 1px solid rgba(200, 170, 109, .18); border-left: 0; } }
</style>
