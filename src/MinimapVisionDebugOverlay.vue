<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { api } from "./helpers/api"
import { useApiEvents } from "./helpers/use-api-events"
import type { MinimapVisionDebugSnapshot, MinimapVisionDebugStatus } from "./types/app"

const empty: MinimapVisionDebugSnapshot = {
  enabled: false,
  state: "idle",
  updatedAt: 0,
  proposals: [],
  detections: [],
  confirmed: [],
  camps: [],
  health: { achievedFps: 0, captureAttempts: 0, processedFrames: 0, rejectedFrames: 0, calibrationFailures: 0 },
}
const snapshot = ref(empty)
const status = ref<MinimapVisionDebugStatus>({ visible: false, locked: false })
const events = useApiEvents()
const markers = computed(() => [
  ...snapshot.value.proposals.map((marker) => ({ ...marker, kind: "proposal" })),
  ...snapshot.value.detections.map((marker) => ({ ...marker, kind: "detection", radius: 0, confidence: marker.confidence })),
  ...snapshot.value.confirmed.map((marker) => ({ ...marker, kind: "confirmed" })),
])

async function lockOverlay() {
  status.value = await api.lockMinimapVisionDebugOverlay()
}

onMounted(async () => {
  const [overlayStatus] = await Promise.all([api.getMinimapVisionDebugStatus()])
  status.value = overlayStatus
  events.on("minimap-vision-debug:update", (next: MinimapVisionDebugSnapshot) => { snapshot.value = next })
  events.on("minimap-vision-debug:status", (next: MinimapVisionDebugStatus) => { status.value = next })
})
</script>

<template>
  <main class="minimap-debug" :class="{ locked: status.locked }">
    <header class="debug-handle">
      <span class="handle-grip" aria-hidden="true">••••</span>
      <strong>MINIMAP CV DEBUG</strong>
      <span class="state">{{ snapshot.state }}</span>
      <button v-if="!status.locked" type="button" @click="lockOverlay">Lock</button>
    </header>

    <section class="preview" aria-label="bounded minimap preview">
      <img v-if="snapshot.imageData" :src="snapshot.imageData" alt="Bounded minimap ROI" />
      <span
        v-for="(marker, index) in markers"
        :key="`${marker.kind}-${index}-${marker.x}-${marker.y}`"
        class="marker"
        :class="[marker.kind, marker.team]"
        :style="{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }"
        :title="marker.kind"
      />
      <span v-if="!snapshot.imageData" class="waiting">Waiting for a live minimap ROI…</span>
    </section>

    <div class="metrics">
      <span>FPS {{ snapshot.health.achievedFps.toFixed(1) }}</span>
      <span>Frames {{ snapshot.health.processedFrames }}</span>
      <span>Rejected {{ snapshot.health.rejectedFrames }}</span>
      <span>Proposals {{ snapshot.proposals.length }}</span>
      <span>Confirmed {{ snapshot.confirmed.length }}</span>
    </div>
    <p class="calibration">
      Calibration:
      {{ snapshot.calibration
        ? `${snapshot.calibration.placement} · confidence ${(snapshot.calibration.confidence * 100).toFixed(0)}% · ROI ${snapshot.calibration.minimapRect.x},${snapshot.calibration.minimapRect.y} ${snapshot.calibration.minimapRect.width}×${snapshot.calibration.minimapRect.height}`
        : "not found" }}
      <span v-if="snapshot.health.lastErrorCode"> · {{ snapshot.health.lastErrorCode }}</span>
    </p>
    <div class="camp-strip">
      <span v-for="camp in snapshot.camps" :key="camp.campKey" :class="camp.state" :title="camp.campKey">
        {{ camp.campKey.replaceAll("_", " ") }}: {{ camp.state }}
      </span>
    </div>
    <footer v-if="!status.locked">Drag the bezel to place; Lock makes this window click-through.</footer>
  </main>
</template>

<style scoped>
.minimap-debug { width: 100vw; height: 100vh; overflow: hidden; padding: 8px; border: 1px solid #e4a83c; border-radius: 12px; background: rgba(12, 16, 24, .94); color: #f4f0e6; font: 11px system-ui, sans-serif; -webkit-app-region: drag; user-select: none; }
.minimap-debug.locked { border-color: #63d29d; }
.debug-handle { display: flex; align-items: center; gap: 7px; height: 24px; letter-spacing: 1px; }
.handle-grip { color: #8995a6; }
.state { color: #e4a83c; text-transform: uppercase; }
button { margin-left: auto; padding: 2px 8px; border: 1px solid #69778a; border-radius: 4px; background: #202b3b; color: #fff; cursor: pointer; -webkit-app-region: no-drag; }
.preview { position: relative; width: 100%; aspect-ratio: 1; overflow: hidden; border: 1px solid #536073; background: #070a0f; }
.preview img { display: block; width: 100%; height: 100%; object-fit: contain; image-rendering: auto; }
.marker { position: absolute; width: 10px; height: 10px; transform: translate(-50%, -50%); border: 2px solid #f2b84b; border-radius: 50%; box-sizing: border-box; }
.marker.confirmed { width: 16px; height: 16px; border-color: #71e49e; }
.marker.detection { width: 12px; height: 12px; border-color: #d9a8ff; border-style: dashed; }
.marker.ally { box-shadow: 0 0 0 1px #4ac5ff; }
.marker.enemy { box-shadow: 0 0 0 1px #ff6969; }
.waiting { position: absolute; inset: 0; display: grid; place-items: center; color: #aab3c0; }
.metrics { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 6px; color: #b8c1cf; font-variant-numeric: tabular-nums; }
.calibration { margin: 5px 0; color: #cad2dd; line-height: 1.35; }
.camp-strip { display: flex; flex-wrap: wrap; gap: 3px 7px; max-height: 45px; overflow: hidden; color: #aab3c0; font-size: 11px; }
.camp-strip .dead { color: #ff8888; } .camp-strip .alive { color: #71e49e; }
footer { padding-top: 5px; color: #8995a6; text-align: center; }
</style>
