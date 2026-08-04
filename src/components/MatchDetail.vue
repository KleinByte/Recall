<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import {
  faBug,
  faChessRook,
  faChevronDown,
  faCrown,
  faDragon,
  faFlag,
} from "@fortawesome/free-solid-svg-icons"
import GradeBadge from "./GradeBadge.vue"
import RunePage from "./RunePage.vue"
import {
  championIconUrl,
  championNameById,
  formatCompact,
  formatPercent,
} from "../helpers/format"
import { itemIconUrl, summonerSpellIconUrl } from "../helpers/ddragon"
import { positionIconUrl, positionLabel, resolvePosition } from "../helpers/roles"
import {
  formatMilestone,
  formatStat,
  formatStatDuration,
  groupMatchSides,
  killParticipation,
  lobbyStandings,
  teamComparison,
  teamTotals,
  toggleExpandedParticipant,
  type ExpandedByTeam,
  type TeamComparisonRow,
} from "../helpers/match-detail"
import type { Champion } from "../types/lol"
import type { MatchDetail, ParticipantRow, TeamRow } from "../types/stats"

const props = defineProps<{
  detail: MatchDetail | null
  loading: boolean
  champions: Champion[] | null
  classic?: boolean
}>()

const sides = computed(() => props.detail ? groupMatchSides(props.detail) : [])

/** Lobby places by Recall grade: 1 is the MVP, and 0 means the lobby is ungraded. */
const standings = computed(() => lobbyStandings(props.detail?.participants ?? []))

const placeOf = (row: ParticipantRow) =>
  standings.value.get(row.participantId)?.place ?? 0

const positionOf = (row: ParticipantRow) =>
  resolvePosition(row.lane, row.role, row.assignedPosition)

const placeTitle = (row: ParticipantRow) => {
  const standing = standings.value.get(row.participantId)
  if (!standing) return ""
  return standing.place === 1
    ? `Best Recall grade of the ${standing.of} players in this lobby`
    : `Recall grade place ${standing.place} of ${standing.of} in this lobby`
}

const totalsByTeam = computed(() =>
  new Map(sides.value.map((side) => [side.teamId, teamTotals(side.players)])))

const killShare = (row: ParticipantRow) =>
  killParticipation(row, totalsByTeam.value.get(row.teamId)?.kills ?? 0)

/** Head-to-head totals, with the player's team on the left. */
const comparison = computed(() => {
  const totals = sides.value.map((side) => totalsByTeam.value.get(side.teamId))
  if (totals.length !== 2 || !totals[0] || !totals[1]) return []
  return teamComparison(totals[0], totals[1])
})

const comparisonValue = (row: TeamComparisonRow, value: number) =>
  row.compact ? formatCompact(value) : formatStat(value)

const sideName = (teamId: number) => teamId === 100 ? "Blue side" : "Red side"

/** The biggest damage figure on the board, so the bars stay comparable. */
const topDamage = computed(() =>
  Math.max(
    1,
    ...(props.detail?.participants ?? []).map((row) => row.damageToChampions),
  ),
)

const expanded = ref<ExpandedByTeam>({})

watch(() => props.detail, () => {
  expanded.value = {}
})

const isExpanded = (row: ParticipantRow) =>
  expanded.value[row.teamId] === row.participantId

function toggleExpanded(row: ParticipantRow) {
  expanded.value = toggleExpandedParticipant(
    expanded.value,
    row.teamId,
    row.participantId,
  )
}

const championName = (id: number) => championNameById(props.champions, id)

const bansOf = (team?: TeamRow): number[] => {
  if (!team?.bans) return []
  try {
    return (JSON.parse(team.bans) as number[]).filter((id) => id > 0)
  } catch {
    return []
  }
}

const kdaOf = (row: ParticipantRow) =>
  `${row.kills}/${row.deaths}/${row.assists}`
</script>

<template>
  <div class="detail">
    <p v-if="loading" class="muted note">Reading the scoreboard…</p>

    <p v-else-if="!sides.length" class="muted note">
      No scoreboard was recorded for this game. Recent scoreboards come from
      the League client automatically. If this match predates its local window,
      the optional Settings history import may recover the Match-V5 scoreboard.
    </p>

    <div v-else class="sides">
      <section v-for="side in sides" :key="side.teamId" class="side">
        <header class="side-head">
          <span class="outcome" :class="side.won ? 'win' : 'loss'">
            {{ side.won ? "Victory" : "Defeat" }}
          </span>

          <span class="numeric side-totals">
            {{ totalsByTeam.get(side.teamId)?.kills ?? 0 }}
            <span class="muted">kills</span>
            <span class="muted separator">·</span>
            {{ formatCompact(totalsByTeam.get(side.teamId)?.gold ?? 0) }}
            <span class="muted">gold</span>
          </span>

          <span v-if="side.team" class="objectives">
            <span v-if="side.team.towerKills" class="objective" title="Towers">
              <FontAwesomeIcon :icon="faChessRook" aria-hidden="true" />
              <span class="numeric">{{ side.team.towerKills }}</span>
            </span>
            <span v-if="side.team.dragonKills" class="objective" title="Dragons">
              <FontAwesomeIcon :icon="faDragon" aria-hidden="true" />
              <span class="numeric">{{ side.team.dragonKills }}</span>
            </span>
            <span v-if="side.team.baronKills" class="objective" title="Barons">
              <FontAwesomeIcon :icon="faCrown" aria-hidden="true" />
              <span class="numeric">{{ side.team.baronKills }}</span>
            </span>
            <span v-if="side.team.heraldKills" class="objective" title="Rift heralds">
              <FontAwesomeIcon :icon="faFlag" aria-hidden="true" />
              <span class="numeric">{{ side.team.heraldKills }}</span>
            </span>
            <span v-if="side.team.hordeKills" class="objective" title="Void grubs">
              <FontAwesomeIcon :icon="faBug" aria-hidden="true" />
              <span class="numeric">{{ side.team.hordeKills }}</span>
            </span>
          </span>

          <span v-if="bansOf(side.team).length" class="bans">
            <span class="muted ban-label">Bans</span>
            <img
              v-for="ban in bansOf(side.team)"
              :key="ban"
              :src="championIconUrl(ban)"
              :alt="championName(ban)"
              :title="championName(ban)"
              class="ban"
            />
          </span>
        </header>

        <div class="columns muted" aria-hidden="true">
          <span>Player</span>
          <span class="to-center">KDA</span>
          <span class="to-center">KP</span>
          <span class="to-center">Grade</span>
          <span class="to-center">CS</span>
          <span class="to-center">Damage</span>
          <span class="to-center col-items">Items</span>
          <span />
        </div>

        <ul class="players">
          <template v-for="row in side.players" :key="row.participantId">
          <li class="player" :class="{ me: row.isPlayer === 1 }">
            <div class="who">
              <img
                v-if="positionOf(row)"
                :src="positionIconUrl(positionOf(row))"
                class="position"
                :title="positionLabel(positionOf(row))"
                alt=""
              />
              <span v-else class="position" />

              <span class="avatar">
                <img
                  :src="championIconUrl(row.championId)"
                  :alt="championName(row.championId)"
                  :title="championName(row.championId)"
                  class="portrait"
                />
                <span class="level">{{ row.champLevel }}</span>
                <span
                  v-if="placeOf(row)"
                  class="place numeric"
                  :class="{ mvp: placeOf(row) === 1 }"
                  :title="placeTitle(row)"
                >
                  {{ placeOf(row) }}
                </span>
              </span>

              <span class="spells">
                <img
                  v-for="spell in [row.spell1Id, row.spell2Id]"
                  :key="spell"
                  :src="summonerSpellIconUrl(spell)"
                  class="spell"
                  alt=""
                />
              </span>

              <span class="name" :title="row.summonerName ?? ''">
                {{ row.summonerName ?? championName(row.championId) }}
              </span>

              <span v-if="placeOf(row) === 1" class="mvp-tag" :title="placeTitle(row)">MVP</span>
            </div>

            <span class="numeric kda">{{ kdaOf(row) }}</span>

            <span class="numeric kp" title="Kill participation">
              {{ formatPercent(killShare(row)) }}
            </span>

            <GradeBadge :grade="row.grade" />

            <span class="numeric cs">
              {{ row.totalMinionsKilled + row.neutralMinions }} CS
            </span>

            <span class="damage">
              <span class="bar">
                <span
                  class="bar-fill"
                  :style="{ width: `${(row.damageToChampions / topDamage) * 100}%` }"
                />
              </span>
              <span class="numeric damage-value">
                {{ formatCompact(row.damageToChampions) }}
              </span>
            </span>

            <span class="items">
              <template v-for="(item, index) in row.items" :key="index">
                <img
                  v-if="itemIconUrl(item)"
                  :src="itemIconUrl(item)"
                  class="item"
                  alt=""
                />
                <span v-else class="item empty" />
              </template>
            </span>

            <button
              class="expand"
              :aria-expanded="isExpanded(row)"
              :aria-label="`${isExpanded(row) ? 'Hide' : 'Show'} statistics for ${row.summonerName ?? championName(row.championId)}`"
              @click="toggleExpanded(row)"
            >
              <FontAwesomeIcon
                :icon="faChevronDown"
                :class="{ open: isExpanded(row) }"
              />
            </button>
          </li>

          <li
            v-if="isExpanded(row)"
            class="advanced"
            :class="{ me: row.isPlayer === 1 }"
          >
            <section class="stat-group">
              <h4>Combat</h4>
              <dl class="stat-grid">
                <div><dt>Champion damage</dt><dd>{{ formatStat(row.damageToChampions) }}</dd></div>
                <div><dt>Magic damage</dt><dd>{{ formatStat(row.magicDamageToChampions) }}</dd></div>
                <div><dt>Physical damage</dt><dd>{{ formatStat(row.physicalDamageToChampions) }}</dd></div>
                <div><dt>True damage</dt><dd>{{ formatStat(row.trueDamageToChampions) }}</dd></div>
                <div><dt>Total damage</dt><dd>{{ formatStat(row.totalDamageDealt) }}</dd></div>
                <div><dt>Damage taken</dt><dd>{{ formatStat(row.damageTaken) }}</dd></div>
                <div><dt>Damage mitigated</dt><dd>{{ formatStat(row.damageSelfMitigated) }}</dd></div>
                <div><dt>Healing</dt><dd>{{ formatStat(row.totalHeal) }}</dd></div>
                <div><dt>Units healed</dt><dd>{{ formatStat(row.totalUnitsHealed) }}</dd></div>
                <div><dt>CC time</dt><dd>{{ formatStatDuration(row.timeCcingOthers) }}</dd></div>
              </dl>
            </section>

            <section class="stat-group">
              <h4>Economy &amp; farming</h4>
              <dl class="stat-grid">
                <div><dt>Gold earned</dt><dd>{{ formatStat(row.goldEarned) }}</dd></div>
                <div><dt>Gold spent</dt><dd>{{ formatStat(row.goldSpent) }}</dd></div>
                <div><dt>Lane CS</dt><dd>{{ formatStat(row.totalMinionsKilled) }}</dd></div>
                <div><dt>Neutral CS</dt><dd>{{ formatStat(row.neutralMinions) }}</dd></div>
                <div><dt>Total CS</dt><dd>{{ formatStat(row.totalMinionsKilled + row.neutralMinions) }}</dd></div>
              </dl>
            </section>

            <section class="stat-group">
              <h4>Vision</h4>
              <dl class="stat-grid">
                <div><dt>Vision score</dt><dd>{{ formatStat(row.visionScore) }}</dd></div>
                <div><dt>Wards placed</dt><dd>{{ formatStat(row.wardsPlaced) }}</dd></div>
                <div><dt>Wards killed</dt><dd>{{ formatStat(row.wardsKilled) }}</dd></div>
                <div><dt>Control wards</dt><dd>{{ formatStat(row.controlWards) }}</dd></div>
              </dl>
            </section>

            <section class="stat-group">
              <h4>Objectives</h4>
              <dl class="stat-grid">
                <div><dt>Objective damage</dt><dd>{{ formatStat(row.damageObjectives) }}</dd></div>
                <div><dt>Turret damage</dt><dd>{{ formatStat(row.damageTurrets) }}</dd></div>
                <div><dt>Turret kills</dt><dd>{{ formatStat(row.turretKills) }}</dd></div>
                <div><dt>Inhibitor kills</dt><dd>{{ formatStat(row.inhibitorKills) }}</dd></div>
                <div><dt>First blood</dt><dd :class="{ positive: row.firstBlood === 1 }">{{ formatMilestone(row.firstBlood) }}</dd></div>
                <div><dt>First tower</dt><dd :class="{ positive: row.firstTower === 1 }">{{ formatMilestone(row.firstTower) }}</dd></div>
              </dl>
            </section>

            <section class="stat-group">
              <h4>Multikills &amp; survival</h4>
              <dl class="stat-grid">
                <div><dt>Largest spree</dt><dd>{{ formatStat(row.largestKillingSpree) }}</dd></div>
                <div><dt>Largest multikill</dt><dd>{{ formatStat(row.largestMultiKill) }}</dd></div>
                <div><dt>Double kills</dt><dd>{{ formatStat(row.doubleKills) }}</dd></div>
                <div><dt>Triple kills</dt><dd>{{ formatStat(row.tripleKills) }}</dd></div>
                <div><dt>Quadra kills</dt><dd>{{ formatStat(row.quadraKills) }}</dd></div>
                <div><dt>Pentakills</dt><dd>{{ formatStat(row.pentaKills) }}</dd></div>
                <div><dt>Longest life</dt><dd>{{ formatStatDuration(row.longestTimeLiving) }}</dd></div>
                <div><dt>Champion level</dt><dd>{{ formatStat(row.champLevel) }}</dd></div>
              </dl>
            </section>

            <section class="stat-group setup-group">
              <h4>Player setup</h4>
              <div class="setup-overview">
                <span class="setup-role">
                  <img v-if="positionOf(row)" :src="positionIconUrl(positionOf(row))" alt="" />
                  <span><small>Position</small><strong>{{ positionOf(row) ? positionLabel(positionOf(row)) : "Unassigned" }}</strong></span>
                </span>
                <span class="setup-spells">
                  <template v-for="spell in [row.spell1Id, row.spell2Id]" :key="spell">
                    <img v-if="summonerSpellIconUrl(spell)" :src="summonerSpellIconUrl(spell)" alt="" />
                  </template>
                  <span><small>Summoner spells</small><strong>Selected loadout</strong></span>
                </span>
                <RunePage :participant="row" :classic="classic" :align="row.teamId === 200 ? 'right' : 'left'" />
              </div>
            </section>
          </li>
          </template>
        </ul>
      </section>

      <section v-if="comparison.length" class="team-stats">
        <header class="stats-head">
          <span class="stats-side" :class="sides[0].won ? 'win' : 'loss'">
            {{ sideName(sides[0].teamId) }}
          </span>
          <h4 class="stats-title">Team totals</h4>
          <span class="stats-side to-right" :class="sides[1].won ? 'win' : 'loss'">
            {{ sideName(sides[1].teamId) }}
          </span>
        </header>

        <ul class="compare-rows">
          <li v-for="row in comparison" :key="row.key" class="compare">
            <span class="numeric compare-value" :class="{ ahead: row.left >= row.right }">
              {{ comparisonValue(row, row.left) }}
            </span>
            <span class="meter to-right">
              <span class="meter-fill mine" :style="{ width: `${row.leftShare * 100}%` }" />
            </span>
            <span class="compare-label">{{ row.label }}</span>
            <span class="meter">
              <span class="meter-fill" :style="{ width: `${(1 - row.leftShare) * 100}%` }" />
            </span>
            <span class="numeric compare-value to-right" :class="{ ahead: row.right > row.left }">
              {{ comparisonValue(row, row.right) }}
            </span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.detail {
  padding: var(--space-3) var(--space-4) var(--space-4);
  background: var(--surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.note {
  font-size: 12px;
  margin: 0;
  line-height: 1.5;
}

.sides {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.side {
  /* One track list keeps the header strip and every player row on the same columns. */
  --score-grid:
    minmax(140px, 1.5fr) 62px 44px 44px 56px minmax(88px, 1fr) 118px 26px;
  --score-gap: var(--space-2);
}

.side-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-2);
}

.outcome {
  font-family: var(--font-heading);
  font-size: 11px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
}

.outcome.win {
  color: var(--win);
}

.outcome.loss {
  color: var(--loss);
}

.side-totals {
  font-size: 12px;
  color: var(--text-primary);
}

.side-totals .muted {
  font-family: var(--font-body);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.side-totals .separator {
  margin: 0 var(--space-1);
}

.objectives {
  display: flex;
  gap: var(--space-1);
}

.objective {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-secondary);
  font-size: 12px;
}

.objective .numeric {
  color: var(--text-primary);
}

.bans {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-left: auto;
}

.ban-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-right: var(--space-1);
}

.ban {
  width: 16px;
  height: 16px;
  border-radius: var(--radius-sm);
  filter: grayscale(0.7);
}

.players {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.player {
  display: grid;
  grid-template-columns: var(--score-grid);
  align-items: center;
  gap: var(--score-gap);
  padding: 3px var(--space-2);
  border-radius: var(--radius-sm);
  font-size: 12px;
}

.columns {
  display: grid;
  grid-template-columns: var(--score-grid);
  gap: var(--score-gap);
  padding: 0 var(--space-2) var(--space-1);
  margin-bottom: var(--space-1);
  border-bottom: 1px solid var(--border-subtle);
  font-size: 11px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
}

.to-right { text-align: right; }
.to-center { text-align: center; }

.players .me {
  background: var(--surface-3);
}

.who {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

.position {
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
  font-size: 11px;
  text-align: center;
  color: var(--text-muted);
}

.avatar {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  flex: 0 0 auto;
}

.portrait {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

.level {
  position: absolute;
  right: -4px;
  top: 12px;
  background: var(--surface-0);
  border-radius: 50%;
  font-size: 11px;
  line-height: 1;
  padding: 2px 3px;
  color: var(--text-secondary);
}

.place {
  min-width: 18px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  background: var(--surface-0);
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.4;
  text-align: center;
}

.place.mvp {
  border-color: var(--gold);
  background: rgba(200, 170, 109, 0.16);
  color: var(--gold-bright);
}

.mvp-tag {
  flex: 0 0 auto;
  margin-left: var(--space-1);
  padding: 0 5px;
  border: 1px solid var(--gold);
  border-radius: 999px;
  background: rgba(200, 170, 109, 0.14);
  color: var(--gold-bright);
  font-family: var(--font-heading);
  font-size: 11px;
  letter-spacing: 1px;
}

.spells {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-left: var(--space-1);
  align-self: flex-start;
}

.spell {
  width: 11px;
  height: 11px;
  border-radius: 1px;
}

.name {
  margin-left: var(--space-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}

.me .name {
  color: var(--gold);
}

.kda,
.cs {
  text-align: center;
  color: var(--text-primary);
}

.kp {
  text-align: center;
  color: var(--text-secondary);
  font-size: 11px;
}

.cs {
  color: var(--text-secondary);
  font-size: 11px;
}

.damage {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.bar {
  flex: 1;
  height: 5px;
  background: var(--surface-3);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.bar-fill {
  display: block;
  height: 100%;
  background: var(--loss);
}

.me .bar-fill {
  background: var(--gold);
}

.damage-value {
  font-size: 11px;
  color: var(--text-secondary);
  min-width: 34px;
  text-align: right;
}

.items {
  display: grid;
  grid-template-columns: repeat(6, 18px);
  gap: 2px;
}

.item {
  width: 18px;
  height: 18px;
  border-radius: var(--radius-sm);
  background: var(--surface-3);
}

.item.empty {
  border: 1px solid var(--border-subtle);
  opacity: 0.4;
}

.expand {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
}
.expand:hover,
.expand:focus-visible {
  color: var(--gold);
  border-color: var(--border-strong);
  outline: none;
}

.expand svg {
  transition: transform 0.14s ease;
}

.expand .open {
  transform: rotate(180deg);
}

.advanced {
  display: grid;
  grid-template-columns: 1.25fr .9fr .78fr 1fr 1fr;
  gap: 0;
  padding: 8px 10px 10px;
  margin-bottom: var(--space-1);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: linear-gradient(100deg, color-mix(in srgb, var(--surface-1) 90%, #102d46), var(--surface-0));
  overflow: hidden;
}

.advanced.me {
  border-color: var(--border-strong);
}

.stat-group {
  min-width: 0;
  padding: 4px 12px 7px;
  border-left: 1px solid var(--border-subtle);
  background: transparent;
}

.stat-group:first-of-type { border-left: 0; }

.stat-group h4 {
  margin: 0 0 var(--space-2);
  font-family: var(--font-heading);
  font-size: 12px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--gold);
}

.stat-grid {
  display: grid;
  gap: 4px;
  margin: 0;
}

.stat-grid div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-items: baseline;
}

.stat-grid dt {
  color: var(--text-secondary);
  font-size: 12px;
}

.stat-grid dd {
  margin: 0;
  color: var(--text-primary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.stat-grid dd.positive {
  color: var(--win);
}

.stat-grid .runes {
  grid-template-columns: 1fr;
}

.setup-group {
  grid-column: 1 / -1;
  margin-top: 7px;
  padding-top: 8px;
  border-top: 1px solid var(--border-strong);
  border-left: 0;
  background: transparent;
}

.setup-overview {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.setup-role,
.setup-spells {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 120px;
}

.setup-role > img {
  width: 26px;
  height: 26px;
}

.setup-spells > img {
  width: 24px;
  height: 24px;
  border-radius: 3px;
}

.setup-role > span,
.setup-spells > span {
  display: flex;
  flex-direction: column;
}

.setup-role small,
.setup-spells small {
  color: var(--text-muted);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .6px;
}

.setup-role strong,
.setup-spells strong {
  color: var(--text-secondary);
  font-size: 12px;
}

.team-stats {
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-0);
}

.stats-head {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: var(--space-3);
  padding-bottom: var(--space-2);
  margin-bottom: var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}

.stats-side {
  font-family: var(--font-heading);
  font-size: 12px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
}

.stats-side.win { color: var(--win); }
.stats-side.loss { color: var(--loss); }

.stats-title {
  margin: 0;
  font-family: var(--font-heading);
  font-size: 12px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--gold);
  text-align: center;
}

.compare-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.compare {
  display: grid;
  grid-template-columns: 60px minmax(0, 1fr) 104px minmax(0, 1fr) 60px;
  align-items: center;
  gap: var(--space-3);
  font-size: 11px;
}

.compare-value {
  color: var(--text-secondary);
  font-size: 12px;
}

.compare-value.ahead {
  color: var(--text-primary);
}

.compare-label {
  text-align: center;
  font-size: 11px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: var(--text-muted);
}

.meter {
  display: flex;
  height: 8px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}

.meter.to-right {
  justify-content: flex-end;
}

.meter-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--loss);
}

.meter-fill.mine {
  background: var(--gold);
}

.stat-grid .runes dd {
  overflow-wrap: anywhere;
  text-align: left;
}

@media (max-width: 850px) {
  .side {
    --score-grid: minmax(130px, 1.5fr) 62px 44px 44px 56px minmax(80px, 1fr) 26px;
  }

  .items,
  .col-items {
    display: none;
  }
}
</style>
