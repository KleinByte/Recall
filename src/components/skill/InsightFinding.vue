<script setup lang="ts">
import { computed } from "vue"
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

const direction = computed(() => {
  if (!(["grade", "probability"] as const).includes(
    props.finding.unit as "grade" | "probability",
  )) return "neutral"
  if (!props.finding.interval || props.finding.interval.low <= 0 && props.finding.interval.high >= 0) {
    return "neutral"
  }
  return props.finding.effect > 0 ? "positive" : props.finding.effect < 0 ? "negative" : "neutral"
})

function formatSigned(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`
}
</script>

<template>
  <article class="finding">
    <header class="finding-head">
      <h3>{{ finding.title }}</h3>
      <span class="effect numeric" :class="direction">{{ effectLabel }}</span>
    </header>

    <p class="summary">{{ finding.summary }}</p>

    <div class="evidence-row">
      <span class="evidence">{{ evidenceLabel }}</span>
      <span>{{ confidenceLabel }}</span>
      <span>{{ finding.eligibleGames }} eligible / {{ finding.games }} recorded games</span>
      <span v-if="intervalLabel" class="numeric">{{ intervalLabel }}</span>
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