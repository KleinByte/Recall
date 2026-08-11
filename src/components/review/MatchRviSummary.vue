<script setup lang="ts">
import { computed } from "vue"
import GradeBadge from "../GradeBadge.vue"
import PerformanceRadar from "../skill/PerformanceRadar.vue"
import type {
  PerformancePosition,
  PerformanceProfile,
} from "../../types/stats"

const props = defineProps<{
  profile: PerformanceProfile
  grade?: string
  personalScore?: number
  lobbyPlace?: number
  lobbySize?: number
  referenceMatches?: number
}>()

const measuredDimensions = computed(() =>
  props.profile.dimensions.filter((dimension) => dimension.score !== null),
)
const canRenderRadar = computed(() => measuredDimensions.value.length >= 3)

const positionLabels: Record<PerformancePosition, string> = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MIDDLE: "Mid",
  BOTTOM: "Bot",
  UTILITY: "Support",
}

const titleCase = (value: string) => value
  .split("_")
  .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
  .join(" ")

const position = computed(() => props.profile.scopes.positions[0]?.position)
const archetype = computed(() => props.profile.scopes.primaryArchetypes[0]?.primaryArchetype)
const comparisonContext = computed(() => {
  const labels = [
    position.value ? positionLabels[position.value] : undefined,
    archetype.value ? titleCase(archetype.value) : undefined,
  ].filter((label): label is string => Boolean(label))
  return labels.length ? `Compared as ${labels.join(" · ")}` : "Mode-specific responsibilities"
})

const ordinal = (score: number) => {
  const rounded = Math.round(score)
  const remainder = rounded % 100
  const suffix = remainder >= 11 && remainder <= 13
    ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[rounded % 10] ?? "th"
  return `${rounded}${suffix}`
}

const personalDifference = computed(() => props.personalScore === undefined
  ? undefined
  : Math.round(props.profile.score - props.personalScore))

const personalHint = computed(() => {
  const difference = personalDifference.value
  if (difference === undefined) return "More recorded games are needed"
  if (difference === 0) return "Even with your recorded average"
  return `${Math.abs(difference)} points ${difference > 0 ? "above" : "below"} your average`
})

const lobbyValue = computed(() => props.lobbyPlace && props.lobbySize
  ? `#${props.lobbyPlace} of ${props.lobbySize}`
  : "—")
</script>

<template>
  <section class="match-rvi-summary" aria-labelledby="match-rvi-title">
    <div class="radar-panel">
      <header>
        <p class="eyebrow">Match RVI</p>
        <h2 id="match-rvi-title">This game</h2>
      </header>
      <PerformanceRadar
        v-if="canRenderRadar"
        :dimensions="profile.dimensions"
        primary-label="This match"
        secondary-label="Your recorded average"
        height="clamp(270px, 31vw, 350px)"
      />
      <div v-else class="radar-unavailable">
        <strong>Radar is still building</strong>
        <span>
          This match does not have enough recorded data for a complete radar. Available details
          remain in Breakdown.
        </span>
      </div>
    </div>

    <div class="result-panel">
      <div class="grade-result">
        <GradeBadge :grade="grade" size="lg" />
        <div>
          <span>Recall Grade</span>
          <strong>{{ Math.round(profile.score) }}</strong>
          <small>Recall Score</small>
        </div>
      </div>
      <p class="comparison-context">{{ comparisonContext }}</p>

      <div class="context-grid" aria-label="Grade context">
        <article>
          <span>Similar recorded games</span>
          <strong>{{ ordinal(profile.score) }} percentile</strong>
          <small v-if="referenceMatches">
            {{ referenceMatches }} comparison matches
          </small>
          <small v-else>Position and archetype comparison</small>
        </article>
        <article>
          <span>Recorded Grade average</span>
          <strong>{{ personalScore === undefined ? "—" : Math.round(personalScore) }}</strong>
          <small>{{ personalHint }}</small>
        </article>
        <article>
          <span>Lobby</span>
          <strong>{{ lobbyValue }}</strong>
          <small>{{ lobbyPlace && lobbySize ? "By Recall Grade" : "Complete grades unavailable" }}</small>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.match-rvi-summary {
  display: grid;
  grid-template-columns: minmax(360px, .92fr) minmax(320px, 1.08fr);
  align-items: center;
  gap: clamp(18px, 3vw, 46px);
  min-height: 360px;
  padding: clamp(18px, 2.2vw, 30px);
  background: radial-gradient(circle at 18% 50%, rgba(10, 203, 230, .055), transparent 34%);
}

.radar-panel,
.result-panel { min-width: 0; }
.radar-panel header { margin-bottom: -8px; }
.eyebrow { margin: 0; color: var(--cyan); font-size: var(--ui-text-label); letter-spacing: .1em; text-transform: uppercase; }
h2 { margin: 3px 0 0; color: var(--gold-bright); font: 21px var(--font-display); }

.result-panel {
  display: grid;
  gap: var(--space-3);
  padding: clamp(18px, 2.5vw, 32px);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: linear-gradient(145deg, rgba(11, 25, 44, .82), rgba(5, 14, 27, .76));
}

.grade-result { display: flex; align-items: center; gap: var(--space-3); }
.grade-result > div { display: grid; grid-template-columns: auto auto; align-items: end; gap: 0 9px; }
.grade-result span { grid-column: 1 / -1; color: var(--text-muted); font-size: var(--ui-text-label); letter-spacing: .09em; text-transform: uppercase; }
.grade-result strong { color: var(--gold-bright); font: 35px/1 var(--font-display); }
.grade-result small { padding-bottom: 3px; color: var(--text-muted); font-size: 11px; text-transform: uppercase; }
.comparison-context { margin: 0; color: var(--text-secondary); font: 13px var(--font-heading); }

.context-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); overflow: hidden; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
.context-grid article { display: grid; align-content: start; min-width: 0; gap: 4px; padding: 12px; border-left: 1px solid var(--border-subtle); background: rgba(8, 19, 35, .45); }
.context-grid article:first-child { border-left: 0; }
.context-grid span { color: var(--text-muted); font-size: var(--ui-text-label); letter-spacing: .07em; text-transform: uppercase; }
.context-grid strong { color: var(--text-primary); font-size: 14px; font-variant-numeric: tabular-nums; }
.context-grid small { color: var(--text-muted); font-size: var(--ui-text-label); line-height: 1.4; }

.radar-unavailable { display: grid; gap: 6px; min-height: 245px; align-content: center; padding: var(--space-5); border: 1px dashed var(--border-strong); border-radius: var(--radius-md); color: var(--text-secondary); }
.radar-unavailable strong { color: var(--gold-bright); }
.radar-unavailable span { font-size: 12px; line-height: 1.5; }

@media (max-width: 900px) {
  .match-rvi-summary { grid-template-columns: minmax(0, 1fr); }
}

@media (max-width: 600px) {
  .context-grid { grid-template-columns: minmax(0, 1fr); }
  .context-grid article { border-top: 1px solid var(--border-subtle); border-left: 0; }
  .context-grid article:first-child { border-top: 0; }
}
</style>
