import { createHash } from "node:crypto"
import { gunzipSync, gzipSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import {
  decodeTrackChunk,
  encodeTrackChunk,
} from "../electron/main/database/minimap-track-codec.js"
import type { ChampionPositionObservation } from "../src/shared/minimap/contracts.js"

function observation(
  gameTimeMs: number,
  frameSequence: number,
  continuity: ChampionPositionObservation["continuity"],
): ChampionPositionObservation {
  return {
    gameId: 5,
    participantKey: "ally:zac",
    championName: "Zac",
    team: "ally",
    isLocal: true,
    gameTimeMs,
    position: { x: 0.1234, y: 0.5678 },
    source: "minimap_cv",
    identityConfidence: 0.91,
    positionConfidence: 0.87,
    frameSequence,
    detectorVersion: 2,
    continuity,
  }
}

describe("minimap track continuity codec", () => {
  it("round-trips confirmed relocation boundaries", () => {
    const encoded = encodeTrackChunk([
      observation(10_000, 20, "relocation"),
      observation(10_125, 21, "continuous"),
    ])
    expect(decodeTrackChunk(encoded).map((point) => point.continuity))
      .toEqual(["relocation", "continuous"])
  })

  it("continues to read legacy v1 chunks without inventing continuity", () => {
    const encoded = encodeTrackChunk([observation(10_000, 20, "continuous")])
    const body = JSON.parse(gunzipSync(encoded.payload).toString("utf8")) as {
      v: number
      points: number[][]
    }
    body.v = 1
    body.points = body.points.map((point) => point.slice(0, 6))
    const uncompressed = Buffer.from(JSON.stringify(body), "utf8")
    const payload = gzipSync(uncompressed, { level: 6 })
    const decoded = decodeTrackChunk({
      ...encoded,
      uncompressedBytes: uncompressed.length,
      compressedBytes: payload.length,
      sha256: createHash("sha256").update(payload).digest("hex"),
      payload,
    })
    expect(decoded[0].continuity).toBeUndefined()
  })
})
