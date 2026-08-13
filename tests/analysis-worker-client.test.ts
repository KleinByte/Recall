import { describe, expect, it } from "vitest"
import { AnalysisWorkerClient } from "../electron/main/background/analysis-worker-client.js"
import type {
  AnalysisWorkerRequest,
  AnalysisWorkerResponse,
} from "../electron/main/background/analysis-worker-contract.js"

type ListenerMap = {
  message: Array<(response: AnalysisWorkerResponse) => void>
  error: Array<(error: Error) => void>
  exit: Array<(code: number) => void>
}

class FakeWorker {
  readonly requests: AnalysisWorkerRequest[] = []
  readonly listeners: ListenerMap = { message: [], error: [], exit: [] }
  terminated = false

  on<TEvent extends keyof ListenerMap>(
    event: TEvent,
    listener: ListenerMap[TEvent][number],
  ): this {
    this.listeners[event].push(listener as never)
    return this
  }

  postMessage(request: AnalysisWorkerRequest): void {
    this.requests.push(request)
  }

  async terminate(): Promise<number> {
    this.terminated = true
    return 0
  }

  respond(response: AnalysisWorkerResponse): void {
    for (const listener of this.listeners.message) listener(response)
  }

  fail(error: Error): void {
    for (const listener of this.listeners.error) listener(error)
  }
}

describe("AnalysisWorkerClient", () => {
  it("multiplexes requests by id and resolves out-of-order responses", async () => {
    const worker = new FakeWorker()
    const client = new AnalysisWorkerClient(() => worker)

    const first = client.ping()
    const second = client.ping()
    expect(worker.requests.map((request) => request.id)).toEqual([1, 2])

    worker.respond({ id: 2, ok: true, task: "ping", result: "pong" })
    worker.respond({ id: 1, ok: true, task: "ping", result: "pong" })

    await expect(first).resolves.toBe("pong")
    await expect(second).resolves.toBe("pong")
    await client.close()
    expect(worker.terminated).toBe(true)
  })

  it("rejects pending work on a worker failure and starts a fresh worker later", async () => {
    const firstWorker = new FakeWorker()
    const secondWorker = new FakeWorker()
    const workers = [firstWorker, secondWorker]
    const client = new AnalysisWorkerClient(() => workers.shift()!)

    const failed = client.ping()
    firstWorker.fail(new Error("worker_crashed"))
    await expect(failed).rejects.toThrow("worker_crashed")

    const recovered = client.ping()
    for (const listener of firstWorker.listeners.exit) listener(1)
    secondWorker.respond({ id: 2, ok: true, task: "ping", result: "pong" })
    await expect(recovered).resolves.toBe("pong")
  })

  it("reports worker construction failures as rejected tasks", async () => {
    const client = new AnalysisWorkerClient(() => {
      throw new Error("worker_start_failed")
    })

    await expect(client.ping()).rejects.toThrow("worker_start_failed")
  })

  it("surfaces task errors and refuses new work after close", async () => {
    const worker = new FakeWorker()
    const client = new AnalysisWorkerClient(() => worker)
    const task = client.ping()
    const [{ id }] = worker.requests

    worker.respond({ id, ok: false, error: { message: "analysis_failed" } })
    await expect(task).rejects.toThrow("analysis_failed")
    await client.close()
    await expect(client.ping()).rejects.toThrow("analysis_worker_closed")
  })

  it("streams Grade rebuild progress without resolving the task early", async () => {
    const worker = new FakeWorker()
    const client = new AnalysisWorkerClient(() => worker)
    const progress: number[] = []
    const task = client.rebuildReference({
      databasePath: "C:/data/stats.db",
      backup: { path: "backup.db", sha256: "a".repeat(64) },
    }, (event) => progress.push(event.processed))
    const [{ id }] = worker.requests

    worker.respond({
      id,
      task: "grade-rebuild",
      progress: { total: 2, processed: 1, ready: 1, nonready: 0, errors: 0 },
    })
    expect(progress).toEqual([1])

    worker.respond({
      id,
      ok: true,
      task: "grade-rebuild",
      result: {
        total: 2,
        processed: 2,
        ready: 2,
        nonready: 0,
        errors: 0,
        recipeId: "recipe:test",
        calibrationId: "calibration:test",
        runId: 1,
      },
    })
    await expect(task).resolves.toMatchObject({ processed: 2, ready: 2 })
  })

  it("sends export paths and account identity without cloning match history", async () => {
    const worker = new FakeWorker()
    const client = new AnalysisWorkerClient(() => worker)
    const task = client.exportMatchSummary({
      databasePath: "C:/data/stats.db",
      puuid: "owner",
      filePath: "C:/exports/matches.csv",
    })
    const [request] = worker.requests

    expect(request).toEqual({
      id: 1,
      task: "match-summary-export",
      input: {
        databasePath: "C:/data/stats.db",
        puuid: "owner",
        filePath: "C:/exports/matches.csv",
      },
    })
    worker.respond({
      id: 1,
      ok: true,
      task: "match-summary-export",
      result: {
        exported: 2,
        filePath: "C:/exports/matches.csv",
        digest: "a".repeat(64),
      },
    })
    await expect(task).resolves.toMatchObject({ exported: 2 })
  })

  it("uses a distinct worker task for automatic reference freezing", async () => {
    const worker = new FakeWorker()
    const client = new AnalysisWorkerClient(() => worker)
    const task = client.ensureFrozenReference({
      databasePath: "C:/data/stats.db",
      backup: { path: "backup.db", sha256: "b".repeat(64) },
    })

    expect(worker.requests[0]).toMatchObject({ task: "grade-ensure-frozen" })
    worker.respond({
      id: 1,
      ok: true,
      task: "grade-ensure-frozen",
      result: {
        state: "calibrating",
        requiredMatches: 10,
        eligibleMatches: 0,
        supportedScopes: [],
        modes: [],
      },
    })
    await expect(task).resolves.toMatchObject({ state: "calibrating" })
  })

  it("routes RVI reads and profile aggregation through the analysis worker", async () => {
    const worker = new FakeWorker()
    const client = new AnalysisWorkerClient(() => worker)
    const task = client.buildPerformanceProfileFromDatabase({
      databasePath: "C:/data/stats.db",
      filter: { puuid: "owner" },
      family: "sr",
    })

    expect(worker.requests[0]).toMatchObject({
      task: "performance-profile-database",
      input: {
        databasePath: "C:/data/stats.db",
        filter: { puuid: "owner" },
        family: "sr",
      },
    })
    worker.respond({
      id: 1,
      ok: true,
      task: "performance-profile-database",
      result: undefined,
    })
    await expect(task).resolves.toBeUndefined()
  })
})
