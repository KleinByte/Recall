<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import MapReviewPopout from "./review/MapReviewPopout.vue"
import { championIconUrl } from "../helpers/format"
import { playbackWorldObjectiveIconUrl } from "../helpers/game-assets"
import { publicAssetUrl } from "../helpers/assets"
import { usePlaybackClock } from "../helpers/use-playback-clock"
import { mapPositionPercent, reviewMapId } from "../helpers/map-coordinate"
import {
  isUsableMapPosition,
  playbackCoverage,
  playbackMapEventLayer,
  playbackWorldMarkers,
  spreadOverlappingMapPoints,
} from "../helpers/timeline-playback"
import {
  bindMinimapParticipants,
  campClearName,
  clampMinimapPlaybackConfidence,
  minimapCampMarkersAt,
  minimapFirstEvidenceTimestamp,
  minimapPlaybackDuration,
  reliableMinimapSegments,
  unifiedPlaybackPositionsAt,
  unifiedPlaybackTrailSegments,
  type UnifiedPlaybackSource,
} from "../helpers/unified-playback"
import type { CampClearEvent } from "../shared/minimap/contracts"
import type { MinimapPathingReview } from "../shared/minimap/review"
import type { MatchRow, ParticipantRow } from "../types/stats"
import type {
  ParticipantLifeInterval,
  TimelineEvent,
  TimelineFrame,
} from "../types/review"

const props = defineProps<{
  match: MatchRow
  participants: ParticipantRow[]
  frames: TimelineFrame[]
  events: TimelineEvent[]
  lifeIntervals?: ParticipantLifeInterval[]
  timestamp: number
  compact?: boolean
  minimapReview?: MinimapPathingReview
  minimapLoading?: boolean
  minimapError?: string
  minimumCvConfidence?: number
}>()
const emit = defineEmits<{ "update:timestamp": [timestamp: number] }>()

const speed = ref(1)
const speedOptions = [1, 2, 4, 10] as const
const focusedParticipantId = ref<number>()
const expandedParticipantId = ref<number>()
const expandedMap = ref(false)
let lastEmittedTimestamp: number | undefined
let stackCollapseTimer: number | undefined

const mapId = computed(() => reviewMapId(props.match.modeFamily))
const mapName = computed(() => mapId.value === 12
  ? "Howling Abyss"
  : mapId.value === 453 ? "Classic Summoner's Rift" : "Summoner's Rift")
const mapStyle = computed(() => ({
  backgroundImage: `url("${publicAssetUrl(`game-data/ui/map${mapId.value}.png`)}")`,
}))
const minimumCvConfidence = computed(() =>
  clampMinimapPlaybackConfidence(props.minimumCvConfidence),
)
const minimapEnabledForMap = computed(() => mapId.value === 11)
const minimapBindings = computed(() => minimapEnabledForMap.value
  ? bindMinimapParticipants(props.minimapReview, props.participants)
  : [],
)
const reliableCvSegments = computed(() => minimapEnabledForMap.value
  ? reliableMinimapSegments(props.minimapReview, minimumCvConfidence.value)
  : [],
)
const mappedCvParticipantIds = computed(() => {
  const segmentKeys = new Set(reliableCvSegments.value.map((segment) => segment.participantKey))
  return minimapBindings.value
    .filter((binding) => segmentKeys.has(binding.participantKey))
    .map((binding) => binding.participantId)
})
const campClears = computed(() => minimapEnabledForMap.value
  ? [...(props.minimapReview?.campClears ?? [])].sort((left, right) =>
    left.clearedAtMs - right.clearedAtMs || left.campKey.localeCompare(right.campKey),
  )
  : [],
)
const duration = computed(() => Math.max(
  0,
  props.match.durationSecs * 1_000,
  ...props.frames.map((frame) => frame.timestamp),
  ...props.events.map((event) => event.timestamp),
  minimapEnabledForMap.value ? minimapPlaybackDuration(props.minimapReview) : 0,
))
const firstTimelinePositionTimestamp = computed(() => Math.min(
  ...props.frames.flatMap((frame) => frame.participants.some((participant) =>
    isUsableMapPosition(participant.position, mapId.value),
  ) ? [frame.timestamp] : []),
))
const firstPositionTimestamp = computed(() => Math.min(
  firstTimelinePositionTimestamp.value,
  minimapEnabledForMap.value
    ? minimapFirstEvidenceTimestamp(props.minimapReview, minimumCvConfidence.value)
    : Number.POSITIVE_INFINITY,
))
const coverage = computed(() => playbackCoverage(
  props.frames,
  props.participants.map((participant) => participant.participantId),
  mapId.value,
))
const timelineAvailable = computed(() =>
  coverage.value.positionedFrames >= 2 && coverage.value.positionedParticipants > 0,
)
const cvAvailable = computed(() => mappedCvParticipantIds.value.length > 0)
const campEvidenceAvailable = computed(() => campClears.value.length > 0)
const available = computed(() =>
  timelineAvailable.value || cvAvailable.value || campEvidenceAvailable.value,
)
const playback = usePlaybackClock({
  duration: () => duration.value,
  available: () => available.value,
  speed,
  initialTime: props.timestamp,
  renderFps: 30,
  publishFps: 10,
  onPublish: (timestamp) => {
    lastEmittedTimestamp = timestamp
    emit("update:timestamp", timestamp)
  },
})
const playbackTime = playback.time
const playing = playback.playing
const currentPositions = computed(() => new Map(
  unifiedPlaybackPositionsAt({
    frames: props.frames,
    events: props.events,
    lifeIntervals: props.lifeIntervals,
    minimapReview: minimapEnabledForMap.value ? props.minimapReview : undefined,
    bindings: minimapBindings.value,
    participantIds: props.participants.map((participant) => participant.participantId),
    timestamp: playbackTime.value,
    mapId: mapId.value,
    minimumConfidence: minimumCvConfidence.value,
  }).map((position) => [position.participantId, position]),
))
const roster = computed(() => [...props.participants].sort((left, right) =>
  left.teamId - right.teamId || left.participantId - right.participantId,
))
const focusedParticipant = computed(() => props.participants.find((participant) =>
  participant.participantId === focusedParticipantId.value,
))
const focusedPosition = computed(() => focusedParticipantId.value === undefined
  ? undefined
  : currentPositions.value.get(focusedParticipantId.value),
)
const visibleTokens = computed(() => {
  const tokens = props.participants.flatMap((participant) => {
    const current = currentPositions.value.get(participant.participantId)
    if (!current) return []
    return [{ participant, current, plotted: current.point }]
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
const trailSegments = computed(() => {
  const participantId = focusedParticipantId.value
  if (participantId === undefined || !props.participants.some((participant) =>
    participant.participantId === participantId,
  )) return []
  const participant = props.participants.find((candidate) =>
    candidate.participantId === participantId,
  )!
  return unifiedPlaybackTrailSegments({
    frames: props.frames,
    events: props.events,
    lifeIntervals: props.lifeIntervals,
    minimapReview: minimapEnabledForMap.value ? props.minimapReview : undefined,
    bindings: minimapBindings.value,
    participantId,
    timestamp: playbackTime.value,
    mapId: mapId.value,
    minimumConfidence: minimumCvConfidence.value,
  }).map((segment) => ({ ...segment, participant }))
})
const currentEvents = computed(() => props.events.flatMap((event) => {
  if (
    Math.abs(event.timestamp - playbackTime.value) > 2_500 ||
    playbackMapEventLayer(event, mapId.value) !== "transient" ||
    !isUsableMapPosition(event.position, mapId.value)
  ) return []
  return [{ event, plotted: mapPositionPercent(event.position!, mapId.value) }]
}))
const campMarkers = computed(() => minimapEnabledForMap.value && campClears.value.length > 0
  ? minimapCampMarkersAt(campClears.value, playbackTime.value)
  : [],
)
const worldMarkers = computed(() => playbackWorldMarkers(
  props.events,
  playbackTime.value,
  mapId.value,
  props.match.mode,
  props.match.gameVersion,
).filter((marker) => marker.kind !== "camp").map((marker) => ({
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

function clearFocus() {
  focusedParticipantId.value = undefined
  expandedParticipantId.value = undefined
  cancelStackCollapse()
}

function handleMapClick(event: MouseEvent) {
  const target = event.target
  if (target instanceof Element && target.closest("button, .playback-event, .world-marker")) return
  clearFocus()
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
  return {
    "--token-x": token.display.left,
    "--token-y": token.display.top,
    zIndex,
  }
}

function playbackSourceLabel(
  source: UnifiedPlaybackSource,
  origin?: "minimap_cv" | "riot_timeline",
) {
  if (source === "cv_observed") return "Observed CV"
  if (source === "riot_snapshot") return "Riot snapshot"
  return origin === "minimap_cv" ? "CV reconstructed" : "Estimated"
}

function tokenTitle(token: typeof visibleTokens.value[number]) {
  const stack = token.display.clusterSize > 1
    ? ` · stacked with ${token.display.clusterSize - 1} other champion${token.display.clusterSize === 2 ? "" : "s"}`
    : ""
  const confidence = Math.round(token.current.confidence * 100)
  return `${participantName(token.participant)} · ${playbackSourceLabel(token.current.source, token.current.origin)} · ${confidence}% confidence at ${formatTime(playbackTime.value)}${stack}`
}

function campMarkerStyle(marker: typeof campMarkers.value[number]) {
  return { left: `${marker.center.x * 100}%`, top: `${marker.center.y * 100}%` }
}

function campClearSourceLabel(source: CampClearEvent["source"]) {
  if (source === "minimap_cv") return "Minimap CV"
  if (source === "live_client_inference") return "Live Client + position"
  return "Manual"
}

function campMarkerTitle(marker: typeof campMarkers.value[number]) {
  const clear = marker.latestClear
  if (!clear) return `${campClearName(marker.key)} · no recorded clear yet`
  const route = clear.routeIndex === undefined ? "" : ` · clear ${clear.routeIndex + 1}`
  const attribution = clear.attribution === "local"
    ? "you"
    : clear.attribution === "other" ? "another player" : "uncertain player"
  const respawn = marker.state === "available"
    ? " · available"
    : marker.respawnInMs === undefined
      ? " · cleared"
      : ` · respawns in ${formatTime(marker.respawnInMs)}`
  return `${campClearName(marker.key)} · cleared by ${attribution} at ${formatTime(clear.clearedAtMs)}${route}${respawn} · ${campClearSourceLabel(clear.source)}`
}

function seekToCampClear(clear: CampClearEvent) {
  stop()
  setTimestamp(clear.clearedAtMs)
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
  playback.setTime(timestamp)
}

function seek(event: Event) {
  setTimestamp(Number((event.currentTarget as HTMLInputElement).value))
}

function stop() {
  playback.stop()
}

function togglePlayback() {
  if (playing.value) {
    stop()
    return
  }
  if (!available.value) return
  const start = playbackTime.value >= duration.value || playbackTime.value < firstPositionTimestamp.value
    ? Number.isFinite(firstPositionTimestamp.value) ? firstPositionTimestamp.value : 0
    : playbackTime.value
  setTimestamp(start)
  playback.play(start)
}

function skip(delta: number) {
  stop()
  setTimestamp(playbackTime.value + delta)
}

function handleKeyboard(event: KeyboardEvent) {
  if (event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLButtonElement ||
      event.target instanceof HTMLSelectElement) return
  if (event.code === "Space") {
    event.preventDefault()
    togglePlayback()
  } else if (event.key === "ArrowLeft") {
    event.preventDefault()
    skip(-15_000)
  } else if (event.key === "ArrowRight") {
    event.preventDefault()
    skip(15_000)
  } else if (event.key === "Escape" && focusedParticipantId.value !== undefined) {
    event.preventDefault()
    clearFocus()
  }
}

watch(() => props.match.gameId, () => {
  stop()
  cancelStackCollapse()
  focusedParticipantId.value = undefined
  expandedParticipantId.value = undefined
  expandedMap.value = false
})
watch(() => props.timestamp, (timestamp) => {
  if (lastEmittedTimestamp !== undefined && Math.abs(timestamp - lastEmittedTimestamp) < .5) {
    lastEmittedTimestamp = undefined
    return
  }
  playback.syncTime(timestamp)
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
    :aria-label="`${mapName} evidence-aware champion movement playback`"
    tabindex="0"
    @keydown="handleKeyboard"
  >
    <header class="playback-heading">
      <div>
        <span class="eyebrow">{{ mapName }}</span>
        <h3>Map playback</h3>
      </div>
      <div class="playback-heading-actions">
        <button
          type="button"
          class="map-popout-button"
          aria-label="Expand map playback"
          title="Expand map playback"
          @click="expandedMap = true"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3h6v2H5v4H3V3Zm8 0h6v6h-2V5h-4V3ZM3 11h2v4h4v2H3v-6Zm12 0h2v6h-6v-2h4v-4Z" /></svg>
          <span>Expand</span>
        </button>
      </div>
    </header>

    <MapReviewPopout
      :open="expandedMap"
      title="Map playback"
      labelled-by="match-map-popout-title"
      @close="expandedMap = false"
    >
    <div class="playback-layout" :class="{ expanded: expandedMap }">
      <div class="playback-map" :style="mapStyle" @pointerleave="scheduleStackCollapse" @click="handleMapClick">
        <svg class="trail-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line
            v-for="segment in trailSegments"
            :key="segment.key"
            :data-segment-key="segment.key"
            :class="[
              'trail-segment',
              segment.participant.teamId === 100 ? 'blue' : 'red',
              `origin-${segment.origin}`,
              `evidence-${segment.evidence}`,
              { owner: segment.participant.isPlayer === 1 },
            ]"
            :x1="segment.from.left"
            :y1="segment.from.top"
            :x2="segment.to.left"
            :y2="segment.to.top"
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
          :title="`${marker.label} · ${marker.state} at ${formatTime(playbackTime)}`"
          :aria-label="`${marker.label} ${marker.state} at ${formatTime(playbackTime)}`"
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
          v-for="marker in campMarkers"
          :key="`camp-state:${marker.key}`"
          type="button"
          class="camp-state-marker"
          :class="[
            marker.state,
            {
              pulse: marker.justCleared,
              local: marker.latestClear?.attribution === 'local',
              uncertain: marker.latestClear?.attribution === 'uncertain',
            },
          ]"
          :style="campMarkerStyle(marker)"
          :title="campMarkerTitle(marker)"
          :aria-label="campMarkerTitle(marker)"
          :disabled="!marker.latestClear"
          @click="marker.latestClear && seekToCampClear(marker.latestClear)"
        >
          <span v-if="marker.latestClear?.routeIndex !== undefined">
            {{ marker.latestClear.routeIndex + 1 }}
          </span>
        </button>

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
              'cv-observed': token.current.source === 'cv_observed',
              'riot-snapshot': token.current.source === 'riot_snapshot',
              estimated: token.current.source === 'estimated',
              'cv-origin': token.current.origin === 'minimap_cv',
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
          <i v-if="token.current.origin === 'minimap_cv'" class="token-badge cv-badge" aria-hidden="true" />
          <i v-if="token.participant.isPlayer === 1" class="token-badge owner-badge" aria-hidden="true" />
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

        <div class="map-clock" aria-hidden="true">{{ formatTime(playbackTime) }}</div>
        <div v-if="focusedParticipant" class="focused-player">
          <span :class="focusedParticipant.teamId === 100 ? 'blue' : 'red'" />
          <b>{{ participantName(focusedParticipant) }}</b>
          <small v-if="focusedPosition">
            {{ playbackSourceLabel(focusedPosition.source, focusedPosition.origin) }}
            · {{ Math.round(focusedPosition.confidence * 100) }}%
          </small>
        </div>

        <div v-if="!available" class="map-empty">
          <strong>Playback unavailable</strong>
          <span>This match has neither positioned Riot frames nor usable minimap CV tracks.</span>
        </div>
        <div v-else-if="visibleTokens.length === 0" class="map-empty">
          <strong>No position at {{ formatTime(playbackTime) }}</strong>
          <span>Seek to the first observed position or CV segment.</span>
        </div>
      </div>

      <aside class="playback-sidebar">
        <div class="transport">
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
          <div class="clock" aria-live="off">
            <strong>{{ formatTime(playbackTime) }}</strong>
            <span>{{ formatTime(duration) }}</span>
          </div>
          <label class="speed-control">
            <span class="visually-hidden">Playback speed</span>
            <select v-model.number="speed" aria-label="Playback speed">
              <option v-for="option in speedOptions" :key="option" :value="option">{{ option }}×</option>
            </select>
          </label>
        </div>

        <div v-if="expandedMap" class="scrubber-shell">
          <input
            class="scrubber"
            type="range"
            min="0"
            :max="duration"
            step="1000"
            :value="playbackTime"
            :disabled="!available"
            aria-label="Playback time"
            @input="seek"
          />
        </div>

        <p v-if="minimapLoading" class="minimap-status">Loading minimap telemetry…</p>
        <p v-else-if="minimapError" class="minimap-status error">{{ minimapError }}</p>

        <div class="playback-roster" aria-label="Players in this match">
          <button
            v-for="player in roster"
            :key="player.participantId"
            type="button"
            :class="[
              player.teamId === 100 ? 'blue' : 'red',
              {
                owner: player.isPlayer === 1,
                selected: focusedParticipantId === player.participantId,
              },
            ]"
            :title="participantName(player)"
            :aria-label="`Focus ${participantName(player)}`"
            :aria-pressed="focusedParticipantId === player.participantId"
            @click="focusParticipant(player.participantId)"
          >
            <img :src="championIconUrl(player.championId)" alt="" @error="championImageFallback" />
            <i v-if="mappedCvParticipantIds.includes(player.participantId)" class="roster-badge cv-badge" aria-hidden="true" />
            <i v-if="player.isPlayer === 1" class="roster-badge owner-badge" aria-hidden="true" />
          </button>
        </div>

        <details class="accuracy-note">
          <summary>About playback evidence</summary>
          <p>
            Click a champion token or roster portrait to show only that champion’s recent route; click it again, the empty map, or
            press Escape to clear it. Riot snapshots anchor one continuous route. Reliable CV sightings bend that route, while incoherent
            detector jumps are discarded and missing intervals are estimated between the surrounding evidence. Even a brief accepted
            sighting improves the route before it returns smoothly to estimation. Camp clears and respawns use the same playback clock
            as the gold chart and match events.
          </p>
        </details>
      </aside>
    </div>
    </MapReviewPopout>
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

.playback-heading-actions {
  display: flex;
  align-items: center;
}

.map-popout-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid var(--ui-border-emphasis);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface);
  color: var(--ui-text-subtle);
  cursor: pointer;
}
.map-popout-button:hover { border-color: var(--ui-accent); color: var(--ui-text-heading); }
.map-popout-button svg { width: 15px; fill: currentColor; }
.map-popout-button span { font-size: var(--ui-text-label); }

.eyebrow {
  color: var(--ui-text-muted);
  font-size: var(--ui-text-label);
  letter-spacing: .8px;
  text-transform: uppercase;
}

.playback-layout {
  display: grid;
  grid-template-columns: minmax(360px, 560px) minmax(250px, 1fr);
  align-items: center;
  gap: clamp(18px, 2.5vw, 32px);
}

.playback-layout.expanded {
  width: min(1220px, 100%);
  min-height: 0;
  margin: auto;
  grid-template-columns: minmax(560px, 1fr) minmax(300px, 360px);
  align-items: start;
}
.playback-layout.expanded .playback-map {
  width: 100%;
  max-width: 860px;
  margin: auto;
}
.playback-layout.expanded .playback-sidebar {
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  padding-right: 4px;
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
  container-type: size;
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

.trail-layer .trail-segment {
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
.trail-layer .evidence-estimated { opacity: .46; }

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


.camp-state-marker {
  --camp-color: var(--ui-text-muted);
  position: absolute;
  z-index: 4;
  display: grid;
  place-items: center;
  width: 12px;
  height: 12px;
  padding: 0;
  transform: translate(-50%, -50%);
  border: 1px solid color-mix(in srgb, var(--camp-color) 76%, #061018);
  border-radius: 50%;
  background: color-mix(in srgb, var(--camp-color) 28%, rgb(3 10 16 / 90%));
  color: white;
  box-shadow: 0 1px 4px rgb(0 0 0 / 72%);
  cursor: pointer;
}

.camp-state-marker.available {
  --camp-color: #9eb2b8;
  width: 8px;
  height: 8px;
  opacity: .58;
}

.camp-state-marker.cleared {
  --camp-color: var(--ui-negative);
  opacity: .82;
}

.camp-state-marker.respawning {
  --camp-color: var(--ui-warning);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-warning) 18%, transparent),
    0 1px 4px rgb(0 0 0 / 72%);
}

.camp-state-marker.local {
  z-index: 5;
  width: 17px;
  height: 17px;
  border-width: 2px;
  border-color: var(--ui-accent-strong);
  background: rgb(4 20 25 / 92%);
  box-shadow: 0 0 0 1px #061018, 0 0 8px color-mix(in srgb, var(--ui-accent) 68%, transparent);
}

.camp-state-marker.uncertain { border-style: dashed; }
.camp-state-marker:disabled { cursor: default; }
.camp-state-marker > span {
  font: 11px/1 var(--ui-font-heading);
  font-variant-numeric: tabular-nums;
}
.camp-state-marker.pulse { animation: camp-clear-pulse 900ms ease-out 3; }

.champion-token {
  --team: var(--ui-team-blue);
  position: absolute;
  top: 0;
  left: 0;
  z-index: 5;
  width: 31px;
  height: 31px;
  padding: 1px;
  transform: translate3d(
    calc(var(--token-x) * 1cqw - 50%),
    calc(var(--token-y) * 1cqw - 50%),
    0
  );
  border: 2px solid var(--team);
  border-radius: 50%;
  background: #061018;
  box-shadow: 0 2px 6px rgb(0 0 0 / 62%);
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.champion-token.red { --team: var(--ui-team-red); }
.champion-token.owner {
  z-index: 6;
}

.champion-token.focused {
  transform: translate3d(
    calc(var(--token-x) * 1cqw - 50%),
    calc(var(--token-y) * 1cqw - 50%),
    0
  ) scale(1.08);
  box-shadow: 0 0 9px color-mix(in srgb, var(--team) 68%, transparent), 0 2px 6px rgb(0 0 0 / 62%);
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

.champion-token > .token-badge {
  position: absolute;
  width: 8px;
  height: 8px;
  border: 1px solid #061018;
  border-radius: 50%;
  box-shadow: 0 1px 2px rgb(0 0 0 / 70%);
}

.champion-token > .owner-badge {
  right: -2px;
  bottom: -2px;
  background: var(--ui-accent-strong);
}

.champion-token > .cv-badge {
  top: -2px;
  right: -2px;
  background: #69d8c5;
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
  color: var(--ui-negative);
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
.focused-player b { overflow: hidden; text-overflow: ellipsis; }
.focused-player small { color: var(--ui-text-muted); font-size: var(--ui-text-micro); }

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
  flex-wrap: wrap;
  gap: 8px 12px;
  min-width: 0;
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
  font: 22px var(--ui-font-heading);
}

.clock span {
  font-size: 11px;
}

.clock span::before { content: "/ "; }

.primary-controls {
  display: flex;
  gap: 5px;
  flex: 0 0 auto;
}

.primary-controls button {
  min-height: 30px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-panel-quiet);
  color: var(--ui-text-subtle);
  cursor: pointer;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 7px;
}

.primary-controls svg {
  width: 100%;
  height: 100%;
  fill: currentColor;
}

.primary-controls button:hover:not(:disabled) {
  border-color: var(--ui-accent);
  color: var(--ui-accent-strong);
}

.primary-controls button:disabled {
  opacity: .42;
  cursor: not-allowed;
}

.primary-controls .play-button {
  width: 38px;
  height: 34px;
  padding: 8px;
  border-color: color-mix(in srgb, var(--ui-accent) 65%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-accent) 15%, var(--ui-surface-panel-quiet));
  color: var(--ui-accent-strong);
}

.speed-control {
  display: block;
  width: 66px;
  margin-left: auto;
  flex: 0 0 66px;
}

.speed-control select {
  width: 100%;
  min-height: 34px;
  padding: 4px 24px 4px 8px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-panel-quiet);
  color: var(--ui-text-heading);
  font: var(--ui-text-label) var(--ui-font-heading);
  cursor: pointer;
}

.speed-control select:hover,
.speed-control select:focus-visible {
  border-color: var(--ui-accent);
  outline: none;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.scrubber-shell {
  min-width: 0;
}

.scrubber {
  display: block;
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

.minimap-status {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: var(--ui-text-label);
}
.minimap-status.error { color: var(--ui-warning); }


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
  padding: 1px;
  border: 2px solid var(--team);
  border-radius: 50%;
  background: #061018;
  cursor: pointer;
  transition: transform 100ms ease, border-color 100ms ease;
}

.playback-roster button.red { --team: var(--ui-team-red); }
.playback-roster button:hover,
.playback-roster button.selected {
  z-index: 2;
  transform: scale(1.06);
  box-shadow: 0 0 8px color-mix(in srgb, var(--team) 58%, transparent);
}

.playback-roster .roster-badge {
  position: absolute;
  width: 8px;
  height: 8px;
  border: 1px solid #061018;
  border-radius: 50%;
  box-shadow: 0 1px 2px rgb(0 0 0 / 70%);
}
.playback-roster .owner-badge {
  right: -2px;
  bottom: -2px;
  background: var(--ui-accent-strong);
}
.playback-roster .cv-badge {
  top: -2px;
  right: -2px;
  background: #69d8c5;
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

.playback-panel.compact .playback-layout:not(.expanded) {
  grid-template-columns: 1fr;
  gap: 13px;
}

.playback-panel.compact .playback-layout:not(.expanded) .playback-map {
  width: min(100%, 640px);
  margin-inline: auto;
}

.playback-panel.compact .playback-sidebar { gap: 10px; }
.playback-panel.compact .clock strong { font-size: 20px; }
.playback-panel.compact .primary-controls button { width: 31px; height: 31px; }
.playback-panel.compact .primary-controls .play-button { width: 36px; height: 31px; }
.playback-panel.compact .speed-control select { min-height: 31px; }

@keyframes event-pop {
  from { transform: translate(-50%, -50%) scale(.55); opacity: .2; }
  to { transform: translate(-50%, -50%) scale(1); opacity: 1; }
}

@keyframes stack-pop {
  from {
    transform: translate3d(
      calc(var(--token-x) * 1cqw - 50%),
      calc(var(--token-y) * 1cqw - 50%),
      0
    ) scale(.74);
  }
  to {
    transform: translate3d(
      calc(var(--token-x) * 1cqw - 50%),
      calc(var(--token-y) * 1cqw - 50%),
      0
    ) scale(1);
  }
}

@keyframes camp-clear-pulse {
  0% { transform: translate(-50%, -50%) scale(.8); }
  55% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--ui-accent) 35%, transparent); }
  100% { transform: translate(-50%, -50%) scale(1); }
}

@media (max-width: 900px) {
  .playback-layout { grid-template-columns: 1fr; }
  .playback-map { max-width: 620px; margin-inline: auto; }
}

@media (max-width: 900px) {
  .playback-layout.expanded {
    width: min(860px, 100%);
    grid-template-columns: 1fr;
  }
  .playback-layout.expanded .playback-sidebar {
    max-height: none;
    overflow-y: visible;
  }
}

@media (max-width: 560px) {
  .playback-heading { align-items: flex-start; flex-direction: column; }
  .transport { align-items: center; }
  .champion-token { width: 27px; height: 27px; }
  .map-clock { top: 7px; right: 7px; }
}

@container recall-content (max-width: 900px) {
  .playback-layout { grid-template-columns: 1fr; }
  .playback-map { max-width: 620px; margin-inline: auto; }
}

@container recall-content (max-width: 560px) {
  .playback-heading { align-items: flex-start; flex-direction: column; }
  .champion-token { width: 27px; height: 27px; }
}

@media (prefers-reduced-motion: reduce) {
  .champion-token,
  .playback-roster button { transition: none; }
  .champion-token.cluster-expanded { animation: none; }
  .playback-event { animation: none; }
}
</style>
