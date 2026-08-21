import type {
  CampClearEvent,
  CampKey,
  ChampionTrackSnapshot,
} from "../../../src/shared/minimap/contracts.js"
import { clamp, normalizedDistance } from "../../../src/shared/minimap/contracts.js"
import { SUMMONERS_RIFT_CAMPS } from "./camp-map.js"
import type { JungleEvidenceDelta } from "./live-jungle-evidence.js"

const ELIGIBLE_CAMPS = SUMMONERS_RIFT_CAMPS.filter((camp) => camp.respawnRule !== "epic")
const QUIET_PERIOD_MS = 900
const CLEAR_DEDUPLICATION_MS = 60_000
const UNIQUE_NEAREST_MARGIN = 0.012

interface PendingCampEvidence {
  campKey: CampKey
  lastPositiveAtMs: number
  creepScoreDelta: number
  goldResidual: number
  nearestDistance: number
  expectedNextCamp: boolean
  visibleAlliesNearCamp: number
  visibleEnemiesNearCamp: number
}

export interface LiveClientCampInferenceInput {
  gameId: number
  puuid: string
  gameTimeMs: number
  evidence: JungleEvidenceDelta
  localParticipantKey?: string
  tracks: readonly ChampionTrackSnapshot[]
  localPlayerDead?: boolean
  routePlan?: readonly CampKey[]
  routeIndex: number
}

/**
 * Conservative fallback for first-clear tracking when camp-icon CV has no
 * usable baseline. It requires a currently rendered local champion position,
 * a positive CS event, compatible gold, and a uniquely nearest non-epic camp.
 */
export class LiveClientCampInference {
  private pending?: PendingCampEvidence
  private readonly lastRecordedAt = new Map<CampKey, number>()

  observe(input: LiveClientCampInferenceInput): CampClearEvent | undefined {
    const local = input.localParticipantKey
      ? input.tracks.find((track) => track.participantKey === input.localParticipantKey)
      : undefined
    const localVisible = local?.state === "visible" && Boolean(local.position)
    const dead = input.localPlayerDead === true || local?.state === "dead"
    const creepScoreDelta = input.evidence.creepScoreDelta ?? 0
    const positiveCampEvidence = !dead && localVisible && creepScoreDelta > 0 &&
      creepScoreDelta <= 15 && input.evidence.goldResidual >= 1

    if (positiveCampEvidence && local?.position) {
      const nearby = ELIGIBLE_CAMPS
        .map((camp) => ({
          camp,
          distance: normalizedDistance(local.position!, camp.center),
        }))
        .sort((left, right) => left.distance - right.distance)
      const nearest = nearby[0]
      const second = nearby[1]
      const uniquelyNearest = nearest && nearest.distance <= nearest.camp.attributionRadius &&
        (!second || second.distance - nearest.distance >= UNIQUE_NEAREST_MARGIN ||
          nearest.distance <= nearest.camp.attributionRadius * 0.52)
      if (uniquelyNearest) {
        const camp = nearest.camp
        const lastRecordedAt = this.lastRecordedAt.get(camp.key)
        if (lastRecordedAt === undefined ||
            input.gameTimeMs - lastRecordedAt >= CLEAR_DEDUPLICATION_MS) {
          const allies = input.tracks.filter((track) =>
            track.state === "visible" && track.team === "ally" && track.position &&
            normalizedDistance(track.position, camp.center) <= camp.attributionRadius).length
          const enemies = input.tracks.filter((track) =>
            track.state === "visible" && track.team === "enemy" && track.position &&
            normalizedDistance(track.position, camp.center) <= camp.attributionRadius).length
          if (this.pending?.campKey === camp.key &&
              input.gameTimeMs - this.pending.lastPositiveAtMs <= 2_500) {
            this.pending.lastPositiveAtMs = input.gameTimeMs
            this.pending.creepScoreDelta += creepScoreDelta
            this.pending.goldResidual += Math.max(0, input.evidence.goldResidual)
            this.pending.nearestDistance = Math.min(
              this.pending.nearestDistance,
              nearest.distance,
            )
            this.pending.expectedNextCamp ||= input.routePlan?.[input.routeIndex] === camp.key
            this.pending.visibleAlliesNearCamp = Math.max(
              this.pending.visibleAlliesNearCamp,
              allies,
            )
            this.pending.visibleEnemiesNearCamp = Math.max(
              this.pending.visibleEnemiesNearCamp,
              enemies,
            )
          } else {
            this.pending = {
              campKey: camp.key,
              lastPositiveAtMs: input.gameTimeMs,
              creepScoreDelta,
              goldResidual: Math.max(0, input.evidence.goldResidual),
              nearestDistance: nearest.distance,
              expectedNextCamp: input.routePlan?.[input.routeIndex] === camp.key,
              visibleAlliesNearCamp: allies,
              visibleEnemiesNearCamp: enemies,
            }
          }
        }
      }
    }

    const pending = this.pending
    if (!pending || input.gameTimeMs - pending.lastPositiveAtMs < QUIET_PERIOD_MS) {
      return undefined
    }
    this.pending = undefined
    if (pending.creepScoreDelta <= 0 || pending.creepScoreDelta > 15 ||
        pending.goldResidual < 5 || dead) return undefined
    const previous = this.lastRecordedAt.get(pending.campKey)
    if (previous !== undefined && pending.lastPositiveAtMs - previous < CLEAR_DEDUPLICATION_MS) {
      return undefined
    }

    const camp = ELIGIBLE_CAMPS.find((entry) => entry.key === pending.campKey)
    if (!camp) return undefined
    const distanceScore = clamp(1 - pending.nearestDistance / camp.attributionRadius)
    const csScore = clamp(pending.creepScoreDelta / 4)
    const goldScore = clamp(pending.goldResidual / 80)
    const confidence = clamp(
      0.54 + distanceScore * 0.22 + csScore * 0.1 + goldScore * 0.09 +
      (pending.expectedNextCamp ? 0.05 : 0),
    )
    this.lastRecordedAt.set(pending.campKey, pending.lastPositiveAtMs)
    return {
      gameId: input.gameId,
      puuid: input.puuid,
      campKey: pending.campKey,
      clearedAtMs: pending.lastPositiveAtMs,
      source: "live_client_inference",
      sourceConfidence: confidence,
      attribution: "local",
      attributionConfidence: confidence,
      evidence: {
        campTransition: false,
        localPositionObserved: true,
        localPositionDistance: pending.nearestDistance,
        creepScoreDelta: pending.creepScoreDelta,
        goldResidual: pending.goldResidual,
        expectedNextCamp: pending.expectedNextCamp,
        visibleAlliesNearCamp: pending.visibleAlliesNearCamp,
        visibleEnemiesNearCamp: pending.visibleEnemiesNearCamp,
        localPlayerDead: false,
        transitionConfidence: 0,
        evidenceAgeMs: 0,
      },
      routeIndex: input.routeIndex,
      algorithmVersion: 3,
    }
  }

  markObservedClear(campKey: CampKey, gameTimeMs: number) {
    this.lastRecordedAt.set(campKey, gameTimeMs)
    if (this.pending?.campKey === campKey) this.pending = undefined
  }

  reset() {
    this.pending = undefined
    this.lastRecordedAt.clear()
  }
}
