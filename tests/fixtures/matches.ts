import type { MatchRow, TrackedMode } from "../matches/types.js"

export function buildMatchRow(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    gameId: 1,
    puuid: "test-puuid",
    queueId: 450,
    gameMode: "ARAM",
    mode: "aram",
    modeFamily: "aram",
    isRanked: 0,
    isMatched: 1,
    playedAt: 1_700_000_000_000,
    durationSecs: 1200,
    gameVersion: "16.14.794.5912",
    championId: 84,
    win: 1,
    kills: 10,
    deaths: 5,
    assists: 15,
    champLevel: 18,
    goldEarned: 14000,
    damageToChampions: 30000,
    damageTaken: 25000,
    damageSelfMitigated: 15000,
    totalHeal: 5000,
    totalUnitsHealed: 2,
    timeCcingOthers: 30,
    largestKillingSpree: 3,
    largestMultiKill: 2,
    doubleKills: 1,
    tripleKills: 0,
    quadraKills: 0,
    pentaKills: 0,
    totalMinionsKilled: 60,
    visionScore: 5,
    endedInSurrender: 0,
    endedInEarlySurrender: 0,
    lane: undefined,
    role: undefined,
    neutralMinions: 0,
    wardsPlaced: 0,
    wardsKilled: 0,
    controlWards: 0,
    damageObjectives: 0,
    damageTurrets: 0,
    turretKills: 0,
    inhibitorKills: 0,
    firstBlood: 0,
    csPerMin: 3,
    goldPerMin: 700,
    ...overrides,
  }
}

/**
 * Builds a sequence of matches one hour apart, oldest first.
 * `results` is read as a list of win/loss flags.
 */
export function buildMatchSequence(
  results: boolean[],
  overrides: Partial<MatchRow> = {},
): MatchRow[] {
  const base = 1_700_000_000_000

  return results.map((won, index) =>
    buildMatchRow({
      gameId: index + 1,
      playedAt: base + index * 3_600_000,
      win: won ? 1 : 0,
      ...overrides,
    }),
  )
}

export const MODES: TrackedMode[] = ["aram", "mayhem"]
