<script setup lang="ts">
import GradeBadge from "./GradeBadge.vue"
import { faChevronRight } from "@fortawesome/free-solid-svg-icons"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import type { MatchRow, ParticipantRow } from "../types/stats"
import type { Champion } from "../types/lol"
import { openMatch } from "../helpers/navigation"
import { labelIcon } from "../helpers/label-icons"
import { itemIconUrl, summonerSpellIconUrl } from "../helpers/ddragon"
import { positionIconUrl, positionLabel, resolvePosition } from "../helpers/roles"
import {
  championIconUrl,
  championNameById,
  formatCompact,
  formatDecimal,
  formatDuration,
  formatRelativeDate,
  modeLabel,
} from "../helpers/format"

const props = defineProps<{
  matches: MatchRow[]
  champions: Champion[] | null
}>()

const player = (match: MatchRow) =>
  match.participants?.find((row) => row.isPlayer === 1)

const spells = (match: MatchRow) => {
  const owner = player(match)
  return [owner?.spell1Id, owner?.spell2Id]
    .filter((spell): spell is number => typeof spell === "number" && spell > 0)
}

const kda = (match: MatchRow) =>
  match.deaths === 0
    ? match.kills + match.assists
    : (match.kills + match.assists) / match.deaths

const position = (match: MatchRow) => {
  if (match.modeFamily !== "sr" && match.modeFamily !== "classic") return undefined
  const owner = player(match)
  return resolvePosition(
    owner?.lane ?? match.lane,
    owner?.role ?? match.role,
    owner?.assignedPosition ?? match.assignedPosition,
  )
}

const participantPosition = (match: MatchRow, row: ParticipantRow) =>
  match.modeFamily === "sr" || match.modeFamily === "classic"
    ? resolvePosition(row.lane, row.role, row.assignedPosition)
    : undefined

const creepScore = (match: MatchRow) =>
  match.totalMinionsKilled + match.neutralMinions

const side = (match: MatchRow, teamId: number) =>
  (match.participants ?? []).filter((row) => row.teamId === teamId)

const teamKills = (match: MatchRow, teamId?: number) =>
  teamId
    ? side(match, teamId).reduce((sum, row) => sum + row.kills, 0)
    : 0

const killParticipation = (match: MatchRow) => {
  const owner = player(match)
  const kills = teamKills(match, owner?.teamId)
  return kills > 0 ? (match.kills + match.assists) / kills : 0
}

const patchLabel = (version: string) => {
  const [major, minor] = version.split(".")
  return major && minor ? `${major}.${minor}` : version
}

const displayName = (row: ParticipantRow) =>
  row.summonerName ?? championNameById(props.champions, row.championId)

</script>

<template>
  <div class="match-list">
    <article
      v-for="match in matches"
      :key="match.gameId"
      class="match-card"
      :class="match.win ? 'won' : 'lost'"
    >
      <button class="card-button" @click="openMatch(match)">
        <header class="card-head">
          <div class="headline">
            <span class="outcome" :class="match.win ? 'win-text' : 'loss-text'">
              {{ match.win ? "Victory" : "Defeat" }}
            </span>
            <strong>{{ match.queueName ?? modeLabel(match.mode) }}</strong>
            <span class="muted">{{ formatRelativeDate(match.playedAt) }}</span>
            <span class="dot">·</span>
            <span class="muted">{{ formatDuration(match.durationSecs) }}</span>
            <span class="dot">·</span>
            <span class="muted">Patch {{ patchLabel(match.gameVersion) }}</span>
          </div>
          <span class="details-link">
            Match details
            <FontAwesomeIcon :icon="faChevronRight" aria-hidden="true" />
          </span>
        </header>

        <div class="card-main">
          <section class="champion-block">
            <span class="portrait-wrap">
              <img
                class="champion-icon"
                :src="championIconUrl(match.championId)"
                :alt="championNameById(champions, match.championId)"
                loading="lazy"
              />
              <img
                v-if="position(match)"
                class="portrait-role"
                :src="positionIconUrl(position(match))"
                :title="positionLabel(position(match))"
                alt=""
              />
            </span>

            <span class="spells" aria-label="Summoner spells">
              <img
                v-for="spell in spells(match)"
                :key="spell"
                v-show="summonerSpellIconUrl(spell)"
                :src="summonerSpellIconUrl(spell)"
                alt=""
              />
            </span>

            <GradeBadge :grade="match.grade" />
          </section>

          <section class="performance" aria-label="Performance summary">
            <span class="stat-block kda-block">
              <strong class="numeric kda-line">
                {{ match.kills }} <span>/</span> {{ match.deaths }} <span>/</span> {{ match.assists }}
              </strong>
              <span class="accent numeric">{{ formatDecimal(kda(match), 2) }} KDA</span>
            </span>

            <span class="stat-block">
              <strong class="numeric">{{ creepScore(match) }} CS</strong>
              <span class="muted numeric">{{ formatDecimal(match.csPerMin ?? 0, 1) }}/min</span>
            </span>

            <span class="stat-block contribution">
              <strong class="numeric">{{ formatDecimal(killParticipation(match) * 100, 1) }}% KP</strong>
              <span class="muted numeric">{{ formatCompact(match.damageToChampions) }} damage</span>
            </span>
          </section>

          <section class="build" aria-label="Final build">
            <template v-for="(item, index) in player(match)?.items ?? []" :key="index">
              <img
                v-if="itemIconUrl(item)"
                :src="itemIconUrl(item)"
                :title="`Item ${item}`"
                alt=""
              />
              <span v-else class="item-empty" />
            </template>
          </section>

          <section v-if="match.participants?.length" class="rosters" aria-label="Match roster">
            <div v-for="teamId in [100, 200]" :key="teamId" class="team-roster">
              <span
                v-for="row in side(match, teamId)"
                :key="row.participantId"
                class="roster-player"
                :class="{ me: row.isPlayer === 1 }"
                :title="`${displayName(row)} — ${row.kills}/${row.deaths}/${row.assists}`"
              >
                <img class="roster-champion" :src="championIconUrl(row.championId)" alt="" />
                <img
                  v-if="participantPosition(match, row)"
                  class="roster-role"
                  :src="positionIconUrl(participantPosition(match, row))"
                  alt=""
                />
                <span class="roster-name">{{ displayName(row) }}</span>
              </span>
            </div>
          </section>
        </div>

        <footer class="card-foot">
          <span v-if="match.lobbyPlace" class="place-chip" :class="{ mvp: match.lobbyPlace === 1 }">
            {{ match.lobbyPlace === 1 ? "MVP" : `Lobby #${match.lobbyPlace}` }}
          </span>
          <span
            v-for="label in match.labelNames?.slice(0, 5) ?? []"
            :key="label"
            class="game-label"
          >
            <FontAwesomeIcon :icon="labelIcon(label)" aria-hidden="true" />
            {{ label }}
          </span>
          <span v-for="tag in match.tagNames ?? []" :key="tag" class="tag-chip">{{ tag }}</span>
          <span v-if="match.bookmarked" class="annotation" title="Bookmarked">★</span>
          <span v-if="match.hasNote" class="annotation">Note</span>
          <span v-if="match.experimentCount" class="annotation">Experiment</span>
        </footer>
      </button>
    </article>

    <p v-if="matches.length === 0" class="muted empty">No matches recorded yet.</p>
  </div>
</template>

<style scoped>
.match-list { display: flex; flex-direction: column; gap: var(--space-2); }

.match-card {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-left: 4px solid var(--border-strong);
  border-radius: var(--radius-md);
  background:
    linear-gradient(100deg, color-mix(in srgb, var(--surface-2) 88%, transparent), var(--surface-1));
  box-shadow: 0 8px 22px rgba(0, 0, 0, .12);
}
.match-card.won { border-left-color: var(--win); }
.match-card.lost { border-left-color: var(--loss); }

.card-button {
  width: 100%; padding: 0; border: 0; background: transparent; color: inherit;
  text-align: left; font: inherit; cursor: pointer;
}
.card-button:hover { background: color-mix(in srgb, var(--surface-3) 52%, transparent); }

.card-head {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
  padding: 5px 10px; border-bottom: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--surface-3) 42%, transparent);
  font-size: 11px;
}
.headline { display: flex; align-items: center; gap: 7px; min-width: 0; }
.headline strong { color: var(--text-primary); font: 11px var(--font-heading); letter-spacing: .55px; text-transform: uppercase; }
.outcome { font: 10px var(--font-heading); letter-spacing: .8px; text-transform: uppercase; }
.dot { color: var(--text-muted); }
.details-link { flex: 0 0 auto; display: flex; align-items: center; gap: 7px; color: var(--gold-bright); font-size: 10px; }

.card-main {
  display: grid;
  grid-template-columns: 140px minmax(238px, .78fr) 118px minmax(410px, 1.7fr);
  align-items: center; gap: 10px; min-height: 85px; padding: 4px 10px;
}
.champion-block { display: flex; align-items: center; gap: 6px; min-width: 0; }
.portrait-wrap { position: relative; flex: 0 0 auto; }
.champion-icon { width: 48px; height: 48px; border: 2px solid var(--border-strong); border-radius: 50%; object-fit: cover; }
.portrait-role {
  position: absolute; right: -3px; bottom: -3px; width: 18px; height: 18px; padding: 3px;
  border: 1px solid var(--gold); border-radius: 50%; background: var(--surface-0);
}
.spells { display: grid; grid-template-columns: repeat(2, 20px); gap: 2px; }
.spells img { width: 20px; height: 20px; border-radius: 3px; }

.performance { display: grid; grid-template-columns: 1.15fr .8fr 1fr; align-items: center; min-width: 0; }
.stat-block { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; padding: 0 6px; border-left: 1px solid var(--border-subtle); }
.stat-block:first-child { border-left: 0; }
.stat-block strong { color: var(--text-primary); font-size: 12px; }
.stat-block span { font-size: 10px; }
.kda-line { font-size: 14px !important; }
.kda-line span { color: var(--text-muted); font-size: 12px; }
.accent { color: var(--win); font-weight: 700; }

.build { display: grid; grid-template-columns: repeat(4, 27px); gap: 3px; align-content: center; justify-content: center; }
.build img, .item-empty { width: 27px; height: 27px; border-radius: 3px; background: var(--surface-3); }
.build img { border: 1px solid var(--border-subtle); object-fit: cover; }
.item-empty { opacity: .42; }

.rosters { display: grid; grid-template-columns: repeat(2, minmax(195px, 245px)); justify-content: start; gap: 20px; min-width: 0; }
.team-roster { display: grid; grid-template-rows: repeat(5, 17px); gap: 0; min-width: 0; }
.roster-player { display: grid; grid-template-columns: 17px 11px minmax(120px, 1fr); align-items: center; gap: 5px; min-width: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.15; }
.roster-player.me { color: var(--gold-bright); }
.roster-champion { width: 17px; height: 17px; border: 1px solid var(--border-subtle); border-radius: 50%; object-fit: cover; }
.roster-role { width: 11px; height: 11px; opacity: .76; }
.roster-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.card-foot { display: flex; align-items: center; gap: 4px; min-height: 22px; padding: 3px 10px 5px; flex-wrap: wrap; }
.game-label, .tag-chip, .place-chip, .annotation {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--surface-0) 74%, transparent); color: var(--text-secondary);
  font-size: 8px; line-height: 1; white-space: nowrap;
}
.game-label { border-color: rgba(200, 170, 110, .3); color: var(--gold-bright); }
.place-chip { color: var(--text-primary); }
.place-chip.mvp { border-color: var(--gold); background: rgba(200, 170, 109, .16); color: var(--gold-bright); font-weight: 700; }
.tag-chip { color: var(--cyan); }
.annotation { color: var(--text-muted); }
.empty { padding: var(--space-5); text-align: center; font-size: 12px; }

@media (max-width: 1320px) {
  .card-main { grid-template-columns: 136px minmax(225px, .9fr) 112px minmax(380px, 1.5fr); }
  .rosters { grid-template-columns: repeat(2, minmax(175px, 220px)); gap: 12px; }
  .roster-player { grid-template-columns: 17px 11px minmax(110px, 1fr); }
}

@media (max-width: 850px) {
  .card-head { align-items: flex-start; }
  .headline { flex-wrap: wrap; }
  .details-link { font-size: 0; }
  .details-link svg { font-size: 11px; }
  .card-main { grid-template-columns: 138px minmax(230px, 1fr) 118px; }
  .build { grid-column: 1 / -1; display: flex; justify-content: flex-start; }
  .rosters { display: none; }
  .champion-block { grid-row: auto; }
}

@media (max-width: 580px) {
  .card-main { grid-template-columns: 1fr 1fr; }
  .champion-block { grid-column: 1 / -1; grid-row: auto; }
  .performance { grid-column: 1 / -1; }
  .build { grid-column: 1 / -1; }
}
</style>
