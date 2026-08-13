import type { ParticipantRow } from "../types/stats"

export interface LobbyStanding {
  place: number
  of: number
}

/**
 * Places every player in the lobby by authoritative Recall, where 1 is the MVP
 * and the last place is the worst game of the ten. An ungraded lobby has no
 * standings at all rather than a partial order that would flatter whoever
 * happens to be graded.
 */
export function lobbyStandings(
  participants: ParticipantRow[],
): Map<number, LobbyStanding> {
  const standings = new Map<number, LobbyStanding>()
  if (participants.length < 2) return standings
  if (participants.some((row) => typeof row.recallScore !== "number")) return standings

  const ordered = [...participants].sort((left, right) =>
    (right.recallScore ?? 0) - (left.recallScore ?? 0)
    || left.participantId - right.participantId,
  )

  ordered.forEach((row, index) => {
    standings.set(row.participantId, { place: index + 1, of: ordered.length })
  })

  return standings
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
