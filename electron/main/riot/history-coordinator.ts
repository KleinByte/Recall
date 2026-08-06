import type { Database } from "better-sqlite3"
import {
  RiotHistoryImportRepository,
  type RiotHistoryRunInput,
} from "../database/riot-history-import-repo.js"
import { assertAllowedMatchV5Path } from "./api-client.js"

export const HISTORY_PAGE_SIZE = 100
export const HISTORY_LIST_TIMEOUT_MS = 20_000
export const HISTORY_DETAIL_TIMEOUT_MS = 20_000
export const HISTORY_TIMELINE_TIMEOUT_MS = 60_000

export interface HistoryIdentity {
  puuid: string
  matchPuuid: string
  platformRoute: string
  regionalRoute: string
  identitySource: "cache" | "league_client"
}

export interface StartHistoryInput {
  identity?: HistoryIdentity
  startTimeMs?: number
  endTimeMs: number
  requestedDetail?: true
  requestedTimeline: boolean
  now?: number
}

export interface HistoryListTransport {
  list(input: {
    runId: number
    regionalRoute: string
    matchPuuid: string
    startTimeSeconds?: number
    endTimeSeconds: number
    start: number
    count: 100
    signal: AbortSignal
  }): Promise<string[]>
}

const MATCH_ID = /^[A-Za-z0-9]+_[0-9]+$/

export function retryAfterMs(value: string | null, now: number): number {
  if (value) {
    const seconds = Number(value)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.trunc(seconds * 1000)
    const date = Date.parse(value)
    if (Number.isFinite(date) && date >= now) return date - now
  }
  return 120_000
}

export function detail404NextRetryAt(notFoundCount: number, now: number): number {
  const delays = [30 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000]
  return now + (delays[notFoundCount - 1] ?? 7 * 24 * 60 * 60_000)
}

export function transientRetryAt(failures: number, seed: number, now: number): number {
  const base = Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, failures - 1))
  const deterministic = ((Math.imul(seed ^ failures, 1103515245) >>> 0) % 2001 - 1000) / 10_000
  return now + Math.round(base * (1 + deterministic))
}

export class HistoryCoordinator {
  private readonly repository: RiotHistoryImportRepository

  constructor(
    private readonly db: Database,
    private readonly transport: HistoryListTransport,
  ) {
    this.repository = new RiotHistoryImportRepository(db)
  }

  start(input: StartHistoryInput): number {
    if (!input.identity) throw new Error("history_preflight_client_identity_required")
    if (input.requestedDetail !== undefined && input.requestedDetail !== true) {
      throw new Error("history_detail_is_required")
    }
    if (!Number.isSafeInteger(input.endTimeMs) ||
        (input.startTimeMs !== undefined && !Number.isSafeInteger(input.startTimeMs)) ||
        (input.startTimeMs !== undefined && input.startTimeMs >= input.endTimeMs)) {
      throw new Error("invalid_history_range")
    }
    const run: RiotHistoryRunInput = {
      puuid: input.identity.puuid,
      matchPuuid: input.identity.matchPuuid,
      platformRoute: input.identity.platformRoute,
      regionalRoute: input.identity.regionalRoute,
      startTimeSeconds: input.startTimeMs === undefined
        ? undefined : Math.floor(input.startTimeMs / 1000),
      endTimeSeconds: Math.floor(input.endTimeMs / 1000),
      requestedTimeline: input.requestedTimeline,
      identitySource: input.identity.identitySource,
      startedAt: input.now ?? Date.now(),
    }
    return this.repository.createRun(run)
  }

  async discoverNextPage(runId: number, now = Date.now()): Promise<{
    discovered: number
    nextOffset: number
    terminalPage: boolean
  }> {
    const run = this.db.prepare(`
      SELECT id, puuid, match_puuid AS matchPuuid, regional_route AS regionalRoute,
             start_time_seconds AS startTimeSeconds, end_time_seconds AS endTimeSeconds,
             next_offset AS nextOffset, requested_timeline AS requestedTimeline,
             discovery_status AS status
      FROM riot_history_runs WHERE id = ?
    `).get(runId) as {
      id: number; puuid: string; matchPuuid: string; regionalRoute: string
      startTimeSeconds?: number; endTimeSeconds: number; nextOffset: number
      requestedTimeline: number; status: string
    } | undefined
    if (!run) throw new Error("history_run_not_found")
    if (["complete", "complete_with_unresolved", "cancelled", "error"].includes(run.status)) {
      throw new Error("history_run_terminal")
    }
    const path = `/lol/match/v5/matches/by-puuid/${run.matchPuuid}/ids`
    assertAllowedMatchV5Path(path)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error("history_list_timeout")), HISTORY_LIST_TIMEOUT_MS)
    let ids: string[]
    try {
      ids = await this.transport.list({
        runId, regionalRoute: run.regionalRoute, matchPuuid: run.matchPuuid,
        startTimeSeconds: run.startTimeSeconds, endTimeSeconds: run.endTimeSeconds,
        start: run.nextOffset, count: HISTORY_PAGE_SIZE, signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !MATCH_ID.test(id)) ||
        new Set(ids).size !== ids.length) throw new Error("invalid_history_id_page")

    const nextOffset = run.nextOffset + ids.length
    this.db.transaction(() => {
      ids.forEach((riotMatchId, index) => this.repository.recordDiscoveredMatch({
        runId, puuid: run.puuid, regionalRoute: run.regionalRoute,
        riotMatchId, listOffset: run.nextOffset + index, discoveredAt: now,
        timelineRequested: run.requestedTimeline === 1,
      }))
      this.db.prepare(`
        UPDATE riot_history_runs
        SET next_offset = ?, discovery_status = ?, updated_at = ?
        WHERE id = ?
      `).run(nextOffset, ids.length < HISTORY_PAGE_SIZE ? "complete" : "running", now, runId)
    })()
    return { discovered: ids.length, nextOffset, terminalPage: ids.length < HISTORY_PAGE_SIZE }
  }
}
