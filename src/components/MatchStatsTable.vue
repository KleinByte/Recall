<script setup lang="ts">
import { computed } from "vue"
import { championIconUrl, championNameById, formatCompact } from "../helpers/format"
import { POSITIONS, positionForPlayer } from "../helpers/roles"
import type { Champion } from "../types/lol"
import type { ParticipantRow } from "../types/stats"

type StatValue = number | string | undefined
interface StatRow {
  key: string
  label: string
  value: (row: ParticipantRow) => StatValue
  best?: "higher" | "lower"
  compact?: boolean
  duration?: boolean
}

const props = defineProps<{
  participants: ParticipantRow[]
  champions: Champion[] | null
}>()

const extended = (row: ParticipantRow, key: string) => {
  const value = row.extendedMetrics?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

const challenge = (row: ParticipantRow, key: string) =>
  extended(row, `challenge.${key}`)

const GROUPS: { label: string; rows: StatRow[] }[] = [
  {
    label: "Combat",
    rows: [
      { key: "kda", label: "KDA", value: (row) => `${row.kills}/${row.deaths}/${row.assists}` },
      { key: "spree", label: "Largest killing spree", value: (row) => row.largestKillingSpree, best: "higher" },
      { key: "multi", label: "Largest multi kill", value: (row) => row.largestMultiKill, best: "higher" },
      { key: "cc", label: "Crowd control score", value: (row) => row.timeCcingOthers, best: "higher" },
      { key: "crit", label: "Largest critical strike", value: (row) => challenge(row, "largestCriticalStrike"), best: "higher", compact: true },
      { key: "time-dead", label: "Time spent dead", value: (row) => extended(row, "totalTimeSpentDead"), best: "lower", duration: true },
    ],
  },
  {
    label: "Damage dealt",
    rows: [
      { key: "champ-damage", label: "Total damage to champions", value: (row) => row.damageToChampions, best: "higher", compact: true },
      { key: "physical-champ", label: "Physical damage to champions", value: (row) => row.physicalDamageToChampions, best: "higher", compact: true },
      { key: "magic-champ", label: "Magic damage to champions", value: (row) => row.magicDamageToChampions, best: "higher", compact: true },
      { key: "true-champ", label: "True damage to champions", value: (row) => row.trueDamageToChampions, best: "higher", compact: true },
      { key: "total-damage", label: "Total damage", value: (row) => row.totalDamageDealt, best: "higher", compact: true },
      { key: "objectives", label: "Damage to objectives", value: (row) => row.damageObjectives, best: "higher", compact: true },
      { key: "turret-damage", label: "Damage to turrets", value: (row) => row.damageTurrets, best: "higher", compact: true },
    ],
  },
  {
    label: "Damage taken and healed",
    rows: [
      { key: "damage-taken", label: "Damage taken", value: (row) => row.damageTaken, best: "higher", compact: true },
      { key: "mitigated", label: "Damage self-mitigated", value: (row) => row.damageSelfMitigated, best: "higher", compact: true },
      { key: "healed", label: "Damage healed", value: (row) => row.totalHeal, best: "higher", compact: true },
      { key: "ally-healing", label: "Ally healing", value: (row) => extended(row, "totalHealsOnTeammates"), best: "higher", compact: true },
      { key: "ally-shielding", label: "Ally shielding", value: (row) => extended(row, "totalDamageShieldedOnTeammates"), best: "higher", compact: true },
    ],
  },
  {
    label: "Economy",
    rows: [
      { key: "gold-earned", label: "Gold earned", value: (row) => row.goldEarned, best: "higher", compact: true },
      { key: "gold-spent", label: "Gold spent", value: (row) => row.goldSpent, best: "higher", compact: true },
      { key: "lane-cs", label: "Lane minions", value: (row) => row.totalMinionsKilled, best: "higher" },
      { key: "jungle-cs", label: "Jungle minions", value: (row) => row.neutralMinions, best: "higher" },
      { key: "level", label: "Champion level", value: (row) => row.champLevel, best: "higher" },
    ],
  },
  {
    label: "Vision",
    rows: [
      { key: "vision", label: "Vision score", value: (row) => row.visionScore, best: "higher" },
      { key: "wards-placed", label: "Wards placed", value: (row) => row.wardsPlaced, best: "higher" },
      { key: "wards-killed", label: "Wards killed", value: (row) => row.wardsKilled, best: "higher" },
      { key: "control-wards", label: "Control wards", value: (row) => row.controlWards, best: "higher" },
    ],
  },
  {
    label: "Objectives",
    rows: [
      { key: "turret-kills", label: "Turret kills", value: (row) => row.turretKills, best: "higher" },
      { key: "inhibitor-kills", label: "Inhibitor kills", value: (row) => row.inhibitorKills, best: "higher" },
      { key: "objective-steals", label: "Objectives stolen", value: (row) => extended(row, "objectivesStolen"), best: "higher" },
      { key: "first-blood", label: "First blood", value: (row) => row.firstBlood ? "Yes" : "—" },
      { key: "first-tower", label: "First tower", value: (row) => row.firstTower ? "Yes" : "—" },
    ],
  },
]

const ordered = computed(() => [...props.participants].sort((left, right) => {
  if (left.teamId !== right.teamId) return left.teamId - right.teamId
  const leftPosition = positionForPlayer(left)
  const rightPosition = positionForPlayer(right)
  const leftIndex = leftPosition ? POSITIONS.indexOf(leftPosition) : 99
  const rightIndex = rightPosition ? POSITIONS.indexOf(rightPosition) : 99
  return leftIndex - rightIndex || left.participantId - right.participantId
}))

const firstRedId = computed(() => ordered.value.find((row) => row.teamId === 200)?.participantId)
const isFirstRed = (row: ParticipantRow) => row.participantId === firstRedId.value

const isBest = (definition: StatRow, player: ParticipantRow) => {
  if (!definition.best) return false
  const current = definition.value(player)
  if (typeof current !== "number") return false
  const values = ordered.value.map(definition.value).filter((value): value is number => typeof value === "number")
  if (!values.length) return false
  return current === (definition.best === "higher" ? Math.max(...values) : Math.min(...values))
}

const formatDuration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds) % 60).padStart(2, "0")}`

const formatValue = (definition: StatRow, player: ParticipantRow) => {
  const value = definition.value(player)
  if (value === undefined || value === null) return "—"
  if (typeof value === "string") return value
  if (definition.duration) return formatDuration(value)
  if (definition.compact) return formatCompact(value)
  return value.toLocaleString()
}
</script>

<template>
  <div class="stats-scroll">
    <table class="stats-table">
      <thead>
        <tr>
          <th scope="col">Metric</th>
          <th
            v-for="player in ordered"
            :key="player.participantId"
            scope="col"
            :class="{ owner: player.isPlayer === 1, 'team-split': isFirstRed(player) }"
          >
            <img :src="championIconUrl(player.championId)" :alt="championNameById(champions, player.championId)" />
            <span :title="player.summonerName">{{ player.summonerName || championNameById(champions, player.championId) }}</span>
          </th>
        </tr>
      </thead>

      <tbody v-for="group in GROUPS" :key="group.label">
        <tr class="group-row"><th :colspan="ordered.length + 1">{{ group.label }}</th></tr>
        <tr v-for="definition in group.rows" :key="definition.key">
          <th scope="row">{{ definition.label }}</th>
          <td
            v-for="player in ordered"
            :key="player.participantId"
            :class="{
              owner: player.isPlayer === 1,
              leader: isBest(definition, player),
              'team-split': isFirstRed(player),
            }"
          >
            {{ formatValue(definition, player) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.stats-scroll { overflow: auto; border: 1px solid var(--border-subtle); border-radius: 14px; background: color-mix(in srgb, var(--surface-1) 94%, #0b0f17); }
.stats-table { width: 100%; min-width: 1060px; border-collapse: separate; border-spacing: 0; table-layout: fixed; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
th, td { height: 39px; padding: 6px 4px; border-bottom: 1px solid color-mix(in srgb, var(--border-subtle) 58%, transparent); text-align: center; font-size: 11px; }
thead th { position: sticky; top: 0; z-index: 3; height: 59px; background: #101724; }
thead th:first-child, tbody th[scope="row"] { position: sticky; left: 0; z-index: 2; width: 174px; padding-left: 10px; text-align: left; background: #111824; color: var(--text-secondary); }
thead th:first-child { z-index: 4; color: var(--text-primary); font: 13px var(--font-heading); }
thead th:not(:first-child) { width: 86px; overflow: hidden; }
thead th img { display: block; width: 28px; height: 28px; margin: 0 auto 3px; border: 1px solid var(--border-strong); border-radius: 50%; object-fit: cover; }
thead th span { display: block; overflow: hidden; color: var(--text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.group-row th { height: 33px; padding: 7px 10px; background: rgba(255,255,255,.025); color: var(--text-primary); font: 12px var(--font-heading); text-align: left; }
tbody tr:not(.group-row):hover td, tbody tr:not(.group-row):hover th { background: color-mix(in srgb, var(--surface-3) 52%, #111824); }
td.owner, thead th.owner { color: var(--gold-bright); background: color-mix(in srgb, var(--gold) 8%, #111824); }
td.leader { color: var(--text-primary); font-weight: 700; }
td.owner.leader { color: #ffe36a; }
.team-split { border-left: 2px solid color-mix(in srgb, var(--loss) 50%, var(--border-strong)); }
tbody:last-child tr:last-child > * { border-bottom: 0; }
</style>
