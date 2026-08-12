<script setup lang="ts">
import { computed } from "vue"
import {
  performanceScopeAriaLabel,
  performanceScopeEvidenceLabel,
  performanceScopeLabel,
  performanceScoreLabel,
  rankPerformanceScopes,
} from "../../helpers/rvi-contexts"
import type { PerformanceProfile, PerformanceScopeSummary } from "../../types/stats"

const props = defineProps<{ profile: PerformanceProfile }>()

const FEATURED_ARCHETYPE_COUNT = 4

const positions = computed(() => rankPerformanceScopes(props.profile.scopes.positions))
const archetypes = computed(() => rankPerformanceScopes(props.profile.scopes.primaryArchetypes))
const featuredArchetypes = computed(() => archetypes.value.slice(0, FEATURED_ARCHETYPE_COUNT))
const remainingArchetypes = computed(() => archetypes.value.slice(FEATURED_ARCHETYPE_COUNT))
const hasContexts = computed(() => positions.value.length > 0 || archetypes.value.length > 0)

const rankFor = (items: PerformanceScopeSummary[], scope: PerformanceScopeSummary) =>
  items.findIndex((candidate) => candidate.score === scope.score) + 1

const isTiedBest = (items: PerformanceScopeSummary[], scope: PerformanceScopeSummary) =>
  items.length > 1 && items[0]?.score === items[1]?.score && scope.score === items[0]?.score

const meterStyle = (score: number) => ({
  "--context-score": `${Math.max(0, Math.min(100, score))}%`,
})
</script>

<template>
  <section
    v-if="hasContexts"
    class="context-story"
    aria-labelledby="rvi-context-insights-title"
  >
    <header class="context-head">
      <div>
        <p class="chapter">RVI context</p>
        <h2 id="rvi-context-insights-title">Where your RVI is strongest</h2>
        <p>See which recorded positions and primary archetypes produced your strongest scores. Game counts show where the result is still early.</p>
      </div>
      <span class="scale-note">RVI · 0–100</span>
    </header>

    <div class="context-board">
      <section
        v-if="positions.length"
        class="context-group"
        aria-labelledby="rvi-context-insights-positions"
      >
        <header class="group-head">
          <div>
            <p class="group-kicker">By position</p>
            <h3 id="rvi-context-insights-positions">Positions</h3>
          </div>
          <span>{{ positions.length }} recorded</span>
        </header>

        <ol class="scope-grid position-grid">
          <li v-for="scope in positions" :key="scope.key" class="context-tile">
            <div class="tile-heading">
              <span class="context-rank numeric" aria-hidden="true">#{{ rankFor(positions, scope) }}</span>
              <strong class="context-name">{{ performanceScopeLabel(scope) }}</strong>
              <strong class="context-score numeric" :aria-label="performanceScopeAriaLabel(scope)">
                {{ scope.score }}
              </strong>
            </div>
            <div class="context-meter" :style="meterStyle(scope.score)" aria-hidden="true">
              <span />
            </div>
            <div class="tile-meta">
              <span>{{ performanceScopeEvidenceLabel(scope) }}</span>
              <span class="score-band">{{ performanceScoreLabel(scope.score) }}</span>
            </div>
          </li>
        </ol>
      </section>

      <section
        v-if="archetypes.length"
        class="context-group archetype-group"
        aria-labelledby="rvi-context-insights-archetypes"
      >
        <header class="group-head">
          <div>
            <p class="group-kicker">By archetype</p>
            <h3 id="rvi-context-insights-archetypes">Primary archetypes</h3>
          </div>
          <span>{{ archetypes.length }} recorded</span>
        </header>

        <ol class="scope-grid archetype-grid">
          <li v-for="scope in featuredArchetypes" :key="scope.key" class="context-tile">
            <div class="tile-heading">
              <span class="context-rank numeric" aria-hidden="true">#{{ rankFor(archetypes, scope) }}</span>
              <strong class="context-name">{{ performanceScopeLabel(scope) }}</strong>
              <strong class="context-score numeric" :aria-label="performanceScopeAriaLabel(scope)">
                {{ scope.score }}
              </strong>
            </div>
            <div class="context-meter" :style="meterStyle(scope.score)" aria-hidden="true">
              <span />
            </div>
            <div class="tile-meta">
              <span>{{ performanceScopeEvidenceLabel(scope) }}</span>
              <span v-if="isTiedBest(archetypes, scope)" class="score-band tied">Tied best</span>
              <span v-else class="score-band">{{ performanceScoreLabel(scope.score) }}</span>
            </div>
          </li>
        </ol>

        <details v-if="remainingArchetypes.length" class="more-archetypes">
          <summary>
            <span class="summary-show">Show {{ remainingArchetypes.length }} more archetypes</span>
            <span class="summary-hide">Hide additional archetypes</span>
            <span class="disclosure-icon" aria-hidden="true" />
          </summary>
          <ol class="scope-grid archetype-grid remaining-grid">
            <li v-for="scope in remainingArchetypes" :key="scope.key" class="context-tile">
              <div class="tile-heading">
                <span class="context-rank numeric" aria-hidden="true">#{{ rankFor(archetypes, scope) }}</span>
                <strong class="context-name">{{ performanceScopeLabel(scope) }}</strong>
                <strong class="context-score numeric" :aria-label="performanceScopeAriaLabel(scope)">
                  {{ scope.score }}
                </strong>
              </div>
              <div class="context-meter" :style="meterStyle(scope.score)" aria-hidden="true">
                <span />
              </div>
              <div class="tile-meta">
                <span>{{ performanceScopeEvidenceLabel(scope) }}</span>
                <span class="score-band">{{ performanceScoreLabel(scope.score) }}</span>
              </div>
            </li>
          </ol>
        </details>
      </section>
    </div>
  </section>
</template>

<style scoped>
.context-story {
  display: grid;
  min-width: 0;
  gap: 12px;
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
  container: rvi-context-insights / inline-size;
}

.context-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  min-width: 0;
  gap: var(--space-5);
}

.context-head > div { min-width: 0; }
.chapter { margin: 0 0 5px; color: var(--cyan); font-size: var(--ui-text-label); letter-spacing: .14em; text-transform: uppercase; }
.context-head h2 { margin: 0; color: var(--gold-bright); font: 500 clamp(20px, 2.2cqi, 27px)/1.15 var(--font-display); }
.context-head p:last-child { max-width: 680px; margin: 5px 0 0; color: var(--text-secondary); font-size: var(--ui-text-label); line-height: 1.45; }
.scale-note { flex: 0 0 auto; color: var(--text-muted); font-size: var(--ui-text-label); letter-spacing: .07em; text-transform: uppercase; }

.context-board {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background:
    linear-gradient(145deg, rgba(10, 203, 230, .035), transparent 38%),
    rgba(7, 17, 30, .58);
}

.context-group { min-width: 0; padding: 12px; }
.context-group + .context-group { border-top: 1px solid var(--ui-divider); }

.group-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 9px;
}

.group-head > div { display: flex; align-items: baseline; min-width: 0; gap: 8px; }
.group-kicker { margin: 0; color: var(--cyan); font-size: var(--ui-text-micro); letter-spacing: .09em; text-transform: uppercase; }
.group-head h3 { margin: 0; color: var(--text-primary); font: 600 var(--ui-text-support)/1.25 var(--font-heading); }
.group-head > span { color: var(--text-muted); font-size: var(--ui-text-label); white-space: nowrap; }

.scope-grid {
  display: grid;
  min-width: 0;
  margin: 0;
  padding: 0;
  gap: 8px;
  list-style: none;
}

.position-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.archetype-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }

.context-tile {
  display: grid;
  min-width: 0;
  align-content: start;
  gap: 7px;
  padding: 9px 10px;
  border: 1px solid rgba(200, 170, 109, .18);
  border-radius: calc(var(--ui-radius-md) - 3px);
  background: rgba(9, 22, 39, .74);
}

.context-tile:first-child {
  border-color: rgba(10, 203, 230, .38);
  box-shadow: inset 2px 0 0 rgba(10, 203, 230, .78);
}

.tile-heading {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: baseline;
  min-width: 0;
  gap: 6px;
}

.context-rank { color: var(--text-muted); font-size: var(--ui-text-micro); }
.context-name { min-width: 0; overflow: hidden; color: var(--text-primary); font: 600 var(--ui-text-support)/1.25 var(--font-heading); text-overflow: ellipsis; white-space: nowrap; }
.context-score { color: var(--gold-bright); font: 22px/1 var(--font-display); }

.context-meter { height: 3px; overflow: hidden; border-radius: 999px; background: rgba(99, 119, 143, .2); }
.context-meter span { display: block; width: var(--context-score); height: 100%; border-radius: inherit; background: linear-gradient(90deg, rgba(200, 170, 109, .72), var(--cyan)); }

.tile-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  min-width: 0;
  gap: 6px;
  color: var(--text-muted);
  font-size: var(--ui-text-micro);
  line-height: 1.3;
}

.tile-meta > span:first-child { min-width: 0; overflow-wrap: anywhere; }
.score-band { flex: 0 0 auto; color: var(--text-secondary); letter-spacing: .035em; text-transform: uppercase; white-space: nowrap; }
.score-band.tied { color: var(--cyan); }

.more-archetypes {
  margin-top: 9px;
  border-top: 1px solid var(--ui-divider);
}

.more-archetypes summary {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 35px;
  gap: 9px;
  cursor: pointer;
  color: var(--text-secondary);
  font: 600 var(--ui-text-label)/1.3 var(--font-heading);
  list-style: none;
}

.more-archetypes summary::-webkit-details-marker { display: none; }
.more-archetypes summary:hover { color: var(--gold-bright); }
.more-archetypes summary:focus-visible { outline: 2px solid var(--cyan); outline-offset: -2px; border-radius: 5px; }
.summary-hide { display: none; }
.more-archetypes[open] .summary-show { display: none; }
.more-archetypes[open] .summary-hide { display: inline; }

.disclosure-icon {
  width: 7px;
  height: 7px;
  border-right: 1px solid currentColor;
  border-bottom: 1px solid currentColor;
  transform: translateY(-2px) rotate(45deg);
  transition: transform .16s ease;
}

.more-archetypes[open] .disclosure-icon { transform: translateY(2px) rotate(225deg); }
.remaining-grid { padding-top: 2px; }

@container rvi-context-insights (max-width: 920px) {
  .position-grid,
  .archetype-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@container rvi-context-insights (max-width: 620px) {
  .context-head { display: grid; gap: 6px; }
  .scale-note { justify-self: start; }
  .position-grid,
  .archetype-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@container rvi-context-insights (max-width: 360px) {
  .context-group { padding: 10px; }
  .group-head { align-items: baseline; }
  .group-head > div { display: grid; gap: 1px; }
  .context-tile { gap: 6px; padding: 8px; }
  .tile-heading { gap: 4px; }
  .context-score { font-size: 20px; }
  .tile-meta { display: grid; gap: 3px; }
  .score-band { justify-self: start; }
}

@media (prefers-reduced-motion: reduce) {
  .disclosure-icon { transition: none; }
}
</style>
