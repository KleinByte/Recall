<script setup lang="ts">
import { computed } from "vue"
import { goTo } from "../../helpers/navigation"
import { modeLabel } from "../../helpers/format"
import { Button as UiButton, Surface } from "../ui"
import type {
  PerformanceModeReferenceStatus,
  PerformanceReferenceStatus,
  RiotHistoryBackfillState,
  TrackedMode,
} from "../../types/stats"

const props = defineProps<{
  referenceStatus?: PerformanceReferenceStatus
  modes: readonly TrackedMode[]
  recordedGames: number
  gradedGames: number
  connected: boolean
  riotKeyConfigured: boolean
  riotHistory?: RiotHistoryBackfillState
}>()

const references = computed<PerformanceModeReferenceStatus[]>(() => {
  const byMode = new Map(
    props.referenceStatus?.modeReferences.map((reference) => [reference.mode, reference]),
  )
  const requiredMatches = props.referenceStatus?.requiredMatches ?? 10
  return props.modes.map((mode) => byMode.get(mode) ?? {
    mode,
    state: "building",
    readyToFreeze: false,
    eligibleMatches: 0,
    requiredMatches,
    newMatches: 0,
  })
})

const buildingReferences = computed(() =>
  references.value.filter((reference) => reference.state === "building"),
)
const hasFrozenReference = computed(() =>
  references.value.some((reference) => reference.state === "frozen"),
)
const progress = (reference: PerformanceModeReferenceStatus) =>
  Math.min(1, reference.eligibleMatches / Math.max(1, reference.requiredMatches))
const remaining = (reference: PerformanceModeReferenceStatus) =>
  Math.max(0, reference.requiredMatches - reference.eligibleMatches)

const importMessage = computed(() => {
  const history = props.riotHistory
  if (history?.status === "running") {
    return `Match-V5 is scanning older history: ${history.idsScanned.toLocaleString()} IDs checked, ${history.matchesImported.toLocaleString()} new matches imported.`
  }
  if (history?.status === "paused") {
    return `The older-history import is paused after ${history.idsScanned.toLocaleString()} IDs and can resume from Settings.`
  }
  if (history?.status === "error") {
    return "The older-history import needs attention in Settings. Its saved progress is safe."
  }
  if (history?.status === "complete") {
    return `Match-V5 checked ${history.idsScanned.toLocaleString()} matches in the last full history scan.`
  }
  if (!props.riotKeyConfigured) {
    return "Want to go beyond the League client's latest 20 games? You can start a full Match-V5 history import in Settings."
  }
  return "A Riot API key is ready. Start the full Match-V5 history import from Settings to look beyond the League client's latest 20 games."
})

const actionLabel = computed(() => {
  if (props.riotHistory?.status === "running") return "View import progress"
  if (props.riotHistory?.status === "paused" || props.riotHistory?.status === "error") {
    return "Resume in Settings"
  }
  return "Import older matches"
})
</script>

<template>
  <Surface as="section" variant="panel" padding="normal" class="rvi-building" aria-labelledby="rvi-building-title">
    <div class="rvi-building-mark" aria-hidden="true">RVI</div>
    <div class="rvi-building-body">
      <p class="eyebrow">RVI profile</p>
      <h2 id="rvi-building-title">RVI is building</h2>
      <p v-if="buildingReferences.length" class="rvi-building-copy">
        Recall needs a local comparison baseline before it can grade matches in this game mode.
        Only complete, eligible matches count.
      </p>
      <p v-else-if="hasFrozenReference" class="rvi-building-copy">
        The comparison baseline is ready, but this selection does not contain a graded match yet.
        Reset a filter or record more matches in this selection.
      </p>
      <p v-else class="rvi-building-copy">
        Recall has recorded {{ recordedGames }} {{ recordedGames === 1 ? 'match' : 'matches' }},
        but it does not have enough complete evidence to create this profile yet.
      </p>

      <div v-if="buildingReferences.length" class="rvi-progress-list" aria-label="RVI baseline progress">
        <div v-for="reference in buildingReferences" :key="reference.mode" class="rvi-progress-row">
          <div class="rvi-progress-label">
            <strong>{{ modeLabel(reference.mode) }}</strong>
            <span>
              {{ reference.eligibleMatches }}/{{ reference.requiredMatches }} eligible
              <template v-if="remaining(reference)"> · {{ remaining(reference) }} more needed</template>
              <template v-else> · finalizing baseline</template>
            </span>
          </div>
          <div
            class="rvi-progress-track"
            role="progressbar"
            :aria-label="`${modeLabel(reference.mode)} RVI baseline`"
            :aria-valuenow="reference.eligibleMatches"
            :aria-valuemin="0"
            :aria-valuemax="reference.requiredMatches"
          >
            <span :style="{ width: `${progress(reference) * 100}%` }" />
          </div>
        </div>
      </div>

      <p v-if="gradedGames" class="rvi-graded-note">
        {{ gradedGames }} graded {{ gradedGames === 1 ? 'match is' : 'matches are' }} already available in this selection.
      </p>

      <div class="rvi-import">
        <p>{{ importMessage }}</p>
        <UiButton size="compact" variant="primary" @click="goTo('settings')">
          {{ actionLabel }}
        </UiButton>
      </div>
      <p v-if="!connected" class="rvi-connection-note">
        Open and sign in to the League client before starting or resuming an import.
      </p>
    </div>
  </Surface>
</template>

<style scoped>
.rvi-building {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--ui-space-4);
  border-color: color-mix(in srgb, var(--ui-accent) 34%, var(--ui-border));
  background:
    radial-gradient(circle at 0 0, color-mix(in srgb, var(--ui-accent) 9%, transparent), transparent 44%),
    var(--ui-surface-panel);
}
.rvi-building-mark {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border: 1px solid var(--ui-border-emphasis);
  border-radius: 50%;
  color: var(--ui-accent-strong);
  font: 12px var(--ui-font-heading);
  letter-spacing: 1.5px;
}
.rvi-building-body { min-width: 0; }
.eyebrow { margin: 0 0 4px; color: var(--ui-accent); font: var(--ui-label-size) var(--ui-font-heading); letter-spacing: 1.4px; text-transform: uppercase; }
h2 { margin: 0; color: var(--ui-text-heading); font: 22px var(--ui-font-heading); }
.rvi-building-copy { max-width: 76ch; margin: 7px 0 0; color: var(--ui-text-subtle); font-size: 12px; line-height: 1.55; }
.rvi-progress-list { display: grid; gap: 10px; max-width: 720px; margin-top: var(--ui-space-4); }
.rvi-progress-row { display: grid; gap: 6px; }
.rvi-progress-label { display: flex; justify-content: space-between; gap: var(--ui-space-3); font-size: 11px; }
.rvi-progress-label strong { color: var(--ui-text-heading); font-weight: 600; }
.rvi-progress-label span { color: var(--ui-text-muted); text-align: right; }
.rvi-progress-track { height: 6px; overflow: hidden; border-radius: 999px; background: var(--ui-surface-inset); box-shadow: inset 0 0 0 1px var(--ui-border); }
.rvi-progress-track span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--ui-accent), var(--ui-accent-strong)); transition: width 180ms ease; }
.rvi-graded-note, .rvi-connection-note { margin: 10px 0 0; color: var(--ui-text-muted); font-size: 11px; }
.rvi-import { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-4); margin-top: var(--ui-space-4); padding-top: var(--ui-space-3); border-top: 1px solid var(--ui-border); }
.rvi-import p { max-width: 76ch; margin: 0; color: var(--ui-text-subtle); font-size: 11px; line-height: 1.5; }
.rvi-import :deep(.ui-button) { flex: none; }
@container recall-content (max-width: 620px) {
  .rvi-building { grid-template-columns: minmax(0, 1fr); }
  .rvi-building-mark { width: 40px; height: 40px; }
  .rvi-progress-label, .rvi-import { align-items: flex-start; flex-direction: column; }
  .rvi-progress-label span { text-align: left; }
}
</style>
