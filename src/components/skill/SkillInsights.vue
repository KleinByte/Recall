<script setup lang="ts">
import { computed } from "vue"
import EffectChart from "./EffectChart.vue"
import EvidenceForestPlot, { type EvidenceForestGroup } from "./EvidenceForestPlot.vue"
import GradeDnaHeatmap from "./GradeDnaHeatmap.vue"
import GradeJourneyChart from "./GradeJourneyChart.vue"
import RviContextBreakdown from "./RviContextBreakdown.vue"
import SkillContextExplorer from "./SkillContextExplorer.vue"
import { formatPercent } from "../../helpers/format"
import { recallGradeFromRecallScore } from "../../shared/recall-grade"
import type { InsightSection, SkillReport } from "../../types/stats"
import type { Champion } from "../../types/lol"

const props = defineProps<{
  report: SkillReport
  timezoneLabel: string
  champions: Champion[] | null
}>()

const summary = computed(() => props.report.overview.summary)
const performance = computed(() => props.report.overview.performance)
const hasRviContextDetail = computed(() =>
  (performance.value?.scopes.positions.length ?? 0) > 1 ||
  (performance.value?.scopes.primaryArchetypes.length ?? 0) > 1)
const history = computed(() => [...props.report.visuals.history]
  .sort((left, right) => left.playedAt - right.playedAt))
const gradedHistory = computed(() => history.value.filter((game) => Number.isFinite(game.recallScore)))
const averageGrade = computed(() => recallGradeFromRecallScore(summary.value.averageRecallScore))
const gradedCoverage = computed(() => summary.value.games ? summary.value.gradedGames / summary.value.games : 0)
const historyWindow = computed(() => props.report.visuals.windows.history)
const componentWindow = computed(() => props.report.visuals.windows.gradeComponents)
const historySampleLabel = computed(() => historyWindow.value.totalGames > historyWindow.value.shownGames
  ? `${gradedHistory.value.length} graded shown · latest ${historyWindow.value.shownGames} of ${historyWindow.value.totalGames} selected matches`
  : `${gradedHistory.value.length} graded matches shown`)

const recentShift = computed(() => {
  const allValues = gradedHistory.value.map((game) => game.recallScore!)
  if (allValues.length < 20) return undefined
  const values = allValues.slice(-20)
  const earlier = values.slice(0, 10)
  const recent = values.slice(10)
  const mean = (rows: number[]) => rows.reduce((sum, value) => sum + value, 0) / rows.length
  return mean(recent) - mean(earlier)
})

const componentAverages = computed(() => {
  const totals = new Map<string, {
    label: string
    score: number
    share: number
    contribution: number
    games: number
    scope: string
  }>()
  for (const game of props.report.visuals.gradeComponents) {
    for (const component of game.components) {
      const row = totals.get(component.key) ?? {
        label: component.label,
        score: 0,
        share: 0,
        contribution: 0,
        games: 0,
        scope: component.scope,
      }
      row.score += component.percentile * 100
      row.share += component.weight * 100
      row.contribution += component.contribution * 100
      row.games += 1
      totals.set(component.key, row)
    }
  }
  return [...totals].map(([key, row]) => ({
    key,
    label: row.label,
    score: row.score / row.games,
    share: row.share / row.games,
    contribution: row.contribution / row.games,
    games: row.games,
    scope: row.scope,
  })).sort((left, right) => right.contribution - left.contribution)
})

const strongestComponent = computed(() => componentAverages.value[0])
const contributionCeiling = computed(() => Math.max(
  1,
  ...componentAverages.value.map((component) => component.contribution),
))
const contributionWidth = (value: number) => `${Math.max(4, value / contributionCeiling.value * 100)}%`

const evidenceSections = computed(() => [
  props.report.insights.bestGamePattern,
  props.report.insights.conditions,
  props.report.insights.duration,
  props.report.insights.trends,
  props.report.insights.champions,
  props.report.insights.items,
])

const evidenceGroups = computed<EvidenceForestGroup[]>(() => evidenceSections.value.flatMap((section) => {
  const findings = section.findings.filter((finding) => Number.isFinite(finding.effect))
  return findings.length ? [{
    key: section.key,
    title: section.title,
    method: section.method,
    findings,
  }] : []
}))

const QUEUE_LABELS: Record<string, string> = {
  "400": "Normal Draft",
  "420": "Ranked Solo",
  "430": "Normal Blind",
  "440": "Ranked Flex",
  "450": "ARAM",
  "490": "Quickplay",
  "1700": "Arena",
}

function predictiveSignalLabel(feature: string) {
  const normalized = feature.toLowerCase()
  const queue = /^queue_(\d+)$/.exec(normalized)
  if (queue) return `${QUEUE_LABELS[queue[1]] ?? `Queue ${queue[1]}`} selection`

  const role = /^role_(.+)$/.exec(normalized)
  if (role) return `${role[1].replace(/_/g, " ")} role`

  const championExperience = /^(?:champion_)?(?:experience|games)(?:_(.+))?$/.exec(normalized)
  if (championExperience) return championExperience[1]
    ? `${championExperience[1].replace(/_/g, " ")} champion experience`
    : "Champion experience"

  const known: Record<string, string> = {
    hour_sin: "Local play time (daily cycle)",
    hour_cos: "Local play time (daily cycle)",
    weekday_sin: "Day of week (weekly cycle)",
    weekday_cos: "Day of week (weekly cycle)",
    session_position: "Position within the play session",
    session_game: "Position within the play session",
    rest_hours: "Rest since the previous match",
    hours_since_last_game: "Rest since the previous match",
    recent_games: "Recent match volume",
    recent_win_rate: "Recent recorded win rate",
  }
  return known[normalized] ?? normalized
    .split("_")
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ")
}

const predictiveEntries = computed(() => props.report.insights.predictive.state === "ready"
  ? props.report.insights.predictive.signals?.map((signal) => ({
    label: predictiveSignalLabel(signal.feature),
    value: signal.marginalEffect * 100,
  })) ?? []
  : [])

const currentGames = (section: InsightSection) =>
  section.observedGames ?? Math.max(
    0,
    ...section.findings.map((finding) => finding.eligibleGames),
  )
const methodStatus = (section: InsightSection) => {
  if (section.findings.length) return `${section.findings.length} recorded findings`
  const observed = currentGames(section)
  if (section.key === "duration") {
    return `${observed} graded observed · needs two duration bands with 8 each`
  }
  if (section.key === "champions") {
    return `${observed} graded observed · needs 8 on one champion`
  }
  if (section.key === "items") {
    return `${observed} graded observed · needs 10 comparable item appearances`
  }
  return `${observed} of ${section.neededGames} total graded matches needed`
}
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)} pts`
const shortDate = (timestamp: number) => new Date(timestamp).toLocaleDateString(
  undefined,
  { month: "short", day: "numeric", year: "2-digit" },
)
</script>

<template>
  <div class="insights-page">
    <header class="insights-header" aria-labelledby="insights-title">
      <div class="header-copy">
        <p class="eyebrow">Insights</p>
        <h2 id="insights-title">What is shaping your performance?</h2>
        <p>
          See how your scores are changing, which RVI arms shaped your Grades, and what has shown
          up more than once. Every pattern includes its game count so you know how much evidence it has.
        </p>
      </div>
      <div class="grade-summary" aria-label="Selected match summary">
        <div class="average-grade">
          <span>Average Grade</span>
          <strong>{{ averageGrade ?? "–" }}</strong>
        </div>
        <dl>
          <div>
            <dt>Recall Score</dt>
            <dd>{{ summary.averageRecallScore === undefined ? "–" : summary.averageRecallScore.toFixed(1) }}</dd>
          </div>
          <div>
            <dt>Graded</dt>
            <dd>{{ summary.gradedGames }} / {{ summary.games }}</dd>
            <small>{{ formatPercent(gradedCoverage) }} coverage</small>
          </div>
          <div>
            <dt>Recent shift</dt>
            <dd :class="recentShift && recentShift > 0 ? 'positive' : recentShift && recentShift < 0 ? 'negative' : ''">
              {{ recentShift === undefined ? "Learning" : signed(recentShift) }}
            </dd>
            <small>latest 10 vs previous 10</small>
          </div>
        </dl>
      </div>
    </header>

    <RviContextBreakdown
      v-if="hasRviContextDetail && performance"
      :profile="performance"
    />

    <section class="story-section" aria-labelledby="performance-trend-title">
      <header class="story-head">
        <div>
          <p class="section-label">Performance over time</p>
          <h2 id="performance-trend-title">Your match scores and recent direction</h2>
          <p>
            Each dot is one graded game. The line follows your recent average, making it easier
            to see whether your scores are generally rising, falling, or holding steady.
          </p>
        </div>
        <span class="sample">{{ historySampleLabel }}</span>
      </header>
      <GradeJourneyChart
        v-if="gradedHistory.length"
        :history="history"
        :champions="champions"
      />
      <p v-else class="learning-state">
        No graded matches are available in this selection yet.
      </p>
      <details v-if="gradedHistory.length" class="detail-pane">
        <summary>Match-by-match scores</summary>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Grade</th><th>Recall Score</th><th>Result</th><th>Duration</th></tr></thead>
            <tbody>
              <tr v-for="game in [...gradedHistory].reverse()" :key="game.gameId">
                <td>{{ shortDate(game.playedAt) }}</td>
                <td>{{ game.grade ?? "–" }}</td>
                <td class="numeric">{{ game.recallScore?.toFixed(1) }}</td>
                <td :class="game.win ? 'positive' : 'negative'">{{ game.win ? "Win" : "Loss" }}</td>
                <td class="numeric">{{ Math.round(game.durationSecs / 60) }}m</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </section>

    <section
      v-if="report.visuals.gradeComponents.length"
      class="story-section"
      aria-labelledby="grade-drivers-title"
    >
      <header class="story-head">
        <div>
          <p class="section-label">Grade drivers</p>
          <h2 id="grade-drivers-title">Which arms shaped your Grades</h2>
          <p>
            Each column is one match. Brighter squares show which parts of your play counted most
            toward that match's Grade. Recall combines those results into the final 0–100 score.
          </p>
        </div>
        <div v-if="strongestComponent" class="callout">
          <span>Largest influence on these Grades</span>
          <strong>{{ strongestComponent.label }} · {{ strongestComponent.contribution.toFixed(1) }} points in the mix</strong>
        </div>
      </header>

      <GradeDnaHeatmap
        :rows="report.visuals.gradeComponents"
        :history="history"
        :champions="champions"
      />

      <div class="driver-summary" aria-label="Average Grade influence by arm">
        <article v-for="component in componentAverages" :key="component.key">
          <div class="driver-head">
            <strong>{{ component.label }}</strong>
            <span class="numeric">{{ component.contribution.toFixed(1) }} points in the mix</span>
          </div>
          <div class="driver-meter" aria-hidden="true">
            <span :style="{ width: contributionWidth(component.contribution) }" />
          </div>
          <p>
            {{ component.score.toFixed(0) }} arm score · {{ component.share.toFixed(0) }}% of the Grade mix ·
            {{ component.games }} matches
          </p>
        </article>
      </div>
      <p class="chart-note">
        These numbers explain how the Grade was put together; they are not bonus Recall Score
        points. If an optional stat is missing, Recall leaves it out instead of treating it as zero.
      </p>
    </section>

    <SkillContextExplorer
      :history="history"
      :outcomes="report.overview.outcomes"
      :timezone-label="timezoneLabel"
      :champions="champions"
    />

    <section class="story-section evidence-section" aria-labelledby="evidence-title">
      <header class="story-head">
        <div>
          <p class="section-label">Evidence</p>
          <h2 id="evidence-title">What keeps showing up in your games</h2>
          <p>
            Recall compares groups of your recorded games and brings repeated differences to the
            surface. Treat them as clues worth reviewing—not proof that one thing caused another.
          </p>
        </div>
      </header>

      <EvidenceForestPlot
        v-if="evidenceGroups.length"
        :groups="evidenceGroups"
        :champions="champions"
      />
      <p v-else class="learning-state">
        Recall is still learning this selection. More varied graded matches will make repeatable
        patterns easier to separate from noise.
      </p>

      <section v-if="predictiveEntries.length" class="predictive-panel" aria-labelledby="predictive-title">
        <div>
          <p class="section-label">Ready model</p>
          <h3 id="predictive-title">Pregame signals linked with later high-scoring matches</h3>
          <p>
            These signals were checked on later games the model had not already studied. The chart
            shows how much each signal changed the chance of a top-quarter Recall Score—not a win.
          </p>
        </div>
        <EffectChart :entries="predictiveEntries" unit="percentage-points" />
      </section>

      <details class="detail-pane methods-pane">
        <summary>
          <span>Methods and model status</span>
          <span>{{ report.insights.predictive.state }}</span>
        </summary>
        <div class="method-list">
          <article v-for="section in evidenceSections" :key="section.key">
            <div>
              <strong>{{ section.title }}</strong>
              <span>{{ section.method }}</span>
            </div>
            <small>
              {{ methodStatus(section) }}
            </small>
          </article>
          <p>
            {{ report.insights.predictive.message ??
              "Pregame signals are tested against later, untouched matches once enough history exists." }}
          </p>
        </div>
      </details>
    </section>
  </div>
</template>

<style scoped>
.insights-page {
  display: grid;
  gap: clamp(24px, 3.4cqi, 42px);
  min-width: 0;
  container: skill-insights / inline-size;
}

.insights-header {
  display: grid;
  grid-template-columns: minmax(280px, 1.2fr) minmax(390px, 0.8fr);
  align-items: stretch;
  gap: clamp(18px, 2.5cqi, 30px);
  padding: clamp(18px, 2.5cqi, 28px);
  border: 1px solid color-mix(in srgb, var(--gold) 42%, var(--border-subtle));
  border-radius: var(--radius-md);
  background:
    radial-gradient(circle at 4% 0, color-mix(in srgb, var(--cyan) 11%, transparent), transparent 34%),
    linear-gradient(118deg, color-mix(in srgb, var(--surface-2) 88%, #071324), var(--surface-1));
}

.header-copy,
.header-copy p,
.header-copy h2 {
  min-width: 0;
  margin: 0;
}

.eyebrow,
.section-label {
  color: var(--cyan);
  font-size: var(--ui-text-label);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .14em;
}

.header-copy h2 {
  margin-top: 5px;
  color: var(--gold-bright);
  font-family: var(--font-display);
  font-size: clamp(22px, 2.4cqi, 32px);
  font-weight: 500;
  line-height: 1.12;
}

.header-copy > p:last-child {
  max-width: 720px;
  margin-top: var(--space-3);
  color: var(--text-secondary);
  font-size: var(--ui-text-support);
  line-height: 1.55;
}

.grade-summary {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: rgba(5, 14, 27, .54);
}

.average-grade {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 3px;
  padding: var(--space-3);
  border-right: 1px solid var(--border-subtle);
}

.average-grade span,
.grade-summary dt {
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  text-transform: uppercase;
  letter-spacing: .08em;
}

.average-grade strong {
  color: var(--gold-bright);
  font-family: var(--font-display);
  font-size: 38px;
  font-weight: 500;
  line-height: 1;
}

.grade-summary dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
}

.grade-summary dl > div {
  display: grid;
  align-content: center;
  min-width: 0;
  gap: 3px;
  padding: 10px 12px;
}

.grade-summary dl > div + div {
  border-left: 1px solid var(--border-subtle);
}

.grade-summary dd {
  overflow: hidden;
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-numeric);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.grade-summary small {
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.story-section {
  min-width: 0;
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
}

.story-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-5);
  margin-bottom: var(--space-4);
}

.story-head h2,
.story-head p,
.predictive-panel h3,
.predictive-panel p {
  margin: 0;
}

.story-head h2 {
  margin-top: 4px;
  color: var(--gold-bright);
  font-family: var(--font-display);
  font-size: clamp(19px, 2cqi, 26px);
  font-weight: 500;
}

.story-head > div > p:last-child {
  max-width: 780px;
  margin-top: var(--space-2);
  color: var(--text-secondary);
  font-size: var(--ui-text-support);
  line-height: 1.55;
}

.sample {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  text-transform: uppercase;
  letter-spacing: .08em;
}

.callout {
  flex: 0 0 auto;
  padding-left: var(--space-3);
  border-left: 2px solid var(--cyan);
}

.callout span,
.callout strong {
  display: block;
}

.callout span {
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  text-transform: uppercase;
  letter-spacing: .06em;
}

.callout strong {
  margin-top: 3px;
  color: var(--text-primary);
  font-size: var(--ui-text-label);
}

.detail-pane {
  margin-top: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: rgba(15, 28, 51, 0.38);
}

.detail-pane > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  gap: var(--space-3);
  padding: 8px var(--space-4);
  color: var(--text-secondary);
  font-size: var(--ui-text-label);
  cursor: pointer;
  user-select: none;
}

.detail-pane[open] > summary {
  border-bottom: 1px solid var(--border-subtle);
  color: var(--gold);
}

.table-wrap {
  max-height: 340px;
  margin: var(--space-3) var(--space-4) var(--space-4);
  overflow: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--ui-text-label);
}

th,
td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-subtle);
  text-align: left;
}

th {
  position: sticky;
  top: 0;
  background: var(--surface-1);
  color: var(--text-muted);
  font-weight: 500;
}

.driver-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.driver-summary article {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--surface-1) 78%, transparent);
}

.driver-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}

.driver-head strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--ui-text-label);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.driver-head span {
  flex: 0 0 auto;
  color: var(--gold-bright);
  font-size: var(--ui-text-label);
}

.driver-meter {
  height: 3px;
  margin: 8px 0 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--surface-3);
}

.driver-meter span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--cyan), var(--gold));
}

.driver-summary p,
.chart-note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  line-height: 1.45;
}

.chart-note {
  margin-top: var(--space-2);
}

.evidence-section {
  padding-bottom: var(--space-5);
}

.predictive-panel {
  display: grid;
  grid-template-columns: minmax(220px, .65fr) minmax(320px, 1fr);
  align-items: center;
  gap: var(--space-5);
  margin-top: var(--space-5);
  padding: var(--space-4);
  border: 1px solid color-mix(in srgb, var(--cyan) 40%, var(--border-subtle));
  border-radius: var(--radius-md);
  background: linear-gradient(110deg, color-mix(in srgb, var(--cyan) 8%, var(--surface-1)), var(--surface-1));
}

.predictive-panel h3 {
  margin-top: 4px;
  color: var(--gold-bright);
  font-family: var(--font-heading);
  font-size: 15px;
}

.predictive-panel div > p:last-child {
  margin-top: var(--space-2);
  color: var(--text-secondary);
  font-size: var(--ui-text-label);
  line-height: 1.5;
}

.methods-pane {
  margin-top: var(--space-4);
}

.method-list {
  display: grid;
  gap: 0;
  padding: var(--space-2) var(--space-4) var(--space-4);
}

.method-list article {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 9px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.method-list article > div {
  display: grid;
  gap: 2px;
}

.method-list strong {
  color: var(--text-primary);
  font-size: var(--ui-text-label);
}

.method-list span,
.method-list small,
.method-list p {
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  line-height: 1.45;
}

.method-list small {
  flex: 0 0 auto;
}

.method-list p {
  margin: var(--space-3) 0 0;
}

.learning-state {
  margin: 0;
  padding: var(--space-4);
  border-left: 2px solid var(--gold);
  background: var(--surface-1);
  color: var(--text-secondary);
  font-size: var(--ui-text-label);
  line-height: 1.6;
}

.positive { color: var(--win) !important; }
.negative { color: var(--loss) !important; }
.numeric { font-family: var(--font-numeric); }

@container skill-insights (max-width: 980px) {
  .insights-header {
    grid-template-columns: minmax(0, 1fr);
  }
}

@container skill-insights (max-width: 720px) {
  .predictive-panel {
    grid-template-columns: minmax(0, 1fr);
  }
}

@container skill-insights (max-width: 620px) {
  .story-head {
    align-items: flex-start;
    flex-direction: column;
    gap: var(--space-2);
  }

  .callout {
    align-self: stretch;
  }

  .grade-summary {
    grid-template-columns: 84px minmax(0, 1fr);
  }

  .grade-summary dl {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .grade-summary dl > div:nth-child(3) {
    grid-column: 1 / -1;
    border-top: 1px solid var(--border-subtle);
    border-left: 0;
  }

  .average-grade strong {
    font-size: 32px;
  }

  .method-list article {
    display: grid;
    gap: 4px;
  }
}

@container skill-insights (max-width: 420px) {
  .insights-header {
    padding: var(--space-3);
  }

  .grade-summary {
    grid-template-columns: 72px minmax(0, 1fr);
  }

  .average-grade {
    padding-inline: 8px;
  }

  .grade-summary dl > div {
    padding-inline: 9px;
  }

  .driver-summary {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
