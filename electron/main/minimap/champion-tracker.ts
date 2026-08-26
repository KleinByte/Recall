import type {
  ChampionPositionObservation,
  ChampionTrackSnapshot,
  ChampionVisionTeam,
  NormalizedPoint,
} from "../../../src/shared/minimap/contracts.js"
import { clamp, normalizedDistance } from "../../../src/shared/minimap/contracts.js"

export type ChampionObservationContinuity = "continuous" | "relocation"

/**
 * A detector result which has survived temporal confirmation. Relocation
 * marks the first observation after a visibility gap or a corroborated jump.
 */
export type ConfirmedChampionPositionObservation = ChampionPositionObservation & {
  continuity: ChampionObservationContinuity
}

interface PendingCandidate {
  observations: ChampionPositionObservation[]
}

interface InternalTrack {
  participantKey: string
  championName: string
  team: ChampionVisionTeam
  isLocal: boolean
  lastObservedAtMs: number
  lastObservedPosition: NormalizedPoint
  confidence: number
  lastRelocatedAtMs?: number
  pendingRelocation?: PendingCandidate
}

export interface ChampionTrackerOptions {
  temporaryOcclusionMs: number
  initialConfirmationObservations: number
  minimumInitialConfirmationDurationMs: number
  relocationConfirmationObservations: number
  suspiciousRelocationConfirmationObservations: number
  minimumSuspiciousRelocationDurationMs: number
  maximumConfirmationGapMs: number
  confirmationRadius: number
  /**
   * A jump beyond this distance is corroborated before it is exposed. It is
   * never rejected for being fast: a confirmed dash/teleport is accepted.
   */
  discontinuityDistance: number
  maximumNormalizedSpeedPerSecond: number
  relocationCooldownMs: number
  /** A gap longer than this is not joined to the previous visible point. */
  maximumContinuousGapMs: number
  minimumDuplicateConfidenceMargin: number
}

const DEFAULT_OPTIONS: ChampionTrackerOptions = {
  temporaryOcclusionMs: 900,
  initialConfirmationObservations: 3,
  minimumInitialConfirmationDurationMs: 300,
  relocationConfirmationObservations: 2,
  suspiciousRelocationConfirmationObservations: 4,
  minimumSuspiciousRelocationDurationMs: 700,
  maximumConfirmationGapMs: 1_000,
  confirmationRadius: 0.06,
  discontinuityDistance: 0.06,
  maximumNormalizedSpeedPerSecond: 0.045,
  relocationCooldownMs: 3_000,
  maximumContinuousGapMs: 500,
  minimumDuplicateConfidenceMargin: 0.08,
}

function observationConfidence(observation: ChampionPositionObservation) {
  return clamp(observation.identityConfidence * observation.positionConfidence)
}

function sameIdentity(
  left: Pick<ChampionPositionObservation, "participantKey" | "championName" | "team" | "isLocal">,
  right: Pick<ChampionPositionObservation, "participantKey" | "championName" | "team" | "isLocal">,
) {
  return left.participantKey === right.participantKey &&
    left.championName === right.championName &&
    left.team === right.team &&
    left.isLocal === right.isLocal
}

function extendCandidate(
  candidate: PendingCandidate | undefined,
  observation: ChampionPositionObservation,
  options: ChampionTrackerOptions,
): PendingCandidate {
  const previous = candidate?.observations.at(-1)
  const continues =
    previous !== undefined &&
    sameIdentity(previous, observation) &&
    observation.gameTimeMs > previous.gameTimeMs &&
    observation.gameTimeMs - previous.gameTimeMs <= options.maximumConfirmationGapMs &&
    observation.frameSequence > previous.frameSequence &&
    normalizedDistance(previous.position, observation.position) <= options.confirmationRadius
  return {
    observations: continues
      ? [...candidate!.observations, observation]
      : [observation],
  }
}

function averageConfidence(observations: ChampionPositionObservation[]) {
  return observations.reduce(
    (sum, observation) => sum + observationConfidence(observation),
    0,
  ) / Math.max(1, observations.length)
}

/**
 * Confirms identities across frames and exposes only coordinates actually
 * observed in the current frame. It never predicts a hidden coordinate.
 */
export class ChampionTracker {
  private readonly tracks = new Map<string, InternalTrack>()
  private readonly pendingInitial = new Map<string, PendingCandidate>()
  private readonly options: ChampionTrackerOptions
  private confirmedObservations: ConfirmedChampionPositionObservation[] = []

  constructor(options: Partial<ChampionTrackerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  update(input: {
    gameTimeMs: number
    observations: ChampionPositionObservation[]
    deadParticipantKeys?: Iterable<string>
    captureAvailable?: boolean
  }): ChampionTrackSnapshot[] {
    this.confirmedObservations = []
    const dead = new Set(input.deadParticipantKeys ?? [])
    const observed = new Set<string>()
    for (const participantKey of dead) {
      this.pendingInitial.delete(participantKey)
      const track = this.tracks.get(participantKey)
      if (track) track.pendingRelocation = undefined
    }
    const selected = this.selectUnambiguousObservations(
      input.observations.filter((observation) => !dead.has(observation.participantKey)),
    )

    for (const observation of selected) {
      const previous = this.tracks.get(observation.participantKey)
      if (!previous) {
        const current = this.pendingInitial.get(observation.participantKey)
        const candidate = extendCandidate(current, observation, this.options)
        this.pendingInitial.set(observation.participantKey, candidate)
        const initialDurationMs = candidate.observations.length > 1
          ? candidate.observations.at(-1)!.gameTimeMs - candidate.observations[0].gameTimeMs
          : 0
        if (candidate.observations.length < this.options.initialConfirmationObservations ||
            initialDurationMs < this.options.minimumInitialConfirmationDurationMs) continue
        const latest = candidate.observations.at(-1)!
        this.tracks.set(observation.participantKey, {
          participantKey: latest.participantKey,
          championName: latest.championName,
          team: latest.team,
          isLocal: latest.isLocal,
          lastObservedAtMs: latest.gameTimeMs,
          lastObservedPosition: { ...latest.position },
          confidence: averageConfidence(candidate.observations),
        })
        this.pendingInitial.delete(observation.participantKey)
        this.confirmedObservations.push(...candidate.observations.map((confirmed) => ({
          ...confirmed,
          continuity: "continuous" as const,
        })))
        observed.add(observation.participantKey)
        continue
      }

      if (!sameIdentity(previous, observation) ||
          observation.gameTimeMs <= previous.lastObservedAtMs) {
        previous.pendingRelocation = undefined
        continue
      }

      const elapsedMs = observation.gameTimeMs - previous.lastObservedAtMs
      const distance = normalizedDistance(previous.lastObservedPosition, observation.position)
      const requiresRelocationConfirmation =
        elapsedMs > this.options.maximumContinuousGapMs ||
        distance > this.options.discontinuityDistance
      if (requiresRelocationConfirmation) {
        previous.pendingRelocation = extendCandidate(
          previous.pendingRelocation,
          observation,
          this.options,
        )
        const plausibleDistance = this.options.discontinuityDistance +
          elapsedMs / 1_000 * this.options.maximumNormalizedSpeedPerSecond
        const recentlyRelocated = previous.lastRelocatedAtMs !== undefined &&
          observation.gameTimeMs - previous.lastRelocatedAtMs < this.options.relocationCooldownMs
        const suspicious = distance > plausibleDistance || recentlyRelocated
        const requiredObservations = suspicious
          ? this.options.suspiciousRelocationConfirmationObservations
          : this.options.relocationConfirmationObservations
        const relocationDurationMs = previous.pendingRelocation.observations.length > 1
          ? previous.pendingRelocation.observations.at(-1)!.gameTimeMs -
            previous.pendingRelocation.observations[0].gameTimeMs
          : 0
        if (previous.pendingRelocation.observations.length < requiredObservations ||
            (suspicious && relocationDurationMs <
              this.options.minimumSuspiciousRelocationDurationMs)) continue
        const confirmed = previous.pendingRelocation.observations
        const latest = confirmed.at(-1)!
        previous.lastObservedAtMs = latest.gameTimeMs
        previous.lastObservedPosition = { ...latest.position }
        previous.confidence = clamp(
          previous.confidence * 0.35 + averageConfidence(confirmed) * 0.65,
        )
        previous.lastRelocatedAtMs = latest.gameTimeMs
        previous.pendingRelocation = undefined
        this.confirmedObservations.push(...confirmed.map((item, index) => ({
          ...item,
          continuity: index === 0 ? "relocation" as const : "continuous" as const,
        })))
        observed.add(observation.participantKey)
        continue
      }

      previous.pendingRelocation = undefined
      previous.lastObservedAtMs = observation.gameTimeMs
      previous.lastObservedPosition = { ...observation.position }
      previous.confidence = clamp(
        previous.confidence * 0.35 + observationConfidence(observation) * 0.65,
      )
      this.confirmedObservations.push({ ...observation, continuity: "continuous" })
      observed.add(observation.participantKey)
    }

    this.expirePending(input.gameTimeMs)

    const snapshots: ChampionTrackSnapshot[] = []
    for (const track of this.tracks.values()) {
      const isObserved = observed.has(track.participantKey)
      const age = Math.max(0, input.gameTimeMs - track.lastObservedAtMs)
      const state = dead.has(track.participantKey)
        ? "dead"
        : input.captureAvailable === false
          ? "capture_unavailable"
          : isObserved
            ? "visible"
            : age <= this.options.temporaryOcclusionMs
              ? "temporarily_occluded"
              : "not_visible"
      snapshots.push({
        participantKey: track.participantKey,
        championName: track.championName,
        team: track.team,
        state,
        ...(state === "visible"
          ? { position: { ...track.lastObservedPosition } }
          : {}),
        lastObservedPosition: { ...track.lastObservedPosition },
        lastObservedGameTimeMs: track.lastObservedAtMs,
        confidence: state === "visible"
          ? track.confidence
          : clamp(track.confidence * Math.exp(-age / 4_000)),
      })
    }
    return snapshots.sort((left, right) => left.participantKey.localeCompare(right.participantKey))
  }

  /**
   * Returns observations confirmed by the most recent update, in game-time
   * order. Buffered first sightings are included once their identity is proven.
   */
  getConfirmedObservations(): ConfirmedChampionPositionObservation[] {
    return this.confirmedObservations
      .map((observation) => ({ ...observation, position: { ...observation.position } }))
      .sort((left, right) => left.gameTimeMs - right.gameTimeMs)
  }

  reset() {
    this.tracks.clear()
    this.pendingInitial.clear()
    this.confirmedObservations = []
  }

  nearestObserved(
    snapshots: ChampionTrackSnapshot[],
    point: NormalizedPoint,
    team?: ChampionVisionTeam,
  ) {
    return snapshots
      .filter((snapshot) => snapshot.state === "visible" && snapshot.position &&
        (!team || snapshot.team === team))
      .map((snapshot) => ({
        snapshot,
        distance: normalizedDistance(snapshot.position!, point),
      }))
      .sort((left, right) => left.distance - right.distance)[0]
  }

  private selectUnambiguousObservations(
    observations: ChampionPositionObservation[],
  ) {
    const byParticipant = new Map<string, ChampionPositionObservation[]>()
    for (const observation of observations) {
      const list = byParticipant.get(observation.participantKey) ?? []
      list.push(observation)
      byParticipant.set(observation.participantKey, list)
    }
    const selected: ChampionPositionObservation[] = []
    for (const candidates of byParticipant.values()) {
      candidates.sort((left, right) =>
        observationConfidence(right) - observationConfidence(left))
      const [best, second] = candidates
      if (second &&
          normalizedDistance(best.position, second.position) > this.options.confirmationRadius &&
          observationConfidence(best) - observationConfidence(second) <
            this.options.minimumDuplicateConfidenceMargin) continue
      selected.push(best)
    }
    return selected
  }

  private expirePending(gameTimeMs: number) {
    for (const [participantKey, candidate] of this.pendingInitial) {
      const latest = candidate.observations.at(-1)
      if (!latest || gameTimeMs - latest.gameTimeMs > this.options.maximumConfirmationGapMs) {
        this.pendingInitial.delete(participantKey)
      }
    }
    for (const track of this.tracks.values()) {
      const latest = track.pendingRelocation?.observations.at(-1)
      if (latest && gameTimeMs - latest.gameTimeMs > this.options.maximumConfirmationGapMs) {
        track.pendingRelocation = undefined
      }
    }
  }
}
