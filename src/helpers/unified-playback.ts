import { championNameById } from "./format"
import { mapPositionPercent, type ReviewMapId } from "./map-coordinate"
import { isUsableMapPosition } from "./timeline-playback"
import {
  campRespawnDurationMs,
  SUMMONERS_RIFT_CAMPS,
} from "../shared/minimap/camp-map"
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
export const DEFAULT_PLAYBACK_TRAIL_LOOKBACK_MS = 30_000
const INSTANT_SEGMENT_HOLD_MS = 1_500
const RESPAWN_SOON_MS = 30_000
const CAMP_CLEAR_PULSE_MS = 3_000
const ROUTE_TIME_EPSILON_MS = 2
const ROUTE_POINT_EPSILON = 0.0001
const MAXIMUM_CONTINUOUS_CV_GAP_MS = 1_000
const BASE_TRAVEL_ALLOWANCE = 0.035
const TRAVEL_ALLOWANCE_PER_SECOND = 0.045
const IMPOSSIBLE_TRANSITION_PENALTY = 55

interface ParticipantSegmentIndex {
  segments: PathSegment[]
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

interface UnifiedRouteControl {
  timestamp: number
  point: NormalizedPoint
  source: "cv_observed" | "cv_estimated" | "riot_snapshot"
  origin: "minimap_cv" | "riot_timeline"
  confidence: number
  runKey?: string
}

interface CvRouteRun {
  key: string
  controls: UnifiedRouteControl[]
  confidence: number
}

interface UnifiedParticipantRoute {
  controls: UnifiedRouteControl[]
  timestamps: number[]
}

const noMinimapReviewCacheKey = {}
const unifiedRouteCache = new WeakMap<
  TimelineFrame[],
  WeakMap<object, Map<string, UnifiedParticipantRoute>>
>()

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

function pointDistance(left: NormalizedPoint, right: NormalizedPoint) {
  return Math.hypot(left.x - right.x, left.y - right.y)
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
  const distances = points.slice(1).map((point, index) =>
    pointDistance(points[index], point),
  )
  const totalDistance = distances.reduce((sum, distance) => sum + distance, 0)
  if (totalDistance <= ROUTE_POINT_EPSILON) return points[0]
  const targetDistance = progress * totalDistance
  let traversed = 0
  for (let index = 0; index < distances.length; index += 1) {
    const next = traversed + distances[index]
    if (targetDistance <= next || index === distances.length - 1) {
      const amount = distances[index] <= ROUTE_POINT_EPSILON
        ? 0
        : (targetDistance - traversed) / distances[index]
      return interpolatePoint(points[index], points[index + 1], amount)
    }
    traversed = next
  }
  return points.at(-1)
}

function normalizedPercent(value: number) {
  return Number((value * 100).toFixed(10))
}

/**
 * Add a control without allowing two sources at the same timestamp to create
 * a zero-duration jump. Riot's post-game snapshot is the authoritative anchor;
 * duplicate CV endpoints otherwise retain their strongest confidence.
 */
function appendRouteControl(
  controls: UnifiedRouteControl[],
  incoming: UnifiedRouteControl,
) {
  const existingIndex = controls.findIndex((control) =>
    Math.abs(control.timestamp - incoming.timestamp) <= ROUTE_TIME_EPSILON_MS,
  )
  if (existingIndex < 0) {
    controls.push(incoming)
    return
  }
  const existing = controls[existingIndex]
  const sourcePriority = (source: UnifiedRouteControl["source"]) =>
    source === "riot_snapshot" ? 3 : source === "cv_observed" ? 2 : 1
  if (sourcePriority(incoming.source) > sourcePriority(existing.source) ||
      (sourcePriority(incoming.source) === sourcePriority(existing.source) &&
        incoming.confidence > existing.confidence)) {
    controls[existingIndex] = incoming
  }
}

function timelineRouteControls(
  frames: TimelineFrame[],
  participantId: number,
  mapId: ReviewMapId,
) {
  const controls: UnifiedRouteControl[] = []
  for (const frame of frames) {
    const participant = frame.participants.find((entry) =>
      entry.participantId === participantId,
    )
    const position = participant?.position
    if (!isUsableMapPosition(position, mapId)) continue
    const percent = mapPositionPercent(position!, mapId)
    appendRouteControl(controls, {
      timestamp: frame.timestamp,
      point: { x: percent.left / 100, y: percent.top / 100 },
      source: "riot_snapshot",
      origin: "riot_timeline",
      confidence: 1,
    })
  }
  return controls.sort((left, right) => left.timestamp - right.timestamp)
}

function smoothedRunControls(controls: UnifiedRouteControl[]) {
  if (controls.length < 3) return controls
  return controls.map((control, index) => {
    const previous = controls[index - 1]
    const next = controls[index + 1]
    if (!previous || !next ||
        control.timestamp - previous.timestamp > MAXIMUM_CONTINUOUS_CV_GAP_MS ||
        next.timestamp - control.timestamp > MAXIMUM_CONTINUOUS_CV_GAP_MS ||
        pointDistance(previous.point, control.point) > 0.08 ||
        pointDistance(control.point, next.point) > 0.08) return control
    return {
      ...control,
      point: {
        x: previous.point.x * 0.2 + control.point.x * 0.6 + next.point.x * 0.2,
        y: previous.point.y * 0.2 + control.point.y * 0.6 + next.point.y * 0.2,
      },
    }
  })
}

function observedCvRouteRuns(
  index: ParticipantSegmentIndex | undefined,
  minimumConfidence: number,
) {
  if (!index) return []
  const runs: CvRouteRun[] = []
  for (const segment of index.segments) {
    if (segment.modelVersion < 2 || segment.kind !== "observed" ||
        segment.confidence < minimumConfidence || segment.points.length === 0 ||
        segment.points.some((point) => !usableNormalizedPoint(point))) continue
    const segmentControls = segment.points.map((point, pointIndex) => ({
      timestamp: pointTimestamp(segment, pointIndex),
      point,
      source: "cv_observed" as const,
      origin: "minimap_cv" as const,
      confidence: segment.confidence,
    }))
    const previous = runs.at(-1)
    const previousControl = previous?.controls.at(-1)
    const firstControl = segmentControls[0]
    const continuous = Boolean(
      previous && previousControl &&
      firstControl.timestamp - previousControl.timestamp <= ROUTE_TIME_EPSILON_MS &&
      pointDistance(previousControl.point, firstControl.point) <= 0.005,
    )
    const run = continuous ? previous! : {
      key: `cv-run:${runs.length}:${Math.round(segment.startTimeMs)}`,
      controls: [],
      confidence: segment.confidence,
    }
    if (!continuous) runs.push(run)
    for (const control of segmentControls) {
      appendRouteControl(run.controls, { ...control, runKey: run.key })
    }
    run.confidence = Math.max(run.confidence, segment.confidence)
  }
  for (const run of runs) {
    run.controls.sort((left, right) => left.timestamp - right.timestamp)
    run.controls = smoothedRunControls(run.controls)
  }
  return runs.filter((run) => run.controls.length > 0)
}

function transitionPenalty(
  from: UnifiedRouteControl,
  to: UnifiedRouteControl,
) {
  const elapsedMs = to.timestamp - from.timestamp
  if (elapsedMs <= 0) return Number.POSITIVE_INFINITY
  const allowance = BASE_TRAVEL_ALLOWANCE +
    elapsedMs / 1_000 * TRAVEL_ALLOWANCE_PER_SECOND
  const excess = Math.max(0, pointDistance(from.point, to.point) - allowance)
  return excess * IMPOSSIBLE_TRANSITION_PENALTY
}

function cvRunReward(run: CvRouteRun) {
  const durationMs = Math.max(
    0,
    run.controls.at(-1)!.timestamp - run.controls[0].timestamp,
  )
  return run.confidence * (
    0.45 +
    Math.min(2.2, durationMs / 1_000 * 0.65) +
    Math.min(1.15, Math.log2(run.controls.length + 1) * 0.34)
  )
}

/**
 * Selects the coherent CV runs between two mandatory Riot anchors. Short CV
 * sightings are valuable, but a map-wide two-frame identity swap costs more
 * than it contributes. This turns missing/rejected runs into an estimated
 * bridge instead of snapping the token to each detector decision.
 */
function coherentCvRunsBetween(
  runs: CvRouteRun[],
  left: UnifiedRouteControl,
  right: UnifiedRouteControl,
) {
  const candidates = runs.flatMap((run) => {
    const controls = run.controls.filter((control) =>
      control.timestamp > left.timestamp + ROUTE_TIME_EPSILON_MS &&
      control.timestamp < right.timestamp - ROUTE_TIME_EPSILON_MS,
    )
    return controls.length ? [{ ...run, controls }] : []
  }).sort((first, second) =>
    first.controls[0].timestamp - second.controls[0].timestamp,
  )
  if (candidates.length === 0) return []

  const scores = candidates.map((run) =>
    cvRunReward(run) - transitionPenalty(left, run.controls[0]),
  )
  const previous = candidates.map(() => -1)
  for (let current = 0; current < candidates.length; current += 1) {
    const reward = cvRunReward(candidates[current])
    for (let candidate = 0; candidate < current; candidate += 1) {
      const from = candidates[candidate].controls.at(-1)!
      const to = candidates[current].controls[0]
      if (to.timestamp <= from.timestamp) continue
      const score = scores[candidate] + reward - transitionPenalty(from, to)
      if (score > scores[current]) {
        scores[current] = score
        previous[current] = candidate
      }
    }
  }

  let bestScore = 0
  let bestIndex = -1
  for (let index = 0; index < candidates.length; index += 1) {
    const score = scores[index] - transitionPenalty(
      candidates[index].controls.at(-1)!,
      right,
    )
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  }
  const selected: CvRouteRun[] = []
  while (bestIndex >= 0) {
    selected.unshift(candidates[bestIndex])
    bestIndex = previous[bestIndex]
  }
  return selected
}

function coherentCvRunsAfter(
  runs: CvRouteRun[],
  left: UnifiedRouteControl,
) {
  const candidates = runs.flatMap((run) => {
    const controls = run.controls.filter((control) =>
      control.timestamp > left.timestamp + ROUTE_TIME_EPSILON_MS,
    )
    return controls.length ? [{ ...run, controls }] : []
  }).sort((first, second) =>
    first.controls[0].timestamp - second.controls[0].timestamp,
  )
  const scores = candidates.map((run) =>
    cvRunReward(run) - transitionPenalty(left, run.controls[0]),
  )
  const previous = candidates.map(() => -1)
  let bestScore = 0
  let bestIndex = -1
  for (let current = 0; current < candidates.length; current += 1) {
    const reward = cvRunReward(candidates[current])
    for (let candidate = 0; candidate < current; candidate += 1) {
      const from = candidates[candidate].controls.at(-1)!
      const to = candidates[current].controls[0]
      if (to.timestamp <= from.timestamp) continue
      const score = scores[candidate] + reward - transitionPenalty(from, to)
      if (score > scores[current]) {
        scores[current] = score
        previous[current] = candidate
      }
    }
    if (scores[current] > bestScore) {
      bestScore = scores[current]
      bestIndex = current
    }
  }
  const selected: CvRouteRun[] = []
  while (bestIndex >= 0) {
    selected.unshift(candidates[bestIndex])
    bestIndex = previous[bestIndex]
  }
  return selected
}

function routeControlPointAt(
  controls: UnifiedRouteControl[],
  timestamp: number,
) {
  if (controls.length === 0) return undefined
  const timestamps = controls.map((control) => control.timestamp)
  const afterIndex = upperBound(timestamps, timestamp)
  const before = afterIndex > 0 ? controls[afterIndex - 1] : undefined
  if (before && Math.abs(before.timestamp - timestamp) <= ROUTE_TIME_EPSILON_MS) {
    return before.point
  }
  const after = afterIndex < controls.length ? controls[afterIndex] : undefined
  if (!before || !after || after.timestamp <= before.timestamp) return undefined
  return interpolatePoint(
    before.point,
    after.point,
    (timestamp - before.timestamp) / (after.timestamp - before.timestamp),
  )
}

function inferredPointTimestamp(segment: PathSegment, pointIndex: number) {
  if (segment.points.length <= 1 || segment.endTimeMs <= segment.startTimeMs) {
    return segment.startTimeMs
  }
  const distances = segment.points.slice(1).map((point, index) =>
    pointDistance(segment.points[index], point),
  )
  const totalDistance = distances.reduce((sum, distance) => sum + distance, 0)
  if (totalDistance <= ROUTE_POINT_EPSILON) return pointTimestamp(segment, pointIndex)
  const traversed = distances.slice(0, pointIndex).reduce((sum, distance) => sum + distance, 0)
  return segment.startTimeMs +
    (segment.endTimeMs - segment.startTimeMs) * traversed / totalDistance
}

/**
 * Adds graph-backed model-three inference only when it agrees with the
 * already-selected evidence endpoints. This preserves the navigation shape
 * through fog without allowing a rejected CV identity jump back into playback.
 */
function appendCoherentInferredControls(input: {
  controls: UnifiedRouteControl[]
  segmentIndex?: ParticipantSegmentIndex
  hasObservedCvRuns: boolean
  minimumConfidence: number
}) {
  const inferredSegments = input.segmentIndex?.segments.filter((segment) =>
    segment.modelVersion >= 3 &&
    segment.kind === "inferred" &&
    segment.confidence >= Math.max(0.35, input.minimumConfidence * 0.65) &&
    segment.points.length >= 2 &&
    segment.points.every(usableNormalizedPoint),
  ) ?? []
  if (inferredSegments.length === 0) return
  input.controls.sort((left, right) => left.timestamp - right.timestamp)
  for (const [segmentIndex, segment] of inferredSegments.entries()) {
    const first = segment.points[0]
    const last = segment.points.at(-1)!
    const baselineStart = routeControlPointAt(input.controls, segment.startTimeMs)
    const baselineEnd = routeControlPointAt(input.controls, segment.endTimeMs)
    if (input.hasObservedCvRuns && (
      !baselineStart || !baselineEnd ||
      pointDistance(baselineStart, first) > 0.065 ||
      pointDistance(baselineEnd, last) > 0.065
    )) continue
    const runKey = `cv-inferred:${segmentIndex}:${Math.round(segment.startTimeMs)}`
    segment.points.forEach((point, pointIndex) => appendRouteControl(input.controls, {
      timestamp: inferredPointTimestamp(segment, pointIndex),
      point,
      source: "cv_estimated",
      origin: "minimap_cv",
      confidence: segment.confidence,
      runKey,
    }))
    input.controls.sort((left, right) => left.timestamp - right.timestamp)
  }
}

function buildUnifiedParticipantRoute(input: {
  frames: TimelineFrame[]
  minimapReview?: MinimapPathingReview
  participantKey?: string
  participantId: number
  mapId: ReviewMapId
  minimumConfidence: number
}): UnifiedParticipantRoute {
  const riot = timelineRouteControls(input.frames, input.participantId, input.mapId)
  const segmentIndex = input.participantKey
    ? indexedSegments(input.minimapReview).get(input.participantKey)
    : undefined
  const cvRuns = observedCvRouteRuns(segmentIndex, input.minimumConfidence)
  const controls: UnifiedRouteControl[] = []

  if (riot.length >= 2) {
    for (let index = 1; index < riot.length; index += 1) {
      const left = riot[index - 1]
      const right = riot[index]
      appendRouteControl(controls, left)
      for (const run of coherentCvRunsBetween(cvRuns, left, right)) {
        for (const control of run.controls) appendRouteControl(controls, control)
      }
      appendRouteControl(controls, right)
    }
    for (const run of coherentCvRunsAfter(cvRuns, riot.at(-1)!)) {
      for (const control of run.controls) appendRouteControl(controls, control)
    }
  } else {
    for (const control of riot) appendRouteControl(controls, control)
    for (const run of cvRuns) {
      for (const control of run.controls) appendRouteControl(controls, control)
    }
  }

  appendCoherentInferredControls({
    controls,
    segmentIndex,
    hasObservedCvRuns: cvRuns.length > 0,
    minimumConfidence: input.minimumConfidence,
  })

  controls.sort((left, right) => left.timestamp - right.timestamp)
  return { controls, timestamps: controls.map((control) => control.timestamp) }
}

function cachedUnifiedParticipantRoute(input: {
  frames: TimelineFrame[]
  minimapReview?: MinimapPathingReview
  participantKey?: string
  participantId: number
  mapId: ReviewMapId
  minimumConfidence: number
}) {
  let byReview = unifiedRouteCache.get(input.frames)
  if (!byReview) {
    byReview = new WeakMap()
    unifiedRouteCache.set(input.frames, byReview)
  }
  const reviewKey = input.minimapReview ?? noMinimapReviewCacheKey
  let routes = byReview.get(reviewKey)
  if (!routes) {
    routes = new Map()
    byReview.set(reviewKey, routes)
  }
  const cacheKey = [
    input.participantId,
    input.participantKey ?? "riot-only",
    input.mapId,
    input.minimumConfidence.toFixed(3),
    input.frames.length,
    input.minimapReview?.segments.length ?? 0,
  ].join(":")
  let route = routes.get(cacheKey)
  if (!route) {
    route = buildUnifiedParticipantRoute(input)
    routes.set(cacheKey, route)
  }
  return route
}

function playbackResultFromControl(
  participantId: number,
  control: UnifiedRouteControl,
): UnifiedPlaybackPosition {
  return {
    participantId,
    point: {
      left: normalizedPercent(control.point.x),
      top: normalizedPercent(control.point.y),
    },
    source: control.source === "cv_estimated" ? "estimated" : control.source,
    origin: control.origin,
    exact: control.source !== "cv_estimated",
    confidence: control.confidence,
    fromTimestamp: control.timestamp,
    toTimestamp: control.timestamp,
    segmentKind: control.source === "cv_observed"
      ? "observed"
      : control.source === "cv_estimated" ? "inferred" : undefined,
  }
}

function routePositionAt(input: {
  route: UnifiedParticipantRoute
  events: TimelineEvent[]
  participantId: number
  timestamp: number
  mapId: ReviewMapId
}): UnifiedPlaybackPosition | undefined {
  const { controls, timestamps } = input.route
  if (controls.length === 0) return undefined
  const afterIndex = upperBound(timestamps, input.timestamp)
  const before = afterIndex > 0 ? controls[afterIndex - 1] : undefined
  if (before && Math.abs(before.timestamp - input.timestamp) <= ROUTE_TIME_EPSILON_MS) {
    return playbackResultFromControl(input.participantId, before)
  }
  let after = afterIndex < controls.length ? controls[afterIndex] : undefined
  if (!before || !after) return undefined

  const death = input.events.find((event) =>
    event.type === "CHAMPION_KILL" && event.targetId === input.participantId &&
    event.timestamp > before.timestamp && event.timestamp < after!.timestamp &&
    isUsableMapPosition(event.position, input.mapId),
  )
  if (death) {
    if (input.timestamp > death.timestamp) return undefined
    const percent = mapPositionPercent(death.position!, input.mapId)
    after = {
      timestamp: death.timestamp,
      point: { x: percent.left / 100, y: percent.top / 100 },
      source: "riot_snapshot",
      origin: "riot_timeline",
      confidence: 1,
    }
  }

  const progress = Math.max(0, Math.min(
    1,
    (input.timestamp - before.timestamp) / (after.timestamp - before.timestamp),
  ))
  const point = interpolatePoint(before.point, after.point, progress)
  const cvObserved = before.source === "cv_observed" &&
    after.source === "cv_observed" && before.runKey === after.runKey
  const gapMs = after.timestamp - before.timestamp
  const confidence = cvObserved
    ? Math.min(before.confidence, after.confidence)
    : Math.max(
      0.35,
      Math.min(before.confidence, after.confidence) * Math.exp(-gapMs / 240_000),
    )
  return {
    participantId: input.participantId,
    point: { left: normalizedPercent(point.x), top: normalizedPercent(point.y) },
    source: cvObserved ? "cv_observed" : "estimated",
    origin: before.origin === "minimap_cv" || after.origin === "minimap_cv"
      ? "minimap_cv"
      : "riot_timeline",
    exact: false,
    confidence,
    fromTimestamp: before.timestamp,
    toTimestamp: after.timestamp,
    segmentKind: cvObserved ? "observed" : undefined,
  }
}

/**
 * Resolves one continuous evidence route. Riot snapshots remain mandatory
 * anchors, coherent CV sightings bend the route between them, and every
 * missing interval is estimated between the surrounding accepted controls.
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
  const route = cachedUnifiedParticipantRoute({
    frames: input.frames,
    minimapReview: input.minimapReview,
    participantKey,
    participantId: input.participantId,
    mapId: input.mapId,
    minimumConfidence,
  })
  return routePositionAt({
    route,
    events: input.events,
    participantId: input.participantId,
    timestamp: input.timestamp,
    mapId: input.mapId,
  })
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
  const lookbackMs = input.lookbackMs ?? DEFAULT_PLAYBACK_TRAIL_LOOKBACK_MS
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

/** Returns the same fused route used by champion tokens, including its current point. */
export function unifiedPlaybackTrails(input: {
  frames: TimelineFrame[]
  events: TimelineEvent[]
  minimapReview?: MinimapPathingReview
  bindings: MinimapParticipantBinding[]
  participantIds: number[]
  timestamp: number
  mapId: ReviewMapId
  lookbackMs?: number
  minimumConfidence?: number
}): UnifiedPlaybackTrail[] {
  const minimumConfidence = clampMinimapPlaybackConfidence(input.minimumConfidence)
  const lookbackMs = input.lookbackMs ?? DEFAULT_PLAYBACK_TRAIL_LOOKBACK_MS
  const keyByParticipantId = new Map(input.bindings.map((binding) => [
    binding.participantId,
    binding.participantKey,
  ]))
  return input.participantIds.flatMap((participantId) => {
    const route = cachedUnifiedParticipantRoute({
      frames: input.frames,
      minimapReview: input.minimapReview,
      participantKey: keyByParticipantId.get(participantId),
      participantId,
      mapId: input.mapId,
      minimumConfidence,
    })
    const current = routePositionAt({
      route,
      events: input.events,
      participantId,
      timestamp: input.timestamp,
      mapId: input.mapId,
    })
    if (!current) return []
    const latestDeath = input.events.filter((event) =>
      event.type === "CHAMPION_KILL" && event.targetId === participantId &&
      event.timestamp <= input.timestamp,
    ).at(-1)
    const earliest = Math.max(
      0,
      input.timestamp - lookbackMs,
      latestDeath?.timestamp ?? 0,
    )
    const points: NormalizedPoint[] = []
    const start = routePositionAt({
      route,
      events: input.events,
      participantId,
      timestamp: earliest,
      mapId: input.mapId,
    })
    if (start) points.push({ x: start.point.left / 100, y: start.point.top / 100 })
    const includedControls = route.controls.filter((control) =>
      control.timestamp > earliest && control.timestamp < input.timestamp,
    )
    points.push(...includedControls.map((control) => control.point))
    points.push({ x: current.point.left / 100, y: current.point.top / 100 })
    const routePoints = decimate(dedupePoints(points))
    if (routePoints.length < 2) return []
    const hasCvEvidence = includedControls.some((control) =>
      control.origin === "minimap_cv",
    ) || current.origin === "minimap_cv"
    return [{
      // Vue must patch this polyline in place while playback advances. Including
      // the clock bounds in the key recreated the SVG node every tick, which
      // made its antialiasing and drop shadow visibly flash.
      key: `fused:${participantId}`,
      participantId,
      source: current.source,
      origin: hasCvEvidence ? "minimap_cv" as const : "riot_timeline" as const,
      confidence: current.confidence,
      points: routePoints.map((point) => ({
        left: normalizedPercent(point.x),
        top: normalizedPercent(point.y),
      })),
    }]
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
      const fallbackRespawnDuration = campRespawnDurationMs(camp.key)
      const respawnAtMs = latestClear?.respawnAtMs ?? (
        latestClear && fallbackRespawnDuration !== undefined
          ? latestClear.clearedAtMs + fallbackRespawnDuration
          : undefined
      )
      const respawnInMs = respawnAtMs === undefined
        ? undefined
        : respawnAtMs - timestamp
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
