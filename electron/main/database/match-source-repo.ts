import type { Database } from "better-sqlite3"
import { createHash } from "node:crypto"
import { gunzipSync, gzipSync } from "node:zlib"
import type { SourceArtifactKind } from "../matches/source-capabilities.js"
import { refreshTimelineCompatibilityCache } from
  "../matches/timeline-source-selector.js"
import type { CompactTimeline } from "../riot/timeline-mapper.js"

export type RawPayloadSource = "league_client" | "match_v5"
export type RawPayloadMappingStatus = "pending" | "mapped" | "unmappable" | "error"

const unicodeCodePointCompare = (left: string, right: string) => {
  const a = Array.from(left, (character) => character.codePointAt(0)!)
  const b = Array.from(right, (character) => character.codePointAt(0)!)
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return a.length - b.length
}

export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, current: unknown) => {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return current
    return Object.fromEntries(Object.keys(current as Record<string, unknown>)
      .sort(unicodeCodePointCompare)
      .map((key) => [key, (current as Record<string, unknown>)[key]]))
  })
  if (serialized === undefined) throw new Error("payload_is_not_json")
  return serialized
}

export interface EncodedCanonicalJson {
  canonicalBytes: Buffer
  payload: Buffer
  sha256: string
}

export function gzipCanonicalJsonV1(value: unknown): EncodedCanonicalJson {
  const canonicalBytes = Buffer.from(canonicalJson(value), "utf8")
  const payload = gzipSync(canonicalBytes, { level: 9, mtime: 0 } as never)
  if (payload[0] !== 0x1f || payload[1] !== 0x8b || payload[2] !== 8) {
    throw new Error("unexpected_gzip_header")
  }
  payload[3] = 0
  payload.writeUInt32LE(0, 4)
  payload[8] = 2
  payload[9] = 255
  return {
    canonicalBytes,
    payload,
    sha256: createHash("sha256").update(canonicalBytes).digest("hex"),
  }
}

export function decodeCanonicalJsonV1(payload: Buffer, expectedSha256: string): unknown {
  if (payload.length < 18 || payload[0] !== 0x1f || payload[1] !== 0x8b || payload[2] !== 8 ||
      payload[3] !== 0 || payload.readUInt32LE(4) !== 0 || payload[8] !== 2 || payload[9] !== 255) {
    throw new Error("invalid_gzip_json_v1_header")
  }
  const result = gunzipSync(payload, { info: true } as never) as unknown as {
    buffer: Buffer
    engine: { bytesWritten: number }
  }
  const bytes = Buffer.isBuffer(result) ? result : result.buffer
  if (!Buffer.isBuffer(result) && result.engine.bytesWritten !== payload.length) {
    throw new Error("trailing_gzip_bytes")
  }
  const hash = createHash("sha256").update(bytes).digest("hex")
  if (hash !== expectedSha256) throw new Error("payload_sha256_mismatch")
  const text = bytes.toString("utf8")
  const value = JSON.parse(text) as unknown
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

function timelineEvidenceCounts(timeline: CompactTimeline) {
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
         mapping_status, mapping_error, mapped_at, fetched_at)
      VALUES (?, ?, ?, ?, ?, 'gzip_json_v1', ?, ?, ?, ?, 1, 'pending', NULL, NULL, ?)
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
        fetched_at = MAX(match_source_payloads.fetched_at, excluded.fetched_at)
    `).run(
      input.ownerPuuid, input.source, input.sourceMatchId, input.gameId ?? null,
      input.kind, encoded.payload, encoded.sha256, input.dataVersion ?? null,
      input.mapperVersion, input.fetchedAt,
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

  setMappingResult(
    identity: RawPayloadIdentity,
    status: Exclude<RawPayloadMappingStatus, "pending">,
    mappedAt: number,
    options: { gameId?: number; error?: string } = {},
  ): void {
    if (status === "mapped" && options.gameId === undefined && identity.kind !== "history_page") {
      throw new Error("mapped_payload_requires_game")
    }
    if (status !== "mapped" && !options.error) throw new Error("failed_mapping_requires_error")
    this.db.prepare(`
      UPDATE match_source_payloads
      SET game_id = COALESCE(?, game_id), mapping_status = ?, mapping_error = ?, mapped_at = ?
      WHERE owner_puuid = ? AND source = ? AND source_match_id = ? AND kind = ? AND sha256 = ?
    `).run(options.gameId ?? null, status, status === "mapped" ? null : options.error,
      mappedAt, identity.ownerPuuid, identity.source, identity.sourceMatchId,
      identity.kind, identity.sha256)
  }

  persistTimelineSource(input: PersistTimelineSourceInput): void {
    const dataJson = canonicalJson(input.timeline)
    const dataSha256 = createHash("sha256").update(dataJson).digest("hex")
    const categories = [...new Set(input.timeline.events.map((event) => event.category))]
      .sort()
    this.db.prepare(`
      INSERT INTO match_timeline_sources
        (game_id, puuid, source, source_match_id, mapper_version, status,
         data_json, data_sha256, event_categories_json, evidence_counts_json,
         source_payload_sha256, captured_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(game_id, puuid, source, mapper_version) DO UPDATE SET
        source_match_id = excluded.source_match_id, status = 'ready',
        data_json = excluded.data_json, data_sha256 = excluded.data_sha256,
        event_categories_json = excluded.event_categories_json,
        evidence_counts_json = excluded.evidence_counts_json,
        source_payload_sha256 = excluded.source_payload_sha256,
        captured_at = excluded.captured_at, updated_at = excluded.updated_at
    `).run(
      input.gameId, input.puuid, input.source, input.sourceMatchId,
      input.mapperVersion, dataJson, dataSha256, canonicalJson(categories),
      canonicalJson(timelineEvidenceCounts(input.timeline)),
      input.sourcePayload?.sha256 ?? null, input.capturedAt, Date.now(),
    )
    refreshTimelineCompatibilityCache(this.db, input.gameId, input.puuid)
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
    this.db.prepare(`
      INSERT INTO match_timeline_sources
        (game_id, puuid, source, source_match_id, mapper_version, status,
         data_json, data_sha256, event_categories_json, evidence_counts_json,
         source_payload_sha256, captured_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'unavailable', NULL, NULL, '[]', ?, NULL, ?, ?)
      ON CONFLICT(game_id, puuid, source, mapper_version) DO UPDATE SET
        source_match_id = excluded.source_match_id,
        status = CASE WHEN match_timeline_sources.status = 'ready'
          THEN 'ready' ELSE 'unavailable' END,
        evidence_counts_json = CASE WHEN match_timeline_sources.status = 'ready'
          THEN match_timeline_sources.evidence_counts_json
          ELSE excluded.evidence_counts_json END,
        captured_at = MAX(match_timeline_sources.captured_at, excluded.captured_at),
        updated_at = excluded.updated_at
    `).run(
      input.gameId, input.puuid, input.source, input.sourceMatchId,
      input.mapperVersion, canonicalJson({ version: 1, reason: input.reason }),
      input.capturedAt, Date.now(),
    )
  }
}
