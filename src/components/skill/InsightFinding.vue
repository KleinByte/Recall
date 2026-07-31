<script setup lang="ts">
import { computed } from "vue"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import { faArrowDown, faArrowUp, faChartLine } from "@fortawesome/free-solid-svg-icons"
import {
  findingItemAsset,
  findingLabel,
  findingSummary,
} from "../../helpers/insight-findings"
import type { InsightFinding } from "../../types/stats"

const props = defineProps<{
  finding: InsightFinding
}>()

const evidenceLabel = computed(() => ({
  descriptive: "Descriptive",
  comparative: "Comparative",
  experimental: "Experimental",
})[props.finding.evidenceLevel])

const confidenceLabel = computed(() => ({
  insufficient: "Insufficient evidence",
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
})[props.finding.confidence])

const effectLabel = computed(() => {
  const effect = props.finding.effect
  const sign = effect > 0 ? "+" : ""
  if (props.finding.unit === "grade") return `${sign}${effect.toFixed(2)} Recall grade`
  return `${sign}${(effect * 100).toFixed(1)} pp`
})

const intervalLabel = computed(() => {
  const interval = props.finding.interval
  if (!interval) return undefined
  const multiplier = props.finding.unit === "grade" ? 1 : 100
  const suffix = props.finding.unit === "grade" ? "" : " pp"
  return `95% interval ${formatSigned(interval.low * multiplier)} to ${formatSigned(interval.high * multiplier)}${suffix}`
})

const rateIntervalLabel = computed(() => {
  const interval = props.finding.rateInterval
  if (!interval) return undefined
  return `Raw win rate 95% interval ${(interval.low * 100).toFixed(1)}% to ${(interval.high * 100).toFixed(1)}%`
})

const direction = computed(() => {
  if (!(["grade", "probability"] as const).includes(
    props.finding.unit as "grade" | "probability",
  )) return "neutral"
  if (!props.finding.interval || props.finding.interval.low <= 0 && props.finding.interval.high >= 0) {
    return "neutral"
  }
  return props.finding.effect > 0 ? "positive" : props.finding.effect < 0 ? "negative" : "neutral"
})

const item = computed(() => findingItemAsset(props.finding))

const displayTitle = computed(() => findingLabel(props.finding))
const displaySummary = computed(() => findingSummary(props.finding))

const playerLabel = computed(() => {
  if (props.finding.unit === "probability") return "Estimated win chance"
  if (direction.value === "positive") return "Stronger games"
  if (direction.value === "negative") return "Weaker games"
  return "No clear difference"
})

const effectWidth = computed(() => {
  const scale = props.finding.unit === "grade" ? 2 : 0.2
  return `${Math.min(100, Math.abs(props.finding.effect) / scale * 100)}%`
})

function formatSigned(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`
}
</script>

<template>
  <article class="finding">
    <header class="finding-head">
      <div class="finding-title">
        <img v-if="item" :src="item.iconUrl" :alt="item.name" class="item-icon" />
        <FontAwesomeIcon
          v-else
          :icon="direction === 'positive' ? faArrowUp : direction === 'negative' ? faArrowDown : faChartLine"
          class="finding-icon"
          :class="direction"
        />
        <h3>{{ displayTitle }}</h3>
      </div>
      <span class="effect numeric" :class="direction">{{ effectLabel }}</span>
    </header>

    <p class="player-label" :class="direction">{{ playerLabel }}</p>
    <p class="summary">{{ displaySummary }}</p>

    <div class="effect-meter" :class="direction" aria-hidden="true">
      <span :style="{ width: effectWidth }" />
    </div>

    <div class="evidence-row">
      <span class="evidence">{{ evidenceLabel }}</span>
      <span>{{ confidenceLabel }}</span>
      <span>{{ finding.games }} games · {{ finding.eligibleGames }} eligible in scope</span>
      <span v-if="intervalLabel" class="numeric">{{ intervalLabel }}</span>
      <span v-if="rateIntervalLabel" class="numeric">{{ rateIntervalLabel }}</span>
    </div>

    <details>
      <summary>Scope and caveats</summary>
      <p>{{ finding.scope }}</p>
      <p v-if="finding.caveat">{{ finding.caveat }}</p>
    </details>
  </article>
</template>

<style scoped>
.finding {
  min-width: 0;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-1);
}

.finding-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-3);
}

.finding-title {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: var(--space-2);
}

.finding-icon,
.item-icon {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
}

.finding-icon.positive {
  color: var(--win);
}

.finding-icon.negative {
  color: var(--loss);
}

.item-icon {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

h3 {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-heading);
  font-size: 13px;
  font-weight: 500;
}

.effect {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--text-secondary);
}

.effect.positive {
  color: var(--win);
}

.effect.negative {
  color: var(--loss);
}

.summary {
  margin: var(--space-2) 0 var(--space-3);
  color: var(--text-primary);
  font-size: 12px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.player-label {
  margin: var(--space-2) 0 0;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
}

.player-label.positive {
  color: var(--win);
}

.player-label.negative {
  color: var(--loss);
}

.effect-meter {
  height: 4px;
  margin: 0 0 var(--space-3);
  overflow: hidden;
  background: var(--surface-3);
}

.effect-meter span {
  display: block;
  height: 100%;
  background: var(--text-muted);
}

.effect-meter.positive span {
  background: var(--win);
}

.effect-meter.negative span {
  background: var(--loss);
}

.evidence-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  color: var(--text-muted);
  font-size: 10px;
}

.evidence {
  color: var(--gold);
}

details {
  margin-top: var(--space-3);
  color: var(--text-muted);
  font-size: 10px;
}

summary {
  width: fit-content;
  cursor: pointer;
  color: var(--text-secondary);
}

details p {
  margin: var(--space-1) 0 0;
  line-height: 1.5;
}
</style>