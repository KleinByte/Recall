import type { ParticipantRow } from "../types/stats"

export interface MatchupStat {
  key: string
  label: string
  of: (row: ParticipantRow) => number
  /** Fewer is the better game, so the lower value is the one highlighted. */
  lower?: boolean
  /** Neither direction is an achievement, so nobody is highlighted. */
  neutral?: boolean
}

const creepScore = (row: ParticipantRow) =>
  row.totalMinionsKilled + row.neutralMinions

export const MATCHUP_STATS: MatchupStat[] = [
  { key: "kills", label: "Kills", of: (row) => row.kills },
  { key: "deaths", label: "Deaths", of: (row) => row.deaths, lower: true },
  { key: "assists", label: "Assists", of: (row) => row.assists },
  { key: "champLevel", label: "Level", of: (row) => row.champLevel },
  { key: "cs", label: "Creep score", of: creepScore },
  { key: "goldEarned", label: "Gold earned", of: (row) => row.goldEarned },
  { key: "damage", label: "Damage to champions", of: (row) => row.damageToChampions },
  { key: "physical", label: "Physical damage", of: (row) => row.physicalDamageToChampions },
  { key: "magic", label: "Magic damage", of: (row) => row.magicDamageToChampions },
  { key: "true", label: "True damage", of: (row) => row.trueDamageToChampions },
  { key: "damageTaken", label: "Damage taken", of: (row) => row.damageTaken, neutral: true },
  { key: "mitigated", label: "Damage mitigated", of: (row) => row.damageSelfMitigated },
  { key: "heal", label: "Healing done", of: (row) => row.totalHeal },
  { key: "healedOthers", label: "Allies healed", of: (row) => row.totalUnitsHealed },
  { key: "cc", label: "Crowd control time", of: (row) => row.timeCcingOthers },
  { key: "vision", label: "Vision score", of: (row) => row.visionScore },
  { key: "wardsPlaced", label: "Wards placed", of: (row) => row.wardsPlaced },
  { key: "wardsKilled", label: "Wards destroyed", of: (row) => row.wardsKilled },
  { key: "controlWards", label: "Control wards", of: (row) => row.controlWards },
  { key: "objectives", label: "Damage to objectives", of: (row) => row.damageObjectives },
  { key: "turretDamage", label: "Damage to turrets", of: (row) => row.damageTurrets },
  { key: "turretKills", label: "Turrets taken", of: (row) => row.turretKills },
  { key: "spree", label: "Longest killing spree", of: (row) => row.largestKillingSpree },
  { key: "multiKill", label: "Largest multi kill", of: (row) => row.largestMultiKill },
]

export interface MatchupComparison {
  key: string
  label: string
  left: number
  right: number
  /** Share of the pair's larger value, for a bar that reads at a glance. */
  leftShare: number
  rightShare: number
  leads: "left" | "right" | "none"
}

/**
 * Puts two players' lines side by side.
 *
 * A missing player, which happens when one team is short or a position could
 * not be paired, still produces every row so the two lists stay aligned.
 */
export function compareMatchup(
  left: ParticipantRow | undefined,
  right: ParticipantRow | undefined,
  stats: MatchupStat[] = MATCHUP_STATS,
): MatchupComparison[] {
  return stats.map((stat) => {
    const leftValue = left ? stat.of(left) : 0
    const rightValue = right ? stat.of(right) : 0
    const peak = Math.max(leftValue, rightValue)

    return {
      key: stat.key,
      label: stat.label,
      left: leftValue,
      right: rightValue,
      leftShare: peak === 0 ? 0 : leftValue / peak,
      rightShare: peak === 0 ? 0 : rightValue / peak,
      leads: leaderOf(stat, left, right, leftValue, rightValue),
    }
  })
}

function leaderOf(
  stat: MatchupStat,
  left: ParticipantRow | undefined,
  right: ParticipantRow | undefined,
  leftValue: number,
  rightValue: number,
): MatchupComparison["leads"] {
  if (stat.neutral || !left || !right || leftValue === rightValue) return "none"
  const leftWins = stat.lower ? leftValue < rightValue : leftValue > rightValue
  return leftWins ? "left" : "right"
}
