import { createHash } from "node:crypto"
import { gzipSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import {
  decodeJsonBodyV1,
  decodeStoredJsonBody,
  gzipJsonTextV1,
} from "../electron/main/database/json-body-codec.js"

function encodedArbitraryBytes(bytes: Buffer) {
  const payload = gzipSync(bytes, { level: 9, mtime: 0 } as never)
  payload[3] = 0
  payload.writeUInt32LE(0, 4)
  payload[8] = 2
  payload[9] = 255
  return {
    payload,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    uncompressedBytes: bytes.length,
  }
}

describe("compressed JSON bodies", () => {
  it("is deterministic and preserves exact noncanonical UTF-8 JSON bytes", () => {
    const text = '{"z":"召唤师","a":1}'
    const first = gzipJsonTextV1(text)
    const second = gzipJsonTextV1(text)

    expect(first.payload.equals(second.payload)).toBe(true)
    expect(first.uncompressedBytes).toBe(Buffer.byteLength(text, "utf8"))
    expect(first.compressedBytes).toBe(first.payload.length)
    expect([...first.payload.subarray(0, 10)])
      .toEqual([31, 139, 8, 0, 0, 0, 0, 0, 2, 255])
    expect(decodeJsonBodyV1(
      first.payload,
      first.sha256,
      first.uncompressedBytes,
    ).text).toBe(text)
  })

  it("rejects unsupported metadata, corrupt bodies, and trailing members", () => {
    const encoded = gzipJsonTextV1('{"safe":true}')
    expect(() => decodeStoredJsonBody({
      snapshotEncoding: "json",
      snapshotUncompressedBytes: encoded.uncompressedBytes,
      snapshotCompressedBytes: encoded.compressedBytes,
      snapshotSha256: encoded.sha256,
      snapshotPayload: encoded.payload,
    })).toThrow("unsupported")
    expect(() => decodeStoredJsonBody({
      snapshotEncoding: encoded.encoding,
      snapshotUncompressedBytes: encoded.uncompressedBytes,
      snapshotCompressedBytes: encoded.compressedBytes + 1,
      snapshotSha256: encoded.sha256,
      snapshotPayload: encoded.payload,
    })).toThrow("compressed_bytes")

    const header = Buffer.from(encoded.payload)
    header[3] = 1
    expect(() => decodeJsonBodyV1(
      header,
      encoded.sha256,
      encoded.uncompressedBytes,
    )).toThrow("header")
    expect(() => decodeJsonBodyV1(
      encoded.payload.subarray(0, encoded.payload.length - 2),
      encoded.sha256,
      encoded.uncompressedBytes,
    )).toThrow("payload")
    expect(() => decodeJsonBodyV1(
      Buffer.concat([encoded.payload, Buffer.from([0])]),
      encoded.sha256,
      encoded.uncompressedBytes,
    )).toThrow("trailing")
    expect(() => decodeJsonBodyV1(
      encoded.payload,
      "0".repeat(64),
      encoded.uncompressedBytes,
    )).toThrow("sha256")
    expect(() => decodeJsonBodyV1(
      encoded.payload,
      encoded.sha256,
      encoded.uncompressedBytes + 1,
    )).toThrow("uncompressed_bytes")
  })

  it("rejects invalid UTF-8 and invalid JSON even with matching metadata", () => {
    const invalidUtf8 = encodedArbitraryBytes(Buffer.from([0xff]))
    expect(() => decodeJsonBodyV1(
      invalidUtf8.payload,
      invalidUtf8.sha256,
      invalidUtf8.uncompressedBytes,
    )).toThrow("utf8")

    const invalidJson = encodedArbitraryBytes(Buffer.from("not-json", "utf8"))
    expect(() => decodeJsonBodyV1(
      invalidJson.payload,
      invalidJson.sha256,
      invalidJson.uncompressedBytes,
    )).toThrow("not_json")
  })
})
