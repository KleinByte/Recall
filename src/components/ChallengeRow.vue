<script setup lang="ts">
import { computed } from "vue"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import { faThumbtack } from "@fortawesome/free-solid-svg-icons"
import type { ChallengeRow } from "../types/stats"
import {
  challengeRemaining,
  challengeTierProgress,
  isChallengeCompleted,
} from "../helpers/challenges"
import { formatDecimal } from "../helpers/format"

const props = defineProps<{
  challenge: ChallengeRow
  expanded: boolean
  pinned?: boolean
}>()
const emit = defineEmits<{
  (event: "toggle"): void
  (event: "pin"): void
}>()

const progress = computed(() => challengeTierProgress(props.challenge))
const completed = computed(() => isChallengeCompleted(props.challenge))
const remaining = computed(() => challengeRemaining(props.challenge))

const tierClass = computed(() =>
  props.challenge.currentLevel.slice(0, 1).toLowerCase(),
)

const isChampionList = computed(
  () => props.challenge.idListType === "CHAMPION",
)

const completedCount = computed(() => {
  try {
    return (JSON.parse(props.challenge.completedIds) as number[]).length
  } catch {
    return 0
  }
})

const detailId = computed(() => `challenge-details-${props.challenge.challengeId}`)
</script>

<template>
  <div
    class="challenge"
    :class="{ retired: challenge.isRetired === 1, pinned }"
  >
    <div class="row">
      <button
        class="row-main"
        :aria-expanded="expanded"
        :aria-controls="detailId"
        @click="emit('toggle')"
      >
        <span class="tier" :class="tierClass">
          {{ challenge.currentLevel === "NONE" ? "–" : challenge.currentLevel.slice(0, 1) }}
        </span>

        <span class="body">
          <span class="name-line">
            <span class="name">{{ challenge.name }}</span>
            <span v-if="completed" class="tag complete-tag">Complete</span>
            <span v-if="challenge.isCapstone" class="tag">Capstone</span>
            <span v-if="challenge.isApex" class="tag apex">Apex</span>
            <span v-if="challenge.isRetired" class="tag retired-tag">Retired</span>
          </span>
          <span class="objective">
            <span class="objective-label">Objective</span>
            <span class="description">{{ challenge.description || "No objective description reported by League." }}</span>
          </span>
          <span class="track">
            <span class="fill" :style="{ width: `${progress * 100}%` }" />
          </span>
        </span>

        <span class="numbers numeric">
          <span class="target-label">
            {{ completed ? "Target reached" : challenge.nextLevel ? `Next · ${challenge.nextLevel}` : "Progress" }}
          </span>
          <span class="value">
            {{ formatDecimal(challenge.currentValue, 0) }}
            <span class="muted" v-if="challenge.nextThreshold !== null">
              / {{ formatDecimal(challenge.nextThreshold, 0) }}
            </span>
          </span>
          <span v-if="!completed && remaining !== null" class="remaining">
            {{ formatDecimal(remaining, 0) }} remaining
          </span>
          <span class="muted percentile" v-if="challenge.percentile !== null">
            top {{ formatDecimal(challenge.percentile) }}%
          </span>
        </span>
      </button>

      <button
        class="pin"
        :class="{ on: pinned }"
        :aria-label="pinned ? `Unpin ${challenge.name}` : `Pin ${challenge.name}`"
        :title="pinned ? 'Unpin challenge' : 'Pin challenge'"
        @click.stop="emit('pin')"
      >
        <FontAwesomeIcon :icon="faThumbtack" fixed-width />
        <span class="sr-only">{{ pinned ? "Unpin challenge" : "Pin challenge" }}</span>
      </button>
    </div>

    <div
      v-if="expanded"
      :id="detailId"
      class="detail"
      role="region"
      :aria-label="`${challenge.name} details`"
    >
      <dl class="facts">
        <div><dt>Category</dt><dd>{{ challenge.category }}</dd></div>
        <div><dt>Status</dt><dd>{{ completed ? "Complete" : "In progress" }}</dd></div>
        <div><dt>Current tier</dt><dd>{{ challenge.currentLevel }}</dd></div>
        <div v-if="challenge.nextLevel">
          <dt>Next tier</dt><dd>{{ challenge.nextLevel }}</dd>
        </div>
        <div><dt>Points earned</dt><dd class="numeric">{{ challenge.pointsAwarded }}</dd></div>
        <div v-if="isChampionList">
          <dt>Champions done</dt><dd class="numeric">{{ completedCount }}</dd>
        </div>
      </dl>

      <slot name="champions" />
    </div>
  </div>
</template>

<style scoped>
.challenge {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-1);
  overflow: hidden;
}

.challenge.retired {
  opacity: 0.65;
}

.challenge.pinned {
  border-color: var(--border-strong);
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
}

.pin {
  place-self: center;
  background: transparent;
  border: 0;
  padding: var(--space-1);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  color: var(--text-muted);
}

.pin:hover {
  color: var(--gold);
}

.pin.on {
  color: var(--gold);
}

.row-main {
  width: 100%;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) minmax(130px, auto);
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  background: transparent;
  border: none;
  color: inherit;
  text-align: left;
  font-family: var(--font-body);
  cursor: pointer;
}

.row-main:hover {
  background: var(--surface-2);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.tier {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  font-family: var(--font-display);
  font-size: 13px;
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
}

.tier.s { color: #ffd88a; border-color: #c89b3c; }
.tier.d { color: #b9f2ff; border-color: #7ec8e3; }
.tier.m { color: #e8a0ff; border-color: #b06ec9; }
.tier.p { color: #7ee3c7; border-color: #3f9e86; }
.tier.g { color: #ffd88a; border-color: #c89b3c; }
.tier.b { color: #d0a07a; border-color: #8a6647; }
.tier.i { color: #a8a8a8; border-color: #6b6b6b; }

.body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.name-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.name {
  font-size: 13px;
  color: var(--text-primary);
}

.tag {
  font-size: 11px;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 1px 4px;
  color: var(--gold);
}

.tag.apex {
  color: #e8a0ff;
  border-color: #b06ec9;
}

.tag.retired-tag {
  color: var(--text-muted);
}

.tag.complete-tag {
  border-color: color-mix(in srgb, var(--win) 55%, var(--border-subtle));
  color: var(--win);
}

.objective {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}

.objective-label,
.target-label,
.remaining {
  color: var(--text-muted);
  font-size: var(--ui-text-micro);
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.objective-label {
  color: var(--cyan);
}

.description {
  display: -webkit-box;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

/* Only the differences from the global bar primitive. */
.track {
  height: 3px;
  background: var(--surface-2);
  border-radius: 999px;
  margin-top: 2px;
}

.fill {
  background: linear-gradient(to right, var(--gold-dim), var(--gold));
}

.numbers {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.numbers .target-label {
  color: var(--gold);
}

.value {
  font-size: 13px;
}

.percentile {
  font-size: 12px;
}

.detail {
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-0);
  padding: var(--space-3) var(--space-4);
}

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-2) var(--space-4);
  margin: 0 0 var(--space-3);
  font-size: 12px;
}

.facts div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
}

.facts dt {
  color: var(--text-secondary);
}

.facts dd {
  margin: 0;
}

@container recall-content (max-width: 560px) {
  .row-main {
    grid-template-columns: 34px minmax(0, 1fr);
    gap: var(--space-2);
  }

  .tier { align-self: start; }

  .numbers {
    grid-column: 2;
    align-items: baseline;
    flex-flow: row wrap;
    gap: 3px var(--space-2);
  }

  .percentile { margin-left: auto; }
}
</style>
