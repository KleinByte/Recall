import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import {
  canonicalJson,
  decodeCanonicalJsonV1,
  gzipCanonicalJsonV1,
} from "../electron/main/database/match-source-repo.js"

describe("canonical source payloads", () => {
  it("sorts object keys recursively while preserving arrays", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 }, list: [{ z: 1, a: 2 }, 0] }))
      .toBe('{"a":{"b":3,"y":2},"list":[{"a":2,"z":1},0],"z":1}')
  })

  it("uses the fixed gzip-json-v1 header and content hash", () => {
    const value = { zero: 0, nested: { truth: false } }
    const encoded = gzipCanonicalJsonV1(value)
    expect([...encoded.payload.subarray(0, 10)]).toEqual([31, 139, 8, 0, 0, 0, 0, 0, 2, 255])
    expect(encoded.sha256).toBe(createHash("sha256").update(encoded.canonicalBytes).digest("hex"))
    expect(decodeCanonicalJsonV1(encoded.payload, encoded.sha256)).toEqual(value)
  })

  it("rejects altered headers, hashes, and trailing bytes", () => {
    const encoded = gzipCanonicalJsonV1({ a: 1 })
    const header = Buffer.from(encoded.payload)
    header[3] = 1
    expect(() => decodeCanonicalJsonV1(header, encoded.sha256)).toThrow("header")
    expect(() => decodeCanonicalJsonV1(encoded.payload, "0".repeat(64))).toThrow("sha256")
    expect(() => decodeCanonicalJsonV1(Buffer.concat([encoded.payload, Buffer.from([0])]), encoded.sha256))
      .toThrow("trailing")
  })
})
