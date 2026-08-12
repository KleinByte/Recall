<script setup lang="ts">
import { computed } from "vue"
import Panel from "../ui/Panel.vue"
import ChampionLearningCurve from "./ChampionLearningCurve.vue"
import ChampionQuadrantChart from "./ChampionQuadrantChart.vue"
import DeathHeatmap from "./DeathHeatmap.vue"
import MatchSignaturesChart from "./MatchSignaturesChart.vue"
import PerformanceFormChart from "./PerformanceFormChart.vue"
import SessionEnduranceChart from "./SessionEnduranceChart.vue"
import {
  armFormComparisons,
  championAnalysisPoints,
  gradeSessionPositionAnalysis,
} from "../../helpers/analyze-adapters"
import type { Champion } from "../../types/lol"
import type { SkillReport } from "../../types/stats"

const props = defineProps<{ report: SkillReport; champions: Champion[] | null }>()

const armForm = computed(() => armFormComparisons(props.report.visuals.gradeComponents))
const measuredMovement = computed(() => armForm.value.map((dimension) => dimension.delta))
const averageMovement = computed(() => measuredMovement.value.length
  ? measuredMovement.value.reduce((sum, value) => sum + value, 0) / measuredMovement.value.length
  : undefined)
const form = computed(() => {
  const movement = averageMovement.value
  if (movement === undefined) return { label: "Learning", detail: "More measured games are needed", tone: "neutral" }
  const sample = armForm.value[0]
  const window = sample ? `${sample.recentGames} latest vs ${sample.priorGames} prior` : "Separate windows"
  if (movement >= 3) return { label: "Higher", detail: `+${movement.toFixed(1)} arm points · ${window}`, tone: "positive" }
  if (movement <= -3) return { label: "Lower", detail: `${movement.toFixed(1)} arm points · ${window}`, tone: "negative" }
  return { label: "Similar", detail: `${movement > 0 ? "+" : ""}${movement.toFixed(1)} arm points · ${window}`, tone: "neutral" }
})
const sessionAnalysis = computed(() => gradeSessionPositionAnalysis(
  props.report.visuals.gradeComponents,
  props.report.visuals.history,
))
const sessionCount = computed(() => sessionAnalysis.value.sessions)
const championPoints = computed(() => championAnalysisPoints(props.report.visuals.champions))
const formMeta = computed(() => armForm.value[0]
  ? `${armForm.value[0].recentGames} latest vs ${armForm.value[0].priorGames} prior measured games`
  : "Two separate measured windows")
const componentWindow = computed(() => props.report.visuals.windows.gradeComponents)
const historyWindow = computed(() => props.report.visuals.windows.history)
</script>

<template>
  <div class="analyze-page">
    <section class="analysis-header card">
      <header>
        <p class="eyebrow">Analysis</p>
        <h2>Explore the games behind your profile</h2>
        <p>Use these charts to compare recent arms, champions, match Grades, and play sessions inside the filters above.</p>
      </header>
      <dl class="analysis-facts">
        <div>
          <dt>Selection</dt>
          <dd>{{ report.visuals.gradeComponents.length }} recent Grades</dd>
          <small>{{ componentWindow.label }} · {{ historyWindow.shownGames }} of {{ historyWindow.totalGames }} selected matches shown</small>
        </div>
        <div>
          <dt>Arm comparison</dt>
          <dd :class="form.tone">{{ form.label }}</dd>
          <small>{{ form.detail }}</small>
        </div>
        <div>
          <dt>Session context</dt>
          <dd>{{ sessionCount }} play sessions</dd>
          <small>{{ sessionAnalysis.usesStableOrdinal ? "Uses each game's original session order" : "Uses order within this selection" }}</small>
        </div>
      </dl>
    </section>

    <DeathHeatmap
      v-if="(report.scope.family === 'sr' || report.scope.family === 'classic') && report.overview.deathMap"
      :map="report.overview.deathMap"
    />

    <section class="analysis-grid">
      <Panel
        v-if="report.visuals.gradeComponents.length"
        title="Grade arm form"
        :meta="`${formMeta} · ${componentWindow.label}`"
        class="analysis-panel"
      >
        <p class="chart-copy">
          Each bar compares an arm in your latest measured games with the group immediately before
          them. Right means the recent score was higher; left means it was lower. Career-only Range is not included.
        </p>
        <PerformanceFormChart :rows="report.visuals.gradeComponents" />
      </Panel>

      <Panel
        v-if="report.visuals.gradeComponents.length"
        title="Score by session position"
        :meta="`${sessionCount} play sessions · ${componentWindow.label}`"
        class="analysis-panel"
      >
        <p class="chart-copy">
          Groups games by whether they were your first, second, or later game in a play session.
          The gold marker is the typical score, the shaded bar is where the middle half landed,
          and the dashed line is the recorded win rate.
        </p>
        <SessionEnduranceChart
          :rows="report.visuals.gradeComponents"
          :history="report.visuals.history"
        />
      </Panel>

      <Panel
        v-if="report.visuals.gradeComponents.length"
        title="Match Grade inspector"
        :meta="`${Math.min(24, report.visuals.gradeComponents.length)} most recent from ${componentWindow.label.toLowerCase()}`"
        class="analysis-panel wide"
      >
        <p class="chart-copy">
          Pick a game to see which arms made up its Grade. A larger share means that arm had more
          influence on the mix Recall later compared with your saved reference.
        </p>
        <MatchSignaturesChart
          :rows="report.visuals.gradeComponents"
          :history="report.visuals.history"
          :catalog="champions"
        />
      </Panel>

      <Panel
        v-if="report.visuals.champions.length"
        title="Champion results"
        :meta="`${championPoints.length} champions with 3+ graded games`"
        class="analysis-panel"
      >
        <p class="chart-copy">
          Move right for more graded games and up for a higher average Recall Score. Each champion
          portrait marks that champion's result; champions with fewer than three graded games stay hidden.
          <template v-if="report.scope.family === 'aram'"> Random-pick modes are descriptive, not recommendations.</template>
        </p>
        <ChampionQuadrantChart
          :champions="report.visuals.champions"
          :catalog="champions"
          :baseline="report.overview.summary.averageRecallScore"
          :randomized="report.scope.family === 'aram'"
        />
      </Panel>

      <Panel
        v-if="report.visuals.history.length"
        title="Champion score history"
        :meta="`${historyWindow.label} · recent average starts after 5 games`"
        class="analysis-panel"
      >
        <p class="chart-copy">
          Each dot is one recorded game on a champion. After five games, the line shows that
          champion's recent five-game average. It describes the selected history; it does not prove improvement.
        </p>
        <ChampionLearningCurve :history="report.visuals.history" :catalog="champions" />
      </Panel>
    </section>
  </div>
</template>

<style scoped>
.analyze-page { container: analyze-page / inline-size; display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
.analysis-header { display: grid; grid-template-columns: minmax(220px, .72fr) minmax(440px, 1.28fr); align-items: center; gap: var(--space-4); padding: var(--space-4); overflow: hidden; background: linear-gradient(120deg, rgba(15, 28, 51, .98), rgba(8, 18, 34, .98)); }
.eyebrow { margin: 0 0 var(--space-2); color: var(--cyan); font-size: 11px; font-weight: 700; letter-spacing: .15em; text-transform: uppercase; }
.analysis-header h2 { margin: 0; color: var(--gold-bright); font-family: var(--font-heading); font-size: 20px; font-weight: 600; }
.analysis-header header > p:last-child { max-width: 540px; margin: 5px 0 0; color: var(--text-secondary); font-size: var(--ui-text-support); line-height: 1.5; }
.analysis-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; margin: 0; }
.analysis-facts div { min-width: 0; padding: 2px var(--space-3); border-left: 1px solid rgba(200, 170, 109, .2); }
.analysis-facts dt { color: var(--text-muted); font-size: var(--ui-text-micro); letter-spacing: .08em; text-transform: uppercase; }
.analysis-facts dd { overflow: hidden; margin: 4px 0 2px; color: var(--text-primary); font-family: var(--font-heading); font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.analysis-facts small { display: block; color: var(--text-muted); font-size: var(--ui-text-micro); line-height: 1.4; }
.positive { color: var(--win) !important; }
.negative { color: var(--loss) !important; }
.analysis-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); align-items: stretch; }
.analysis-panel { display: flex; flex-direction: column; min-width: 0; height: 100%; }
.wide { grid-column: 1 / -1; }
.chart-copy { max-width: 720px; margin: -4px 0 var(--space-2); color: var(--text-muted); font-size: 12px; line-height: 1.5; }
@container analyze-page (max-width: 900px) { .analysis-header { grid-template-columns: minmax(0, 1fr); } .analysis-grid { grid-template-columns: minmax(0, 1fr); } .wide { grid-column: auto; } }
@container analyze-page (max-width: 560px) { .analysis-header { gap: var(--space-3); padding: var(--space-3); } .analysis-facts { grid-template-columns: minmax(0, 1fr); gap: 0; } .analysis-facts div { display: grid; grid-template-columns: minmax(100px, .7fr) minmax(0, 1fr); gap: 3px var(--space-2); padding: 7px 0; border-top: 1px solid rgba(200, 170, 109, .18); border-left: 0; } .analysis-facts dt { grid-row: 1 / span 2; align-self: center; } .analysis-facts dd { margin: 0; } }
</style>
