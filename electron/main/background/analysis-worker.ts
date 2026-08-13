import { parentPort } from "node:worker_threads"
import Database from "better-sqlite3"
import {
  MatchGradingService,
  type PerformanceReferenceRebuildProgress,
} from "../matches/match-grading-service.js"
import { MatchesRepository } from "../database/matches-repo.js"
import { writeMatchSummaryCsv } from "./match-summary-export.js"
import { buildSkillReportFromDatabase } from "./skill-report-database.js"
import { buildPerformanceProfileFromDatabase } from "./performance-profile-database.js"
import type {
  AnalysisWorkerRequest,
  AnalysisWorkerResponse,
} from "./analysis-worker-contract.js"

const port = parentPort
if (!port) throw new Error("analysis_worker_parent_port_required")

function failure(id: number, error: unknown): AnalysisWorkerResponse {
  const cause = error instanceof Error ? error : new Error(String(error))
  return {
    id,
    ok: false,
    error: {
      message: cause.message,
      ...(cause.stack ? { stack: cause.stack } : {}),
    },
  }
}

port.on("message", (request: AnalysisWorkerRequest) => {
  try {
    if (request.task === "ping") {
      port.postMessage({
        id: request.id,
        ok: true,
        task: request.task,
        result: "pong",
      } satisfies AnalysisWorkerResponse)
      return
    }

    if (request.task === "grade-rebuild" || request.task === "grade-ensure-frozen") {
      const database = new Database(request.input.databasePath, { fileMustExist: true })
      try {
        database.pragma("busy_timeout = 10000")
        database.pragma("foreign_keys = ON")
        const service = new MatchGradingService(database)
        const onProgress = (progress: PerformanceReferenceRebuildProgress) => {
          port.postMessage({
            id: request.id,
            task: request.task,
            progress,
          } satisfies AnalysisWorkerResponse)
        }
        if (request.task === "grade-rebuild") {
          port.postMessage({
            id: request.id,
            ok: true,
            task: request.task,
            result: service.rebuildReference(request.input.backup, onProgress),
          } satisfies AnalysisWorkerResponse)
        } else {
          port.postMessage({
            id: request.id,
            ok: true,
            task: request.task,
            result: service.ensureFrozenReference(request.input.backup, onProgress),
          } satisfies AnalysisWorkerResponse)
        }
      } finally {
        database.close()
      }
      return
    }

    if (request.task === "match-summary-export") {
      const database = new Database(request.input.databasePath, {
        readonly: true,
        fileMustExist: true,
      })
      try {
        database.pragma("busy_timeout = 10000")
        const matches = new MatchesRepository(database).getAllMatches(request.input.puuid)
        port.postMessage({
          id: request.id,
          ok: true,
          task: request.task,
          result: writeMatchSummaryCsv(request.input.filePath, matches),
        } satisfies AnalysisWorkerResponse)
      } finally {
        database.close()
      }
      return
    }

    if (request.task === "skill-report-database") {
      const database = new Database(request.input.databasePath, {
        readonly: true,
        fileMustExist: true,
      })
      try {
        database.pragma("busy_timeout = 10000")
        port.postMessage({
          id: request.id,
          ok: true,
          task: request.task,
          result: buildSkillReportFromDatabase(database, request.input),
        } satisfies AnalysisWorkerResponse)
      } finally {
        database.close()
      }
      return
    }

    if (request.task === "performance-profile-database") {
      const database = new Database(request.input.databasePath, {
        readonly: true,
        fileMustExist: true,
      })
      try {
        database.pragma("busy_timeout = 10000")
        port.postMessage({
          id: request.id,
          ok: true,
          task: request.task,
          result: buildPerformanceProfileFromDatabase(database, request.input),
        } satisfies AnalysisWorkerResponse)
      } finally {
        database.close()
      }
      return
    }

    const unreachable: never = request
    throw new Error(`analysis_worker_task_unsupported:${JSON.stringify(unreachable)}`)
  } catch (error) {
    port.postMessage(failure(request.id, error))
  }
})
