<script setup lang="ts">
import { computed } from "vue"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import {
  faChessRook,
  faCrown,
  faDragon,
  faFlag,
} from "@fortawesome/free-solid-svg-icons"
import GradeBadge from "./GradeBadge.vue"
import RunePage from "./RunePage.vue"
import { championIconUrl, championNameById, formatCompact } from "../helpers/format"
import { itemIconUrl, summonerSpellIconUrl } from "../helpers/ddragon"
import { lobbyStandings, teamTotals } from "../helpers/match-detail"
import { POSITIONS, positionForPlayer, positionIconUrl, positionLabel } from "../helpers/roles"
import { aramPoroIconUrl, type GameAssetCatalog } from "../helpers/game-assets"
import type { Champion } from "../types/lol"
import type { MatchRow, ParticipantRow, TeamRow } from "../types/stats"

const props = defineProps<{
  match: MatchRow
  participants: ParticipantRow[]
  teams: TeamRow[]
  champions: Champion[] | null
  assets: GameAssetCatalog
}>()

const standings = computed(() => lobbyStandings(props.participants))
const highestDamage = computed(() => Math.max(1, ...props.participants.map((row) => row.damageToChampions)))

const players = (teamId: number) => props.participants
  .filter((row) => row.teamId === teamId)
  .sort((left, right) => {
    const leftPosition = positionForPlayer(left)
    const rightPosition = positionForPlayer(right)
    const leftIndex = leftPosition ? POSITIONS.indexOf(leftPosition) : 99
    const rightIndex = rightPosition ? POSITIONS.indexOf(rightPosition) : 99
    return leftIndex - rightIndex || left.participantId - right.participantId
  })

const team = (teamId: number) => props.teams.find((entry) => entry.teamId === teamId)
const totals = (teamId: number) => teamTotals(players(teamId))
const enemyKills = (teamId: number) => totals(teamId === 100 ? 200 : 100).kills

const bans = (teamId: number) => {
  try {
    return (JSON.parse(team(teamId)?.bans ?? "[]") as number[]).filter((id) => id > 0)
  } catch {
    return []
  }
}

const role = (row: ParticipantRow) =>
  positionForPlayer(row)

const displayName = (row: ParticipantRow) =>
  row.summonerName || championNameById(props.champions, row.championId)

const ordinal = (value: number) => {
  if (value === 1) return "MVP"
  const remainder = value % 100
  const suffix = remainder >= 11 && remainder <= 13
    ? "th"
    : value % 10 === 1
      ? "st"
      : value % 10 === 2
        ? "nd"
        : value % 10 === 3
          ? "rd"
          : "th"
  return `${value}${suffix}`
}

const place = (row: ParticipantRow) => standings.value.get(row.participantId)?.place
const teamKillParticipation = (row: ParticipantRow) => {
  const kills = totals(row.teamId).kills
  return kills > 0 ? Math.min(1, (row.kills + row.assists) / kills) : 0
}
const kda = (row: ParticipantRow) =>
  row.deaths === 0 ? row.kills + row.assists : (row.kills + row.assists) / row.deaths
const itemSlots = (row: ParticipantRow) => Array.from({ length: 7 }, (_, index) => row.items[index] ?? 0)
const aramLabel = computed(() => props.match.mode === "mayhem" ? "Mayhem" : "ARAM")
</script>

<template>
  <div class="scoreboard-shell" aria-label="Complete match scoreboard">
    <section v-for="teamId in [100, 200]" :key="teamId" class="team-board" :class="teamId === 100 ? 'blue' : 'red'">
      <header class="team-head">
        <div class="team-result">
          <strong>{{ teamId === 100 ? "Blue team" : "Red team" }}</strong>
          <span>{{ totals(teamId).kills }} / {{ enemyKills(teamId) }} / {{ totals(teamId).assists }}</span>
        </div>

        <div class="team-objectives" aria-label="Team objectives">
          <span title="Towers"><FontAwesomeIcon :icon="faChessRook" />{{ team(teamId)?.towerKills ?? 0 }}</span>
          <span title="Dragons"><FontAwesomeIcon :icon="faDragon" />{{ team(teamId)?.dragonKills ?? 0 }}</span>
          <span title="Barons"><FontAwesomeIcon :icon="faCrown" />{{ team(teamId)?.baronKills ?? 0 }}</span>
          <span title="Rift Heralds"><FontAwesomeIcon :icon="faFlag" />{{ team(teamId)?.heraldKills ?? 0 }}</span>
        </div>

        <span class="team-total"><strong>{{ formatCompact(totals(teamId).gold) }}</strong> gold</span>
        <span class="team-total"><strong>{{ formatCompact(totals(teamId).damage) }}</strong> damage</span>

        <div v-if="bans(teamId).length" class="team-bans">
          <span>Bans</span>
          <img
            v-for="championId in bans(teamId)"
            :key="championId"
            :src="championIconUrl(championId)"
            :title="championNameById(champions, championId)"
            alt=""
          />
        </div>
      </header>

      <div class="player-labels" aria-hidden="true">
        <span>Player</span><span>Lobby</span><span>Role</span><span>Build</span><span>KDA</span><span>Farm</span><span>Damage</span>
      </div>

      <article
        v-for="row in players(teamId)"
        :key="row.participantId"
        class="player-row"
        :class="{ owner: row.isPlayer === 1 }"
      >
        <div class="player-identity">
          <span class="portrait-wrap">
            <img :src="championIconUrl(row.championId)" :alt="championNameById(champions, row.championId)" />
            <strong>{{ row.champLevel }}</strong>
          </span>
          <span class="spells" aria-label="Summoner spells">
            <img v-if="summonerSpellIconUrl(row.spell1Id)" :src="summonerSpellIconUrl(row.spell1Id)" alt="" />
            <img v-if="summonerSpellIconUrl(row.spell2Id)" :src="summonerSpellIconUrl(row.spell2Id)" alt="" />
          </span>
          <RunePage :participant="row" :classic="match.modeFamily === 'classic'" align="left" compact />
          <div class="player-name">
            <strong :title="displayName(row)">{{ displayName(row) }}</strong>
            <span>{{ championNameById(champions, row.championId) }}</span>
          </div>
        </div>

        <div class="place-cell">
          <span v-if="place(row)" :class="{ mvp: place(row) === 1 }">{{ ordinal(place(row) ?? 0) }}</span>
          <GradeBadge v-else :grade="row.grade" />
        </div>

        <div
          class="role-cell"
          :class="{ aram: match.modeFamily === 'aram' }"
          :title="match.modeFamily === 'aram' ? `${aramLabel} · Howling Abyss` : positionLabel(role(row))"
        >
          <img
            v-if="match.modeFamily === 'aram'"
            :src="aramPoroIconUrl()"
            alt=""
          />
          <img v-else :src="positionIconUrl(role(row))" alt="" />
          <span>{{ match.modeFamily === "aram" ? aramLabel : positionLabel(role(row)) }}</span>
        </div>

        <div class="build-cell" aria-label="Final build">
          <template v-for="(itemId, index) in itemSlots(row)" :key="index">
            <img
              v-if="itemId"
              :src="assets.items[itemId]?.icon || itemIconUrl(itemId)"
              :title="assets.items[itemId]?.name || `Item ${itemId}`"
              alt=""
            />
            <span v-else class="empty-item" />
          </template>
        </div>

        <div class="number-cell kda-cell">
          <strong>{{ row.kills }} / {{ row.deaths }} / {{ row.assists }}</strong>
          <span :class="{ accent: row.deaths === 0 || kda(row) >= 4 }">{{ kda(row).toFixed(2) }} KDA</span>
        </div>

        <div class="number-cell">
          <strong>{{ row.totalMinionsKilled + row.neutralMinions }} CS</strong>
          <span>{{ Math.round(teamKillParticipation(row) * 100) }}% KP</span>
        </div>

        <div class="damage-cell">
          <strong>{{ row.damageToChampions.toLocaleString() }} dmg</strong>
          <span><i :style="{ width: `${row.damageToChampions / highestDamage * 100}%` }" /></span>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.scoreboard-shell { display: grid; gap: 12px; min-width: 1080px; }
.team-board { overflow: visible; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-lg); background: var(--ui-surface-panel-quiet); box-shadow: var(--ui-shadow-panel); }
.team-board.blue { --team: var(--ui-team-blue); }.team-board.red { --team: var(--ui-team-red); }
.team-head { display: grid; grid-template-columns: minmax(210px, 1.4fr) minmax(190px, .9fr) 120px 135px minmax(220px, 1fr); align-items: center; gap: 12px; min-height: 52px; padding: 8px 16px; border-bottom: 1px solid var(--ui-divider); background: color-mix(in srgb, var(--ui-text) 1.8%, transparent); }
.team-result { display: flex; align-items: baseline; gap: 24px; }.team-result strong { color: var(--team); font: 14px var(--ui-font-heading); text-transform: uppercase; }.team-result span { color: var(--ui-text-subtle); font-size: 12px; }
.team-objectives { display: flex; align-items: center; gap: 13px; color: var(--ui-text-muted); font-size: 11px; }.team-objectives span { display: inline-flex; align-items: center; gap: 5px; }.team-objectives svg { color: color-mix(in srgb, var(--team) 55%, var(--ui-text-muted)); }
.team-total { color: var(--ui-text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }.team-total strong { color: var(--ui-text-subtle); font-size: 14px; }
.team-bans { display: flex; align-items: center; justify-content: flex-end; gap: 4px; min-width: 0; }.team-bans span { margin-right: 5px; color: var(--ui-text-muted); font-size: 12px; text-transform: uppercase; }.team-bans img { width: 25px; height: 25px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-xs); object-fit: cover; filter: saturate(.72); }
.player-labels, .player-row { display: grid; grid-template-columns: minmax(260px, 1.45fr) 58px 64px minmax(220px, 1.2fr) 108px 92px 132px; align-items: center; gap: 10px; padding-inline: 14px; }
.player-labels { min-height: 27px; border-bottom: 1px solid color-mix(in srgb, var(--ui-divider) 60%, transparent); color: var(--ui-text-muted); font-size: 11px; letter-spacing: .65px; text-transform: uppercase; }.player-labels span:not(:first-child) { text-align: center; }
.player-row { min-height: 62px; border-bottom: 1px solid color-mix(in srgb, var(--ui-divider) 58%, transparent); }.player-row:last-child { border-bottom: 0; }.player-row.owner { background: linear-gradient(90deg, color-mix(in srgb, var(--ui-accent) 11%, transparent), transparent 48%); box-shadow: inset 3px 0 var(--ui-accent); }
.player-identity { display: flex; align-items: center; gap: 7px; min-width: 0; }.portrait-wrap { position: relative; flex: 0 0 42px; }.portrait-wrap > img { width: 42px; height: 42px; border: 2px solid var(--team); border-radius: 50%; object-fit: cover; }.portrait-wrap > strong { position: absolute; right: -2px; bottom: -2px; display: grid; place-items: center; min-width: 17px; height: 17px; padding: 0 2px; border-radius: 9px; background: var(--ui-canvas); color: var(--ui-text); font-size: 11px; box-shadow: 0 0 0 1px var(--team); }
.spells { display: grid; gap: 2px; flex: 0 0 auto; }.spells img { width: 18px; height: 18px; border-radius: 3px; }
.player-name { display: flex; flex-direction: column; min-width: 0; margin-left: 2px; }.player-name strong { overflow: hidden; color: var(--ui-text); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }.player-row.owner .player-name strong { color: var(--ui-accent-strong); }.player-name span { margin-top: 2px; color: var(--ui-text-muted); font-size: 12px; }
.place-cell { display: grid; place-items: center; }.place-cell > span { min-width: 42px; padding: 6px 7px; border-radius: var(--ui-radius-sm); background: var(--ui-surface-hover); color: var(--ui-text-subtle); font: 12px var(--ui-font-heading); text-align: center; }.place-cell > span.mvp { background: color-mix(in srgb, var(--ui-accent) 22%, var(--ui-surface-hover)); color: var(--ui-accent-strong); }
.role-cell { display: flex; flex-direction: column; align-items: center; gap: 3px; color: var(--ui-text-muted); font-size: 11px; text-transform: uppercase; }.role-cell img { width: 20px; height: 20px; object-fit: contain; opacity: .82; }.role-cell.aram img { width: 24px; height: 22px; opacity: 1; filter: drop-shadow(0 0 4px color-mix(in srgb, var(--ui-team-blue) 30%, transparent)); }.role-cell.aram span { color: var(--ui-team-blue); font-size: var(--ui-text-micro); }
.build-cell { display: grid; grid-template-columns: repeat(7, 27px); gap: 3px; justify-content: center; }.build-cell img, .empty-item { width: 27px; height: 27px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-xs); background: color-mix(in srgb, var(--ui-surface-hover) 70%, transparent); object-fit: cover; }.empty-item { opacity: .38; }
.number-cell { display: flex; flex-direction: column; align-items: center; gap: 3px; font-variant-numeric: tabular-nums; }.number-cell strong { color: var(--ui-text); font-size: 13px; }.number-cell span { color: var(--ui-text-muted); font-size: 11px; }.number-cell span.accent { color: var(--ui-accent-strong); }
.damage-cell { display: flex; flex-direction: column; gap: 6px; min-width: 0; font-variant-numeric: tabular-nums; }.damage-cell strong { color: var(--ui-text); font-size: 12px; text-align: right; }.damage-cell > span { height: 5px; overflow: hidden; border-radius: 4px; background: var(--ui-surface-hover); }.damage-cell i { display: block; height: 100%; border-radius: inherit; background: var(--team); }
@media (max-width: 1180px) { .scoreboard-shell { min-width: 1010px; }.player-labels, .player-row { grid-template-columns: minmax(245px, 1.35fr) 54px 58px minmax(210px, 1fr) 100px 86px 118px; }.build-cell { grid-template-columns: repeat(7, 25px); }.build-cell img, .empty-item { width: 25px; height: 25px; } }
</style>
