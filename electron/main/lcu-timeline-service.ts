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
  canonicalJson,
  type RawPayloadIdentity,
} from "./database/match-source-repo.js"
import { createHash } from "node:crypto"
import { refreshTimelineCompatibilityCache } from "./matches/timeline-source-selector.js"

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
  ) {}

  get(gameId: number, puuid: string) {
    const row = this.db.prepare(
      `SELECT status, mapper_version AS mapperVersion,
              riot_match_id AS riotMatchId, fetched_at AS fetchedAt,
              last_error AS error, data_json AS dataJson, raw_json AS rawJson
       FROM match_timeline_cache WHERE game_id = ? AND puuid = ?`,
    ).get(gameId, puuid) as
      | {
        status: string
        mapperVersion: number
        riotMatchId?: string
        fetchedAt?: number
        error?: string
        dataJson?: string
        rawJson?: string
      }
      | undefined
    if (!row) {
      return { status: "not_requested" as const }
    }
    if (row.mapperVersion !== TIMELINE_MAPPER_VERSION) {
      const summary = row.status === "ready" && row.rawJson
        ? this.remapCached(gameId, puuid, row.rawJson)
        : undefined
      if (!summary) return { status: "not_requested" as const }
      this.write(gameId, puuid, row.riotMatchId, "ready", {
        fetchedAt: row.fetchedAt ?? Date.now(),
        data: summary,
      })
      void Promise.resolve(this.onReady?.(gameId, puuid, summary)).catch((error) => {
        console.warn(`Timeline labels could not be reevaluated: ${(error as Error).message}`)
      })
      return { status: "ready" as const, summary, fetchedAt: row.fetchedAt }
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

    let rawPayload: RawPayloadIdentity | undefined
    let sourceRepository: MatchSourceRepository | undefined
    try {
      const dto = await client.request<LcuTimelineResponse>(
        `/lol-match-history/v1/game-timelines/${gameId}`,
      )
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
        fetchedAt,
        data: summary,
        sourcePayload: rawPayload,
      })
      sourceRepository.setMappingResult(rawPayload, "mapped", fetchedAt, { gameId })
      try {
        await this.onReady?.(gameId, puuid, summary)
      } catch (error) {
        console.warn(`Timeline labels could not be evaluated: ${(error as Error).message}`)
      }
    } catch (error) {
      if (rawPayload && sourceRepository) {
        sourceRepository.setMappingResult(rawPayload, "unmappable", Date.now(), {
          gameId,
          error: error instanceof Error ? error.message.slice(0, 500) : "timeline_unmappable",
        })
      }
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
  queueRecentMatches(puuid: string, limit = 20): Promise<void> | undefined {
    const active = this.drainingTasks.get(puuid)
    if (active) return active
    if (!this.client() || this.drainingAccounts.has(puuid)) return
    this.drainingAccounts.add(puuid)

    const task = Promise.resolve().then(async () => {
      try {
        const rows = this.db.prepare(
          `SELECT m.game_id AS gameId
           FROM matches m
           LEFT JOIN match_timeline_cache t
             ON t.game_id = m.game_id AND t.puuid = m.puuid
           WHERE m.puuid = ? AND m.mode_family IN ('sr', 'aram', 'classic')
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
        this.drainingTasks.delete(puuid)
      }
    })
    this.drainingTasks.set(puuid, task)
    return task
  }

  /** Reprocesses durable raw LCU data when mapping logic gains richer fields. */
  private remapCached(gameId: number, puuid: string, rawJson: string) {
    try {
      const dto = JSON.parse(rawJson) as LcuTimelineResponse
      const frames = Array.isArray(dto) ? dto : dto.frames ?? dto.info?.frames
      if (!frames?.length) return undefined
      const participants = this.db.prepare(
        `SELECT participant_id AS participantId, team_id AS teamId,
                is_player AS isPlayer, summoner_name AS summonerName
         FROM match_participants WHERE game_id = ? AND puuid = ?`,
      ).all(gameId, puuid) as LiveCaptureParticipant[]
      const owner = participants.find((participant) => participant.isPlayer === 1)
      if (!owner) return undefined
      const summary = mapTimeline(
        frames,
        owner.participantId,
        new Map(participants.map((participant) => [
          participant.participantId,
          participant.teamId,
        ])),
      )
      return this.liveCaptures?.enrichTimeline(
        gameId,
        puuid,
        summary,
        participants,
      ) ?? summary
    } catch {
      return undefined
    }
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
      sourcePayload?: RawPayloadIdentity
    } = {},
  ) {
    if (status === "ready" && values.data) {
      const dataJson = canonicalJson(values.data)
      const dataSha256 = createHash("sha256").update(dataJson).digest("hex")
      const capturedAt = values.fetchedAt ?? Date.now()
      this.db.prepare(`
        INSERT INTO match_timeline_sources
          (game_id, puuid, source, source_match_id, mapper_version, status,
           data_json, data_sha256, event_categories_json, evidence_counts_json,
           source_payload_sha256, captured_at, updated_at)
        VALUES (?, ?, 'league_client', ?, ?, 'ready', ?, ?, '[]', ?, ?, ?, ?)
        ON CONFLICT(game_id, puuid, source, mapper_version) DO UPDATE SET
          source_match_id = excluded.source_match_id, status = 'ready',
          data_json = excluded.data_json, data_sha256 = excluded.data_sha256,
          event_categories_json = excluded.event_categories_json,
          evidence_counts_json = excluded.evidence_counts_json,
          source_payload_sha256 = excluded.source_payload_sha256,
          captured_at = excluded.captured_at, updated_at = excluded.updated_at
      `).run(
        gameId, puuid, String(gameId), TIMELINE_MAPPER_VERSION, dataJson, dataSha256,
        canonicalJson({
          version: 1,
          participants: { expected: null, observed: values.data.frames[0]?.participants.length ?? 0 },
          frames: {
            total: values.data.frames.length,
            economy: values.data.frames.length,
            progression: values.data.frames.length,
            farm: values.data.frames.length,
            position: values.data.frames.filter((frame) =>
              frame.participants.some((participant) => participant.position)).length,
          },
          events: {
            championKill: values.data.events.filter((event) => event.category === "kill").length,
            item: values.data.events.filter((event) => event.category === "item").length,
            neutralObjective: values.data.events.filter((event) => event.category === "objective").length,
            structure: 0, ward: values.data.events.filter((event) => event.category === "vision").length,
            levelExact: values.data.events.filter((event) => event.category === "level" && !event.approximate).length,
            gameEnd: values.data.events.filter((event) => event.category === "game").length,
            augmentSelection: 0, unknownVariant: 0,
          },
        }),
        values.sourcePayload?.sha256 ?? null, capturedAt, Date.now(),
      )
      refreshTimelineCompatibilityCache(this.db, gameId, puuid)
      return
    }
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
