import type { QueueInfo } from "./queues.js"
import type { LcuGame, ModeInfo, TrackedMode } from "./types.js"
import { isLeagueClassicQueue } from "./eligibility.js"

const RIFT_MAP_ID = 11
const HOWLING_ABYSS_MAP_ID = 12

const RIFT_QUEUES: Record<number, TrackedMode> = {
  400: "sr_normal",
  420: "sr_ranked_solo",
  430: "sr_normal",
  440: "sr_ranked_flex",
  480: "sr_swiftplay",
  490: "sr_quickplay",
}

const RANKED_MODES = new Set<TrackedMode>([
  "sr_ranked_solo",
  "sr_ranked_flex",
])

/**
 * Identifies the game modes Recall tracks.
 *
 * Classification keys on the map first, then the queue or game mode.
 * Game mode alone is not enough: Swiftplay reports `SWIFTPLAY` rather than
 * `CLASSIC` despite being played on Summoner's Rift, and Riot ships many queue
 * IDs per mode — the live client currently lists six distinct Mayhem queues.
 *
 * When the client's own description of the queue is available it wins, because
 * it is authoritative and already covers queues released after this was
 * written. The table below is the fallback for when it is not.
 *
 * Everything else is retained as "other" so a complete Riot API backfill does
 * not silently discard Arena, rotating modes, or future queues.
 */
export function classifyMatch(
  game: LcuGame,
  queue?: QueueInfo,
): ModeInfo | undefined {
  const mapId = queue?.mapId || game.mapId
  const gameMode = queue?.gameMode || game.gameMode
  const queueName = queue?.name

  if (isLeagueClassicQueue(game, queue)) {
    return {
      mode: "league_classic",
      family: "classic",
      isRanked: false,
      queueName: "League Classic",
    }
  }

  if (mapId === RIFT_MAP_ID) {
    // An unrecognised queue on the Rift is still a Rift game. Riot adds queues
    // regularly, and dropping them would silently lose history.
    const mode = RIFT_QUEUES[game.queueId] ?? "sr_normal"

    return {
      mode,
      family: "sr",
      isRanked: queue?.isRanked ?? RANKED_MODES.has(mode),
      queueName,
    }
  }

  if (mapId === HOWLING_ABYSS_MAP_ID) {
    if (gameMode.startsWith("ARAM")) {
      return { mode: "aram", family: "aram", isRanked: false, queueName }
    }
    if (gameMode.startsWith("KIWI")) {
      return { mode: "mayhem", family: "aram", isRanked: false, queueName }
    }
  }

  return {
    mode: "other",
    family: "other",
    isRanked: queue?.isRanked ?? false,
    queueName,
  }
}
