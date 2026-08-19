import type {
  ChampionPositionObservation,
  ChampionTemplateDescriptor,
  ChampionVisionTeam,
  NormalizedPoint,
  RgbaFrame,
} from "../../../src/shared/minimap/contracts.js"
import { clamp, normalizedPoint } from "../../../src/shared/minimap/contracts.js"
import {
  circularInteriorGray,
  cropFrame,
  hsvSimilarity,
  normalizedCorrelation,
  resizeFrameBilinear,
  rgbToHsv,
  type HsvPixel,
} from "./image-ops.js"

export const CHAMPION_MARKER_DETECTOR_VERSION = 2

export interface ChampionMarkerTemplate extends ChampionTemplateDescriptor {
  width: number
  height: number
  interiorGray: Float32Array
}

export interface RingColorPrototype {
  hsv: HsvPixel
  tolerance: { hue: number; saturation: number; value: number }
}

export interface TeamRingColorModel {
  ally: RingColorPrototype[]
  enemy: RingColorPrototype[]
}

/**
 * Identity-free evidence that a geometry- and ring-qualified champion marker
 * occupies part of the current minimap frame. Consumers may use this to avoid
 * interpreting the covered pixels, but must not treat it as a roster match.
 */
export interface ChampionMarkerProposalFootprint {
  readonly team: ChampionVisionTeam
  readonly center: Readonly<NormalizedPoint>
  /** Bounding-circle radius in normalized minimap coordinates. */
  readonly radius: number
  readonly ringConfidence: number
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

export interface ChampionMarkerDetectorOptions {
  minimumDiameter: number
  maximumDiameter: number
  minimumRingPixels: number
  minimumRingScore: number
  minimumRingSaturation: number
  minimumTeamColorMargin: number
  /** A correlation of zero maps to 0.5, so this must stay meaningfully above 0.5. */
  minimumIdentityScore: number
  /** Minimum roster-wide evidence above choosing no identity for a participant. */
  minimumIdentityMargin: number
}

const DEFAULT_OPTIONS: ChampionMarkerDetectorOptions = {
  minimumDiameter: 9,
  maximumDiameter: 36,
  minimumRingPixels: 20,
  minimumRingScore: 0.55,
  minimumRingSaturation: 0.32,
  minimumTeamColorMargin: 0.05,
  minimumIdentityScore: 0.72,
  minimumIdentityMargin: 0.06,
}

const MAX_RETAINED_PROPOSAL_FOOTPRINTS = 32
const EMPTY_PROPOSAL_FOOTPRINTS: readonly ChampionMarkerProposalFootprint[] =
  Object.freeze([])

interface Component {
  pixels: number[]
  minX: number
  minY: number
  maxX: number
  maxY: number
  colorScore: number
}

interface MarkerProposal {
  team: ChampionVisionTeam
  centerX: number
  centerY: number
  portrait: RgbaFrame
  ringConfidence: number
  positionConfidence: number
}

export interface RosterIdentityAssignment {
  proposalIndex: number
  templateIndex: number
  score: number
  /** Evidence contributed by this roster identity over the best solution without it. */
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

function bestColorScore(
  pixel: HsvPixel,
  prototypes: RingColorPrototype[],
) {
  let best = 0
  for (const prototype of prototypes) {
    best = Math.max(best, hsvSimilarity(pixel, prototype.hsv, prototype.tolerance))
  }
  return best
}

export function createChampionMarkerTemplate(
  descriptor: ChampionTemplateDescriptor,
  icon: RgbaFrame,
  size = 24,
): ChampionMarkerTemplate {
  const normalized = resizeFrameBilinear(icon, size, size)
  return {
    ...descriptor,
    width: normalized.width,
    height: normalized.height,
    interiorGray: circularInteriorGray(normalized, 0.78),
  }
}

function components(
  width: number,
  height: number,
  mask: Uint8Array,
  scores: Float32Array,
): Component[] {
  const seen = new Uint8Array(mask.length)
  const result: Component[] = []
  const queue = new Int32Array(mask.length)
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue
    let read = 0
    let write = 0
    queue[write++] = start
    seen[start] = 1
    const found: number[] = []
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    let colorScore = 0
    while (read < write) {
      const index = queue[read++]
      found.push(index)
      const x = index % width
      const y = Math.floor(index / width)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      colorScore += scores[index]
      // Portraits and anti-aliasing can interrupt a ring by one pixel.
      for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue
          const nextX = x + offsetX
          const nextY = y + offsetY
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue
          const next = nextY * width + nextX
          if (!mask[next] || seen[next]) continue
          seen[next] = 1
          queue[write++] = next
        }
      }
    }
    result.push({
      pixels: found,
      minX,
      minY,
      maxX,
      maxY,
      colorScore: colorScore / found.length,
    })
  }
  return result
}

function identityScore(candidate: RgbaFrame, template: ChampionMarkerTemplate) {
  const resized = resizeFrameBilinear(candidate, template.width, template.height)
  const candidateGray = circularInteriorGray(resized, 0.78)
  return (normalizedCorrelation(candidateGray, template.interiorGray) + 1) / 2
}

function shouldReplaceState(candidate: AssignmentState, current?: AssignmentState) {
  if (!current) return true
  if (candidate.utility > current.utility + 1e-12) return true
  if (Math.abs(candidate.utility - current.utility) > 1e-12) return false
  const candidateKey = candidate.assignments
    .map(({ proposalIndex, templateIndex }) => `${proposalIndex}:${templateIndex}`)
    .join("|")
  const currentKey = current.assignments
    .map(({ proposalIndex, templateIndex }) => `${proposalIndex}:${templateIndex}`)
    .join("|")
  return candidateKey < currentKey
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
        if (mask & bit ||
            forbiddenEdges.has(assignmentEdge(proposalIndex, templateIndex))) continue
        const score = scoreMatrix[proposalIndex][templateIndex]
        if (!Number.isFinite(score) || score < minimumScore) continue
        const candidate: AssignmentState = {
          utility: state.utility + Math.max(0, score - minimumScore),
          assignments: [
            ...state.assignments,
            { proposalIndex, templateIndex, score },
          ],
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

/**
 * Finds the maximum-evidence one-to-one proposal/roster assignment. Scores at
 * the threshold have zero utility, which makes abstaining an explicit option.
 */
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

    const forbiddenEdges = new Set([assignmentEdge(
      assignment.proposalIndex,
      assignment.templateIndex,
    )])
    const alternative = solveRosterAssignment(scoreMatrix, minimumScore, forbiddenEdges)
    const mappingMargin = Math.max(0, best.state.utility - alternative.state.utility)
    const margin = Math.min(noMatchMargin, mappingMargin)
    return margin + 1e-12 >= minimumMargin
      ? [{ ...assignment, margin }]
      : []
  })
}

function uniqueTeamTemplates(
  templates: ChampionMarkerTemplate[],
  team: ChampionVisionTeam,
) {
  const participantKeys = new Set<string>()
  return templates.filter((template) => {
    if (template.team !== team || participantKeys.has(template.participantKey)) return false
    participantKeys.add(template.participantKey)
    return true
  })
}

/**
 * Generates independent ally/enemy marker proposals, then identifies them
 * against only the ten champion portraits active in the current match.
 */
export class ChampionMarkerDetector {
  private readonly options: ChampionMarkerDetectorOptions
  private proposalFootprints = EMPTY_PROPOSAL_FOOTPRINTS

  constructor(
    private readonly colors: TeamRingColorModel = DEFAULT_RING_COLOR_MODEL,
    options: Partial<ChampionMarkerDetectorOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /** A bounded, read-only snapshot produced by the most recent detect call. */
  getProposalFootprints(): readonly ChampionMarkerProposalFootprint[] {
    return this.proposalFootprints
  }

  detect(input: {
    frame: RgbaFrame
    templates: ChampionMarkerTemplate[]
    gameId: number
    gameTimeMs: number
  }): ChampionPositionObservation[] {
    // Never let a failed, empty, or template-less frame reuse prior occlusion.
    this.proposalFootprints = EMPTY_PROPOSAL_FOOTPRINTS
    const { frame } = input
    const pixelCount = frame.width * frame.height
    const allyMask = new Uint8Array(pixelCount)
    const enemyMask = new Uint8Array(pixelCount)
    const allyScores = new Float32Array(pixelCount)
    const enemyScores = new Float32Array(pixelCount)
    for (let index = 0; index < pixelCount; index += 1) {
      const source = index * 4
      const pixel = rgbToHsv(
        frame.data[source],
        frame.data[source + 1],
        frame.data[source + 2],
      )
      const chromatic = pixel.s >= this.options.minimumRingSaturation
      const ally = chromatic ? bestColorScore(pixel, this.colors.ally) : 0
      const enemy = chromatic ? bestColorScore(pixel, this.colors.enemy) : 0
      allyScores[index] = ally
      enemyScores[index] = enemy
      if (ally >= this.options.minimumRingScore &&
          ally - enemy >= this.options.minimumTeamColorMargin) allyMask[index] = 1
      if (enemy >= this.options.minimumRingScore &&
          enemy - ally >= this.options.minimumTeamColorMargin) enemyMask[index] = 1
    }

    const proposals: Record<ChampionVisionTeam, MarkerProposal[]> = {
      ally: [],
      enemy: [],
    }
    const proposalFootprints: ChampionMarkerProposalFootprint[] = []
    for (const [team, mask, scores] of [
      ["ally", allyMask, allyScores],
      ["enemy", enemyMask, enemyScores],
    ] as const) {
      const teamComponents = components(frame.width, frame.height, mask, scores)
      for (const component of teamComponents) {
        const width = component.maxX - component.minX + 1
        const height = component.maxY - component.minY + 1
        const diameter = Math.max(width, height)
        if (diameter < this.options.minimumDiameter ||
            diameter > this.options.maximumDiameter ||
            component.pixels.length < this.options.minimumRingPixels) continue
        const aspect = Math.min(width, height) / Math.max(width, height)
        const fill = component.pixels.length / (width * height)
        if (aspect < 0.62 || fill < 0.12 || fill > 0.82) continue
        const padding = Math.max(1, Math.round(diameter * 0.12))
        const portrait = cropFrame(frame, {
          x: component.minX + padding,
          y: component.minY + padding,
          width: Math.max(1, width - padding * 2),
          height: Math.max(1, height - padding * 2),
        })
        const ringConfidence = clamp(component.colorScore)
        const center = normalizedPoint(
          (component.minX + component.maxX) / 2 / Math.max(1, frame.width - 1),
          (component.minY + component.maxY) / 2 / Math.max(1, frame.height - 1),
        )
        const radius = clamp(Math.max(
          width / Math.max(1, frame.width - 1),
          height / Math.max(1, frame.height - 1),
        ) / 2)
        proposals[team].push({
          team,
          centerX: (component.minX + component.maxX) / 2,
          centerY: (component.minY + component.maxY) / 2,
          portrait,
          ringConfidence,
          positionConfidence: clamp(ringConfidence * aspect),
        })
        proposalFootprints.push({
          team,
          center,
          radius,
          ringConfidence,
        })
      }
    }

    this.proposalFootprints = Object.freeze(proposalFootprints
      .sort((left, right) =>
        right.ringConfidence - left.ringConfidence ||
        left.team.localeCompare(right.team) ||
        left.center.y - right.center.y ||
        left.center.x - right.center.x)
      .slice(0, MAX_RETAINED_PROPOSAL_FOOTPRINTS)
      .map((proposal) => Object.freeze({
        ...proposal,
        center: Object.freeze({ ...proposal.center }),
      })))

    const observations: ChampionPositionObservation[] = []
    for (const team of ["ally", "enemy"] as const) {
      const teamProposals = proposals[team]
      const teamTemplates = uniqueTeamTemplates(input.templates, team)
      if (teamProposals.length === 0 || teamTemplates.length === 0) continue
      const scoreMatrix = teamProposals.map((proposal) =>
        teamTemplates.map((template) => identityScore(proposal.portrait, template)))
      const assignments = assignRosterIdentities(
        scoreMatrix,
        this.options.minimumIdentityScore,
        this.options.minimumIdentityMargin,
      )
      for (const assignment of assignments) {
        const proposal = teamProposals[assignment.proposalIndex]
        const template = teamTemplates[assignment.templateIndex]
        const evidenceAboveNoMatch = clamp(
          (assignment.score - this.options.minimumIdentityScore) /
          Math.max(0.001, 1 - this.options.minimumIdentityScore),
        )
        const marginConfidence = clamp(
          assignment.margin / Math.max(0.001, this.options.minimumIdentityMargin),
        )
        observations.push({
          gameId: input.gameId,
          participantKey: template.participantKey,
          championName: template.championName,
          team,
          isLocal: template.isLocal,
          gameTimeMs: input.gameTimeMs,
          position: normalizedPoint(
            proposal.centerX / Math.max(1, frame.width - 1),
            proposal.centerY / Math.max(1, frame.height - 1),
          ),
          source: "minimap_cv",
          identityConfidence: clamp(
            assignment.score * 0.65 + evidenceAboveNoMatch * 0.25 + marginConfidence * 0.1,
          ),
          positionConfidence: proposal.positionConfidence,
          frameSequence: frame.frameSequence,
          detectorVersion: CHAMPION_MARKER_DETECTOR_VERSION,
        })
      }
    }

    return observations.sort((left, right) =>
      left.participantKey.localeCompare(right.participantKey))
  }
}
