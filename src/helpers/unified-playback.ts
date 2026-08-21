import { championNameById } from "./format"
import { mapPositionPercent, type ReviewMapId } from "./map-coordinate"
import {
  playbackPositionAt,
  type PlaybackPosition,
} from "./timeline-playback"
import { SUMMONERS_RIFT_CAMPS } from "../shared/minimap/camp-map"
import type {
  CampClearEvent,
  NormalizedPoint,
  PathSegment,
  PathSegmentKind,
} from "../shared/minimap/contracts"
import type { MinimapPathingReview } from "../shared/minimap/review"
import type { TimelineEvent, TimelineFrame } from "../types/review"
import type { ParticipantRow } from "../types/stats"

export const DEFAULT_MINIMAP_PLAYBACK_CONFIDENCE = 0.68
export const MIN_MINIMAP_PLAYBACK_CONFIDENCE = 0.5
export const MAX_MINIMAP_PLAYBACK_CONFIDENCE = 0.95
const INSTANT_SEGMENT_HOLD_MS = 1_500
const RESPAWN_SOON_MS = 30_000
const CAMP_CLEAR_PULSE_MS = 3_000

interface ParticipantSegmentIndex {
  segments: PathSegment[]
  startTimes: number[]
  /** Nondecreasing maximum end time through each segment index. */
  prefixMaximumEnd: number[]
}

const minimapSegmentIndexCache = new WeakMap<
  MinimapPathingReview,
  Map<string, ParticipantSegmentIndex>
>()

export type UnifiedPlaybackSource =
  | "cv_observed"
  | "riot_snapshot"
  | "estimated"

export interface MinimapParticipantBinding {
  participantKey: string
  participantId: number
  reason: "local" | "riot_id" | "team_champion" | "team_slot"
}

export interface UnifiedPlaybackPosition {
  participantId: number
  point: { left: number; top: number }
  source: UnifiedPlaybackSource
  origin: "minimap_cv" | "riot_timeline"
  exact: boolean
  confidence: number
  fromTimestamp: number
  toTimestamp: number
  segmentKind?: PathSegmentKind
}

export interface UnifiedPlaybackTrail {
  key: string
  participantId: number
  source: UnifiedPlaybackSource
  origin: "minimap_cv" | "riot_timeline"
  confidence: number
  points: Array<{ left: number; top: number }>
}

export interface UnifiedCampMarker {
  key: CampClearEvent["campKey"]
  center: NormalizedPoint
  state: "available" | "cleared" | "respawning"
  latestClear?: CampClearEvent
  justCleared: boolean
  respawnInMs?: number
}

interface MinimapSegmentPosition {
  point: NormalizedPoint
  segment: PathSegment
  exact: boolean
}

function normalizeIdentity(value?: string) {
  return value?.trim().toLocaleLowerCase().replaceAll(" ", "") ?? ""
}

function identityVariants(value?: string) {
  const normalized = normalizeIdentity(value)
  if (!normalized) return []
  const gameName = normalized.split("#")[0]
  return gameName && gameName !== normalized ? [normalized, gameName] : [normalized]
}

function normalizeChampionName(value?: string) {
  return value?.toLocaleLowerCase().replace(/[^a-z0-9]/g, "") ?? ""
}

function teamFor(
  telemetryTeam: "ally" | "enemy",
  ownerTeamId: number | undefined,
) {
  if (ownerTeamId !== 100 && ownerTeamId !== 200) return undefined
  return telemetryTeam === "ally"
    ? ownerTeamId
    : ownerTeamId === 100 ? 200 : 100
}

function participantKeyMetadata(participantKey: string) {
  const riot = participantKey.match(/^(ally|enemy):riot:(.+)$/i)
  if (riot) {
    return {
      team: riot[1].toLocaleLowerCase() as "ally" | "enemy",
      riotId: riot[2],
    }
  }
  const slot = participantKey.match(/^(ally|enemy):slot:([0-9]+):(.+)$/i)
  if (!slot) return undefined
  return {
    team: slot[1].toLocaleLowerCase() as "ally" | "enemy",
    slot: Number(slot[2]),
    championName: slot[3],
  }
}

function indexedSegments(review: MinimapPathingReview | undefined) {
  if (!review) return new Map<string, ParticipantSegmentIndex>()
  const cached = minimapSegmentIndexCache.get(review)
  if (cached) return cached
  const grouped = new Map<string, PathSegment[]>()
  for (const segment of review.segments) {
    const segments = grouped.get(segment.participantKey) ?? []
    segments.push(segment)
    grouped.set(segment.participantKey, segments)
  }
  const result = new Map<string, ParticipantSegmentIndex>()
  for (const [participantKey, segments] of grouped) {
    segments.sort((left, right) =>
      left.startTimeMs - right.startTimeMs || left.endTimeMs - right.endTimeMs,
    )
    let maximumEnd = Number.NEGATIVE_INFINITY
    result.set(participantKey, {
      segments,
      startTimes: segments.map((segment) => segment.startTimeMs),
      prefixMaximumEnd: segments.map((segment) => {
        maximumEnd = Math.max(maximumEnd, segment.endTimeMs)
        return maximumEnd
      }),
    })
  }
  minimapSegmentIndexCache.set(review, result)
  return result
}

function upperBound(values: number[], target: number) {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (values[middle] <= target) low = middle + 1
    else high = middle
  }
  return low
}

function lowerBound(values: number[], target: number) {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (values[middle] < target) low = middle + 1
    else high = middle
  }
  return low
}

function segmentsAtTimestamp(
  index: ParticipantSegmentIndex | undefined,
  timestamp: number,
) {
  if (!index || index.segments.length === 0) return []
  const lastCandidate = upperBound(
    index.startTimes,
    timestamp + INSTANT_SEGMENT_HOLD_MS,
  ) - 1
  const result: PathSegment[] = []
  for (let current = lastCandidate; current >= 0; current -= 1) {
    if (index.prefixMaximumEnd[current] < timestamp - INSTANT_SEGMENT_HOLD_MS) break
    const segment = index.segments[current]
    if (segmentContainsTimestamp(segment, timestamp)) result.push(segment)
  }
  return result
}

/**
 * Binds capture-time participant keys to the persisted post-game scoreboard.
 * Every scoreboard participant is used at most once. Ambiguous champion-only
 * matches are deliberately left unbound rather than attaching CV evidence to
 * the wrong player.
 */
export function bindMinimapParticipants(
  review: MinimapPathingReview | undefined,
  scoreboard: ParticipantRow[],
): MinimapParticipantBinding[] {
  if (!review || scoreboard.length === 0) return []
  const owner = scoreboard.find((participant) => participant.isPlayer === 1)
  const ownerTeamId = owner?.teamId
  const ownerIdentities = new Set(identityVariants(owner?.summonerName))
  const unused = new Set(scoreboard.map((participant) => participant.participantId))
  const bindings: MinimapParticipantBinding[] = []

  const bind = (
    participantKey: string,
    participant: ParticipantRow | undefined,
    reason: MinimapParticipantBinding["reason"],
  ) => {
    if (!participant || !unused.has(participant.participantId)) return false
    bindings.push({ participantKey, participantId: participant.participantId, reason })
    unused.delete(participant.participantId)
    return true
  }

  // Current captures persist complete participant metadata. Older captures may
  // only have path keys, so recover the team, slot, champion, and Riot ID from
  // the canonical participant-key format instead of discarding their evidence.
  const metadataByKey = new Map((review.participants ?? []).map((participant) => [
    participant.participantKey,
    participant,
  ]))
  for (const participantKey of indexedSegments(review).keys()) {
    if (metadataByKey.has(participantKey)) continue
    const parsed = participantKeyMetadata(participantKey)
    if (!parsed) continue
    metadataByKey.set(participantKey, {
      participantKey,
      championName: parsed.championName ?? "",
      team: parsed.team,
      isLocal: Boolean(
        parsed.riotId && identityVariants(parsed.riotId).some((identity) =>
          ownerIdentities.has(identity),
        ),
      ),
    })
  }

  const metadata = [...metadataByKey.values()].sort((left, right) =>
    Number(right.isLocal) - Number(left.isLocal) ||
    left.participantKey.localeCompare(right.participantKey),
  )

  for (const participant of metadata) {
    const parsed = participantKeyMetadata(participant.participantKey)
    const keyIdentity = parsed?.riotId
    const localByIdentity = Boolean(
      keyIdentity && identityVariants(keyIdentity).some((identity) => ownerIdentities.has(identity)),
    )
    if ((participant.isLocal || localByIdentity) &&
        bind(participant.participantKey, owner, "local")) continue

    const expectedTeamId = teamFor(participant.team, ownerTeamId)
    const teamCandidates = scoreboard.filter((candidate) =>
      unused.has(candidate.participantId) &&
      (expectedTeamId === undefined || candidate.teamId === expectedTeamId),
    )

    if (keyIdentity) {
      const wanted = new Set(identityVariants(keyIdentity))
      const identityMatches = teamCandidates.filter((candidate) =>
        identityVariants(candidate.summonerName).some((identity) => wanted.has(identity)),
      )
      if (identityMatches.length === 1 &&
          bind(participant.participantKey, identityMatches[0], "riot_id")) continue
    }

    const wantedChampion = normalizeChampionName(
      participant.championName || parsed?.championName,
    )
    if (wantedChampion) {
      const championMatches = teamCandidates.filter((candidate) =>
        normalizeChampionName(championNameById(null, candidate.championId)) === wantedChampion,
      )
      if (championMatches.length === 1 &&
          bind(participant.participantKey, championMatches[0], "team_champion")) continue
    }

    const slot = parsed?.slot
    if (slot !== undefined && expectedTeamId !== undefined) {
      const orderedTeam = scoreboard.filter((candidate) => candidate.teamId === expectedTeamId)
        .sort((left, right) => left.participantId - right.participantId)
      bind(participant.participantKey, orderedTeam[slot], "team_slot")
    }
  }

  return bindings
}

export function clampMinimapPlaybackConfidence(value: number | undefined) {
  if (!Number.isFinite(value)) return DEFAULT_MINIMAP_PLAYBACK_CONFIDENCE
  return Math.max(
    MIN_MINIMAP_PLAYBACK_CONFIDENCE,
    Math.min(MAX_MINIMAP_PLAYBACK_CONFIDENCE, value as number),
  )
}

function usableNormalizedPoint(point: NormalizedPoint | undefined): point is NormalizedPoint {
  return Boolean(
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 && point.x <= 1 &&
    point.y >= 0 && point.y <= 1,
  )
}

function interpolatePoint(left: NormalizedPoint, right: NormalizedPoint, amount: number) {
  return {
    x: left.x + (right.x - left.x) * amount,
    y: left.y + (right.y - left.y) * amount,
  }
}

function segmentContainsTimestamp(segment: PathSegment, timestamp: number) {
  if (segment.endTimeMs > segment.startTimeMs) {
    return timestamp >= segment.startTimeMs && timestamp <= segment.endTimeMs
  }
  return Math.abs(timestamp - segment.startTimeMs) <= INSTANT_SEGMENT_HOLD_MS
}

function pointAtSegmentTime(segment: PathSegment, timestamp: number): NormalizedPoint | undefined {
  const points = segment.points
  if (points.length === 0 || points.some((point) => !usableNormalizedPoint(point))) return undefined
  if (points.length === 1 || segment.endTimeMs <= segment.startTimeMs) return points[0]
  const progress = Math.max(0, Math.min(
    1,
    (timestamp - segment.startTimeMs) / (segment.endTimeMs - segment.startTimeMs),
  ))
  const pointPosition = progress * (points.length - 1)
  const leftIndex = Math.floor(pointPosition)
  const rightIndex = Math.min(points.length - 1, leftIndex + 1)
  if (leftIndex === rightIndex) return points[leftIndex]
  return interpolatePoint(points[leftIndex], points[rightIndex], pointPosition - leftIndex)
}

function minimapPositionAt(
  index: ParticipantSegmentIndex | undefined,
  timestamp: number,
  minimumConfidence: number,
  kinds: PathSegmentKind[],
): MinimapSegmentPosition | undefined {
  return segmentsAtTimestamp(index, timestamp)
    .filter((segment) =>
      segment.modelVersion >= 2 &&
      segment.confidence >= minimumConfidence &&
      kinds.includes(segment.kind) &&
      segmentContainsTimestamp(segment, timestamp),
    )
    .flatMap((segment) => {
      const point = pointAtSegmentTime(segment, timestamp)
      return point ? [{
        point,
        segment,
        exact: segment.points.length === 1 ||
          timestamp === segment.startTimeMs || timestamp === segment.endTimeMs,
      }] : []
    })
    .sort((left, right) =>
      right.segment.confidence - left.segment.confidence ||
      right.segment.startTimeMs - left.segment.startTimeMs,
    )[0]
}

function timelinePosition(
  frames: TimelineFrame[],
  events: TimelineEvent[],
  participantId: number,
  timestamp: number,
  mapId: ReviewMapId,
): { raw: PlaybackPosition; result: UnifiedPlaybackPosition } | undefined {
  const raw = playbackPositionAt(frames, events, participantId, timestamp, mapId)
  if (!raw) return undefined
  const point = mapPositionPercent(raw.position, mapId)
  return {
    raw,
    result: {
      participantId,
      point,
      source: raw.exact ? "riot_snapshot" : "estimated",
      origin: "riot_timeline",
      exact: raw.exact,
      confidence: raw.exact ? 1 : Math.max(.45, .8 - (raw.toTimestamp - raw.fromTimestamp) / 300_000),
      fromTimestamp: raw.fromTimestamp,
      toTimestamp: raw.toTimestamp,
    },
  }
}

function normalizedPercent(value: number) {
  return Number((value * 100).toFixed(10))
}

function minimapResult(
  participantId: number,
  position: MinimapSegmentPosition,
): UnifiedPlaybackPosition {
  const observed = position.segment.kind === "observed"
  return {
    participantId,
    point: {
      left: normalizedPercent(position.point.x),
      top: normalizedPercent(position.point.y),
    },
    source: observed ? "cv_observed" : "estimated",
    origin: "minimap_cv",
    exact: observed && position.exact,
    confidence: position.segment.confidence,
    fromTimestamp: position.segment.startTimeMs,
    toTimestamp: position.segment.endTimeMs,
    segmentKind: position.segment.kind,
  }
}

/**
 * Resolves a participant position with explicit evidence precedence:
 * observed CV, exact Riot snapshot, high-confidence reconstructed CV, then
 * Riot's timestamp-linear interpolation. Unknown CV gaps never bridge their
 * neighboring observations.
 */
export function unifiedPlaybackPositionAt(input: {
  frames: TimelineFrame[]
  events: TimelineEvent[]
  minimapReview?: MinimapPathingReview
  bindings: MinimapParticipantBinding[]
  participantId: number
  timestamp: number
  mapId: ReviewMapId
  minimumConfidence?: number
}): UnifiedPlaybackPosition | undefined {
  const minimumConfidence = clampMinimapPlaybackConfidence(input.minimumConfidence)
  const participantKey = input.bindings.find(
    (binding) => binding.participantId === input.participantId,
  )?.participantKey
  const segments = participantKey
    ? indexedSegments(input.minimapReview).get(participantKey)
    : undefined

  const observedCv = minimapPositionAt(
    segments,
    input.timestamp,
    minimumConfidence,
    ["observed"],
  )
  if (observedCv) return minimapResult(input.participantId, observedCv)

  const timeline = timelinePosition(
    input.frames,
    input.events,
    input.participantId,
    input.timestamp,
    input.mapId,
  )
  if (timeline?.raw.exact) return timeline.result

  const reconstructedCv = minimapPositionAt(
    segments,
    input.timestamp,
    minimumConfidence,
    ["interpolated", "inferred"],
  )
  if (reconstructedCv) return minimapResult(input.participantId, reconstructedCv)

  return timeline?.result
}

export function unifiedPlaybackPositionsAt(input: Omit<
  Parameters<typeof unifiedPlaybackPositionAt>[0],
  "participantId"
> & { participantIds: number[] }) {
  return input.participantIds.flatMap((participantId) => {
    const position = unifiedPlaybackPositionAt({ ...input, participantId })
    return position ? [position] : []
  })
}

function pointTimestamp(segment: PathSegment, index: number) {
  if (segment.points.length <= 1 || segment.endTimeMs <= segment.startTimeMs) {
    return segment.startTimeMs
  }
  return segment.startTimeMs +
    (segment.endTimeMs - segment.startTimeMs) * index / (segment.points.length - 1)
}

function dedupePoints(points: NormalizedPoint[]) {
  return points.filter((point, index) => {
    if (index === 0) return true
    const previous = points[index - 1]
    return Math.abs(point.x - previous.x) > 0.0001 || Math.abs(point.y - previous.y) > 0.0001
  })
}

function decimate<T>(values: T[], maximum = 96) {
  if (values.length <= maximum) return values
  return Array.from({ length: maximum }, (_, index) =>
    values[Math.round(index * (values.length - 1) / (maximum - 1))],
  )
}

function segmentPointsBetween(
  segment: PathSegment,
  fromTimestamp: number,
  toTimestamp: number,
) {
  if (segment.points.length === 0 || segment.points.some((point) => !usableNormalizedPoint(point))) return []
  if (segment.endTimeMs <= segment.startTimeMs) {
    return segmentContainsTimestamp(segment, toTimestamp) ? [segment.points[0]] : []
  }
  const start = Math.max(segment.startTimeMs, fromTimestamp)
  const end = Math.min(segment.endTimeMs, toTimestamp)
  if (end < start) return []

  const points: NormalizedPoint[] = []
  const startPoint = pointAtSegmentTime(segment, start)
  if (startPoint) points.push(startPoint)
  segment.points.forEach((point, index) => {
    const timestamp = pointTimestamp(segment, index)
    if (timestamp > start && timestamp < end) points.push(point)
  })
  const endPoint = pointAtSegmentTime(segment, end)
  if (endPoint) points.push(endPoint)
  return decimate(dedupePoints(points))
}

/** Returns separate CV polylines so visibility gaps remain visible gaps. */
export function minimapPlaybackTrails(input: {
  minimapReview?: MinimapPathingReview
  bindings: MinimapParticipantBinding[]
  participantIds: number[]
  timestamp: number
  lookbackMs?: number
  minimumConfidence?: number
}): UnifiedPlaybackTrail[] {
  const minimumConfidence = clampMinimapPlaybackConfidence(input.minimumConfidence)
  const lookbackMs = input.lookbackMs ?? 5 * 60_000
  const earliest = Math.max(0, input.timestamp - lookbackMs)
  const keyByParticipantId = new Map(input.bindings.map((binding) => [
    binding.participantId,
    binding.participantKey,
  ]))

  return input.participantIds.flatMap((participantId) => {
    const participantKey = keyByParticipantId.get(participantId)
    if (!participantKey) return []
    const runs: Array<{
      startTimeMs: number
      endTimeMs: number
      source: UnifiedPlaybackSource
      confidence: number
      points: NormalizedPoint[]
    }> = []
    const segmentIndex = indexedSegments(input.minimapReview).get(participantKey)
    if (!segmentIndex) return []
    const firstCandidate = lowerBound(segmentIndex.prefixMaximumEnd, earliest)
    for (let segmentNumber = firstCandidate;
      segmentNumber < segmentIndex.segments.length;
      segmentNumber += 1) {
      const segment = segmentIndex.segments[segmentNumber]
      if (segment.startTimeMs > input.timestamp) break
      if (
        segment.modelVersion < 2 ||
        segment.confidence < minimumConfidence ||
        segment.kind === "unknown" ||
        segment.endTimeMs < earliest ||
        segment.startTimeMs > input.timestamp
      ) continue
      const points = segmentPointsBetween(segment, earliest, input.timestamp)
      if (points.length < 2) continue
      const source = segment.kind === "observed"
        ? "cv_observed" as const
        : "estimated" as const
      const previous = runs.at(-1)
      const previousPoint = previous?.points.at(-1)
      const firstPoint = points[0]
      const continuous = Boolean(
        previous &&
        previous.source === source &&
        segment.startTimeMs <= previous.endTimeMs + 1 &&
        previousPoint &&
        Math.abs(previousPoint.x - firstPoint.x) <= 0.0001 &&
        Math.abs(previousPoint.y - firstPoint.y) <= 0.0001,
      )
      if (previous && continuous) {
        previous.endTimeMs = Math.max(previous.endTimeMs, segment.endTimeMs)
        previous.confidence = Math.min(previous.confidence, segment.confidence)
        previous.points = dedupePoints([...previous.points, ...points])
      } else {
        runs.push({
          startTimeMs: segment.startTimeMs,
          endTimeMs: segment.endTimeMs,
          source,
          confidence: segment.confidence,
          points,
        })
      }
    }
    return runs.map((run, index) => ({
      key: `cv:${participantId}:${run.startTimeMs}:${run.endTimeMs}:${index}`,
      participantId,
      source: run.source,
      origin: "minimap_cv" as const,
      confidence: run.confidence,
      points: decimate(dedupePoints(run.points)).map((point) => ({
        left: normalizedPercent(point.x),
        top: normalizedPercent(point.y),
      })),
    }))
  })
}

export function reliableMinimapSegments(
  review: MinimapPathingReview | undefined,
  minimumConfidence?: number,
) {
  const threshold = clampMinimapPlaybackConfidence(minimumConfidence)
  return (review?.segments ?? []).filter((segment) =>
    segment.modelVersion >= 2 &&
    segment.kind !== "unknown" &&
    segment.confidence >= threshold &&
    segment.points.length > 0 &&
    segment.points.every(usableNormalizedPoint),
  )
}

export function minimapPlaybackDuration(review: MinimapPathingReview | undefined) {
  return Math.max(
    0,
    ...(review?.segments ?? []).map((segment) => segment.endTimeMs),
    ...(review?.campClears ?? []).map((clear) => clear.clearedAtMs),
  )
}

export function minimapFirstEvidenceTimestamp(
  review: MinimapPathingReview | undefined,
  minimumConfidence?: number,
) {
  const segments = reliableMinimapSegments(review, minimumConfidence)
  const timestamps = [
    ...segments.map((segment) => segment.startTimeMs),
    ...(review?.campClears ?? []).map((clear) => clear.clearedAtMs),
  ]
  return timestamps.length ? Math.min(...timestamps) : Number.POSITIVE_INFINITY
}

export function minimapCampMarkersAt(
  campClears: CampClearEvent[],
  timestamp: number,
): UnifiedCampMarker[] {
  return SUMMONERS_RIFT_CAMPS
    .filter((camp) => camp.respawnRule !== "epic")
    .map((camp) => {
      const latestClear = campClears.filter((clear) =>
        clear.campKey === camp.key && clear.clearedAtMs <= timestamp,
      ).sort((left, right) => left.clearedAtMs - right.clearedAtMs).at(-1)
      const respawnInMs = latestClear?.respawnAtMs === undefined
        ? undefined
        : latestClear.respawnAtMs - timestamp
      const available = !latestClear || (respawnInMs !== undefined && respawnInMs <= 0)
      return {
        key: camp.key,
        center: camp.center,
        latestClear,
        state: available
          ? "available" as const
          : respawnInMs !== undefined && respawnInMs <= RESPAWN_SOON_MS
            ? "respawning" as const
            : "cleared" as const,
        justCleared: Boolean(
          latestClear && timestamp - latestClear.clearedAtMs <= CAMP_CLEAR_PULSE_MS,
        ),
        respawnInMs: !available && respawnInMs !== undefined ? respawnInMs : undefined,
      }
    })
}

export function campClearName(campKey: CampClearEvent["campKey"]) {
  return campKey.split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}
