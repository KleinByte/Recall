import type {
  ChampionPositionObservation,
  PathSegment,
} from "../../../src/shared/minimap/contracts.js"
import { clamp } from "../../../src/shared/minimap/contracts.js"
import { PathingPolicyGate, type PathingPolicyContext } from "./pathing-policy-gate.js"

/**
 * Version 2 deliberately stops synthesizing routes through fog of war. Only
 * consecutive, high-confidence rendered observations form a line segment.
 */
export const PATH_RECONSTRUCTION_MODEL_VERSION = 2

export interface ReconstructionOptions {
  /** Largest sampling gap that still represents continuous rendered evidence. */
  maximumObservedGapMs: number
  /** Protects against frames discarded between two otherwise close timestamps. */
  maximumFrameSequenceGap: number
  /** Combined identity/position confidence required at both endpoints. */
  minimumEndpointConfidence: number
}

const DEFAULT_OPTIONS: ReconstructionOptions = {
  maximumObservedGapMs: 750,
  maximumFrameSequenceGap: 2,
  minimumEndpointConfidence: 0.62,
}

function endpointConfidence(observation: ChampionPositionObservation) {
  return clamp(observation.identityConfidence * observation.positionConfidence)
}

/**
 * Builds an evidence-only post-game path. It does not apply a champion speed
 * cap: a dash, Zac jump, teleport, or recall is accepted when it was actually
 * rendered in consecutive frames. Missing visibility is represented by an
 * unknown segment whose endpoints are sightings, never by an invented route.
 */
export class PathReconstructor {
  private readonly options: ReconstructionOptions

  constructor(
    private readonly gate = new PathingPolicyGate(),
    // Kept as a third optional argument for source compatibility with the old
    // graph-backed constructor. The graph is intentionally unused in v2.
    _legacyGraph?: unknown,
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
      : this.unknown(input)
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
        : this.unknown({ ...input, start, end }))
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
