<script setup lang="ts">
import { computed, ref, watch } from "vue"
import PerformanceRadar from "./PerformanceRadar.vue"
import RviMetricList from "./RviMetricList.vue"
import type {
  PerformanceConfidence,
  PerformanceDimensionScore,
  PerformanceMetricScore,
  PerformanceProfile as PerformanceProfileType,
  PerformanceScopeSummary,
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
  if (dimension.delta === undefined) return "Recent form learning"
  if (Math.abs(dimension.delta) < 1) return "Holding steady"
  return `${dimension.delta > 0 ? "+" : ""}${dimension.delta} recent`
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

const positionLabels = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MIDDLE: "Mid",
  BOTTOM: "Bot",
  UTILITY: "Support",
} as const

const titleCase = (value: string) => value
  .split("_")
  .map((part) => part[0]?.toUpperCase() + part.slice(1))
  .join(" ")

const scopeLabel = (scope: PerformanceScopeSummary) => {
  if (scope.kind === "overall") return "All matches"
  if (scope.kind === "position" && scope.position) return positionLabels[scope.position]
  if (scope.kind === "primary_archetype" && scope.primaryArchetype) {
    return titleCase(scope.primaryArchetype)
  }
  return scope.key
}

const armCountLabel = (scope: PerformanceScopeSummary) =>
  scope.headline.source === "career_arm_mean"
    ? `${scope.headline.availableArms} of ${scope.headline.totalArms} arms`
    : `${scope.measuredGames} graded`

const scopeGroups = computed(() => [
  { key: "overall", label: "Overall", items: [props.profile.scopes.overall] },
  { key: "position", label: "By position", items: props.profile.scopes.positions },
  {
    key: "primary-archetype",
    label: "Primary archetypes",
    items: props.profile.scopes.primaryArchetypes.slice(0, 2),
  },
].filter((group) => group.items.length))

const hasScopeComparisons = computed(() =>
  props.profile.scopes.positions.length > 0 ||
  props.profile.scopes.primaryArchetypes.length > 0)

const scopeComparisonDescription = computed(() => {
  const hasPositions = props.profile.scopes.positions.length > 0
  const hasArchetypes = props.profile.scopes.primaryArchetypes.length > 0
  if (hasPositions && hasArchetypes) {
    return "See your overall score beside each position and primary archetype in this selection."
  }
  if (hasPositions) return "See your overall score beside each position in this selection."
  return "See your overall score beside each primary archetype in this selection."
})

const gameCountLabel = (games: number) => `${games} ${games === 1 ? "game" : "games"}`

const selectDimension = (key: string) => {
  selectedKey.value = key
  if (props.detailOnly) detailsOpen.value = true
}
</script>

<template>
  <section
    class="dimensions card"
    :class="{ 'career-profile': !detailOnly, 'match-profile': detailOnly }"
    aria-labelledby="rvi-title"
  >
    <template v-if="!detailOnly">
      <header class="dimensions-head">
        <div>
          <p class="eyebrow">RVI profile</p>
          <h2 id="rvi-title">Your RVI</h2>
          <p class="intro">Select an arm to explore the measurements behind your profile.</p>
        </div>
        <div class="profile-meta">
          <span>Career RVI</span>
          <strong class="numeric">{{ profile.score }}</strong>
          <small>
            {{ confidenceLabel(profile.confidence) }} ·
            <template v-if="profile.headline.source === 'career_arm_mean'">
              {{ profile.headline.availableArms }}/{{ profile.headline.totalArms }} arms ·
            </template>
            {{ profile.measuredGames }} graded games
          </small>
        </div>
      </header>

      <section
        v-if="hasScopeComparisons"
        class="scope-rail"
        aria-labelledby="rvi-scopes-title"
        aria-describedby="rvi-scopes-description"
      >
        <header class="scope-rail-head">
          <h3 id="rvi-scopes-title">Compare RVI</h3>
          <p id="rvi-scopes-description">{{ scopeComparisonDescription }}</p>
        </header>
        <div class="scope-groups">
          <section
            v-for="group in scopeGroups"
            :key="group.key"
            class="scope-group"
            :class="`scope-${group.key}`"
            :style="{ '--scope-count': group.items.length }"
            :aria-labelledby="`rvi-scope-${group.key}`"
          >
            <h4 :id="`rvi-scope-${group.key}`">{{ group.label }}</h4>
            <ul class="scope-items" role="list">
              <li
                v-for="scope in group.items"
                :key="`${group.key}:${scope.key}`"
                class="scope-card"
              >
                <div class="scope-card-main">
                  <div class="scope-identity">
                    <strong>{{ scopeLabel(scope) }}</strong>
                    <small>{{ scoreLabel(scope.score) }}</small>
                  </div>
                  <strong class="scope-score numeric" :aria-label="`RVI score ${scope.score}`">
                    {{ scope.score }}
                  </strong>
                </div>
                <span class="scope-meter" aria-hidden="true">
                  <i :style="{ width: `${Math.max(0, Math.min(100, scope.score))}%` }" />
                </span>
                <div class="scope-evidence">
                  <span class="scope-confidence" :data-confidence="scope.confidence">
                    {{ confidenceLabel(scope.confidence) }} data
                  </span>
                  <span>{{ armCountLabel(scope) }} · {{ gameCountLabel(scope.games) }}</span>
                </div>
              </li>
            </ul>
          </section>
        </div>
      </section>

      <div class="profile-lead">
        <PerformanceRadar
          v-if="canRenderRadar"
          class="profile-radar"
          :dimensions="profile.dimensions"
          primary-label="Career profile"
          secondary-label="Recent form"
          height="clamp(300px, 30cqi, 380px)"
        />
        <div v-else class="partial-radar-note">
          <strong>Radar is still building</strong>
          <p>More recorded games are needed for a complete radar. Available arms remain selectable.</p>
        </div>

        <section class="profile-story" aria-label="RVI profile highlights">
          <article
            v-if="identity"
            class="story-card identity"
            aria-labelledby="rvi-style-title"
          >
            <span class="story-label">Performance style</span>
            <h3 id="rvi-style-title">{{ identity.label }}</h3>
            <p>{{ identity.description }}</p>
          </article>
          <article
            v-if="strongest"
            class="story-card strongest"
            aria-labelledby="rvi-strongest-title"
          >
            <span class="story-label">Top arm</span>
            <h3 id="rvi-strongest-title">{{ strongest.label }}</h3>
            <span class="story-score numeric" :aria-label="`Arm score ${strongest.score}`">
              {{ strongest.score }}
            </span>
            <p>{{ strongest.description }}</p>
          </article>
          <article class="story-card movement" aria-labelledby="rvi-movement-title">
            <span class="story-label">Recent movement</span>
            <template v-if="growth">
              <h3 id="rvi-movement-title">{{ growth.label }}</h3>
              <span
                class="story-score numeric positive"
                :aria-label="`Recent movement plus ${growth.delta}`"
              >
                +{{ growth.delta }}
              </span>
              <p>Recent measured games are running above your recorded profile.</p>
            </template>
            <template v-else>
              <h3 id="rvi-movement-title">Profile holding steady</h3>
              <span class="story-score numeric" aria-label="No recent movement">—</span>
              <p>No arm has enough positive movement to call out yet.</p>
            </template>
          </article>
          <p class="comparison-note">{{ profile.comparison }}.</p>
        </section>
      </div>

      <div
        class="dimension-grid career-dimension-grid"
        role="group"
        aria-label="RVI performance arms"
      >
        <button
          v-for="dimension in profile.dimensions"
          :key="dimension.key"
          type="button"
          class="dimension-card"
          :class="{ selected: selected?.key === dimension.key }"
          :aria-pressed="selected?.key === dimension.key"
          aria-controls="career-arm-details"
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
          <span
            class="dimension-delta"
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
        <span class="inspector-toggle-copy">
          <small>How RVI measures it</small>
          <strong>{{ selected.label }}</strong>
        </span>
        <span class="inspector-toggle-score">
          <strong class="numeric">{{ selected.score ?? '—' }}</strong>
          <small>arm score</small>
        </span>
        <span class="inspector-toggle-action">
          <span class="inspector-action-long">
            {{ careerDetailsOpen ? 'Hide measurements' : 'Show measurements' }}
          </span>
          <span class="inspector-action-short">
            {{ careerDetailsOpen ? 'Hide' : 'Show' }}
          </span>
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
            <p class="eyebrow">Arm details</p>
            <h3 :id="`career-arm-${selected.key}`">{{ selected.label }}</h3>
            <p>{{ selected.description }}</p>
          </div>
          <div class="inspector-score">
            <strong class="numeric">{{ selected.score ?? '—' }}</strong>
            <small>{{ scoreLabel(selected.score) }}</small>
          </div>
        </header>
        <div class="inspector-context">
          <span v-if="selected.careerOnly">Career only · available after 20 graded games</span>
          <span v-else-if="selected.headlineEligible">
            {{ confidenceLabel(selected.confidence) }} · {{ selected.games }}/{{ selected.eligibleGames }} games ·
            {{ Math.round(selected.responsibilityWeight * 100) }}% average Grade share
          </span>
          <span v-else>Shown for additional context; no Grade influence.</span>
        </div>

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

.dimensions-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-5);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}
.dimensions-head > div:first-child { min-width: 0; }
.dimensions-head h2 {
  margin: 0;
  color: var(--gold-bright);
  font: 500 clamp(21px, 2.3cqi, 28px) var(--font-display);
}
.profile-meta { display: grid; flex: 0 0 auto; justify-items: end; min-width: 150px; }
.profile-meta > span { color: var(--cyan); font-size: var(--ui-text-label); letter-spacing: .08em; text-transform: uppercase; }
.profile-meta > strong { color: var(--gold-bright); font: 30px/1.1 var(--font-display); }
.profile-meta > small {
  max-width: 240px;
  color: var(--text-muted);
  font-size: var(--ui-text-label);
  line-height: 1.4;
  text-align: right;
}

.scope-rail {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding: 0;
}
.scope-rail-head { display: grid; gap: 2px; }
.scope-rail-head h3 {
  margin: 0;
  color: var(--cyan);
  font-size: var(--ui-text-label);
  font-weight: 500;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.scope-rail-head p { margin: 0; color: var(--text-muted); font-size: var(--ui-text-support); }
.scope-groups {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.scope-group {
  display: grid;
  align-self: flex-start;
  align-content: start;
  flex: var(--scope-count) 1 170px;
  min-width: min(100%, 170px);
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: rgba(8, 19, 35, .34);
}
.scope-group > h4 {
  margin: 0;
  padding: 0 2px 6px;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: var(--ui-text-label);
  font-weight: 500;
  letter-spacing: .08em;
  line-height: 1.35;
  text-transform: uppercase;
}
.scope-overall {
  border-color: color-mix(in srgb, var(--gold) 28%, var(--border-subtle));
  background: rgba(200, 170, 109, .025);
}
.scope-overall > h4 { color: var(--gold); }
.scope-items {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
  min-width: 0;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.scope-card {
  --scope-tone: var(--cyan);
  display: grid;
  align-content: start;
  min-width: 0;
  min-height: 0;
  gap: 5px;
  padding: 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: linear-gradient(145deg, rgba(255, 255, 255, .018), transparent 55%), rgba(8, 19, 35, .52);
}
.scope-overall .scope-card {
  --scope-tone: var(--gold);
  border-color: color-mix(in srgb, var(--gold) 38%, var(--border-subtle));
  background: linear-gradient(145deg, rgba(200, 170, 109, .07), transparent 58%), rgba(8, 19, 35, .58);
}
.scope-card-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}
.scope-identity { display: grid; min-width: 0; gap: 2px; }
.scope-identity > strong { color: var(--text-primary); font: var(--ui-text-support) var(--font-heading); overflow-wrap: break-word; }
.scope-identity > small { color: var(--scope-tone); font-size: var(--ui-text-micro); letter-spacing: .04em; text-transform: uppercase; }
.scope-score { color: var(--gold-bright); font: 24px/1 var(--font-display); text-align: right; }
.scope-meter {
  display: block;
  height: 2px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(76, 87, 105, .28);
}
.scope-meter i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, color-mix(in srgb, var(--scope-tone) 62%, #073846), var(--scope-tone));
}
.scope-evidence {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 2px;
  color: var(--text-muted);
  font-size: var(--ui-text-micro);
}
.scope-confidence {
  flex: 0 0 auto;
  line-height: 1.25;
}
.scope-evidence > span + span::before { color: var(--text-muted); content: "· "; }
.scope-confidence[data-confidence="provisional"] { color: var(--gold); }
.scope-confidence[data-confidence="established"] { color: var(--win); }

.profile-lead {
  display: grid;
  grid-template-columns: minmax(330px, .9fr) minmax(0, 1.1fr);
  align-items: center;
  min-width: 0;
  gap: clamp(var(--space-4), 2vw, var(--space-5));
  padding-block: var(--space-3) var(--space-4);
}
.profile-story {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  min-width: 0;
  gap: var(--space-3);
}
.story-card {
  display: grid;
  align-content: start;
  min-width: 0;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: rgba(8, 19, 35, .62);
}
.story-card.identity {
  grid-column: 1 / -1;
  border-left: 3px solid var(--cyan);
  background: linear-gradient(105deg, rgba(10, 203, 230, .08), rgba(8, 19, 35, .62) 45%);
}
.story-card.strongest { border-top-color: var(--gold); }
.story-card.movement { border-top-color: var(--cyan); }
.story-label { color: var(--text-muted); font-size: var(--ui-text-label); letter-spacing: .08em; text-transform: uppercase; }
.story-card h3 {
  margin: var(--space-1) 0 0;
  color: var(--text-primary);
  font: var(--ui-text-body) var(--font-heading);
}
.story-card.identity h3 { color: var(--cyan); font: 500 20px var(--font-display); }
.story-score { margin-top: var(--space-2); color: var(--gold-bright); font-size: 26px; }
.story-card p { margin: var(--space-2) 0 0; color: var(--text-secondary); font-size: var(--ui-text-support); line-height: 1.5; }
.profile-story > .comparison-note { grid-column: 1 / -1; margin: 0; }

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
.inspector-toggle-copy,
.inspector-toggle-score {
  display: grid;
  min-width: 0;
}
.inspector-toggle-copy small { color: var(--cyan); font-size: var(--ui-text-label); letter-spacing: .08em; text-transform: uppercase; }
.inspector-toggle-copy strong { overflow: hidden; color: var(--gold-bright); font: 500 17px var(--font-display); text-overflow: ellipsis; white-space: nowrap; }
.inspector-toggle-score { justify-items: end; }
.inspector-toggle-score strong { color: var(--gold-bright); font-size: 20px; line-height: 1; }
.inspector-toggle-score small { margin-top: 3px; color: var(--text-muted); font-size: var(--ui-text-label); }
.inspector-toggle-action { display: flex; align-items: center; flex: 0 0 auto; gap: var(--space-2); color: var(--text-secondary); font-size: var(--ui-text-label); font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.inspector-action-short { display: none; }
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
.inspector-score { display: grid; flex: 0 0 auto; justify-items: end; }
.inspector-score strong { color: var(--gold-bright); font: 25px/1 var(--font-display); }
.inspector-score small { margin-top: 2px; color: var(--text-muted); font-size: var(--ui-text-label); letter-spacing: .05em; text-transform: uppercase; }
.inspector-context { margin-top: 8px; color: var(--text-muted); font-size: var(--ui-text-label); }
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

.career-dimension-grid .dimension-card {
  grid-template-rows: auto 1fr;
  min-height: 124px;
  align-content: start;
}

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

.dimension-delta {
  grid-column: 1 / -1;
  align-self: end;
  color: var(--text-muted);
  font-size: var(--ui-text-support);
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

/* Career profile finish: quiet instrument surfaces with clear selection state. */
.career-profile {
  position: relative;
  isolation: isolate;
  padding: clamp(20px, 2.35cqi, 32px);
  border-color: color-mix(in srgb, var(--gold) 28%, var(--border-subtle));
  background:
    radial-gradient(circle at 13% 24%, rgba(200, 170, 109, .055), transparent 27%),
    radial-gradient(circle at 88% 39%, rgba(10, 203, 230, .035), transparent 31%),
    var(--ui-surface-panel);
  box-shadow: var(--shadow-card), inset 0 1px rgba(255, 255, 255, .025);
}

.career-profile::before {
  position: absolute;
  z-index: 0;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(115deg, rgba(255, 255, 255, .018), transparent 24% 78%, rgba(200, 170, 109, .018));
  content: "";
  pointer-events: none;
}

.career-profile > * {
  position: relative;
  z-index: 1;
}

.career-profile .dimensions-head {
  align-items: center;
  padding-bottom: clamp(16px, 1.7cqi, 24px);
  border-bottom-color: color-mix(in srgb, var(--gold) 34%, transparent);
}

.career-profile .dimensions-head h2 {
  font-size: clamp(26px, 2.4cqi, 34px);
  letter-spacing: -.015em;
}

.career-profile .intro {
  max-width: 620px;
  margin-top: 7px;
}

.career-profile .profile-meta {
  min-width: 190px;
  padding: 5px 0 5px clamp(18px, 2cqi, 28px);
  border-left: 1px solid color-mix(in srgb, var(--gold) 40%, transparent);
}

.career-profile .profile-meta > strong {
  margin-block: 2px;
  font-size: clamp(36px, 3.1cqi, 44px);
  letter-spacing: -.025em;
  text-shadow: 0 0 24px rgba(200, 170, 109, .09);
}

.career-profile .scope-rail {
  gap: 10px;
  margin-top: clamp(14px, 1.5cqi, 20px);
  padding-bottom: clamp(16px, 1.7cqi, 22px);
  border-bottom: 1px solid rgba(200, 170, 109, .12);
}

.career-profile .scope-rail-head {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  gap: 10px;
}

.career-profile .scope-group {
  border-color: rgba(200, 170, 109, .2);
  background: linear-gradient(145deg, rgba(255, 255, 255, .014), transparent 58%), rgba(7, 16, 29, .5);
  box-shadow: inset 0 1px rgba(255, 255, 255, .018);
}

.career-profile .scope-card {
  border-color: rgba(200, 170, 109, .18);
  box-shadow: inset 0 1px rgba(255, 255, 255, .02);
}

.career-profile .profile-lead {
  --profile-lead-gap: clamp(24px, 3cqi, 44px);
  position: relative;
  grid-template-columns: minmax(360px, .88fr) minmax(0, 1.12fr);
  align-items: stretch;
  gap: var(--profile-lead-gap);
  padding-block: clamp(24px, 3cqi, 40px);
  background: radial-gradient(ellipse at 22% 50%, rgba(200, 170, 109, .045), transparent 34%);
}

.career-profile .profile-radar {
  align-self: center;
  min-width: 0;
  filter: drop-shadow(0 14px 26px rgba(0, 0, 0, .18));
}

.career-profile .profile-story {
  position: relative;
  grid-template-rows: auto minmax(0, 1fr) auto;
  align-content: stretch;
  gap: clamp(10px, 1.1cqi, 14px);
}

.career-profile .profile-story::before {
  position: absolute;
  top: 5%;
  bottom: 5%;
  left: calc(var(--profile-lead-gap) / -2);
  width: 1px;
  background: linear-gradient(transparent, rgba(200, 170, 109, .2) 16% 84%, transparent);
  content: "";
  pointer-events: none;
}

.career-profile .story-card {
  position: relative;
  overflow: hidden;
  padding: clamp(16px, 1.55cqi, 22px);
  border-color: rgba(200, 170, 109, .24);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, .018), transparent 48%),
    rgba(7, 17, 31, .72);
  box-shadow: 0 12px 28px rgba(0, 0, 0, .12), inset 0 1px rgba(255, 255, 255, .025);
}

.career-profile .story-card.identity {
  min-height: 112px;
  border-color: color-mix(in srgb, var(--cyan) 28%, var(--border-subtle));
  border-left-width: 3px;
  background:
    radial-gradient(circle at 94% 20%, rgba(10, 203, 230, .08), transparent 27%),
    linear-gradient(105deg, rgba(10, 203, 230, .09), rgba(7, 17, 31, .74) 48%);
}

.career-profile .story-card.strongest,
.career-profile .story-card.movement {
  min-height: 176px;
}

.career-profile .story-card.strongest {
  border-top-color: color-mix(in srgb, var(--gold) 70%, var(--border-subtle));
}

.career-profile .story-card.movement {
  border-top-color: color-mix(in srgb, var(--cyan) 62%, var(--border-subtle));
}

.career-profile .story-card h3 {
  font-size: 15px;
  letter-spacing: .01em;
}

.career-profile .story-card.identity h3 {
  font-size: clamp(21px, 1.9cqi, 27px);
  letter-spacing: -.01em;
}

.career-profile .story-score {
  margin-top: 10px;
  font: 30px/1 var(--font-display);
  letter-spacing: -.02em;
}

.career-profile .story-card p {
  max-width: 62ch;
}

.career-profile .profile-story > .comparison-note {
  padding-left: 11px;
  border-left: 1px solid color-mix(in srgb, var(--gold) 48%, transparent);
}

.career-profile .career-dimension-grid {
  gap: clamp(8px, .9cqi, 12px);
  padding-top: clamp(14px, 1.6cqi, 22px);
  border-top: 1px solid rgba(200, 170, 109, .13);
}

.career-profile .career-dimension-grid .dimension-card {
  position: relative;
  isolation: isolate;
  grid-template-columns: 42px minmax(0, 1fr) minmax(76px, max-content);
  min-height: 138px;
  overflow: hidden;
  gap: 10px;
  padding: 14px;
  border-color: rgba(200, 170, 109, .22);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, .018), transparent 50%),
    rgba(9, 21, 38, .78);
  box-shadow: 0 10px 24px rgba(0, 0, 0, .1), inset 0 1px rgba(255, 255, 255, .02);
  transition: transform 150ms ease, border-color 150ms ease, background-color 150ms ease, box-shadow 150ms ease;
}

.career-profile .career-dimension-grid .dimension-card::after {
  position: absolute;
  z-index: -1;
  inset: 0;
  background: radial-gradient(circle at 8% 10%, rgba(10, 203, 230, .1), transparent 38%);
  content: "";
  opacity: 0;
  transition: opacity 150ms ease;
  pointer-events: none;
}

.career-profile .career-dimension-grid .dimension-card > * {
  position: relative;
  z-index: 1;
}

.career-profile .career-dimension-grid .dimension-mark {
  width: 38px;
  height: 38px;
  border-color: color-mix(in srgb, var(--gold) 58%, transparent);
  background: rgba(3, 11, 21, .34);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .24);
  transition: color 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
}

.career-profile .career-dimension-grid .dimension-copy strong {
  color: var(--gold-bright);
  font-size: var(--ui-text-body);
}

.career-profile .career-dimension-grid .dimension-score {
  font: 25px/1 var(--font-display);
  letter-spacing: -.015em;
}

.career-profile .career-dimension-grid .dimension-delta {
  padding-top: 8px;
  border-top: 1px solid rgba(200, 170, 109, .11);
}

.career-profile .career-dimension-grid .dimension-card.selected {
  border-color: color-mix(in srgb, var(--cyan) 58%, var(--border-subtle));
  background: linear-gradient(105deg, rgba(10, 203, 230, .075), rgba(11, 25, 44, .9) 48%, rgba(200, 170, 109, .025));
  box-shadow: inset 3px 0 var(--cyan), 0 14px 32px rgba(0, 0, 0, .18), 0 0 0 1px rgba(10, 203, 230, .06);
}

.career-profile .career-dimension-grid .dimension-card.selected::after {
  opacity: 1;
}

.career-profile .career-dimension-grid .dimension-card.selected .dimension-mark {
  border-color: color-mix(in srgb, var(--cyan) 72%, var(--gold));
  color: var(--cyan);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .24), 0 0 16px rgba(10, 203, 230, .1);
}

@media (hover: hover) {
  .career-profile .career-dimension-grid .dimension-card:hover {
    z-index: 2;
    border-color: color-mix(in srgb, var(--gold) 54%, var(--border-strong));
    background-color: rgba(14, 29, 49, .94);
    box-shadow: 0 15px 34px rgba(0, 0, 0, .2), inset 0 1px rgba(255, 255, 255, .03);
    transform: translateY(-2px);
  }

  .career-profile .career-dimension-grid .dimension-card:hover::after {
    opacity: .5;
  }
}

.career-profile .career-inspector-toggle {
  position: relative;
  overflow: hidden;
  min-height: 72px;
  margin-top: clamp(14px, 1.5cqi, 20px);
  padding: 14px 16px;
  border-color: rgba(200, 170, 109, .3);
  background:
    linear-gradient(100deg, rgba(200, 170, 109, .035), transparent 38%),
    rgba(7, 17, 31, .72);
  box-shadow: 0 12px 28px rgba(0, 0, 0, .12), inset 0 1px rgba(255, 255, 255, .02);
  transition: border-color 150ms ease, background-color 150ms ease, box-shadow 150ms ease;
}

.career-profile .career-inspector-toggle::before {
  position: absolute;
  inset: 10px auto 10px 0;
  width: 2px;
  border-radius: 999px;
  background: var(--cyan);
  content: "";
  opacity: .55;
}

.career-profile .career-inspector-toggle > * {
  position: relative;
  z-index: 1;
}

.career-profile .career-inspector-toggle:hover {
  border-color: color-mix(in srgb, var(--cyan) 48%, var(--border-subtle));
  background-color: rgba(10, 203, 230, .035);
  box-shadow: 0 15px 32px rgba(0, 0, 0, .16), inset 0 1px rgba(255, 255, 255, .025);
}

.career-profile .career-inspector-toggle[aria-expanded="true"] {
  border-color: color-mix(in srgb, var(--cyan) 42%, var(--border-subtle));
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  background: linear-gradient(100deg, rgba(10, 203, 230, .07), rgba(8, 19, 35, .72) 42%);
  box-shadow: inset 0 1px rgba(255, 255, 255, .025);
}

.career-profile .inspector-chevron {
  background: linear-gradient(145deg, rgba(255, 255, 255, .035), rgba(8, 19, 35, .76));
  box-shadow: inset 0 1px rgba(255, 255, 255, .04);
}

.career-profile .career-inspector {
  margin-top: -1px;
  padding: clamp(16px, 1.8cqi, 24px);
  border-color: color-mix(in srgb, var(--cyan) 30%, var(--border-subtle));
  border-radius: 0 0 var(--radius-md) var(--radius-md);
  background:
    linear-gradient(145deg, rgba(10, 203, 230, .025), transparent 34%),
    rgba(7, 17, 31, .68);
  box-shadow: 0 18px 38px rgba(0, 0, 0, .15), inset 0 1px rgba(255, 255, 255, .018);
}

.career-profile .inspector-head {
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(200, 170, 109, .13);
}

.career-profile .inspector-score strong {
  font-size: 30px;
}

.career-profile .metric-group-picker {
  gap: 7px;
  margin-top: 16px;
}

.career-profile .metric-group-picker button {
  padding: 7px 11px;
  background: rgba(3, 11, 21, .38);
  transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease;
}

.career-profile .metric-group-picker button:hover {
  border-color: color-mix(in srgb, var(--cyan) 42%, var(--border-subtle));
  color: var(--text-primary);
}

@container rvi-profile (min-width: 1360px) {
  .career-profile .profile-lead {
    --profile-lead-gap: 48px;
  }

  .career-profile .career-dimension-grid .dimension-card {
    min-height: 146px;
    padding: 16px;
  }
}

@container rvi-profile (max-width: 1199px) {
  .career-dimension-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@container rvi-profile (max-width: 740px) {
  .career-profile .profile-lead {
    grid-template-columns: minmax(0, 1fr);
    padding-block: 22px;
    background-position: 50% 22%;
  }
  .career-profile .profile-radar { width: min(100%, 640px); justify-self: center; }
  .career-profile .profile-story::before { display: none; }
  .scope-group { flex-basis: 100%; }
}

@container rvi-profile (max-width: 620px) {
  .dimensions-head { flex-direction: column; }
  .profile-meta { justify-items: start; }
  .profile-meta small { text-align: left; }
  .career-profile .profile-meta {
    width: 100%;
    min-width: 0;
    padding: 12px 0 0;
    border-top: 1px solid rgba(200, 170, 109, .14);
    border-left: 0;
  }
  .career-profile .scope-rail-head { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .scope-items { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .career-dimension-grid { grid-template-columns: minmax(0, 1fr); }
  .career-profile .career-dimension-grid .dimension-card { min-height: 126px; }
  .inspector-head { align-items: center; }
  .inspector-head p:last-child { font-size: var(--ui-text-support); }
  .metric-group-picker { margin-top: var(--space-2); }
  .inspector-action-long { display: none; }
  .inspector-action-short { display: inline; }
}

@container rvi-profile (max-width: 480px) {
  .profile-story { grid-template-columns: minmax(0, 1fr); }
  .story-card.identity,
  .profile-story > .comparison-note { grid-column: 1; }
  .career-profile .story-card.strongest,
  .career-profile .story-card.movement { min-height: 0; }
  .scope-items { grid-template-columns: minmax(0, 1fr); }
  .career-profile .career-inspector-toggle { gap: 9px; padding-inline: 12px; }
  .career-profile .inspector-toggle-score strong { font-size: 18px; }
}

@media (prefers-reduced-motion: reduce) {
  .career-profile .career-dimension-grid .dimension-card,
  .career-profile .career-dimension-grid .dimension-card::after,
  .career-profile .career-dimension-grid .dimension-mark,
  .career-profile .career-inspector-toggle,
  .career-profile .metric-group-picker button {
    transition: none;
  }

  .career-profile .career-dimension-grid .dimension-card:hover {
    transform: none;
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
