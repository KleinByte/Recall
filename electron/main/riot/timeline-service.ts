import type { Database } from "better-sqlite3"
import { RiotApiClient, RiotApiError } from "./api-client.js"
import {
  mapTimeline,
  TIMELINE_MAPPER_VERSION,
  type CompactTimeline,
} from "./timeline-mapper.js"

interface TimelineDto {
  metadata?: { matchId?: string }
  info?: {
    frames?: Parameters<typeof mapTimeline>[0]
    participants?: { participantId?: number; puuid?: string }[]
  }
}

export class TimelineService {
  private rejectedKey?: string
  private readonly drainingAccounts = new Set<string>()

  constructor(
    private readonly db: Database,
    private readonly apiKey: () => string | undefined,
    private readonly onUpdated: (gameId: number) => void,
    private readonly onReady?: (
      gameId: number,
      puuid: string,
      summary: CompactTimeline,
    ) => void | Promise<void>,
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
    const account = this.db.prepare(
      `SELECT match_puuid AS matchPuuid, regional_route AS regionalRoute,
              platform_id AS platformId
       FROM riot_accounts WHERE puuid = ?`,
    ).get(puuid) as
      | { matchPuuid: string; regionalRoute: string; platformId: string }
      | undefined
    const key = this.apiKey()
    if (key && key === this.rejectedKey && !manualRetry) return current
    if (!key || !account) {
      this.write(gameId, puuid, match.riotMatchId, "pending")
      this.onUpdated(gameId)
      return this.get(gameId, puuid)
    }
    const canonicalId = match.riotMatchId ??
      `${account.platformId.toUpperCase()}_${gameId}`
    this.recordHealth(puuid)
    this.write(gameId, puuid, canonicalId, "loading")
    this.onUpdated(gameId)
    try {
      const api = new RiotApiClient(key, account.regionalRoute)
      const dto = await api.get<TimelineDto>(
        `/lol/match/v5/matches/${encodeURIComponent(canonicalId)}/timeline`,
        "timeline",
      )
      const participants = this.db.prepare(
        `SELECT participant_id AS participantId, team_id AS teamId, is_player AS isPlayer
         FROM match_participants WHERE game_id = ? AND puuid = ?`,
      ).all(gameId, puuid) as {
        participantId: number
        teamId: number
        isPlayer: number
      }[]
      const owner = participants.find((participant) => participant.isPlayer === 1)
      if (!owner || !dto.info?.frames) throw new Error("Timeline participant data is incomplete")
      const summary = mapTimeline(
        dto.info.frames,
        owner.participantId,
        new Map(participants.map((participant) => [
          participant.participantId,
          participant.teamId,
        ])),
      )
      this.db.prepare(
        `UPDATE matches SET riot_match_id = COALESCE(riot_match_id, ?)
         WHERE game_id = ? AND puuid = ?`,
      ).run(dto.metadata?.matchId ?? canonicalId, gameId, puuid)
      this.write(gameId, puuid, dto.metadata?.matchId ?? canonicalId, "ready", {
        fetchedAt: Date.now(),
        data: summary,
      })
      this.recordHealth(puuid, true)
      try {
        await this.onReady?.(gameId, puuid, summary)
      } catch (error) {
        console.warn(`Timeline labels could not be evaluated: ${(error as Error).message}`)
      }
    } catch (error) {
      const unavailable = error instanceof RiotApiError && error.status === 404
      if (error instanceof RiotApiError && (error.status === 401 || error.status === 403)) {
        this.rejectedKey = key
      }
      this.write(
        gameId,
        puuid,
        canonicalId,
        unavailable ? "unavailable" : "error",
        { error: (error as Error).message },
      )
      this.recordHealth(puuid, false, (error as Error).message)
    }
    this.onUpdated(gameId)
    return this.get(gameId, puuid)
  }

  queuePendingBookmarks(puuid: string) {
    const rows = this.db.prepare(
      `SELECT m.game_id AS gameId
       FROM matches m
       JOIN match_annotations a
         ON a.game_id = m.game_id AND a.puuid = m.puuid
       LEFT JOIN match_timeline_cache t
         ON t.game_id = m.game_id AND t.puuid = m.puuid
       WHERE m.puuid = ? AND a.bookmarked = 1
         AND (t.status IS NULL OR t.status IN ('not_requested', 'pending', 'error'))
       ORDER BY m.played_at DESC`,
    ).all(puuid) as { gameId: number }[]
    for (const row of rows) void this.request(row.gameId, puuid)
  }

  /**
   * Pulls timelines for the newest eligible Summoner's Rift games. Missing or
   * rejected keys are normal no-ops, and a small sequential batch prevents a
   * client refresh from bursting Riot's endpoint.
   */
  queueRecentMatches(puuid: string, limit = 4) {
    const key = this.apiKey()
    if (!key || key === this.rejectedKey || this.drainingAccounts.has(puuid)) return
    const account = this.db.prepare(
      "SELECT 1 FROM riot_accounts WHERE puuid = ?",
    ).get(puuid)
    if (!account) return

    this.drainingAccounts.add(puuid)
    void (async () => {
      try {
        const rows = this.db.prepare(
          `SELECT m.game_id AS gameId
           FROM matches m
           LEFT JOIN match_timeline_cache t
             ON t.game_id = m.game_id AND t.puuid = m.puuid
           WHERE m.puuid = ? AND m.mode_family = 'sr' AND m.is_matched = 1
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
          if (this.apiKey() === this.rejectedKey) break
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
    status: "pending" | "loading" | "ready" | "unavailable" | "error",
    values: { fetchedAt?: number; error?: string; data?: CompactTimeline } = {},
  ) {
    this.db.prepare(
      `INSERT INTO match_timeline_cache
       (game_id, puuid, riot_match_id, status, mapper_version,
        fetched_at, last_error, data_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id, puuid) DO UPDATE SET
         riot_match_id = excluded.riot_match_id,
         status = excluded.status,
         mapper_version = excluded.mapper_version,
         fetched_at = excluded.fetched_at,
         last_error = excluded.last_error,
         data_json = excluded.data_json,
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
      Date.now(),
    )
  }

  private recordHealth(puuid: string, success?: boolean, error?: string) {
    const now = Date.now()
    if (success === undefined) {
      this.db.prepare(
        `INSERT INTO sync_health
         (puuid, source, first_observed_at, last_attempt_at, items_seen, items_written)
         VALUES (?, 'riot_timeline', ?, ?, 0, 0)
         ON CONFLICT(puuid, source) DO UPDATE SET
           last_attempt_at = excluded.last_attempt_at`,
      ).run(puuid, now, now)
      return
    }
    this.db.prepare(
      `INSERT INTO sync_health
       (puuid, source, first_observed_at, last_attempt_at, last_success_at,
        last_error_at, last_error, items_seen, items_written)
       VALUES (?, 'riot_timeline', ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(puuid, source) DO UPDATE SET
         last_attempt_at = excluded.last_attempt_at,
         last_success_at = CASE WHEN excluded.last_error IS NULL
           THEN excluded.last_success_at ELSE sync_health.last_success_at END,
         last_error_at = excluded.last_error_at,
         last_error = excluded.last_error,
         items_seen = excluded.items_seen,
         items_written = excluded.items_written`,
    ).run(
      puuid,
      now,
      now,
      success === true ? now : null,
      error ? now : null,
      error ?? null,
      success === true ? 1 : 0,
    )
  }
}
