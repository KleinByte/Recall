<script setup lang="ts">
import { computed } from "vue"
import GradeBadge from "../GradeBadge.vue"
import StyleRadar from "../StyleRadar.vue"
import MiniBar from "../ui/MiniBar.vue"
import Panel from "../ui/Panel.vue"
import StatTile from "../ui/StatTile.vue"
import { itemIconUrl } from "../../helpers/ddragon"
import {
  formatCompact,
  formatDecimal,
  formatPercent,
  GRADE_ORDER,
  gradeFromScore,
} from "../../helpers/format"
import type { ModeFamily, SkillReportV2 } from "../../types/stats"

const props = defineProps<{
  overview: SkillReportV2["overview"]
  family: ModeFamily
}>()

const summary = computed(() => props.overview.summary)
const detail = computed(() => props.overview.style?.detail)
const averageGrade = computed(() => gradeFromScore(summary.value.avgGradeScore))

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
  scope === "role" ? "Role opponent" : "Full lobby"
</script>

<template>
  <div class="overview">
    <section class="kpis">
      <StatTile
        label="Games"
        :value="summary.games.toString()"
        :hint="`${summary.wins}W · ${summary.losses}L`"
      />
      <StatTile label="Win rate" :value="formatPercent(summary.winRate)" />
      <StatTile
        label="Avg Recall grade"
        :value="averageGrade ?? '–'"
        :hint="`${summary.gradedGames} graded of ${summary.games}`"
      />
      <StatTile label="KDA" :value="formatDecimal(summary.kda, 2)" />
      <StatTile
        v-if="detail"
        label="Damage / min"
        :value="formatCompact(detail.damagePerMin)"
      />
      <StatTile
        v-if="detail"
        label="Gold / min"
        :value="formatCompact(detail.goldPerMin)"
      />
      <StatTile
        v-if="detail"
        label="CS / min"
        :value="formatDecimal(detail.csPerMin, 1)"
      />
      <StatTile
        v-if="detail && family === 'sr'"
        label="Vision / min"
        :value="formatDecimal(detail.visionPerMin, 2)"
      />
    </section>

    <Panel
      v-if="overview.style"
      title="Playstyle"
      :meta="`${overview.style.games} games`"
    >
      <div class="playstyle">
        <StyleRadar :axes="overview.style.axes" />
        <div class="axis-list">
          <div
            v-for="axis in overview.style.axes"
            :key="axis.key"
            class="axis-row"
            :title="`${axis.description}. Formula: ${axis.formula}`"
          >
            <div class="axis-copy">
              <span>{{ axis.label }}</span>
              <span class="muted formula">{{ axis.formula }}</span>
            </div>
            <MiniBar :value="axis.value" />
            <span class="numeric axis-value">{{ Math.round(axis.value * 100) }}%</span>
          </div>
          <p class="muted footnote">
            Display scales describe the mix of what happened in your games. They are not
            population benchmarks.
          </p>
        </div>
      </div>
    </Panel>

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
              {{ metric.averageRank.toFixed(1) }}<span class="muted">/10</span>
            </span>
          </div>
          <MiniBar :value="metric.percentile" />
        </div>
      </div>
    </Panel>

    <section class="overview-grid">
      <Panel title="Share of your team">
        <template v-if="overview.contribution">
          <div class="rows">
            <div v-for="row in [
              { label: 'Damage', value: overview.contribution.damageShare },
              { label: 'Gold', value: overview.contribution.goldShare },
              { label: 'Kills', value: overview.contribution.killShare },
            ]" :key="row.label" class="bar-row">
              <span>{{ row.label }}</span>
              <MiniBar :value="row.value" />
              <span class="numeric small">{{ formatPercent(row.value) }}</span>
            </div>
          </div>
          <p class="muted footnote">
            Per-game team share across {{ overview.contribution.games }} complete lobbies.
            An even split is 20% arithmetic context, not a role expectation.
          </p>
        </template>
        <p v-else class="muted empty">No complete team scoreboards recorded.</p>
      </Panel>

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
        </template>
        <p v-else class="muted empty">No champion history in this scope.</p>
      </Panel>

      <Panel title="Most built items">
        <ul v-if="overview.builds.length" class="item-list">
          <li v-for="item in overview.builds" :key="item.itemId">
            <img :src="itemIconUrl(item.itemId)" class="item" alt="" />
            <span class="muted numeric">{{ item.games }}×</span>
          </li>
        </ul>
        <p v-else class="muted empty">No final inventories recorded.</p>
        <p class="muted footnote">Final inventory frequency; purchase order is unavailable.</p>
      </Panel>

      <Panel v-if="gradeBars.length" :title="`Recall grades · average ${averageGrade ?? '–'}`">
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

.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(138px, 1fr));
  grid-auto-rows: 1fr;
  gap: var(--space-3);
}

.playstyle {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.75fr);
  gap: var(--space-5);
  align-items: start;
}

.axis-list,
.rows,
.grades {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.axis-row {
  display: grid;
  grid-template-columns: minmax(110px, 0.8fr) minmax(80px, 1fr) 40px;
  align-items: center;
  gap: var(--space-2);
}

.axis-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: 12px;
}

.formula {
  font-size: 10px;
  overflow-wrap: anywhere;
}

.axis-value,
.small {
  text-align: right;
  font-size: 11px;
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

@media (max-width: 1180px) {
  .playstyle {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>