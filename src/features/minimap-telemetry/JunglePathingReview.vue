<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue"
import { api } from "../../helpers/api.js"
import type { MinimapPathingReview } from "../../shared/minimap/review.js"
import type { PathSegment } from "../../shared/minimap/contracts.js"

const props = defineProps<{ gameId: number }>()
const loading = ref(false)
const error = ref<string>()
const review = ref<MinimapPathingReview>()
const selectedParticipant = ref<string>()
const canvas = ref<HTMLCanvasElement>()

const reliableSegments = computed(() => (review.value?.segments ?? []).filter(
  (segment) => segment.modelVersion >= 2,
))
const participants = computed(() => [...new Set(
  reliableSegments.value.map((segment) => segment.participantKey),
)])
const selectedSegments = computed(() => (review.value?.segments ?? []).filter(
  (segment) => segment.modelVersion >= 2 &&
    segment.participantKey === selectedParticipant.value,
))
const hasTelemetry = computed(() =>
  reliableSegments.value.length > 0 ||
  (review.value?.campClears.length ?? 0) > 0,
)
const formatTime = (milliseconds: number) => {
  const total = Math.max(0, milliseconds) / 1_000
  const minutes = Math.floor(total / 60)
  return `${minutes}:${(total % 60).toFixed(1).padStart(4, "0")}`
}
const confidenceLabel = (value: number) =>
  value >= 0.8 ? "High" : value >= 0.55 ? "Medium" : "Low"

async function load() {
  loading.value = true
  error.value = undefined
  try {
    review.value = await api.getJunglePathingReview(props.gameId)
    selectedParticipant.value = participants.value[0]
    await nextTick()
    draw()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Could not load minimap telemetry"
  } finally {
    loading.value = false
  }
}

function strokeObserved(context: CanvasRenderingContext2D) {
  context.setLineDash([])
  context.globalAlpha = 0.95
  context.lineWidth = 2.5
}

function drawSighting(
  context: CanvasRenderingContext2D,
  point: PathSegment["points"][number],
  size: number,
) {
  context.beginPath()
  context.arc(point.x * size, point.y * size, 2.5, 0, Math.PI * 2)
  context.fill()
}

function draw() {
  const element = canvas.value
  if (!element) return
  const pixelRatio = window.devicePixelRatio || 1
  const size = Math.max(320, element.clientWidth)
  element.width = Math.round(size * pixelRatio)
  element.height = Math.round(size * pixelRatio)
  const context = element.getContext("2d")
  if (!context) return
  context.scale(pixelRatio, pixelRatio)
  context.clearRect(0, 0, size, size)
  context.fillStyle = "rgba(9, 19, 24, 0.96)"
  context.fillRect(0, 0, size, size)
  context.strokeStyle = "rgba(112, 180, 190, 0.17)"
  context.lineWidth = 1
  for (const fraction of [0.25, 0.5, 0.75]) {
    context.beginPath()
    context.moveTo(size * fraction, 0)
    context.lineTo(size * fraction, size)
    context.moveTo(0, size * fraction)
    context.lineTo(size, size * fraction)
    context.stroke()
  }
  context.strokeStyle = "rgba(98, 217, 226, 0.95)"
  context.fillStyle = "rgba(98, 217, 226, 0.65)"
  for (const segment of selectedSegments.value) {
    if (segment.kind !== "observed") {
      // Unknown, inferred, and interpolated records contain sightings but no
      // pixel-supported route. Draw the endpoints without joining them.
      context.globalAlpha = 0.55
      for (const point of segment.points) drawSighting(context, point, size)
      continue
    }
    if (segment.points.length < 2) continue
    strokeObserved(context)
    context.beginPath()
    segment.points.forEach((point, index) => {
      const x = point.x * size
      const y = point.y * size
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    context.stroke()
  }
  context.globalAlpha = 1
  context.setLineDash([])
}

watch(() => props.gameId, load)
watch(selectedParticipant, () => nextTick(draw))
onMounted(load)
</script>

<template>
  <section class="telemetry-review" aria-label="Jungle clear and pathing review">
    <header>
      <div>
        <p class="eyebrow">Minimap telemetry</p>
        <h3>Jungle clear and pathing</h3>
      </div>
      <span class="postgame-badge">Observed minimap evidence</span>
    </header>

    <p v-if="loading">Loading minimap telemetry…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <p v-else-if="!hasTelemetry" class="empty">
      No minimap telemetry was captured for this match.
    </p>

    <template v-else>
      <div class="path-layout">
        <div class="map-panel">
          <label>
            Champion track
            <select v-model="selectedParticipant">
              <option v-for="participant in participants" :key="participant" :value="participant">
                {{ participant }}
              </option>
            </select>
          </label>
          <canvas ref="canvas" />
          <div class="legend">
            <span><i class="observed" />Observed</span>
            <span><i class="unknown" />Separated sightings (route unknown)</span>
          </div>
        </div>

        <div class="camp-panel">
          <h4>Camp completion splits</h4>
          <table>
            <thead><tr><th>Camp</th><th>Time</th><th>Source</th><th>Attribution</th></tr></thead>
            <tbody>
              <tr v-for="clear in review?.campClears" :key="`${clear.campKey}:${clear.clearedAtMs}`">
                <td>{{ clear.campKey.replaceAll("_", " ") }}</td>
                <td>{{ formatTime(clear.clearedAtMs) }}</td>
                <td>{{ clear.source === "minimap_cv" ? "Minimap" : "Estimated" }}</td>
                <td>
                  {{ clear.attribution }} · {{ confidenceLabel(clear.attributionConfidence) }}
                </td>
              </tr>
              <tr v-if="review?.campClears.length === 0">
                <td colspan="4">No camp transitions met the confidence threshold.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.telemetry-review { display: grid; gap: 16px; }
header { display: flex; align-items: start; justify-content: space-between; gap: 16px; }
h3, h4, p { margin: 0; }
.eyebrow { opacity: .62; font-size: 12px; text-transform: uppercase; letter-spacing: .12em; }
.postgame-badge { padding: 6px 9px; border: 1px solid currentColor; border-radius: 999px; opacity: .72; font-size: 12px; }
.path-layout { display: grid; grid-template-columns: minmax(300px, .85fr) minmax(420px, 1.15fr); gap: 18px; }
.map-panel, .camp-panel { border: 1px solid rgba(128, 160, 170, .2); border-radius: 12px; padding: 14px; background: rgba(9, 18, 22, .42); }
.map-panel { display: grid; gap: 10px; }
label { display: flex; justify-content: space-between; gap: 12px; align-items: center; font-size: 13px; }
select { min-width: 190px; max-width: 65%; }
canvas { width: 100%; aspect-ratio: 1; border-radius: 8px; }
.legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; opacity: .75; }
.legend span { display: inline-flex; gap: 5px; align-items: center; }
.legend i { width: 18px; border-top: 2px solid currentColor; }
.legend .unknown { width: 5px; height: 5px; border: 0; border-radius: 50%; background: currentColor; opacity: .55; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
th, td { text-align: left; padding: 9px 7px; border-bottom: 1px solid rgba(128, 160, 170, .14); }
th { opacity: .62; font-weight: 600; }
.error { color: #e98f8f; }
.empty { opacity: .68; }
@media (max-width: 900px) { .path-layout { grid-template-columns: 1fr; } }
</style>
