<script setup lang="ts">
import { computed } from "vue"
import GradeBadge from "../GradeBadge.vue"
import RankedHistoryPanel from "../RankedHistoryPanel.vue"
import PerformanceProfile from "./PerformanceProfile.vue"
import OutcomeTrendChart from "./OutcomeTrendChart.vue"
import MiniBar from "../ui/MiniBar.vue"
import Panel from "../ui/Panel.vue"
import TelemetryBoard from "../ui/TelemetryBoard.vue"
import { itemAsset } from "../../helpers/items"
import { classifyRviIdentity } from "../../helpers/rvi-identity"
import {
  championIconUrl,
  championNameById,
  formatCompact,
  formatDecimal,
  formatPercent,
  GRADE_ORDER,
} from "../../helpers/format"
import { recallGradeFromRoleFitScore } from "../../shared/recall-grade"
import type { LobbyMetric, ModeFamily, RankedHistory, SkillReportV3 } from "../../types/stats"
import type { Champion } from "../../types/lol"

const props = defineProps<{
  overview: SkillReportV3["overview"]
  family: ModeFamily
  champions: Champion[] | null
  ranked: RankedHistory[]
}>()

const summary = computed(() => props.overview.summary)
const detail = computed(() => props.overview.style?.career.detail)
const averageGrade = computed(() => recallGradeFromRoleFitScore(summary.value.avgRoleFitScore))
const SHOW_RANKED_HISTORY = false

type TelemetryReading = {
  label: string
  value: string
  hint?: string
  tone?: "neutral" | "win" | "loss"
}

const resultTelemetry = computed<TelemetryReading[]>(() => [
  {
    label: "Games",
    value: summary.value.games.toString(),
    hint: `${summary.value.wins}W · ${summary.value.losses}L`,
  },
  {
    label: "Win rate",
    value: formatPercent(summary.value.winRate),
    tone: summary.value.winRate >= 0.5 ? "win" : "loss",
  },
  {
    label: "Avg RoleFit",
    value: summary.value.avgRoleFitScore === undefined
      ? "–"
      : summary.value.avgRoleFitScore.toFixed(1),
    hint: `${averageGrade.value ?? "No grade"} · ${summary.value.gradedGames} graded`,
  },
  { label: "KDA", value: formatDecimal(summary.value.kda, 2) },
])

const paceTelemetry = computed<TelemetryReading[]>(() => detail.value ? [
  { label: "Damage / min", value: formatCompact(detail.value.damagePerMin) },
  { label: "Gold / min", value: formatCompact(detail.value.goldPerMin) },
  { label: "CS / min", value: formatDecimal(detail.value.csPerMin, 1) },
  ...(props.family === "sr" || props.family === "classic"
    ? [{ label: "Vision / min", value: formatDecimal(detail.value.visionPerMin, 2) }]
    : []),
] : [])

const telemetryBanks = computed(() => [
  { label: "Results", readings: resultTelemetry.value },
  ...(paceTelemetry.value.length
    ? [{ label: "Pace", readings: paceTelemetry.value }]
    : []),
])

const gradeBars = computed(() => {
  const byGrade = new Map(props.overview.grades.map((entry) => [entry.grade, entry.count]))
  const highest = Math.max(1, ...props.overview.grades.map((entry) => entry.count))

  return GRADE_ORDER.filter((grade) => byGrade.has(grade)).map((grade) => ({
    grade,
    count: byGrade.get(grade)!,
    share: byGrade.get(grade)! / highest,
  }))
})

const comparisonScope = (scope: "role" | "lobby") =>
  scope === "role" ? "Head-to-head · role opponent" : "Average lobby place"

const comparisonValue = (metric: LobbyMetric) =>
  metric.scope === "role"
    ? formatPercent(metric.percentile)
    : metric.averageRank.toFixed(1)

const comparisonUnit = (scope: "role" | "lobby") =>
  scope === "role" ? "score" : ""

const rviIdentity = computed(() => props.overview.performance
  ? classifyRviIdentity(props.overview.performance)
  : undefined)
</script>

<template>
  <div class="overview">
    <TelemetryBoard
      label="Scope telemetry"
      :banks="telemetryBanks"
    />

    <RankedHistoryPanel
      v-if="SHOW_RANKED_HISTORY && ranked.length"
      class="overview-rank"
      :histories="ranked"
      allow-season-selection
      compact
    />

    <PerformanceProfile
      v-if="overview.performance"
      :profile="overview.performance"
      :identity="rviIdentity"
      :champions="champions"
    />

    <Panel
      v-if="overview.lobby"
      title="Recorded comparisons"
      :meta="`${overview.lobby.games} complete lobbies`"
    >
      <div class="metric-grid">
        <div v-for="metric in overview.lobby.metrics" :key="metric.key" class="metric">
          <div class="metric-head">
            <div>
              <span class="metric-label">{{ metric.label }}</span>
              <span class="muted metric-scope">{{ comparisonScope(metric.scope) }}</span>
            </div>
            <span class="numeric metric-rank">
              {{ comparisonValue(metric) }}
            </span>
          </div>
          <MiniBar :value="metric.percentile" />
          <div class="metric-scale muted">
            <span>{{ metric.scope === "role" ? "Behind" : "10th" }}</span>
            <span>{{ metric.games }} games</span>
            <span>{{ metric.scope === "role" ? "Ahead" : "1st" }}</span>
          </div>
        </div>
      </div>
      <p class="muted footnote">
        Lobby metrics show average place out of ten. Role metrics compare only with the opposing
        player in that role, where 50% is even and ties split the result.
      </p>
    </Panel>

    <section class="context-grid">
      <Panel title="Game length">
        <OutcomeTrendChart :rows="overview.outcomes.duration" />
        <p class="muted footnote">Recorded win rate and game count in each duration band.</p>
      </Panel>

      <Panel title="Time of day">
        <OutcomeTrendChart :rows="overview.outcomes.hours" />
        <p class="muted footnote">Recorded win rate by local start-time block.</p>
      </Panel>
    </section>

    <Panel title="Share of your team" class="contribution-panel">
      <template v-if="overview.contribution">
        <div class="contribution-layout">
          <p class="muted contribution-copy">
            Per-game team share across {{ overview.contribution.games }} complete lobbies.
            The 20% marker is arithmetic context, not a role expectation.
          </p>
          <div class="contribution-metrics">
            <div v-for="row in [
              { label: 'Damage', value: overview.contribution.damageShare },
              { label: 'Gold', value: overview.contribution.goldShare },
              { label: 'Kills', value: overview.contribution.killShare },
            ]" :key="row.label" class="contribution-metric">
              <div><span>{{ row.label }}</span><strong class="numeric">{{ formatPercent(row.value) }}</strong></div>
              <MiniBar :value="row.value" />
            </div>
          </div>
        </div>
      </template>
      <p v-else class="muted empty">No complete team scoreboards recorded.</p>
    </Panel>

    <section class="overview-grid">
      <Panel title="Champion pool">
        <template v-if="overview.pool">
          <div class="pool-count">
            <span class="numeric big">{{ overview.pool.champions }}</span>
            <span class="muted">champions in {{ overview.pool.games }} games</span>
          </div>
          <div class="bar-row">
            <span>Top five share</span>
            <MiniBar :value="overview.pool.coreShare" />
            <span class="numeric small">{{ formatPercent(overview.pool.coreShare) }}</span>
          </div>
          <ul class="pool-roster">
            <li v-for="champion in overview.pool.top" :key="champion.championId">
              <img
                :src="championIconUrl(champion.championId)"
                :alt="championNameById(champions, champion.championId)"
                class="champion-icon"
              />
              <span>{{ championNameById(champions, champion.championId) }}</span>
              <span class="muted numeric">{{ champion.games }} games</span>
            </li>
          </ul>
        </template>
        <p v-else class="muted empty">No champion history in this scope.</p>
      </Panel>

      <Panel title="Most built items">
        <ul v-if="overview.builds.length" class="item-list">
          <li v-for="item in overview.builds" :key="item.itemId">
            <img :src="itemAsset(item.itemId).iconUrl" class="item" :alt="itemAsset(item.itemId).name" />
            <span>{{ itemAsset(item.itemId).name }}</span>
            <span class="muted numeric">{{ item.games }}×</span>
          </li>
        </ul>
        <p v-else class="muted empty">No final inventories recorded.</p>
        <p class="muted footnote">Final inventory frequency; purchase order is unavailable.</p>
      </Panel>

      <Panel v-if="gradeBars.length" :title="`Recall grades · average RoleFit ${summary.avgRoleFitScore?.toFixed(1) ?? '–'} (${averageGrade ?? '–'})`">
        <div class="grades">
          <div v-for="bar in gradeBars" :key="bar.grade" class="grade-row">
            <GradeBadge :grade="bar.grade" />
            <MiniBar :value="bar.share" />
            <span class="muted numeric small">{{ bar.count }}</span>
          </div>
        </div>
      </Panel>

      <Panel v-if="detail" title="Combat totals">
        <dl class="stat-rows">
          <div><dt>Deaths / game</dt><dd>{{ formatDecimal(detail.avgDeaths, 1) }}</dd></div>
          <div><dt>Longest spree / game</dt><dd>{{ formatDecimal(detail.avgLargestSpree, 1) }}</dd></div>
          <div><dt>Double kills</dt><dd>{{ detail.doubleKills }}</dd></div>
          <div><dt>Triple kills</dt><dd>{{ detail.tripleKills }}</dd></div>
          <div><dt>Quadra kills</dt><dd>{{ detail.quadraKills }}</dd></div>
          <div><dt>Pentakills</dt><dd>{{ detail.pentaKills }}</dd></div>
        </dl>
      </Panel>
    </section>
  </div>
</template>

<style scoped>
.overview {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.overview-rank {
  width: min(100%, 920px);
}

.rows,
.grades {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.small {
  text-align: right;
  font-size: 12px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  grid-auto-rows: 1fr;
  gap: var(--space-3) var(--space-4);
}

.metric-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-2);
  margin-bottom: var(--space-1);
}

.metric-label,
.metric-scope {
  display: block;
  font-size: 11px;
}

.metric-rank {
  font-size: 12px;
}

.metric-scale {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: 4px;
  font-size: 11px;
}

.context-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  align-items: start;
}

.contribution-layout {
  display: grid;
  grid-template-columns: minmax(180px, .55fr) minmax(0, 1.45fr);
  align-items: center;
  gap: var(--space-5);
}

.contribution-copy {
  max-width: 430px;
  margin: 0;
  font-size: 11px;
  line-height: 1.55;
}

.contribution-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 1fr));
  gap: var(--space-4);
}

.contribution-metric {
  display: grid;
  gap: var(--space-2);
}

.contribution-metric > div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: 12px;
}

.contribution-metric strong {
  color: var(--gold-bright);
  font-size: 14px;
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-4);
  align-items: stretch;
}

.bar-row {
  display: grid;
  grid-template-columns: 90px minmax(70px, 1fr) 44px;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
}

.footnote,
.empty {
  margin: var(--space-2) 0 0;
  font-size: 11px;
  line-height: 1.5;
}

.pool-count {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.pool-roster {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-2) var(--space-3);
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
}

.pool-roster li {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  color: var(--text-primary);
  font-size: 12px;
}

.pool-roster li > span:first-of-type {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.champion-icon {
  width: 26px;
  height: 26px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  object-fit: cover;
}

.big {
  color: var(--gold-bright);
  font-size: 26px;
}

.item-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}

.item-list li {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: 12px;
}

.item {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.grade-row {
  display: grid;
  grid-template-columns: 38px minmax(70px, 1fr) 30px;
  align-items: center;
  gap: var(--space-2);
}

.stat-rows {
  margin: 0;
}

.stat-rows div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 12px;
}

.stat-rows div:last-child {
  border-bottom: 0;
}

.stat-rows dt {
  color: var(--text-secondary);
}

.stat-rows dd {
  margin: 0;
  font-family: var(--font-numeric);
}

@media (max-width: 800px) {
  .context-grid,
  .contribution-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .contribution-metrics {
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  }
}

@media (max-width: 560px) {
  .overview-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
