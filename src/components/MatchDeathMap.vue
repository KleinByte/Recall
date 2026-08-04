<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { championIconUrl } from "../helpers/format"
import { publicAssetUrl } from "../helpers/assets"
import { mapPositionPercent, reviewMapId } from "../helpers/map-coordinate"
import type { MatchRow, ParticipantRow } from "../types/stats"
import type { TimelineEvent } from "../types/review"

const props = defineProps<{
  match: MatchRow
  participants: ParticipantRow[]
  events: TimelineEvent[]
}>()

const selectedParticipantId = ref<number>()
watch(() => props.match.gameId, () => {
  selectedParticipantId.value = undefined
})

const mapId = computed(() => reviewMapId(props.match.modeFamily))
const mapName = computed(() => mapId.value === 12
  ? "Howling Abyss"
  : mapId.value === 453 ? "Classic Summoner's Rift" : "Summoner's Rift")
const mapStyle = computed(() => ({
  backgroundImage: `linear-gradient(color-mix(in srgb, var(--ui-canvas) 8%, transparent), color-mix(in srgb, var(--ui-canvas) 18%, transparent)), url("${publicAssetUrl(`game-data/ui/map${mapId.value}.png`)}")`,
}))

function participant(participantId?: number) {
  return props.participants.find((entry) => entry.participantId === participantId)
}

const allDeaths = computed(() => props.events.flatMap((event) => {
  if (event.type !== "CHAMPION_KILL" || !event.position || !event.targetId) return []
  const victim = participant(event.targetId)
  if (!victim) return []
  return [{ event, victim }]
}))

const unpositionedCount = computed(() => props.events.filter((event) =>
  event.type === "CHAMPION_KILL" && event.targetId && !event.position,
).length)
const visibleDeaths = computed(() => selectedParticipantId.value === undefined
  ? allDeaths.value
  : allDeaths.value.filter((death) => death.victim.participantId === selectedParticipantId.value))

const roster = computed(() => [...props.participants].sort((left, right) =>
  left.teamId - right.teamId || left.participantId - right.participantId,
))

function deathCount(participantId: number) {
  return allDeaths.value.filter((death) => death.victim.participantId === participantId).length
}

function dotStyle(death: typeof allDeaths.value[number]) {
  const plotted = mapPositionPercent(death.event.position!, mapId.value)
  return {
    left: `${plotted.left}%`,
    top: `${plotted.top}%`,
  }
}

function eventTime(timestamp: number) {
  return `${Math.floor(timestamp / 60_000)}:${String(Math.floor(timestamp / 1_000) % 60).padStart(2, "0")}`
}

function deathTitle(death: typeof allDeaths.value[number]) {
  const name = death.victim.summonerName || `Player ${death.victim.participantId}`
  return `${eventTime(death.event.timestamp)} · ${name} died`
}
</script>

<template>
  <section class="death-map-panel" :aria-label="`${mapName} champion death map`">
    <header>
      <div>
        <span class="eyebrow">Positioning</span>
        <h3>Champion deaths</h3>
      </div>
      <span class="death-total">{{ visibleDeaths.length }} shown</span>
    </header>

    <div class="death-map" :style="mapStyle">
      <span
        v-for="death in visibleDeaths"
        :key="death.event.eventId"
        class="death-dot"
        :class="death.victim.teamId === 100 ? 'blue' : 'red'"
        :style="dotStyle(death)"
        :title="deathTitle(death)"
        :aria-label="deathTitle(death)"
        role="img"
      />
      <div v-if="visibleDeaths.length === 0" class="map-empty">
        No positioned deaths for this champion.
      </div>
    </div>

    <div class="champion-filter" aria-label="Filter deaths by champion">
      <button
        type="button"
        class="all-deaths"
        :class="{ selected: selectedParticipantId === undefined }"
        :aria-pressed="selectedParticipantId === undefined"
        @click="selectedParticipantId = undefined"
      >
        All
        <strong>{{ allDeaths.length }}</strong>
      </button>
      <button
        v-for="player in roster"
        :key="player.participantId"
        type="button"
        class="champion-button"
        :class="[
          player.teamId === 100 ? 'blue' : 'red',
          { selected: selectedParticipantId === player.participantId },
        ]"
        :aria-pressed="selectedParticipantId === player.participantId"
        :title="`${player.summonerName || 'Player'} · ${deathCount(player.participantId)} deaths`"
        @click="selectedParticipantId = player.participantId"
      >
        <img :src="championIconUrl(player.championId)" alt="" />
        <strong>{{ deathCount(player.participantId) }}</strong>
      </button>
    </div>
    <p v-if="unpositionedCount" class="map-note">
      {{ unpositionedCount }} older kill {{ unpositionedCount === 1 ? "event has" : "events have" }} no map coordinate.
    </p>
  </section>
</template>

<style scoped>
.death-map-panel { min-width: 0; }
.death-map-panel > header { display: flex; align-items: end; justify-content: space-between; gap: 10px; min-height: 34px; margin-bottom: 8px; }
.death-map-panel h3 { margin: 1px 0 0; color: var(--ui-text-heading); font: 16px var(--ui-font-heading); }
.eyebrow { color: var(--ui-text-muted); font-size: 10px; letter-spacing: .9px; text-transform: uppercase; }
.death-total { color: var(--ui-text-muted); font-size: 11px; }
.death-map {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  border: 1px solid var(--ui-border-emphasis);
  border-radius: var(--ui-radius-md);
  background-position: center;
  background-size: 100% 100%;
  box-shadow: var(--ui-shadow-inset);
}
.death-dot {
  position: absolute;
  z-index: 2;
  width: 12px;
  height: 12px;
  transform: translate(-50%, -50%);
  border: 2px solid var(--ui-canvas);
  border-radius: 50%;
  background: var(--team);
  color: var(--team);
  box-shadow: 0 1px 5px color-mix(in srgb, var(--ui-canvas) 90%, transparent);
  cursor: help;
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.death-dot::after { content: ""; position: absolute; top: 50%; left: 50%; width: 3px; height: 3px; transform: translate(-50%, -50%); border-radius: 50%; background: var(--ui-text-heading); box-shadow: 0 0 1px var(--ui-canvas); }
.death-dot.blue { --team: var(--ui-team-blue); }
.death-dot.red { --team: var(--ui-team-red); }
.death-dot:hover { z-index: 4; transform: translate(-50%, -50%) scale(1.55); outline: 1px solid var(--ui-accent-strong); box-shadow: 0 0 8px currentColor; }
.map-empty { position: absolute; inset: 50% auto auto 50%; min-width: max-content; padding: 6px 8px; transform: translate(-50%, -50%); border: 1px solid var(--ui-border-emphasis); border-radius: var(--ui-radius-sm); background: var(--ui-surface-overlay); color: var(--ui-text-subtle); font-size: 11px; }
.champion-filter { display: grid; grid-template-columns: 52px repeat(5, 42px); grid-auto-rows: 42px; justify-content: space-between; gap: 6px; margin-top: 10px; }
.champion-filter button { position: relative; box-sizing: border-box; width: 42px; min-width: 42px; height: 42px; padding: 2px; overflow: visible; border: 1px solid var(--ui-border); border-radius: 50%; background: var(--ui-surface-panel-quiet); color: var(--ui-text-subtle); cursor: pointer; }
.champion-filter button:hover, .champion-filter button.selected { border-color: var(--ui-accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--ui-accent) 38%, transparent); }
.champion-filter button.blue { border-bottom-color: var(--ui-team-blue); }
.champion-filter button.red { border-bottom-color: var(--ui-team-red); }
.champion-filter img { display: block; width: 100%; height: 100%; aspect-ratio: 1; border-radius: 50%; object-fit: cover; }
.champion-filter strong { position: absolute; right: -2px; bottom: -2px; display: grid; place-items: center; min-width: 15px; height: 15px; padding: 0 2px; border: 1px solid var(--ui-border-emphasis); border-radius: var(--ui-radius-pill); background: var(--ui-canvas); color: var(--ui-text); font-size: 9px; font-variant-numeric: tabular-nums; }
.champion-filter .all-deaths { grid-row: span 2; align-self: center; width: 52px; min-width: 52px; height: 52px; border-radius: 8px; font-size: 11px; }
.map-note { margin: 7px 0 0; color: var(--ui-text-muted); font-size: 10px; line-height: 1.35; }
@media (max-width: 1120px) { .death-map { max-width: 460px; margin-inline: auto; }.champion-filter { max-width: 460px; margin-inline: auto; margin-top: 8px; } }
</style>
