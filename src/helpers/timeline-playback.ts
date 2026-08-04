import { REVIEW_MAP_DOMAINS, type ReviewMapId } from "./map-coordinate"
import type {
  TimelineEvent,
  TimelineFrame,
} from "../types/review"

export const MAX_PLAYBACK_GAP_MS = 90_000

export interface PlaybackPosition {
  participantId: number
  position: { x: number; y: number }
  fromTimestamp: number
  toTimestamp: number
  progress: number
  exact: boolean
}

export interface PlaybackCoverage {
  positionedFrames: number
  totalFrames: number
  positionedParticipants: number
  expectedParticipants: number
  positionedSamples: number
  expectedSamples: number
  percent: number
}

interface PositionSample {
  timestamp: number
  position: { x: number; y: number }
}

function between(value: number, minimum: number, maximum: number) {
  return value >= minimum && value <= maximum
}

export function isUsableMapPosition(
  position: { x: number; y: number } | undefined,
  mapId: ReviewMapId,
) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return false
  const domain = REVIEW_MAP_DOMAINS[mapId]
  return between(position.x, domain.min.x, domain.max.x) &&
    between(position.y, domain.min.y, domain.max.y)
}

function samplesFor(
  frames: TimelineFrame[],
  participantId: number,
  mapId: ReviewMapId,
) {
  return frames.flatMap((frame): PositionSample[] => {
    const participant = frame.participants.find((entry) => entry.participantId === participantId)
    return isUsableMapPosition(participant?.position, mapId)
      ? [{ timestamp: frame.timestamp, position: participant!.position! }]
      : []
  }).sort((left, right) => left.timestamp - right.timestamp)
}

function interpolate(
  from: PositionSample,
  to: PositionSample,
  timestamp: number,
  participantId: number,
): PlaybackPosition {
  const duration = Math.max(1, to.timestamp - from.timestamp)
  const progress = Math.max(0, Math.min(1, (timestamp - from.timestamp) / duration))
  return {
    participantId,
    position: {
      x: from.position.x + (to.position.x - from.position.x) * progress,
      y: from.position.y + (to.position.y - from.position.y) * progress,
    },
    fromTimestamp: from.timestamp,
    toTimestamp: to.timestamp,
    progress,
    exact: from.timestamp === to.timestamp || progress === 0 || progress === 1,
  }
}

function deathBetween(
  events: TimelineEvent[],
  participantId: number,
  from: PositionSample,
  to: PositionSample,
  mapId: ReviewMapId,
) {
  return events.find((event) =>
    event.type === "CHAMPION_KILL" &&
    event.targetId === participantId &&
    event.timestamp > from.timestamp &&
    event.timestamp < to.timestamp &&
    isUsableMapPosition(event.position, mapId),
  )
}

export function playbackPositionAt(
  frames: TimelineFrame[],
  events: TimelineEvent[],
  participantId: number,
  timestamp: number,
  mapId: ReviewMapId,
  maximumGapMs = MAX_PLAYBACK_GAP_MS,
): PlaybackPosition | undefined {
  const samples = samplesFor(frames, participantId, mapId)
  const exact = samples.find((sample) => sample.timestamp === timestamp)
  if (exact) return interpolate(exact, exact, timestamp, participantId)

  const before = [...samples].reverse().find((sample) => sample.timestamp < timestamp)
  const after = samples.find((sample) => sample.timestamp > timestamp)
  if (!before || !after || after.timestamp - before.timestamp > maximumGapMs) return undefined

  const death = deathBetween(events, participantId, before, after, mapId)
  if (death) {
    if (timestamp > death.timestamp) return undefined
    return interpolate(before, {
      timestamp: death.timestamp,
      position: death.position!,
    }, timestamp, participantId)
  }
  return interpolate(before, after, timestamp, participantId)
}

export function playbackPositionsAt(
  frames: TimelineFrame[],
  events: TimelineEvent[],
  timestamp: number,
  mapId: ReviewMapId,
) {
  const participantIds = new Set(frames.flatMap((frame) =>
    frame.participants.map((participant) => participant.participantId),
  ))
  return [...participantIds].flatMap((participantId) => {
    const position = playbackPositionAt(frames, events, participantId, timestamp, mapId)
    return position ? [position] : []
  })
}

export function playbackCoverage(
  frames: TimelineFrame[],
  participantIds: number[],
  mapId: ReviewMapId,
): PlaybackCoverage {
  const expectedParticipants = new Set(participantIds).size
  const expectedSamples = frames.length * expectedParticipants
  const observedParticipants = new Set<number>()
  let positionedFrames = 0
  let positionedSamples = 0

  for (const frame of frames) {
    let frameHasPosition = false
    for (const participant of frame.participants) {
      if (!participantIds.includes(participant.participantId) ||
        !isUsableMapPosition(participant.position, mapId)) continue
      positionedSamples += 1
      frameHasPosition = true
      observedParticipants.add(participant.participantId)
    }
    if (frameHasPosition) positionedFrames += 1
  }

  return {
    positionedFrames,
    totalFrames: frames.length,
    positionedParticipants: observedParticipants.size,
    expectedParticipants,
    positionedSamples,
    expectedSamples,
    percent: expectedSamples > 0 ? Math.round(positionedSamples / expectedSamples * 100) : 0,
  }
}

export function playbackTrailSamples(
  frames: TimelineFrame[],
  participantId: number,
  timestamp: number,
  mapId: ReviewMapId,
  lookbackMs = 5 * 60_000,
) {
  return samplesFor(frames, participantId, mapId)
    .filter((sample) => sample.timestamp >= timestamp - lookbackMs && sample.timestamp <= timestamp)
}
