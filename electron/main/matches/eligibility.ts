import type { LcuGame } from "./types.js"
import type { QueueInfo } from "./queues.js"

/**
 * Riot's published Co-op vs. AI, Doom Bots, and tutorial queue ids.
 *
 * Queue names catch newly added bot queues when the client knows about them;
 * ids keep the filter reliable for older rows and while the client is closed.
 */
export const BOT_QUEUE_IDS = [
  7, 25, 31, 32, 33, 52, 67, 83, 91, 92, 93,
  800, 810, 820, 830, 840, 850, 870, 880, 890, 950, 960,
  2000, 2010, 2020,
  4320, 4321,
] as const

/**
 * League Classic ships as the Jade queue group. Keep 710 as a legacy fallback
 * for rows captured while the mode was still exposed as "Ranked 5s".
 */
export const LEAGUE_CLASSIC_PVP_QUEUE_IDS = [
  710,
  4300, 4301, 4302, 4303, 4304, 4305,
  4306, 4307, 4308, 4309, 4310, 4311,
] as const

export const LEAGUE_CLASSIC_QUEUE_IDS = [
  ...LEAGUE_CLASSIC_PVP_QUEUE_IDS,
  4320, 4321,
] as const

/** Standard Summoner's Rift queues eligible for comparable personal records. */
export const PERSONAL_RECORD_RIFT_QUEUE_IDS = [
  400, 420, 430, 440, 480, 490,
] as const

const BOT_QUEUE_ID_SET = new Set<number>(BOT_QUEUE_IDS)
const BOT_QUEUE_NAME =
  /\b(?:bot|bots|tutorial)\b|co[\s-]?op\s+vs\.?\s+ai/i
const LEAGUE_CLASSIC_QUEUE_ID_SET = new Set<number>(LEAGUE_CLASSIC_QUEUE_IDS)
const LEAGUE_CLASSIC_QUEUE_NAME = /\b(?:league(?: of legends)?\s+)?classic\b/i
const LEAGUE_CLASSIC_MODE_GROUP = /^k?jade$/i

export function isBotQueue(queueId: number, queueName?: string): boolean {
  return (
    BOT_QUEUE_ID_SET.has(queueId) ||
    (queueName !== undefined && BOT_QUEUE_NAME.test(queueName))
  )
}

export function isLeagueClassicQueue(
  game: Pick<LcuGame, "queueId" | "mapId" | "gameMode">,
  queue?: QueueInfo,
): boolean {
  const mapId = queue?.mapId || game.mapId
  const gameMode = queue?.gameMode || game.gameMode
  const queueText = [queue?.name, queue?.shortName, queue?.description]
    .filter(Boolean)
    .join(" ")

  return (
    LEAGUE_CLASSIC_QUEUE_ID_SET.has(game.queueId) ||
    (mapId !== 12 && (
      LEAGUE_CLASSIC_MODE_GROUP.test(queue?.gameSelectModeGroup ?? "") ||
      gameMode.toUpperCase() === "JADE" ||
      (gameMode.toUpperCase() === "CLASSIC" &&
        LEAGUE_CLASSIC_QUEUE_NAME.test(queueText))
    ))
  )
}

export function isEligibleMatch(game: LcuGame, queue?: QueueInfo): boolean {
  return (
    game.gameType === "MATCHED_GAME" &&
    queue?.gameSelectCategory !== "kVersusAI" &&
    !isBotQueue(game.queueId, [queue?.name, queue?.description].filter(Boolean).join(" "))
  )
}
