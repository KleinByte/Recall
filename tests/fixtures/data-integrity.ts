export const SYNTHETIC_OWNER_PUUID = "synthetic_owner"

const participant = (participantId: number, teamId: number, overrides: Record<string, unknown> = {}) => ({
  participantId,
  teamId,
  isPlayer: participantId === 1,
  championId: participantId === 1 ? 10 : participantId + 100,
  kills: 1,
  deaths: 1,
  assists: 1,
  damageToChampions: 100,
  damageTaken: 100,
  goldEarned: 1_000,
  ...overrides,
})

const lobby = Array.from({ length: 10 }, (_, index) =>
  participant(index + 1, index < 5 ? 100 : 200),
)

export const DATA_INTEGRITY_MATCHES = {
  normalWin: { gameId: 1, mode: "CLASSIC", queueId: 420, durationSecs: 1_800, participants: lobby },
  zeroLoss: {
    gameId: 2,
    mode: "CLASSIC",
    queueId: 420,
    durationSecs: 1_800,
    participants: lobby.map((row) => row.participantId === 1
      ? { ...row, kills: 0, assists: 0 }
      : row),
  },
  remake: { gameId: 3, mode: "CLASSIC", queueId: 420, durationSecs: 299, participants: lobby },
  earlySurrender: {
    gameId: 4,
    mode: "CLASSIC",
    queueId: 420,
    durationSecs: 900,
    endOfGameResult: "EarlySurrender",
    participants: lobby,
  },
  invalidDuration: { gameId: 5, mode: "CLASSIC", queueId: 420, durationSecs: 0, participants: lobby },
  ninePlayerLobby: { gameId: 6, mode: "CLASSIC", queueId: 420, durationSecs: 1_800, participants: lobby.slice(0, 9) },
  duplicateParticipantLobby: {
    gameId: 7,
    mode: "CLASSIC",
    queueId: 420,
    durationSecs: 1_800,
    participants: [...lobby.slice(0, 9), lobby[0]],
  },
  missingTimeline: { gameId: 8, mode: "ARAM", queueId: 450, durationSecs: 1_200, participants: lobby, timeline: null },
  arenaZilean: {
    gameId: 9,
    mode: "CHERRY",
    queueId: 1750,
    durationSecs: 1_100,
    championId: 26,
    grade: null,
    gradeScore: null,
    participants: lobby.map((row) => row.participantId === 1 ? { ...row, championId: 26 } : row),
  },
} as const
