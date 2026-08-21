import type {
  ChampionTemplateDescriptor,
  ChampionVisionTeam,
  NormalizedPoint,
  RgbaFrame,
} from "../../../src/shared/minimap/contracts.js"

export const CHAMPION_MARKER_DETECTOR_VERSION = 4

/** Raw roster portrait. Pixel preprocessing is owned by the OpenCV worker. */
export interface ChampionMarkerTemplate extends ChampionTemplateDescriptor {
  width: number
  height: number
  rgba: Uint8Array
}

export interface RingColorPrototype {
  /** OpenCV HSV hue expressed in degrees for readability (0..360). */
  hsv: { h: number; s: number; v: number }
  tolerance: { hue: number; saturation: number; value: number }
}

export interface TeamRingColorModel {
  ally: RingColorPrototype[]
  enemy: RingColorPrototype[]
}

export interface ChampionMarkerProposalFootprint {
  readonly team: ChampionVisionTeam
  readonly center: Readonly<NormalizedPoint>
  readonly radius: number
  readonly ringConfidence: number
  readonly diameterPx?: number
  readonly aspectRatio?: number
  readonly fillRatio?: number
  readonly proposalSource?: "component" | "hough_circle"
  readonly ringSupport?: number
  readonly ringSectors?: number
  identityCandidate?: string
  identityScore?: number
  identityMargin?: number
  identityAccepted?: boolean
}

export const DEFAULT_RING_COLOR_MODEL: TeamRingColorModel = {
  ally: [
    { hsv: { h: 195, s: 0.82, v: 0.92 }, tolerance: { hue: 34, saturation: 0.55, value: 0.5 } },
    { hsv: { h: 128, s: 0.72, v: 0.9 }, tolerance: { hue: 28, saturation: 0.5, value: 0.48 } },
  ],
  enemy: [
    { hsv: { h: 2, s: 0.86, v: 0.92 }, tolerance: { hue: 30, saturation: 0.55, value: 0.5 } },
    { hsv: { h: 345, s: 0.8, v: 0.92 }, tolerance: { hue: 28, saturation: 0.55, value: 0.5 } },
  ],
}

/** Keeps template decoding in Electron/nativeImage and moves all CV work to the worker. */
export function createChampionMarkerTemplate(
  descriptor: ChampionTemplateDescriptor,
  icon: RgbaFrame,
): ChampionMarkerTemplate {
  if (!Number.isSafeInteger(icon.width) || icon.width <= 0 ||
      !Number.isSafeInteger(icon.height) || icon.height <= 0 ||
      icon.data.length !== icon.width * icon.height * 4) {
    throw new Error("invalid_champion_template_frame")
  }
  return {
    ...descriptor,
    width: icon.width,
    height: icon.height,
    rgba: icon.data.slice(),
  }
}

export interface RosterIdentityAssignment {
  proposalIndex: number
  templateIndex: number
  score: number
  margin: number
}

interface AssignmentState {
  utility: number
  assignments: Array<Omit<RosterIdentityAssignment, "margin">>
}

interface AssignmentSolution {
  mask: number
  state: AssignmentState
  states: Map<number, AssignmentState>
}

function shouldReplaceState(candidate: AssignmentState, current?: AssignmentState) {
  if (!current) return true
  if (candidate.utility > current.utility + 1e-12) return true
  if (Math.abs(candidate.utility - current.utility) > 1e-12) return false
  const key = (state: AssignmentState) => state.assignments
    .map(({ proposalIndex, templateIndex }) => `${proposalIndex}:${templateIndex}`)
    .join("|")
  return key(candidate) < key(current)
}

function assignmentEdge(proposalIndex: number, templateIndex: number) {
  return `${proposalIndex}:${templateIndex}`
}

function solveRosterAssignment(
  scoreMatrix: ReadonlyArray<ReadonlyArray<number>>,
  minimumScore: number,
  forbiddenEdges = new Set<string>(),
): AssignmentSolution {
  const templateCount = scoreMatrix[0]?.length ?? 0
  let states = new Map<number, AssignmentState>([[0, { utility: 0, assignments: [] }]])
  for (let proposalIndex = 0; proposalIndex < scoreMatrix.length; proposalIndex += 1) {
    const next = new Map(states)
    for (const [mask, state] of states) {
      for (let templateIndex = 0; templateIndex < templateCount; templateIndex += 1) {
        const bit = 1 << templateIndex
        if (mask & bit || forbiddenEdges.has(assignmentEdge(proposalIndex, templateIndex))) continue
        const score = scoreMatrix[proposalIndex][templateIndex]
        if (!Number.isFinite(score) || score < minimumScore) continue
        const candidate: AssignmentState = {
          utility: state.utility + Math.max(0, score - minimumScore),
          assignments: [...state.assignments, { proposalIndex, templateIndex, score }],
        }
        const nextMask = mask | bit
        if (shouldReplaceState(candidate, next.get(nextMask))) next.set(nextMask, candidate)
      }
    }
    states = next
  }
  let mask = 0
  let state = states.get(0)!
  for (const [candidateMask, candidate] of states) {
    if (shouldReplaceState(candidate, state)) {
      mask = candidateMask
      state = candidate
    }
  }
  return { mask, state, states }
}

/** Maximum-evidence one-to-one proposal/roster assignment with explicit abstention. */
export function assignRosterIdentities(
  scoreMatrix: ReadonlyArray<ReadonlyArray<number>>,
  minimumScore: number,
  minimumMargin: number,
): RosterIdentityAssignment[] {
  const templateCount = scoreMatrix[0]?.length ?? 0
  if (templateCount === 0 || scoreMatrix.length === 0) return []
  if (templateCount > 20 || scoreMatrix.some((row) => row.length !== templateCount)) {
    throw new Error("invalid_champion_identity_score_matrix")
  }
  const best = solveRosterAssignment(scoreMatrix, minimumScore)
  if (best.mask === 0) return []
  return best.state.assignments.flatMap((assignment) => {
    const bit = 1 << assignment.templateIndex
    let bestWithoutIdentity = 0
    for (const [mask, state] of best.states) {
      if (!(mask & bit)) bestWithoutIdentity = Math.max(bestWithoutIdentity, state.utility)
    }
    const noMatchMargin = Math.max(0, best.state.utility - bestWithoutIdentity)
    const forbidden = new Set([assignmentEdge(assignment.proposalIndex, assignment.templateIndex)])
    const alternative = solveRosterAssignment(scoreMatrix, minimumScore, forbidden)
    const mappingMargin = Math.max(0, best.state.utility - alternative.state.utility)
    const margin = Math.min(noMatchMargin, mappingMargin)
    return margin + 1e-12 >= minimumMargin ? [{ ...assignment, margin }] : []
  })
}
