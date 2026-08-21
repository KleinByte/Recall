import { parentPort } from "node:worker_threads"
import type {
  VisionCalibrationResult,
  VisionFrameResult,
  VisionRuntimeInfo,
  VisionWorkerRequest,
  VisionWorkerResponse,
} from "./contracts.js"
import { loadOpenCv } from "./opencv-runtime.js"
import { VisionPipeline } from "./vision-pipeline.js"

const port = parentPort
if (!port) throw new Error("vision_worker_parent_port_required")

let pipeline: VisionPipeline | undefined
let queue = Promise.resolve()

function failure(request: VisionWorkerRequest, error: unknown): VisionWorkerResponse {
  const cause = error instanceof Error ? error : new Error(String(error))
  return {
    id: request.id,
    ok: false,
    task: request.task,
    error: {
      message: cause.message,
      ...(cause.stack ? { stack: cause.stack } : {}),
    },
  }
}

function postSuccess(request: VisionWorkerRequest, result: unknown, transfer?: ArrayBuffer[]) {
  const response = {
    id: request.id,
    ok: true,
    task: request.task,
    result,
  } satisfies VisionWorkerResponse
  if (transfer?.length) port!.postMessage(response, transfer)
  else port!.postMessage(response)
}

async function handle(request: VisionWorkerRequest) {
  if (request.task === "initialize") {
    pipeline?.close()
    const cv = await loadOpenCv()
    pipeline = new VisionPipeline(cv, request.canonicalSize)
    postSuccess(request, pipeline.runtime satisfies VisionRuntimeInfo)
    return
  }
  if (request.task === "ping") {
    postSuccess(request, pipeline?.runtime ?? "pong")
    return
  }
  if (!pipeline) throw new Error("vision_worker_not_initialized")

  if (request.task === "set-roster") {
    pipeline.setRoster(request.sessionId, request.gameId, request.templates)
    postSuccess(request, true)
    return
  }
  if (request.task === "set-camp-templates") {
    pipeline.setCampTemplates(request.templates)
    postSuccess(request, true)
    return
  }
  if (request.task === "calibrate") {
    const result = pipeline.calibrate(request) satisfies VisionCalibrationResult
    const transfer = result.minimap ? [result.minimap.data.buffer as ArrayBuffer] : undefined
    postSuccess(request, result, transfer)
    return
  }
  if (request.task === "process-frame") {
    const result = pipeline.processFrame(request) satisfies VisionFrameResult
    postSuccess(request, result, [result.frame.data.buffer as ArrayBuffer])
    return
  }
  if (request.task === "reset") {
    pipeline.reset(request.sessionId)
    postSuccess(request, true)
    return
  }

  const unreachable: never = request
  throw new Error(`vision_worker_task_unsupported:${JSON.stringify(unreachable)}`)
}

port.on("message", (request: VisionWorkerRequest) => {
  queue = queue
    .then(() => handle(request))
    .catch((error) => port.postMessage(failure(request, error)))
})
