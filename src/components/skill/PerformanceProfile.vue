<script setup lang="ts">
import { computed, ref, watch } from "vue"
import PerformanceRadar from "./PerformanceRadar.vue"
import RviMetricList from "./RviMetricList.vue"
import {
  performanceScopeAriaLabel,
  performanceScopeEvidenceLabel,
  performanceScopeLabel as scopeLabel,
  performanceScoreLabel,
  rankPerformanceScopes,
} from "../../helpers/rvi-contexts"
import type {
  PerformanceConfidence,
  PerformanceDimensionScore,
  PerformanceMetricScore,
  PerformanceProfile as PerformanceProfileType,
} from "../../types/stats"

const props = defineProps<{
  profile: PerformanceProfileType
  identity?: { label: string; description: string }
  detailOnly?: boolean
  rviArmDetailsOpen?: boolean
}>()

const emit = defineEmits<{
  "update:rviArmDetailsOpen": [value: boolean]
}>()

const selectedKey = ref(props.profile.strongestKey ?? props.profile.dimensions[0]?.key)
const detailsOpen = ref(props.detailOnly ?? false)
const careerDetailsOpen = computed({
  get: () => props.rviArmDetailsOpen ?? true,
  set: (value: boolean) => emit("update:rviArmDetailsOpen", value),
})

watch(() => props.profile, (profile) => {
  if (!profile.dimensions.some((dimension) => dimension.key === selectedKey.value)) {
    selectedKey.value = profile.strongestKey ?? profile.dimensions[0]?.key
    detailsOpen.value = props.detailOnly ?? false
  }
})

const selected = computed(() =>
  props.profile.dimensions.find((dimension) => dimension.key === selectedKey.value) ??
  props.profile.dimensions[0],
)
const strongest = computed(() =>
  props.profile.dimensions.find((dimension) => dimension.key === props.profile.strongestKey),
)
const growth = computed(() =>
  props.profile.dimensions.find((dimension) => dimension.key === props.profile.growthKey),
)
const measuredDimensions = computed(() =>
  props.profile.dimensions.filter((dimension) => dimension.score !== null),
)
const canRenderRadar = computed(() => measuredDimensions.value.length >= 3)
const metricGroups = computed(() => {
  const metrics = selected.value?.metrics ?? []
  const definitions: Array<{
    key: string
    label: string
    matches: (tier: string) => boolean
  }> = [
    { key: "core", label: "Core measurements", matches: (tier: string) => tier === "CORE" },
    { key: "secondary", label: "Secondary measurements", matches: (tier: string) => tier === "SECONDARY" },
    { key: "diagnostic", label: "Diagnostics", matches: (tier: string) => tier === "DIAGNOSTIC" },
  ]
  const available = metrics.filter((metric) =>
    metric.tier !== "N/A" && metric.evidenceState === "observed" && metric.score !== null)
  const groups = definitions.flatMap((definition) => {
    const rows = available.filter((metric) => definition.matches(metric.tier))
      .sort((left, right) => right.vectorWeight - left.vectorWeight || left.label.localeCompare(right.label))
    return rows.length ? [{ ...definition, rows }] : []
  })
  const unavailable = metrics.filter((metric) =>
    metric.tier === "N/A" || metric.evidenceState !== "observed" || metric.score === null)
    .sort((left, right) => left.label.localeCompare(right.label))
  if (unavailable.length) {
    groups.push({
      key: "unavailable",
      label: "Unavailable or not applicable",
      matches: () => false,
      rows: unavailable,
    })
  }
  return groups
})

const careerMetricGroups = computed(() => {
  const metrics = selected.value?.metrics ?? []
  const observed = metrics.filter((metric) =>
    metric.tier !== "N/A" && metric.evidenceState === "observed" && metric.score !== null)
  const scoring = observed.filter((metric) =>
    (metric.tier === "CORE" || metric.tier === "SECONDARY") && metric.vectorWeight > 0)
    .sort((left, right) => {
      const tierOrder = { CORE: 0, SECONDARY: 1 } as const
      return (tierOrder[left.tier as keyof typeof tierOrder] ?? 2) -
        (tierOrder[right.tier as keyof typeof tierOrder] ?? 2) ||
        right.vectorWeight - left.vectorWeight || left.label.localeCompare(right.label)
    })
  const scoringKeys = new Set(scoring.map((metric) => metric.key))
  const signals = observed.filter((metric) => !scoringKeys.has(metric.key))
    .sort((left, right) => right.vectorWeight - left.vectorWeight || left.label.localeCompare(right.label))
  const unavailable = metrics.filter((metric) =>
    metric.tier === "N/A" || metric.evidenceState !== "observed" || metric.score === null)
    .sort((left, right) => left.label.localeCompare(right.label))

  return [
    { key: "scoring", label: "Used in score", rows: scoring },
    { key: "signals", label: "More signals", rows: signals },
    { key: "unavailable", label: "Unavailable", rows: unavailable },
  ].filter((group) => group.rows.length)
})
const selectedMetricGroupKey = ref("scoring")
const activeCareerMetricGroup = computed(() =>
  careerMetricGroups.value.find((group) => group.key === selectedMetricGroupKey.value) ??
  careerMetricGroups.value[0],
)

watch(careerMetricGroups, (groups) => {
  if (!groups.some((group) => group.key === selectedMetricGroupKey.value)) {
    selectedMetricGroupKey.value = groups[0]?.key ?? "scoring"
  }
}, { immediate: true })

const confidenceLabel = (confidence: PerformanceConfidence | null) => confidence === null
  ? "Not measured"
  : ({
  learning: "Learning",
  provisional: "Provisional",
  established: "Established",
})[confidence]

const deltaLabel = (dimension: PerformanceDimensionScore) => {
  if (dimension.delta === undefined) return "Recent comparison building"
  if (Math.abs(dimension.delta) < 1) return "Recent · steady"
  return `Recent · ${dimension.delta > 0 ? "+" : ""}${dimension.delta} vs career`
}

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

const contextGroups = computed(() => [
  {
    key: "position",
    label: "Positions",
    bestLabel: "Best position",
    items: rankPerformanceScopes(props.profile.scopes.positions),
  },
  {
    key: "primary-archetype",
    label: "Primary archetypes",
    bestLabel: "Best primary archetype",
    items: rankPerformanceScopes(props.profile.scopes.primaryArchetypes),
  },
].filter((group) => group.items.length))

const bestContextGroups = computed(() => contextGroups.value.map((group) => ({
  ...group,
  label: group.bestLabel,
  items: group.items.slice(0, 1),
})))

const hasScopeComparisons = computed(() => contextGroups.value.length > 0)

const gameCountLabel = (games: number) => `${games} ${games === 1 ? "game" : "games"}`

const selectDimension = (key: string) => {
  selectedKey.value = key
  if (props.detailOnly) detailsOpen.value = true
}
</script>

<template>
  <section
    class="dimensions"
    :class="detailOnly ? ['match-profile', 'card'] : 'career-profile'"
    aria-labelledby="rvi-title"
  >
    <template v-if="!detailOnly">
      <header class="rvi-profile-header">
        <div class="rvi-identity">
          <p class="eyebrow">RVI profile</p>
          <div class="rvi-identity-title">
            <h2 id="rvi-title">{{ identity?.label ?? 'Your RVI' }}</h2>
            <span v-if="identity">Performance style</span>
          </div>
          <p>{{ identity?.description ?? 'Your measured strengths across recorded games.' }}</p>
        </div>
        <div class="rvi-overall" aria-label="Career RVI summary">
          <span class="rvi-overall-label">Career RVI</span>
          <div class="rvi-overall-score">
            <strong class="numeric" :aria-label="`Career RVI ${profile.score} out of 100`">
              {{ profile.score }}
            </strong>
            <span>{{ scoreLabel(profile.score) }}</span>
          </div>
          <small>
            {{ confidenceLabel(profile.confidence) }} ·
            <template v-if="profile.headline.source === 'career_arm_mean'">
              {{ profile.headline.availableArms }} of {{ profile.headline.totalArms }} arms ·
            </template>
            {{ gameCountLabel(profile.measuredGames) }}
          </small>
        </div>
      </header>

      <section
        v-if="hasScopeComparisons"
        class="rvi-context"
        aria-labelledby="rvi-context-title"
        aria-describedby="rvi-context-description"
      >
        <header class="rvi-section-heading">
          <h3 id="rvi-context-title">RVI by context</h3>
          <p id="rvi-context-description">Your highest-scoring position and primary archetype in this selection.</p>
        </header>
        <div
          class="rvi-context-groups rvi-context-best"
          :class="{ 'single-group': bestContextGroups.length === 1 }"
        >
          <section
            v-for="group in bestContextGroups"
            :key="group.key"
            class="rvi-context-group"
            :aria-labelledby="`rvi-context-best-${group.key}`"
          >
            <h4 :id="`rvi-context-best-${group.key}`">{{ group.label }}</h4>
            <ul role="list">
              <li v-for="scope in group.items" :key="`${group.key}:${scope.key}`">
                <strong class="rvi-context-name">{{ scopeLabel(scope) }}</strong>
                <span class="rvi-context-score">
                  <strong class="numeric" :aria-label="performanceScopeAriaLabel(scope)">
                    {{ scope.score }}
                  </strong>
                  <small>{{ performanceScoreLabel(scope.score) }}</small>
                </span>
                <small class="rvi-context-meta">{{ performanceScopeEvidenceLabel(scope) }}</small>
              </li>
            </ul>
          </section>
        </div>
      </section>

      <section class="rvi-stage" aria-labelledby="rvi-shape-title">
        <div class="rvi-radar-panel">
          <header class="rvi-section-heading">
            <h3 id="rvi-shape-title">Profile shape</h3>
            <p>Career profile and your most recent {{ profile.recentGames }} measured games.</p>
          </header>
          <PerformanceRadar
            v-if="canRenderRadar"
            class="profile-radar"
            :dimensions="profile.dimensions"
            primary-label="Career profile"
            secondary-label="Recent form"
            height="clamp(250px, 27cqi, 330px)"
          />
          <div v-else class="partial-radar-note">
            <strong>Radar is still building</strong>
            <p>More recorded games are needed for a complete radar. Available arms remain selectable.</p>
          </div>
        </div>

        <div class="rvi-highlights" aria-label="RVI profile highlights">
          <article v-if="strongest" class="rvi-signal">
            <div>
              <span class="rvi-signal-label">Strongest arm</span>
              <h3>{{ strongest.label }}</h3>
              <p>{{ strongest.description }}</p>
            </div>
            <div class="rvi-signal-value">
              <strong class="numeric" :aria-label="`${strongest.label} score ${strongest.score} out of 100`">
                {{ strongest.score }}
              </strong>
              <small>{{ scoreLabel(strongest.score) }}</small>
            </div>
          </article>
          <article class="rvi-signal">
            <div>
              <span class="rvi-signal-label">Largest recent gain</span>
              <template v-if="growth">
                <h3>{{ growth.label }}</h3>
                <p>Recent measured games compared with your full career profile.</p>
              </template>
              <template v-else>
                <h3>No clear recent gain</h3>
                <p>Recent arm scores are level with or below your full profile.</p>
              </template>
            </div>
            <div class="rvi-signal-value">
              <strong
                v-if="growth"
                class="numeric positive"
                :aria-label="`Recent movement plus ${growth.delta}`"
              >
                +{{ growth.delta }}
              </strong>
              <strong v-else class="numeric" aria-label="No recent gain">—</strong>
              <small>{{ growth ? 'vs career' : 'Recent form' }}</small>
            </div>
          </article>
          <p class="rvi-reference"><span>Reference</span>{{ profile.comparison }}.</p>
        </div>
      </section>

      <section class="rvi-arms" aria-labelledby="rvi-arms-title">
        <header class="rvi-section-heading">
          <h3 id="rvi-arms-title">Performance arms</h3>
          <p>Select an arm to view its measurements.</p>
        </header>
        <div class="career-arm-grid" role="group" aria-labelledby="rvi-arms-title">
          <button
            v-for="dimension in profile.dimensions"
            :key="dimension.key"
            type="button"
            class="career-arm"
            :class="{ selected: selected?.key === dimension.key }"
            :aria-pressed="selected?.key === dimension.key"
            aria-controls="career-arm-details"
            @click="selectDimension(dimension.key)"
          >
            <span class="career-arm-name">
              <strong>{{ dimension.label }}</strong>
              <small v-if="dimension.careerOnly">
                Career only · {{ dimension.games >= 20 ? gameCountLabel(dimension.games) : `${Math.max(0, 20 - dimension.games)} more games needed` }}
              </small>
              <small v-else-if="dimension.headlineEligible">
                {{ confidenceLabel(dimension.confidence) }} · {{ dimension.games }}/{{ dimension.eligibleGames }} games ·
                {{ Math.round(dimension.responsibilityWeight * 100) }}% Grade share
              </small>
              <small v-else>Additional context only</small>
            </span>
            <span class="career-arm-result">
              <strong class="numeric" :aria-label="`${dimension.label} score ${dimension.score ?? 'unavailable'} out of 100`">
                {{ dimension.score ?? '—' }}
              </strong>
              <small>{{ scoreLabel(dimension.score) }}</small>
            </span>
            <span
              class="career-arm-trend"
              :class="{ positive: (dimension.delta ?? 0) > 0, negative: (dimension.delta ?? 0) < 0 }"
            >
              {{ deltaLabel(dimension) }}
            </span>
          </button>
        </div>

        <button
          v-if="selected"
          type="button"
          class="career-inspector-toggle"
          :aria-expanded="careerDetailsOpen"
          aria-controls="career-arm-details"
          @click="careerDetailsOpen = !careerDetailsOpen"
        >
          <span><strong>{{ selected.label }}</strong> measurements</span>
          <span class="inspector-toggle-action">
            <span>{{ careerDetailsOpen ? 'Hide details' : 'Show details' }}</span>
            <span class="inspector-chevron" :class="{ open: careerDetailsOpen }" aria-hidden="true">
              <svg viewBox="0 0 20 20" focusable="false"><path d="m5 7.5 5 5 5-5" /></svg>
            </span>
          </span>
        </button>

        <section
          v-if="selected"
          v-show="careerDetailsOpen"
          id="career-arm-details"
          class="career-inspector"
          :aria-labelledby="`career-arm-${selected.key}`"
        >
          <header class="inspector-head">
            <div>
              <p class="eyebrow">Selected arm</p>
              <h3 :id="`career-arm-${selected.key}`">{{ selected.label }} measurements</h3>
              <p>{{ selected.description }}</p>
            </div>
          </header>

        <template v-if="careerMetricGroups.length">
          <div class="metric-group-picker" role="group" aria-label="Measurement groups">
            <button
              v-for="group in careerMetricGroups"
              :key="group.key"
              type="button"
              :class="{ selected: activeCareerMetricGroup?.key === group.key }"
              :aria-pressed="activeCareerMetricGroup?.key === group.key"
              :aria-controls="`career-metrics-${selected.key}`"
              @click="selectedMetricGroupKey = group.key"
            >
              {{ group.label }} <span class="numeric">{{ group.rows.length }}</span>
            </button>
          </div>
          <RviMetricList
            v-if="activeCareerMetricGroup"
            :key="`${selected.key}:${activeCareerMetricGroup.key}`"
            :id="`career-metrics-${selected.key}`"
            role="region"
            :aria-label="`${selected.label}: ${activeCareerMetricGroup.label}`"
            :metrics="activeCareerMetricGroup.rows"
            :scoring-context="profile.scoringContext"
          />
        </template>
        <p v-else-if="selected.careerOnly" class="no-measurements">
          Range unlocks after 20 graded games. It rewards steady results and breadth across
          champions, archetypes, and positions. ARAM and Mayhem do not use positions.
        </p>
        <p v-else class="no-measurements">
          No measurements were retained for this arm in the selected recipe.
        </p>

        <details class="method-detail">
          <summary>How scoring works</summary>
          <p>
            Grades compare each game with similar games in your saved history. Career RVI averages
            the arms with enough data. Missing optional stats do not lower your score.
          </p>
        </details>
        </section>
      </section>
    </template>

    <template v-else>
      <header class="detail-only-head">
        <div>
          <p class="eyebrow">Match RVI evidence</p>
          <h2 id="rvi-title">Arm breakdown</h2>
          <p class="intro">Select an arm to see the measurements behind this match.</p>
        </div>
      </header>

      <div class="dimension-grid" aria-label="RVI performance arms">
        <button
          v-for="dimension in profile.dimensions"
          :key="dimension.key"
          type="button"
          class="dimension-card"
          :class="{ selected: selected?.key === dimension.key }"
          :aria-pressed="selected?.key === dimension.key"
          @click="selectDimension(dimension.key)"
        >
          <span class="dimension-mark" aria-hidden="true">{{ dimension.shortLabel.slice(0, 2) }}</span>
          <span class="dimension-copy">
            <strong>{{ dimension.label }}</strong>
            <small v-if="dimension.careerOnly">
              Career only · {{ dimension.games >= 20 ? `${dimension.games} measured games` : `${Math.max(0, 20 - dimension.games)} more games needed` }}
            </small>
            <small v-else-if="dimension.headlineEligible">
              {{ confidenceLabel(dimension.confidence) }} · {{ dimension.games }}/{{ dimension.eligibleGames }} games ·
              {{ Math.round(dimension.responsibilityWeight * 100) }}% average Grade share
            </small>
            <small v-else>Shown for detail only</small>
          </span>
          <span class="dimension-result">
            <strong class="dimension-score numeric">{{ dimension.score ?? '—' }}</strong>
            <small>{{ scoreLabel(dimension.score) }}</small>
          </span>
        </button>
      </div>

      <section v-if="selected" class="dimension-detail">
        <button
          type="button"
          class="detail-toggle"
          :aria-expanded="detailsOpen"
          :aria-controls="`dimension-${selected.key}`"
          @click="detailsOpen = !detailsOpen"
        >
          <span class="toggle-copy">
            <small>How RVI measures it</small>
            <strong>{{ selected.label }}</strong>
          </span>
          <span class="toggle-score">
            <strong class="numeric">{{ selected.score ?? '—' }}</strong>
            <small>arm score</small>
          </span>
          <span class="toggle-action">
            <span>{{ detailsOpen ? "Hide measurements" : "Show measurements" }}</span>
            <span class="toggle-chevron" :class="{ open: detailsOpen }" aria-hidden="true">
              <svg viewBox="0 0 20 20" focusable="false"><path d="m5 7.5 5 5 5-5" /></svg>
            </span>
          </span>
        </button>

        <div v-if="detailsOpen" :id="`dimension-${selected.key}`" class="detail-body">
          <p class="detail-description">{{ selected.description }}</p>
          <p class="responsibility-note">
            <template v-if="selected.careerOnly">
              Range summarizes your overall history. It does not affect any single match Grade.
            </template>
            <template v-else-if="selected.headlineEligible">
              Average share of the Grade:
              <strong>{{ Math.round(selected.responsibilityWeight * 100) }}%</strong>.
            </template>
            <template v-else>
              Shown for detail only. This arm did not affect the selected games' Grades.
            </template>
          </p>
          <div v-if="metricGroups.length" class="measurement-groups">
            <section v-for="group in metricGroups" :key="group.key" class="measurement-group">
              <h3>{{ group.label }}</h3>
              <div class="measurement-table">
                <div class="measurement-labels" aria-hidden="true">
                  <span>Measurement</span>
                  <span>Score</span>
                  <span>Influence</span>
                </div>
                <article v-for="metric in group.rows" :key="metric.key" class="measurement-row">
                  <div class="measurement-copy">
                    <div class="measurement-title">
                      <strong>{{ metric.label }}</strong>
                      <span class="evidence-badge" :data-state="metric.evidenceState">
                        {{ evidenceLabel(metric) }}
                      </span>
                    </div>
                    <p>{{ metric.description }}</p>
                    <small>
                      {{ metricRawLabel(metric) }} ·
                      {{ metric.games }}/{{ metric.eligibleGames }} games measured ·
                      {{ metric.coverage === null ? 'N/A' : `${Math.round(metric.coverage * 100)}%` }} coverage
                    </small>
                    <small>
                      {{ metric.comparison }}<template v-if="metric.referenceMatchCount !== undefined">
                        · {{ metric.referenceMatchCount }} reference matches
                      </template>
                    </small>
                    <details class="formula-detail">
                      <summary>Formula and evidence</summary>
                      <span>{{ metric.formula }}</span>
                    </details>
                  </div>
                  <div class="measurement-score">
                    <div
                      class="segment-meter"
                      role="img"
                      :aria-label="metric.score === null ? 'Calibrated score unavailable' : `${metric.score} out of 100`"
                    >
                      <i
                        v-for="segment in 10"
                        :key="segment"
                        :class="{ filled: metric.score !== null && metric.score >= segment * 10 - 5 }"
                        aria-hidden="true"
                      />
                    </div>
                    <strong class="numeric">{{ metric.score ?? '—' }}</strong>
                    <small>{{ scoreLabel(metric.score) }}</small>
                  </div>
                  <div class="measurement-influence">
                    <strong v-if="metric.vectorWeight > 0" class="numeric">
                      {{ Math.round(metric.vectorWeight * 100) }}% arm weight
                    </strong>
                    <strong v-else>Diagnostic</strong>
                    <small v-if="metric.gradeInfluence > 0">
                      {{ Math.round(metric.gradeInfluence * 100) }}%
                      {{ profile.scoringContext === 'match' ? "of this match's Grade mix" : 'average Grade influence' }}
                    </small>
                    <small v-else-if="metric.vectorWeight > 0">
                      Included in this arm, but it had no Grade influence here
                    </small>
                    <small v-else>Shown for detail only</small>
                  </div>
                </article>
              </div>
            </section>
          </div>
          <p v-else-if="selected.careerOnly" class="no-measurements">
            Range unlocks after 20 graded games. It rewards steady results and strong play across
            different champions, playstyles, and positions. ARAM and Mayhem do not use positions.
          </p>
          <p v-else class="no-measurements">
            No metric observations were retained for this arm in the selected recipe.
          </p>
          <p class="method-note">
            Your match Grade compares this performance with similar games in your saved history.
            Career RVI averages the areas with enough data. Missing optional stats never count as zero.
          </p>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.dimensions {
  min-width: 0;
  padding: clamp(var(--space-4), 2.2%, var(--space-5));
  overflow: hidden;
  container: rvi-profile / inline-size;
}

.eyebrow {
  margin: 0 0 var(--space-1);
  color: var(--cyan);
  font-size: var(--ui-text-label);
  letter-spacing: .14em;
  text-transform: uppercase;
}

.intro,
.comparison-note,
.detail-description,
.method-note {
  color: var(--text-secondary);
  font-size: var(--ui-text-support);
  line-height: 1.55;
}

.intro {
  max-width: 700px;
  margin: var(--space-2) 0 0;
}

.metric-group-picker button:focus-visible { outline: 2px solid var(--cyan); outline-offset: 1px; }

.career-inspector-toggle {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  width: 100%;
  min-width: 0;
  gap: var(--space-3);
  margin-top: var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: rgba(8, 19, 35, .52);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}
.career-inspector-toggle:hover,
.career-inspector-toggle[aria-expanded="true"] {
  border-color: rgba(10, 203, 230, .38);
  background: rgba(10, 203, 230, .055);
}
.career-inspector-toggle:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.inspector-toggle-action { display: flex; align-items: center; flex: 0 0 auto; gap: var(--space-2); color: var(--text-secondary); font-size: var(--ui-text-label); font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.inspector-chevron {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  color: var(--gold-bright);
  background: var(--surface-2);
  transition: transform 160ms ease, color 160ms ease, border-color 160ms ease;
}
.inspector-chevron svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.inspector-chevron.open { border-color: rgba(10, 203, 230, .55); color: var(--cyan); transform: rotate(180deg); }

.career-inspector {
  min-width: 0;
  margin-top: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: rgba(8, 19, 35, .42);
}
.inspector-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
.inspector-head > div:first-child { min-width: 0; }
.inspector-head h3 { margin: 0; color: var(--gold-bright); font: 500 20px var(--font-display); }
.inspector-head p:last-child { max-width: 720px; margin: 4px 0 0; color: var(--text-secondary); font-size: var(--ui-text-support); line-height: 1.5; }
.metric-group-picker { display: flex; min-width: 0; gap: 5px; margin: var(--space-3) 0 7px; overflow-x: auto; }
.metric-group-picker button {
  flex: 0 0 auto;
  padding: 6px 9px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  background: rgba(2, 10, 19, .25);
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  cursor: pointer;
}
.metric-group-picker button.selected { border-color: rgba(10, 203, 230, .45); background: rgba(10, 203, 230, .08); color: var(--cyan); }
.metric-group-picker .numeric { margin-left: 3px; color: var(--text-primary); }
.method-detail { margin-top: var(--space-3); color: var(--text-muted); font-size: var(--ui-text-label); }
.method-detail summary {
  display: flex;
  align-items: center;
  width: max-content;
  min-height: 36px;
  padding-inline: 2px;
  color: var(--cyan);
  cursor: pointer;
}
.method-detail summary:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; border-radius: var(--radius-sm); }
.method-detail p { max-width: 760px; margin: 5px 0 0; line-height: 1.5; }

.positive { color: var(--win) !important; }
.negative { color: var(--loss) !important; }

.partial-radar-note {
  display: grid;
  align-content: center;
  min-height: 250px;
  padding: var(--space-5);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  background: rgba(8, 19, 35, .4);
}

.detail-only-head {
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}

.detail-only-head h2 {
  margin: 0;
  color: var(--gold-bright);
  font-family: var(--font-display);
  font-size: clamp(18px, 1.8vw, 23px);
  font-weight: 500;
}

.partial-radar-note strong { color: var(--gold-bright); font-family: var(--font-heading); }
.partial-radar-note p { margin: var(--space-2) 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }

.dimension-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-2);
}

.dimension-card {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) minmax(76px, max-content);
  align-items: center;
  min-width: 0;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-1);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.dimension-card:hover,
.dimension-card.selected {
  border-color: var(--border-strong);
  background: var(--surface-2);
}

.dimension-card.selected { box-shadow: inset 2px 0 var(--cyan); }
.dimension-card:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }

.dimension-mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--gold-dim);
  border-radius: 50% 50% 42% 42%;
  color: var(--gold);
  font-family: var(--font-display);
  font-size: 12px;
  text-transform: uppercase;
}

.dimension-copy { display: grid; min-width: 0; }
.dimension-copy strong { color: var(--text-primary); font-family: var(--font-heading); font-size: var(--ui-text-support); overflow-wrap: break-word; }
.dimension-copy small { color: var(--text-muted); font-size: var(--ui-text-label); line-height: 1.45; }
.dimension-result {
  display: grid;
  justify-items: end;
  justify-self: end;
  width: auto;
  min-width: 76px;
}
.dimension-score { color: var(--gold-bright); font-size: 20px; line-height: 1; }
.dimension-result small {
  max-width: 100%;
  margin-top: 3px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  letter-spacing: .03em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.dimension-detail {
  margin-top: var(--space-4);
}

.detail-toggle {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  width: 100%;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: rgba(8, 19, 35, .52);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.detail-toggle:hover,
.detail-toggle[aria-expanded="true"] {
  border-color: rgba(10, 203, 230, .38);
  background: rgba(10, 203, 230, .055);
}
.detail-toggle:hover .toggle-copy strong { color: var(--cyan); }
.toggle-copy,
.toggle-score { display: grid; }
.toggle-copy small { color: var(--cyan); font-size: var(--ui-text-label); letter-spacing: .09em; text-transform: uppercase; }
.toggle-copy strong { margin-top: 2px; color: var(--gold-bright); font-family: var(--font-display); font-size: 17px; font-weight: 500; }
.toggle-score { justify-items: end; }
.toggle-score strong { color: var(--gold-bright); font-size: 20px; line-height: 1; }
.toggle-score small { margin-top: 3px; color: var(--text-muted); font-size: var(--ui-text-label); }
.toggle-action { display: flex; align-items: center; gap: var(--space-2); color: var(--text-secondary); font-size: var(--ui-text-label); font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.toggle-chevron { display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid var(--border-strong); border-radius: 50%; color: var(--gold-bright); background: var(--surface-2); transform: rotate(0); transition: transform 160ms ease, color 160ms ease, border-color 160ms ease; }
.toggle-chevron svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.toggle-chevron.open { border-color: rgba(10, 203, 230, .55); color: var(--cyan); transform: rotate(180deg); }
.detail-body { padding-top: var(--space-3); }
.detail-description { max-width: 700px; margin: 0; }
.responsibility-note { margin: var(--space-2) 0 0; color: var(--text-muted); font-size: var(--ui-text-support); }
.responsibility-note strong { color: var(--cyan); }

.measurement-groups { display: grid; gap: var(--space-4); margin-top: var(--space-4); }
.measurement-group { min-width: 0; }
.measurement-group h3 {
  margin: 0 0 7px;
  color: var(--cyan);
  font-size: var(--ui-text-label);
  letter-spacing: .11em;
  text-transform: uppercase;
}
.measurement-table {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: rgba(8, 19, 35, .4);
}

.measurement-labels,
.measurement-row {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(180px, .65fr) 84px;
  align-items: center;
  gap: var(--space-4);
}

.measurement-labels {
  padding: 8px var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  background: rgba(10, 203, 230, .035);
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  letter-spacing: .1em;
  text-transform: uppercase;
}

.measurement-labels span:nth-child(n + 2) { text-align: right; }

.measurement-row {
  min-width: 0;
  padding: var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}

.measurement-row:last-child { border-bottom: 0; }
.measurement-row:hover { background: rgba(10, 203, 230, .025); }
.measurement-copy { display: grid; min-width: 0; }
.measurement-title { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
.measurement-copy strong { color: var(--text-primary); font-family: var(--font-heading); font-size: 12px; }
.measurement-copy p { margin: 3px 0; color: var(--text-secondary); font-size: var(--ui-text-support); line-height: 1.45; }
.measurement-copy small { color: var(--text-muted); font-size: var(--ui-text-label); }
.evidence-badge {
  padding: 2px 5px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: var(--ui-text-micro);
  letter-spacing: .06em;
  text-transform: uppercase;
}
.evidence-badge[data-state="observed"] { border-color: rgba(10, 203, 230, .28); color: var(--cyan); }
.evidence-badge[data-state="invalid"] { border-color: rgba(239, 92, 105, .35); color: var(--loss); }
.formula-detail { margin-top: 5px; color: var(--text-muted); font-size: var(--ui-text-label); }
.formula-detail summary { width: max-content; color: var(--cyan); cursor: pointer; }
.formula-detail span { display: block; margin-top: 3px; line-height: 1.45; }
.no-measurements { margin: var(--space-3) 0 0; color: var(--text-muted); font-size: var(--ui-text-support); }

.measurement-score {
  display: grid;
  grid-template-columns: minmax(100px, 1fr) 28px;
  align-items: center;
  min-width: 0;
  gap: var(--space-2);
}

.measurement-score > strong { color: var(--gold-bright); font-size: 13px; text-align: right; }
.measurement-score > small { grid-column: 1 / -1; color: var(--text-muted); font-size: var(--ui-text-label); text-align: right; text-transform: uppercase; }

.segment-meter {
  display: grid;
  grid-template-columns: repeat(10, minmax(3px, 1fr));
  gap: 3px;
  min-width: 0;
}

.segment-meter i {
  display: block;
  height: 8px;
  border: 1px solid rgba(160, 170, 186, .13);
  border-radius: 2px;
  background: rgba(76, 87, 105, .18);
}

.segment-meter i.filled {
  border-color: rgba(100, 231, 247, .72);
  background: linear-gradient(180deg, #46ddef, #0796ac);
  box-shadow: 0 0 5px rgba(10, 203, 230, .25);
}

.measurement-influence { display: grid; justify-items: end; }
.measurement-influence strong { color: var(--cyan); font-size: 14px; }
.measurement-influence small { color: var(--text-muted); font-size: var(--ui-text-label); text-align: right; }
.method-note { margin: var(--space-3) 0 0; }

/* Career overview: one instrument panel with internal hierarchy, not nested cards. */
.career-profile {
  display: grid;
  gap: 16px;
  padding: 0;
  overflow: visible;
  border: 0;
  background: none;
  box-shadow: none;
}

.rvi-profile-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  min-width: 0;
  gap: 18px;
  padding: 4px 4px 16px;
  border-bottom: 1px solid var(--ui-divider);
}

.rvi-identity,
.rvi-identity-title {
  min-width: 0;
}

.rvi-identity-title {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px 12px;
}

.rvi-identity-title h2 {
  margin: 0;
  color: var(--gold-bright);
  font: 500 clamp(25px, 2.5cqi, 34px)/1.05 var(--font-display);
  letter-spacing: -.015em;
}

.rvi-identity-title span,
.rvi-overall-label,
.rvi-signal-label {
  color: var(--cyan);
  font-size: var(--ui-text-label);
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.rvi-identity > p:last-child {
  max-width: 68ch;
  margin: 7px 0 0;
  color: var(--text-secondary);
  font-size: var(--ui-text-support);
  line-height: 1.5;
}

.rvi-overall {
  display: grid;
  justify-items: end;
  min-width: 210px;
  padding: 2px 0 2px 20px;
  border-left: 1px solid var(--ui-border);
}

.rvi-overall-score {
  display: flex;
  align-items: baseline;
  gap: 9px;
  margin-top: 2px;
}

.rvi-overall-score strong {
  color: var(--gold-bright);
  font: 42px/1 var(--font-display);
  letter-spacing: -.025em;
}

.rvi-overall-score span {
  color: var(--text-secondary);
  font-size: var(--ui-text-label);
  letter-spacing: .05em;
  text-transform: uppercase;
}

.rvi-overall > small {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  line-height: 1.35;
  text-align: right;
}

.rvi-section-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  min-width: 0;
  gap: 8px 16px;
}

.rvi-section-heading h3 {
  flex: 0 0 auto;
  margin: 0;
  color: var(--gold-bright);
  font: 600 var(--ui-text-body)/1.2 var(--font-heading);
  letter-spacing: .01em;
}

.rvi-section-heading p {
  min-width: 0;
  margin: 0;
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  line-height: 1.4;
  text-align: right;
}

.rvi-stage {
  display: grid;
  grid-template-columns: minmax(300px, .94fr) minmax(320px, 1.06fr);
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: rgba(6, 15, 27, .48);
}

.rvi-radar-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  align-content: start;
  min-width: 0;
  padding: 14px 16px 8px;
}

.rvi-radar-panel .profile-radar {
  align-self: center;
  min-width: 0;
}

.rvi-highlights {
  display: grid;
  grid-template-rows: repeat(2, minmax(0, 1fr)) auto;
  min-width: 0;
  border-left: 1px solid var(--ui-divider);
  background: rgba(9, 21, 37, .46);
}

.rvi-signal {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  min-width: 0;
  gap: 14px;
  padding: 16px 18px;
}

.rvi-signal + .rvi-signal {
  border-top: 1px solid var(--ui-divider);
}

.rvi-signal > div:first-child {
  min-width: 0;
}

.rvi-signal h3 {
  margin: 4px 0 0;
  color: var(--text-primary);
  font: 500 18px/1.2 var(--font-heading);
}

.rvi-signal p {
  max-width: 54ch;
  margin: 7px 0 0;
  color: var(--text-secondary);
  font-size: var(--ui-text-support);
  line-height: 1.45;
}

.rvi-signal-value {
  display: grid;
  justify-items: end;
  min-width: 68px;
}

.rvi-signal-value strong {
  color: var(--gold-bright);
  font: 30px/1 var(--font-display);
  letter-spacing: -.015em;
}

.rvi-signal-value small {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  letter-spacing: .04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.rvi-reference {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 5px 8px;
  margin: 0;
  padding: 10px 18px;
  border-top: 1px solid var(--ui-divider);
  background: rgba(2, 9, 17, .22);
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  line-height: 1.4;
}

.rvi-reference span {
  color: var(--gold);
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.rvi-context,
.rvi-arms {
  display: grid;
  min-width: 0;
  gap: 8px;
}

.rvi-context-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: stretch;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: rgba(6, 15, 27, .42);
}

.rvi-context-groups.single-group {
  grid-template-columns: minmax(0, 1fr);
}

.rvi-context-group {
  display: grid;
  grid-template-rows: auto 1fr;
  align-content: start;
  min-width: 0;
  padding: 10px 12px 8px;
}

.rvi-context-group + .rvi-context-group {
  border-left: 1px solid var(--ui-divider);
}

.rvi-context-group > h4 {
  margin: 0 0 4px;
  color: var(--text-secondary);
  font-size: var(--ui-text-label);
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.rvi-context-group ul {
  display: grid;
  grid-auto-rows: 1fr;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.rvi-context-group li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    "name score"
    "meta score";
  align-items: center;
  min-width: 0;
  gap: 2px 12px;
  padding: 8px 2px;
}

.rvi-context-group li + li {
  border-top: 1px solid var(--ui-divider);
}

.rvi-context-name {
  grid-area: name;
  min-width: 0;
  color: var(--text-primary);
  font: 600 var(--ui-text-support)/1.3 var(--font-heading);
  overflow-wrap: break-word;
}

.rvi-context-score {
  display: grid;
  grid-area: score;
  justify-items: end;
  min-width: 62px;
}

.rvi-context-score strong {
  color: var(--gold-bright);
  font: 24px/1 var(--font-display);
}

.rvi-context-score small {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  letter-spacing: .03em;
  text-transform: uppercase;
  white-space: nowrap;
}

.rvi-context-meta {
  grid-area: meta;
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  line-height: 1.35;
  overflow-wrap: break-word;
}

.career-arm-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-auto-rows: 1fr;
  min-width: 0;
  gap: 1px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-divider);
}

.career-arm {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(64px, auto);
  grid-template-areas:
    "name result"
    "trend trend";
  align-content: start;
  min-width: 0;
  height: 100%;
  min-height: 94px;
  gap: 8px 10px;
  padding: 11px 12px 9px;
  border: 0;
  border-radius: 0;
  background: #0b182a;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  transition: background-color 140ms ease, box-shadow 140ms ease;
}

.career-arm:hover {
  background: #10223a;
}

.career-arm.selected {
  background: linear-gradient(90deg, rgba(10, 203, 230, .09), #102039 58%);
  box-shadow: inset 3px 0 var(--cyan);
}

.career-arm:focus-visible {
  position: relative;
  z-index: 1;
  outline: 2px solid var(--cyan);
  outline-offset: -3px;
}

.career-arm-name {
  display: grid;
  grid-area: name;
  min-width: 0;
  align-content: start;
}

.career-arm-name strong {
  color: var(--gold-bright);
  font: 600 var(--ui-text-body)/1.25 var(--font-heading);
}

.career-arm-name small {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  line-height: 1.35;
  overflow-wrap: break-word;
}

.career-arm-result {
  display: grid;
  grid-area: result;
  justify-items: end;
  min-width: 64px;
}

.career-arm-result strong {
  color: var(--gold-bright);
  font: 25px/1 var(--font-display);
}

.career-arm-result small {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  letter-spacing: .03em;
  text-transform: uppercase;
  white-space: nowrap;
}

.career-arm-trend {
  grid-area: trend;
  align-self: end;
  padding-top: 6px;
  border-top: 1px solid var(--ui-divider);
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  line-height: 1.3;
}

.career-profile .career-inspector-toggle {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  min-height: 54px;
  gap: 12px;
  margin-top: 0;
  padding: 9px 12px 9px 14px;
  border-color: var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: rgba(7, 17, 30, .62);
  box-shadow: none;
}

.career-profile .career-inspector-toggle::before {
  display: none;
}

.career-profile .career-inspector-toggle:hover {
  border-color: color-mix(in srgb, var(--cyan) 38%, var(--ui-border));
  background: rgba(10, 203, 230, .035);
}

.career-profile .career-inspector-toggle > span:first-child {
  min-width: 0;
  color: var(--text-secondary);
  font-size: var(--ui-text-support);
  overflow-wrap: break-word;
}

.career-profile .career-inspector-toggle > span:first-child strong {
  color: var(--gold-bright);
  font-family: var(--font-heading);
}

.career-profile .inspector-toggle-action {
  align-self: center;
  font-size: var(--ui-text-label);
  white-space: nowrap;
}

.career-profile .inspector-chevron {
  width: 30px;
  height: 30px;
  background: var(--ui-surface-inset);
  box-shadow: none;
}

.career-profile .career-inspector-toggle[aria-expanded="true"] {
  border-color: color-mix(in srgb, var(--cyan) 40%, var(--ui-border));
  border-radius: var(--ui-radius-md) var(--ui-radius-md) 0 0;
  background: rgba(10, 203, 230, .045);
}

.career-profile .career-inspector {
  margin-top: -9px;
  padding: 14px 16px 16px;
  border-color: color-mix(in srgb, var(--cyan) 28%, var(--ui-border));
  border-radius: 0 0 var(--ui-radius-md) var(--ui-radius-md);
  background: rgba(7, 17, 30, .56);
  box-shadow: none;
}

.career-profile .inspector-head {
  padding-bottom: 10px;
  border-bottom: 1px solid var(--ui-divider);
}

.career-profile .inspector-head h3 {
  font-size: 19px;
}

.career-profile .metric-group-picker {
  flex-wrap: wrap;
  margin-top: 12px;
  overflow: visible;
}

.career-profile .metric-group-picker button {
  min-height: 36px;
  padding: 6px 10px;
  background: rgba(3, 11, 21, .32);
}

.career-profile .method-detail summary {
  width: fit-content;
  max-width: 100%;
  overflow-wrap: anywhere;
}

@container rvi-profile (max-width: 1199px) {
  .career-arm-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container rvi-profile (max-width: 900px) {
  .rvi-stage {
    grid-template-columns: minmax(0, 1fr);
  }

  .rvi-highlights {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: auto auto;
    border-top: 1px solid var(--ui-divider);
    border-left: 0;
  }

  .rvi-signal + .rvi-signal {
    border-top: 0;
    border-left: 1px solid var(--ui-divider);
  }

  .rvi-reference {
    grid-column: 1 / -1;
  }
}

@container rvi-profile (max-width: 620px) {
  .career-profile {
    gap: 14px;
  }

  .rvi-profile-header {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    padding-inline: 2px;
  }

  .rvi-overall {
    grid-template-columns: auto auto minmax(0, 1fr);
    align-items: baseline;
    justify-items: start;
    width: 100%;
    min-width: 0;
    gap: 8px 12px;
    padding: 11px 0 0;
    border-top: 1px solid var(--ui-divider);
    border-left: 0;
  }

  .rvi-overall-score {
    margin: 0;
  }

  .rvi-overall-score strong {
    font-size: 34px;
  }

  .rvi-overall > small {
    justify-self: end;
    margin: 0;
  }

  .rvi-context-groups {
    grid-template-columns: minmax(0, 1fr);
  }

  .rvi-context-group + .rvi-context-group {
    border-top: 1px solid var(--ui-divider);
    border-left: 0;
  }

  .career-arm-grid {
    grid-template-columns: minmax(0, 1fr);
    grid-auto-rows: auto;
  }

  .career-arm {
    min-height: 82px;
  }
}

@container rvi-profile (max-width: 520px) {
  .rvi-highlights {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto;
  }

  .rvi-signal + .rvi-signal {
    border-top: 1px solid var(--ui-divider);
    border-left: 0;
  }

  .rvi-reference {
    grid-column: 1;
  }

  .rvi-section-heading {
    display: grid;
    justify-content: stretch;
  }

  .rvi-section-heading p {
    text-align: left;
  }
}

@container rvi-profile (max-width: 400px) {
  .rvi-overall {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .rvi-overall-label {
    grid-column: 1 / -1;
  }

  .rvi-radar-panel,
  .rvi-signal,
  .career-profile .career-inspector {
    padding-inline: 12px;
  }

  .rvi-context-group {
    padding-inline: 10px;
  }

  .career-profile .career-inspector-toggle {
    padding-inline: 11px;
  }

}

@media (prefers-reduced-motion: reduce) {
  .career-arm,
  .career-profile .career-inspector-toggle,
  .career-profile .metric-group-picker button {
    transition: none;
  }
}

@media (max-width: 1100px) {
  .match-profile .dimension-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 900px) {
  .measurement-labels,
  .measurement-row { grid-template-columns: minmax(210px, 1fr) minmax(150px, .7fr) 74px; gap: var(--space-3); }
}

@media (max-width: 620px) {
  .match-profile .dimension-grid { grid-template-columns: minmax(0, 1fr); }
  .measurement-labels { display: none; }
  .measurement-row { grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-3); }
  .measurement-copy { grid-column: 1 / -1; }
  .measurement-score { grid-template-columns: minmax(110px, 1fr) 28px; }
  .measurement-influence { min-width: 68px; }
  .toggle-action > span:first-child { display: none; }
}
</style>
