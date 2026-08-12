<script setup lang="ts">
import { computed } from "vue"
import MiniBar from "./ui/MiniBar.vue"
import Button from "./ui/Button.vue"
import Dialog from "./ui/Dialog.vue"
import {
  challengeGameModeLabel,
  challengeGameModes,
  challengeRemaining,
  challengeTierProgress,
  isChallengeCompleted,
} from "../helpers/challenges"
import { formatDecimal } from "../helpers/format"
import type { ChallengeRow } from "../types/stats"

const props = defineProps<{
  challenge: ChallengeRow
}>()

const emit = defineEmits<{
  (event: "close"): void
}>()

const completed = computed(() => isChallengeCompleted(props.challenge))
const remaining = computed(() => challengeRemaining(props.challenge))

const completedCount = computed(() => {
  try {
    const ids = JSON.parse(props.challenge.completedIds) as unknown
    return Array.isArray(ids) ? ids.length : 0
  } catch {
    return 0
  }
})

const gameModes = computed(() => challengeGameModes(props.challenge)
  .map(challengeGameModeLabel))

</script>

<template>
  <Dialog
    :labelled-by="'challenge-dialog-' + challenge.challengeId"
    size="medium"
    align="top"
    @close="emit('close')"
  >
        <header class="dialog-head">
          <div class="tier" :data-tier="challenge.currentLevel">
            {{
              challenge.currentLevel === "NONE"
                ? "–"
                : challenge.currentLevel.slice(0, 1)
            }}
          </div>
          <div class="heading">
            <h2 :id="`challenge-dialog-${challenge.challengeId}`">
              {{ challenge.name }}
            </h2>
            <p class="muted context">
              {{ completed ? "Challenge complete" : challenge.nextLevel ? `Working toward ${challenge.nextLevel}` : "Challenge progress" }}
            </p>
          </div>
          <Button
            class="close"
            variant="ghost"
            size="compact"
            icon-only
            title="Close challenge details"
            aria-label="Close challenge details"
            @click="emit('close')"
          >
            ×
          </Button>
        </header>

        <section class="objective-block" aria-label="Challenge objective">
          <span>Objective</span>
          <p>{{ challenge.description || "League did not provide an objective description for this challenge." }}</p>
        </section>

        <div class="progress-block">
          <div class="progress-head">
            <span class="milestone-label">
              {{ completed ? "Completed milestone" : "Next milestone" }}
            </span>
            <strong>
              {{ challenge.currentLevel }}
              <template v-if="challenge.nextLevel">
                → {{ challenge.nextLevel }}
              </template>
            </strong>
            <span class="numeric">
              {{ formatDecimal(challenge.currentValue, 0) }}
              <template v-if="challenge.nextThreshold !== null">
                / {{ formatDecimal(challenge.nextThreshold, 0) }}
              </template>
            </span>
          </div>
          <MiniBar :value="challengeTierProgress(challenge)" />
          <p v-if="completed" class="remaining complete">
            Target reached
          </p>
          <p v-else-if="remaining !== null" class="muted remaining">
            {{ formatDecimal(remaining, 0) }} remaining to the next tier
          </p>
          <p v-else class="muted remaining">Highest available tier reached</p>
        </div>

        <dl class="facts">
          <div>
            <dt>Category</dt>
            <dd>{{ challenge.category }}</dd>
          </div>
          <div>
            <dt>Points earned</dt>
            <dd class="numeric">{{ challenge.pointsAwarded }}</dd>
          </div>
          <div v-if="challenge.percentile !== null">
            <dt>Standing</dt>
            <dd class="numeric">
              Top {{ formatDecimal(challenge.percentile) }}%
            </dd>
          </div>
          <div v-if="gameModes.length">
            <dt>Game modes</dt>
            <dd>{{ gameModes.join(", ") }}</dd>
          </div>
          <div v-if="challenge.idListType === 'CHAMPION'">
            <dt>Champions completed</dt>
            <dd class="numeric">{{ completedCount }}</dd>
          </div>
        </dl>

        <div v-if="challenge.isCapstone || challenge.isApex" class="tags">
          <span v-if="challenge.isCapstone" class="tag">Capstone</span>
          <span v-if="challenge.isApex" class="tag apex">Apex</span>
        </div>
  </Dialog>
</template>

<style scoped>
.dialog-head {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--ui-space-3);
}

.tier {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border: 1px solid var(--ui-border-emphasis);
  border-radius: var(--ui-radius-md);
  color: var(--ui-text-heading);
  font-family: var(--ui-font-display);
  font-size: 18px;
}

.heading h2 {
  margin: 0;
  color: var(--ui-text-heading);
  font-family: var(--ui-font-display);
  font-size: 21px;
  letter-spacing: 0.5px;
}

.context {
  margin: var(--ui-space-1) 0 0;
  font-size: 13px;
}

.close {
  font-size: 25px;
  line-height: 1;
}

.objective-block {
  padding: var(--ui-space-3);
  border-left: 3px solid var(--ui-accent);
  border-radius: 0 var(--ui-radius-sm) var(--ui-radius-sm) 0;
  background: color-mix(in srgb, var(--ui-accent) 7%, var(--ui-surface-inset));
}

.objective-block span,
.milestone-label {
  color: var(--ui-accent);
  font-size: var(--ui-text-micro);
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.objective-block p {
  margin: 5px 0 0;
  color: var(--ui-text);
  font-size: 14px;
  line-height: 1.5;
}

.progress-block {
  padding: var(--ui-space-3);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface-inset);
}

.progress-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: var(--ui-space-3);
  margin-bottom: var(--ui-space-2);
  font-size: 13px;
}

.progress-head .milestone-label {
  grid-column: 1 / -1;
}

.progress-head strong {
  color: var(--ui-text-heading);
}

.remaining {
  margin: var(--ui-space-2) 0 0;
  font-size: 11px;
}

.remaining.complete {
  color: var(--win);
  font-weight: 700;
}

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: var(--ui-space-2) var(--ui-space-4);
  margin: 0;
}

.facts div {
  display: flex;
  justify-content: space-between;
  gap: var(--ui-space-3);
  padding-bottom: var(--ui-space-2);
  border-bottom: 1px solid var(--ui-divider);
  font-size: 12px;
}

.facts dt {
  color: var(--ui-text-subtle);
}

.facts dd {
  margin: 0;
  text-align: right;
}

.tags {
  display: flex;
  gap: var(--ui-space-2);
}

.tag {
  padding: 2px 6px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  color: var(--ui-accent);
  font-size: 12px;
  letter-spacing: 0.8px;
  text-transform: uppercase;
}

.tag.apex {
  border-color: #b06ec9;
  color: #e8a0ff;
}

</style>
