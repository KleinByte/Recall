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
