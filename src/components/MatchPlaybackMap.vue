<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { championIconUrl } from "../helpers/format"
import { timelineObjectiveIconUrl } from "../helpers/game-assets"
import { publicAssetUrl } from "../helpers/assets"
import { mapPositionPercent, reviewMapId } from "../helpers/map-coordinate"
import {
  isUsableMapPosition,
  playbackCoverage,
  playbackPositionsAt,
  playbackTrailSamples,
} from "../helpers/timeline-playback"
import type { MatchRow, ParticipantRow } from "../types/stats"
import type { TimelineEvent, TimelineFrame } from "../types/review"

type Visibility = "all" | "blue" | "red" | "you"

const props = defineProps<{
  match: MatchRow
  participants: ParticipantRow[]
  frames: TimelineFrame[]
  events: TimelineEvent[]
  timestamp: number
}>()
const emit = defineEmits<{ "update:timestamp": [timestamp: number] }>()

const playing = ref(false)
const speed = ref(1)
const visibility = ref<Visibility>("all")
const visibilityOptions: Visibility[] = ["all", "blue", "red", "you"]
let animationFrame: number | undefined
let previousAnimationTime: number | undefined

const mapId = computed(() => reviewMapId(props.match.modeFamily))
const mapName = computed(() => mapId.value === 12
  ? "Howling Abyss"
  : mapId.value === 453 ? "Classic Summoner's Rift" : "Summoner's Rift")
const mapStyle = computed(() => ({
  backgroundImage: `linear-gradient(color-mix(in srgb, var(--ui-canvas) 5%, transparent), color-mix(in srgb, var(--ui-canvas) 16%, transparent)), url("${publicAssetUrl(`game-data/ui/map${mapId.value}.png`)}")`,
}))
const duration = computed(() => Math.max(
  0,
  ...props.frames.map((frame) => frame.timestamp),
  ...props.events.map((event) => event.timestamp),
))
const firstPositionTimestamp = computed(() => Math.min(
  ...props.frames.flatMap((frame) => frame.participants.some((participant) =>
    isUsableMapPosition(participant.position, mapId.value),
  ) ? [frame.timestamp] : []),
))
const coverage = computed(() => playbackCoverage(
  props.frames,
  props.participants.map((participant) => participant.participantId),
  mapId.value,
))
const available = computed(() =>
  coverage.value.positionedFrames >= 2 && coverage.value.positionedParticipants > 0,
)
const currentPositions = computed(() => new Map(
  playbackPositionsAt(props.frames, props.events, props.timestamp, mapId.value)
    .map((position) => [position.participantId, position]),
))
const visibleParticipants = computed(() => props.participants.filter((participant) => {
  if (visibility.value === "blue") return participant.teamId === 100
  if (visibility.value === "red") return participant.teamId === 200
  if (visibility.value === "you") return participant.isPlayer === 1
  return true
}))
const visibleTokens = computed(() => visibleParticipants.value.flatMap((participant) => {
  const current = currentPositions.value.get(participant.participantId)
  if (!current) return []
  const plotted = mapPositionPercent(current.position, mapId.value)
  return [{ participant, current, plotted }]
}))
const trails = computed(() => visibleTokens.value.flatMap(({ participant, current }) => {
  const latestDeath = props.events.filter((event) =>
    event.type === "CHAMPION_KILL" &&
    event.targetId === participant.participantId &&
    event.timestamp <= props.timestamp,
  ).at(-1)
  const points = playbackTrailSamples(
    props.frames,
    participant.participantId,
    props.timestamp,
    mapId.value,
  ).filter((sample) => !latestDeath || sample.timestamp >= latestDeath.timestamp)
    .map((sample) => mapPositionPercent(sample.position, mapId.value))
  const currentPoint = mapPositionPercent(current.position, mapId.value)
  if (points.length === 0 ||
    points.at(-1)?.left !== currentPoint.left || points.at(-1)?.top !== currentPoint.top) {
    points.push(currentPoint)
  }
  if (points.length < 2) return []
  return [{
    participant,
    points: points.map((point) => `${point.left},${point.top}`).join(" "),
  }]
}))
const currentEvents = computed(() => props.events.flatMap((event) => {
  if (
    Math.abs(event.timestamp - props.timestamp) > 2_500 ||
    !["kill", "objective"].includes(event.category) ||
    !isUsableMapPosition(event.position, mapId.value)
  ) return []
  return [{ event, plotted: mapPositionPercent(event.position!, mapId.value) }]
}))

function formatTime(timestamp: number) {
  const seconds = Math.max(0, Math.floor(timestamp / 1_000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function participantName(participant: ParticipantRow) {
  return participant.summonerName || `Player ${participant.participantId}`
}

function tokenStyle(token: typeof visibleTokens.value[number]) {
  return { left: `${token.plotted.left}%`, top: `${token.plotted.top}%` }
}

function eventStyle(marker: typeof currentEvents.value[number]) {
  return { left: `${marker.plotted.left}%`, top: `${marker.plotted.top}%` }
}

function eventTitle(event: TimelineEvent) {
  if (event.category === "kill") {
    const victim = props.participants.find((participant) => participant.participantId === event.targetId)
    return `${formatTime(event.timestamp)} · ${victim ? participantName(victim) : "Champion"} died`
  }
  return `${formatTime(event.timestamp)} · ${(event.objective || event.type).replaceAll("_", " ").toLowerCase()}`
}

function objectiveIcon(event: TimelineEvent) {
  return event.category === "objective"
    ? timelineObjectiveIconUrl(event.type, event.objective, event.teamId)
    : undefined
}

function setTimestamp(timestamp: number) {
  emit("update:timestamp", Math.max(0, Math.min(duration.value, timestamp)))
}

function seek(event: Event) {
  setTimestamp(Number((event.currentTarget as HTMLInputElement).value))
}

function stop() {
  playing.value = false
  previousAnimationTime = undefined
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame)
  animationFrame = undefined
}

function animate(now: number) {
  if (!playing.value) return
  const previous = previousAnimationTime ?? now
  previousAnimationTime = now
  const next = props.timestamp + (now - previous) * speed.value
  if (next >= duration.value) {
    setTimestamp(duration.value)
    stop()
    return
  }
  setTimestamp(next)
  animationFrame = requestAnimationFrame(animate)
}

function togglePlayback() {
  if (playing.value) {
    stop()
    return
  }
  if (!available.value) return
  if (props.timestamp >= duration.value || props.timestamp < firstPositionTimestamp.value) {
    setTimestamp(Number.isFinite(firstPositionTimestamp.value) ? firstPositionTimestamp.value : 0)
  }
  playing.value = true
  previousAnimationTime = undefined
  animationFrame = requestAnimationFrame(animate)
}

function skip(delta: number) {
  stop()
  setTimestamp(props.timestamp + delta)
}

watch(() => props.match.gameId, () => {
  stop()
  visibility.value = "all"
})
watch(available, (value) => {
  if (!value) stop()
})
onBeforeUnmount(stop)
</script>

<template>
  <section class="playback-panel" :aria-label="`${mapName} estimated champion movement playback`">
    <header class="playback-heading">
      <div>
        <span class="eyebrow">Positioning</span>
        <h3>Map playback</h3>
      </div>
      <div class="coverage" :class="{ weak: coverage.percent < 70 }">
        <strong>{{ coverage.positionedParticipants }}/{{ coverage.expectedParticipants }}</strong>
        champions · {{ coverage.percent }}% position coverage
      </div>
    </header>

    <div class="playback-layout">
      <div class="playback-map" :style="mapStyle">
        <svg class="trail-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline
            v-for="trail in trails"
            :key="trail.participant.participantId"
            :class="[
              trail.participant.teamId === 100 ? 'blue' : 'red',
              { owner: trail.participant.isPlayer === 1 },
            ]"
            :points="trail.points"
          />
        </svg>

        <span
          v-for="token in visibleTokens"
          :key="token.participant.participantId"
          class="champion-token"
          :class="[
            token.participant.teamId === 100 ? 'blue' : 'red',
            { owner: token.participant.isPlayer === 1, exact: token.current.exact },
          ]"
          :style="tokenStyle(token)"
          :title="`${participantName(token.participant)} · ${token.current.exact ? 'observed' : 'estimated'} position at ${formatTime(timestamp)}`"
        >
          <img :src="championIconUrl(token.participant.championId)" alt="" />
          <span v-if="token.participant.isPlayer === 1">YOU</span>
        </span>

        <span
          v-for="marker in currentEvents"
          :key="marker.event.eventId"
          class="playback-event"
          :class="marker.event.category"
          :style="eventStyle(marker)"
          :title="eventTitle(marker.event)"
          :aria-label="eventTitle(marker.event)"
          role="img"
        >
          <img v-if="objectiveIcon(marker.event)" :src="objectiveIcon(marker.event)" alt="" />
          <span v-else>×</span>
        </span>

        <div v-if="!available" class="map-empty">
          <strong>Playback unavailable</strong>
          <span>This match does not contain enough positioned timeline frames.</span>
        </div>
        <div v-else-if="visibleTokens.length === 0" class="map-empty">
          <strong>No position at {{ formatTime(timestamp) }}</strong>
          <span>Seek to the first observed timeline frame.</span>
        </div>
      </div>

      <aside class="playback-sidebar">
        <div class="clock" aria-live="off">
          <strong>{{ formatTime(timestamp) }}</strong>
          <span>/ {{ formatTime(duration) }}</span>
        </div>

        <div class="primary-controls">
          <button type="button" :disabled="!available" @click="skip(-60_000)" aria-label="Back one minute">−1m</button>
          <button type="button" class="play-button" :disabled="!available" :aria-label="playing ? 'Pause playback' : 'Play playback'" @click="togglePlayback">
            {{ playing ? "Pause" : "Play" }}
          </button>
          <button type="button" :disabled="!available" @click="skip(60_000)" aria-label="Forward one minute">+1m</button>
        </div>

        <input
          class="scrubber"
          type="range"
          min="0"
          :max="duration"
          step="1000"
          :value="timestamp"
          :disabled="!available"
          aria-label="Playback time"
          @input="seek"
        />

        <div class="control-group">
          <span>Speed</span>
          <div class="segmented">
            <button v-for="option in [1, 2, 4]" :key="option" type="button"
              :class="{ selected: speed === option }" :aria-pressed="speed === option"
              @click="speed = option">{{ option }}×</button>
          </div>
        </div>

        <div class="control-group">
          <span>Show</span>
          <div class="segmented visibility-controls">
            <button v-for="option in visibilityOptions" :key="option" type="button"
              :class="{ selected: visibility === option }" :aria-pressed="visibility === option"
              @click="visibility = option">{{ option }}</button>
          </div>
        </div>

        <p class="accuracy-note">
          Dotted trails are estimates between periodic observations. Exact routes, recalls, and ability movement are not recorded.
        </p>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.playback-panel { min-width: 0; }
.playback-heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
.playback-heading h3 { margin: 1px 0 0; color: var(--ui-text-heading); font: 18px var(--ui-font-heading); }
.eyebrow { color: var(--ui-text-muted); font-size: 10px; letter-spacing: .9px; text-transform: uppercase; }
.coverage { color: var(--ui-text-muted); font-size: 11px; text-align: right; }.coverage strong { color: var(--ui-text); }.coverage.weak strong { color: var(--ui-warning); }
.playback-layout { display: grid; grid-template-columns: minmax(340px, 500px) minmax(220px, 1fr); align-items: center; gap: clamp(18px, 2.5vw, 32px); }
.playback-map { position: relative; width: 100%; aspect-ratio: 1; overflow: hidden; border: 1px solid var(--ui-border-emphasis); border-radius: var(--ui-radius-md); background-position: center; background-size: 100% 100%; box-shadow: var(--ui-shadow-inset); }
.trail-layer { position: absolute; z-index: 1; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.trail-layer polyline { fill: none; stroke-width: .55; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1.2 1.2; vector-effect: non-scaling-stroke; opacity: .52; }.trail-layer .blue { stroke: var(--ui-team-blue); }.trail-layer .red { stroke: var(--ui-team-red); }.trail-layer .owner { stroke-width: 1.05; opacity: .95; filter: drop-shadow(0 0 2px var(--ui-accent)); }
.champion-token { --team: var(--ui-team-blue); position: absolute; z-index: 4; width: 34px; height: 34px; transform: translate(-50%, -50%); border: 2px solid var(--team); border-radius: 50%; background: var(--ui-canvas); box-shadow: 0 2px 7px color-mix(in srgb, var(--ui-canvas) 90%, transparent), 0 0 6px color-mix(in srgb, var(--team) 60%, transparent); transition: left 80ms linear, top 80ms linear, opacity 120ms ease; }
.champion-token.red { --team: var(--ui-team-red); }.champion-token.owner { z-index: 5; width: 40px; height: 40px; border-color: var(--ui-accent-strong); box-shadow: 0 0 0 2px var(--ui-canvas), 0 0 12px var(--ui-accent); }.champion-token.exact { border-style: solid; }
.champion-token img { display: block; width: 100%; height: 100%; border-radius: inherit; object-fit: cover; }.champion-token > span { position: absolute; top: calc(100% + 2px); left: 50%; padding: 1px 4px; transform: translateX(-50%); border-radius: 2px; background: var(--ui-canvas); color: var(--ui-accent-strong); font: 8px var(--ui-font-heading); white-space: nowrap; }
.playback-event { position: absolute; z-index: 6; display: grid; place-items: center; width: 25px; height: 25px; transform: translate(-50%, -50%); border: 1px solid var(--ui-accent-strong); border-radius: 50%; background: var(--ui-surface-overlay); color: var(--ui-loss); box-shadow: 0 0 14px currentColor; pointer-events: none; }.playback-event.kill { font: 24px/1 var(--ui-font-heading); }.playback-event img { width: 100%; height: 100%; object-fit: contain; }
.map-empty { position: absolute; z-index: 8; top: 50%; left: 50%; display: grid; gap: 3px; min-width: 210px; padding: 10px 12px; transform: translate(-50%, -50%); border: 1px solid var(--ui-border-emphasis); border-radius: var(--ui-radius-sm); background: var(--ui-surface-overlay); color: var(--ui-text-subtle); font-size: 11px; text-align: center; }.map-empty strong { color: var(--ui-text); font: 12px var(--ui-font-heading); }
.playback-sidebar { display: grid; gap: 15px; }.clock { display: flex; align-items: baseline; gap: 7px; color: var(--ui-text-muted); font-variant-numeric: tabular-nums; }.clock strong { color: var(--ui-accent-strong); font: 32px var(--ui-font-heading); }.clock span { font-size: 13px; }
.primary-controls, .segmented { display: flex; gap: 5px; }.primary-controls button, .segmented button { min-height: 32px; padding: 5px 10px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-xs); background: var(--ui-surface-panel-quiet); color: var(--ui-text-subtle); cursor: pointer; text-transform: capitalize; }.primary-controls button:hover:not(:disabled), .segmented button:hover, .segmented button.selected { border-color: var(--ui-accent); color: var(--ui-accent-strong); }.primary-controls button:disabled { opacity: .45; cursor: not-allowed; }.primary-controls .play-button { min-width: 86px; border-color: color-mix(in srgb, var(--ui-accent) 60%, var(--ui-border)); background: color-mix(in srgb, var(--ui-accent) 12%, var(--ui-surface-panel-quiet)); color: var(--ui-accent-strong); font-family: var(--ui-font-heading); }
.scrubber { width: 100%; accent-color: var(--ui-accent); cursor: pointer; }.scrubber:disabled { cursor: not-allowed; opacity: .45; }
.control-group { display: grid; gap: 6px; }.control-group > span { color: var(--ui-text-muted); font-size: 10px; letter-spacing: .7px; text-transform: uppercase; }.segmented button { flex: 0 1 54px; min-height: 27px; padding: 3px 7px; font-size: 10px; }.visibility-controls button { flex: 1 1 0; }
.accuracy-note { margin: 2px 0 0; padding: 10px 11px; border-left: 2px solid var(--ui-accent); background: color-mix(in srgb, var(--ui-accent) 5%, transparent); color: var(--ui-text-muted); font-size: 10px; line-height: 1.5; }
@media (max-width: 900px) { .playback-layout { grid-template-columns: 1fr; }.playback-map { max-width: 620px; margin-inline: auto; }.playback-sidebar { grid-template-columns: auto minmax(220px, 1fr); align-items: center; }.scrubber, .accuracy-note { grid-column: 1 / -1; } }
@media (max-width: 560px) { .playback-heading { align-items: flex-start; flex-direction: column; }.coverage { text-align: left; }.playback-layout { display: block; }.playback-sidebar { display: grid; grid-template-columns: 1fr; margin-top: 14px; }.scrubber, .accuracy-note { grid-column: auto; }.champion-token { width: 28px; height: 28px; }.champion-token.owner { width: 34px; height: 34px; } }
@container recall-content (max-width: 900px) { .playback-layout { grid-template-columns: 1fr; }.playback-map { max-width: 620px; margin-inline: auto; }.playback-sidebar { grid-template-columns: auto minmax(220px, 1fr); align-items: center; }.scrubber, .accuracy-note { grid-column: 1 / -1; } }
@container recall-content (max-width: 560px) { .playback-heading { align-items: flex-start; flex-direction: column; }.coverage { text-align: left; }.playback-layout { display: block; }.playback-sidebar { display: grid; grid-template-columns: 1fr; margin-top: 14px; }.scrubber, .accuracy-note { grid-column: auto; }.champion-token { width: 28px; height: 28px; }.champion-token.owner { width: 34px; height: 34px; } }
@media (prefers-reduced-motion: reduce) { .champion-token { transition: none; } }
</style>
