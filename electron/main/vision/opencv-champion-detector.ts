import type { ChampionPositionObservation, ChampionVisionTeam, RgbaFrame } from "../../../src/shared/minimap/contracts.js"
import { clamp, normalizedPoint } from "../../../src/shared/minimap/contracts.js"
import {
  assignRosterIdentities,
  CHAMPION_MARKER_DETECTOR_VERSION,
  DEFAULT_RING_COLOR_MODEL,
  type ChampionMarkerProposalFootprint,
  type ChampionMarkerTemplate,
  type RingColorPrototype,
  type TeamRingColorModel,
} from "../minimap/champion-marker-detector.js"
import { frameToMat, safeDelete, type OpenCv } from "./opencv-runtime.js"

interface OpenCvChampionDetectorOptions {
  minimumDiameter: number
  maximumDiameter: number
  minimumRingPixels: number
  minimumRingSaturation: number
  minimumIdentityScore: number
  minimumIdentityMargin: number
  houghIntervalFrames: number
}

const DEFAULT_OPTIONS: OpenCvChampionDetectorOptions = {
  minimumDiameter: 18,
  maximumDiameter: 48,
  minimumRingPixels: 20,
  minimumRingSaturation: 0.32,
  minimumIdentityScore: 0.72,
  minimumIdentityMargin: 0.06,
  houghIntervalFrames: 2,
}
const MAX_RETAINED_PROPOSALS = 32
const TEMPLATE_SIZE = 24
const PORTRAIT_SAMPLE_POINTS = (() => {
  const center = (TEMPLATE_SIZE - 1) / 2
  const radiusSquared = (TEMPLATE_SIZE * 0.35) ** 2
  const points: Array<readonly [number, number]> = []
  for (let y = 0; y < TEMPLATE_SIZE; y += 1) {
    for (let x = 0; x < TEMPLATE_SIZE; x += 1) {
      if ((x - center) ** 2 + (y - center) ** 2 <= radiusSquared) points.push([x, y])
    }
  }
  return points
})()

interface PreparedTemplate {
  source: ChampionMarkerTemplate
  gray: Uint8Array
}
interface MarkerProposal {
  team: ChampionVisionTeam
  centerX: number
  centerY: number
  portraitGray: Uint8Array
  ringConfidence: number
  positionConfidence: number
  footprint: ChampionMarkerProposalFootprint
}

interface HsvBounds {
  lower: any
  upper: any
}

interface RingRangeCache {
  rows: number
  cols: number
  type: number
  kernel: any
  ally: HsvBounds[]
  enemy: HsvBounds[]
}

function hsvRange(prototype: RingColorPrototype) {
  const centerH = (prototype.hsv.h % 360) / 2
  const hueTol = prototype.tolerance.hue / 2
  const centerS = prototype.hsv.s * 255
  const centerV = prototype.hsv.v * 255
  return {
    centerH,
    hueTol,
    lowS: Math.max(0, centerS - prototype.tolerance.saturation * 255),
    highS: Math.min(255, centerS + prototype.tolerance.saturation * 255),
    lowV: Math.max(0, centerV - prototype.tolerance.value * 255),
    highV: Math.min(255, centerV + prototype.tolerance.value * 255),
  }
}

function buildHsvBounds(
  cv: OpenCv,
  rows: number,
  cols: number,
  type: number,
  prototypes: RingColorPrototype[],
  minimumSaturation: number,
) {
  const bounds: HsvBounds[] = []
  for (const prototype of prototypes) {
    const range = hsvRange(prototype)
    const intervals: Array<[number, number]> = []
    const low = range.centerH - range.hueTol
    const high = range.centerH + range.hueTol
    if (low < 0) intervals.push([0, high], [180 + low, 179])
    else if (high > 179) intervals.push([low, 179], [0, high - 180])
    else intervals.push([low, high])
    for (const [lowH, highH] of intervals) {
      bounds.push({
        lower: new cv.Mat(rows, cols, type, new cv.Scalar(
          Math.max(0, lowH), Math.max(minimumSaturation * 255, range.lowS), range.lowV, 0,
        )),
        upper: new cv.Mat(rows, cols, type, new cv.Scalar(
          Math.min(179, highH), range.highS, range.highV, 255,
        )),
      })
    }
  }
  return bounds
}

function orInRange(cv: OpenCv, hsv: any, bounds: HsvBounds[], kernel: any) {
  const combined = cv.Mat.zeros(hsv.rows, hsv.cols, cv.CV_8UC1)
  const mask = new cv.Mat()
  try {
    for (const range of bounds) {
      cv.inRange(hsv, range.lower, range.upper, mask)
      cv.bitwise_or(combined, mask, combined)
    }
  } finally {
    mask.delete()
  }
  cv.morphologyEx(combined, combined, cv.MORPH_CLOSE, kernel)
  return combined
}

function preparedPortrait(cv: OpenCv, rgba: any) {
  const resized = new cv.Mat()
  const gray = new cv.Mat()
  try {
    cv.resize(rgba, resized, new cv.Size(TEMPLATE_SIZE, TEMPLATE_SIZE), 0, 0, cv.INTER_LINEAR)
    cv.cvtColor(resized, gray, cv.COLOR_RGBA2GRAY)
    // Do not zero a shared circular mask into both images: its high-contrast
    // silhouette dominates normalized correlation and can make an unrelated,
    // flat portrait look like a confident roster match. The component crop
    // already excludes the team ring, so compare the complete portrait pixels.
    return Uint8Array.from(gray.data as Uint8Array)
  } finally { safeDelete(resized, gray) }
}

/**
 * Pearson correlation over portrait pixels only, allowing a tiny alignment
 * offset. This retains the useful circular center crop without writing a
 * shared black mask into both Mats (which previously dominated the score).
 */
function portraitCorrelation(left: Uint8Array, right: Uint8Array) {
  if (left.length !== TEMPLATE_SIZE * TEMPLATE_SIZE || right.length !== left.length) return -1
  let best = -1
  for (let shiftY = -2; shiftY <= 2; shiftY += 1) {
    for (let shiftX = -2; shiftX <= 2; shiftX += 1) {
      let count = 0
      let leftSum = 0
      let rightSum = 0
      let leftSquared = 0
      let rightSquared = 0
      let product = 0
      for (const [x, y] of PORTRAIT_SAMPLE_POINTS) {
        const shiftedY = y + shiftY
        if (shiftedY < 0 || shiftedY >= TEMPLATE_SIZE) continue
        const shiftedX = x + shiftX
        if (shiftedX < 0 || shiftedX >= TEMPLATE_SIZE) continue
        const leftValue = left[shiftedY * TEMPLATE_SIZE + shiftedX]
        const rightValue = right[y * TEMPLATE_SIZE + x]
        count += 1
        leftSum += leftValue
        rightSum += rightValue
        leftSquared += leftValue * leftValue
        rightSquared += rightValue * rightValue
        product += leftValue * rightValue
      }
      const numerator = count * product - leftSum * rightSum
      const denominator = Math.sqrt(
        Math.max(0, count * leftSquared - leftSum * leftSum) *
        Math.max(0, count * rightSquared - rightSum * rightSum),
      )
      if (denominator <= 1e-9) continue
      best = Math.max(best, numerator / denominator)
    }
  }
  return clamp(best, -1, 1)
}

function circleRingSupport(mask: any, centerX: number, centerY: number, radius: number) {
  let sampled = 0
  let present = 0
  const sectors = new Set<number>()
  const outer = radius * 1.18
  const inner = radius * 0.72
  for (let y = Math.max(0, Math.floor(centerY - outer));
    y <= Math.min(mask.rows - 1, Math.ceil(centerY + outer)); y += 1) {
    for (let x = Math.max(0, Math.floor(centerX - outer));
      x <= Math.min(mask.cols - 1, Math.ceil(centerX + outer)); x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY)
      if (distance < inner || distance > outer) continue
      sampled += 1
      if (Number(mask.data[y * mask.cols + x]) === 0) continue
      present += 1
      const angle = Math.atan2(y - centerY, x - centerX) + Math.PI
      sectors.add(Math.min(7, Math.floor(angle / (Math.PI * 2) * 8)))
    }
  }
  return { support: sampled ? present / sampled : 0, sectors: sectors.size }
}

export class OpenCvChampionDetector {
  private readonly options: OpenCvChampionDetectorOptions
  private readonly prepared = new Map<string, PreparedTemplate>()
  private detectionCount = 0
  private ringRangeCache?: RingRangeCache

  constructor(
    private readonly cv: OpenCv,
    private readonly colors: TeamRingColorModel = DEFAULT_RING_COLOR_MODEL,
    options: Partial<OpenCvChampionDetectorOptions> = {},
  ) { this.options = { ...DEFAULT_OPTIONS, ...options } }

  setTemplates(templates: ChampionMarkerTemplate[]) {
    this.clearTemplates()
    for (const template of templates) {
      if (template.rgba.length !== template.width * template.height * 4) continue
      const frame: RgbaFrame = {
        width: template.width,
        height: template.height,
        data: template.rgba,
        capturedMonotonicMs: 0,
        frameSequence: 0,
      }
      const rgba = frameToMat(this.cv, frame)
      try {
        this.prepared.set(template.participantKey, {
          source: template,
          gray: preparedPortrait(this.cv, rgba),
        })
      } finally { rgba.delete() }
    }
  }

  clearTemplates() {
    this.prepared.clear()
    this.detectionCount = 0
  }

  private ringRanges(hsv: any) {
    const type = Number(hsv.type())
    const cached = this.ringRangeCache
    if (cached && cached.rows === hsv.rows && cached.cols === hsv.cols && cached.type === type) {
      return cached
    }
    this.clearRingRangeCache()
    this.ringRangeCache = {
      rows: hsv.rows,
      cols: hsv.cols,
      type,
      kernel: this.cv.getStructuringElement(this.cv.MORPH_ELLIPSE, new this.cv.Size(3, 3)),
      ally: buildHsvBounds(
        this.cv,
        hsv.rows,
        hsv.cols,
        type,
        this.colors.ally,
        this.options.minimumRingSaturation,
      ),
      enemy: buildHsvBounds(
        this.cv,
        hsv.rows,
        hsv.cols,
        type,
        this.colors.enemy,
        this.options.minimumRingSaturation,
      ),
    }
    return this.ringRangeCache
  }

  private clearRingRangeCache() {
    const cached = this.ringRangeCache
    if (!cached) return
    safeDelete(cached.kernel)
    for (const range of [...cached.ally, ...cached.enemy]) safeDelete(range.lower, range.upper)
    this.ringRangeCache = undefined
  }

  detect(input: { frame: RgbaFrame; rgba?: any; gameId: number; gameTimeMs: number }): {
    observations: ChampionPositionObservation[]
    proposals: ChampionMarkerProposalFootprint[]
  } {
    const ownsRgba = !input.rgba
    const rgba = input.rgba ?? frameToMat(this.cv, input.frame)
    const rgb = new this.cv.Mat()
    const hsv = new this.cv.Mat()
    const interval = Math.max(1, Math.round(this.options.houghIntervalFrames))
    const houghDue = this.detectionCount % interval === 0
    this.detectionCount += 1
    try {
      this.cv.cvtColor(rgba, rgb, this.cv.COLOR_RGBA2RGB)
      this.cv.cvtColor(rgb, hsv, this.cv.COLOR_RGB2HSV)
      const ringRanges = this.ringRanges(hsv)
      const proposalsByTeam: Record<ChampionVisionTeam, MarkerProposal[]> = { ally: [], enemy: [] }
      const footprints: ChampionMarkerProposalFootprint[] = []
      const addProposal = (input: {
        team: ChampionVisionTeam
        centerX: number
        centerY: number
        diameter: number
        aspect: number
        fill: number
        ringConfidence: number
        source: "component" | "hough_circle"
        ringSupport?: number
        ringSectors?: number
      }) => {
        if (input.diameter < this.options.minimumDiameter ||
            input.diameter > this.options.maximumDiameter) return
        const existing = proposalsByTeam[input.team].some((proposal) =>
          Math.hypot(proposal.centerX - input.centerX, proposal.centerY - input.centerY) <=
            Math.max(4, Math.min(input.diameter, proposal.footprint.diameterPx ?? input.diameter) * 0.32))
        if (existing) return
        const portraitDiameter = Math.max(3, Math.round(input.diameter * 0.72))
        const rx = Math.max(0, Math.round(input.centerX - portraitDiameter / 2))
        const ry = Math.max(0, Math.round(input.centerY - portraitDiameter / 2))
        const rw = Math.min(portraitDiameter, rgba.cols - rx)
        const rh = Math.min(portraitDiameter, rgba.rows - ry)
        if (rw <= 2 || rh <= 2) return
        const roi = rgba.roi(new this.cv.Rect(rx, ry, rw, rh))
        let portraitGray: Uint8Array
        try { portraitGray = preparedPortrait(this.cv, roi) } finally { roi.delete() }
        const footprint: ChampionMarkerProposalFootprint = {
          team: input.team,
          center: normalizedPoint(
            input.centerX / Math.max(1, rgba.cols - 1),
            input.centerY / Math.max(1, rgba.rows - 1),
          ),
          radius: clamp(input.diameter / Math.max(1, rgba.cols - 1) / 2),
          ringConfidence: input.ringConfidence,
          diameterPx: input.diameter,
          aspectRatio: input.aspect,
          fillRatio: input.fill,
          proposalSource: input.source,
          ringSupport: input.ringSupport,
          ringSectors: input.ringSectors,
        }
        proposalsByTeam[input.team].push({
          team: input.team,
          centerX: input.centerX,
          centerY: input.centerY,
          portraitGray,
          ringConfidence: input.ringConfidence,
          positionConfidence: clamp(input.ringConfidence * input.aspect),
          footprint,
        })
        footprints.push(footprint)
      }
      for (const team of ["ally", "enemy"] as const) {
        const mask = orInRange(this.cv, hsv, ringRanges[team], ringRanges.kernel)
        const labels = new this.cv.Mat()
        const stats = new this.cv.Mat()
        const centroids = new this.cv.Mat()
        try {
          const count = Number(this.cv.connectedComponentsWithStats(
            mask, labels, stats, centroids, 8, this.cv.CV_32S,
          ))
          for (let label = 1; label < count; label += 1) {
            const width = Number(stats.intAt(label, this.cv.CC_STAT_WIDTH))
            const height = Number(stats.intAt(label, this.cv.CC_STAT_HEIGHT))
            const area = Number(stats.intAt(label, this.cv.CC_STAT_AREA))
            const diameter = Math.max(width, height)
            if (diameter < this.options.minimumDiameter || diameter > this.options.maximumDiameter ||
                area < this.options.minimumRingPixels) continue
            const aspect = Math.min(width, height) / Math.max(width, height)
            const fill = area / Math.max(1, width * height)
            if (aspect < 0.62 || fill < 0.1 || fill > 0.86) continue
            const centerX = Number(centroids.doubleAt(label, 0))
            const centerY = Number(centroids.doubleAt(label, 1))
            const ringConfidence = clamp(0.55 + Math.min(1, area / Math.max(1, diameter * 2.6)) * 0.45)
            addProposal({
              team,
              centerX,
              centerY,
              diameter,
              aspect,
              fill,
              ringConfidence,
              source: "component",
            })
          }
          if (houghDue) {
            const blurred = new this.cv.Mat()
            const circles = new this.cv.Mat()
            try {
              this.cv.GaussianBlur(mask, blurred, new this.cv.Size(3, 3), 0, 0, this.cv.BORDER_DEFAULT)
              this.cv.HoughCircles(
                blurred,
                circles,
                this.cv.HOUGH_GRADIENT,
                1,
                16,
                80,
                9,
                Math.ceil(this.options.minimumDiameter / 2),
                Math.floor(this.options.maximumDiameter / 2),
              )
              const values = circles.data32F as Float32Array
              for (let index = 0; index + 2 < values.length; index += 3) {
                const centerX = Number(values[index])
                const centerY = Number(values[index + 1])
                const radius = Number(values[index + 2])
                if (![centerX, centerY, radius].every(Number.isFinite)) continue
                const support = circleRingSupport(mask, centerX, centerY, radius)
                addProposal({
                  team,
                  centerX,
                  centerY,
                  diameter: radius * 2,
                  aspect: 1,
                  fill: 0.32,
                  ringConfidence: clamp(0.55 + support.support * 1.8 + support.sectors * 0.025),
                  source: "hough_circle",
                  ringSupport: support.support,
                  ringSectors: support.sectors,
                })
              }
            } finally { safeDelete(blurred, circles) }
          }
        } finally { safeDelete(mask, labels, stats, centroids) }
      }

      const observations: ChampionPositionObservation[] = []
      {
        for (const team of ["ally", "enemy"] as const) {
          const proposals = proposalsByTeam[team]
          const templates = [...this.prepared.values()].filter((entry) => entry.source.team === team)
          if (!proposals.length || !templates.length) continue
          const scores = proposals.map((proposal) => templates.map((template) =>
            (portraitCorrelation(proposal.portraitGray, template.gray) + 1) / 2))
          for (let proposalIndex = 0; proposalIndex < proposals.length; proposalIndex += 1) {
            const ranked = scores[proposalIndex]
              .map((score, templateIndex) => ({ score, templateIndex }))
              .sort((left, right) => right.score - left.score)
            const best = ranked[0]
            if (!best) continue
            proposals[proposalIndex].footprint.identityCandidate =
              templates[best.templateIndex].source.championName
            proposals[proposalIndex].footprint.identityScore = best.score
            proposals[proposalIndex].footprint.identityMargin = Math.max(
              0,
              best.score - (ranked[1]?.score ?? this.options.minimumIdentityScore),
            )
            proposals[proposalIndex].footprint.identityAccepted = false
          }
          const assignmentScores = scores.map((row, proposalIndex) => {
            const footprint = proposals[proposalIndex].footprint
            const cleanComponentBonus = footprint.proposalSource === "component" &&
                (footprint.diameterPx ?? 0) >= 27 &&
                (footprint.aspectRatio ?? 0) >= 0.8 &&
                (footprint.fillRatio ?? 0) >= 0.12 &&
                (footprint.fillRatio ?? 1) <= 0.65
              ? 0.035
              : 0
            return row.map((score) => clamp(score + cleanComponentBonus))
          })
          const assignments = assignRosterIdentities(
            assignmentScores,
            this.options.minimumIdentityScore,
            this.options.minimumIdentityMargin,
          )
          const localTemplateIndex = templates.findIndex((template) => template.source.isLocal)
          if (localTemplateIndex >= 0 &&
              !assignments.some((assignment) => assignment.templateIndex === localTemplateIndex)) {
            const occupiedProposals = new Set(assignments.map((assignment) => assignment.proposalIndex))
            const rankedLocal = proposals.flatMap((proposal, proposalIndex) => {
              if (occupiedProposals.has(proposalIndex)) return []
              const score = scores[proposalIndex][localTemplateIndex]
              const identityAlternative = Math.max(
                0,
                ...scores[proposalIndex].filter((_value, index) => index !== localTemplateIndex),
              )
              const footprint = proposal.footprint
              const strongRing = footprint.proposalSource === "component"
                ? (footprint.diameterPx ?? 0) >= 24 && (footprint.aspectRatio ?? 0) >= 0.78
                : (footprint.diameterPx ?? 0) >= 24 &&
                  (footprint.ringSectors ?? 0) >= 6 && (footprint.ringSupport ?? 0) >= 0.16
              return strongRing
                ? [{ proposalIndex, score, identityMargin: score - identityAlternative }]
                : []
            }).sort((left, right) => right.score - left.score)
            const bestLocal = rankedLocal[0]
            const locationMargin = bestLocal
              ? bestLocal.score - (rankedLocal[1]?.score ?? 0)
              : 0
            if (bestLocal && bestLocal.score >= 0.62 &&
                bestLocal.identityMargin >= 0.05 && locationMargin >= 0.05) {
              assignments.push({
                proposalIndex: bestLocal.proposalIndex,
                templateIndex: localTemplateIndex,
                score: bestLocal.score,
                margin: Math.min(bestLocal.identityMargin, locationMargin),
              })
            }
          }
          for (const assignment of assignments) {
            const proposal = proposals[assignment.proposalIndex]
            const template = templates[assignment.templateIndex].source
            const rawScore = scores[assignment.proposalIndex][assignment.templateIndex]
            proposal.footprint.identityCandidate = template.championName
            proposal.footprint.identityScore = rawScore
            proposal.footprint.identityMargin = assignment.margin
            proposal.footprint.identityAccepted = true
            const evidence = clamp((rawScore - this.options.minimumIdentityScore) /
              Math.max(0.001, 1 - this.options.minimumIdentityScore))
            const marginConfidence = clamp(assignment.margin / Math.max(0.001, this.options.minimumIdentityMargin))
            observations.push({
              gameId: input.gameId,
              participantKey: template.participantKey,
              championName: template.championName,
              team,
              isLocal: template.isLocal,
              gameTimeMs: input.gameTimeMs,
              position: normalizedPoint(
                proposal.centerX / Math.max(1, input.frame.width - 1),
                proposal.centerY / Math.max(1, input.frame.height - 1),
              ),
              source: "minimap_cv",
              identityConfidence: clamp(rawScore * 0.65 + evidence * 0.25 + marginConfidence * 0.1),
              positionConfidence: proposal.positionConfidence,
              frameSequence: input.frame.frameSequence,
              detectorVersion: CHAMPION_MARKER_DETECTOR_VERSION,
            })
          }
        }
      }
      const proposals = footprints.sort((a, b) => b.ringConfidence - a.ringConfidence ||
        a.team.localeCompare(b.team) || a.center.y - b.center.y || a.center.x - b.center.x)
        .slice(0, MAX_RETAINED_PROPOSALS)
      return { observations: observations.sort((a, b) => a.participantKey.localeCompare(b.participantKey)), proposals }
    } finally {
      safeDelete(rgb, hsv)
      if (ownsRgba) safeDelete(rgba)
    }
  }

  close() {
    this.clearTemplates()
    this.clearRingRangeCache()
  }
}
