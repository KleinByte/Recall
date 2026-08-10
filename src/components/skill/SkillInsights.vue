<script setup lang="ts">
import { computed } from "vue"
import GradeBadge from "../GradeBadge.vue"
import ChampionPoolTreemap from "./ChampionPoolTreemap.vue"
import DurationGradeScatter from "./DurationGradeScatter.vue"
import EffectChart from "./EffectChart.vue"
import GradeDnaHeatmap from "./GradeDnaHeatmap.vue"
import GradeJourneyChart from "./GradeJourneyChart.vue"
import InsightFinding from "./InsightFinding.vue"
import OutcomeTrendChart from "./OutcomeTrendChart.vue"
import PlayCalendarChart from "./PlayCalendarChart.vue"
import WeekdayGradeBoxplot from "./WeekdayGradeBoxplot.vue"
import { findingLabel } from "../../helpers/insight-findings"
import { formatPercent } from "../../helpers/format"
import { recallGradeFromRoleFitScore } from "../../shared/recall-grade"
import type { InsightFinding as InsightFindingType, InsightSection, SkillReportV3 } from "../../types/stats"
import type { Champion } from "../../types/lol"

const props = defineProps<{
  report: SkillReportV3
  timezoneLabel: string
  champions: Champion[] | null
}>()

const summary = computed(() => props.report.overview.summary)
const history = computed(() => [...props.report.visuals.history]
  .sort((left, right) => left.playedAt - right.playedAt))
const gradedHistory = computed(() => history.value.filter((game) => Number.isFinite(game.roleFitScore)))
const averageGrade = computed(() => recallGradeFromRoleFitScore(summary.value.avgRoleFitScore))
const gradedCoverage = computed(() => summary.value.games ? summary.value.gradedGames / summary.value.games : 0)

const recentShift = computed(() => {
  const values = gradedHistory.value.map((game) => game.roleFitScore!).slice(-20)
  if (values.length < 10) return undefined
  const split = Math.floor(values.length / 2)
  const earlier = values.slice(0, split)
  const recent = values.slice(split)
  const mean = (rows: number[]) => rows.reduce((sum, value) => sum + value, 0) / rows.length
  return mean(recent) - mean(earlier)
})

const consistency = computed(() => {
  const values = gradedHistory.value.map((game) => game.roleFitScore!).slice(-30)
  if (values.length < 5) return undefined
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
  if (deviation < 10) return "Steady"
  if (deviation < 18) return "Variable"
  return "Volatile"
})

const componentAverages = computed(() => {
  const totals = new Map<string, { label: string; total: number; games: number; scope: string }>()
  for (const game of props.report.visuals.gradeComponents) {
    for (const component of game.components) {
      const row = totals.get(component.key) ?? { label: component.label, total: 0, games: 0, scope: component.scope }
      row.total += component.percentile
      row.games += 1
      totals.set(component.key, row)
    }
  }
  return [...totals].map(([key, row]) => ({ key, ...row, value: row.total / row.games }))
    .sort((left, right) => right.value - left.value)
})

const strongestComponent = computed(() => componentAverages.value[0])
const growthComponent = computed(() => componentAverages.value.at(-1))

const sections = computed(() => [
  props.report.insights.bestGamePattern,
  props.report.insights.conditions,
  props.report.insights.duration,
  props.report.insights.trends,
  props.report.insights.champions,
  props.report.insights.items,
])

const confidentFindings = computed(() => sections.value.flatMap((section) => section.findings)
  .filter((finding) => finding.unit === "grade" && finding.interval &&
    (finding.confidence === "medium" || finding.confidence === "high") &&
    (finding.interval.low > 0 || finding.interval.high < 0))
  .sort((left, right) => Math.abs(right.effect) - Math.abs(left.effect)))

const evidenceEntries = computed(() => confidentFindings.value.slice(0, 8).map((finding) => ({
  label: findingLabel(finding, props.champions),
  value: finding.effect,
})))

const predictiveEntries = computed(() => props.report.insights.predictive.signals?.map((signal) => ({
  label: signal.feature,
  value: signal.marginalEffect * 100,
})) ?? [])

const allFindings = (section: InsightSection): InsightFindingType[] => section.findings
const currentGames = (section: InsightSection) => Math.max(0, ...section.findings.map((finding) => finding.eligibleGames))
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)} pts`
const shortDate = (timestamp: number) => new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })
</script>

<template>
  <div class="insights-v3">
    <section class="grade-identity" aria-labelledby="recall-grade-title">
      <div class="grade-mark">
        <span class="grade-kicker">Recall</span>
        <GradeBadge v-if="averageGrade" :grade="averageGrade" size="lg" />
        <span v-else class="ungraded">–</span>
        <span class="grade-wordmark">Grade</span>
      </div>
      <div class="identity-copy">
        <p class="eyebrow">Your performance fingerprint</p>
        <h2 id="recall-grade-title">One grade. Six responsibilities. Every match in context.</h2>
        <p>
          Recall Grade measures fighting, availability, resources, objectives, vision, and control
          against the frozen local reference for that position and champion archetype. Movement
          across matches matters more than any single result.
        </p>
      </div>
      <dl class="identity-stats">
        <div><dt>Graded</dt><dd>{{ summary.gradedGames }} / {{ summary.games }}</dd></div>
        <div><dt>Coverage</dt><dd>{{ formatPercent(gradedCoverage) }}</dd></div>
        <div><dt>Average RoleFit</dt><dd>{{ summary.avgRoleFitScore === undefined ? "–" : `${summary.avgRoleFitScore.toFixed(1)} / 100` }}</dd></div>
        <div><dt>Recent form</dt><dd :class="recentShift && recentShift > 0 ? 'positive' : recentShift && recentShift < 0 ? 'negative' : ''">{{ recentShift === undefined ? "Learning" : signed(recentShift) }}</dd></div>
        <div><dt>Consistency</dt><dd>{{ consistency ?? "Learning" }}</dd></div>
      </dl>
    </section>

    <section class="story-section hero-chart">
      <header class="story-head">
        <div>
          <p class="chapter">01 · Form</p>
          <h2>Your Grade Journey</h2>
          <p>Follow the shape of your performance, not just the latest result. Wins and losses color each match; RoleFit controls the grade.</p>
        </div>
        <span class="sample">{{ gradedHistory.length }} graded games</span>
      </header>
      <GradeJourneyChart :history="history" />
      <details class="detail-pane">
        <summary>Show match-by-match data</summary>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Grade</th><th>RoleFit</th><th>Result</th><th>Duration</th></tr></thead>
            <tbody>
              <tr v-for="game in [...gradedHistory].reverse()" :key="game.gameId">
                <td>{{ shortDate(game.playedAt) }}</td>
                <td>{{ game.grade ?? "–" }}</td>
                <td class="numeric">{{ game.roleFitScore?.toFixed(1) }}</td>
                <td :class="game.win ? 'positive' : 'negative'">{{ game.win ? "Win" : "Loss" }}</td>
                <td class="numeric">{{ Math.round(game.durationSecs / 60) }}m</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </section>

    <section v-if="report.visuals.gradeComponents.length" class="story-section">
      <header class="story-head">
        <div>
          <p class="chapter">02 · Grade DNA</p>
          <h2>What your grades are made of</h2>
          <p>
            Each cell is a stored Grade family percentile from the frozen reference used for that
            match. Missing families remain blank; these cells explain the grade and do not rebuild
            the RVI headline.
          </p>
        </div>
        <div v-if="strongestComponent" class="callout">
          <span>Highest average component</span>
          <strong>{{ strongestComponent.label }} · {{ Math.round(strongestComponent.value * 100) }}</strong>
        </div>
      </header>
      <GradeDnaHeatmap :rows="report.visuals.gradeComponents" />
      <details class="detail-pane">
        <summary>Show component definitions and averages</summary>
        <div class="component-grid">
          <div v-for="component in componentAverages" :key="component.key">
            <span>{{ component.label }}</span>
            <strong>{{ Math.round(component.value * 100) }} PP</strong>
            <small>{{ component.games }} games · {{ component.scope }} comparison scope</small>
          </div>
        </div>
        <p v-if="growthComponent" class="detail-note">
          {{ growthComponent.label }} is currently your lowest average signal. Treat it as a review prompt, not a verdict: role and match state affect what good play looks like.
        </p>
      </details>
    </section>

    <section class="story-section">
      <header class="story-head">
        <div>
          <p class="chapter">03 · Rhythm</p>
          <h2>When you play, and how stable it feels</h2>
          <p>The calendar shows form over real time. The box plot separates the middle half of your results from unusually strong or weak games.</p>
        </div>
        <span class="sample">{{ timezoneLabel }}</span>
      </header>
      <PlayCalendarChart :history="history" />
      <div class="split-chart">
        <div>
          <h3>Weekday RoleFit range</h3>
          <p class="chart-note">Wider boxes mean less predictable performance. Hover for the median and sample.</p>
          <WeekdayGradeBoxplot :history="history" />
        </div>
        <div>
          <h3>Recorded schedule outcomes</h3>
          <p class="chart-note">Volume bars keep a high win rate from looking important when it rests on very few games.</p>
          <OutcomeTrendChart :rows="report.overview.outcomes.weekdays" />
        </div>
      </div>
      <details class="detail-pane">
        <summary>Show time-of-day data</summary>
        <OutcomeTrendChart :rows="report.overview.outcomes.hours" />
      </details>
    </section>

    <section class="story-section">
      <header class="story-head">
        <div>
          <p class="chapter">04 · Match shape</p>
          <h2>Does game length change your performance?</h2>
          <p>Every dot is a match. The pale line summarizes five-minute bands so the overall shape remains readable.</p>
        </div>
      </header>
      <DurationGradeScatter :history="history" />
      <details class="detail-pane">
        <summary>Show duration-band totals</summary>
        <OutcomeTrendChart :rows="report.overview.outcomes.duration" />
      </details>
    </section>

    <section v-if="report.visuals.champions.length" class="story-section">
      <header class="story-head">
        <div>
          <p class="chapter">05 · Champion pool</p>
          <h2>Where your games—and grades—live</h2>
          <p>Tile size is games played. Color tracks average RoleFit, exposing both dependable comfort picks and thin-sample surprises.</p>
        </div>
        <span class="sample">{{ report.visuals.champions.length }} champions</span>
      </header>
      <ChampionPoolTreemap :champions="report.visuals.champions" :catalog="champions" />
      <details class="detail-pane">
        <summary>Show champion findings and caveats</summary>
        <div class="finding-list">
          <InsightFinding v-for="finding in report.insights.champions.findings" :key="finding.key" :finding="finding" :champions="champions" />
        </div>
        <p v-if="report.scope.family === 'aram'" class="detail-note">Random assignment limits control over champion pool breadth in ARAM and Mayhem.</p>
      </details>
    </section>

    <section class="story-section evidence-section">
      <header class="story-head evidence-head">
        <div>
          <p class="chapter">06 · Evidence</p>
          <h2>What repeats in your strongest games</h2>
          <p>Only clearer, medium-or-high-confidence compatibility-score associations lead this section. This normal score is retained for statistical comparisons; it is not RoleFit points, and the associations do not prove cause.</p>
        </div>
      </header>
      <EffectChart v-if="evidenceEntries.length" :entries="evidenceEntries" unit="grade" />
      <p v-else class="learning-state">Recall is still learning this scope. More varied graded matches will make repeatable patterns easier to separate from noise.</p>

      <div v-if="predictiveEntries.length" class="predictive-chart">
        <h3>Pregame signals that held up on later games</h3>
        <p class="chart-note">Estimated movement in win probability, shown in percentage points.</p>
        <EffectChart :entries="predictiveEntries" unit="percentage-points" />
      </div>

      <details v-for="section in sections" :key="section.key" class="detail-pane evidence-detail">
        <summary>
          <span>{{ section.title }}</span>
          <span>{{ section.findings.length ? `${section.findings.length} findings` : `${currentGames(section)} / ${section.neededGames} games` }}</span>
        </summary>
        <p class="detail-note">{{ section.method }}</p>
        <div v-if="allFindings(section).length" class="finding-list">
          <InsightFinding v-for="finding in allFindings(section)" :key="finding.key" :finding="finding" :champions="champions" />
        </div>
        <p v-else class="learning-state">Not enough eligible history in this scope yet.</p>
      </details>
      <details class="detail-pane evidence-detail">
        <summary><span>Predictive model</span><span>{{ report.insights.predictive.state }}</span></summary>
        <p class="detail-note">{{ report.insights.predictive.message ?? "Signals known before a match are tested against later, untouched games." }}</p>
      </details>
    </section>
  </div>
</template>

<style scoped>
.insights-v3 {
  display: flex;
  flex-direction: column;
  gap: clamp(34px, 5vw, 68px);
  min-width: 0;
}

.grade-identity {
  position: relative;
  display: grid;
  grid-template-columns: 180px minmax(280px, 1fr) minmax(230px, 0.55fr);
  align-items: center;
  gap: var(--space-5);
  overflow: hidden;
  padding: clamp(24px, 4vw, 46px);
  border: 1px solid rgba(200, 170, 109, 0.5);
  background:
    radial-gradient(circle at 12% 50%, rgba(10, 203, 230, 0.12), transparent 30%),
    linear-gradient(120deg, #0c192d, #111e34 60%, #0b1628);
}

.grade-identity::after {
  position: absolute;
  right: -90px;
  width: 260px;
  height: 260px;
  border: 1px solid rgba(200, 170, 109, 0.12);
  transform: rotate(45deg);
  content: "";
}

.grade-mark {
  position: relative;
  z-index: 1;
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 22px 14px;
  border: 1px solid rgba(200, 170, 109, 0.38);
  background: rgba(4, 12, 24, 0.48);
  clip-path: polygon(14% 0, 86% 0, 100% 14%, 100% 78%, 50% 100%, 0 78%, 0 14%);
}

.grade-mark :deep(.grade) { margin: 10px 0; }
.grade-kicker, .grade-wordmark, .eyebrow, .chapter { text-transform: uppercase; letter-spacing: 0.16em; }
.grade-kicker { color: var(--cyan); font-size: 12px; }
.grade-wordmark { color: var(--gold); font-family: var(--font-display); font-size: 12px; }
.ungraded { color: var(--text-muted); font-family: var(--font-display); font-size: 34px; }

.identity-copy { position: relative; z-index: 1; }
.eyebrow, .chapter { margin: 0 0 var(--space-2); color: var(--cyan); font-size: 12px; }
.identity-copy h2, .story-head h2 { margin: 0; color: var(--gold-bright); font-family: var(--font-display); font-weight: 500; }
.identity-copy h2 { max-width: 700px; font-size: clamp(21px, 2.6vw, 34px); line-height: 1.08; }
.identity-copy > p:last-child { max-width: 720px; margin: var(--space-3) 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.65; }

.identity-stats { position: relative; z-index: 1; display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); margin: 0; }
.identity-stats div { padding: 0 0 var(--space-2); border-bottom: 1px solid var(--border-subtle); }
.identity-stats dt { color: var(--text-muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
.identity-stats dd { margin: 4px 0 0; color: var(--text-primary); font-family: var(--font-numeric); font-size: 14px; }

.story-section { min-width: 0; padding-top: var(--space-4); border-top: 1px solid var(--border-subtle); }
.hero-chart { padding-top: 0; border-top: 0; }
.story-head { display: flex; justify-content: space-between; align-items: flex-end; gap: var(--space-5); margin-bottom: var(--space-4); }
.story-head h2 { font-size: clamp(19px, 2vw, 26px); }
.story-head > div > p:last-child { max-width: 760px; margin: var(--space-2) 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.55; }
.sample { flex: 0 0 auto; color: var(--text-muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
.callout { flex: 0 0 auto; padding-left: var(--space-3); border-left: 2px solid var(--cyan); }
.callout span, .callout strong { display: block; }
.callout span { color: var(--text-muted); font-size: 12px; text-transform: uppercase; }
.callout strong { margin-top: 3px; color: var(--text-primary); font-size: 12px; }

.split-chart { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-5); margin-top: var(--space-5); }
.split-chart > div { min-width: 0; }
h3 { margin: 0; color: var(--text-primary); font-family: var(--font-heading); font-size: 14px; font-weight: 500; }
.chart-note, .detail-note { margin: var(--space-1) 0 var(--space-2); color: var(--text-muted); font-size: 11px; line-height: 1.5; }

.detail-pane { margin-top: var(--space-3); border: 1px solid var(--border-subtle); background: rgba(15, 28, 51, 0.4); }
.detail-pane > summary { display: flex; justify-content: space-between; gap: var(--space-3); padding: var(--space-3) var(--space-4); color: var(--text-secondary); font-size: 11px; cursor: pointer; user-select: none; }
.detail-pane[open] > summary { border-bottom: 1px solid var(--border-subtle); color: var(--gold); }
.detail-pane > :not(summary) { margin-left: var(--space-4); margin-right: var(--space-4); }
.table-wrap { max-height: 340px; margin-top: var(--space-3); margin-bottom: var(--space-4); overflow: auto; }
table { width: 100%; border-collapse: collapse; font-size: 11px; }
th, td { padding: 8px 10px; border-bottom: 1px solid var(--border-subtle); text-align: left; }
th { position: sticky; top: 0; background: var(--surface-1); color: var(--text-muted); font-weight: 500; }

.component-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--space-3); padding: var(--space-4) 0; }
.component-grid div { display: grid; gap: 3px; }
.component-grid span { color: var(--text-primary); font-size: 12px; }
.component-grid strong { color: var(--cyan); font-family: var(--font-numeric); font-size: 16px; }
.component-grid small { color: var(--text-muted); font-size: 12px; }

.evidence-section { padding-bottom: var(--space-5); }
.evidence-head {
  padding: var(--space-4);
  border-left: 2px solid var(--cyan);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--cyan) 8%, var(--surface-1)),
    color-mix(in srgb, var(--surface-1) 45%, transparent)
  );
}
.predictive-chart { margin-top: var(--space-5); padding-top: var(--space-4); border-top: 1px solid var(--border-subtle); }
.evidence-detail { margin-top: var(--space-2); }
.finding-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--space-3); padding: var(--space-4) 0; }
.learning-state { margin: var(--space-4) 0; padding: var(--space-4); border-left: 2px solid var(--gold); background: var(--surface-1); color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
.positive { color: var(--win) !important; }
.negative { color: var(--loss) !important; }
.numeric { font-family: var(--font-numeric); }

@media (max-width: 900px) {
  .grade-identity { grid-template-columns: 130px 1fr; }
  .identity-stats { grid-column: 1 / -1; }
  .split-chart { grid-template-columns: minmax(0, 1fr); }
}

@media (max-width: 620px) {
  .grade-identity { grid-template-columns: 1fr; }
  .grade-mark { width: 130px; }
  .story-head { align-items: flex-start; flex-direction: column; }
  .callout { align-self: stretch; }
}
</style>
