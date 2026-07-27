import { classifyMatch } from "./classify.js"
import type { QueueInfo } from "./queues.js"
import type { LcuGame, MatchRow } from "./types.js"

const int = (value: number | undefined) => Math.trunc(value ?? 0)
const bool = (value: boolean | undefined) => (value ? 1 : 0)

/**
 * Converts a match history game into a database row.
 *
 * Returns `undefined` for anything that is not a tracked ARAM mode, or for
 * payloads missing the player's participant entry.
 */
export function mapMatchRow(
  game: LcuGame,
  puuid: string,
  queue?: QueueInfo,
): MatchRow | undefined {
  const modeInfo = classifyMatch(game, queue)
  if (!modeInfo) return undefined

  const participant = game.participants?.[0]
  if (!participant) return undefined

  const stats = participant.stats

  // Derived from totals rather than the timeline's per-minute deltas, which
  // only cover early windows and are missing from some payloads.
  const minutes = Math.max(1, int(game.gameDuration) / 60)
  const creepScore =
    int(stats.totalMinionsKilled) + int(stats.neutralMinionsKilled)

  return {
    gameId: game.gameId,
    puuid,
    queueId: int(game.queueId),
    gameMode: game.gameMode,
    mode: modeInfo.mode,
    modeFamily: modeInfo.family,
    isRanked: modeInfo.isRanked ? 1 : 0,
    isMatched: game.gameType === "MATCHED_GAME" ? 1 : 0,
    playedAt: int(game.gameCreation),
    durationSecs: int(game.gameDuration),
    gameVersion: game.gameVersion ?? "",
    championId: int(participant.championId),
    win: bool(stats.win),
    kills: int(stats.kills),
    deaths: int(stats.deaths),
    assists: int(stats.assists),
    champLevel: int(stats.champLevel),
    goldEarned: int(stats.goldEarned),
    damageToChampions: int(stats.totalDamageDealtToChampions),
    damageTaken: int(stats.totalDamageTaken),
    damageSelfMitigated: int(stats.damageSelfMitigated),
    totalHeal: int(stats.totalHeal),
    totalUnitsHealed: int(stats.totalUnitsHealed),
    timeCcingOthers: int(stats.timeCCingOthers),
    largestKillingSpree: int(stats.largestKillingSpree),
    largestMultiKill: int(stats.largestMultiKill),
    doubleKills: int(stats.doubleKills),
    tripleKills: int(stats.tripleKills),
    quadraKills: int(stats.quadraKills),
    pentaKills: int(stats.pentaKills),
    totalMinionsKilled: int(stats.totalMinionsKilled),
    visionScore: int(stats.visionScore),
    endedInSurrender: bool(stats.gameEndedInSurrender),
    endedInEarlySurrender: bool(stats.gameEndedInEarlySurrender),
    lane: participant.timeline?.lane,
    role: participant.timeline?.role,
    neutralMinions: int(stats.neutralMinionsKilled),
    wardsPlaced: int(stats.wardsPlaced),
    wardsKilled: int(stats.wardsKilled),
    controlWards: int(stats.visionWardsBoughtInGame),
    damageObjectives: int(stats.damageDealtToObjectives),
    damageTurrets: int(stats.damageDealtToTurrets),
    turretKills: int(stats.turretKills),
    inhibitorKills: int(stats.inhibitorKills),
    firstBlood: bool(stats.firstBloodKill),
    csPerMin: creepScore / minutes,
    goldPerMin: int(stats.goldEarned) / minutes,
    queueName: modeInfo.queueName,
  }
}
