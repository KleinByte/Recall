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

const BOT_QUEUE_ID_SET = new Set<number>(BOT_QUEUE_IDS)
const BOT_QUEUE_NAME =
  /\b(?:bot|bots|tutorial)\b|co[\s-]?op\s+vs\.?\s+ai/i

export function isBotQueue(queueId: number, queueName?: string): boolean {
  return (
    BOT_QUEUE_ID_SET.has(queueId) ||
    (queueName !== undefined && BOT_QUEUE_NAME.test(queueName))
  )
}

export function isEligibleMatch(game: LcuGame, queue?: QueueInfo): boolean {
  return (
    game.gameType === "MATCHED_GAME" &&
    !isBotQueue(game.queueId, queue?.name)
  )
}
