import { Worker } from "node:worker_threads"
import { fileURLToPath } from "node:url"
import path from "node:path"
import type { MinimapCalibration, RgbaFrame } from "../../../src/shared/minimap/contracts.js"
import type { CampVisualTemplateAsset } from "../jungle/camp-visual-detector.js"
import type { MinimapCalibrationHints } from "../minimap/calibration.js"
import type { ChampionMarkerTemplate } from "../minimap/champion-marker-detector.js"
import type {
  VisionCalibrationResult,
  VisionFrameResult,
  VisionRuntimeInfo,
  VisionWorkerRequest,
  VisionWorkerResponse,
  VisionWorkerTask,
} from "./contracts.js"

interface WorkerPort {
  on(event: "message", listener: (response: VisionWorkerResponse) => void): this
  on(event: "error", listener: (error: Error) => void): this
  on(event: "exit", listener: (code: number) => void): this
  postMessage(request: VisionWorkerRequest, transferList?: readonly ArrayBuffer[]): void
  terminate(): Promise<number>
}

type WorkerFactory = () => WorkerPort

interface PendingTask {
  resolve(value: unknown): void
  reject(error: Error): void
}

function defaultWorkerFactory(): WorkerPort {
  const directory = path.dirname(fileURLToPath(import.meta.url))
  return new Worker(path.join(directory, "vision-worker.js"), {
    name: "recall-vision-opencv",
  }) as unknown as WorkerPort
}

function transferableFrame(frame: RgbaFrame) {
  const source = frame.data
  const canTransferDirectly = source.buffer instanceof ArrayBuffer &&
    source.byteOffset === 0 && source.byteLength === source.buffer.byteLength
  return {
    ...frame,
    data: canTransferDirectly ? source : Uint8Array.from(source),
  }
}


export interface VisionWorkerPortClient {
  readonly restarts: number
  readonly runtime: VisionRuntimeInfo | undefined
  readonly state: "idle" | "initializing" | "ready" | "failed" | "closed"
  initialize(canonicalSize: number): Promise<VisionRuntimeInfo>
  setRoster(sessionId: string, gameId: number, templates: ChampionMarkerTemplate[]): Promise<void>
  setCampTemplates(templates: CampVisualTemplateAsset[]): Promise<void>
  calibrate(input: {
    sessionId: string
    frame: RgbaFrame
    hints: MinimapCalibrationHints
    calibration?: MinimapCalibration
  }): Promise<VisionCalibrationResult>
  processFrame(input: {
    sessionId: string
    gameId: number
    gameTimeMs: number
    frame: RgbaFrame
    includeCamps: boolean
    includeVisualValidation?: boolean
  }): Promise<VisionFrameResult>
  reset(sessionId?: string): Promise<void>
  ping(): Promise<VisionRuntimeInfo | "pong">
  close(): Promise<void>
}

/**
 * Owns the OpenCV worker lifecycle. Runtime configuration is replayed after a
 * crash so the next frame can recover without leaking stale match state.
 */
export class VisionWorkerClient implements VisionWorkerPortClient {
  private worker: WorkerPort | undefined
  private nextId = 1
  private readonly pending = new Map<number, PendingTask>()
  private closing = false
  private canonicalSize = 320
  private runtimeInfo: VisionRuntimeInfo | undefined
  private initializedWorker: WorkerPort | undefined
  private initializing: Promise<VisionRuntimeInfo> | undefined
  private campTemplates: CampVisualTemplateAsset[] = []
  private roster: { sessionId: string; gameId: number; templates: ChampionMarkerTemplate[] } | undefined
  private _restarts = 0

  constructor(private readonly createWorker: WorkerFactory = defaultWorkerFactory) {}

  get restarts() { return this._restarts }
  get runtime() { return this.runtimeInfo ? { ...this.runtimeInfo } : undefined }
  get state(): "idle" | "initializing" | "ready" | "failed" | "closed" {
    if (this.closing) return "closed"
    if (this.initializing) return "initializing"
    if (this.worker && this.initializedWorker === this.worker) return "ready"
    if (this.worker) return "failed"
    return "idle"
  }

  async initialize(canonicalSize: number) {
    this.canonicalSize = canonicalSize
    return this.ensureInitialized()
  }

  async setRoster(sessionId: string, gameId: number, templates: ChampionMarkerTemplate[]) {
    this.roster = {
      sessionId,
      gameId,
      templates: templates.map((template) => ({ ...template, rgba: Uint8Array.from(template.rgba) })),
    }
    await this.ensureInitialized()
    await this.request({ task: "set-roster", ...this.roster })
  }

  async setCampTemplates(templates: CampVisualTemplateAsset[]) {
    this.campTemplates = templates.map((template) => ({
      ...template,
      rgba: Uint8Array.from(template.rgba),
    }))
    await this.ensureInitialized()
    await this.request({ task: "set-camp-templates", templates: this.campTemplates })
  }

  async calibrate(input: {
    sessionId: string
    frame: RgbaFrame
    hints: MinimapCalibrationHints
    calibration?: MinimapCalibration
  }): Promise<VisionCalibrationResult> {
    await this.ensureInitialized()
    const frame = transferableFrame(input.frame)
    return this.request({ task: "calibrate", ...input, frame }, [frame.data.buffer as ArrayBuffer])
  }

  async processFrame(input: {
    sessionId: string
    gameId: number
    gameTimeMs: number
    frame: RgbaFrame
    includeCamps: boolean
    includeVisualValidation?: boolean
  }): Promise<VisionFrameResult> {
    await this.ensureInitialized()
    const frame = transferableFrame(input.frame)
    return this.request({ task: "process-frame", ...input, frame }, [frame.data.buffer as ArrayBuffer])
  }

  async reset(sessionId?: string) {
    this.roster = undefined
    if (!this.worker || this.initializedWorker !== this.worker) return
    await this.request({ task: "reset", sessionId })
  }

  async ping() {
    await this.ensureInitialized()
    return this.request<VisionRuntimeInfo | "pong">({ task: "ping" })
  }

  async close() {
    this.closing = true
    const worker = this.worker
    this.worker = undefined
    this.initializedWorker = undefined
    this.initializing = undefined
    this.rejectPending(new Error("vision_worker_closed"))
    if (worker) await worker.terminate()
  }

  private async ensureInitialized(): Promise<VisionRuntimeInfo> {
    if (this.closing) throw new Error("vision_worker_closed")
    const worker = this.getWorker()
    if (this.initializedWorker === worker && this.runtimeInfo) return this.runtimeInfo
    if (this.initializing) return this.initializing
    this.initializing = (async () => {
      const runtime = await this.request<VisionRuntimeInfo>({
        task: "initialize",
        canonicalSize: this.canonicalSize,
      })
      if (this.worker !== worker) throw new Error("vision_worker_replaced_during_initialize")
      this.initializedWorker = worker
      this.runtimeInfo = runtime
      if (this.campTemplates.length) {
        await this.request({ task: "set-camp-templates", templates: this.campTemplates })
      }
      if (this.roster) {
        await this.request({ task: "set-roster", ...this.roster })
      }
      return runtime
    })().finally(() => {
      this.initializing = undefined
    })
    return this.initializing
  }

  private request<TResult>(task: VisionWorkerTask, transferList?: readonly ArrayBuffer[]): Promise<TResult> {
    if (this.closing) return Promise.reject(new Error("vision_worker_closed"))
    const id = this.nextId++
    return new Promise<TResult>((resolve, reject) => {
      let worker: WorkerPort
      try {
        worker = this.getWorker()
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }
      this.pending.set(id, { resolve: (value) => resolve(value as TResult), reject })
      try {
        worker.postMessage({ id, ...task } as VisionWorkerRequest, transferList)
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private getWorker(): WorkerPort {
    if (this.worker) return this.worker
    const worker = this.createWorker()
    worker.on("message", (response) => this.handleResponse(response))
    worker.on("error", (error) => this.handleFailure(worker, error))
    worker.on("exit", (code) => {
      if (this.worker !== worker) return
      this.worker = undefined
      this.initializedWorker = undefined
      if (!this.closing) {
        this._restarts += 1
        this.rejectPending(new Error(`vision_worker_exited:${code}`))
      }
    })
    this.worker = worker
    return worker
  }

  private handleResponse(response: VisionWorkerResponse) {
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    if (response.ok) pending.resolve(response.result)
    else {
      const error = new Error(response.error.message)
      if (response.error.stack) error.stack = response.error.stack
      pending.reject(error)
    }
  }

  private handleFailure(worker: WorkerPort, error: Error) {
    if (this.worker !== worker) return
    this.worker = undefined
    this.initializedWorker = undefined
    this._restarts += 1
    this.rejectPending(error)
  }

  private rejectPending(error: Error) {
    for (const task of this.pending.values()) task.reject(error)
    this.pending.clear()
  }
}
