import type { Database } from "better-sqlite3"
import {
  canonicalJson,
  decodeJsonBodyV1,
  gzipCanonicalJsonV1,
} from "./json-body-codec.js"
export {
  canonicalJson,
  gzipCanonicalJsonV1,
} from "./json-body-codec.js"
export type SourceArtifactKind =
  | "history_page" | "history_summary" | "scoreboard_detail"
  | "champ_select" | "match_detail" | "timeline"
import { TimelineRepository } from "./timeline-repo.js"
import type { CompactTimeline } from "../riot/timeline-mapper.js"

export type RawPayloadSource = "league_client" | "match_v5"
export type RawPayloadMappingStatus = "pending" | "mapped" | "unmappable" | "error"

export function decodeCanonicalJsonV1(payload: Buffer, expectedSha256: string): unknown {
  const { value, text } = decodeJsonBodyV1(payload, expectedSha256)
  if (canonicalJson(value) !== text) throw new Error("payload_not_canonical_json")
  return value
}

export interface PersistRawPayloadInput {
  ownerPuuid: string
  source: RawPayloadSource
  sourceMatchId: string
  gameId?: number | null
  kind: SourceArtifactKind
  body: unknown
  dataVersion?: string | null
  mapperVersion: number
  fetchedAt: number
}

export interface RawPayloadIdentity {
  ownerPuuid: string
  source: RawPayloadSource
  sourceMatchId: string
  kind: SourceArtifactKind
  sha256: string
}

export interface PersistTimelineSourceInput {
  gameId: number
  puuid: string
  source: "league_client" | "match_v5"
  sourceMatchId: string
  mapperVersion: number
  timeline: CompactTimeline
  sourcePayload?: RawPayloadIdentity
  capturedAt: number
}

export class MatchSourceRepository {
  constructor(private readonly db: Database) {}

  hasMappedPayload(input: {
    ownerPuuid: string
    source: RawPayloadSource
    sourceMatchId: string
    kind: SourceArtifactKind
    mapperVersion: number
  }): boolean {
    const row = this.db.prepare(`
      SELECT 1 AS present FROM match_source_payloads
      WHERE owner_puuid = ? AND source = ? AND source_match_id = ? AND kind = ?
        AND mapper_version >= ? AND mapping_status = 'mapped'
      LIMIT 1
    `).get(input.ownerPuuid, input.source, input.sourceMatchId, input.kind,
      input.mapperVersion) as { present: 1 } | undefined
    return row?.present === 1
  }

  hasCurrentTimelineResult(input: {
    gameId: number
    puuid: string
    source: PersistTimelineSourceInput["source"]
    mapperVersion: number
  }): boolean {
    const row = this.db.prepare(`
      SELECT 1 AS present FROM match_timeline_sources
      WHERE game_id = ? AND puuid = ? AND source = ? AND mapper_version = ?
        AND status = 'ready'
      LIMIT 1
    `).get(input.gameId, input.puuid, input.source, input.mapperVersion) as
      { present: 1 } | undefined
    return row?.present === 1
  }

  persistRawPayload(input: PersistRawPayloadInput): RawPayloadIdentity {
    const encoded = gzipCanonicalJsonV1(input.body)
    this.db.prepare(`
      INSERT INTO match_source_payloads
        (owner_puuid, source, source_match_id, game_id, kind, encoding, payload,
         sha256, data_version, mapper_version, serialization_version,
         mapping_status, mapping_error, mapped_at, fetched_at,
         first_fetched_at, last_fetched_at, observation_count)
      VALUES (?, ?, ?, ?, ?, 'gzip_json_v1', ?, ?, ?, ?, 1, 'pending', NULL, NULL,
              ?, ?, ?, 1)
      ON CONFLICT(owner_puuid, source, source_match_id, kind, sha256) DO UPDATE SET
        game_id = COALESCE(match_source_payloads.game_id, excluded.game_id),
        data_version = COALESCE(excluded.data_version, match_source_payloads.data_version),
        mapper_version = MAX(match_source_payloads.mapper_version, excluded.mapper_version),
        mapping_status = CASE
          WHEN excluded.mapper_version > match_source_payloads.mapper_version THEN 'pending'
          ELSE match_source_payloads.mapping_status
        END,
        mapping_error = CASE
          WHEN excluded.mapper_version > match_source_payloads.mapper_version THEN NULL
          ELSE match_source_payloads.mapping_error
        END,
        mapped_at = CASE
          WHEN excluded.mapper_version > match_source_payloads.mapper_version THEN NULL
          ELSE match_source_payloads.mapped_at
        END,
        fetched_at = MAX(match_source_payloads.fetched_at, excluded.fetched_at),
        first_fetched_at = MIN(
          COALESCE(match_source_payloads.first_fetched_at, match_source_payloads.fetched_at),
          excluded.fetched_at
        ),
        last_fetched_at = MAX(
          COALESCE(match_source_payloads.last_fetched_at, match_source_payloads.fetched_at),
          excluded.fetched_at
        ),
        observation_count = match_source_payloads.observation_count + 1
    `).run(
      input.ownerPuuid, input.source, input.sourceMatchId, input.gameId ?? null,
      input.kind, encoded.payload, encoded.sha256, input.dataVersion ?? null,
      input.mapperVersion, input.fetchedAt, input.fetchedAt, input.fetchedAt,
    )
    return {
      ownerPuuid: input.ownerPuuid,
      source: input.source,
      sourceMatchId: input.sourceMatchId,
      kind: input.kind,
      sha256: encoded.sha256,
    }
  }

  read(identity: RawPayloadIdentity): unknown {
    const row = this.db.prepare(`
      SELECT payload, sha256 FROM match_source_payloads
      WHERE owner_puuid = ? AND source = ? AND source_match_id = ? AND kind = ? AND sha256 = ?
    `).get(identity.ownerPuuid, identity.source, identity.sourceMatchId,
      identity.kind, identity.sha256) as { payload: Buffer; sha256: string } | undefined
    if (!row) throw new Error("source_payload_not_found")
    return decodeCanonicalJsonV1(row.payload, row.sha256)
  }

  readLatestPayload(input: {
    ownerPuuid: string
    source: RawPayloadSource
    sourceMatchId: string
    kind: SourceArtifactKind
  }): unknown | undefined {
    const row = this.db.prepare(`
      SELECT payload, sha256 FROM match_source_payloads
      WHERE owner_puuid = ? AND source = ? AND source_match_id = ? AND kind = ?
      ORDER BY fetched_at DESC, rowid DESC LIMIT 1
    `).get(input.ownerPuuid, input.source, input.sourceMatchId, input.kind) as
      { payload: Buffer; sha256: string } | undefined
    return row ? decodeCanonicalJsonV1(row.payload, row.sha256) : undefined
  }

  readLatestPayloadRecord(input: {
    ownerPuuid: string
    source: RawPayloadSource
    sourceMatchId: string
    kind: SourceArtifactKind
  }): {
    identity: RawPayloadIdentity
    body: unknown
    fetchedAt: number
  } | undefined {
    const row = this.db.prepare(`
      SELECT payload, sha256, fetched_at AS fetchedAt
      FROM match_source_payloads
      WHERE owner_puuid = ? AND source = ? AND source_match_id = ? AND kind = ?
      ORDER BY fetched_at DESC, rowid DESC LIMIT 1
    `).get(input.ownerPuuid, input.source, input.sourceMatchId, input.kind) as
      { payload: Buffer; sha256: string; fetchedAt: number } | undefined
    if (!row) return undefined
    return {
      identity: { ...input, sha256: row.sha256 },
      body: decodeCanonicalJsonV1(row.payload, row.sha256),
      fetchedAt: row.fetchedAt,
    }
  }

  setMappingResult(
    identity: RawPayloadIdentity,
    status: Exclude<RawPayloadMappingStatus, "pending">,
    mappedAt: number,
    options: { gameId?: number; error?: string; mapperVersion?: number } = {},
  ): void {
    if (status === "mapped" && options.gameId === undefined && identity.kind !== "history_page") {
      throw new Error("mapped_payload_requires_game")
    }
    if (status !== "mapped" && !options.error) throw new Error("failed_mapping_requires_error")
    this.db.prepare(`
      UPDATE match_source_payloads
      SET game_id = COALESCE(?, game_id),
          mapper_version = MAX(mapper_version, COALESCE(?, mapper_version)),
          mapping_status = ?, mapping_error = ?, mapped_at = ?
      WHERE owner_puuid = ? AND source = ? AND source_match_id = ? AND kind = ? AND sha256 = ?
    `).run(options.gameId ?? null, options.mapperVersion ?? null,
      status, status === "mapped" ? null : options.error, mappedAt,
      identity.ownerPuuid, identity.source, identity.sourceMatchId,
      identity.kind, identity.sha256)
  }

  persistTimelineSource(input: PersistTimelineSourceInput): void {
    new TimelineRepository(this.db).persistReady({
      ...input,
      sourcePayloadSha256: input.sourcePayload?.sha256,
    })
  }

  markTimelineUnavailable(input: {
    gameId: number
    puuid: string
    source: PersistTimelineSourceInput["source"]
    sourceMatchId: string
    mapperVersion: number
    capturedAt: number
    reason: string
  }): void {
    new TimelineRepository(this.db).persistStatus({
      ...input,
      status: "unavailable",
      fetchedAt: input.capturedAt,
      error: input.reason,
    })
  }
}
