import { createHash } from "node:crypto"
import { gunzipSync, gzipSync } from "node:zlib"

export const GZIP_JSON_V1 = "gzip_json_v1" as const

const HASH_PATTERN = /^[a-f0-9]{64}$/

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

export interface EncodedJsonBody {
  encoding: typeof GZIP_JSON_V1
  uncompressedBytes: number
  compressedBytes: number
  payload: Buffer
  sha256: string
}

export interface DecodedJsonBody {
  value: unknown
  text: string
  bytes: Buffer
}

/**
 * Encodes already-valid JSON without changing a byte of its UTF-8 text.
 * Migration callers use this path so historical bodies retain an exact byte
 * representation in addition to an identical decoded value.
 */
export function gzipJsonTextV1(text: string): EncodedJsonBody {
  JSON.parse(text)
  const bytes = Buffer.from(text, "utf8")
  const payload = gzipSync(bytes, { level: 9, mtime: 0 } as never)
  if (payload[0] !== 0x1f || payload[1] !== 0x8b || payload[2] !== 8) {
    throw new Error("unexpected_gzip_header")
  }
  // Node/zlib headers have changed across releases. Normalize every field
  // covered by the v1 contract so identical input always yields one body.
  payload[3] = 0
  payload.writeUInt32LE(0, 4)
  payload[8] = 2
  payload[9] = 255
  return {
    encoding: GZIP_JSON_V1,
    uncompressedBytes: bytes.length,
    compressedBytes: payload.length,
    payload,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
}

export function gzipCanonicalJsonV1(value: unknown): EncodedJsonBody & {
  canonicalBytes: Buffer
} {
  const text = canonicalJson(value)
  const encoded = gzipJsonTextV1(text)
  return { ...encoded, canonicalBytes: Buffer.from(text, "utf8") }
}

export function decodeJsonBodyV1(
  payload: Buffer,
  expectedSha256: string,
  expectedUncompressedBytes?: number,
): DecodedJsonBody {
  if (!Buffer.isBuffer(payload)) throw new Error("gzip_json_v1_payload_must_be_blob")
  if (!HASH_PATTERN.test(expectedSha256)) throw new Error("gzip_json_v1_sha256_invalid")
  if (expectedUncompressedBytes !== undefined &&
      (!Number.isSafeInteger(expectedUncompressedBytes) || expectedUncompressedBytes < 0)) {
    throw new Error("gzip_json_v1_uncompressed_bytes_invalid")
  }
  if (payload.length < 18 || payload[0] !== 0x1f || payload[1] !== 0x8b ||
      payload[2] !== 8 || payload[3] !== 0 || payload.readUInt32LE(4) !== 0 ||
      payload[8] !== 2 || payload[9] !== 255) {
    throw new Error("invalid_gzip_json_v1_header")
  }
  let result: Buffer | { buffer: Buffer; engine: { bytesWritten: number } }
  try {
    result = gunzipSync(payload, {
      info: true,
      ...(expectedUncompressedBytes === undefined
        ? {}
        : { maxOutputLength: expectedUncompressedBytes + 1 }),
    } as never) as unknown as
      Buffer | { buffer: Buffer; engine: { bytesWritten: number } }
  } catch (error) {
    throw new Error("invalid_gzip_json_v1_payload", { cause: error })
  }
  const bytes = Buffer.isBuffer(result) ? result : result.buffer
  if (!Buffer.isBuffer(result) && result.engine.bytesWritten !== payload.length) {
    throw new Error("trailing_gzip_bytes")
  }
  if (expectedUncompressedBytes !== undefined && bytes.length !== expectedUncompressedBytes) {
    throw new Error("payload_uncompressed_bytes_mismatch")
  }
  const hash = createHash("sha256").update(bytes).digest("hex")
  if (hash !== expectedSha256) throw new Error("payload_sha256_mismatch")
  const text = bytes.toString("utf8")
  if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error("payload_is_not_utf8")
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch (error) {
    throw new Error("payload_is_not_json", { cause: error })
  }
  return { value, text, bytes }
}

export interface StoredJsonBodyRow {
  snapshotEncoding: string
  snapshotUncompressedBytes: number
  snapshotCompressedBytes: number
  snapshotPayload: Buffer
  snapshotSha256: string
}

export function decodeStoredJsonBody(row: StoredJsonBodyRow): DecodedJsonBody {
  if (row.snapshotEncoding !== GZIP_JSON_V1) {
    throw new Error(`unsupported_json_body_encoding:${row.snapshotEncoding}`)
  }
  if (!Number.isSafeInteger(row.snapshotCompressedBytes) ||
      row.snapshotCompressedBytes !== row.snapshotPayload.length) {
    throw new Error("payload_compressed_bytes_mismatch")
  }
  return decodeJsonBodyV1(
    row.snapshotPayload,
    row.snapshotSha256,
    row.snapshotUncompressedBytes,
  )
}
