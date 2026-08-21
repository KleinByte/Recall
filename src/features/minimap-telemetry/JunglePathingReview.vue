<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { api } from "../../helpers/api.js"
import { publicAssetUrl } from "../../helpers/assets.js"
import { SUMMONERS_RIFT_CAMPS } from "../../shared/minimap/camp-map.js"
import {
  deriveInitialJungleClear,
  FULL_CLEAR_CAMP_COUNT,
} from "../../shared/minimap/jungle-clear.js"
import type {
  CampClearEvent,
  NormalizedPoint,
  PathSegment,
} from "../../shared/minimap/contracts.js"
import type { MinimapPathingReview } from "../../shared/minimap/review.js"

const props = defineProps<{
  gameId: number
  pathingReview?: MinimapPathingReview
  managed?: boolean
  pathingLoading?: boolean
  pathingError?: string
}>()
const localLoading = ref(false)
const localError = ref<string>()
const loadedReview = ref<MinimapPathingReview>()
const loading = computed(() => props.managed ? props.pathingLoading === true : localLoading.value)
const error = computed(() => props.managed ? props.pathingError : localError.value)
const review = computed(() => props.managed ? props.pathingReview : loadedReview.value)
const selectedParticipant = ref<string>()
const playbackTimeMs = ref(0)
const showcaseCompleteRoute = import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get("showcase") === "jungle"
const playing = ref(false)
const speed = ref(1)
const speedOptions = [0.5, 1, 2, 4, 8] as const
let animationFrame: number | undefined
let previousAnimationTime: number | undefined
let loadSequence = 0

const mapStyle = computed(() => ({
  backgroundImage: `url("${publicAssetUrl("game-data/ui/map11.png")}")`,
}))
const reliableSegments = computed(() => (review.value?.segments ?? []).filter(
  (segment) => segment.modelVersion >= 2,
))
const participants = computed(() => {
  const metadata = new Map(
    (review.value?.participants ?? []).map((participant) => [participant.participantKey, participant]),
  )
  const keys = [...new Set(reliableSegments.value.map((segment) => segment.participantKey))]
  return keys.map((participantKey) => {
    const participant = metadata.get(participantKey)
    return {
      participantKey,
      championName: participant?.championName || participantKey,
      team: participant?.team,
      isLocal: participant?.isLocal ?? false,
    }
  }).sort((left, right) =>
    Number(right.isLocal) - Number(left.isLocal) ||
    (left.team === "ally" ? 0 : 1) - (right.team === "ally" ? 0 : 1) ||
    left.championName.localeCompare(right.championName),
  )
})
const selectedParticipantMetadata = computed(() => participants.value.find(
  (participant) => participant.participantKey === selectedParticipant.value,
))
const selectedSegments = computed(() => reliableSegments.value.filter(
  (segment) => segment.participantKey === selectedParticipant.value,
).sort((left, right) => left.startTimeMs - right.startTimeMs || left.endTimeMs - right.endTimeMs))
const campClears = computed(() => [...(review.value?.campClears ?? [])].sort(
  (left, right) => left.clearedAtMs - right.clearedAtMs || left.campKey.localeCompare(right.campKey),
))
const initialClear = computed(() => deriveInitialJungleClear(campClears.value))
const initialClearRoute = computed(() => initialClear.value.camps
  .map((clear) => campName(clear.campKey)).join(" → "))
const hasTelemetry = computed(() => reliableSegments.value.length > 0 || campClears.value.length > 0)
const duration = computed(() => Math.max(
  0,
  ...reliableSegments.value.map((segment) => segment.endTimeMs),
  ...campClears.value.map((clear) => clear.clearedAtMs),
))
const firstEvidenceTime = computed(() => Math.min(
  ...reliableSegments.value.map((segment) => segment.startTimeMs),
  ...campClears.value.map((clear) => clear.clearedAtMs),
  duration.value,
))
const playbackAvailable = computed(() => hasTelemetry.value && duration.value > 0)
const playbackProgress = computed(() => duration.value > 0
  ? Math.min(100, Math.max(0, playbackTimeMs.value / duration.value * 100))
  : 0)
const observedCoverage = computed(() => {
  const total = selectedSegments.value.reduce(
    (sum, segment) => sum + Math.max(0, segment.endTimeMs - segment.startTimeMs),
    0,
  )
  if (total <= 0) return 0
  const observed = selectedSegments.value.filter((segment) => segment.kind === "observed").reduce(
    (sum, segment) => sum + Math.max(0, segment.endTimeMs - segment.startTimeMs),
    0,
  )
  return Math.round(observed / total * 100)
})

function interpolatedPoint(left: NormalizedPoint, right: NormalizedPoint, fraction: number): NormalizedPoint {
  return {
    x: left.x + (right.x - left.x) * fraction,
    y: left.y + (right.y - left.y) * fraction,
  }
}

function observedPointsAt(segment: PathSegment, timestamp: number): NormalizedPoint[] {
  if (timestamp < segment.startTimeMs || segment.points.length === 0) return []
  if (segment.points.length === 1 || timestamp >= segment.endTimeMs) return segment.points
  const elapsed = Math.max(0, timestamp - segment.startTimeMs)
  const span = Math.max(1, segment.endTimeMs - segment.startTimeMs)
  const pointPosition = Math.min(segment.points.length - 1, elapsed / span * (segment.points.length - 1))
  const completedIndex = Math.floor(pointPosition)
  const points = segment.points.slice(0, completedIndex + 1)
  if (completedIndex < segment.points.length - 1) {
    const fraction = pointPosition - completedIndex
    if (fraction > 0) {
      points.push(interpolatedPoint(
        segment.points[completedIndex],
        segment.points[completedIndex + 1],
        fraction,
      ))
    }
  }
  return points
}

const renderedPaths = computed(() => selectedSegments.value.flatMap((segment, index) => {
  if (segment.kind !== "observed") return []
  const points = observedPointsAt(segment, playbackTimeMs.value)
  if (points.length < 2) return []
  return [{
    key: `${segment.participantKey}:${segment.startTimeMs}:${segment.endTimeMs}:${index}`,
    points: points.map((point) => `${point.x * 100},${point.y * 100}`).join(" "),
    confidence: segment.confidence,
  }]
}))

const separatedSightings = computed(() => selectedSegments.value.flatMap((segment, segmentIndex) => {
  if (segment.kind === "observed" || segment.points.length === 0 || playbackTimeMs.value < segment.startTimeMs) {
    return []
  }
  const visiblePoints = playbackTimeMs.value >= segment.endTimeMs
    ? segment.points
    : [segment.points[0]]
  return visiblePoints.map((point, pointIndex) => ({
    key: `${segment.participantKey}:${segment.startTimeMs}:${segmentIndex}:${pointIndex}`,
    point,
    kind: segment.kind,
    confidence: segment.confidence,
  }))
}))

const currentPoint = computed(() => {
  let candidate: { point: NormalizedPoint; evidenceTime: number; exact: boolean } | undefined
  for (const segment of selectedSegments.value) {
    if (playbackTimeMs.value < segment.startTimeMs || segment.points.length === 0) continue
    if (segment.kind === "observed") {
      const points = observedPointsAt(segment, playbackTimeMs.value)
      const point = points.at(-1)
      if (!point) continue
      const evidenceTime = Math.min(playbackTimeMs.value, segment.endTimeMs)
      if (!candidate || evidenceTime >= candidate.evidenceTime) {
        candidate = { point, evidenceTime, exact: playbackTimeMs.value <= segment.endTimeMs }
      }
      continue
    }
    const ended = playbackTimeMs.value >= segment.endTimeMs
    const point = ended ? segment.points.at(-1) : segment.points[0]
    if (!point) continue
    const evidenceTime = ended ? segment.endTimeMs : segment.startTimeMs
    if (!candidate || evidenceTime >= candidate.evidenceTime) {
      candidate = { point, evidenceTime, exact: false }
    }
  }
  return candidate
})

const campMarkers = computed(() => SUMMONERS_RIFT_CAMPS.map((camp) => {
  const latestClear = campClears.value.filter(
    (clear) => clear.campKey === camp.key && clear.clearedAtMs <= playbackTimeMs.value,
  ).at(-1)
  const respawned = latestClear?.respawnAtMs !== undefined &&
    latestClear.respawnAtMs <= playbackTimeMs.value
  return {
    ...camp,
    latestClear,
    state: latestClear && !respawned ? "cleared" : "available",
  }
}))
const completedClearCount = computed(() => campClears.value.filter(
  (clear) => clear.clearedAtMs <= playbackTimeMs.value,
).length)
const timelineTicks = computed(() => campClears.value.map((clear, index) => ({
  key: `${clear.campKey}:${clear.clearedAtMs}:${index}`,
  left: duration.value > 0 ? clear.clearedAtMs / duration.value * 100 : 0,
  clear,
})))

function participantLabel(participant: typeof participants.value[number]) {
  const ownership = participant.isLocal ? "You" : participant.team === "ally" ? "Ally" : participant.team === "enemy" ? "Enemy" : undefined
  return ownership ? `${participant.championName} · ${ownership}` : participant.championName
}

function campName(campKey: CampClearEvent["campKey"]) {
  return campKey.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")
}

function formatTime(milliseconds: number, tenths = false) {
  const totalSeconds = Math.max(0, milliseconds) / 1_000
  const minutes = Math.floor(totalSeconds / 60)
  if (tenths) return `${minutes}:${(totalSeconds % 60).toFixed(1).padStart(4, "0")}`
  return `${minutes}:${String(Math.floor(totalSeconds % 60)).padStart(2, "0")}`
}

function confidenceLabel(value: number) {
  return value >= 0.8 ? "High" : value >= 0.55 ? "Medium" : "Low"
}

function sourceLabel(source: CampClearEvent["source"]) {
  if (source === "minimap_cv") return "Minimap CV"
  if (source === "live_client_inference") return "Live Client + position"
  return "Manual"
}

function campMarkerStyle(camp: typeof campMarkers.value[number]) {
  return { left: `${camp.center.x * 100}%`, top: `${camp.center.y * 100}%` }
}

function pointStyle(point: NormalizedPoint) {
  return { left: `${point.x * 100}%`, top: `${point.y * 100}%` }
}

function stop() {
  playing.value = false
  previousAnimationTime = undefined
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame)
  animationFrame = undefined
}

function setPlaybackTime(timestamp: number) {
  playbackTimeMs.value = Math.max(0, Math.min(duration.value, timestamp))
}

function setInitialPlaybackTime() {
  setPlaybackTime(showcaseCompleteRoute ? duration.value : firstEvidenceTime.value)
}

function animate(now: number) {
  if (!playing.value) return
  const previous = previousAnimationTime ?? now
  previousAnimationTime = now
  const next = playbackTimeMs.value + (now - previous) * speed.value
  if (next >= duration.value) {
    setPlaybackTime(duration.value)
    stop()
    return
  }
  setPlaybackTime(next)
  animationFrame = requestAnimationFrame(animate)
}

function togglePlayback() {
  if (playing.value) {
    stop()
    return
  }
  if (!playbackAvailable.value) return
  if (playbackTimeMs.value >= duration.value) setPlaybackTime(firstEvidenceTime.value)
  playing.value = true
  previousAnimationTime = undefined
  animationFrame = requestAnimationFrame(animate)
}

function seek(event: Event) {
  stop()
  setPlaybackTime(Number((event.currentTarget as HTMLInputElement).value))
}

function skip(delta: number) {
  stop()
  setPlaybackTime(playbackTimeMs.value + delta)
}

function seekToClear(clear: CampClearEvent) {
  stop()
  setPlaybackTime(clear.clearedAtMs)
}

function handleKeyboard(event: KeyboardEvent) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement || event.target instanceof HTMLSelectElement) return
  if (event.code === "Space") {
    event.preventDefault()
    togglePlayback()
  } else if (event.key === "ArrowLeft") {
    event.preventDefault()
    skip(-5_000)
  } else if (event.key === "ArrowRight") {
    event.preventDefault()
    skip(5_000)
  }
}

async function load() {
  const sequence = ++loadSequence
  stop()
  localLoading.value = true
  localError.value = undefined
  loadedReview.value = undefined
  selectedParticipant.value = undefined
  playbackTimeMs.value = 0
  try {
    const result = await api.getJunglePathingReview(props.gameId)
    if (sequence !== loadSequence) return
    loadedReview.value = result
    selectedParticipant.value = participants.value.find((participant) => participant.isLocal)?.participantKey
      ?? participants.value[0]?.participantKey
    setInitialPlaybackTime()
  } catch (cause) {
    if (sequence !== loadSequence) return
    localError.value = cause instanceof Error ? cause.message : "Could not load minimap telemetry"
  } finally {
    if (sequence === loadSequence) localLoading.value = false
  }
}

function useManagedReview() {
  if (!props.managed) return
  stop()
  selectedParticipant.value = participants.value.find((participant) => participant.isLocal)?.participantKey
    ?? participants.value[0]?.participantKey
  setInitialPlaybackTime()
}

watch(() => props.gameId, () => {
  if (props.managed) useManagedReview()
  else void load()
})
watch(() => props.pathingReview, useManagedReview)
watch(selectedParticipant, () => {
  stop()
  setInitialPlaybackTime()
})
onMounted(() => {
  if (props.managed) useManagedReview()
  else void load()
})
onBeforeUnmount(() => {
  loadSequence += 1
  stop()
})
</script>

<template>
  <section
    class="telemetry-review"
    aria-label="Jungle clear and pathing review"
    tabindex="0"
    @keydown="handleKeyboard"
  >
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
      <div class="first-clear-summary" aria-label="First full clear summary">
        <article class="primary" :class="{ complete: initialClear.complete }">
          <span>First full clear</span>
          <strong>
            {{ initialClear.clearTimeMs === undefined
              ? 'Incomplete'
              : formatTime(initialClear.clearTimeMs, true) }}
          </strong>
          <small>
            {{ initialClear.camps.length }} / {{ FULL_CLEAR_CAMP_COUNT }} unique camps before 8:00
          </small>
        </article>
        <article>
          <span>First camp</span>
          <strong>
            {{ initialClear.camps[0] ? formatTime(initialClear.camps[0].clearedAtMs, true) : '—' }}
          </strong>
          <small>{{ initialClear.camps[0] ? campName(initialClear.camps[0].campKey) : 'No local clear detected' }}</small>
        </article>
        <article class="route">
          <span>Observed route</span>
          <strong>{{ initialClearRoute || 'No local route' }}</strong>
          <small>River and epic objectives are excluded</small>
        </article>
        <article>
          <span>Evidence</span>
          <strong>
            {{ initialClear.confidence === undefined
              ? '—'
              : `${Math.round(initialClear.confidence * 100)}%` }}
          </strong>
          <small>
            {{ initialClear.confidence === undefined
              ? 'No comparable camps'
              : `${confidenceLabel(initialClear.confidence)} confidence` }}
          </small>
        </article>
      </div>

      <div class="path-layout">
        <div class="map-panel">
          <div class="map-toolbar">
            <label v-if="participants.length">
              Champion track
              <select v-model="selectedParticipant">
                <option
                  v-for="participant in participants"
                  :key="participant.participantKey"
                  :value="participant.participantKey"
                >
                  {{ participantLabel(participant) }}
                </option>
              </select>
            </label>
            <div class="coverage" :class="{ weak: observedCoverage < 60 }">
              <strong>{{ observedCoverage }}%</strong>
              observed coverage
            </div>
          </div>

          <div class="playback-map" :style="mapStyle">
            <svg class="path-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polyline
                v-for="path in renderedPaths"
                :key="path.key"
                :points="path.points"
                :style="{ opacity: Math.max(.3, path.confidence) }"
              />
            </svg>

            <span
              v-for="camp in campMarkers"
              :key="camp.key"
              class="camp-marker"
              :class="[camp.respawnRule, camp.state]"
              :style="campMarkerStyle(camp)"
              :title="`${campName(camp.key)} · ${camp.state}`"
              aria-hidden="true"
            />

            <span
              v-for="sighting in separatedSightings"
              :key="sighting.key"
              class="sighting-marker"
              :class="sighting.kind"
              :style="pointStyle(sighting.point)"
              :title="`${sighting.kind} sighting · ${confidenceLabel(sighting.confidence)} confidence`"
            />

            <span
              v-if="currentPoint"
              class="current-position"
              :class="{ estimated: !currentPoint.exact }"
              :style="pointStyle(currentPoint.point)"
              :title="`${selectedParticipantMetadata?.championName ?? 'Champion'} at ${formatTime(playbackTimeMs)}`"
            >
              <i />
            </span>

            <div class="map-clock">{{ formatTime(playbackTimeMs) }}</div>
            <div class="clear-counter">{{ completedClearCount }} / {{ campClears.length }} clears</div>
            <div v-if="!selectedParticipant && reliableSegments.length" class="map-empty">
              Select a champion track to view its path.
            </div>
          </div>

          <div class="legend">
            <span><i class="observed" />Observed route</span>
            <span><i class="unknown" />Separated sighting</span>
            <span><i class="camp" />Camp available</span>
            <span><i class="camp cleared" />Camp cleared</span>
          </div>

          <div class="transport">
            <button type="button" :disabled="!playbackAvailable" title="Back 5 seconds" @click="skip(-5_000)">
              −5s
            </button>
            <button
              type="button"
              class="play-button"
              :disabled="!playbackAvailable"
              :aria-label="playing ? 'Pause jungle path playback' : 'Play jungle path playback'"
              @click="togglePlayback"
            >
              {{ playing ? "Pause" : "Play" }}
            </button>
            <button type="button" :disabled="!playbackAvailable" title="Forward 5 seconds" @click="skip(5_000)">
              +5s
            </button>
            <label class="speed-control">
              Speed
              <select v-model.number="speed">
                <option v-for="option in speedOptions" :key="option" :value="option">{{ option }}×</option>
              </select>
            </label>
            <div class="transport-clock">
              <strong>{{ formatTime(playbackTimeMs) }}</strong>
              <span>/ {{ formatTime(duration) }}</span>
            </div>
          </div>

          <div class="scrubber-shell">
            <span class="scrubber-progress" :style="{ width: `${playbackProgress}%` }" />
            <button
              v-for="tick in timelineTicks"
              :key="tick.key"
              type="button"
              class="clear-tick"
              :class="{ reached: tick.clear.clearedAtMs <= playbackTimeMs }"
              :style="{ left: `${tick.left}%` }"
              :title="`${campName(tick.clear.campKey)} at ${formatTime(tick.clear.clearedAtMs, true)}`"
              @click="seekToClear(tick.clear)"
            />
            <input
              type="range"
              min="0"
              :max="duration"
              step="250"
              :value="playbackTimeMs"
              :disabled="!playbackAvailable"
              aria-label="Jungle path playback time"
              @input="seek"
            />
          </div>
          <p class="playback-note">
            Solid lines connect pixel-supported observations only. Gaps are not filled with an invented route.
          </p>
        </div>

        <div class="camp-panel">
          <div class="camp-heading">
            <div>
              <p class="eyebrow">Clear sequence</p>
              <h4>Camp completion splits</h4>
            </div>
            <span>{{ campClears.length }} detected</span>
          </div>
          <div class="table-shell">
            <table>
              <thead><tr><th>#</th><th>Camp</th><th>Time</th><th>Source</th><th>Attribution</th></tr></thead>
              <tbody>
                <tr
                  v-for="(clear, index) in campClears"
                  :key="`${clear.campKey}:${clear.clearedAtMs}:${index}`"
                  :class="{ reached: clear.clearedAtMs <= playbackTimeMs }"
                >
                  <td>{{ clear.routeIndex !== undefined ? clear.routeIndex + 1 : index + 1 }}</td>
                  <td>
                    <button type="button" class="split-link" @click="seekToClear(clear)">
                      {{ campName(clear.campKey) }}
                    </button>
                  </td>
                  <td>{{ formatTime(clear.clearedAtMs, true) }}</td>
                  <td>
                    <span class="source-badge" :class="clear.source">{{ sourceLabel(clear.source) }}</span>
                  </td>
                  <td>
                    {{ clear.attribution }} · {{ confidenceLabel(clear.attributionConfidence) }}
                  </td>
                </tr>
                <tr v-if="campClears.length === 0">
                  <td colspan="5">No camp transitions met the confidence threshold.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.telemetry-review {
  display: grid;
  gap: 16px;
  min-width: 0;
  outline: none;
}
.telemetry-review:focus-visible {
  border-radius: var(--ui-radius-md, 10px);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent, #62d9e2) 45%, transparent);
}
header, .camp-heading, .map-toolbar, .transport {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
header { align-items: start; }
h3, h4, p { margin: 0; }
.eyebrow {
  opacity: .62;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: .12em;
}
.first-clear-summary {
  display: grid;
  grid-template-columns: minmax(150px, .8fr) minmax(130px, .65fr) minmax(260px, 1.7fr) minmax(130px, .65fr);
  overflow: hidden;
  border: 1px solid rgba(98, 217, 226, .18);
  border-radius: 9px;
  background: rgba(4, 16, 23, .64);
}
.first-clear-summary article {
  display: grid;
  align-content: center;
  gap: 4px;
  min-width: 0;
  min-height: 84px;
  padding: 12px 14px;
  border-right: 1px solid rgb(255 255 255 / 7%);
}
.first-clear-summary article:last-child { border-right: 0; }
.first-clear-summary span {
  color: rgba(205, 229, 232, .58);
  font-size: 11px;
  letter-spacing: .9px;
  text-transform: uppercase;
}
.first-clear-summary strong {
  overflow: hidden;
  color: rgba(238, 250, 250, .94);
  font-size: 20px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.first-clear-summary .primary.complete strong { color: var(--ui-positive, #78d39a); }
.first-clear-summary .route strong {
  font-size: 12px;
  line-height: 1.45;
  text-overflow: initial;
  white-space: normal;
}
.first-clear-summary small {
  color: rgba(205, 229, 232, .48);
  font-size: 11px;
}
.postgame-badge, .source-badge {
  padding: 6px 9px;
  border: 1px solid currentColor;
  border-radius: 999px;
  opacity: .76;
  font-size: 12px;
}
.path-layout {
  display: grid;
  grid-template-columns: minmax(360px, .92fr) minmax(430px, 1.08fr);
  gap: 18px;
  align-items: start;
}
.map-panel, .camp-panel {
  min-width: 0;
  border: 1px solid rgba(128, 160, 170, .2);
  border-radius: 12px;
  padding: 14px;
  background: rgba(9, 18, 22, .42);
}
.map-panel { display: grid; gap: 11px; }
.map-toolbar label, .speed-control {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 13px;
}
.map-toolbar select { min-width: 190px; max-width: 65%; }
select {
  min-height: 30px;
  border: 1px solid rgba(128, 160, 170, .3);
  border-radius: 6px;
  background: rgba(5, 13, 18, .76);
  color: inherit;
}
.coverage {
  display: flex;
  align-items: baseline;
  gap: 5px;
  opacity: .7;
  font-size: 12px;
}
.coverage strong { color: var(--ui-positive, #78d39a); }
.coverage.weak strong { color: var(--ui-warning, #e2b86b); }
.playback-map {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  border: 1px solid rgba(98, 217, 226, .28);
  border-radius: 9px;
  background-color: #031018;
  background-position: center;
  background-size: 100% 100%;
  box-shadow: 0 10px 28px rgb(0 0 0 / 22%), inset 0 0 26px rgb(0 0 0 / 18%);
  isolation: isolate;
}
.playback-map::after {
  position: absolute;
  z-index: 9;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 4%);
  content: "";
  pointer-events: none;
}
.path-layer {
  position: absolute;
  z-index: 3;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}
.path-layer polyline {
  fill: none;
  stroke: var(--ui-accent-strong, #62d9e2);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  filter: drop-shadow(0 0 2px rgb(2 10 14 / 75%));
}
.camp-marker, .sighting-marker, .current-position {
  position: absolute;
  transform: translate(-50%, -50%);
  border-radius: 50%;
}
.camp-marker {
  z-index: 2;
  width: 7px;
  height: 7px;
  border: 1px solid rgba(220, 232, 228, .58);
  background: rgba(6, 18, 18, .76);
  box-shadow: 0 1px 3px rgb(0 0 0 / 60%);
  transition: opacity .12s, transform .12s;
}
.camp-marker.buff { width: 9px; height: 9px; }
.camp-marker.scuttle { border-radius: 3px; transform: translate(-50%, -50%) rotate(45deg); }
.camp-marker.epic { width: 11px; height: 11px; border-width: 2px; }
.camp-marker.cleared {
  border-color: rgba(226, 108, 99, .86);
  background: rgba(74, 17, 17, .82);
  opacity: .72;
  transform: translate(-50%, -50%) scale(.72);
}
.camp-marker.scuttle.cleared { transform: translate(-50%, -50%) rotate(45deg) scale(.72); }
.sighting-marker {
  z-index: 4;
  width: 7px;
  height: 7px;
  border: 2px solid rgba(231, 239, 239, .8);
  background: rgba(4, 14, 18, .72);
  box-shadow: 0 0 0 2px rgba(98, 217, 226, .25);
}
.sighting-marker.inferred { border-style: dashed; }
.sighting-marker.unknown { opacity: .6; }
.current-position {
  z-index: 6;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 2px solid rgba(238, 250, 250, .95);
  background: rgba(7, 25, 30, .76);
  box-shadow: 0 0 0 3px rgba(98, 217, 226, .28), 0 2px 7px rgb(0 0 0 / 70%);
}
.current-position i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ui-accent-strong, #62d9e2);
}
.current-position.estimated { border-style: dashed; opacity: .75; }
.map-clock, .clear-counter {
  position: absolute;
  z-index: 7;
  top: 10px;
  padding: 5px 8px;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 6px;
  background: rgb(3 12 18 / 82%);
  box-shadow: 0 2px 7px rgb(0 0 0 / 45%);
  font-size: 12px;
  pointer-events: none;
}
.map-clock { left: 10px; font-weight: 700; }
.clear-counter { right: 10px; opacity: .78; }
.map-empty {
  position: absolute;
  z-index: 8;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgb(3 12 18 / 68%);
  text-align: center;
  font-size: 13px;
}
.legend {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
  opacity: .75;
}
.legend span { display: inline-flex; gap: 6px; align-items: center; }
.legend i { display: inline-block; }
.legend .observed { width: 18px; border-top: 2px solid currentColor; }
.legend .unknown { width: 6px; height: 6px; border: 1px solid currentColor; border-radius: 50%; }
.legend .camp { width: 7px; height: 7px; border: 1px solid currentColor; border-radius: 50%; }
.legend .camp.cleared { border-color: #d86f68; background: rgba(216, 111, 104, .4); }
.transport { justify-content: start; }
.transport button {
  min-height: 32px;
  padding: 5px 10px;
  border: 1px solid rgba(128, 160, 170, .28);
  border-radius: 7px;
  background: rgba(5, 14, 18, .68);
  color: inherit;
  cursor: pointer;
}
.transport button:disabled { opacity: .42; cursor: default; }
.transport .play-button { min-width: 66px; border-color: rgba(98, 217, 226, .48); }
.speed-control { margin-left: 2px; }
.speed-control select { min-width: 58px; }
.transport-clock { display: flex; gap: 4px; align-items: baseline; margin-left: auto; font-size: 12px; }
.transport-clock span { opacity: .62; }
.scrubber-shell {
  position: relative;
  height: 22px;
  display: flex;
  align-items: center;
}
.scrubber-shell::before, .scrubber-progress {
  position: absolute;
  left: 0;
  height: 4px;
  border-radius: 999px;
  content: "";
  pointer-events: none;
}
.scrubber-shell::before { right: 0; background: rgba(128, 160, 170, .22); }
.scrubber-progress { background: rgba(98, 217, 226, .72); }
.scrubber-shell input {
  position: relative;
  z-index: 3;
  width: 100%;
  margin: 0;
  background: transparent;
}
.clear-tick {
  position: absolute;
  z-index: 4;
  top: 50%;
  width: 6px;
  height: 10px;
  padding: 0;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(226, 184, 107, .8);
  border-radius: 2px;
  background: #071319;
  cursor: pointer;
}
.clear-tick.reached { background: rgba(226, 184, 107, .9); }
.playback-note { opacity: .6; font-size: 12px; line-height: 1.45; }
.camp-panel { display: grid; gap: 10px; }
.camp-heading > span { opacity: .62; font-size: 12px; }
.table-shell { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 9px 7px; border-bottom: 1px solid rgba(128, 160, 170, .14); }
th { opacity: .62; font-weight: 600; }
tbody tr { opacity: .62; transition: opacity .12s, background .12s; }
tbody tr.reached { opacity: 1; background: rgba(98, 217, 226, .035); }
.split-link {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.split-link:hover { text-decoration: underline; }
.source-badge { display: inline-block; padding: 3px 6px; font-size: 11px; white-space: nowrap; }
.source-badge.live_client_inference { color: var(--ui-warning, #e2b86b); }
.error { color: #e98f8f; }
.empty { opacity: .68; }
@media (max-width: 1000px) {
  .path-layout { grid-template-columns: 1fr; }
  .first-clear-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .first-clear-summary article:nth-child(2) { border-right: 0; }
  .first-clear-summary article:nth-child(-n + 2) { border-bottom: 1px solid rgb(255 255 255 / 7%); }
}
@media (max-width: 620px) {
  .first-clear-summary { grid-template-columns: 1fr; }
  .first-clear-summary article,
  .first-clear-summary article:nth-child(2) {
    border-right: 0;
    border-bottom: 1px solid rgb(255 255 255 / 7%);
  }
  .first-clear-summary article:last-child { border-bottom: 0; }
  .map-toolbar, .transport { align-items: stretch; flex-wrap: wrap; }
  .map-toolbar label { width: 100%; justify-content: space-between; }
  .map-toolbar select { min-width: 0; flex: 1; }
  .transport-clock { margin-left: 0; }
  header { flex-direction: column; }
}
</style>
