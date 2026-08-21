<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue"
import { api } from "./helpers/api"
import { useApiEvents } from "./helpers/use-api-events"
import { SUMMONERS_RIFT_CAMPS } from "./shared/minimap/camp-map"
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
const previewCanvas = ref<HTMLCanvasElement>()
const status = ref<MinimapVisionDebugStatus>({ visible: false, locked: false })
const events = useApiEvents()
type DebugMarker =
  | (MinimapVisionDebugSnapshot["proposals"][number] & { kind: "proposal" })
  | (MinimapVisionDebugSnapshot["detections"][number] & { kind: "detection"; radius: number })
  | (MinimapVisionDebugSnapshot["confirmed"][number] & { kind: "confirmed" })
const visibleProposals = computed(() => [...snapshot.value.proposals]
  .filter((proposal) => proposal.identityAccepted ||
    (proposal.identityScore ?? 0) >= 0.7 && (proposal.identityMargin ?? 0) >= 0.035)
  .sort((left, right) => Number(right.identityAccepted) - Number(left.identityAccepted) ||
    (right.identityScore ?? 0) - (left.identityScore ?? 0))
  .slice(0, 12))
const markers = computed<DebugMarker[]>(() => [
  ...visibleProposals.value.map((marker) => ({ ...marker, kind: "proposal" as const })),
  ...snapshot.value.detections.map((marker) => ({ ...marker, kind: "detection" as const, radius: 0, confidence: marker.confidence })),
  ...snapshot.value.confirmed.map((marker) => ({ ...marker, kind: "confirmed" as const })),
])
const campMarkers = computed(() => {
  const states = new Map(snapshot.value.camps.map((camp) => [camp.campKey, camp]))
  return SUMMONERS_RIFT_CAMPS.filter((camp, index, all) => all.findIndex((candidate) =>
    candidate.center.x === camp.center.x && candidate.center.y === camp.center.y) === index)
    .map((camp) => ({ ...camp, state: states.get(camp.key)?.state ?? "unknown" }))
})
const sourceSummary = computed(() => snapshot.value.health.sourceName ??
  snapshot.value.health.candidateSourceNames?.join(", ") ?? "No eligible League game window")
const retrySummary = computed(() => {
  const retryAt = snapshot.value.health.nextRetryAt
  if (!retryAt) return undefined
  return `${Math.max(0, (retryAt - Date.now()) / 1_000).toFixed(1)}s`
})
const proposalDiagnostics = computed(() => [...snapshot.value.proposals]
  .filter((proposal) => proposal.identityCandidate)
  .sort((left, right) => (right.identityScore ?? 0) - (left.identityScore ?? 0))
  .slice(0, 8))
const percent = (value?: number) => value === undefined ? "—" : `${(value * 100).toFixed(0)}%`
const metric = (value?: number, digits = 2) => value === undefined ? "—" : value.toFixed(digits)
const markerTitle = (marker: DebugMarker) => {
  if (marker.kind !== "proposal") return marker.championName
    ? `${marker.kind}: ${marker.championName}`
    : marker.kind
  const candidate = marker.identityCandidate
    ? ` · ${marker.identityCandidate} ${percent(marker.identityScore)} / margin ${percent(marker.identityMargin)}`
    : " · no identity candidate"
  const ring = marker.ringSupport === undefined
    ? ""
    : ` · ring ${percent(marker.ringSupport)} / ${marker.ringSectors ?? 0} sectors`
  return `${marker.team} ${marker.proposalSource ?? "proposal"} · ${marker.diameterPx?.toFixed(1) ?? "?"}px${ring}${candidate}`
}

async function lockOverlay() {
  status.value = await api.lockMinimapVisionDebugOverlay()
}

async function updateSnapshot(next: MinimapVisionDebugSnapshot) {
  snapshot.value = next
  if (!next.imageRgba || !next.imageWidth || !next.imageHeight) return
  await nextTick()
  const canvas = previewCanvas.value
  const context = canvas?.getContext("2d", { alpha: false })
  if (!canvas || !context) return
  if (canvas.width !== next.imageWidth) canvas.width = next.imageWidth
  if (canvas.height !== next.imageHeight) canvas.height = next.imageHeight
  // Copy into this renderer realm so ImageData remains reliable across
  // Electron contextBridge/structured-clone boundaries.
  const pixels = Uint8ClampedArray.from(next.imageRgba)
  context.putImageData(new ImageData(pixels, next.imageWidth, next.imageHeight), 0, 0)
}

onMounted(async () => {
  const [overlayStatus] = await Promise.all([api.getMinimapVisionDebugStatus()])
  status.value = overlayStatus
  events.on("minimap-vision-debug:update", (next: MinimapVisionDebugSnapshot) => { void updateSnapshot(next) })
  events.on("minimap-vision-debug:status", (next: MinimapVisionDebugStatus) => { status.value = next })
})
</script>

<template>
  <main class="minimap-debug" :class="{ locked: status.locked }">
    <header class="debug-handle">
      <span class="handle-grip" aria-hidden="true">••••</span>
      <strong>MINIMAP CV DEBUG</strong>
      <span class="state">{{ snapshot.state }}</span>
      <span v-if="snapshot.health.eligibilityReason" class="eligibility">
        {{ snapshot.health.eligibilityReason.replaceAll("_", " ") }}
      </span>
      <button v-if="!status.locked" type="button" @click="lockOverlay">Lock</button>
    </header>

    <section class="preview" aria-label="bounded minimap preview">
      <canvas
        v-if="snapshot.imageRgba"
        ref="previewCanvas"
        aria-label="Bounded minimap ROI"
      />
      <span
        v-for="camp in campMarkers"
        :key="camp.key"
        class="camp-marker"
        :class="camp.state"
        :style="{ left: `${camp.center.x * 100}%`, top: `${camp.center.y * 100}%` }"
        :title="`${camp.key.replaceAll('_', ' ')}: ${camp.state}`"
      />
      <span
        v-for="(marker, index) in markers"
        :key="`${marker.kind}-${index}-${marker.x}-${marker.y}`"
        class="marker"
        :class="[marker.kind, marker.team]"
        :style="{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }"
        :title="markerTitle(marker)"
      />
      <span v-if="!snapshot.imageRgba" class="waiting">Waiting for a live minimap ROI…</span>
    </section>

    <div class="metrics">
      <span>FPS {{ snapshot.health.achievedFps.toFixed(1) }}</span>
      <span>Frames {{ snapshot.health.processedFrames }}</span>
      <span>Rejected {{ snapshot.health.rejectedFrames }}</span>
      <span>Proposals {{ snapshot.proposals.length }}</span>
      <span>Detections {{ snapshot.detections.length }}</span>
      <span>Confirmed {{ snapshot.confirmed.length }}</span>
    </div>
    <p class="calibration">
      Calibration:
      {{ snapshot.calibration
        ? `${snapshot.calibration.placement} · confidence ${(snapshot.calibration.confidence * 100).toFixed(0)}% · outer ${snapshot.calibration.minimapRect.x},${snapshot.calibration.minimapRect.y} ${snapshot.calibration.minimapRect.width}×${snapshot.calibration.minimapRect.height} · inner ${snapshot.calibration.innerMapRect.x.toFixed(0)},${snapshot.calibration.innerMapRect.y.toFixed(0)} ${snapshot.calibration.innerMapRect.width.toFixed(0)}×${snapshot.calibration.innerMapRect.height.toFixed(0)}`
        : "not found" }}
    </p>
    <div class="identity-strip" aria-label="top champion identity candidates">
      <span
        v-for="(proposal, index) in proposalDiagnostics"
        :key="`${proposal.team}-${proposal.x}-${proposal.y}-${index}`"
        :class="{ accepted: proposal.identityAccepted }"
      >
        {{ proposal.team === "ally" ? "A" : "E" }} · {{ proposal.identityCandidate }}
        {{ percent(proposal.identityScore) }} · Δ{{ percent(proposal.identityMargin) }} ·
        {{ proposal.diameterPx?.toFixed(0) ?? "?" }}px · {{ proposal.proposalSource ?? "component" }}
      </span>
    </div>
    <dl class="diagnostics">
      <div>
        <dt>Capture</dt>
        <dd>{{ snapshot.health.backendState ?? "idle" }} · {{ snapshot.health.captureMode ?? "no mode" }} · {{ snapshot.health.frameDeliveryMode ?? "no frames" }} · {{ snapshot.health.captureStage ?? "idle" }} · starts {{ snapshot.health.startupAttempts ?? 0 }}<span v-if="retrySummary"> · retry {{ retrySummary }}</span></dd>
      </div>
      <div>
        <dt>Frame path</dt>
        <dd>renderer {{ snapshot.health.rendererFrameSerial ?? 0 }} · paints {{ snapshot.health.paintEventCount ?? 0 }}<span v-if="snapshot.health.paintSizeMismatchCount">/{{ snapshot.health.paintSizeMismatchCount }} mismatched</span> · snapshots {{ snapshot.health.snapshotCaptureCount ?? 0 }}<span v-if="snapshot.health.lastPaintSize"> · last {{ snapshot.health.lastPaintSize }}</span></dd>
      </div>
      <div>
        <dt>Window</dt>
        <dd :title="sourceSummary">{{ sourceSummary }}</dd>
      </div>
      <div>
        <dt>Discovery</dt>
        <dd>{{ snapshot.health.candidateSourceCount ?? 0 }}/{{ snapshot.health.discoveredWindowCount ?? 0 }} eligible · scans {{ snapshot.health.sourceDiscoveryAttempts ?? 0 }}</dd>
      </div>
      <div>
        <dt>Templates</dt>
        <dd>{{ snapshot.health.templateCount ?? 0 }}/{{ snapshot.health.rosterCount ?? 0 }} · local {{ snapshot.health.localTemplateAvailable === undefined ? "unknown" : snapshot.health.localTemplateAvailable ? "ready" : "missing" }}<span v-if="snapshot.health.templateErrorCode"> · {{ snapshot.health.templateErrorCode }}</span></dd>
      </div>
      <div>
        <dt>Locator</dt>
        <dd>{{ snapshot.health.calibrationCandidatesValid ?? 0 }}/{{ snapshot.health.calibrationCandidatesEvaluated ?? 0 }} valid · best {{ percent(snapshot.health.calibrationBestScore) }}</dd>
      </div>
      <div>
        <dt>Visual</dt>
        <dd>variance {{ metric(snapshot.health.calibrationVariance, 0) }} · edges {{ percent(snapshot.health.calibrationEdgeDensity) }} · color {{ percent(snapshot.health.calibrationColoredRatio) }}</dd>
      </div>
      <div>
        <dt>Vision</dt>
        <dd>{{ snapshot.health.visionEngine ?? "not loaded" }}<span v-if="snapshot.health.opencvVersion"> · OpenCV {{ snapshot.health.opencvVersion }}</span> · worker {{ snapshot.health.visionWorkerState ?? "idle" }} · restarts {{ snapshot.health.visionWorkerRestarts ?? 0 }}</dd>
      </div>
      <div>
        <dt>CV timing</dt>
        <dd>total {{ metric(snapshot.health.visionProcessingMs, 1) }}ms · champions {{ metric(snapshot.health.visionChampionMs, 1) }}ms · camps {{ metric(snapshot.health.visionCampMs, 1) }}ms</dd>
      </div>
      <div>
        <dt>Live clock</dt>
        <dd>{{ snapshot.health.clockReady ? "ready" : "waiting" }} · {{ snapshot.health.clockSampleCount ?? 0 }} samples<span v-if="snapshot.health.lastEvidenceErrorCode"> · {{ snapshot.health.lastEvidenceErrorCode }}</span></dd>
      </div>
      <div>
        <dt>Camp fallback</dt>
        <dd>{{ snapshot.health.inferredCampClears ?? 0 }} inferred</dd>
      </div>
      <div v-if="snapshot.health.lastErrorCode || snapshot.health.calibrationFailureReason" class="error-row">
        <dt>Error</dt>
        <dd>{{ snapshot.health.lastErrorCode ?? snapshot.health.calibrationFailureReason }}</dd>
      </div>
      <div v-if="snapshot.health.lastErrorDetail" class="error-row detail-row">
        <dt>Detail</dt>
        <dd :title="snapshot.health.lastErrorDetail">{{ snapshot.health.lastErrorDetail }}</dd>
      </div>
    </dl>
    <div class="camp-strip">
      <span v-for="camp in snapshot.camps" :key="camp.campKey" :class="camp.state" :title="camp.campKey">
        {{ camp.campKey.replaceAll("_", " ") }}: {{ camp.state }}
      </span>
    </div>
    <footer v-if="!status.locked">Drag the bezel to place; Lock makes this window click-through.</footer>
  </main>
</template>

<style scoped>
.minimap-debug { width: 100vw; height: 100vh; overflow-x: hidden; overflow-y: auto; padding: 8px; border: 1px solid #e4a83c; border-radius: 12px; background: rgba(12, 16, 24, .94); color: #f4f0e6; font: 11px system-ui, sans-serif; -webkit-app-region: drag; user-select: none; }
.minimap-debug.locked { border-color: #63d29d; }
.debug-handle { display: flex; align-items: center; gap: 7px; height: 24px; letter-spacing: 1px; }
.handle-grip { color: #8995a6; }
.state { color: #e4a83c; text-transform: uppercase; }
.eligibility { max-width: 150px; overflow: hidden; color: #9da9b8; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
button { margin-left: auto; padding: 2px 8px; border: 1px solid #69778a; border-radius: 4px; background: #202b3b; color: #fff; cursor: pointer; -webkit-app-region: no-drag; }
.preview { position: relative; width: 100%; aspect-ratio: 1; overflow: hidden; border: 1px solid #536073; background: #070a0f; }
.preview canvas { display: block; width: 100%; height: 100%; object-fit: contain; image-rendering: auto; }
.marker { position: absolute; width: 10px; height: 10px; transform: translate(-50%, -50%); border: 2px solid #f2b84b; border-radius: 50%; box-sizing: border-box; }
.marker.confirmed { width: 16px; height: 16px; border-color: #71e49e; }
.marker.detection { width: 12px; height: 12px; border-color: #d9a8ff; border-style: dashed; }
.marker.ally { box-shadow: 0 0 0 1px #4ac5ff; }
.marker.enemy { box-shadow: 0 0 0 1px #ff6969; }
.camp-marker { position: absolute; width: 5px; height: 5px; transform: translate(-50%, -50%) rotate(45deg); border: 1px solid #8c96a5; background: rgba(12, 16, 24, .75); box-sizing: border-box; }
.camp-marker.alive { border-color: #71e49e; background: rgba(113, 228, 158, .5); }
.camp-marker.dead, .camp-marker.respawn_long, .camp-marker.respawn_soon { border-color: #ff7c7c; background: rgba(255, 80, 80, .45); }
.waiting { position: absolute; inset: 0; display: grid; place-items: center; color: #aab3c0; }
.metrics { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 6px; color: #b8c1cf; font-variant-numeric: tabular-nums; }
.calibration { margin: 5px 0; color: #cad2dd; line-height: 1.35; }
.identity-strip { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 7px; margin: 4px 0; color: #9ca7b6; font-variant-numeric: tabular-nums; }
.identity-strip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.identity-strip .accepted { color: #71e49e; }
.diagnostics { display: grid; gap: 2px; margin: 5px 0; font-variant-numeric: tabular-nums; }
.diagnostics > div { display: grid; grid-template-columns: 75px minmax(0, 1fr); gap: 6px; }
.diagnostics dt { color: #8995a6; }
.diagnostics dd { min-width: 0; margin: 0; overflow: hidden; color: #cad2dd; text-overflow: ellipsis; white-space: nowrap; }
.diagnostics .error-row dd { color: #ff9a9a; }
.diagnostics .detail-row dd { white-space: normal; overflow-wrap: anywhere; }
.camp-strip { display: flex; flex-wrap: wrap; gap: 3px 7px; max-height: 45px; overflow: hidden; color: #aab3c0; font-size: 11px; }
.camp-strip .dead { color: #ff8888; } .camp-strip .alive { color: #71e49e; }
footer { padding-top: 5px; color: #8995a6; text-align: center; }
</style>
