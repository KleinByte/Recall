import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { nativeImage } from "electron"
import type {
  CampStateObservation,
  ChampionPositionObservation,
  MinimapCalibration,
  RgbaFrame,
} from "../../../src/shared/minimap/contracts.js"
import { clamp } from "../../../src/shared/minimap/contracts.js"
import type { ChampionMarkerProposalFootprint } from "./champion-marker-detector.js"

export interface MinimapDebugSample {
  gameTimeMs: number
  calibration: MinimapCalibration
  markerProposals: readonly ChampionMarkerProposalFootprint[]
  detections: ChampionPositionObservation[]
  confirmed: ChampionPositionObservation[]
  campStates: CampStateObservation[]
}

export interface MinimapDebugSamplerOptions {
  intervalMs: number
  maximumSamples: number
}

const DEFAULT_OPTIONS: MinimapDebugSamplerOptions = {
  intervalMs: 5_000,
  maximumSamples: 240,
}

function bgraBuffer(frame: RgbaFrame) {
  const bitmap = Buffer.allocUnsafe(frame.data.length)
  for (let offset = 0; offset < frame.data.length; offset += 4) {
    bitmap[offset] = frame.data[offset + 2]
    bitmap[offset + 1] = frame.data[offset + 1]
    bitmap[offset + 2] = frame.data[offset]
    bitmap[offset + 3] = frame.data[offset + 3]
  }
  return bitmap
}

export function encodeMinimapDebugPng(frame: RgbaFrame) {
  const image = nativeImage.createFromBitmap(bgraBuffer(frame), {
    width: frame.width,
    height: frame.height,
  })
  if (image.isEmpty()) throw new Error("minimap_debug_png_encode_failed")
  return image.toPNG()
}

function drawCircle(
  frame: RgbaFrame,
  position: { x: number; y: number },
  color: readonly [number, number, number],
  radius: number,
  thickness: number,
) {
  const centerX = clamp(position.x) * (frame.width - 1)
  const centerY = clamp(position.y) * (frame.height - 1)
  const minimumX = Math.max(0, Math.floor(centerX - radius - thickness))
  const maximumX = Math.min(frame.width - 1, Math.ceil(centerX + radius + thickness))
  const minimumY = Math.max(0, Math.floor(centerY - radius - thickness))
  const maximumY = Math.min(frame.height - 1, Math.ceil(centerY + radius + thickness))
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY)
      if (Math.abs(distance - radius) > thickness) continue
      const offset = (y * frame.width + x) * 4
      frame.data[offset] = color[0]
      frame.data[offset + 1] = color[1]
      frame.data[offset + 2] = color[2]
      frame.data[offset + 3] = 255
    }
  }
}

function detectionOverlay(
  frame: RgbaFrame,
  markerProposals: readonly ChampionMarkerProposalFootprint[],
  detections: ChampionPositionObservation[],
  confirmed: ChampionPositionObservation[],
) {
  const overlay: RgbaFrame = { ...frame, data: frame.data.slice() }
  const markerRadius = Math.max(5, Math.round(Math.min(frame.width, frame.height) * 0.035))
  for (const proposal of markerProposals) {
    drawCircle(
      overlay,
      proposal.center,
      [255, 190, 45],
      Math.max(3, proposal.radius * Math.min(frame.width, frame.height)),
      1,
    )
  }
  for (const observation of detections) {
    drawCircle(
      overlay,
      observation.position,
      observation.team === "ally" ? [50, 180, 255] : [255, 75, 75],
      markerRadius,
      1,
    )
  }
  for (const observation of confirmed) {
    drawCircle(
      overlay,
      observation.position,
      observation.continuity === "relocation" ? [255, 210, 40] : [80, 255, 130],
      markerRadius + 3,
      1.5,
    )
  }
  return overlay
}

/**
 * Opt-in, bounded evidence for tuning normal-match CV. Only the canonical
 * minimap crop is written; the full captured game frame never reaches disk.
 */
export class MinimapDebugSampler {
  private readonly options: MinimapDebugSamplerOptions
  private directory?: string
  private lastSampleAtMs = Number.NEGATIVE_INFINITY
  private sampleCount = 0
  private pending: Promise<void> = Promise.resolve()
  private lastError?: string

  constructor(
    private readonly rootDirectory: string,
    options: Partial<MinimapDebugSamplerOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  start(gameId: number) {
    this.directory = path.join(this.rootDirectory, `${gameId}-${Date.now()}`)
    this.lastSampleAtMs = Number.NEGATIVE_INFINITY
    this.sampleCount = 0
    this.lastError = undefined
    const directory = this.directory
    this.pending = mkdir(directory, { recursive: true }).then(() => undefined)
  }

  sample(frame: RgbaFrame, sample: MinimapDebugSample) {
    const directory = this.directory
    if (!directory || this.sampleCount >= this.options.maximumSamples ||
        sample.gameTimeMs - this.lastSampleAtMs < this.options.intervalMs) return
    this.lastSampleAtMs = sample.gameTimeMs
    this.sampleCount += 1
    const index = this.sampleCount.toString().padStart(4, "0")
    const time = Math.max(0, Math.round(sample.gameTimeMs)).toString().padStart(8, "0")
    const base = `${index}-${time}`
    const overlay = detectionOverlay(
      frame,
      sample.markerProposals,
      sample.detections,
      sample.confirmed,
    )
    const metadata = {
      gameTimeMs: sample.gameTimeMs,
      frameSequence: frame.frameSequence,
      calibration: sample.calibration,
      markerProposals: sample.markerProposals,
      detections: sample.detections,
      confirmed: sample.confirmed,
      campStates: sample.campStates,
    }
    this.pending = this.pending.then(async () => {
      await Promise.all([
        writeFile(path.join(directory, `${base}.png`), encodeMinimapDebugPng(frame)),
        writeFile(path.join(directory, `${base}.overlay.png`), encodeMinimapDebugPng(overlay)),
        writeFile(path.join(directory, `${base}.json`), JSON.stringify(metadata, null, 2), "utf8"),
      ])
    }).catch((error) => {
      this.lastError = error instanceof Error ? error.message : "minimap_debug_write_failed"
    })
  }

  async finish() {
    await this.pending
    this.directory = undefined
  }

  getHealth() {
    return {
      directory: this.directory,
      sampleCount: this.sampleCount,
      lastError: this.lastError,
    }
  }
}
