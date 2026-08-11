<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { championIconUrl } from "../helpers/format"
import { playbackWorldObjectiveIconUrl } from "../helpers/game-assets"
import { publicAssetUrl } from "../helpers/assets"
import { mapPositionPercent, reviewMapId } from "../helpers/map-coordinate"
import {
  isUsableMapPosition,
  playbackCoverage,
  playbackMapEventLayer,
  playbackPositionsAt,
  playbackTrailSamples,
  playbackWorldMarkers,
  spreadOverlappingMapPoints,
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
  compact?: boolean
}>()
const emit = defineEmits<{ "update:timestamp": [timestamp: number] }>()

const playing = ref(false)
const speed = ref(1)
const speedOptions = [1, 2, 4, 10] as const
const visibility = ref<Visibility>("all")
const focusedParticipantId = ref<number>()
const expandedParticipantId = ref<number>()
const visibilityOptions: Array<{ value: Visibility; label: string }> = [
  { value: "all", label: "Everyone" },
  { value: "blue", label: "Blue" },
  { value: "red", label: "Red" },
  { value: "you", label: "You" },
]
let animationFrame: number | undefined
let previousAnimationTime: number | undefined
let playbackClock = props.timestamp
let lastEmittedTimestamp: number | undefined
let stackCollapseTimer: number | undefined

const mapId = computed(() => reviewMapId(props.match.modeFamily))
const mapName = computed(() => mapId.value === 12
  ? "Howling Abyss"
  : mapId.value === 453 ? "Classic Summoner's Rift" : "Summoner's Rift")
const mapStyle = computed(() => ({
  backgroundImage: `url("${publicAssetUrl(`game-data/ui/map${mapId.value}.png`)}")`,
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
const roster = computed(() => [...props.participants].sort((left, right) =>
  left.teamId - right.teamId || left.participantId - right.participantId,
))
const focusedParticipant = computed(() => props.participants.find((participant) =>
  participant.participantId === focusedParticipantId.value,
))
const visibleTokens = computed(() => {
  const tokens = visibleParticipants.value.flatMap((participant) => {
    const current = currentPositions.value.get(participant.participantId)
    if (!current) return []
    const plotted = mapPositionPercent(current.position, mapId.value)
    return [{ participant, current, plotted }]
  })
  const spread = new Map(spreadOverlappingMapPoints(tokens.map(({ participant, plotted }) => ({
    id: participant.participantId,
    left: plotted.left,
    top: plotted.top,
  })), 6, expandedParticipantId.value).map((point) => [point.id, point]))
  const laidOut = tokens.map((token) => ({
    ...token,
    display: spread.get(token.participant.participantId)!,
  }))
  const grouped = new Map<string, typeof laidOut>()
  for (const token of laidOut) {
    const group = grouped.get(token.display.clusterId) ?? []
    group.push(token)
    grouped.set(token.display.clusterId, group)
  }
  const stackLeads = new Set<number>()
  for (const group of grouped.values()) {
    const lead = group.find((token) => token.participant.participantId === expandedParticipantId.value) ??
      group.find((token) => token.participant.participantId === focusedParticipantId.value) ??
      group.find((token) => token.participant.isPlayer === 1) ??
      [...group].sort((left, right) => right.display.clusterIndex - left.display.clusterIndex)[0]
    if (lead) stackLeads.add(lead.participant.participantId)
  }
  return laidOut.map((token) => ({
    ...token,
    stackLead: stackLeads.has(token.participant.participantId),
  }))
})
const expandedTokenLinks = computed(() => visibleTokens.value.filter((token) =>
  token.display.expanded &&
  (Math.abs(token.display.left - token.display.sourceLeft) > .01 ||
    Math.abs(token.display.top - token.display.sourceTop) > .01),
))
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
    playbackMapEventLayer(event, mapId.value) !== "transient" ||
    !isUsableMapPosition(event.position, mapId.value)
  ) return []
  return [{ event, plotted: mapPositionPercent(event.position!, mapId.value) }]
}))
const timelineTicks = computed(() => props.events.filter((event) =>
  event.category === "kill" || event.category === "objective",
).map((event) => ({
  event,
  left: duration.value > 0 ? event.timestamp / duration.value * 100 : 0,
})))
const worldMarkers = computed(() => playbackWorldMarkers(
  props.events,
  props.timestamp,
  mapId.value,
  props.match.mode,
  props.match.gameVersion,
).map((marker) => ({
  ...marker,
  plotted: mapPositionPercent(marker.position, mapId.value),
})))

function formatTime(timestamp: number) {
  const seconds = Math.max(0, Math.floor(timestamp / 1_000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function participantName(participant: ParticipantRow) {
  return participant.summonerName || `Player ${participant.participantId}`
}

function focusParticipant(participantId: number) {
  const next = focusedParticipantId.value === participantId
    ? undefined
    : participantId
  focusedParticipantId.value = next
  expandedParticipantId.value = next
  cancelStackCollapse()
}

function cancelStackCollapse() {
  if (stackCollapseTimer === undefined) return
  window.clearTimeout(stackCollapseTimer)
  stackCollapseTimer = undefined
}

function expandTokenCluster(participantId: number) {
  cancelStackCollapse()
  const current = visibleTokens.value.find((token) =>
    token.participant.participantId === expandedParticipantId.value,
  )
  const incoming = visibleTokens.value.find((token) => token.participant.participantId === participantId)
  if (current && incoming && current.display.clusterId === incoming.display.clusterId) return
  expandedParticipantId.value = participantId
}

function scheduleStackCollapse() {
  cancelStackCollapse()
  stackCollapseTimer = window.setTimeout(() => {
    expandedParticipantId.value = focusedParticipantId.value
    stackCollapseTimer = undefined
  }, 140)
}

function tokenStyle(token: typeof visibleTokens.value[number]) {
  const participantId = token.participant.participantId
  const zIndex = focusedParticipantId.value === participantId
    ? 20
    : expandedParticipantId.value === participantId
      ? 18
      : token.participant.isPlayer === 1
        ? 16
        : token.stackLead ? 14 : 5 + token.display.clusterIndex
  return { left: `${token.display.left}%`, top: `${token.display.top}%`, zIndex }
}

function tokenTitle(token: typeof visibleTokens.value[number]) {
  const stack = token.display.clusterSize > 1
    ? ` · stacked with ${token.display.clusterSize - 1} other champion${token.display.clusterSize === 2 ? "" : "s"}`
    : ""
  return `${participantName(token.participant)} · ${token.current.exact ? "observed" : "estimated"} position at ${formatTime(props.timestamp)}${stack}`
}

function eventStyle(marker: typeof currentEvents.value[number]) {
  return { left: `${marker.plotted.left}%`, top: `${marker.plotted.top}%` }
}

function worldMarkerStyle(marker: typeof worldMarkers.value[number]) {
  return { left: `${marker.plotted.left}%`, top: `${marker.plotted.top}%` }
}

function worldMarkerIcon(marker: typeof worldMarkers.value[number]) {
  return marker.kind === "dragon" || marker.kind === "elder" || marker.kind === "baron" ||
    marker.kind === "herald" || marker.kind === "void-grub"
    ? playbackWorldObjectiveIconUrl(marker.kind)
    : undefined
}

function killVictim(event: TimelineEvent) {
  return event.category === "kill"
    ? props.participants.find((participant) => participant.participantId === event.targetId)
    : undefined
}

function championImageFallback(event: Event) {
  const image = event.currentTarget as HTMLImageElement
  image.onerror = null
  image.src = publicAssetUrl("recall-icon.png")
}

function hideBrokenImage(event: Event) {
  const image = event.currentTarget as HTMLImageElement
  image.style.display = "none"
}

function eventTitle(event: TimelineEvent) {
  if (event.category === "kill") {
    const victim = props.participants.find((participant) => participant.participantId === event.targetId)
    return `${formatTime(event.timestamp)} · ${victim ? participantName(victim) : "Champion"} died`
  }
  return `${formatTime(event.timestamp)} · ${(event.objective || event.type).replaceAll("_", " ").toLowerCase()}`
}

function setTimestamp(timestamp: number) {
  const bounded = Math.max(0, Math.min(duration.value, timestamp))
  playbackClock = bounded
  lastEmittedTimestamp = bounded
  emit("update:timestamp", bounded)
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
  const next = playbackClock + (now - previous) * speed.value
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
  const start = props.timestamp >= duration.value || props.timestamp < firstPositionTimestamp.value
    ? Number.isFinite(firstPositionTimestamp.value) ? firstPositionTimestamp.value : 0
    : props.timestamp
  setTimestamp(start)
  playing.value = true
  previousAnimationTime = undefined
  animationFrame = requestAnimationFrame(animate)
}

function skip(delta: number) {
  stop()
  setTimestamp(props.timestamp + delta)
}

function handleKeyboard(event: KeyboardEvent) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return
  if (event.code === "Space") {
    event.preventDefault()
    togglePlayback()
  } else if (event.key === "ArrowLeft") {
    event.preventDefault()
    skip(-15_000)
  } else if (event.key === "ArrowRight") {
    event.preventDefault()
    skip(15_000)
  }
}

watch(() => props.match.gameId, () => {
  stop()
  cancelStackCollapse()
  visibility.value = "all"
  focusedParticipantId.value = undefined
  expandedParticipantId.value = undefined
})
watch(() => props.timestamp, (timestamp) => {
  if (lastEmittedTimestamp !== undefined && Math.abs(timestamp - lastEmittedTimestamp) < .5) {
    lastEmittedTimestamp = undefined
    return
  }
  playbackClock = timestamp
})
watch(available, (value) => {
  if (!value) stop()
})
onBeforeUnmount(() => {
  stop()
  cancelStackCollapse()
})
</script>

<template>
  <section
    class="playback-panel"
    :class="{ compact }"
    :aria-label="`${mapName} estimated champion movement playback`"
    tabindex="0"
    @keydown="handleKeyboard"
  >
    <header class="playback-heading">
      <div>
        <span class="eyebrow">{{ mapName }}</span>
        <h3>Map playback</h3>
      </div>
      <div class="coverage" :class="{ weak: coverage.percent < 70 }">
        <strong>{{ coverage.percent }}%</strong>
        timeline coverage
      </div>
    </header>

    <div class="playback-layout">
      <div class="playback-map" :style="mapStyle" @pointerleave="scheduleStackCollapse">
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
          <line
            v-for="token in expandedTokenLinks"
            :key="`overlap:${token.participant.participantId}`"
            class="overlap-link"
            :class="token.participant.teamId === 100 ? 'blue' : 'red'"
            :x1="token.display.sourceLeft"
            :y1="token.display.sourceTop"
            :x2="token.display.left"
            :y2="token.display.top"
          />
        </svg>

        <span
          v-for="marker in worldMarkers"
          :key="marker.id"
          class="world-marker"
          :class="[
            marker.kind,
            marker.state,
            marker.teamId === 100 ? 'blue' : marker.teamId === 200 ? 'red' : 'neutral',
          ]"
          :style="worldMarkerStyle(marker)"
          :title="`${marker.label} · ${marker.state} at ${formatTime(timestamp)}`"
          :aria-label="`${marker.label} ${marker.state} at ${formatTime(timestamp)}`"
          role="img"
        >
          <svg v-if="marker.kind === 'tower'" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 2h8v3l-1 1v6h2v2H3v-2h2V6L4 5V2Zm2 2v1h4V4H6Zm1 3v5h2V7H7Z" />
          </svg>
          <svg v-else-if="marker.kind === 'inhibitor'" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m8 1 6 7-6 7-6-7 6-7Zm0 4L5.5 8 8 11l2.5-3L8 5Z" />
          </svg>
          <svg v-else-if="marker.kind === 'nexus'" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m8 1 5.5 3.2v7.6L8 15l-5.5-3.2V4.2L8 1Zm0 3L5 5.7v4.6L8 12l3-1.7V5.7L8 4Z" />
          </svg>
          <img
            v-else-if="worldMarkerIcon(marker)"
            class="world-objective-icon"
            :src="worldMarkerIcon(marker)"
            alt=""
            @error="hideBrokenImage"
          />
        </span>

        <button
          v-for="token in visibleTokens"
          :key="token.participant.participantId"
          type="button"
          class="champion-token"
          :class="[
            token.participant.teamId === 100 ? 'blue' : 'red',
            {
              owner: token.participant.isPlayer === 1,
              exact: token.current.exact,
              overlapping: token.display.overlapping,
              'cluster-expanded': token.display.expanded,
              'stack-lead': token.stackLead,
              focused: focusedParticipantId === token.participant.participantId,
            },
          ]"
          :style="tokenStyle(token)"
          :title="tokenTitle(token)"
          :aria-label="tokenTitle(token)"
          :aria-pressed="focusedParticipantId === token.participant.participantId"
          :aria-expanded="token.display.overlapping ? token.display.expanded : undefined"
          @pointerenter="expandTokenCluster(token.participant.participantId)"
          @pointerleave="scheduleStackCollapse"
          @focus="expandTokenCluster(token.participant.participantId)"
          @blur="scheduleStackCollapse"
          @click="focusParticipant(token.participant.participantId)"
        >
          <img :src="championIconUrl(token.participant.championId)" alt="" @error="championImageFallback" />
          <i v-if="token.participant.isPlayer === 1" aria-hidden="true" />
          <b
            v-if="token.display.overlapping && !token.display.expanded && token.stackLead"
            class="stack-count"
            aria-hidden="true"
          >+{{ token.display.clusterSize - 1 }}</b>
          <span
            v-if="focusedParticipantId === token.participant.participantId"
            class="participant-label"
          >{{ participantName(token.participant) }}</span>
        </button>

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
          <img
            v-if="killVictim(marker.event)"
            :src="championIconUrl(killVictim(marker.event)!.championId)"
            alt=""
            @error="championImageFallback"
          />
          <span v-if="marker.event.category === 'kill'" class="death-cross">×</span>
        </span>

        <div class="map-clock" aria-hidden="true">{{ formatTime(timestamp) }}</div>
        <div v-if="focusedParticipant" class="focused-player">
          <span :class="focusedParticipant.teamId === 100 ? 'blue' : 'red'" />
          {{ participantName(focusedParticipant) }}
        </div>

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
        <div class="transport">
          <div class="clock" aria-live="off">
            <strong>{{ formatTime(timestamp) }}</strong>
            <span>{{ formatTime(duration) }}</span>
          </div>
          <div class="primary-controls">
            <button type="button" :disabled="!available" @click="skip(-15_000)" aria-label="Back 15 seconds" title="Back 15 seconds">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5v10l-5-5 5-5Zm2 0h2v10H9V5Zm4 0h2v10h-2V5Z" /></svg>
            </button>
            <button type="button" class="play-button" :disabled="!available" :aria-label="playing ? 'Pause playback' : 'Play playback'" @click="togglePlayback">
              <svg v-if="playing" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4h4v12H5V4Zm6 0h4v12h-4V4Z" /></svg>
              <svg v-else viewBox="0 0 20 20" aria-hidden="true"><path d="m6 3 10 7L6 17V3Z" /></svg>
            </button>
            <button type="button" :disabled="!available" @click="skip(15_000)" aria-label="Forward 15 seconds" title="Forward 15 seconds">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13 5v10l5-5-5-5Zm-4 0h2v10H9V5ZM5 5h2v10H5V5Z" /></svg>
            </button>
          </div>
        </div>

        <div class="scrubber-shell">
          <span
            v-for="tick in timelineTicks"
            :key="tick.event.eventId"
            class="event-tick"
            :class="tick.event.category"
            :style="{ left: `${tick.left}%` }"
          />
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
        </div>

        <div class="control-row">
          <div class="control-group speed-controls">
            <span>Speed</span>
            <div class="segmented">
              <button v-for="option in speedOptions" :key="option" type="button"
                :class="{ selected: speed === option }" :aria-pressed="speed === option"
                @click="speed = option">{{ option }}×</button>
            </div>
          </div>

          <div class="control-group">
            <span>Players</span>
            <div class="segmented visibility-controls">
              <button v-for="option in visibilityOptions" :key="option.value" type="button"
                :class="{ selected: visibility === option.value }" :aria-pressed="visibility === option.value"
                @click="visibility = option.value">{{ option.label }}</button>
            </div>
          </div>
        </div>

        <div class="playback-roster" aria-label="Players in this match">
          <button
            v-for="player in roster"
            :key="player.participantId"
            type="button"
            :class="[
              player.teamId === 100 ? 'blue' : 'red',
              { owner: player.isPlayer === 1, selected: focusedParticipantId === player.participantId },
            ]"
            :title="participantName(player)"
            :aria-label="`Focus ${participantName(player)}`"
            :aria-pressed="focusedParticipantId === player.participantId"
            @click="focusParticipant(player.participantId)"
          >
            <img :src="championIconUrl(player.championId)" alt="" @error="championImageFallback" />
          </button>
        </div>

        <details class="accuracy-note">
          <summary>About estimated movement</summary>
          <p>
            Movement is evenly estimated between periodic observations. Exact routes, recalls, and ability movement are not recorded.
            Recorded events update structure and epic-monster state; ordinary camp availability is not exposed by the timeline.
          </p>
        </details>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.playback-panel {
  min-width: 0;
  outline: none;
}

.playback-panel:focus-visible {
  border-radius: var(--ui-radius-md);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent) 45%, transparent);
}

.playback-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
}

.playback-heading h3 {
  margin: 2px 0 0;
  color: var(--ui-text-heading);
  font: 18px var(--ui-font-heading);
}

.eyebrow {
  color: var(--ui-text-muted);
  font-size: var(--ui-text-label);
  letter-spacing: .8px;
  text-transform: uppercase;
}

.coverage {
  display: flex;
  align-items: baseline;
  gap: 5px;
  color: var(--ui-text-muted);
  font-size: var(--ui-text-label);
}

.coverage strong {
  color: var(--ui-positive);
  font: 13px var(--ui-font-heading);
}

.coverage.weak strong { color: var(--ui-warning); }

.playback-layout {
  display: grid;
  grid-template-columns: minmax(360px, 560px) minmax(250px, 1fr);
  align-items: center;
  gap: clamp(18px, 2.5vw, 32px);
}

.playback-map {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ui-accent) 25%, var(--ui-border-emphasis));
  border-radius: var(--ui-radius-md);
  background-color: #031018;
  background-position: center;
  background-size: 100% 100%;
  box-shadow: 0 10px 28px rgb(0 0 0 / 22%), inset 0 0 26px rgb(0 0 0 / 18%);
  isolation: isolate;
}

.playback-map::after {
  position: absolute;
  z-index: 3;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 4%);
  content: "";
  pointer-events: none;
}

.trail-layer {
  position: absolute;
  z-index: 2;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.trail-layer polyline {
  fill: none;
  stroke-width: 1.1;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  opacity: .65;
}

.trail-layer .blue { stroke: var(--ui-team-blue); }
.trail-layer .red { stroke: var(--ui-team-red); }
.trail-layer .owner {
  stroke: var(--ui-accent-strong);
  stroke-width: 2;
  opacity: .95;
  filter: drop-shadow(0 0 3px var(--ui-accent));
}

.overlap-link {
  stroke-width: .8;
  stroke-dasharray: 2 2;
  vector-effect: non-scaling-stroke;
  opacity: .72;
}

.world-marker {
  position: absolute;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  transform: translate(-50%, -50%);
  border: 1px solid color-mix(in srgb, currentColor 72%, transparent);
  border-radius: 50%;
  background: rgb(3 12 18 / 84%);
  color: var(--ui-accent-strong);
  box-shadow: 0 1px 3px rgb(0 0 0 / 55%);
  font: var(--ui-text-micro) var(--ui-font-heading);
  pointer-events: none;
}

.world-marker svg {
  width: 12px;
  height: 12px;
  fill: currentColor;
}

.world-marker.tower {
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: 3px;
  background: rgb(3 12 18 / 72%);
}

.world-marker.inhibitor { width: 15px; height: 15px; }
.world-marker.nexus { width: 18px; height: 18px; }
.world-marker.camp {
  z-index: 0;
  width: 7px;
  height: 7px;
  border: 1px solid color-mix(in srgb, var(--ui-text-muted) 55%, transparent);
  background: rgb(3 12 18 / 44%);
  opacity: .68;
}

.world-marker.dragon,
.world-marker.elder,
.world-marker.baron,
.world-marker.herald {
  z-index: 2;
  width: 29px;
  height: 29px;
  padding: 2px;
  border-width: 2px;
  background: rgb(3 12 18 / 92%);
  box-shadow: 0 0 0 1px rgb(2 8 13 / 88%), 0 2px 7px rgb(0 0 0 / 68%);
}

.world-marker.void-grub {
  z-index: 2;
  width: 23px;
  height: 23px;
  padding: 1px;
  border-width: 1px;
  background: rgb(3 12 18 / 92%);
  box-shadow: 0 0 0 1px rgb(2 8 13 / 88%), 0 2px 6px rgb(0 0 0 / 62%);
}

.world-objective-icon {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

.world-marker.destroyed {
  border-style: dashed;
  background: transparent;
  filter: grayscale(1);
  opacity: .2;
}

.world-marker.dormant,
.world-marker.respawning {
  filter: grayscale(1);
  opacity: .38;
}

.world-marker.blue { color: var(--ui-team-blue); }
.world-marker.red { color: var(--ui-team-red); }
.world-marker.baron { color: #c29aff; }
.world-marker.herald,
.world-marker.void-grub { color: #aeb7d4; }
.world-marker.dragon,
.world-marker.elder { color: var(--ui-warning); }

.champion-token {
  --team: var(--ui-team-blue);
  position: absolute;
  z-index: 5;
  width: 31px;
  height: 31px;
  padding: 2px;
  transform: translate(-50%, -50%);
  border: 2px solid var(--team);
  border-radius: 50%;
  background: #061018;
  box-shadow: 0 0 0 1px rgb(2 8 13 / 92%), 0 2px 7px rgb(0 0 0 / 68%);
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.champion-token.red { --team: var(--ui-team-red); }
.champion-token.owner {
  z-index: 6;
  width: 35px;
  height: 35px;
  border-color: var(--ui-accent-strong);
  box-shadow: 0 0 0 1px rgb(2 8 13 / 92%), 0 0 10px color-mix(in srgb, var(--ui-accent) 72%, transparent);
}

.champion-token.focused {
  transform: translate(-50%, -50%) scale(1.24);
  box-shadow: 0 0 0 2px #061018, 0 0 15px var(--team);
}

.champion-token.cluster-expanded:not(.focused) {
  animation: stack-pop 140ms ease-out;
}

.champion-token img {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
}

.champion-token > i {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 9px;
  height: 9px;
  border: 2px solid #061018;
  border-radius: 50%;
  background: var(--ui-accent-strong);
}

.champion-token .stack-count {
  position: absolute;
  top: -7px;
  right: -8px;
  display: grid;
  place-items: center;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border: 1px solid rgb(255 255 255 / 28%);
  border-radius: 999px;
  background: #061018;
  color: var(--ui-text-heading);
  box-shadow: 0 1px 4px rgb(0 0 0 / 65%);
  font: var(--ui-text-micro) var(--ui-font-heading);
  line-height: 1;
}

.champion-token > .participant-label {
  position: absolute;
  top: calc(100% + 5px);
  left: 50%;
  padding: 3px 6px;
  transform: translateX(-50%);
  border: 1px solid var(--ui-border-emphasis);
  border-radius: var(--ui-radius-xs);
  background: rgb(3 10 16 / 94%);
  color: var(--ui-text-heading);
  box-shadow: 0 3px 8px rgb(0 0 0 / 40%);
  font: var(--ui-text-micro) var(--ui-font-heading);
  white-space: nowrap;
}

.playback-event {
  position: absolute;
  z-index: 8;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 2px;
  transform: translate(-50%, -50%);
  border: 2px solid var(--ui-accent-strong);
  border-radius: 50%;
  background: #061018;
  box-shadow: 0 0 0 2px rgb(2 8 13 / 78%), 0 0 18px currentColor;
  color: var(--ui-loss);
  pointer-events: none;
  animation: event-pop 420ms ease-out;
}

.playback-event.objective { color: var(--ui-warning); }
.playback-event img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

.death-cross {
  position: absolute;
  display: grid;
  place-items: center;
  inset: -3px;
  border-radius: 50%;
  background: rgb(32 4 7 / 34%);
  color: #fff;
  font: 28px/1 var(--ui-font-heading);
  text-shadow: 0 1px 3px #000;
}

.map-clock,
.focused-player {
  position: absolute;
  z-index: 4;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: var(--ui-radius-pill);
  background: rgb(3 10 16 / 78%);
  color: var(--ui-text-heading);
  box-shadow: 0 2px 8px rgb(0 0 0 / 30%);
  backdrop-filter: blur(6px);
}

.map-clock {
  top: 10px;
  right: 10px;
  padding: 5px 8px;
  font: 12px var(--ui-font-heading);
  font-variant-numeric: tabular-nums;
}

.focused-player {
  bottom: 10px;
  left: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: calc(100% - 20px);
  padding: 5px 9px;
  overflow: hidden;
  font-size: var(--ui-text-label);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.focused-player > span {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--team);
}

.focused-player > span.blue { --team: var(--ui-team-blue); }
.focused-player > span.red { --team: var(--ui-team-red); }

.map-empty {
  position: absolute;
  z-index: 10;
  top: 50%;
  left: 50%;
  display: grid;
  gap: 4px;
  width: min(250px, calc(100% - 32px));
  padding: 14px 16px;
  transform: translate(-50%, -50%);
  border: 1px solid var(--ui-border-emphasis);
  border-radius: var(--ui-radius-sm);
  background: rgb(3 10 16 / 92%);
  color: var(--ui-text-subtle);
  font-size: 11px;
  line-height: 1.4;
  text-align: center;
  backdrop-filter: blur(8px);
}

.map-empty strong {
  color: var(--ui-text-heading);
  font: 13px var(--ui-font-heading);
}

.playback-sidebar {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.transport {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.clock {
  display: flex;
  align-items: baseline;
  gap: 7px;
  color: var(--ui-text-muted);
  font-variant-numeric: tabular-nums;
}

.clock strong {
  color: var(--ui-text-heading);
  font: 29px var(--ui-font-heading);
}

.clock span {
  font-size: 11px;
}

.clock span::before { content: "/ "; }

.primary-controls,
.segmented {
  display: flex;
  gap: 5px;
}

.primary-controls button,
.segmented button {
  min-height: 30px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-xs);
  background: var(--ui-surface-panel-quiet);
  color: var(--ui-text-subtle);
  cursor: pointer;
}

.primary-controls button {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 7px;
  border-radius: 50%;
}

.primary-controls svg {
  width: 100%;
  height: 100%;
  fill: currentColor;
}

.primary-controls button:hover:not(:disabled),
.segmented button:hover,
.segmented button.selected {
  border-color: var(--ui-accent);
  color: var(--ui-accent-strong);
}

.primary-controls button:disabled {
  opacity: .42;
  cursor: not-allowed;
}

.primary-controls .play-button {
  width: 42px;
  height: 42px;
  padding: 10px;
  border-color: color-mix(in srgb, var(--ui-accent) 65%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-accent) 15%, var(--ui-surface-panel-quiet));
  color: var(--ui-accent-strong);
  box-shadow: 0 0 10px color-mix(in srgb, var(--ui-accent) 18%, transparent);
}

.scrubber-shell {
  position: relative;
  height: 22px;
}

.scrubber {
  position: absolute;
  z-index: 2;
  inset: 0;
  width: 100%;
  height: 22px;
  margin: 0;
  accent-color: var(--ui-accent);
  cursor: pointer;
}

.scrubber:disabled {
  cursor: not-allowed;
  opacity: .45;
}

.event-tick {
  position: absolute;
  z-index: 1;
  top: 1px;
  width: 2px;
  height: 5px;
  transform: translateX(-50%);
  border-radius: 2px;
  background: var(--ui-loss);
  opacity: .62;
  pointer-events: none;
}

.event-tick.objective {
  height: 8px;
  background: var(--ui-warning);
  opacity: .9;
}

.control-row {
  display: grid;
  grid-template-columns: minmax(120px, auto) minmax(0, 1fr);
  gap: 12px;
}

.control-group {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.control-group > span {
  color: var(--ui-text-muted);
  font-size: var(--ui-text-label);
  letter-spacing: .7px;
  text-transform: uppercase;
}

.segmented button {
  flex: 1 1 0;
  min-width: 0;
  min-height: 27px;
  padding: 3px 7px;
  overflow: hidden;
  font-size: var(--ui-text-label);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.speed-controls .segmented button { min-width: 34px; }

.playback-roster {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
  padding: 8px;
  border: 1px solid color-mix(in srgb, var(--ui-border) 72%, transparent);
  border-radius: var(--ui-radius-sm);
  background: color-mix(in srgb, var(--ui-surface-panel-quiet) 65%, transparent);
}

.playback-roster button {
  --team: var(--ui-team-blue);
  position: relative;
  justify-self: center;
  width: 34px;
  height: 34px;
  padding: 2px;
  border: 2px solid color-mix(in srgb, var(--team) 58%, var(--ui-border));
  border-radius: 50%;
  background: #061018;
  cursor: pointer;
  transition: transform 100ms ease, border-color 100ms ease;
}

.playback-roster button.red { --team: var(--ui-team-red); }
.playback-roster button:hover,
.playback-roster button.selected {
  z-index: 2;
  transform: scale(1.12);
  border-color: var(--team);
  box-shadow: 0 0 0 1px #061018, 0 0 8px color-mix(in srgb, var(--team) 55%, transparent);
}

.playback-roster button.owner::after {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 8px;
  height: 8px;
  border: 2px solid #061018;
  border-radius: 50%;
  background: var(--ui-accent-strong);
  content: "";
}

.playback-roster img {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
}

.accuracy-note {
  margin: 0;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
  font-size: var(--ui-text-label);
  line-height: 1.45;
}

.accuracy-note summary {
  padding-top: 9px;
  color: var(--ui-text-subtle);
  cursor: pointer;
  user-select: none;
}

.accuracy-note p { margin: 7px 0 0; }

.playback-panel.compact .playback-layout {
  grid-template-columns: 1fr;
  gap: 13px;
}

.playback-panel.compact .playback-sidebar { gap: 10px; }
.playback-panel.compact .clock strong { font-size: 23px; }
.playback-panel.compact .primary-controls button { width: 31px; height: 31px; }
.playback-panel.compact .primary-controls .play-button { width: 38px; height: 38px; }
.playback-panel.compact .control-row { grid-template-columns: 1fr; gap: 9px; }

@keyframes event-pop {
  from { transform: translate(-50%, -50%) scale(.55); opacity: .2; }
  to { transform: translate(-50%, -50%) scale(1); opacity: 1; }
}

@keyframes stack-pop {
  from { transform: translate(-50%, -50%) scale(.74); }
  to { transform: translate(-50%, -50%) scale(1); }
}

@media (max-width: 900px) {
  .playback-layout { grid-template-columns: 1fr; }
  .playback-map { max-width: 620px; margin-inline: auto; }
}

@media (max-width: 560px) {
  .playback-heading { align-items: flex-start; flex-direction: column; }
  .transport { align-items: end; }
  .control-row { grid-template-columns: 1fr; }
  .champion-token { width: 27px; height: 27px; }
  .champion-token.owner { width: 31px; height: 31px; }
  .map-clock { top: 7px; right: 7px; }
}

@container recall-content (max-width: 900px) {
  .playback-layout { grid-template-columns: 1fr; }
  .playback-map { max-width: 620px; margin-inline: auto; }
}

@container recall-content (max-width: 560px) {
  .playback-heading { align-items: flex-start; flex-direction: column; }
  .control-row { grid-template-columns: 1fr; }
  .champion-token { width: 27px; height: 27px; }
  .champion-token.owner { width: 31px; height: 31px; }
}

@media (prefers-reduced-motion: reduce) {
  .champion-token,
  .playback-roster button { transition: none; }
  .champion-token.cluster-expanded { animation: none; }
  .playback-event { animation: none; }
}
</style>
