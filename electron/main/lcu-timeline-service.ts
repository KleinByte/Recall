import type { Database } from "better-sqlite3"
import type {
  LiveCaptureParticipant,
  LiveGameCaptureRepository,
} from "./database/live-game-capture-repo.js"
import { LcuRequestError, type LcuClient } from "./lcu-client.js"
import {
  mapTimeline,
  TIMELINE_MAPPER_VERSION,
  type CompactTimeline,
} from "./riot/timeline-mapper.js"
import {
  MatchSourceRepository,
  type RawPayloadIdentity,
} from "./database/match-source-repo.js"
import {
  TimelineRepository,
  type TimelineState,
} from "./database/timeline-repo.js"
import { deriveParticipantLifeIntervals } from "./matches/participant-life-intervals.js"

type TimelineFrames = Parameters<typeof mapTimeline>[0]

interface LcuTimelineDto {
  frames?: TimelineFrames
  info?: { frames?: TimelineFrames }
}

type LcuTimelineResponse = LcuTimelineDto | TimelineFrames

type TimelineStatus = "pending" | "loading" | "ready" | "unavailable" | "error"

export const LCU_TIMELINE_MAX_ATTEMPTS = 3
export const LCU_TIMELINE_RETRY_DELAY_MS = 200
export const LCU_TIMELINE_404_GRACE_MS = 15 * 60 * 1000
export const LCU_TIMELINE_REQUEST_TIMEOUT_MS = 15_000
export const LCU_TIMELINE_LOADING_STALE_MS = 60_000

class IncompleteLcuTimelineError extends Error {
  constructor() {
    super("League Client timeline data is incomplete")
    this.name = "IncompleteLcuTimelineError"
  }
}

class LcuTimelineTimeoutError extends Error {
  constructor() {
    super("League Client timeline request timed out")
    this.name = "LcuTimelineTimeoutError"
  }
}

function retryableTimelineError(error: unknown): boolean {
  if (!(error instanceof LcuRequestError)) return true
  // The local match-history endpoint commonly returns 404 for a short window
  // while the client is still committing a just-finished game. Treat that as
  // transient here; the bounded attempt loop prevents an individual request
  // from spinning forever.
  return error.status === 404 || error.status === 408 || error.status === 409 || error.status === 425 ||
    error.status === 429 || error.status >= 500
}

/**
 * Reads recent timelines from the authenticated local League Client.
 *
 * The developer API is deliberately not a fallback here. It is reserved for
 * the explicit Settings history import, while normal review and post-game
 * enrichment remain local and keyless.
 */
export class LcuTimelineService {
  private readonly drainingAccounts = new Set<string>()
  private readonly drainingTasks = new Map<string, Promise<void>>()

  constructor(
    private readonly db: Database,
    private readonly client: () => Pick<LcuClient, "request"> | undefined,
    private readonly onUpdated: (gameId: number) => void,
    private readonly onReady?: (
      gameId: number,
      puuid: string,
      summary: CompactTimeline,
    ) => void | Promise<void>,
    private readonly liveCaptures?: LiveGameCaptureRepository,
    private readonly now: () => number = Date.now,
    private readonly requestTimeoutMs = LCU_TIMELINE_REQUEST_TIMEOUT_MS,
  ) {}

  get(gameId: number, puuid: string) {
    const timelines = new TimelineRepository(this.db)
    const current = this.withParticipantLifeIntervals(
      gameId,
      puuid,
      timelines.state(gameId, puuid),
    )
    if (current.status !== "not_requested") return current

    const local = timelines.source(gameId, puuid, "league_client")
    if (!local || (local.status === "ready" &&
        local.mapperVersion !== TIMELINE_MAPPER_VERSION)) {
      const remapped = this.remapRetained(gameId, puuid)
      if (!remapped) return current
      const sources = new MatchSourceRepository(this.db)
      this.db.transaction(() => {
        sources.persistTimelineSource({
          gameId,
          puuid,
          source: "league_client",
          sourceMatchId: String(gameId),
          mapperVersion: TIMELINE_MAPPER_VERSION,
          timeline: remapped.summary,
          sourcePayload: remapped.sourcePayload,
          capturedAt: remapped.fetchedAt,
        })
        sources.setMappingResult(remapped.sourcePayload, "mapped", Date.now(), {
          gameId,
          mapperVersion: TIMELINE_MAPPER_VERSION,
        })
      })()
      void Promise.resolve(this.onReady?.(gameId, puuid, remapped.summary)).catch((error) => {
        console.warn(`Timeline labels could not be reevaluated: ${(error as Error).message}`)
      })
      return this.withParticipantLifeIntervals(
        gameId,
        puuid,
        timelines.state(gameId, puuid),
      )
    }
    return current
  }

  /** Adds durable live life-state to whichever authoritative timeline wins. */
  private withParticipantLifeIntervals(
    gameId: number,
    puuid: string,
    state: TimelineState,
  ): TimelineState {
    if (state.status !== "ready" || !state.summary || !this.liveCaptures) return state
    const participants = this.db.prepare(
      `SELECT participant_id AS participantId, team_id AS teamId,
              is_player AS isPlayer, summoner_name AS summonerName
       FROM match_participants WHERE game_id = ? AND puuid = ?`,
    ).all(gameId, puuid) as LiveCaptureParticipant[]
    const participantLifeIntervals = deriveParticipantLifeIntervals(
      this.liveCaptures.listSnapshots(gameId, puuid),
      participants,
      state.summary.events,
    )
    if (participantLifeIntervals.length === 0) return state
    return {
      ...state,
      summary: { ...state.summary, participantLifeIntervals },
    }
  }

  async request(gameId: number, puuid: string, manualRetry = false) {
    const current = this.get(gameId, puuid)
    if (current.status === "ready") return current
    if (current.status === "unavailable" && !manualRetry) return current

    const match = this.db.prepare(
      `SELECT riot_match_id AS riotMatchId, played_at AS playedAt,
              duration_secs AS durationSecs FROM matches
       WHERE game_id = ? AND puuid = ?`,
    ).get(gameId, puuid) as {
      riotMatchId?: string
      playedAt: number
      durationSecs: number
    } | undefined
    if (!match) throw new Error("Match not found")

    const client = this.client()
    if (!client) {
      this.write(gameId, puuid, "pending")
      this.onUpdated(gameId)
      return this.get(gameId, puuid)
    }

    this.write(gameId, puuid, "loading")
    this.onUpdated(gameId)

    let rawPayload: RawPayloadIdentity | undefined
    let sourceRepository: MatchSourceRepository | undefined
    try {
      const dto = await this.fetchTimelineWithRetry(client, gameId)
      const fetchedAt = Date.now()
      sourceRepository = new MatchSourceRepository(this.db)
      rawPayload = sourceRepository.persistRawPayload({
        ownerPuuid: puuid,
        source: "league_client",
        sourceMatchId: String(gameId),
        gameId,
        kind: "timeline",
        body: dto,
        mapperVersion: TIMELINE_MAPPER_VERSION,
        fetchedAt,
      })
      const frames = Array.isArray(dto) ? dto : dto.frames ?? dto.info?.frames
      const participants = this.db.prepare(
        `SELECT participant_id AS participantId, team_id AS teamId,
                is_player AS isPlayer, summoner_name AS summonerName
         FROM match_participants WHERE game_id = ? AND puuid = ?`,
      ).all(gameId, puuid) as {
        participantId: number
        teamId: number
        isPlayer: number
        summonerName?: string
      }[]
      const owner = participants.find((participant) => participant.isPlayer === 1)
      if (!owner || !frames?.length) {
        throw new IncompleteLcuTimelineError()
      }

      let summary = mapTimeline(
        frames,
        owner.participantId,
        new Map(participants.map((participant) => [
          participant.participantId,
          participant.teamId,
        ])),
      )
      summary = this.liveCaptures?.enrichTimeline(
        gameId,
        puuid,
        summary,
        participants,
      ) ?? summary
      this.db.transaction(() => {
        this.write(gameId, puuid, "ready", {
          fetchedAt,
          data: summary,
          sourcePayload: rawPayload,
        })
        sourceRepository!.setMappingResult(rawPayload!, "mapped", fetchedAt, { gameId })
      })()
      try {
        await this.onReady?.(gameId, puuid, summary)
      } catch (error) {
        console.warn(`Timeline labels could not be evaluated: ${(error as Error).message}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message.slice(0, 500) : "timeline_unmappable"
      const missingRecentlyFinishedTimeline = error instanceof LcuRequestError &&
        error.status === 404 &&
        this.now() - (match.playedAt + match.durationSecs * 1000) <=
          LCU_TIMELINE_404_GRACE_MS
      const status = error instanceof IncompleteLcuTimelineError ? "unavailable" :
        missingRecentlyFinishedTimeline ? "error" :
        error instanceof LcuRequestError && error.status === 404 ? "unavailable" : "error"
      this.db.transaction(() => {
        if (rawPayload && sourceRepository) {
          sourceRepository.setMappingResult(rawPayload, "unmappable", Date.now(), {
            gameId,
            error: errorMessage,
          })
        }
        this.write(gameId, puuid, status, { error: errorMessage })
      })()
    }

    this.onUpdated(gameId)
    return this.get(gameId, puuid)
  }

  /** Captures the complete local timeline window before games age out. */
  queueRecentMatches(puuid: string, limit = 20): Promise<void> | undefined {
    const active = this.drainingTasks.get(puuid)
    if (active) return active
    if (!this.client() || this.drainingAccounts.has(puuid)) return
    this.drainingAccounts.add(puuid)

    const task = Promise.resolve().then(async () => {
      try {
        // Mapper upgrades are local work when Recall retained the raw payload;
        // rebuild every such artifact before spending the client's short
        // history window on network requests for the newest uncached games.
        const timelines = new TimelineRepository(this.db)
        for (const gameId of timelines.staleLocalReadyGames(puuid)) this.get(gameId, puuid)
        const gameIds = timelines.captureCandidates(
          puuid,
          this.now() - LCU_TIMELINE_LOADING_STALE_MS,
          limit,
        )
        for (const gameId of gameIds) {
          if (!this.client()) break
          await this.request(gameId, puuid)
        }
      } finally {
        this.drainingAccounts.delete(puuid)
        this.drainingTasks.delete(puuid)
      }
    })
    this.drainingTasks.set(puuid, task)
    return task
  }

  /** Reprocesses durable raw LCU data when mapping logic gains richer fields. */
  private remapRetained(gameId: number, puuid: string): {
    summary: CompactTimeline
    sourcePayload: RawPayloadIdentity
    fetchedAt: number
  } | undefined {
    try {
      const retained = new MatchSourceRepository(this.db).readLatestPayloadRecord({
        ownerPuuid: puuid,
        source: "league_client",
        sourceMatchId: String(gameId),
        kind: "timeline",
      })
      if (!retained) return undefined
      const dto = retained.body as LcuTimelineResponse
      const frames = Array.isArray(dto) ? dto : dto.frames ?? dto.info?.frames
      if (!frames?.length) return undefined
      const participants = this.db.prepare(
        `SELECT participant_id AS participantId, team_id AS teamId,
                is_player AS isPlayer, summoner_name AS summonerName
         FROM match_participants WHERE game_id = ? AND puuid = ?`,
      ).all(gameId, puuid) as LiveCaptureParticipant[]
      const owner = participants.find((participant) => participant.isPlayer === 1)
      if (!owner) return undefined
      let summary = mapTimeline(
        frames,
        owner.participantId,
        new Map(participants.map((participant) => [
          participant.participantId,
          participant.teamId,
        ])),
      )
      summary = this.liveCaptures?.enrichTimeline(
        gameId,
        puuid,
        summary,
        participants,
      ) ?? summary
      return {
        summary,
        sourcePayload: retained.identity,
        fetchedAt: retained.fetchedAt,
      }
    } catch {
      return undefined
    }
  }

  private async fetchTimelineWithRetry(
    client: Pick<LcuClient, "request">,
    gameId: number,
  ): Promise<LcuTimelineResponse> {
    const path = `/lol-match-history/v1/game-timelines/${gameId}`
    let lastError: unknown
    for (let attempt = 1; attempt <= LCU_TIMELINE_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.requestWithTimeout(client, path)
      } catch (error) {
        lastError = error
        if (attempt === LCU_TIMELINE_MAX_ATTEMPTS || !retryableTimelineError(error)) throw error
        await new Promise<void>((resolve) => setTimeout(
          resolve,
          LCU_TIMELINE_RETRY_DELAY_MS * attempt,
        ))
      }
    }
    throw lastError
  }

  private requestWithTimeout(
    client: Pick<LcuClient, "request">,
    path: string,
  ): Promise<LcuTimelineResponse> {
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new LcuTimelineTimeoutError())
      }, this.requestTimeoutMs)
      void client.request<LcuTimelineResponse>(path).then((value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }, (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      })
    })
  }

  private write(
    gameId: number,
    puuid: string,
    status: TimelineStatus,
    values: {
      fetchedAt?: number
      error?: string
      data?: CompactTimeline
      sourcePayload?: RawPayloadIdentity
    } = {},
  ) {
    if (status === "ready") {
      if (!values.data) throw new Error("ready_timeline_requires_data")
      const capturedAt = values.fetchedAt ?? Date.now()
      new TimelineRepository(this.db).persistReady({
        gameId,
        puuid,
        source: "league_client",
        sourceMatchId: String(gameId),
        mapperVersion: TIMELINE_MAPPER_VERSION,
        timeline: values.data,
        sourcePayloadSha256: values.sourcePayload?.sha256,
        capturedAt,
        fetchedAt: values.fetchedAt,
      })
      return
    }
    new TimelineRepository(this.db).persistStatus({
      gameId,
      puuid,
      source: "league_client",
      sourceMatchId: String(gameId),
      mapperVersion: TIMELINE_MAPPER_VERSION,
      status,
      capturedAt: values.fetchedAt ?? Date.now(),
      fetchedAt: values.fetchedAt,
      error: values.error,
    })
  }
}
