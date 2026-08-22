import { createHash } from "node:crypto"
import { access, readFile } from "node:fs/promises"
import { availableParallelism } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as ort from "onnxruntime-node"
import type { RgbaFrame } from "../../../src/shared/minimap/contracts.js"
import type { ChampionMarkerTemplate } from "../minimap/champion-marker-detector.js"
import { championAssetKey } from "../minimap/champion-asset-key.js"

interface MinimapModelManifest {
  schemaVersion: number
  model: string
  revision: string
  artifactFile: string
  artifactSha256: string
  artifactBytes: number
  input: { name: string; shape: [number, number, number, number] }
  classCount: number
  labelsFile: string
}

export interface LearnedChampionDetection {
  championKey: string
  championName: string
  confidence: number
  centerX: number
  centerY: number
  width: number
  height: number
}

export interface LearnedChampionDetectionResult {
  detections: LearnedChampionDetection[]
  inferenceMs: number
}

export interface ChampionModelRuntimeStatus {
  available: boolean
  model?: string
  revision?: string
  inputSize?: number
  classCount?: number
  errorCode?: string
}

interface Candidate extends LearnedChampionDetection {
  classIndex: number
}

// The upstream model is highly confident for most champions, but the saved
// Garen match shows correct boxes in the 0.10-0.30 range. These low-confidence
// detections are proposals only: OpenCV portrait correlation remains the
// identity gate (see modelIdentityScore).
const DEFAULT_CONFIDENCE = 0.1
const DEFAULT_IOU = 0.45
const MAXIMUM_DETECTIONS = 20

function normalizedChampionKey(value: string) {
  return championAssetKey(value).toLowerCase()
}

function intersectionOverUnion(left: Candidate, right: Candidate) {
  const leftX1 = left.centerX - left.width / 2
  const leftY1 = left.centerY - left.height / 2
  const rightX1 = right.centerX - right.width / 2
  const rightY1 = right.centerY - right.height / 2
  const intersectionWidth = Math.max(
    0,
    Math.min(leftX1 + left.width, rightX1 + right.width) - Math.max(leftX1, rightX1),
  )
  const intersectionHeight = Math.max(
    0,
    Math.min(leftY1 + left.height, rightY1 + right.height) - Math.max(leftY1, rightY1),
  )
  const intersection = intersectionWidth * intersectionHeight
  const union = left.width * left.height + right.width * right.height - intersection
  return union > 0 ? intersection / union : 0
}

export function nonMaximumSuppression(
  candidates: Candidate[],
  threshold = DEFAULT_IOU,
) {
  const retained: Candidate[] = []
  for (const candidate of [...candidates].sort((left, right) =>
    right.confidence - left.confidence || left.classIndex - right.classIndex)) {
    if (retained.some((existing) =>
      existing.classIndex === candidate.classIndex &&
      intersectionOverUnion(existing, candidate) > threshold)) continue
    retained.push(candidate)
    if (retained.length >= MAXIMUM_DETECTIONS) break
  }
  return retained
}

/** Bilinear square resize directly into normalized RGB CHW tensor storage. */
export function championModelTensor(frame: RgbaFrame, size: number) {
  const output = new Float32Array(3 * size * size)
  const sourceMaxX = Math.max(0, frame.width - 1)
  const sourceMaxY = Math.max(0, frame.height - 1)
  for (let y = 0; y < size; y += 1) {
    const sourceY = size === 1 ? 0 : y * sourceMaxY / (size - 1)
    const y0 = Math.floor(sourceY)
    const y1 = Math.min(sourceMaxY, y0 + 1)
    const fy = sourceY - y0
    for (let x = 0; x < size; x += 1) {
      const sourceX = size === 1 ? 0 : x * sourceMaxX / (size - 1)
      const x0 = Math.floor(sourceX)
      const x1 = Math.min(sourceMaxX, x0 + 1)
      const fx = sourceX - x0
      const destination = y * size + x
      for (let channel = 0; channel < 3; channel += 1) {
        const topLeft = frame.data[(y0 * frame.width + x0) * 4 + channel]
        const topRight = frame.data[(y0 * frame.width + x1) * 4 + channel]
        const bottomLeft = frame.data[(y1 * frame.width + x0) * 4 + channel]
        const bottomRight = frame.data[(y1 * frame.width + x1) * 4 + channel]
        const top = topLeft + (topRight - topLeft) * fx
        const bottom = bottomLeft + (bottomRight - bottomLeft) * fx
        output[channel * size * size + destination] = (top + (bottom - top) * fy) / 255
      }
    }
  }
  return output
}

export function decodeYoloOutput(input: {
  data: Float32Array
  dimensions: readonly number[]
  labels: readonly string[]
  activeRoster: ReadonlyMap<string, string>
  inputSize: number
  minimumConfidence?: number
}) {
  const [, channels, anchors] = input.dimensions
  if (channels !== input.labels.length + 4 || anchors <= 0 ||
      input.data.length !== channels * anchors) {
    throw new Error(`minimap_model_output_invalid:${input.dimensions.join("x")}`)
  }
  const activeClasses = new Map(input.labels.flatMap((label, classIndex) => {
    const championKey = normalizedChampionKey(label)
    const championName = input.activeRoster.get(championKey)
    return championName ? [[classIndex, { classIndex, championKey, championName }] as const] : []
  }))
  const candidates: Candidate[] = []
  for (let anchor = 0; anchor < anchors; anchor += 1) {
    let bestClassIndex = -1
    let confidence = -1
    for (let classIndex = 0; classIndex < input.labels.length; classIndex += 1) {
      const score = Number(input.data[(4 + classIndex) * anchors + anchor])
      if (score > confidence) {
        confidence = score
        bestClassIndex = classIndex
      }
    }
    const best = activeClasses.get(bestClassIndex)
    if (!best || confidence < (input.minimumConfidence ?? DEFAULT_CONFIDENCE)) continue
    const centerX = Number(input.data[anchor])
    const centerY = Number(input.data[anchors + anchor])
    const width = Number(input.data[anchors * 2 + anchor])
    const height = Number(input.data[anchors * 3 + anchor])
    if (![centerX, centerY, width, height].every(Number.isFinite) ||
        width < 3 || height < 3 || width > input.inputSize * 0.25 ||
        height > input.inputSize * 0.25) continue
    candidates.push({
      ...best,
      confidence,
      centerX: centerX / input.inputSize,
      centerY: centerY / input.inputSize,
      width: width / input.inputSize,
      height: height / input.inputSize,
    })
  }
  return nonMaximumSuppression(candidates).map(({ classIndex: _classIndex, ...entry }) => entry)
}

async function firstExistingDirectory(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, "manifest.json"))
      return candidate
    } catch { /* try the next development/packaged location */ }
  }
  return candidates[0]
}

export async function defaultMinimapModelDirectory() {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  return firstExistingDirectory([
    ...(resourcesPath ? [path.join(resourcesPath, "minimap-model")] : []),
    path.resolve(process.cwd(), "resources", "minimap-model"),
    path.resolve(moduleDirectory, "../../../resources/minimap-model"),
    path.resolve(moduleDirectory, "../../resources/minimap-model"),
  ])
}

export class OnnxChampionDetector {
  private readonly activeRoster = new Map<string, string>()

  private constructor(
    private readonly session: ort.InferenceSession,
    private readonly manifest: MinimapModelManifest,
    private readonly labels: string[],
  ) {}

  static async load(directory?: string) {
    const resolvedDirectory = directory ?? await defaultMinimapModelDirectory()
    const manifest = JSON.parse(
      await readFile(path.join(resolvedDirectory, "manifest.json"), "utf8"),
    ) as MinimapModelManifest
    if (manifest.schemaVersion !== 1 || manifest.classCount < 150 ||
        manifest.classCount > 500 ||
        manifest.input.shape[0] !== 1 || manifest.input.shape[1] !== 3 ||
        manifest.input.shape[2] !== manifest.input.shape[3]) {
      throw new Error("minimap_model_manifest_invalid")
    }
    const labels = JSON.parse(
      await readFile(path.join(resolvedDirectory, manifest.labelsFile), "utf8"),
    ) as unknown
    if (!Array.isArray(labels) || labels.length !== manifest.classCount ||
        labels.some((label) => typeof label !== "string" || label.trim().length === 0) ||
        new Set(labels.map((label) => normalizedChampionKey(label as string))).size !== labels.length) {
      throw new Error("minimap_model_labels_invalid")
    }
    const modelBytes = await readFile(path.join(resolvedDirectory, manifest.artifactFile))
    if (modelBytes.length !== manifest.artifactBytes ||
        createHash("sha256").update(modelBytes).digest("hex") !== manifest.artifactSha256) {
      throw new Error("minimap_model_checksum_invalid")
    }
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
      executionMode: "sequential",
      intraOpNumThreads: Math.max(1, Math.min(4, availableParallelism())),
      interOpNumThreads: 1,
    })
    return new OnnxChampionDetector(session, manifest, labels as string[])
  }

  get runtimeStatus(): ChampionModelRuntimeStatus {
    return {
      available: true,
      model: this.manifest.model,
      revision: this.manifest.revision,
      inputSize: this.inputSize,
      classCount: this.labels.length,
    }
  }

  setTemplates(templates: ChampionMarkerTemplate[]) {
    this.activeRoster.clear()
    for (const template of templates) {
      this.activeRoster.set(normalizedChampionKey(template.championName), template.championName)
    }
  }

  clearTemplates() {
    this.activeRoster.clear()
  }

  async close() {
    this.activeRoster.clear()
    await this.session.release()
  }

  async detect(frame: RgbaFrame): Promise<LearnedChampionDetectionResult> {
    if (!this.activeRoster.size) return { detections: [], inferenceMs: 0 }
    const started = performance.now()
    const input = championModelTensor(frame, this.inputSize)
    const results = await this.session.run({
      [this.manifest.input.name]: new ort.Tensor(
        "float32",
        input,
        this.manifest.input.shape,
      ),
    })
    const outputName = this.session.outputNames[0]
    const output = results[outputName]
    if (!output || !(output.data instanceof Float32Array)) {
      throw new Error("minimap_model_output_missing")
    }
    return {
      detections: decodeYoloOutput({
        data: output.data,
        dimensions: output.dims,
        labels: this.labels,
        activeRoster: this.activeRoster,
        inputSize: this.inputSize,
      }),
      inferenceMs: performance.now() - started,
    }
  }

  private get inputSize() {
    return this.manifest.input.shape[2]
  }
}
