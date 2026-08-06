import type { Database } from "better-sqlite3"
import { createHash } from "node:crypto"
import { gunzipSync, gzipSync } from "node:zlib"
import type { SourceArtifactKind } from "../matches/source-capabilities.js"

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

export class MatchSourceRepository {
  constructor(private readonly db: Database) {}

  persistRawPayload(input: PersistRawPayloadInput): RawPayloadIdentity {
    const encoded = gzipCanonicalJsonV1(input.body)
    this.db.prepare(`
      INSERT INTO match_source_payloads
        (owner_puuid, source, source_match_id, game_id, kind, encoding, payload,
         sha256, data_version, mapper_version, serialization_version,
         mapping_status, mapping_error, mapped_at, fetched_at)
      VALUES (?, ?, ?, ?, ?, 'gzip_json_v1', ?, ?, ?, ?, 1, 'pending', NULL, NULL, ?)
      ON CONFLICT(owner_puuid, source, source_match_id, kind, sha256) DO UPDATE SET
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
}
