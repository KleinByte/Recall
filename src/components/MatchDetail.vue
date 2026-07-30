<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import { faChevronDown } from "@fortawesome/free-solid-svg-icons"
import GradeBadge from "./GradeBadge.vue"
import { championIconUrl, championNameById, formatCompact } from "../helpers/format"
import { itemIconUrl, summonerSpellIconUrl } from "../helpers/ddragon"
import {
  formatMilestone,
  formatOptionalText,
  formatStat,
  formatStatDuration,
  groupMatchSides,
  toggleExpandedParticipant,
  type ExpandedByTeam,
} from "../helpers/match-detail"
import type { Champion } from "../types/lol"
import type { MatchDetail, ParticipantRow, TeamRow } from "../types/stats"

const props = defineProps<{
  detail: MatchDetail | null
  loading: boolean
  champions: Champion[] | null
}>()

const sides = computed(() => props.detail ? groupMatchSides(props.detail) : [])

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
      No scoreboard was recorded for this game. Add a Riot API key in Settings
      to import full Match-V5 scoreboards where Riot still exposes them; local
      client-only games may keep just your own line.
    </p>

    <div v-else class="sides">
      <section v-for="side in sides" :key="side.teamId" class="side">
        <header class="side-head">
          <span class="outcome" :class="side.won ? 'win' : 'loss'">
            {{ side.won ? "Victory" : "Defeat" }}
          </span>

          <span v-if="side.team" class="muted objectives">
            <span v-if="side.team.towerKills">{{ side.team.towerKills }} towers</span>
            <span v-if="side.team.dragonKills">{{ side.team.dragonKills }} dragons</span>
            <span v-if="side.team.baronKills">{{ side.team.baronKills }} barons</span>
            <span v-if="side.team.heraldKills">{{ side.team.heraldKills }} heralds</span>
            <span v-if="side.team.hordeKills">{{ side.team.hordeKills }} grubs</span>
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

        <ul class="players">
          <template v-for="row in side.players" :key="row.participantId">
          <li class="player" :class="{ me: row.isPlayer === 1 }">
            <div class="who">
              <img
                :src="championIconUrl(row.championId)"
                :alt="championName(row.championId)"
                :title="championName(row.championId)"
                class="portrait"
              />
              <span class="level">{{ row.champLevel }}</span>

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
            </div>

            <span class="numeric kda">{{ kdaOf(row) }}</span>

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

            <section class="stat-group">
              <h4>Setup</h4>
              <dl class="stat-grid">
                <div><dt>Lane</dt><dd>{{ formatOptionalText(row.lane) }}</dd></div>
                <div><dt>Role</dt><dd>{{ formatOptionalText(row.role) }}</dd></div>
                <div><dt>Primary rune style</dt><dd>{{ formatStat(row.perkPrimaryStyle) }}</dd></div>
                <div><dt>Secondary rune style</dt><dd>{{ formatStat(row.perkSubStyle) }}</dd></div>
                <div class="runes"><dt>Runes</dt><dd>{{ row.perks.length ? row.perks.join(" · ") : "—" }}</dd></div>
              </dl>
            </section>
          </li>
          </template>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.detail {
  padding: var(--space-3) var(--space-4) var(--space-4);
  background: var(--surface-1);
  border-top: 1px solid var(--border-subtle);
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

.objectives {
  display: flex;
  gap: var(--space-3);
  font-size: 11px;
}

.bans {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-left: auto;
}

.ban-label {
  font-size: 10px;
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
  grid-template-columns: minmax(150px, 1.4fr) 66px 36px 62px minmax(90px, 1fr) auto 28px;
  align-items: center;
  gap: var(--space-3);
  padding: 3px var(--space-2);
  border-radius: var(--radius-sm);
  font-size: 12px;
}

.players .me {
  background: var(--surface-3);
}

.who {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  position: relative;
}

.portrait {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

.level {
  position: absolute;
  left: 16px;
  top: 14px;
  background: var(--surface-0);
  border-radius: 50%;
  font-size: 9px;
  line-height: 1;
  padding: 2px 3px;
  color: var(--text-secondary);
}

.spells {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-left: var(--space-2);
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
  text-align: right;
  color: var(--text-primary);
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
  display: flex;
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
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: var(--space-2);
  padding: var(--space-2);
  margin-bottom: var(--space-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-0);
  overflow: hidden;
}

.advanced.me {
  border-color: var(--border-strong);
}

.stat-group {
  min-width: 0;
  padding: var(--space-2);
  background: var(--surface-2);
  border-radius: var(--radius-sm);
}

.stat-group h4 {
  margin: 0 0 var(--space-2);
  font-family: var(--font-heading);
  font-size: 10px;
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
  font-size: 10px;
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

.stat-grid .runes dd {
  overflow-wrap: anywhere;
  text-align: left;
}

@media (max-width: 850px) {
  .player {
    grid-template-columns: minmax(130px, 1fr) 60px 36px 54px minmax(75px, 1fr) 28px;
  }

  .items {
    display: none;
  }
}
</style>
