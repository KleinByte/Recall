import { createHash } from "node:crypto"
import { gunzipSync, gzipSync } from "node:zlib"
import type { ChampionPositionObservation } from "../../../src/shared/minimap/contracts.js"

export const MINIMAP_TRACK_ENCODING = "gzip_delta_json_v1" as const

type EncodedPointV1 = [
  deltaTimeMs: number,
  xBasisPoints: number,
  yBasisPoints: number,
  identityPermille: number,
  positionPermille: number,
  frameDelta: number,
]

type EncodedPointV2 = [
  ...EncodedPointV1,
  relocation: 0 | 1,
]

export interface EncodedTrackChunk {
  encoding: typeof MINIMAP_TRACK_ENCODING
  startTimeMs: number
  endTimeMs: number
  pointCount: number
  uncompressedBytes: number
  compressedBytes: number
  sha256: string
  payload: Uint8Array
}

function basisPoints(value: number) {
  return Math.max(0, Math.min(10_000, Math.round(value * 10_000)))
}

function permille(value: number) {
  return Math.max(0, Math.min(1_000, Math.round(value * 1_000)))
}

export function encodeTrackChunk(
  observations: ChampionPositionObservation[],
): EncodedTrackChunk {
  if (observations.length === 0) throw new Error("empty_minimap_track_chunk")
  const ordered = [...observations].sort((left, right) => left.gameTimeMs - right.gameTimeMs)
  const first = ordered[0]
  let previousTime = first.gameTimeMs
  let previousFrame = first.frameSequence
  const points: EncodedPointV2[] = ordered.map((observation, index) => {
    const time = index === 0 ? 0 : observation.gameTimeMs - previousTime
    const frame = index === 0 ? 0 : observation.frameSequence - previousFrame
    previousTime = observation.gameTimeMs
    previousFrame = observation.frameSequence
    return [
      time,
      basisPoints(observation.position.x),
      basisPoints(observation.position.y),
      permille(observation.identityConfidence),
      permille(observation.positionConfidence),
      frame,
      observation.continuity === "relocation" ? 1 : 0,
    ]
  })
  const body = JSON.stringify({
    v: 2,
    participantKey: first.participantKey,
    championName: first.championName,
    team: first.team,
    isLocal: first.isLocal,
    gameId: first.gameId,
    detectorVersion: first.detectorVersion,
    firstFrameSequence: first.frameSequence,
    points,
  })
  const uncompressed = Buffer.from(body, "utf8")
  // Modern Node emits a deterministic zero-mtime gzip header by default.
  const payload = gzipSync(uncompressed, { level: 6 })
  return {
    encoding: MINIMAP_TRACK_ENCODING,
    startTimeMs: first.gameTimeMs,
    endTimeMs: ordered.at(-1)!.gameTimeMs,
    pointCount: ordered.length,
    uncompressedBytes: uncompressed.length,
    compressedBytes: payload.length,
    sha256: createHash("sha256").update(payload).digest("hex"),
    payload,
  }
}

export function decodeTrackChunk(chunk: EncodedTrackChunk): ChampionPositionObservation[] {
  if (chunk.encoding !== MINIMAP_TRACK_ENCODING) {
    throw new Error(`unsupported_minimap_track_encoding:${chunk.encoding}`)
  }
  const hash = createHash("sha256").update(chunk.payload).digest("hex")
  if (hash !== chunk.sha256) throw new Error("minimap_track_chunk_hash_mismatch")
  const body = gunzipSync(chunk.payload)
  if (body.length !== chunk.uncompressedBytes) {
    throw new Error("minimap_track_chunk_size_mismatch")
  }
  const parsed = JSON.parse(body.toString("utf8")) as {
    v: number
    participantKey: string
    championName: string
    team: "ally" | "enemy"
    isLocal: boolean
    gameId: number
    detectorVersion: number
    firstFrameSequence: number
    points: Array<EncodedPointV1 | EncodedPointV2>
  }
  if (![1, 2].includes(parsed.v) || !Array.isArray(parsed.points)) {
    throw new Error("invalid_minimap_track_chunk")
  }
  let gameTimeMs = chunk.startTimeMs
  let frameSequence = parsed.firstFrameSequence
  return parsed.points.map((point, index) => {
    if (index > 0) {
      gameTimeMs += point[0]
      frameSequence += point[5]
    }
    return {
      gameId: parsed.gameId,
      participantKey: parsed.participantKey,
      championName: parsed.championName,
      team: parsed.team,
      isLocal: parsed.isLocal,
      gameTimeMs,
      position: { x: point[1] / 10_000, y: point[2] / 10_000 },
      source: "minimap_cv",
      identityConfidence: point[3] / 1_000,
      positionConfidence: point[4] / 1_000,
      frameSequence,
      detectorVersion: parsed.detectorVersion,
      ...(parsed.v >= 2
        ? { continuity: point[6] === 1 ? "relocation" as const : "continuous" as const }
        : {}),
    }
  })
}
