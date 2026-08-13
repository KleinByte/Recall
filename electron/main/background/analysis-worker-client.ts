import { Worker } from "node:worker_threads"
import { fileURLToPath } from "node:url"
import path from "node:path"
import type {
  SkillReport,
} from "../matches/skill-report.js"
import type {
  PerformanceProfile,
} from "../matches/performance-profile.js"
import type {
  PerformanceReferenceRebuildProgress,
  PerformanceReferenceRebuildResult,
  PerformanceReferenceStatus,
} from "../matches/match-grading-service.js"
import type {
  GradeRebuildWorkerInput,
  MatchSummaryExportWorkerInput,
  MatchSummaryExportWorkerResult,
  AnalysisWorkerRequest,
  AnalysisWorkerResponse,
  AnalysisWorkerTask,
} from "./analysis-worker-contract.js"
import type { SkillReportDatabaseInput } from "./skill-report-database.js"
import type { PerformanceProfileDatabaseInput } from "./performance-profile-database.js"

interface WorkerPort {
  on(event: "message", listener: (response: AnalysisWorkerResponse) => void): this
  on(event: "error", listener: (error: Error) => void): this
  on(event: "exit", listener: (code: number) => void): this
  postMessage(request: AnalysisWorkerRequest): void
  terminate(): Promise<number>
}

type WorkerFactory = () => WorkerPort

interface PendingTask {
  resolve(value: unknown): void
  reject(error: Error): void
  onProgress?: (progress: PerformanceReferenceRebuildProgress) => void
}

function defaultWorkerFactory(): WorkerPort {
  const directory = path.dirname(fileURLToPath(import.meta.url))
  return new Worker(path.join(directory, "analysis-worker.js"), {
    name: "recall-analysis",
  })
}

/** Runs CPU-heavy, read-only analysis away from Electron's event loop. */
export class AnalysisWorkerClient {
  private worker: WorkerPort | undefined
  private nextId = 1
  private readonly pending = new Map<number, PendingTask>()
  private closing = false

  constructor(private readonly createWorker: WorkerFactory = defaultWorkerFactory) {}

  buildSkillReportFromDatabase(
    input: SkillReportDatabaseInput & { databasePath: string },
  ): Promise<SkillReport> {
    return this.request({ task: "skill-report-database", input })
  }

  buildPerformanceProfileFromDatabase(
    input: PerformanceProfileDatabaseInput & { databasePath: string },
  ): Promise<PerformanceProfile | undefined> {
    return this.request({ task: "performance-profile-database", input })
  }

  ping(): Promise<"pong"> {
    return this.request({ task: "ping" })
  }

  rebuildReference(
    input: GradeRebuildWorkerInput,
    onProgress?: (progress: PerformanceReferenceRebuildProgress) => void,
  ): Promise<PerformanceReferenceRebuildResult> {
    return this.request({ task: "grade-rebuild", input }, onProgress)
  }

  ensureFrozenReference(
    input: GradeRebuildWorkerInput,
    onProgress?: (progress: PerformanceReferenceRebuildProgress) => void,
  ): Promise<PerformanceReferenceRebuildResult | PerformanceReferenceStatus> {
    return this.request({ task: "grade-ensure-frozen", input }, onProgress)
  }

  exportMatchSummary(
    input: MatchSummaryExportWorkerInput,
  ): Promise<MatchSummaryExportWorkerResult> {
    return this.request({ task: "match-summary-export", input })
  }

  async close(): Promise<void> {
    this.closing = true
    const worker = this.worker
    this.worker = undefined
    this.rejectPending(new Error("analysis_worker_closed"))
    if (worker) await worker.terminate()
  }

  private request<TResult>(
    task: AnalysisWorkerTask,
    onProgress?: (progress: PerformanceReferenceRebuildProgress) => void,
  ): Promise<TResult> {
    if (this.closing) return Promise.reject(new Error("analysis_worker_closed"))
    const id = this.nextId++
    return new Promise<TResult>((resolve, reject) => {
      let worker: WorkerPort
      try {
        worker = this.getWorker()
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }
      this.pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
        onProgress,
      })
      try {
        worker.postMessage({ id, ...task } as AnalysisWorkerRequest)
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
      if (!this.closing) {
        this.rejectPending(new Error(`analysis_worker_exited:${code}`))
      }
    })
    this.worker = worker
    return worker
  }

  private handleResponse(response: AnalysisWorkerResponse): void {
    const task = this.pending.get(response.id)
    if (!task) return
    if ("progress" in response) {
      task.onProgress?.(response.progress)
      return
    }
    this.pending.delete(response.id)
    if (response.ok) task.resolve(response.result)
    else {
      const error = new Error(response.error.message)
      if (response.error.stack) error.stack = response.error.stack
      task.reject(error)
    }
  }

  private handleFailure(worker: WorkerPort, error: Error): void {
    if (this.worker !== worker) return
    this.worker = undefined
    this.rejectPending(error)
  }

  private rejectPending(error: Error): void {
    for (const task of this.pending.values()) task.reject(error)
    this.pending.clear()
  }
}
