import type { Database } from "better-sqlite3"
import type { LiveGameCaptureRepository } from "./database/live-game-capture-repo.js"
import { LcuRequestError, type LcuClient } from "./lcu-client.js"
import {
  mapTimeline,
  TIMELINE_MAPPER_VERSION,
  type CompactTimeline,
} from "./riot/timeline-mapper.js"

type TimelineFrames = Parameters<typeof mapTimeline>[0]

interface LcuTimelineDto {
  frames?: TimelineFrames
  info?: { frames?: TimelineFrames }
}

type LcuTimelineResponse = LcuTimelineDto | TimelineFrames

type TimelineStatus = "pending" | "loading" | "ready" | "unavailable" | "error"

/**
 * Reads recent timelines from the authenticated local League Client.
 *
 * The developer API is deliberately not a fallback here. It is reserved for
 * the explicit Settings history import, while normal review and post-game
 * enrichment remain local and keyless.
 */
export class LcuTimelineService {
  private readonly drainingAccounts = new Set<string>()

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
  ) {}

  get(gameId: number, puuid: string) {
    const row = this.db.prepare(
      `SELECT status, mapper_version AS mapperVersion,
              fetched_at AS fetchedAt, last_error AS error, data_json AS dataJson
       FROM match_timeline_cache WHERE game_id = ? AND puuid = ?`,
    ).get(gameId, puuid) as
      | { status: string; mapperVersion: number; fetchedAt?: number; error?: string; dataJson?: string }
      | undefined
    if (!row || row.mapperVersion !== TIMELINE_MAPPER_VERSION) {
      return { status: "not_requested" as const }
    }
    return {
      status: row.status,
      summary: row.status === "ready" && row.dataJson
        ? JSON.parse(row.dataJson) as CompactTimeline
        : undefined,
      error: row.error ?? undefined,
      fetchedAt: row.fetchedAt ?? undefined,
    }
  }

  async request(gameId: number, puuid: string, manualRetry = false) {
    const current = this.get(gameId, puuid)
    if (current.status === "ready") return current
    if (current.status === "unavailable" && !manualRetry) return current

    const match = this.db.prepare(
      `SELECT riot_match_id AS riotMatchId FROM matches
       WHERE game_id = ? AND puuid = ?`,
    ).get(gameId, puuid) as { riotMatchId?: string } | undefined
    if (!match) throw new Error("Match not found")

    const client = this.client()
    if (!client) {
      this.write(gameId, puuid, match.riotMatchId, "pending")
      this.onUpdated(gameId)
      return this.get(gameId, puuid)
    }

    this.write(gameId, puuid, match.riotMatchId, "loading")
    this.onUpdated(gameId)

    try {
      const dto = await client.request<LcuTimelineResponse>(
        `/lol-match-history/v1/game-timelines/${gameId}`,
      )
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
        throw new Error("League Client timeline data is incomplete")
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
      this.write(gameId, puuid, match.riotMatchId, "ready", {
        fetchedAt: Date.now(),
        data: summary,
        raw: dto,
      })
      try {
        await this.onReady?.(gameId, puuid, summary)
      } catch (error) {
        console.warn(`Timeline labels could not be evaluated: ${(error as Error).message}`)
      }
    } catch (error) {
      const unavailable = error instanceof LcuRequestError && error.status === 404
      this.write(
        gameId,
        puuid,
        match.riotMatchId,
        unavailable ? "unavailable" : "error",
        { error: (error as Error).message },
      )
    }

    this.onUpdated(gameId)
    return this.get(gameId, puuid)
  }

  /** Captures the complete local timeline window before games age out. */
  queueRecentMatches(puuid: string, limit = 20) {
    if (!this.client() || this.drainingAccounts.has(puuid)) return
    this.drainingAccounts.add(puuid)

    void (async () => {
      try {
        const rows = this.db.prepare(
          `SELECT m.game_id AS gameId
           FROM matches m
           LEFT JOIN match_timeline_cache t
             ON t.game_id = m.game_id AND t.puuid = m.puuid
           WHERE m.puuid = ? AND m.mode_family IN ('sr', 'aram')
             AND m.is_matched = 1
             AND EXISTS (
               SELECT 1 FROM match_participants p
               WHERE p.game_id = m.game_id AND p.puuid = m.puuid
                 AND p.is_player = 1
             )
             AND (
               t.status IS NULL OR t.mapper_version <> ? OR
               t.status IN ('not_requested', 'pending', 'error')
             )
           ORDER BY m.played_at DESC
           LIMIT ?`,
        ).all(puuid, TIMELINE_MAPPER_VERSION, limit) as { gameId: number }[]

        for (const row of rows) {
          if (!this.client()) break
          await this.request(row.gameId, puuid)
        }
      } finally {
        this.drainingAccounts.delete(puuid)
      }
    })()
  }

  private write(
    gameId: number,
    puuid: string,
    riotMatchId: string | undefined,
    status: TimelineStatus,
    values: {
      fetchedAt?: number
      error?: string
      data?: CompactTimeline
      raw?: LcuTimelineResponse
    } = {},
  ) {
    this.db.prepare(
      `INSERT INTO match_timeline_cache
       (game_id, puuid, riot_match_id, status, mapper_version,
        fetched_at, last_error, data_json, raw_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id, puuid) DO UPDATE SET
         riot_match_id = excluded.riot_match_id,
         status = excluded.status,
         mapper_version = excluded.mapper_version,
         fetched_at = excluded.fetched_at,
         last_error = excluded.last_error,
         data_json = excluded.data_json,
         raw_json = COALESCE(excluded.raw_json, match_timeline_cache.raw_json),
         updated_at = excluded.updated_at`,
    ).run(
      gameId,
      puuid,
      riotMatchId ?? null,
      status,
      TIMELINE_MAPPER_VERSION,
      values.fetchedAt ?? null,
      values.error ?? null,
      values.data ? JSON.stringify(values.data) : null,
      values.raw ? JSON.stringify(values.raw) : null,
      Date.now(),
    )
  }
}
