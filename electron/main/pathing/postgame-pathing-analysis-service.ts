import { createHash } from "node:crypto"
import type {
  ChampionPositionObservation,
  PathSegment,
  PathSegmentKind,
} from "../../../src/shared/minimap/contracts.js"
import {
  MinimapTelemetryRepository,
  type PathingReviewData,
} from "../database/minimap-telemetry-repo.js"
import {
  PathReconstructor,
  PATH_RECONSTRUCTION_MODEL_VERSION,
} from "./path-reconstructor.js"
import { PathingPolicyGate, type PathingPolicyContext } from "./pathing-policy-gate.js"
import { SUMMONERS_RIFT_GRAPH } from "./summoners-rift-graph.js"

export interface PathingCoverage {
  participantCount: number
  observationCount: number
  segmentCount: number
  durationMs: number
  byKindMs: Record<PathSegmentKind, number>
  byKindPercent: Record<PathSegmentKind, number>
}

export interface PostGameAnalysisResult {
  analysisId: string
  reused: boolean
  coverage: PathingCoverage
  segments: PathSegment[]
}

function stableInputHash(observations: ChampionPositionObservation[]) {
  const canonical = [...observations]
    .sort((left, right) =>
      left.participantKey.localeCompare(right.participantKey) ||
      left.gameTimeMs - right.gameTimeMs ||
      left.frameSequence - right.frameSequence)
    .map((entry) => [
      entry.participantKey,
      entry.championName,
      entry.team,
      entry.isLocal ? 1 : 0,
      Math.round(entry.gameTimeMs),
      Math.round(entry.position.x * 10_000),
      Math.round(entry.position.y * 10_000),
      Math.round(entry.identityConfidence * 1_000),
      Math.round(entry.positionConfidence * 1_000),
      entry.frameSequence,
      entry.detectorVersion,
      entry.continuity ?? "legacy",
    ])
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex")
}

function coverageFor(
  participantCount: number,
  observationCount: number,
  segments: PathSegment[],
): PathingCoverage {
  const byKindMs: Record<PathSegmentKind, number> = {
    observed: 0,
    interpolated: 0,
    inferred: 0,
    unknown: 0,
  }
  for (const segment of segments) {
    byKindMs[segment.kind] += Math.max(0, segment.endTimeMs - segment.startTimeMs)
  }
  const durationMs = Object.values(byKindMs).reduce((sum, value) => sum + value, 0)
  const percentage = (value: number) => durationMs > 0 ? value / durationMs : 0
  return {
    participantCount,
    observationCount,
    segmentCount: segments.length,
    durationMs,
    byKindMs,
    byKindPercent: {
      observed: percentage(byKindMs.observed),
      interpolated: percentage(byKindMs.interpolated),
      inferred: percentage(byKindMs.inferred),
      unknown: percentage(byKindMs.unknown),
    },
  }
}

/**
 * Converts immutable, visibly observed minimap points into a versioned review
 * artifact. The policy gate is deliberately checked before any database read
 * or path calculation, so an active match cannot query inferred positions.
 */
export class PostGamePathingAnalysisService {
  constructor(
    private readonly repository: MinimapTelemetryRepository,
    private readonly gate = new PathingPolicyGate(),
    private readonly reconstructor = new PathReconstructor(gate),
  ) {}

  run(input: {
    gameId: number
    puuid: string
    policy: PathingPolicyContext
  }): PostGameAnalysisResult {
    this.gate.assertPostGame(input.policy)
    if (input.policy.gameId !== input.gameId) {
      throw new Error("pathing_policy_game_mismatch")
    }
    const observations = this.repository.loadChampionObservations(input.gameId, input.puuid)
    const grouped = new Map<string, ChampionPositionObservation[]>()
    for (const observation of observations) {
      const values = grouped.get(observation.participantKey) ?? []
      values.push(observation)
      grouped.set(observation.participantKey, values)
    }
    const segments = [...grouped.entries()].flatMap(([participantKey, points]) =>
      this.reconstructor.buildSegments({
        policy: input.policy,
        gameId: input.gameId,
        participantKey,
        observations: points,
      }))
    const coverage = coverageFor(grouped.size, observations.length, segments)
    const inputHash = stableInputHash(observations)
    const existing = this.repository.findPathingAnalysis({
      gameId: input.gameId,
      puuid: input.puuid,
      inputHash,
      graphVersion: SUMMONERS_RIFT_GRAPH.version,
      modelVersion: PATH_RECONSTRUCTION_MODEL_VERSION,
    })
    if (existing?.status === "complete") {
      return {
        analysisId: existing.analysisId,
        reused: true,
        coverage,
        segments: this.repository.getReview(input.gameId, input.puuid).segments,
      }
    }
    const analysisId = this.repository.startPathingAnalysis({
      gameId: input.gameId,
      puuid: input.puuid,
      inputHash,
      graphVersion: SUMMONERS_RIFT_GRAPH.version,
      modelVersion: PATH_RECONSTRUCTION_MODEL_VERSION,
      coverage,
    })
    try {
      this.repository.replacePathSegments(analysisId, segments)
    } catch (error) {
      const code = error instanceof Error ? error.message : "postgame_pathing_analysis_failed"
      this.repository.failPathingAnalysis(analysisId, code)
      throw error
    }
    return { analysisId, reused: false, coverage, segments }
  }

  review(gameId: number, puuid: string): PathingReviewData {
    return this.repository.getReview(gameId, puuid)
  }
}
