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
] as const

/**
 * League Classic currently identifies itself as the legacy "Ranked 5s"
 * queue. The name check below also covers a future client label that says
 * Classic directly without confusing Mayhem's "Classic-ish" queue.
 */
export const LEAGUE_CLASSIC_QUEUE_IDS = [710] as const

/** Standard Summoner's Rift queues eligible for comparable personal records. */
export const PERSONAL_RECORD_RIFT_QUEUE_IDS = [
  400, 420, 430, 440, 480, 490,
] as const

const BOT_QUEUE_ID_SET = new Set<number>(BOT_QUEUE_IDS)
const BOT_QUEUE_NAME =
  /\b(?:bot|bots|tutorial)\b|co[\s-]?op\s+vs\.?\s+ai/i
const LEAGUE_CLASSIC_QUEUE_ID_SET = new Set<number>(LEAGUE_CLASSIC_QUEUE_IDS)
const LEAGUE_CLASSIC_QUEUE_NAME = /\b(?:league(?: of legends)?\s+)?classic\b/i

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
  const queueName = queue?.name

  return (
    mapId === 11 &&
    (LEAGUE_CLASSIC_QUEUE_ID_SET.has(game.queueId) ||
      (gameMode === "CLASSIC" &&
        queueName !== undefined &&
        LEAGUE_CLASSIC_QUEUE_NAME.test(queueName)))
  )
}

export function isEligibleMatch(game: LcuGame, queue?: QueueInfo): boolean {
  return (
    game.gameType === "MATCHED_GAME" &&
    !isBotQueue(game.queueId, queue?.name)
  )
}
