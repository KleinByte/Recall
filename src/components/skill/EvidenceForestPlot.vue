<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import { faChevronDown } from "@fortawesome/free-solid-svg-icons"
import { publicAssetUrl } from "../../helpers/assets"
import { championIconUrl } from "../../helpers/format"
import {
  findingChampionId,
  findingItemAsset,
  findingLabel,
  findingSummary,
} from "../../helpers/insight-findings"
import {
  buildPatternReviewGroups,
  defaultPatternReviewFilter,
  hasUsableInterval,
  patternReviewCounts,
  type PatternReviewFilter,
  type PatternReviewItem,
  type PatternReviewSourceGroup,
} from "../../helpers/pattern-review"
import type { Champion } from "../../types/lol"
import type { InsightFinding } from "../../types/stats"

export interface EvidenceForestGroup extends PatternReviewSourceGroup {}

const props = defineProps<{
  groups: EvidenceForestGroup[]
  champions: Champion[] | null
}>()

const activeFilter = ref<PatternReviewFilter>(defaultPatternReviewFilter(props.groups))
const expandedGroups = ref<Record<string, boolean>>({})
const counts = computed(() => patternReviewCounts(props.groups))
const reviewGroups = computed(() => buildPatternReviewGroups(props.groups, activeFilter.value))

watch(counts, (next) => {
  if (activeFilter.value === "standouts" && next.standouts === 0) activeFilter.value = "learning"
  if (activeFilter.value === "learning" && next.learning === 0 && next.standouts > 0) {
    activeFilter.value = "standouts"
  }
}, { immediate: true })

const filterOptions = computed<Array<{ key: PatternReviewFilter; label: string; count: number }>>(() => [
  { key: "standouts", label: "Worth reviewing", count: counts.value.standouts },
  { key: "learning", label: "Still learning", count: counts.value.learning },
  { key: "all", label: "All patterns", count: counts.value.total },
])

const unitOrder: InsightFinding["unit"][] = ["grade", "percentile", "rate", "probability"]
const unitMeta: Record<InsightFinding["unit"], { label: string; suffix: string; multiplier: number }> = {
  grade: { label: "Recall Score difference", suffix: " pts", multiplier: 1 },
  percentile: { label: "How the measurement differed", suffix: " pp", multiplier: 100 },
  rate: { label: "Recorded rate difference", suffix: " pp", multiplier: 100 },
  probability: { label: "Chance difference", suffix: " pp", multiplier: 100 },
}

const comparisonPanels = computed(() => unitOrder.flatMap((unit) => {
  const meta = unitMeta[unit]
  const groups = props.groups.flatMap((group) => {
    const findings = group.findings.filter((finding) =>
      finding.unit === unit && hasUsableInterval(finding) && !finding.key.startsWith("window:"))
    return findings.length ? [{
      key: group.key,
      label: buildPatternReviewGroups([{ ...group, findings: [findings[0]] }], "all")[0]?.label ?? group.title,
      findings,
    }] : []
  })
  if (!groups.length) return []

  const values = groups.flatMap((group) => group.findings.flatMap((finding) => [
    finding.effect,
    finding.interval!.low,
    finding.interval!.high,
  ])).map((value) => Math.abs(value * meta.multiplier))
  const observedMax = Math.max(...values, unit === "grade" ? 1 : 5)
  const scale = Math.ceil(observedMax * 1.08 * 2) / 2

  return [{ unit, ...meta, scale, groups }]
}))

function selectFilter(filter: PatternReviewFilter) {
  activeFilter.value = filter
}

function toggleGroup(key: string) {
  expandedGroups.value = { ...expandedGroups.value, [key]: !expandedGroups.value[key] }
}

function displayLabel(finding: InsightFinding) {
  return findingLabel(finding, props.champions)
}

function displaySummary(finding: InsightFinding) {
  return findingSummary(finding, props.champions)
}

function iconUrl(finding: InsightFinding): string | undefined {
  const item = findingItemAsset(finding)
  if (item) return item.iconUrl
  const championId = findingChampionId(finding)
  return championId === undefined ? undefined : championIconUrl(championId)
}

function imageFallback(event: Event) {
  const image = event.currentTarget as HTMLImageElement
  image.onerror = null
  image.src = publicAssetUrl("recall-icon.png")
}

function matchingGames(finding: InsightFinding): number {
  return finding.games || Number(finding.values?.recordedItemGames ?? 0)
}

function matchingGamesLabel(finding: InsightFinding): string {
  const games = matchingGames(finding)
  return games === 1 ? "Based on 1 matching game" : `Based on ${games} matching games`
}

function confidenceLabel(confidence: InsightFinding["confidence"]): string {
  return ({
    insufficient: "Early signal",
    low: "Limited evidence",
    medium: "Repeated signal",
    high: "Strong evidence",
  })[confidence]
}

function statusLabel(item: PatternReviewItem): string {
  if (item.status === "standout") return "Worth reviewing"
  return hasUsableInterval(item.finding) ? "No clear difference yet" : "Still learning"
}

function signed(value: number, suffix: string, digits = 1): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`
}

function effectMeta(finding: InsightFinding) {
  const meta = unitMeta[finding.unit]
  const value = finding.effect * meta.multiplier
  const amount = Math.abs(value).toFixed(1)
  const unit = finding.unit === "grade"
    ? `Recall Score point${amount === "1.0" ? "" : "s"}`
    : `percentage point${amount === "1.0" ? "" : "s"}`
  return {
    exact: signed(value, meta.suffix),
    sentence: value === 0 ? "No measured change" : `${amount} ${unit} ${value > 0 ? "higher" : "lower"}`,
  }
}

function intervalPlot(finding: InsightFinding) {
  const meta = unitMeta[finding.unit]
  const low = finding.interval!.low * meta.multiplier
  const high = finding.interval!.high * meta.multiplier
  const effect = finding.effect * meta.multiplier
  const scale = Math.max(Math.abs(low), Math.abs(high), Math.abs(effect), finding.unit === "grade" ? 1 : 5)
  const position = (value: number) => Math.min(96, Math.max(4, 50 + value / scale * 44))
  const left = position(low)
  const right = position(high)
  return {
    low,
    high,
    effect,
    suffix: meta.suffix,
    left,
    width: Math.max(2, right - left),
    point: position(effect),
  }
}

function panelPosition(value: number, scale: number) {
  return Math.min(96, Math.max(4, 50 + value / scale * 44))
}
</script>

<template>
  <div class="pattern-review" aria-label="Patterns found across recorded games">
    <header class="review-toolbar">
      <div class="review-summary" aria-live="polite">
        <strong>
          {{ counts.standouts }} {{ counts.standouts === 1 ? "pattern" : "patterns" }} stand out
        </strong>
        <span>{{ counts.learning }} {{ counts.learning === 1 ? "needs" : "need" }} more games</span>
      </div>
      <div class="review-filters" role="group" aria-label="Choose which patterns to show">
        <button
          v-for="option in filterOptions"
          :key="option.key"
          type="button"
          :class="{ active: activeFilter === option.key }"
          :aria-pressed="activeFilter === option.key"
          :disabled="option.count === 0"
          @click="selectFilter(option.key)"
        >
          <span>{{ option.label }}</span>
          <strong class="numeric">{{ option.count }}</strong>
        </button>
      </div>
    </header>

    <div v-if="reviewGroups.length" class="review-groups">
      <section
        v-for="group in reviewGroups"
        :key="`${activeFilter}:${group.key}`"
        class="review-group"
        :aria-labelledby="`pattern-group-${activeFilter}-${group.key}`"
      >
        <header class="group-heading">
          <h3 :id="`pattern-group-${activeFilter}-${group.key}`">{{ group.label }}</h3>
          <span>{{ group.items.length }} {{ group.items.length === 1 ? "pattern" : "patterns" }}</span>
        </header>

        <div class="pattern-list">
          <details
            v-for="(item, index) in group.items"
            v-show="index === 0 || expandedGroups[`${activeFilter}:${group.key}`]"
            :id="`pattern-${item.id}`"
            :key="item.id"
            class="pattern-row"
            :class="item.status"
          >
            <summary>
              <span class="pattern-visual" aria-hidden="true">
                <img
                  v-if="iconUrl(item.finding)"
                  :src="iconUrl(item.finding)"
                  alt=""
                  @error="imageFallback"
                />
                <span v-else>{{ item.status === "standout" ? "◆" : "—" }}</span>
              </span>
              <span class="pattern-copy">
                <strong>{{ displayLabel(item.finding) }}</strong>
                <span>{{ displaySummary(item.finding) }}</span>
                <small>{{ matchingGamesLabel(item.finding) }}</small>
              </span>
              <span class="pattern-result">
                <strong v-if="item.status === 'standout'" class="numeric">
                  {{ effectMeta(item.finding).sentence }}
                </strong>
                <strong v-else>{{ statusLabel(item) }}</strong>
                <small>{{ confidenceLabel(item.finding.confidence) }}</small>
              </span>
              <FontAwesomeIcon :icon="faChevronDown" class="row-chevron" aria-hidden="true" />
            </summary>

            <div class="pattern-evidence">
              <div
                v-if="hasUsableInterval(item.finding)"
                class="compact-interval"
                role="img"
                :aria-label="`${displayLabel(item.finding)}: best estimate ${effectMeta(item.finding).exact}; reasonable range ${signed(intervalPlot(item.finding).low, intervalPlot(item.finding).suffix)} to ${signed(intervalPlot(item.finding).high, intervalPlot(item.finding).suffix)}.`"
              >
                <span class="zero-line" aria-hidden="true" />
                <span
                  class="interval-line"
                  :class="{ clear: item.status === 'standout' }"
                  :style="{
                    left: `${intervalPlot(item.finding).left}%`,
                    width: `${intervalPlot(item.finding).width}%`,
                  }"
                  aria-hidden="true"
                />
                <span
                  class="estimate-dot"
                  :style="{ left: `${intervalPlot(item.finding).point}%` }"
                  aria-hidden="true"
                />
              </div>

              <dl class="evidence-facts">
                <div>
                  <dt>Best estimate</dt>
                  <dd>{{ hasUsableInterval(item.finding) ? effectMeta(item.finding).sentence : "Not ready yet" }}</dd>
                </div>
                <div v-if="hasUsableInterval(item.finding)">
                  <dt>Reasonable range</dt>
                  <dd class="numeric">
                    {{ signed(intervalPlot(item.finding).low, intervalPlot(item.finding).suffix) }} to
                    {{ signed(intervalPlot(item.finding).high, intervalPlot(item.finding).suffix) }}
                  </dd>
                </div>
                <div>
                  <dt>Games compared</dt>
                  <dd>{{ item.finding.scope }}</dd>
                </div>
                <div>
                  <dt>How Recall checked</dt>
                  <dd>{{ item.method }}</dd>
                </div>
              </dl>
              <p v-if="item.finding.caveat" class="pattern-caveat">
                {{ item.finding.caveat }}
              </p>
            </div>
          </details>
        </div>

        <button
          v-if="group.items.length > 1"
          type="button"
          class="more-patterns"
          :aria-expanded="Boolean(expandedGroups[`${activeFilter}:${group.key}`])"
          :aria-controls="group.items.slice(1).map((item) => `pattern-${item.id}`).join(' ')"
          @click="toggleGroup(`${activeFilter}:${group.key}`)"
        >
          {{ expandedGroups[`${activeFilter}:${group.key}`]
            ? "Show fewer"
            : `Show ${group.items.length - 1} more in this category` }}
          <FontAwesomeIcon :icon="faChevronDown" aria-hidden="true" />
        </button>
      </section>
    </div>

    <p v-else class="empty-review">
      Recall needs more comparable graded games before it can separate a repeated pattern from
      ordinary match-to-match variation.
    </p>

    <details v-if="comparisonPanels.length" class="compare-evidence">
      <summary>
        <span>
          <strong>Compare every measured estimate</strong>
          <small>Advanced view with every best estimate and reasonable range</small>
        </span>
        <FontAwesomeIcon :icon="faChevronDown" aria-hidden="true" />
      </summary>

      <div class="comparison-panels">
        <section v-for="panel in comparisonPanels" :key="panel.unit" class="comparison-panel">
          <header class="comparison-head">
            <h3>{{ panel.label }}</h3>
            <div class="comparison-axis numeric" aria-hidden="true">
              <span>{{ signed(-panel.scale, panel.suffix) }}</span>
              <span>No change</span>
              <span>{{ signed(panel.scale, panel.suffix) }}</span>
            </div>
          </header>

          <div v-for="group in panel.groups" :key="group.key" class="comparison-group">
            <h4>{{ group.label }}</h4>
            <article v-for="finding in group.findings" :key="finding.key" class="comparison-row">
              <strong>{{ displayLabel(finding) }}</strong>
              <div
                class="comparison-plot"
                role="img"
                :aria-label="`${displayLabel(finding)}: ${effectMeta(finding).sentence}.`"
              >
                <span class="zero-line" aria-hidden="true" />
                <span
                  class="interval-line"
                  :class="{ clear: finding.interval!.low > 0 || finding.interval!.high < 0 }"
                  :style="{
                    left: `${panelPosition(finding.interval!.low * panel.multiplier, panel.scale)}%`,
                    width: `${Math.max(2, panelPosition(finding.interval!.high * panel.multiplier, panel.scale) - panelPosition(finding.interval!.low * panel.multiplier, panel.scale))}%`,
                  }"
                  aria-hidden="true"
                />
                <span
                  class="estimate-dot"
                  :style="{ left: `${panelPosition(finding.effect * panel.multiplier, panel.scale)}%` }"
                  aria-hidden="true"
                />
              </div>
              <span class="comparison-value numeric">{{ effectMeta(finding).exact }}</span>
            </article>
          </div>
        </section>
      </div>
    </details>
  </div>
</template>

<style scoped>
.pattern-review {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--surface-1) 88%, transparent);
}

.review-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-4);
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--surface-2) 72%, transparent);
}

.review-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  min-width: 0;
  gap: 5px 10px;
}

.review-summary strong {
  color: var(--text-primary);
  font-size: var(--ui-text-body);
}

.review-summary span {
  color: var(--text-muted);
  font-size: var(--ui-text-support);
}

.review-filters {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-canvas) 42%, transparent);
}

.review-filters button {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  gap: 7px;
  padding: 5px 10px;
  border: 0;
  border-radius: 999px;
  color: var(--text-muted);
  background: transparent;
  font: inherit;
  font-size: var(--ui-text-label);
  cursor: pointer;
}

.review-filters button strong {
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 999px;
  color: inherit;
  background: color-mix(in srgb, currentColor 10%, transparent);
  font-size: var(--ui-text-micro);
}

.review-filters button.active {
  color: var(--text-primary);
  background: var(--surface-3);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cyan) 30%, transparent);
}

.review-filters button:disabled {
  opacity: 0.42;
  cursor: default;
}

.review-filters button:focus-visible,
.more-patterns:focus-visible,
.pattern-row > summary:focus-visible,
.compare-evidence > summary:focus-visible {
  outline: 2px solid var(--cyan);
  outline-offset: 2px;
}

.review-group + .review-group {
  border-top: 1px solid var(--border-subtle);
}

.group-heading {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-3);
  padding: 9px 14px;
  background: rgba(7, 17, 31, 0.32);
}

.group-heading h3,
.group-heading span {
  margin: 0;
}

.group-heading h3 {
  color: var(--gold-bright);
  font-family: var(--font-heading);
  font-size: var(--ui-text-support);
  font-weight: 600;
}

.group-heading span {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--ui-text-label);
}

.pattern-row + .pattern-row {
  border-top: 1px solid color-mix(in srgb, var(--border-subtle) 68%, transparent);
}

.pattern-row > summary {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) minmax(148px, auto) 16px;
  align-items: center;
  min-height: 64px;
  gap: 12px;
  padding: 9px 14px;
  list-style: none;
  cursor: pointer;
}

.pattern-row > summary::-webkit-details-marker,
.compare-evidence > summary::-webkit-details-marker {
  display: none;
}

.pattern-row > summary:hover {
  background: color-mix(in srgb, var(--cyan) 4%, transparent);
}

.pattern-visual {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  color: var(--text-muted);
  background: var(--surface-2);
  font-size: var(--ui-text-micro);
}

.standout .pattern-visual {
  border-color: color-mix(in srgb, var(--cyan) 54%, var(--border-subtle));
  color: var(--cyan);
}

.pattern-visual img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.pattern-copy,
.pattern-result {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.pattern-copy > strong {
  color: var(--text-primary);
  font-size: var(--ui-text-support);
  overflow-wrap: anywhere;
}

.pattern-copy > span {
  color: var(--text-secondary);
  font-size: var(--ui-text-label);
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.pattern-copy > small,
.pattern-result > small {
  color: var(--text-muted);
  font-size: var(--ui-text-label);
}

.pattern-result {
  justify-items: end;
  text-align: right;
}

.pattern-result > strong {
  max-width: 220px;
  color: var(--text-primary);
  font-size: var(--ui-text-label);
  line-height: 1.35;
}

.learning .pattern-result > strong {
  color: var(--text-secondary);
}

.row-chevron {
  color: var(--text-muted);
  font-size: 11px;
  transition: transform 160ms ease;
}

.pattern-row[open] > summary .row-chevron,
.compare-evidence[open] > summary > svg,
.more-patterns[aria-expanded="true"] > svg {
  transform: rotate(180deg);
}

.pattern-evidence {
  display: grid;
  gap: 12px;
  padding: 4px 42px 14px 56px;
  border-top: 1px solid color-mix(in srgb, var(--border-subtle) 54%, transparent);
  background: color-mix(in srgb, var(--ui-canvas) 24%, transparent);
}

.compact-interval,
.comparison-plot {
  position: relative;
  min-width: 0;
  height: 32px;
  border-radius: 4px;
  background: linear-gradient(90deg, rgba(130, 146, 170, 0.035) 0 50%, rgba(130, 146, 170, 0.075) 50% 100%);
}

.zero-line {
  position: absolute;
  inset-block: 3px;
  left: 50%;
  width: 1px;
  background: var(--text-muted);
  opacity: 0.58;
}

.interval-line {
  position: absolute;
  top: 15px;
  height: 2px;
  border-radius: 999px;
  background: var(--text-muted);
}

.interval-line::before,
.interval-line::after {
  position: absolute;
  top: -3px;
  width: 1px;
  height: 8px;
  background: inherit;
  content: "";
}

.interval-line::before { left: 0; }
.interval-line::after { right: 0; }
.interval-line.clear { background: var(--cyan); }

.estimate-dot {
  position: absolute;
  top: 11px;
  width: 10px;
  height: 10px;
  border: 2px solid var(--surface-1);
  border-radius: 50%;
  transform: translateX(-50%);
  background: var(--gold-bright);
  box-shadow: 0 0 0 1px var(--border-subtle);
}

.evidence-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px 18px;
  margin: 0;
}

.evidence-facts > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.evidence-facts dt {
  color: var(--text-muted);
  font-size: var(--ui-text-label);
}

.evidence-facts dd {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--ui-text-support);
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.pattern-caveat {
  margin: 0;
  padding: 8px 10px;
  border-left: 2px solid var(--gold);
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--gold) 5%, transparent);
  font-size: var(--ui-text-label);
  line-height: 1.45;
}

.more-patterns {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  min-height: 38px;
  gap: 7px;
  padding: 6px 12px;
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--border-subtle) 58%, transparent);
  color: var(--cyan);
  background: transparent;
  font: inherit;
  font-size: var(--ui-text-label);
  cursor: pointer;
}

.more-patterns svg {
  font-size: var(--ui-text-micro);
  transition: transform 160ms ease;
}

.empty-review {
  margin: 0;
  padding: 20px;
  color: var(--text-secondary);
  font-size: var(--ui-text-support);
  line-height: 1.55;
}

.compare-evidence {
  border-top: 1px solid var(--border-subtle);
}

.compare-evidence > summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 52px;
  gap: var(--space-3);
  padding: 9px 14px;
  list-style: none;
  cursor: pointer;
}

.compare-evidence > summary > span {
  display: grid;
  gap: 2px;
}

.compare-evidence > summary strong {
  color: var(--text-primary);
  font-size: var(--ui-text-support);
}

.compare-evidence > summary small {
  color: var(--text-muted);
  font-size: var(--ui-text-label);
}

.compare-evidence > summary > svg {
  color: var(--text-muted);
  transition: transform 160ms ease;
}

.comparison-panels {
  display: grid;
  gap: 12px;
  padding: 0 12px 12px;
}

.comparison-panel {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--ui-canvas) 24%, transparent);
}

.comparison-head,
.comparison-row {
  display: grid;
  grid-template-columns: minmax(170px, 0.75fr) minmax(220px, 1fr) 76px;
  align-items: center;
  gap: 12px;
}

.comparison-head {
  padding: 9px 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.comparison-head h3 {
  margin: 0;
  color: var(--gold-bright);
  font-family: var(--font-heading);
  font-size: var(--ui-text-support);
}

.comparison-axis {
  display: flex;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: var(--ui-text-label);
}

.comparison-group + .comparison-group {
  border-top: 1px solid var(--border-subtle);
}

.comparison-group h4 {
  margin: 0;
  padding: 7px 12px;
  color: var(--text-secondary);
  background: rgba(7, 17, 31, 0.3);
  font-size: var(--ui-text-label);
}

.comparison-row {
  min-height: 46px;
  padding: 6px 12px;
}

.comparison-row + .comparison-row {
  border-top: 1px solid color-mix(in srgb, var(--border-subtle) 52%, transparent);
}

.comparison-row > strong {
  min-width: 0;
  color: var(--text-primary);
  font-size: var(--ui-text-label);
  overflow-wrap: anywhere;
}

.comparison-plot {
  height: 26px;
}

.comparison-plot .interval-line { top: 12px; }
.comparison-plot .estimate-dot { top: 8px; }

.comparison-value {
  justify-self: end;
  color: var(--text-secondary);
  font-size: var(--ui-text-label);
}

@container skill-insights (max-width: 720px) {
  .review-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .review-filters {
    width: 100%;
  }

  .review-filters button {
    justify-content: center;
    flex: 1 1 0;
  }

  .comparison-head,
  .comparison-row {
    grid-template-columns: minmax(135px, 0.65fr) minmax(170px, 1fr) 70px;
  }
}

@container skill-insights (max-width: 520px) {
  .review-toolbar { padding: 10px; }

  .review-filters {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border-radius: var(--radius-sm);
  }

  .review-filters button {
    display: grid;
    justify-items: center;
    min-width: 0;
    gap: 2px;
    padding-inline: 4px;
    border-radius: 6px;
  }

  .review-filters button span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pattern-row > summary {
    grid-template-columns: 28px minmax(0, 1fr) 14px;
    gap: 9px;
    padding: 9px 10px;
  }

  .pattern-result {
    grid-column: 2;
    justify-items: start;
    text-align: left;
  }

  .row-chevron {
    grid-column: 3;
    grid-row: 1 / span 2;
  }

  .pattern-evidence {
    padding: 8px 12px 12px;
  }

  .compact-interval { display: none; }
  .evidence-facts { grid-template-columns: minmax(0, 1fr); }

  .comparison-head,
  .comparison-row {
    grid-template-columns: minmax(0, 1fr) 64px;
  }

  .comparison-axis,
  .comparison-plot {
    grid-column: 1 / -1;
    grid-row: auto;
  }

  .comparison-row > strong { grid-column: 1; }
  .comparison-value { grid-column: 2; grid-row: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .row-chevron,
  .more-patterns svg,
  .compare-evidence > summary > svg {
    transition: none;
  }
}
</style>
