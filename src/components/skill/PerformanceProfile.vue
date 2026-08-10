<script setup lang="ts">
import { computed, ref, watch } from "vue"
import PerformanceRadar from "./PerformanceRadar.vue"
import type {
  PerformanceConfidence,
  PerformanceDimensionScore,
  PerformanceMetricScore,
  PerformanceProfile as PerformanceProfileType,
  PerformanceScopeSummary,
} from "../../types/stats"
import type { Champion } from "../../types/lol"
import { championNameById } from "../../helpers/format"

const props = defineProps<{
  profile: PerformanceProfileType
  identity?: { label: string; description: string }
  champions?: Champion[] | null
}>()

const selectedKey = ref(props.profile.strongestKey ?? props.profile.dimensions[0]?.key)
const detailsOpen = ref(false)

watch(() => props.profile, (profile) => {
  if (!profile.dimensions.some((dimension) => dimension.key === selectedKey.value)) {
    selectedKey.value = profile.strongestKey ?? profile.dimensions[0]?.key
    detailsOpen.value = false
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
      .sort((left, right) => right.influence - left.influence || left.label.localeCompare(right.label))
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
  if (scope.kind === "champion_position" && scope.championId && scope.position) {
    return `${championNameById(props.champions ?? null, scope.championId)} · ${positionLabels[scope.position]}`
  }
  return scope.key
}

const scopeGroups = computed(() => [
  { key: "overall", label: "Overall", items: [props.profile.scopes.overall] },
  { key: "position", label: "Position", items: props.profile.scopes.positions },
  {
    key: "primary-archetype",
    label: "Primary archetype",
    items: props.profile.scopes.primaryArchetypes,
  },
  {
    key: "champion-position",
    label: "Champion + position",
    items: props.profile.scopes.championPositions,
  },
].filter((group) => group.items.length))

const selectDimension = (key: string) => {
  selectedKey.value = key
  detailsOpen.value = true
}
</script>

<template>
  <section class="dimensions card" aria-labelledby="rvi-title">
    <header class="dimensions-head">
      <div>
        <p class="eyebrow">Recall Vector Index · RVI model {{ profile.algorithmVersion }}</p>
        <h2 id="rvi-title">Your game, measured in {{ profile.dimensions.length }} vectors.</h2>
        <p class="intro">
          RVI keeps eight stable capability views: threat, teamfighting, positioning and survival,
          control and utility, economy, objectives and macro, vision and setup, and initiative.
          Every available measurement stays inspectable; diagnostics remain excluded from the
          headline. Confidence and coverage show the sample directly, and small samples are never
          pulled toward 50.
        </p>
      </div>
      <div class="profile-meta">
        <span>RVI score</span>
        <strong>{{ profile.score }}</strong>
        <small>{{ confidenceLabel(profile.confidence) }} · {{ profile.measuredGames }} games · {{ Math.round(profile.coverage * 100) }}% coverage</small>
      </div>
    </header>

    <section class="scope-summary" aria-labelledby="rvi-scopes-title">
      <div class="scope-summary-head">
        <div>
          <span id="rvi-scopes-title">Recorded RVI scopes</span>
          <small>The same stored role-fit headline, grouped without changing its formula.</small>
        </div>
      </div>
      <div class="scope-groups">
        <div v-for="group in scopeGroups" :key="group.key" class="scope-group">
          <span class="scope-kind">{{ group.label }}</span>
          <div class="scope-items">
            <article v-for="scope in group.items" :key="scope.key" class="scope-chip">
              <span>{{ scopeLabel(scope) }}</span>
              <strong class="numeric">{{ scope.score }}</strong>
              <small>
                {{ confidenceLabel(scope.confidence) }} ·
                {{ scope.measuredGames }}/{{ scope.games }} measured ·
                {{ Math.round(scope.coverage * 100) }}% coverage
              </small>
            </article>
          </div>
        </div>
      </div>
    </section>

    <div class="profile-lead">
      <PerformanceRadar
        v-if="canRenderRadar"
        :dimensions="profile.dimensions"
        height="clamp(260px, 28vw, 320px)"
      />
      <div v-else class="partial-radar-note">
        <strong>Radar needs three measured vectors</strong>
        <p>
          {{ measuredDimensions.length }} of {{ profile.dimensions.length }} vectors currently have
          calibrated scores. Available measurements and exact evidence gaps remain listed below.
        </p>
      </div>
      <div class="profile-story">
        <article v-if="identity" class="story-card identity">
          <span class="story-label">RVI playstyle</span>
          <strong>{{ identity.label }}</strong>
          <p>{{ identity.description }}</p>
        </article>
        <article v-if="strongest" class="story-card strongest">
          <span class="story-label">Top vector</span>
          <strong>{{ strongest.label }}</strong>
          <span class="story-score numeric">{{ strongest.score }}</span>
          <p>{{ strongest.description }}</p>
        </article>
        <article class="story-card movement">
          <span class="story-label">Recent movement</span>
          <template v-if="growth">
            <strong>{{ growth.label }}</strong>
            <span class="story-score numeric positive">+{{ growth.delta }}</span>
            <p>Recent measured games are running above your recorded profile.</p>
          </template>
          <template v-else>
            <strong>Profile holding steady</strong>
            <span class="story-score numeric">—</span>
            <p>No dimension has enough positive movement to call out yet.</p>
          </template>
        </article>
        <p class="comparison-note">{{ profile.comparison }}.</p>
      </div>
    </div>

    <div class="dimension-grid" aria-label="RVI performance vectors">
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
          <small v-if="dimension.headlineEligible">
            {{ confidenceLabel(dimension.confidence) }} · {{ dimension.games }}/{{ dimension.eligibleGames }} games ·
            {{ Math.round(dimension.responsibilityWeight * 100) }}% avg responsibility
          </small>
          <small v-else>Diagnostic · excluded from headline</small>
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
          <small>vector score</small>
        </span>
        <span class="toggle-action">
          <span>{{ detailsOpen ? "Hide measurements" : "Show measurements" }}</span>
          <span class="toggle-chevron" :class="{ open: detailsOpen }" aria-hidden="true">
            <svg viewBox="0 0 20 20" focusable="false">
              <path d="m5 7.5 5 5 5-5" />
            </svg>
          </span>
        </span>
      </button>

      <div v-if="detailsOpen" :id="`dimension-${selected.key}`" class="detail-body">
        <p class="detail-description">{{ selected.description }}</p>
        <p class="responsibility-note">
          <template v-if="selected.headlineEligible">
            Average stored Grade v3 responsibility weight:
            <strong>{{ Math.round(selected.responsibilityWeight * 100) }}%</strong>.
          </template>
          <template v-else>
            Diagnostic only: its stored responsibility weight was zero, so it did not contribute
            to the role-fit headline or RVI identity.
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
                  <small v-if="metric.evidenceReason" class="evidence-reason">
                    {{ metric.evidenceReason }}
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
                  <strong v-if="metric.influence > 0" class="numeric">
                    {{ Math.round(metric.influence * 100) }}%
                  </strong>
                  <strong v-else>Diagnostic</strong>
                  <small>{{ metric.influence > 0 ? 'of Grade responsibility mix' : 'no headline influence' }}</small>
                </div>
              </article>
            </div>
          </section>
        </div>
        <p v-else class="no-measurements">
          No metric observations were retained for this vector in the selected recipe.
        </p>
        <p class="method-note">
          The headline averages stored match role-fit scores. Capability vectors aggregate their
          declared measurements with fixed recipe weights; missing scored evidence withholds the
          vector instead of becoming zero or increasing another measurement's influence.
        </p>
      </div>
    </section>
  </section>
</template>

<style scoped>
.dimensions {
  min-width: 0;
  padding: clamp(var(--space-4), 2.2vw, var(--space-5));
  overflow: hidden;
}

.dimensions-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-5);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

.eyebrow {
  margin: 0 0 var(--space-1);
  color: var(--cyan);
  font-size: 11px;
  letter-spacing: .14em;
  text-transform: uppercase;
}

.dimensions-head h2 {
  margin: 0;
  color: var(--gold-bright);
  font-family: var(--font-display);
  font-weight: 500;
}

.dimensions-head h2 {
  font-size: clamp(19px, 2vw, 26px);
}

.intro,
.comparison-note,
.detail-description,
.method-note {
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.55;
}

.intro {
  max-width: 700px;
  margin: var(--space-2) 0 0;
}

.profile-meta {
  display: grid;
  flex: 0 0 auto;
  justify-items: end;
  min-width: 145px;
}

.profile-meta span {
  color: var(--cyan);
  font-size: 11px;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.profile-meta strong {
  color: var(--gold-bright);
  font-family: var(--font-display);
  font-size: 26px;
  line-height: 1.1;
}

.profile-meta small {
  max-width: 210px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.4;
  text-align: right;
}

.scope-summary {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border-subtle);
}

.scope-summary-head > div { display: grid; gap: 2px; }
.scope-summary-head span { color: var(--cyan); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; }
.scope-summary-head small { color: var(--text-muted); font-size: 11px; }
.scope-groups { display: grid; gap: 7px; }
.scope-group { display: grid; grid-template-columns: 112px minmax(0, 1fr); align-items: start; gap: var(--space-2); }
.scope-kind { padding-top: 7px; color: var(--text-muted); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.scope-items { display: flex; min-width: 0; gap: 7px; overflow-x: auto; padding-bottom: 2px; }
.scope-chip {
  display: grid;
  grid-template-columns: minmax(92px, auto) auto;
  flex: 0 0 auto;
  align-items: baseline;
  min-width: 170px;
  gap: 2px var(--space-2);
  padding: 7px 9px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: rgba(8, 19, 35, .48);
}
.scope-chip > span { overflow: hidden; color: var(--text-primary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.scope-chip > strong { color: var(--gold-bright); font-size: 14px; }
.scope-chip > small { grid-column: 1 / -1; color: var(--text-muted); font-size: 9px; white-space: nowrap; }

.profile-lead {
  display: grid;
  grid-template-columns: minmax(340px, .9fr) minmax(280px, 1.1fr);
  align-items: center;
  gap: clamp(var(--space-4), 2vw, var(--space-5));
  padding-block: var(--space-3) var(--space-4);
}

.partial-radar-note {
  display: grid;
  align-content: center;
  min-height: 250px;
  padding: var(--space-5);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  background: rgba(8, 19, 35, .4);
}
.partial-radar-note strong { color: var(--gold-bright); font-family: var(--font-heading); }
.partial-radar-note p { margin: var(--space-2) 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }

.profile-story {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.story-card {
  position: relative;
  display: grid;
  min-width: 0;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: rgba(8, 19, 35, .62);
}

.story-card.strongest { border-top-color: var(--gold); }
.story-card.movement { border-top-color: var(--cyan); }
.story-card.identity {
  grid-column: 1 / -1;
  border-left: 2px solid var(--cyan);
  background: linear-gradient(105deg, rgba(10, 203, 230, .08), rgba(8, 19, 35, .62) 45%);
}
.story-card.identity strong { color: var(--cyan); font-family: var(--font-display); font-size: 19px; }
.story-label { color: var(--text-muted); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
.story-card strong { margin-top: var(--space-1); color: var(--text-primary); font-family: var(--font-heading); font-size: 13px; }
.story-score { margin-top: var(--space-2); color: var(--gold-bright); font-size: 26px; }
.story-card p { margin: var(--space-2) 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.comparison-note { grid-column: 1 / -1; margin: 0; }

.dimension-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-2);
}

.dimension-card {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
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
.dimension-copy strong { overflow: hidden; color: var(--text-primary); font-family: var(--font-heading); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.dimension-copy small { color: var(--text-muted); font-size: 11px; }
.dimension-result { display: grid; justify-items: end; }
.dimension-score { color: var(--gold-bright); font-size: 20px; line-height: 1; }
.dimension-result small { margin-top: 3px; color: var(--text-muted); font-size: 10px; letter-spacing: .06em; text-transform: uppercase; }

.dimension-delta {
  grid-column: 1 / -1;
  color: var(--text-muted);
  font-size: 11px;
}

.positive { color: var(--win) !important; }
.negative { color: var(--loss) !important; }

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
.toggle-copy small { color: var(--cyan); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; }
.toggle-copy strong { margin-top: 2px; color: var(--gold-bright); font-family: var(--font-display); font-size: 17px; font-weight: 500; }
.toggle-score { justify-items: end; }
.toggle-score strong { color: var(--gold-bright); font-size: 20px; line-height: 1; }
.toggle-score small { margin-top: 3px; color: var(--text-muted); font-size: 10px; }
.toggle-action { display: flex; align-items: center; gap: var(--space-2); color: var(--text-secondary); font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.toggle-chevron { display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid var(--border-strong); border-radius: 50%; color: var(--gold-bright); background: var(--surface-2); transform: rotate(0); transition: transform 160ms ease, color 160ms ease, border-color 160ms ease; }
.toggle-chevron svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.toggle-chevron.open { border-color: rgba(10, 203, 230, .55); color: var(--cyan); transform: rotate(180deg); }
.detail-body { padding-top: var(--space-3); }
.detail-description { max-width: 700px; margin: 0; }
.responsibility-note { margin: var(--space-2) 0 0; color: var(--text-muted); font-size: 11px; }
.responsibility-note strong { color: var(--cyan); }

.measurement-groups { display: grid; gap: var(--space-4); margin-top: var(--space-4); }
.measurement-group { min-width: 0; }
.measurement-group h3 {
  margin: 0 0 7px;
  color: var(--cyan);
  font-size: 10px;
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
  font-size: 10px;
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
.measurement-copy p { margin: 3px 0; color: var(--text-secondary); font-size: 12px; line-height: 1.4; }
.measurement-copy small { color: var(--text-muted); font-size: 11px; }
.evidence-badge {
  padding: 2px 5px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 9px;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.evidence-badge[data-state="observed"] { border-color: rgba(10, 203, 230, .28); color: var(--cyan); }
.evidence-badge[data-state="invalid"] { border-color: rgba(239, 92, 105, .35); color: var(--loss); }
.evidence-reason { color: var(--loss) !important; }
.formula-detail { margin-top: 5px; color: var(--text-muted); font-size: 10px; }
.formula-detail summary { width: max-content; color: var(--cyan); cursor: pointer; }
.formula-detail span { display: block; margin-top: 3px; line-height: 1.45; }
.no-measurements { margin: var(--space-3) 0 0; color: var(--text-muted); font-size: 11px; }

.measurement-score {
  display: grid;
  grid-template-columns: minmax(100px, 1fr) 28px;
  align-items: center;
  min-width: 0;
  gap: var(--space-2);
}

.measurement-score > strong { color: var(--gold-bright); font-size: 13px; text-align: right; }
.measurement-score > small { grid-column: 1 / -1; color: var(--text-muted); font-size: 10px; text-align: right; text-transform: uppercase; }

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
.measurement-influence small { color: var(--text-muted); font-size: 10px; text-align: right; }
.method-note { margin: var(--space-3) 0 0; }

@media (max-width: 1100px) {
  .dimension-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 900px) {
  .profile-lead { grid-template-columns: minmax(0, 1fr); }
  .measurement-labels,
  .measurement-row { grid-template-columns: minmax(210px, 1fr) minmax(150px, .7fr) 74px; gap: var(--space-3); }
}

@media (max-width: 620px) {
  .dimensions-head { flex-direction: column; }
  .profile-meta { justify-items: start; }
  .profile-meta small { text-align: left; }
  .profile-story,
  .dimension-grid { grid-template-columns: minmax(0, 1fr); }
  .scope-group { grid-template-columns: minmax(0, 1fr); gap: 3px; }
  .scope-kind { padding-top: 0; }
  .measurement-labels { display: none; }
  .measurement-row { grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-3); }
  .measurement-copy { grid-column: 1 / -1; }
  .measurement-score { grid-template-columns: minmax(110px, 1fr) 28px; }
  .measurement-influence { min-width: 68px; }
  .toggle-action > span:first-child { display: none; }
}
</style>
