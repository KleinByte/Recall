import type { Database } from "better-sqlite3"
import { createHash } from "node:crypto"
import { canonicalJson } from "./json-body-codec.js"
import {
  TIMELINE_MAPPER_VERSION,
  type CompactTimeline,
} from "../riot/timeline-mapper.js"

export type TimelineSource = "league_client" | "match_v5"
export type TimelineSourceStatus =
  | "pending"
  | "loading"
  | "ready"
  | "unavailable"
  | "error"

export interface TimelineSourceCandidate {
  gameId?: number
  puuid?: string
  source: TimelineSource
  sourceMatchId?: string | null
  mapperVersion: number
  status: TimelineSourceStatus
  dataJson?: string | null
  dataSha256?: string | null
  sourcePayloadSha256?: string | null
  capturedAt: number
  fetchedAt?: number | null
  error?: string | null
  updatedAt?: number
}

export interface SelectedTimeline extends TimelineSourceCandidate {
  gameId: number
  puuid: string
  status: "ready"
  dataJson: string
  dataSha256: string
  summary: CompactTimeline
}

export interface TimelineState {
  status: "not_requested" | TimelineSourceStatus
  summary?: CompactTimeline
  error?: string
  fetchedAt?: number
}

const AUTHORITY: Record<TimelineSource, number> = {
  // Match-V5 is Riot's canonical post-game artifact. The local endpoint is a
  // valuable keyless fallback but has repeatedly omitted/duplicated fields.
  match_v5: 0,
  league_client: 1,
}

function assertSourceIdentity(input: {
  gameId: number
  source: TimelineSource
  sourceMatchId: string
}): void {
  if (!input.sourceMatchId.trim()) throw new Error("timeline_source_match_id_required")
  if (input.source === "league_client" &&
      input.sourceMatchId !== String(input.gameId)) {
    throw new Error("timeline_lcu_source_identity_mismatch")
  }
}

export function selectTimelineSource(
  candidates: readonly TimelineSourceCandidate[],
  mapperVersion = TIMELINE_MAPPER_VERSION,
): TimelineSourceCandidate | undefined {
  return candidates.filter((candidate) => candidate.mapperVersion === mapperVersion &&
    candidate.status === "ready" && candidate.dataJson)
    .sort((left, right) => AUTHORITY[left.source] - AUTHORITY[right.source] ||
      right.capturedAt - left.capturedAt)[0]
}

export function timelineEvidenceCounts(timeline: CompactTimeline) {
  return {
    version: 1,
    participants: {
      expected: null,
      observed: timeline.frames[0]?.participants.length ?? 0,
    },
    frames: {
      total: timeline.frames.length,
      economy: timeline.frames.length,
      progression: timeline.frames.length,
      farm: timeline.frames.length,
      position: timeline.frames.filter((frame) =>
        frame.participants.some((participant) => participant.position)).length,
    },
    events: {
      championKill: timeline.events.filter((event) => event.type === "CHAMPION_KILL").length,
      item: timeline.events.filter((event) => event.category === "item").length,
      neutralObjective: timeline.events.filter((event) =>
        event.type === "ELITE_MONSTER_KILL").length,
      structure: timeline.events.filter((event) =>
        event.type === "BUILDING_KILL" || event.type === "TURRET_PLATE_DESTROYED").length,
      ward: timeline.events.filter((event) => event.category === "vision").length,
      levelExact: timeline.events.filter((event) =>
        event.category === "level" && !event.approximate).length,
      gameEnd: timeline.events.filter((event) => event.category === "game").length,
      augmentSelection: 0,
      unknownVariant: 0,
    },
  }
}

export function timelineSourceMetadata(timeline: CompactTimeline) {
  const dataJson = canonicalJson(timeline)
  return {
    dataJson,
    dataSha256: createHash("sha256").update(dataJson).digest("hex"),
    eventCategoriesJson: canonicalJson(
      [...new Set(timeline.events.map((event) => event.category))].sort(),
    ),
    evidenceCountsJson: canonicalJson(timelineEvidenceCounts(timeline)),
  }
}

function selectedRow(row: Omit<SelectedTimeline, "summary"> | undefined): SelectedTimeline | undefined {
  if (!row) return undefined
  return { ...row, summary: JSON.parse(row.dataJson) as CompactTimeline }
}

/**
 * Owns the single timeline-source contract used by review, records, analytics,
 * and Grade/RVI. `selected_match_timelines` is a schema-owned current-source
 * view, while raw remapping evidence remains in `match_source_payloads`.
 */
export class TimelineRepository {
  constructor(private readonly db: Database) {}

  selected(gameId: number, puuid: string): SelectedTimeline | undefined {
    const row = this.db.prepare(`
      SELECT game_id AS gameId, puuid, source,
             source_match_id AS sourceMatchId,
             mapper_version AS mapperVersion, status,
             data_json AS dataJson, data_sha256 AS dataSha256,
             source_payload_sha256 AS sourcePayloadSha256,
             captured_at AS capturedAt, fetched_at AS fetchedAt,
             last_error AS error, updated_at AS updatedAt
      FROM selected_match_timelines
      WHERE game_id = ? AND puuid = ?
    `).get(gameId, puuid) as Omit<SelectedTimeline, "summary"> | undefined
    return selectedRow(row)
  }

  source(
    gameId: number,
    puuid: string,
    source: TimelineSource,
  ): TimelineSourceCandidate | undefined {
    return this.db.prepare(`
      SELECT game_id AS gameId, puuid, source,
             source_match_id AS sourceMatchId,
             mapper_version AS mapperVersion, status,
             data_json AS dataJson, data_sha256 AS dataSha256,
             source_payload_sha256 AS sourcePayloadSha256,
             captured_at AS capturedAt, fetched_at AS fetchedAt,
             last_error AS error, updated_at AS updatedAt
      FROM match_timeline_sources
      WHERE game_id = ? AND puuid = ? AND source = ?
    `).get(gameId, puuid, source) as TimelineSourceCandidate | undefined
  }

  state(gameId: number, puuid: string): TimelineState {
    const selected = this.selected(gameId, puuid)
    if (selected) {
      return {
        status: "ready",
        summary: selected.summary,
        fetchedAt: selected.fetchedAt ?? selected.capturedAt,
      }
    }
    const local = this.source(gameId, puuid, "league_client")
    if (!local || local.mapperVersion !== TIMELINE_MAPPER_VERSION) {
      return { status: "not_requested" }
    }
    return {
      status: local.status,
      error: local.error ?? undefined,
      fetchedAt: local.fetchedAt ?? undefined,
    }
  }

  listSelected(puuid: string): SelectedTimeline[] {
    const rows = this.db.prepare(`
      SELECT game_id AS gameId, puuid, source,
             source_match_id AS sourceMatchId,
             mapper_version AS mapperVersion, status,
             data_json AS dataJson, data_sha256 AS dataSha256,
             source_payload_sha256 AS sourcePayloadSha256,
             captured_at AS capturedAt, fetched_at AS fetchedAt,
             last_error AS error, updated_at AS updatedAt
      FROM selected_match_timelines
      WHERE puuid = ?
      ORDER BY game_id
    `).all(puuid) as Array<Omit<SelectedTimeline, "summary">>
    return rows.map((row) => selectedRow(row)!)
  }

  countSelected(puuid: string): number {
    return Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM selected_match_timelines WHERE puuid = ?
    `).get(puuid) as { count: number }).count)
  }

  persistReady(input: {
    gameId: number
    puuid: string
    source: TimelineSource
    sourceMatchId: string
    mapperVersion: number
    timeline: CompactTimeline
    sourcePayloadSha256?: string
    capturedAt: number
    fetchedAt?: number
    updatedAt?: number
  }): void {
    assertSourceIdentity(input)
    if (input.sourcePayloadSha256) {
      const payload = this.db.prepare(`
        SELECT 1 AS present FROM match_source_payloads
        WHERE owner_puuid = ? AND source = ? AND source_match_id = ?
          AND kind = 'timeline' AND encoding = 'gzip_json_v1' AND sha256 = ?
      `).get(
        input.puuid,
        input.source,
        input.sourceMatchId,
        input.sourcePayloadSha256,
      ) as { present: 1 } | undefined
      if (!payload) throw new Error("timeline_source_payload_link_invalid")
    }
    const metadata = timelineSourceMetadata(input.timeline)
    this.db.prepare(`
      INSERT INTO match_timeline_sources
        (game_id, puuid, source, source_match_id, mapper_version, status,
         data_json, data_sha256, event_categories_json, evidence_counts_json,
         source_payload_sha256, captured_at, fetched_at, last_error, updated_at)
      VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(game_id, puuid, source) DO UPDATE SET
        source_match_id = excluded.source_match_id,
        mapper_version = excluded.mapper_version,
        status = 'ready', data_json = excluded.data_json,
        data_sha256 = excluded.data_sha256,
        event_categories_json = excluded.event_categories_json,
        evidence_counts_json = excluded.evidence_counts_json,
        source_payload_sha256 = excluded.source_payload_sha256,
        captured_at = excluded.captured_at,
        fetched_at = excluded.fetched_at,
        last_error = NULL, updated_at = excluded.updated_at
    `).run(
      input.gameId, input.puuid, input.source, input.sourceMatchId,
      input.mapperVersion, metadata.dataJson, metadata.dataSha256,
      metadata.eventCategoriesJson, metadata.evidenceCountsJson,
      input.sourcePayloadSha256 ?? null, input.capturedAt,
      input.fetchedAt ?? input.capturedAt, input.updatedAt ?? Date.now(),
    )
  }

  persistStatus(input: {
    gameId: number
    puuid: string
    source: TimelineSource
    sourceMatchId: string
    mapperVersion: number
    status: Exclude<TimelineSourceStatus, "ready">
    capturedAt: number
    fetchedAt?: number
    error?: string
    updatedAt?: number
  }): void {
    assertSourceIdentity(input)
    const evidenceJson = canonicalJson({
      version: 1,
      ...(input.error ? { reason: input.error } : {}),
    })
    this.db.prepare(`
      INSERT INTO match_timeline_sources
        (game_id, puuid, source, source_match_id, mapper_version, status,
         data_json, data_sha256, event_categories_json, evidence_counts_json,
         source_payload_sha256, captured_at, fetched_at, last_error, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, '[]', ?, NULL, ?, ?, ?, ?)
      ON CONFLICT(game_id, puuid, source) DO UPDATE SET
        source_match_id = excluded.source_match_id,
        mapper_version = CASE
          WHEN match_timeline_sources.status = 'ready'
            AND match_timeline_sources.mapper_version = excluded.mapper_version
          THEN match_timeline_sources.mapper_version ELSE excluded.mapper_version END,
        status = CASE
          WHEN match_timeline_sources.status = 'ready'
            AND match_timeline_sources.mapper_version = excluded.mapper_version
          THEN 'ready' ELSE excluded.status END,
        data_json = CASE
          WHEN match_timeline_sources.status = 'ready'
            AND match_timeline_sources.mapper_version = excluded.mapper_version
          THEN match_timeline_sources.data_json ELSE NULL END,
        data_sha256 = CASE
          WHEN match_timeline_sources.status = 'ready'
            AND match_timeline_sources.mapper_version = excluded.mapper_version
          THEN match_timeline_sources.data_sha256 ELSE NULL END,
        event_categories_json = CASE
          WHEN match_timeline_sources.status = 'ready'
            AND match_timeline_sources.mapper_version = excluded.mapper_version
          THEN match_timeline_sources.event_categories_json ELSE '[]' END,
        evidence_counts_json = CASE
          WHEN match_timeline_sources.status = 'ready'
            AND match_timeline_sources.mapper_version = excluded.mapper_version
          THEN match_timeline_sources.evidence_counts_json ELSE excluded.evidence_counts_json END,
        source_payload_sha256 = CASE
          WHEN match_timeline_sources.status = 'ready'
            AND match_timeline_sources.mapper_version = excluded.mapper_version
          THEN match_timeline_sources.source_payload_sha256 ELSE NULL END,
        captured_at = MAX(match_timeline_sources.captured_at, excluded.captured_at),
        fetched_at = COALESCE(excluded.fetched_at, match_timeline_sources.fetched_at),
        last_error = CASE
          WHEN match_timeline_sources.status = 'ready'
            AND match_timeline_sources.mapper_version = excluded.mapper_version
          THEN NULL ELSE excluded.last_error END,
        updated_at = excluded.updated_at
    `).run(
      input.gameId, input.puuid, input.source, input.sourceMatchId,
      input.mapperVersion, input.status, evidenceJson, input.capturedAt,
      input.fetchedAt ?? null, input.error ?? null, input.updatedAt ?? Date.now(),
    )
  }

  staleLocalReadyGames(puuid: string): number[] {
    return (this.db.prepare(`
      SELECT game_id AS gameId
      FROM match_timeline_sources
      WHERE puuid = ? AND source = 'league_client' AND status = 'ready'
        AND mapper_version <> ?
      ORDER BY game_id
    `).all(puuid, TIMELINE_MAPPER_VERSION) as { gameId: number }[])
      .map((row) => row.gameId)
  }

  captureCandidates(puuid: string, staleLoadingBefore: number, limit: number): number[] {
    return (this.db.prepare(`
      SELECT m.game_id AS gameId
      FROM matches m
      LEFT JOIN match_timeline_sources local
        ON local.game_id = m.game_id AND local.puuid = m.puuid
       AND local.source = 'league_client'
      LEFT JOIN selected_match_timelines selected
        ON selected.game_id = m.game_id AND selected.puuid = m.puuid
      WHERE m.puuid = ? AND m.mode_family IN ('sr', 'aram', 'classic')
        AND m.is_matched = 1 AND selected.game_id IS NULL
        AND EXISTS (
          SELECT 1 FROM match_participants p
          WHERE p.game_id = m.game_id AND p.puuid = m.puuid AND p.is_player = 1
        )
        AND (
          local.game_id IS NULL OR local.mapper_version <> ? OR
          local.status IN ('pending', 'error') OR
          (local.status = 'loading' AND local.updated_at <= ?)
        )
      ORDER BY m.played_at DESC
      LIMIT ?
    `).all(puuid, TIMELINE_MAPPER_VERSION, staleLoadingBefore, limit) as { gameId: number }[])
      .map((row) => row.gameId)
  }
}
