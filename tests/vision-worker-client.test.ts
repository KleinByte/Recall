import { describe, expect, it } from "vitest"
import { VisionWorkerClient } from "../electron/main/vision/vision-worker-client.js"
import type {
  VisionFrameResult,
  VisionRuntimeInfo,
  VisionWorkerRequest,
  VisionWorkerResponse,
} from "../electron/main/vision/contracts.js"
import type { RgbaFrame } from "../src/shared/minimap/contracts.js"

type ListenerMap = {
  message: Array<(response: VisionWorkerResponse) => void>
  error: Array<(error: Error) => void>
  exit: Array<(code: number) => void>
}

class FakeVisionWorker {
  readonly requests: VisionWorkerRequest[] = []
  readonly transfers: Array<readonly ArrayBuffer[] | undefined> = []
  readonly listeners: ListenerMap = { message: [], error: [], exit: [] }
  terminated = false

  on<TEvent extends keyof ListenerMap>(
    event: TEvent,
    listener: ListenerMap[TEvent][number],
  ): this {
    this.listeners[event].push(listener as never)
    return this
  }

  postMessage(request: VisionWorkerRequest, transfer?: readonly ArrayBuffer[]): void {
    this.requests.push(request)
    this.transfers.push(transfer)
  }

  async terminate(): Promise<number> {
    this.terminated = true
    return 0
  }

  respond(index: number, result: unknown): void {
    const request = this.requests[index]
    if (!request) throw new Error(`missing_fake_request:${index}`)
    for (const listener of this.listeners.message) {
      listener({ id: request.id, ok: true, task: request.task, result })
    }
  }

  fail(error: Error): void {
    for (const listener of this.listeners.error) listener(error)
  }
}

const RUNTIME: VisionRuntimeInfo = { engine: "opencv_js", opencvVersion: "5.0.0" }

function frame(sequence = 1): RgbaFrame {
  return {
    width: 2,
    height: 2,
    data: new Uint8Array([
      1, 2, 3, 255, 4, 5, 6, 255,
      7, 8, 9, 255, 10, 11, 12, 255,
    ]),
    capturedMonotonicMs: 100,
    frameSequence: sequence,
  }
}

async function microtask() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

describe("VisionWorkerClient", () => {
  it("initializes once and transfers frame ownership for CV processing", async () => {
    const worker = new FakeVisionWorker()
    const client = new VisionWorkerClient(() => worker)

    const initializing = client.initialize(320)
    expect(worker.requests[0]).toEqual({ id: 1, task: "initialize", canonicalSize: 320 })
    worker.respond(0, RUNTIME)
    await expect(initializing).resolves.toEqual(RUNTIME)

    const input = frame()
    const task = client.processFrame({
      sessionId: "session-1",
      gameId: 77,
      gameTimeMs: 12_000,
      frame: input,
      includeCamps: true,
    })
    await microtask()
    const request = worker.requests[1]
    expect(request).toMatchObject({
      task: "process-frame",
      sessionId: "session-1",
      gameId: 77,
      gameTimeMs: 12_000,
      includeCamps: true,
    })
    expect(worker.transfers[1]).toHaveLength(1)
    expect(worker.transfers[1]?.[0]).toBe((request as Extract<VisionWorkerRequest, {
      task: "process-frame"
    }>).frame.data.buffer)

    const result: VisionFrameResult = {
      sessionId: "session-1",
      gameId: 77,
      frameSequence: 1,
      frame: input,
      visual: {
        score: 1,
        valid: true,
        texturedQuadrants: 4,
        darkRatio: 0.2,
        coloredRatio: 0.3,
        markerColorRatio: 0.02,
        axisBalance: 0.9,
        edgeDensity: 0.2,
        variance: 500,
      },
      markerProposals: [],
      championObservations: [],
      campObservations: [],
      metrics: { totalMs: 2, visualValidationMs: 0.2, championMs: 1, campMs: 0.8 },
    }
    worker.respond(1, result)
    await expect(task).resolves.toEqual(result)
    expect(client.state).toBe("ready")
    await client.close()
    expect(worker.terminated).toBe(true)
  })

  it("rejects in-flight work after a crash and replays match configuration on recovery", async () => {
    const first = new FakeVisionWorker()
    const second = new FakeVisionWorker()
    const workers = [first, second]
    const client = new VisionWorkerClient(() => workers.shift()!)

    const init = client.initialize(320)
    first.respond(0, RUNTIME)
    await init

    const campTemplates = [{
      campKey: "west_blue" as const,
      state: "alive" as const,
      width: 1,
      height: 1,
      rgba: new Uint8Array([1, 2, 3, 255]),
    }]
    const setCamps = client.setCampTemplates(campTemplates)
    await microtask()
    first.respond(1, true)
    await setCamps

    const roster = [{
      participantKey: "ally:zac",
      championName: "Zac",
      team: "ally" as const,
      isLocal: true,
      width: 1,
      height: 1,
      rgba: new Uint8Array([4, 5, 6, 255]),
    }]
    const setRoster = client.setRoster("session-1", 77, roster)
    await microtask()
    first.respond(2, true)
    await setRoster

    const failed = client.processFrame({
      sessionId: "session-1",
      gameId: 77,
      gameTimeMs: 12_000,
      frame: frame(),
      includeCamps: false,
    })
    await microtask()
    expect(first.requests[3].task).toBe("process-frame")
    first.fail(new Error("opencv_worker_crashed"))
    await expect(failed).rejects.toThrow("opencv_worker_crashed")
    expect(client.restarts).toBe(1)

    const ping = client.ping()
    expect(second.requests[0]).toMatchObject({ task: "initialize", canonicalSize: 320 })
    second.respond(0, RUNTIME)
    await microtask()
    expect(second.requests[1]).toMatchObject({ task: "set-camp-templates" })
    second.respond(1, true)
    await microtask()
    expect(second.requests[2]).toMatchObject({
      task: "set-roster",
      sessionId: "session-1",
      gameId: 77,
    })
    second.respond(2, true)
    await microtask()
    expect(second.requests[3]).toMatchObject({ task: "ping" })
    second.respond(3, RUNTIME)
    await expect(ping).resolves.toEqual(RUNTIME)
    expect(client.state).toBe("ready")
  })

  it("refuses new work after close", async () => {
    const worker = new FakeVisionWorker()
    const client = new VisionWorkerClient(() => worker)
    await client.close()
    await expect(client.ping()).rejects.toThrow("vision_worker_closed")
  })
})
