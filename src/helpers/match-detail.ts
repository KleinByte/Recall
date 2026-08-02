import type {
  MatchDetail,
  ParticipantRow,
  TeamRow,
} from "../types/stats"

export interface MatchSide {
  teamId: number
  players: ParticipantRow[]
  won: boolean
  team?: TeamRow
}

export type ExpandedByTeam = Record<number, number>

export interface LobbyStanding {
  place: number
  of: number
}

/**
 * Places every player in the lobby by Recall grade score, where 1 is the MVP
 * and the last place is the worst game of the ten. An ungraded lobby has no
 * standings at all rather than a partial order that would flatter whoever
 * happens to be graded.
 */
export function lobbyStandings(
  participants: ParticipantRow[],
): Map<number, LobbyStanding> {
  const standings = new Map<number, LobbyStanding>()
  if (participants.length < 2) return standings
  if (participants.some((row) => typeof row.gradeScore !== "number")) return standings

  const ordered = [...participants].sort((left, right) =>
    (right.gradeScore ?? 0) - (left.gradeScore ?? 0)
    || left.participantId - right.participantId,
  )

  ordered.forEach((row, index) => {
    standings.set(row.participantId, { place: index + 1, of: ordered.length })
  })

  return standings
}

export function groupMatchSides(detail: MatchDetail): MatchSide[] {
  const teams = new Map<number, ParticipantRow[]>()

  for (const row of detail.participants) {
    teams.set(row.teamId, [...(teams.get(row.teamId) ?? []), row])
  }

  const localTeamId = detail.participants.find(
    (row) => row.isPlayer === 1,
  )?.teamId

  return [...teams.entries()]
    .sort(([a], [b]) =>
      a === localTeamId ? -1 : b === localTeamId ? 1 : a - b,
    )
    .map(([teamId, players]) => ({
      teamId,
      players,
      won: players[0]?.win === 1,
      team: detail.teams.find((entry) => entry.teamId === teamId),
    }))
}

export interface TeamTotals {
  kills: number
  deaths: number
  assists: number
  gold: number
  damage: number
  cs: number
  vision: number
}

export function teamTotals(players: ParticipantRow[]): TeamTotals {
  return players.reduce<TeamTotals>((totals, row) => ({
    kills: totals.kills + row.kills,
    deaths: totals.deaths + row.deaths,
    assists: totals.assists + row.assists,
    gold: totals.gold + row.goldEarned,
    damage: totals.damage + row.damageToChampions,
    cs: totals.cs + row.totalMinionsKilled + row.neutralMinions,
    vision: totals.vision + row.visionScore,
  }), { kills: 0, deaths: 0, assists: 0, gold: 0, damage: 0, cs: 0, vision: 0 })
}

export interface TeamComparisonRow {
  key: keyof TeamTotals
  label: string
  left: number
  right: number
  /** The left team's slice of the pair, used to size the mirrored bars. */
  leftShare: number
  compact: boolean
}

const COMPARISONS: { key: keyof TeamTotals; label: string; compact: boolean }[] = [
  { key: "kills", label: "Kills", compact: false },
  { key: "gold", label: "Gold", compact: true },
  { key: "damage", label: "Damage", compact: true },
  { key: "cs", label: "Creep score", compact: false },
  { key: "vision", label: "Vision", compact: false },
]

/** Head-to-head team totals, with an even split when neither side scored. */
export function teamComparison(
  left: TeamTotals,
  right: TeamTotals,
): TeamComparisonRow[] {
  return COMPARISONS.map(({ key, label, compact }) => {
    const total = left[key] + right[key]
    return {
      key,
      label,
      compact,
      left: left[key],
      right: right[key],
      leftShare: total > 0 ? left[key] / total : 0.5,
    }
  })
}

/** Share of the team's kills a player took part in, capped at a full share. */
export const killParticipation = (row: ParticipantRow, teamKills: number) =>
  teamKills > 0 ? Math.min(1, (row.kills + row.assists) / teamKills) : 0

export function toggleExpandedParticipant(
  state: ExpandedByTeam,
  teamId: number,
  participantId: number,
): ExpandedByTeam {
  if (state[teamId] === participantId) {
    const next = { ...state }
    delete next[teamId]
    return next
  }

  return { ...state, [teamId]: participantId }
}

export const formatStat = (value: number) => value.toLocaleString()

export function formatStatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}:${rest.toString().padStart(2, "0")}`
}

export const formatMilestone = (value: number) => value === 1 ? "Yes" : "No"

export const formatOptionalText = (value?: string) => value || "—"
