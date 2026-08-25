import type {
  NormalizedPoint,
  PathSegment,
  PathSegmentKind,
} from "./contracts.js"
import { clamp, normalizedDistance } from "./contracts.js"

const POINT_EPSILON = 0.0001

export interface TimedPathPoint {
  timestamp: number
  point: NormalizedPoint
}

export interface PreparedPathRun {
  key: string
  participantKey: string
  kind: Exclude<PathSegmentKind, "unknown">
  confidence: number
  points: TimedPathPoint[]
}

export interface PathSmoothingOptions {
  strength?: number
  maximumGapMs?: number
  maximumNeighbourDistance?: number
  spikeDistance?: number
}

function pointToLineDistance(
  point: NormalizedPoint,
  start: NormalizedPoint,
  end: NormalizedPoint,
) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= POINT_EPSILON * POINT_EPSILON) {
    return normalizedDistance(point, start)
  }
  const amount = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
  )
  return normalizedDistance(point, {
    x: start.x + dx * amount,
    y: start.y + dy * amount,
  })
}

function interpolateTimedPoint(
  left: TimedPathPoint,
  right: TimedPathPoint,
  timestamp: number,
): TimedPathPoint {
  const amount = right.timestamp <= left.timestamp
    ? 0
    : clamp((timestamp - left.timestamp) / (right.timestamp - left.timestamp))
  return {
    timestamp,
    point: {
      x: left.point.x + (right.point.x - left.point.x) * amount,
      y: left.point.y + (right.point.y - left.point.y) * amount,
    },
  }
}

function cumulativePointFractions(points: NormalizedPoint[]) {
  const distances = points.slice(1).map((point, index) =>
    normalizedDistance(points[index], point),
  )
  const total = distances.reduce((sum, distance) => sum + distance, 0)
  if (total <= POINT_EPSILON) {
    return points.map((_point, index) => points.length <= 1 ? 0 : index / (points.length - 1))
  }
  let traversed = 0
  return points.map((_point, index) => {
    if (index === 0) return 0
    traversed += distances[index - 1]
    return traversed / total
  })
}

/** Returns exact persisted sample times, falling back to distance-proportional timing. */
export function timedPathPoints(segment: PathSegment): TimedPathPoint[] {
  if (segment.points.length === 0) return []
  const exactTimes = segment.pointTimesMs
  const hasExactTimes = exactTimes?.length === segment.points.length &&
    exactTimes.every((timestamp, index) => Number.isFinite(timestamp) &&
      (index === 0 || timestamp >= exactTimes[index - 1]))
  const fractions = hasExactTimes ? undefined : cumulativePointFractions(segment.points)
  return segment.points.map((point, index) => ({
    timestamp: hasExactTimes
      ? exactTimes[index]
      : segment.startTimeMs +
        (segment.endTimeMs - segment.startTimeMs) * (fractions?.[index] ?? 0),
    point,
  }))
}

/**
 * Removes tiny direction reversals, then applies a bounded symmetric filter.
 * Large displacements and deliberate corners keep their shape.
 */
export function smoothTimedPath(
  samples: TimedPathPoint[],
  options: PathSmoothingOptions = {},
) {
  if (samples.length < 3) return samples.map((sample) => ({ ...sample, point: { ...sample.point } }))
  const strength = clamp(options.strength ?? 0.68)
  const maximumGapMs = options.maximumGapMs ?? 1_000
  const maximumNeighbourDistance = options.maximumNeighbourDistance ?? 0.075
  const spikeDistance = options.spikeDistance ?? 0.0025
  const despiked = samples.map((sample, index) => {
    const previous = samples[index - 1]
    const next = samples[index + 1]
    if (!previous || !next ||
        sample.timestamp - previous.timestamp > maximumGapMs ||
        next.timestamp - sample.timestamp > maximumGapMs) return { ...sample, point: { ...sample.point } }
    const incomingX = sample.point.x - previous.point.x
    const incomingY = sample.point.y - previous.point.y
    const outgoingX = next.point.x - sample.point.x
    const outgoingY = next.point.y - sample.point.y
    const incomingLength = Math.hypot(incomingX, incomingY)
    const outgoingLength = Math.hypot(outgoingX, outgoingY)
    const reverses = incomingX * outgoingX + incomingY * outgoingY < 0
    const isMicroMovement = Math.max(incomingLength, outgoingLength) <= 0.028
    const deviation = pointToLineDistance(sample.point, previous.point, next.point)
    if (!reverses || !isMicroMovement || deviation < spikeDistance) {
      return { ...sample, point: { ...sample.point } }
    }
    return {
      ...sample,
      point: {
        x: (previous.point.x + next.point.x) / 2,
        y: (previous.point.y + next.point.y) / 2,
      },
    }
  })

  const weights = [1, 2, 4, 2, 1] as const
  return despiked.map((sample, index) => {
    const previous = despiked[index - 1]
    const next = despiked[index + 1]
    if (!previous || !next ||
        sample.timestamp - previous.timestamp > maximumGapMs ||
        next.timestamp - sample.timestamp > maximumGapMs ||
        normalizedDistance(previous.point, sample.point) > maximumNeighbourDistance ||
        normalizedDistance(sample.point, next.point) > maximumNeighbourDistance) return sample

    let x = 0
    let y = 0
    let weightTotal = 0
    for (let offset = -2; offset <= 2; offset += 1) {
      const neighbour = despiked[index + offset]
      if (!neighbour || Math.abs(neighbour.timestamp - sample.timestamp) > maximumGapMs * 2) continue
      const weight = weights[offset + 2]
      x += neighbour.point.x * weight
      y += neighbour.point.y * weight
      weightTotal += weight
    }
    if (weightTotal <= 0) return sample

    const incomingX = sample.point.x - previous.point.x
    const incomingY = sample.point.y - previous.point.y
    const outgoingX = next.point.x - sample.point.x
    const outgoingY = next.point.y - sample.point.y
    const incomingLength = Math.hypot(incomingX, incomingY)
    const outgoingLength = Math.hypot(outgoingX, outgoingY)
    const cosine = incomingLength <= POINT_EPSILON || outgoingLength <= POINT_EPSILON
      ? 1
      : (incomingX * outgoingX + incomingY * outgoingY) /
        (incomingLength * outgoingLength)
    const deliberateCorner = cosine < 0.2 && Math.min(incomingLength, outgoingLength) > 0.014
    const blend = deliberateCorner ? strength * 0.2 : strength
    return {
      ...sample,
      point: {
        x: sample.point.x * (1 - blend) + x / weightTotal * blend,
        y: sample.point.y * (1 - blend) + y / weightTotal * blend,
      },
    }
  })
}

function rdpIndexes(samples: TimedPathPoint[], tolerance: number) {
  if (samples.length <= 2) return samples.map((_sample, index) => index)
  const keep = new Uint8Array(samples.length)
  keep[0] = 1
  keep[samples.length - 1] = 1
  const stack: Array<[number, number]> = [[0, samples.length - 1]]
  while (stack.length) {
    const [startIndex, endIndex] = stack.pop()!
    let maximumDistance = tolerance
    let splitIndex = -1
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = pointToLineDistance(
        samples[index].point,
        samples[startIndex].point,
        samples[endIndex].point,
      )
      if (distance <= maximumDistance) continue
      maximumDistance = distance
      splitIndex = index
    }
    if (splitIndex < 0) continue
    keep[splitIndex] = 1
    stack.push([startIndex, splitIndex], [splitIndex, endIndex])
  }
  return Array.from(keep.entries()).flatMap(([index, value]) => value ? [index] : [])
}

/** Geometry-aware simplification with a hard safety cap for SVG payload size. */
export function simplifyTimedPath(
  samples: TimedPathPoint[],
  tolerance = 0.0025,
  maximumPoints = 256,
) {
  if (samples.length <= 2) return samples
  let currentTolerance = Math.max(0, tolerance)
  let indexes = rdpIndexes(samples, currentTolerance)
  for (let attempt = 0; indexes.length > maximumPoints && attempt < 8; attempt += 1) {
    currentTolerance = Math.max(POINT_EPSILON, currentTolerance * 1.7)
    indexes = rdpIndexes(samples, currentTolerance)
  }
  if (indexes.length > maximumPoints) {
    indexes = Array.from({ length: maximumPoints }, (_value, index) =>
      Math.round(index * (samples.length - 1) / (maximumPoints - 1)),
    )
  }
  return indexes.map((index) => samples[index])
}

function samePoint(left: NormalizedPoint, right: NormalizedPoint) {
  return normalizedDistance(left, right) <= 0.005
}

export function preparePathRuns(
  segments: PathSegment[],
  options: { smoothingStrength?: number; tolerance?: number; maximumPoints?: number } = {},
): PreparedPathRun[] {
  const ordered = [...segments].sort((left, right) =>
    left.startTimeMs - right.startTimeMs || left.endTimeMs - right.endTimeMs,
  )
  const runs: PreparedPathRun[] = []
  for (const segment of ordered) {
    if (segment.kind === "unknown") continue
    const points = timedPathPoints(segment)
    if (points.length === 0) continue
    const previous = runs.at(-1)
    const previousPoint = previous?.points.at(-1)
    const continuous = Boolean(
      previous && previous.kind === segment.kind && previousPoint &&
      segment.startTimeMs - previousPoint.timestamp <= 1 &&
      samePoint(previousPoint.point, points[0].point),
    )
    if (continuous) {
      previous!.points.push(...points.slice(1))
      previous!.confidence = Math.min(previous!.confidence, segment.confidence)
      continue
    }
    runs.push({
      key: `${segment.participantKey}:${segment.kind}:${segment.startTimeMs}:${runs.length}`,
      participantKey: segment.participantKey,
      kind: segment.kind,
      confidence: segment.confidence,
      points,
    })
  }
  return runs.map((run) => {
    const strength = run.kind === "observed"
      ? options.smoothingStrength ?? 0.72
      : Math.min(0.2, options.smoothingStrength ?? 0.2)
    const smoothed = smoothTimedPath(run.points, { strength })
    return {
      ...run,
      points: simplifyTimedPath(
        smoothed,
        options.tolerance ?? (run.kind === "observed" ? 0.0028 : 0.0015),
        options.maximumPoints ?? 320,
      ),
    }
  })
}

export function upperBoundPathTime(samples: TimedPathPoint[], timestamp: number) {
  let low = 0
  let high = samples.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (samples[middle].timestamp <= timestamp) low = middle + 1
    else high = middle
  }
  return low
}

export function pointAtTimedPath(
  samples: TimedPathPoint[],
  timestamp: number,
): TimedPathPoint | undefined {
  if (samples.length === 0 || timestamp < samples[0].timestamp) return undefined
  const end = upperBoundPathTime(samples, timestamp)
  if (end >= samples.length) return samples.at(-1)
  if (end === 0) return undefined
  return interpolateTimedPoint(samples[end - 1], samples[end], timestamp)
}

export function visibleTimedPath(samples: TimedPathPoint[], timestamp: number) {
  if (samples.length === 0 || timestamp < samples[0].timestamp) return []
  const end = upperBoundPathTime(samples, timestamp)
  if (end >= samples.length) return samples
  const result = samples.slice(0, end)
  const current = pointAtTimedPath(samples, timestamp)
  if (current) result.push(current)
  return result
}

/** Merges adjacent observed samples into compact, timed review artifacts. */
export function compactObservedPathSegments(segments: PathSegment[]) {
  const compacted: PathSegment[] = []
  for (const segment of segments) {
    const points = timedPathPoints(segment)
    const previous = compacted.at(-1)
    const previousPoint = previous?.points.at(-1)
    const canMerge = segment.kind === "observed" && previous?.kind === "observed" &&
      previous.participantKey === segment.participantKey &&
      Math.abs(segment.startTimeMs - previous.endTimeMs) <= 1 &&
      previousPoint !== undefined && points[0] !== undefined &&
      samePoint(previousPoint, points[0].point)
    if (!canMerge) {
      compacted.push({
        ...segment,
        points: segment.points.map((point) => ({ ...point })),
        pointTimesMs: points.map((point) => point.timestamp),
      })
      continue
    }
    const previousTimes = previous.pointTimesMs ??
      timedPathPoints(previous).map((point) => point.timestamp)
    previous.endTimeMs = segment.endTimeMs
    previous.points.push(...points.slice(1).map((point) => ({ ...point.point })))
    previousTimes.push(...points.slice(1).map((point) => point.timestamp))
    previous.pointTimesMs = previousTimes
    previous.confidence = Math.min(previous.confidence, segment.confidence)
  }
  return compacted.map((segment) => {
    if (segment.kind !== "observed" || segment.points.length < 3) return segment
    const smoothed = smoothTimedPath(timedPathPoints(segment), { strength: 0.58 })
    return { ...segment, points: smoothed.map((sample) => sample.point) }
  })
}
