<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import MiniBar from "./ui/MiniBar.vue"
import { challengeTierProgress } from "../helpers/challenges"
import { formatDecimal } from "../helpers/format"
import type { ChallengeRow } from "../types/stats"

const props = defineProps<{
  challenge: ChallengeRow
}>()

const emit = defineEmits<{
  (event: "close"): void
}>()

const dialog = ref<HTMLElement | null>(null)

const remaining = computed(() =>
  props.challenge.nextThreshold === null
    ? null
    : Math.max(0, props.challenge.nextThreshold - props.challenge.currentValue),
)

const completedCount = computed(() => {
  try {
    const ids = JSON.parse(props.challenge.completedIds) as unknown
    return Array.isArray(ids) ? ids.length : 0
  } catch {
    return 0
  }
})

const gameModes = computed(() => {
  try {
    const modes = JSON.parse(props.challenge.gameModes) as unknown
    return Array.isArray(modes)
      ? modes.filter((mode): mode is string => typeof mode === "string")
      : []
  } catch {
    return []
  }
})

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close")
}

onMounted(() => {
  window.addEventListener("keydown", closeOnEscape)
  dialog.value?.focus()
})

onBeforeUnmount(() => window.removeEventListener("keydown", closeOnEscape))
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @click.self="emit('close')">
      <section
        ref="dialog"
        class="dialog card"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`challenge-dialog-${challenge.challengeId}`"
        tabindex="-1"
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
            <p class="muted description">{{ challenge.description }}</p>
          </div>
          <button
            class="close"
            type="button"
            title="Close challenge details"
            aria-label="Close challenge details"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="progress-block">
          <div class="progress-head">
            <span>
              {{ challenge.currentLevel }}
              <template v-if="challenge.nextLevel">
                → {{ challenge.nextLevel }}
              </template>
            </span>
            <span class="numeric">
              {{ formatDecimal(challenge.currentValue, 0) }}
              <template v-if="challenge.nextThreshold !== null">
                / {{ formatDecimal(challenge.nextThreshold, 0) }}
              </template>
            </span>
          </div>
          <MiniBar :value="challengeTierProgress(challenge)" />
          <p v-if="remaining !== null" class="muted remaining">
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
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow-y: auto;
  padding: var(--space-6) var(--space-5);
  background: rgba(3, 8, 18, 0.76);
}

.dialog {
  width: min(680px, 100%);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
}

.dialog:focus {
  outline: none;
}

.dialog-head {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--space-3);
}

.tier {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  color: var(--gold-bright);
  font-family: var(--font-display);
  font-size: 18px;
}

.heading h2 {
  margin: 0;
  color: var(--gold-bright);
  font-family: var(--font-display);
  font-size: 21px;
  letter-spacing: 0.5px;
}

.description {
  margin: var(--space-1) 0 0;
  font-size: 13px;
}

.close {
  border: 0;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 25px;
  line-height: 1;
}

.close:hover {
  color: var(--text-primary);
}

.progress-block {
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-2);
}

.progress-head {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
  font-size: 13px;
}

.remaining {
  margin: var(--space-2) 0 0;
  font-size: 11px;
}

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: var(--space-2) var(--space-4);
  margin: 0;
}

.facts div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
  font-size: 12px;
}

.facts dt {
  color: var(--text-secondary);
}

.facts dd {
  margin: 0;
  text-align: right;
}

.tags {
  display: flex;
  gap: var(--space-2);
}

.tag {
  padding: 2px 6px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--gold);
  font-size: 10px;
  letter-spacing: 0.8px;
  text-transform: uppercase;
}

.tag.apex {
  border-color: #b06ec9;
  color: #e8a0ff;
}

@media (max-width: 620px) {
  .backdrop {
    padding: var(--space-3);
  }

  .dialog {
    padding: var(--space-4);
  }
}
</style>
