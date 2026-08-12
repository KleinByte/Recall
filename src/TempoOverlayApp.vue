<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import TempoGauge from "./components/TempoGauge.vue"
import { api } from "./helpers/api"
import { useApiEvents } from "./helpers/use-api-events"
import type { TempoOverlayStatus } from "./types/app"
import type { LiveSession } from "./types/live"

const empty: LiveSession = {
  phase: "Idle",
  benchChampionIds: [],
  allies: [],
  enemies: [],
  updatedAt: 0,
}
const live = ref<LiveSession>(empty)
const status = ref<TempoOverlayStatus>({
  visible: false,
  locked: false,
  shortcutRegistered: false,
})
const events = useApiEvents()
const tempo = computed(() => live.value.game?.analysis?.tempo)
const directionLabel = computed(() => ({
  up: "Rising",
  steady: "Steady",
  down: "Falling",
})[tempo.value?.direction ?? "steady"])

async function lockOverlay() {
  status.value = await api.lockTempoOverlay()
}

onMounted(async () => {
  const [session, overlayStatus] = await Promise.all([
    api.getLiveSession(),
    api.getTempoOverlayStatus(),
  ])
  live.value = session
  status.value = overlayStatus
  events.on("live:updated", (next: LiveSession) => { live.value = next })
  events.on("tempo-overlay:status", (next: TempoOverlayStatus) => {
    status.value = next
  })
})
</script>

<template>
  <main class="tempo-overlay" :class="{ locked: status.locked }">
    <header class="overlay-handle">
      <span class="handle-grip" aria-hidden="true">••••</span>
      <strong>Tempo</strong>
      <span v-if="tempo" class="direction" :class="tempo.direction">
        {{ directionLabel }}
      </span>
      <button
        v-if="!status.locked"
        type="button"
        class="lock-button"
        title="Make the overlay click-through until it is reopened"
        @click="lockOverlay"
      >Lock</button>
    </header>

    <TempoGauge
      v-if="tempo"
      class="overlay-gauge"
      :score="tempo.score"
      :label="tempo.label"
      :direction="tempo.direction"
      :surge-tier="tempo.surgeTier"
    />
    <section v-else class="waiting" aria-live="polite">
      <strong>Waiting for live Tempo</strong>
      <span>Start a game and the dial will update automatically.</span>
    </section>

    <footer v-if="!status.locked">
      Drag anywhere on the bezel, then lock it for click-through play.
    </footer>
  </main>
</template>

<style scoped>
.tempo-overlay {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ui-accent) 55%, transparent);
  border-radius: 15px;
  background:
    radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--ui-live) 10%, transparent), transparent 47%),
    color-mix(in srgb, var(--ui-canvas) 94%, transparent);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .025), 0 12px 34px rgba(0, 0, 0, .48);
  color: var(--ui-text);
  -webkit-app-region: drag;
  user-select: none;
}

.tempo-overlay.locked {
  border-color: color-mix(in srgb, var(--ui-live) 30%, transparent);
}

.overlay-handle {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 5px 9px 3px;
  color: var(--ui-text-heading);
  font: 12px var(--ui-font-heading);
  letter-spacing: .8px;
  text-transform: uppercase;
}

.handle-grip {
  color: var(--ui-text-faint);
  font-size: 11px;
  letter-spacing: 1px;
}

.direction {
  color: var(--ui-text-subtle);
  font: 11px var(--ui-font-body);
  letter-spacing: .5px;
}

.direction.up { color: var(--ui-positive); }
.direction.down { color: var(--ui-negative); }

.lock-button {
  min-height: 23px;
  margin-left: auto;
  padding: 2px 9px;
  border: 1px solid var(--ui-border-emphasis);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-control-background);
  color: var(--ui-accent-strong);
  font: 11px var(--ui-font-body);
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.overlay-gauge {
  margin-top: -2px;
  pointer-events: none;
}

.waiting {
  display: grid;
  place-content: center;
  gap: 5px;
  height: 170px;
  padding: 20px;
  text-align: center;
}

.waiting strong {
  color: var(--ui-text-heading);
  font: 16px var(--ui-font-heading);
}

.waiting span,
footer {
  color: var(--ui-text-subtle);
  font-size: 11px;
}

footer {
  position: absolute;
  inset: auto 10px 7px;
  text-align: center;
  pointer-events: none;
}
</style>
