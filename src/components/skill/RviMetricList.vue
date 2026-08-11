<script setup lang="ts">
import type {
  PerformanceMetricScore,
  PerformanceScoringContext,
} from "../../types/stats"

defineProps<{
  metrics: PerformanceMetricScore[]
  scoringContext: PerformanceScoringContext
}>()

const scoreLabel = (score: number | null) => {
  if (score === null) return "N/A"
  if (score >= 65) return "Leading"
  if (score >= 55) return "Positive"
  if (score >= 45) return "Even"
  return "Developing"
}

const metricRawLabel = (metric: PerformanceMetricScore) => {
  if (metric.rawValue === null) return "Raw value unavailable"
  const absolute = Math.abs(metric.rawValue)
  const value = absolute >= 1_000
    ? Math.round(metric.rawValue).toLocaleString()
    : Number(metric.rawValue.toFixed(absolute >= 10 ? 1 : 2)).toLocaleString()
  return `${value}${metric.unit === "%" ? "%" : metric.unit ? ` ${metric.unit}` : ""}`
}

const evidenceLabel = (metric: PerformanceMetricScore) => ({
  observed: "Observed",
  unavailable: "Unavailable",
  no_opportunity: "No opportunity",
  invalid: "Invalid source value",
  not_applicable: "Not applicable",
  unknown: "Unknown legacy evidence",
  missing: "Missing evidence",
})[metric.evidenceState]

const coverageLabel = (metric: PerformanceMetricScore) => metric.coverage === null
  ? "Coverage unavailable"
  : `${Math.round(metric.coverage * 100)}% coverage`

const armInfluenceLabel = (metric: PerformanceMetricScore) => metric.vectorWeight > 0
  ? `${Math.round(metric.vectorWeight * 100)}% arm weight`
  : "Detail only"

const gradeInfluenceLabel = (
  metric: PerformanceMetricScore,
  scoringContext: PerformanceScoringContext,
) => {
  if (metric.gradeInfluence > 0) {
    return `${Math.round(metric.gradeInfluence * 100)}% ${scoringContext === "match" ? "of this match's Grade mix" : "average Grade influence"}`
  }
  return metric.vectorWeight > 0 ? "No Grade influence in this selection" : "No Grade influence"
}
</script>

<template>
  <div class="metric-list">
    <details v-for="metric in metrics" :key="metric.key" class="metric-row">
      <summary>
        <span class="metric-identity">
          <span class="metric-title">
            <strong>{{ metric.label }}</strong>
            <span class="evidence-badge" :data-state="metric.evidenceState">
              {{ evidenceLabel(metric) }}
            </span>
          </span>
          <small>{{ metricRawLabel(metric) }}</small>
        </span>
        <span class="metric-coverage">
          <strong>{{ metric.games }}/{{ metric.eligibleGames }}</strong>
          <small>{{ coverageLabel(metric) }}</small>
        </span>
        <span class="metric-score">
          <strong class="numeric">{{ metric.score ?? '—' }}</strong>
          <small>{{ scoreLabel(metric.score) }}</small>
        </span>
        <span class="metric-influence">
          <strong>{{ armInfluenceLabel(metric) }}</strong>
          <small>{{ gradeInfluenceLabel(metric, scoringContext) }}</small>
        </span>
        <span class="metric-chevron" aria-hidden="true">
          <svg viewBox="0 0 20 20" focusable="false"><path d="m5 7.5 5 5 5-5" /></svg>
        </span>
      </summary>

      <div class="metric-detail">
        <p>{{ metric.description }}</p>
        <dl>
          <div>
            <dt>Recorded value</dt>
            <dd>{{ metricRawLabel(metric) }}</dd>
          </div>
          <div>
            <dt>Measured games</dt>
            <dd>{{ metric.games }}/{{ metric.eligibleGames }} · {{ coverageLabel(metric) }}</dd>
          </div>
          <div>
            <dt>Comparison</dt>
            <dd>{{ metric.comparison }}</dd>
          </div>
          <div v-if="metric.referenceMatchCount !== undefined">
            <dt>Reference</dt>
            <dd>{{ metric.referenceMatchCount }} matches</dd>
          </div>
          <div>
            <dt>Influence</dt>
            <dd>{{ armInfluenceLabel(metric) }} · {{ gradeInfluenceLabel(metric, scoringContext) }}</dd>
          </div>
          <div class="formula">
            <dt>Formula</dt>
            <dd>{{ metric.formula }}</dd>
          </div>
        </dl>
      </div>
    </details>
  </div>
</template>

<style scoped>
.metric-list {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, .014), transparent 42%),
    rgba(8, 19, 35, .46);
}

.metric-row {
  border-bottom: 1px solid var(--border-subtle);
}

.metric-row:last-child { border-bottom: 0; }

.metric-row summary {
  display: grid;
  grid-template-columns: minmax(210px, 1fr) 94px minmax(72px, max-content) minmax(120px, .55fr) 22px;
  align-items: center;
  min-width: 0;
  min-height: 52px;
  gap: var(--space-3);
  padding: 10px var(--space-3) 10px calc(var(--space-3) - 2px);
  border-left: 2px solid transparent;
  color: var(--text-primary);
  cursor: pointer;
  list-style: none;
  transition: background-color 150ms ease, border-color 150ms ease;
}

.metric-row summary::-webkit-details-marker { display: none; }
.metric-row summary:hover,
.metric-row[open] summary { background: rgba(10, 203, 230, .04); }
.metric-row[open] summary { border-left-color: var(--cyan); }
.metric-row summary:focus-visible { outline: 2px solid var(--cyan); outline-offset: -2px; }

.metric-identity,
.metric-coverage,
.metric-score,
.metric-influence { display: grid; min-width: 0; }

.metric-title { display: flex; align-items: center; min-width: 0; gap: 7px; }
.metric-title strong { overflow: hidden; font: var(--ui-text-support) var(--font-heading); text-overflow: ellipsis; white-space: nowrap; }
.metric-identity > small,
.metric-coverage small,
.metric-score small,
.metric-influence small { color: var(--text-muted); font-size: var(--ui-text-label); line-height: 1.4; }
.metric-identity > small { overflow-wrap: anywhere; }

.metric-coverage,
.metric-score,
.metric-influence { justify-items: end; text-align: right; }
.metric-coverage strong { color: var(--text-secondary); font-size: var(--ui-text-label); }
.metric-score strong { color: var(--gold-bright); font-size: 16px; }
.metric-score small { letter-spacing: .05em; text-transform: uppercase; }
.metric-influence strong { color: var(--cyan); font-size: var(--ui-text-label); }

.evidence-badge {
  flex: 0 0 auto;
  padding: 2px 5px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: var(--ui-text-micro);
  letter-spacing: .05em;
  text-transform: uppercase;
}

.evidence-badge[data-state="observed"] { border-color: rgba(10, 203, 230, .28); color: var(--cyan); }
.evidence-badge[data-state="invalid"] { border-color: rgba(228, 88, 104, .42); color: var(--ui-negative-text); }
.evidence-badge[data-state="no_opportunity"],
.evidence-badge[data-state="not_applicable"] { border-color: rgba(200, 170, 109, .32); color: var(--gold); }

.metric-chevron {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  color: var(--text-muted);
  transition: transform 150ms ease, color 150ms ease;
}

.metric-chevron svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; }
.metric-row[open] .metric-chevron { color: var(--cyan); transform: rotate(180deg); }

.metric-detail {
  padding: 0 var(--space-3) var(--space-3);
  border-top: 1px solid rgba(160, 170, 186, .08);
  background: rgba(2, 10, 19, .22);
}

.metric-detail > p {
  margin: var(--space-3) 0;
  color: var(--text-secondary);
  font-size: var(--ui-text-support);
  line-height: 1.5;
}

.metric-detail dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px var(--space-3);
  margin: 0;
}

.metric-detail dl > div { display: grid; min-width: 0; gap: 2px; }
.metric-detail dl > .formula { grid-column: 1 / -1; }
.metric-detail dt { color: var(--text-muted); font-size: var(--ui-text-label); letter-spacing: .07em; text-transform: uppercase; }
.metric-detail dd { min-width: 0; margin: 0; color: var(--text-primary); font-size: var(--ui-text-support); line-height: 1.45; overflow-wrap: anywhere; }

@container rvi-profile (max-width: 840px) {
  .metric-row summary {
    grid-template-columns: minmax(180px, 1fr) minmax(72px, max-content) minmax(105px, .55fr) 22px;
  }
  .metric-coverage { display: none; }
}

@container rvi-profile (max-width: 560px) {
  .metric-row summary {
    grid-template-columns: minmax(0, 1fr) minmax(72px, max-content) 22px;
    gap: var(--space-2);
  }
  .metric-influence { grid-column: 1 / -1; grid-row: 2; justify-items: start; text-align: left; }
  .metric-score { grid-column: 2; grid-row: 1; }
  .metric-chevron { grid-column: 3; grid-row: 1; }
  .metric-detail dl { grid-template-columns: minmax(0, 1fr); }
  .metric-detail dl > .formula { grid-column: auto; }
}

@container rvi-profile (max-width: 480px) {
  .metric-title {
    display: grid;
    justify-items: start;
    gap: 4px;
  }
  .metric-title strong { max-width: 100%; white-space: normal; }
  .evidence-badge { width: max-content; max-width: 100%; }
  .metric-detail { padding-inline: var(--space-2); }
}

@media (prefers-reduced-motion: reduce) {
  .metric-row summary,
  .metric-chevron { transition: none; }
}
</style>
