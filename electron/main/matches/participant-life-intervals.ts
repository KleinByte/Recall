import type {
  LiveGamePlayer,
  LiveGameSnapshot,
} from "../game-client.js"
import type {
  CompactParticipantLifeInterval,
  CompactTimelineEvent,
} from "../riot/timeline-mapper.js"

export interface LifeIntervalParticipant {
  participantId: number
  isPlayer: number
  summonerName?: string
}

type LifeIntervalSnapshot = Pick<
  LiveGameSnapshot,
  "gameTime" | "allies" | "enemies"
>

interface LifeObservation {
  timestamp: number
  isDead: boolean
  respawnTimer: number
}

interface OpenLifeInterval extends CompactParticipantLifeInterval {
  /** Kept separately so an expired prediction is not exposed as a respawn. */
  predictedRespawnAtMs?: number
}

const EVENT_CLOCK_TOLERANCE_MS = 2_000

function identity(value?: string) {
  const normalized = value?.trim().toLocaleLowerCase()
  return normalized || undefined
}

function baseIdentity(value: string) {
  return value.split("#", 1)[0]
}

function uniqueIdentityMap(
  participants: readonly LifeIntervalParticipant[],
  key: (participant: LifeIntervalParticipant) => string | undefined,
) {
  const candidates = new Map<string, LifeIntervalParticipant[]>()
  for (const participant of participants) {
    const value = key(participant)
    if (!value) continue
    const bucket = candidates.get(value) ?? []
    bucket.push(participant)
    candidates.set(value, bucket)
  }
  return new Map([...candidates].flatMap(([value, bucket]) =>
    bucket.length === 1 ? [[value, bucket[0]] as const] : [],
  ))
}

function participantResolver(participants: readonly LifeIntervalParticipant[]) {
  const owner = participants.find((participant) => participant.isPlayer === 1)
  const exact = uniqueIdentityMap(participants, (participant) =>
    identity(participant.summonerName))
  const base = uniqueIdentityMap(participants, (participant) => {
    const normalized = identity(participant.summonerName)
    return normalized ? baseIdentity(normalized) : undefined
  })

  return (player: LiveGamePlayer) => {
    if (player.isLocal) return owner
    const normalized = identity(player.riotId)
    if (!normalized) return undefined
    return exact.get(normalized) ?? base.get(baseIdentity(normalized))
  }
}

function expectedRespawnAt(observation: LifeObservation) {
  if (!Number.isFinite(observation.respawnTimer) || observation.respawnTimer <= 0) {
    return undefined
  }
  return Math.round(observation.timestamp + observation.respawnTimer * 1_000)
}

function matchingDeathTimestamp(
  deaths: readonly number[],
  observedAtMs: number,
  afterMs: number | undefined,
) {
  for (let index = deaths.length - 1; index >= 0; index -= 1) {
    const timestamp = deaths[index]
    if (timestamp > observedAtMs + EVENT_CLOCK_TOLERANCE_MS) continue
    if (timestamp < observedAtMs - EVENT_CLOCK_TOLERANCE_MS) return undefined
    if (afterMs !== undefined && timestamp <= afterMs) return undefined
    return timestamp
  }
  return undefined
}

function updateRespawnPrediction(
  interval: OpenLifeInterval,
  observation: LifeObservation,
) {
  const predicted = expectedRespawnAt(observation)
  if (predicted && predicted > interval.diedAtMs) {
    interval.predictedRespawnAtMs = predicted
    return
  }
  if (interval.predictedRespawnAtMs !== undefined &&
      observation.timestamp >= interval.predictedRespawnAtMs) {
    interval.predictedRespawnAtMs = undefined
  }
}

/**
 * Converts durable Live Client roster observations into half-open dead windows.
 *
 * Death starts prefer a matching post-game kill timestamp. Respawn ends prefer
 * Riot's live countdown and fall back to the first captured alive state. Only
 * uniquely resolved participants are emitted; incomplete historical timelines
 * remain valid because the resulting property is optional.
 */
export function deriveParticipantLifeIntervals(
  snapshots: readonly LifeIntervalSnapshot[],
  participants: readonly LifeIntervalParticipant[],
  timelineEvents: readonly CompactTimelineEvent[] = [],
): CompactParticipantLifeInterval[] {
  const resolveParticipant = participantResolver(participants)
  const observations = new Map<number, LifeObservation[]>()

  for (const snapshot of [...snapshots].sort((left, right) =>
    left.gameTime - right.gameTime)) {
    const timestamp = Math.max(0, Math.round(snapshot.gameTime * 1_000))
    const seen = new Set<number>()
    for (const player of [...snapshot.allies, ...snapshot.enemies]) {
      const participant = resolveParticipant(player)
      if (!participant || seen.has(participant.participantId)) continue
      seen.add(participant.participantId)
      const entries = observations.get(participant.participantId) ?? []
      entries.push({
        timestamp,
        isDead: player.isDead,
        respawnTimer: player.respawnTimer,
      })
      observations.set(participant.participantId, entries)
    }
  }

  const deathsByParticipant = new Map<number, number[]>()
  for (const event of timelineEvents) {
    if (event.type !== "CHAMPION_KILL" || !event.targetId) continue
    const timestamps = deathsByParticipant.get(event.targetId) ?? []
    timestamps.push(event.timestamp)
    deathsByParticipant.set(event.targetId, timestamps)
  }
  for (const timestamps of deathsByParticipant.values()) {
    timestamps.sort((left, right) => left - right)
  }

  const intervals: CompactParticipantLifeInterval[] = []
  for (const [participantId, participantObservations] of observations) {
    const deaths = deathsByParticipant.get(participantId) ?? []
    let lastAliveAtMs: number | undefined
    let open: OpenLifeInterval | undefined

    for (const observation of participantObservations) {
      if (!observation.isDead) {
        if (open) {
          const predicted = open.predictedRespawnAtMs
          intervals.push({
            participantId,
            diedAtMs: open.diedAtMs,
            respawnAtMs: predicted !== undefined &&
                predicted <= observation.timestamp + EVENT_CLOCK_TOLERANCE_MS
              ? predicted
              : observation.timestamp,
          })
          open = undefined
        }
        lastAliveAtMs = observation.timestamp
        continue
      }

      if (!open) {
        open = {
          participantId,
          diedAtMs: matchingDeathTimestamp(
            deaths,
            observation.timestamp,
            lastAliveAtMs,
          ) ?? observation.timestamp,
        }
      }
      updateRespawnPrediction(open, observation)
    }

    if (open) {
      intervals.push({
        participantId,
        diedAtMs: open.diedAtMs,
        ...(open.predictedRespawnAtMs !== undefined
          ? { respawnAtMs: open.predictedRespawnAtMs }
          : {}),
      })
    }
  }

  return intervals.sort((left, right) =>
    left.diedAtMs - right.diedAtMs || left.participantId - right.participantId,
  )
}
