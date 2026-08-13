import type {
  GradeRawLobby,
  GradeRawParticipant,
} from "../../electron/main/matches/match-grade-observations.js"
import type { NormalizedPosition } from "../../electron/main/matches/position.js"

const POSITIONS: readonly NormalizedPosition[] = [
  "TOP",
  "JUNGLE",
  "MIDDLE",
  "BOTTOM",
  "UTILITY",
]

export const CHARACTERIZATION_CONTEXT = Object.freeze({
  modeFamily: "sr" as const,
  trackedMode: "sr_normal",
  ruleset: "standard_sr",
  rulesetKey: "sr_normal:rules-r1",
})

function participant(
  participantId: number,
  matchId: number,
  overrides: Partial<GradeRawParticipant> = {},
): GradeRawParticipant {
  const index = participantId - 1
  return {
    participantId,
    teamId: index < 5 ? 100 : 200,
    isPlayer: participantId === 1,
    championId: 18,
    position: POSITIONS[index % POSITIONS.length],
    kills: 1 + index % 3,
    deaths: index % 4,
    assists: 2 + index % 5,
    damageToChampions: 5_000 + matchId * 20 + index * 500,
    damageTaken: 7_500 + matchId * 10 + index * 250,
    damageSelfMitigated: 2_500 + matchId * 5 + index * 100,
    goldEarned: 7_000 + matchId * 10 + index * 200,
    totalMinionsKilled: 40 + index * 15,
    neutralMinions: index % 3,
    damageObjectives: matchId * 20 + index * 100,
    damageTurrets: matchId * 10 + index * 50,
    damageStructures: matchId * 10 + index * 50,
    visionScore: 5 + index,
    wardsPlaced: 3 + index,
    wardsKilled: index % 3,
    controlWardsPurchased: index % 2,
    detectorWardsPlaced: index % 2,
    totalTimeSpentDead: index * 12,
    timeCcingOthers: index,
    totalHealsOnTeammates: 0,
    totalDamageShieldedOnTeammates: 0,
    ...overrides,
  }
}

function lobby(
  matchId: number,
  ownerOverrides: Partial<GradeRawParticipant> = {},
): GradeRawLobby {
  return {
    clusterId: `NA1:${matchId}`,
    matchId,
    playedAt: 1_700_000_000_000 + matchId * 60_000,
    puuid: "grade-rvi-characterization-owner",
    durationSecs: 1_200,
    context: { ...CHARACTERIZATION_CONTEXT },
    players: Array.from({ length: 10 }, (_, index) => participant(
      index + 1,
      matchId,
      index === 0 ? ownerOverrides : {},
    )),
  }
}

/** Frozen local reference population used only by characterization tests. */
export function characterizationReferenceLobbies(): GradeRawLobby[] {
  return Array.from({ length: 12 }, (_, index) => lobby(index + 1))
}

/**
 * A complete, eligible match whose owner has a literal zero damage share and
 * unavailable ally-sustain telemetry. Those two states must never collapse.
 */
export function characterizationSubjectLobby(): GradeRawLobby {
  return lobby(501, {
    kills: 8,
    deaths: 0,
    assists: 9,
    damageToChampions: 0,
    damageObjectives: 1_800,
    damageTurrets: 600,
    damageStructures: 950,
    goldEarned: 12_500,
    totalMinionsKilled: 180,
    neutralMinions: 12,
    visionScore: 24,
    timeCcingOthers: 18,
    totalHealsOnTeammates: undefined,
    totalDamageShieldedOnTeammates: undefined,
  })
}
