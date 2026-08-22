import type {
  ChampionPositionObservation,
  NormalizedPoint,
  PathSegment,
} from "../../../src/shared/minimap/contracts.js"
import { clamp, normalizedDistance } from "../../../src/shared/minimap/contracts.js"
import { PathingPolicyGate, type PathingPolicyContext } from "./pathing-policy-gate.js"
import {
  nearestNavigationNode,
  shortestGraphPath,
  SUMMONERS_RIFT_GRAPH,
  type NavigationGraph,
} from "./summoners-rift-graph.js"

/**
 * Version 3 keeps rendered observations exact and estimates feasible travel
 * through fog of war over the navigation graph. Every new sighting becomes an
 * endpoint, so even a brief observation bends the surrounding estimate.
 */
export const PATH_RECONSTRUCTION_MODEL_VERSION = 3

export interface ReconstructionOptions {
  /** Largest sampling gap that still represents continuous rendered evidence. */
  maximumObservedGapMs: number
  /** Protects against frames discarded between two otherwise close timestamps. */
  maximumFrameSequenceGap: number
  /** Combined identity/position confidence required at both endpoints. */
  minimumEndpointConfidence: number
  /** Generous feasibility cap used only to reject impossible hidden travel. */
  maximumInferredSpeedPerSecond: number
  /** Small allowance for map-anchor and detector quantization error. */
  inferredTravelAllowance: number
  /** Avoids routing through a coarse graph when either endpoint is too far away. */
  maximumGraphSnapDistance: number
}

const DEFAULT_OPTIONS: ReconstructionOptions = {
  maximumObservedGapMs: 750,
  maximumFrameSequenceGap: 2,
  minimumEndpointConfidence: 0.62,
  maximumInferredSpeedPerSecond: 0.055,
  inferredTravelAllowance: 0.045,
  maximumGraphSnapDistance: 0.18,
}

function endpointConfidence(observation: ChampionPositionObservation) {
  return clamp(observation.identityConfidence * observation.positionConfidence)
}

/**
 * Builds an evidence-first post-game path. Consecutive rendered observations
 * are never speed-limited, so real dashes and teleports remain intact. Across
 * missing visibility, only feasible high-confidence endpoints are joined over
 * the map graph; impossible relocations remain explicitly unknown.
 */
export class PathReconstructor {
  private readonly options: ReconstructionOptions

  constructor(
    private readonly gate = new PathingPolicyGate(),
    private readonly graph: NavigationGraph = SUMMONERS_RIFT_GRAPH,
    options: Partial<ReconstructionOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  reconstructGap(input: {
    policy: PathingPolicyContext
    gameId: number
    participantKey: string
    start: ChampionPositionObservation
    end: ChampionPositionObservation
  }): PathSegment {
    this.gate.assertPostGame(input.policy)
    if (input.end.gameTimeMs <= input.start.gameTimeMs) {
      throw new Error("invalid_path_observation_order")
    }
    return this.isContinuous(input.start, input.end)
      ? this.observed(input)
      : this.inferredOrUnknown(input)
  }

  buildSegments(input: {
    policy: PathingPolicyContext
    gameId: number
    participantKey: string
    observations: ChampionPositionObservation[]
  }): PathSegment[] {
    this.gate.assertPostGame(input.policy)
    const ordered = input.observations
      .filter((observation) => observation.participantKey === input.participantKey)
      .sort((left, right) => left.gameTimeMs - right.gameTimeMs)
    const result: PathSegment[] = []
    for (let index = 1; index < ordered.length; index += 1) {
      const start = ordered[index - 1]
      const end = ordered[index]
      if (end.gameTimeMs <= start.gameTimeMs) continue
      result.push(this.isContinuous(start, end)
        ? this.observed({ ...input, start, end })
        : this.inferredOrUnknown({ ...input, start, end }))
    }
    return result
  }

  private isContinuous(
    start: ChampionPositionObservation,
    end: ChampionPositionObservation,
  ) {
    const elapsedMs = end.gameTimeMs - start.gameTimeMs
    const frameGap = end.frameSequence - start.frameSequence
    return elapsedMs > 0 && elapsedMs <= this.options.maximumObservedGapMs &&
      frameGap > 0 && frameGap <= this.options.maximumFrameSequenceGap &&
      end.continuity === "continuous" &&
      endpointConfidence(start) >= this.options.minimumEndpointConfidence &&
      endpointConfidence(end) >= this.options.minimumEndpointConfidence
  }

  private observed(input: {
    gameId: number
    participantKey: string
    start: ChampionPositionObservation
    end: ChampionPositionObservation
  }): PathSegment {
    return {
      gameId: input.gameId,
      participantKey: input.participantKey,
      startTimeMs: input.start.gameTimeMs,
      endTimeMs: input.end.gameTimeMs,
      kind: "observed",
      points: [input.start.position, input.end.position],
      confidence: Math.min(endpointConfidence(input.start), endpointConfidence(input.end)),
      modelVersion: PATH_RECONSTRUCTION_MODEL_VERSION,
    }
  }

  private inferredOrUnknown(input: {
    gameId: number
    participantKey: string
    start: ChampionPositionObservation
    end: ChampionPositionObservation
  }): PathSegment {
    const elapsedMs = input.end.gameTimeMs - input.start.gameTimeMs
    const startConfidence = endpointConfidence(input.start)
    const endConfidence = endpointConfidence(input.end)
    const explicitContinuity = input.end.continuity === "continuous" ||
      input.end.continuity === "relocation"
    const directDistance = normalizedDistance(input.start.position, input.end.position)
    const travelAllowance = this.options.inferredTravelAllowance +
      elapsedMs / 1_000 * this.options.maximumInferredSpeedPerSecond
    if (!explicitContinuity ||
        startConfidence < this.options.minimumEndpointConfidence ||
        endConfidence < this.options.minimumEndpointConfidence ||
        directDistance > travelAllowance) return this.unknown(input)

    const startNode = nearestNavigationNode(input.start.position, this.graph)
    const endNode = nearestNavigationNode(input.end.position, this.graph)
    if (!startNode || !endNode ||
        startNode.distance > this.options.maximumGraphSnapDistance ||
        endNode.distance > this.options.maximumGraphSnapDistance) return this.unknown(input)
    const graphPath = shortestGraphPath(startNode.node.id, endNode.node.id, this.graph)
    if (!graphPath) return this.unknown(input)
    const routeDistance = startNode.distance + graphPath.distance + endNode.distance
    if (routeDistance > travelAllowance) return this.unknown(input)

    const points = dedupePoints([
      input.start.position,
      ...graphPath.points,
      input.end.position,
    ])
    const endpointScore = Math.min(startConfidence, endConfidence)
    const elapsedDecay = Math.exp(-elapsedMs / 180_000)
    const snapPenalty = clamp(1 - (startNode.distance + endNode.distance) / 0.36, 0.55, 1)
    const confidence = clamp(endpointScore * elapsedDecay * snapPenalty, 0, 0.88)
    return {
      gameId: input.gameId,
      participantKey: input.participantKey,
      startTimeMs: input.start.gameTimeMs,
      endTimeMs: input.end.gameTimeMs,
      kind: "inferred",
      points,
      confidence,
      uncertaintyRadius: points.map((_point, index) => {
        if (points.length <= 1) return 0
        const progress = index / (points.length - 1)
        return Number((Math.sin(Math.PI * progress) * (0.018 + elapsedMs / 600_000)).toFixed(4))
      }),
      inferenceMode: "smoothed_postgame",
      modelVersion: PATH_RECONSTRUCTION_MODEL_VERSION,
    }
  }

  private unknown(input: {
    gameId: number
    participantKey: string
    start: ChampionPositionObservation
    end: ChampionPositionObservation
  }): PathSegment {
    return {
      gameId: input.gameId,
      participantKey: input.participantKey,
      startTimeMs: input.start.gameTimeMs,
      endTimeMs: input.end.gameTimeMs,
      kind: "unknown",
      // These are two independently observed endpoints. Review rendering must
      // not connect them; retaining them lets it show both honest sightings.
      points: [input.start.position, input.end.position],
      confidence: 0,
      modelVersion: PATH_RECONSTRUCTION_MODEL_VERSION,
    }
  }
}

function dedupePoints(points: NormalizedPoint[]) {
  return points.filter((point, index) =>
    index === 0 || normalizedDistance(points[index - 1], point) > 0.0001,
  )
}
