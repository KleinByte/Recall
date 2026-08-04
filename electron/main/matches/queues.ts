/**
 * Queue metadata straight from the League Client.
 *
 * Recall used to carry its own table of queue IDs, which meant every new queue
 * Riot shipped was either misfiled or silently lumped in with normals. The
 * client already knows the official name, map, mode and whether a queue is
 * ranked, so that is used instead and the local table is kept only as a
 * fallback for when the client cannot be reached.
 */

import type { LcuClient } from "../lcu-client.js"

export interface QueueInfo {
  id: number
  name: string
  shortName: string
  description?: string
  gameMode: string
  mapId: number
  isRanked: boolean
  gameSelectModeGroup?: string
  gameSelectCategory?: string
}

export type QueueIndex = Map<number, QueueInfo>

export function indexQueues(queues: QueueInfo[]): QueueIndex {
  const index: QueueIndex = new Map()

  for (const queue of queues) {
    if (typeof queue?.id !== "number") continue
    index.set(queue.id, queue)
  }

  return index
}

/**
 * Reads the client's queue list.
 *
 * Returns an empty index rather than throwing: classification has a fallback,
 * and losing queue names is not worth failing a sync over.
 */
export async function fetchQueues(client: LcuClient): Promise<QueueIndex> {
  try {
    const queues = await client.request<QueueInfo[]>("/lol-game-queues/v1/queues")
    return indexQueues(queues)
  } catch (error) {
    console.warn(`Could not read queue metadata: ${(error as Error).message}`)
    return new Map()
  }
}
