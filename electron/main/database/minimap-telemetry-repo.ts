import { randomUUID } from "node:crypto"
import type {
  CampClearEvent,
  CampKey,
  CampStateObservation,
  ChampionPositionObservation,
  MinimapCalibration,
  PathSegment,
} from "../../../src/shared/minimap/contracts.js"
import {
  deriveInitialJungleClear,
  type ChampionJungleClearStats,
  type JungleClearSample,
} from "../../../src/shared/minimap/jungle-clear.js"
import { decodeTrackChunk, encodeTrackChunk, type EncodedTrackChunk } from "./minimap-track-codec.js"

export interface StatementLike {
  run(...parameters: unknown[]): unknown
  all(...parameters: unknown[]): unknown[]
  get(...parameters: unknown[]): unknown
}

export interface DatabaseLike {
  prepare(sql: string): StatementLike
}

interface TrackBuffer {
  puuid: string
  observations: ChampionPositionObservation[]
  startedAtMs: number
}

interface TrackChunkRow {
  gameId: number
  puuid: string
  participantKey: string
  championName: string
  team: "ally" | "enemy"
  isLocal: number
  chunkStartMs: number
  chunkEndMs: number
  pointCount: number
  encoding: EncodedTrackChunk["encoding"]
  uncompressedBytes: number
  compressedBytes: number
  payloadSha256: string
  payload: Uint8Array
  detectorVersion: number
}

interface CampClearRow {
  gameId: number
  puuid: string
  campKey: CampClearEvent["campKey"]
  clearedAtMs: number
  respawnAtMs: number | null
  source: CampClearEvent["source"]
  sourceConfidence: number
  attribution: CampClearEvent["attribution"]
  attributionConfidence: number
  evidenceJson: string
  routeIndex: number | null
  algorithmVersion: number
}

interface ChampionJungleClearRow {
  gameId: number
  championId: number
  playedAt: number
  win: number
  campKey: CampKey | null
  clearedAtMs: number | null
  respawnAtMs: number | null
  source: CampClearEvent["source"] | null
  sourceConfidence: number | null
  attribution: CampClearEvent["attribution"] | null
  attributionConfidence: number | null
  evidenceJson: string | null
  routeIndex: number | null
  algorithmVersion: number | null
}

interface PathParticipantRow {
  participantKey: string
  championName: string
  team: "ally" | "enemy"
  isLocal: number
}

interface PathRunRow {
  analysisId: string
  gameId: number
  puuid: string
  inputHash: string
  graphVersion: number
  modelVersion: number
  status: "running" | "complete" | "failed"
  coverageJson: string
  createdAt: number
  completedAt: number | null
  errorCode: string | null
}

interface PathSegmentRow {
  participantKey: string
  startTimeMs: number
  endTimeMs: number
  kind: PathSegment["kind"]
  pointsJson: string
  confidence: number
  uncertaintyJson: string | null
  inferenceMode: PathSegment["inferenceMode"] | null
  modelVersion: number
}

export interface CaptureSessionInput {
  gameId: number
  puuid: string
  captureBackend: "electron_desktop_capture" | "windows_graphics_capture"
  calibrationId?: string
  detectorVersion: number
  debugRetention?: boolean
}

export interface PathingReviewData {
  analysis?: {
    analysisId: string
    gameId: number
    puuid: string
    inputHash: string
    graphVersion: number
    modelVersion: number
    status: "running" | "complete" | "failed"
    coverage: Record<string, unknown>
    createdAt: number
    completedAt?: number
    errorCode?: string
  }
  participants: Array<{
    participantKey: string
    championName: string
    team: "ally" | "enemy"
    isLocal: boolean
  }>
  segments: PathSegment[]
  campClears: CampClearEvent[]
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export class MinimapTelemetryRepository {
  private readonly trackBuffers = new Map<string, TrackBuffer>()

  constructor(
    private readonly db: DatabaseLike,
    private readonly chunkDurationMs = 20_000,
    private readonly maximumChunkPoints = 160,
  ) {}

  reconcileOrphanedCaptureSessions(endedAt = Date.now()) {
    this.db.prepare(`
      UPDATE minimap_capture_sessions
      SET ended_at = COALESCE(ended_at, ?),
          status = 'aborted',
          terminal_error_code = COALESCE(
            terminal_error_code,
            'capture_process_restarted'
          )
      WHERE status = 'running'
    `).run(endedAt)
  }

  startCaptureSession(input: CaptureSessionInput) {
    const sessionId = randomUUID()
    this.db.prepare(`
      INSERT INTO minimap_capture_sessions
        (session_id, game_id, puuid, capture_backend, calibration_id,
         started_at, detector_version, status, debug_retention)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)
    `).run(
      sessionId,
      input.gameId,
      input.puuid,
      input.captureBackend,
      input.calibrationId ?? null,
      Date.now(),
      input.detectorVersion,
      input.debugRetention ? 1 : 0,
    )
    return sessionId
  }

  attachCalibration(sessionId: string, calibrationId: string) {
    this.db.prepare(`
      UPDATE minimap_capture_sessions
      SET calibration_id = ?
      WHERE session_id = ? AND status = 'running'
    `).run(calibrationId, sessionId)
  }

  finishCaptureSession(input: {
    sessionId: string
    status: "complete" | "capture_unavailable" | "calibration_required" | "failed" | "aborted"
    processedFrames: number
    droppedFrames: number
    averageProcessingMs: number
    captureAttempts?: number
    rejectedFrames?: number
    achievedFps?: number
    p95FrameGapMs?: number
    maximumFrameGapMs?: number
    confirmedObservations?: number
    terminalErrorCode?: string
  }) {
    this.flushAll()
    this.db.prepare(`
      UPDATE minimap_capture_sessions
      SET ended_at = ?, processed_frames = ?, dropped_frames = ?,
          average_processing_ms = ?, capture_attempts = ?, rejected_frames = ?,
          achieved_fps = ?, p95_frame_gap_ms = ?, maximum_frame_gap_ms = ?,
          confirmed_observations = ?, status = ?, terminal_error_code = ?
      WHERE session_id = ? AND status = 'running'
    `).run(
      Date.now(),
      input.processedFrames,
      input.droppedFrames,
      input.averageProcessingMs,
      input.captureAttempts ?? input.processedFrames,
      input.rejectedFrames ?? 0,
      input.achievedFps ?? 0,
      input.p95FrameGapMs ?? 0,
      input.maximumFrameGapMs ?? 0,
      input.confirmedObservations ?? 0,
      input.status,
      input.terminalErrorCode ?? null,
      input.sessionId,
    )
  }

  saveCalibration(calibrationId: string, sourceFingerprint: string, calibration: MinimapCalibration) {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO minimap_calibrations
        (calibration_id, source_fingerprint, source_width, source_height,
         minimap_rect_json, inner_map_rect_json, placement, display_scale_factor,
         confidence, calibration_version, created_at, verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(calibration_id) DO UPDATE SET
        source_fingerprint = excluded.source_fingerprint,
        source_width = excluded.source_width,
        source_height = excluded.source_height,
        minimap_rect_json = excluded.minimap_rect_json,
        inner_map_rect_json = excluded.inner_map_rect_json,
        placement = excluded.placement,
        display_scale_factor = excluded.display_scale_factor,
        confidence = excluded.confidence,
        calibration_version = excluded.calibration_version,
        verified_at = excluded.verified_at
    `).run(
      calibrationId,
      sourceFingerprint,
      calibration.sourceWidth,
      calibration.sourceHeight,
      JSON.stringify(calibration.minimapRect),
      JSON.stringify(calibration.innerMapRect),
      calibration.placement,
      calibration.displayScaleFactor,
      calibration.confidence,
      calibration.calibrationVersion,
      now,
      now,
    )
  }

  findCalibration(sourceFingerprint: string, sourceWidth: number, sourceHeight: number) {
    const row = this.db.prepare(`
      SELECT source_width AS sourceWidth, source_height AS sourceHeight,
             minimap_rect_json AS minimapRectJson,
             inner_map_rect_json AS innerMapRectJson, placement,
             display_scale_factor AS displayScaleFactor, confidence,
             calibration_version AS calibrationVersion
      FROM minimap_calibrations
      WHERE source_fingerprint = ? AND source_width = ? AND source_height = ?
      ORDER BY verified_at DESC LIMIT 1
    `).get(sourceFingerprint, sourceWidth, sourceHeight) as {
      sourceWidth: number
      sourceHeight: number
      minimapRectJson: string
      innerMapRectJson: string
      placement: MinimapCalibration["placement"]
      displayScaleFactor: number
      confidence: number
      calibrationVersion: number
    } | undefined
    if (!row) return undefined
    return {
      sourceWidth: row.sourceWidth,
      sourceHeight: row.sourceHeight,
      minimapRect: parseJson(row.minimapRectJson, { x: 0, y: 0, width: 0, height: 0 }),
      innerMapRect: parseJson(row.innerMapRectJson, { x: 0, y: 0, width: 0, height: 0 }),
      placement: row.placement,
      displayScaleFactor: row.displayScaleFactor,
      confidence: row.confidence,
      calibrationVersion: row.calibrationVersion,
    } satisfies MinimapCalibration
  }

  appendChampionObservation(puuid: string, observation: ChampionPositionObservation) {
    const key = `${observation.gameId}:${puuid}:${observation.participantKey}`
    let buffer = this.trackBuffers.get(key)
    if (!buffer) {
      buffer = { puuid, observations: [], startedAtMs: observation.gameTimeMs }
      this.trackBuffers.set(key, buffer)
    }
    buffer.observations.push(observation)
    if (observation.gameTimeMs - buffer.startedAtMs >= this.chunkDurationMs ||
        buffer.observations.length >= this.maximumChunkPoints) this.flushTrack(key, buffer)
  }

  recordCampState(puuid: string, observation: CampStateObservation) {
    this.db.prepare(`
      INSERT OR IGNORE INTO camp_state_events
        (game_id, puuid, camp_key, game_time_ms, state, source,
         confidence, provider_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      observation.gameId,
      puuid,
      observation.campKey,
      Math.round(observation.gameTimeMs),
      observation.state,
      observation.source,
      observation.sourceConfidence,
      observation.providerVersion,
      Date.now(),
    )
  }

  recordCampClear(event: CampClearEvent) {
    this.db.prepare(`
      INSERT INTO camp_clear_events
        (game_id, puuid, camp_key, cleared_at_ms, respawn_at_ms, source,
         source_confidence, attribution, attribution_confidence, evidence_json,
         route_index, algorithm_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(game_id, puuid, camp_key, cleared_at_ms) DO UPDATE SET
        source_confidence = MAX(camp_clear_events.source_confidence, excluded.source_confidence),
        attribution = CASE
          WHEN excluded.attribution_confidence > camp_clear_events.attribution_confidence
          THEN excluded.attribution ELSE camp_clear_events.attribution END,
        attribution_confidence = MAX(
          camp_clear_events.attribution_confidence,
          excluded.attribution_confidence
        ),
        evidence_json = CASE
          WHEN excluded.attribution_confidence > camp_clear_events.attribution_confidence
          THEN excluded.evidence_json ELSE camp_clear_events.evidence_json END
    `).run(
      event.gameId,
      event.puuid,
      event.campKey,
      Math.round(event.clearedAtMs),
      event.respawnAtMs !== undefined ? Math.round(event.respawnAtMs) : null,
      event.source,
      event.sourceConfidence,
      event.attribution,
      event.attributionConfidence,
      JSON.stringify(event.evidence),
      event.routeIndex ?? null,
      event.algorithmVersion,
      Date.now(),
    )
  }

  loadChampionObservations(gameId: number, puuid: string) {
    this.flushAll()
    const rows = this.db.prepare(`
      SELECT game_id AS gameId, puuid, participant_key AS participantKey,
             champion_name AS championName, team, is_local AS isLocal,
             chunk_start_ms AS chunkStartMs, chunk_end_ms AS chunkEndMs,
             point_count AS pointCount, encoding,
             uncompressed_bytes AS uncompressedBytes,
             compressed_bytes AS compressedBytes,
             payload_sha256 AS payloadSha256, payload,
             detector_version AS detectorVersion
      FROM champion_track_chunks
      WHERE game_id = ? AND puuid = ?
      ORDER BY participant_key, chunk_start_ms
    `).all(gameId, puuid) as TrackChunkRow[]
    return rows.flatMap((row) => decodeTrackChunk({
      encoding: row.encoding,
      startTimeMs: row.chunkStartMs,
      endTimeMs: row.chunkEndMs,
      pointCount: row.pointCount,
      uncompressedBytes: row.uncompressedBytes,
      compressedBytes: row.compressedBytes,
      sha256: row.payloadSha256,
      payload: row.payload,
    }))
  }

  listCampClears(gameId: number, puuid: string): CampClearEvent[] {
    const rows = this.db.prepare(`
      SELECT game_id AS gameId, puuid, camp_key AS campKey,
             cleared_at_ms AS clearedAtMs, respawn_at_ms AS respawnAtMs,
             source, source_confidence AS sourceConfidence, attribution,
             attribution_confidence AS attributionConfidence,
             evidence_json AS evidenceJson, route_index AS routeIndex,
             algorithm_version AS algorithmVersion
      FROM camp_clear_events
      WHERE game_id = ? AND puuid = ?
      ORDER BY cleared_at_ms
    `).all(gameId, puuid) as CampClearRow[]
    return rows.map((row) => ({
      gameId: row.gameId,
      puuid: row.puuid,
      campKey: row.campKey,
      clearedAtMs: row.clearedAtMs,
      respawnAtMs: row.respawnAtMs ?? undefined,
      source: row.source,
      sourceConfidence: row.sourceConfidence,
      attribution: row.attribution,
      attributionConfidence: row.attributionConfidence,
      evidence: parseJson(row.evidenceJson, {
        campTransition: false,
        localPositionObserved: false,
        transitionConfidence: 0,
      }),
      routeIndex: row.routeIndex ?? undefined,
      algorithmVersion: row.algorithmVersion,
    }))
  }

  getChampionJungleClearStats(
    puuid: string,
    championId: number,
  ): ChampionJungleClearStats {
    const rows = this.db.prepare(`
      SELECT m.game_id AS gameId, m.champion_id AS championId,
             m.played_at AS playedAt, m.win,
             c.camp_key AS campKey, c.cleared_at_ms AS clearedAtMs,
             c.respawn_at_ms AS respawnAtMs, c.source,
             c.source_confidence AS sourceConfidence, c.attribution,
             c.attribution_confidence AS attributionConfidence,
             c.evidence_json AS evidenceJson, c.route_index AS routeIndex,
             c.algorithm_version AS algorithmVersion
      FROM matches m
      LEFT JOIN camp_clear_events c
        ON c.game_id = m.game_id AND c.puuid = m.puuid
       AND c.attribution = 'local'
      WHERE m.puuid = ? AND m.champion_id = ? AND m.is_matched = 1
        AND (
          UPPER(COALESCE(m.resolved_position, '')) = 'JUNGLE'
          OR UPPER(COALESCE(m.role, '')) IN ('JUNGLE', 'JUNGLER')
          OR EXISTS (
            SELECT 1 FROM match_participants owner
            WHERE owner.game_id = m.game_id AND owner.puuid = m.puuid
              AND owner.is_player = 1
              AND (
                UPPER(COALESCE(owner.resolved_position, '')) = 'JUNGLE'
                OR UPPER(COALESCE(owner.match_v5_team_position, '')) = 'JUNGLE'
                OR UPPER(COALESCE(owner.match_v5_individual_position, '')) = 'JUNGLE'
                OR UPPER(COALESCE(owner.assigned_position, '')) IN ('JUNGLE', 'JUNGLER')
                OR owner.spell1_id = 11 OR owner.spell2_id = 11
              )
          )
        )
      ORDER BY m.played_at DESC, m.game_id DESC, c.cleared_at_ms
    `).all(puuid, championId) as ChampionJungleClearRow[]

    const games = new Map<number, {
      championId: number
      playedAt: number
      win: number
      events: CampClearEvent[]
    }>()
    for (const row of rows) {
      let game = games.get(row.gameId)
      if (!game) {
        game = {
          championId: row.championId,
          playedAt: row.playedAt,
          win: row.win,
          events: [],
        }
        games.set(row.gameId, game)
      }
      if (row.campKey === null || row.clearedAtMs === null ||
          row.source === null || row.sourceConfidence === null ||
          row.attribution === null || row.attributionConfidence === null ||
          row.algorithmVersion === null) continue
      game.events.push({
        gameId: row.gameId,
        puuid,
        campKey: row.campKey,
        clearedAtMs: row.clearedAtMs,
        respawnAtMs: row.respawnAtMs ?? undefined,
        source: row.source,
        sourceConfidence: row.sourceConfidence,
        attribution: row.attribution,
        attributionConfidence: row.attributionConfidence,
        evidence: parseJson(row.evidenceJson ?? "", {
          campTransition: false,
          localPositionObserved: false,
          transitionConfidence: 0,
        }),
        routeIndex: row.routeIndex ?? undefined,
        algorithmVersion: row.algorithmVersion,
      })
    }

    let telemetryGames = 0
    const samples: JungleClearSample[] = []
    for (const [gameId, game] of games) {
      const clear = deriveInitialJungleClear(game.events)
      if (clear.camps.length > 0) telemetryGames += 1
      if (!clear.complete || clear.clearTimeMs === undefined || clear.confidence === undefined) {
        continue
      }
      samples.push({
        gameId,
        championId: game.championId,
        playedAt: game.playedAt,
        win: game.win,
        clearTimeMs: clear.clearTimeMs,
        route: clear.camps.map((event) => event.campKey),
        confidence: clear.confidence,
      })
    }
    samples.sort((left, right) => right.playedAt - left.playedAt || right.gameId - left.gameId)
    const fastest = samples.reduce<JungleClearSample | undefined>(
      (best, sample) => !best || sample.clearTimeMs < best.clearTimeMs ? sample : best,
      undefined,
    )
    const longest = samples.reduce<JungleClearSample | undefined>(
      (best, sample) => !best || sample.clearTimeMs > best.clearTimeMs ? sample : best,
      undefined,
    )

    return {
      championId,
      jungleGames: games.size,
      telemetryGames,
      samples,
      averageClearTimeMs: samples.length
        ? Math.round(samples.reduce((total, sample) => total + sample.clearTimeMs, 0) /
          samples.length)
        : undefined,
      fastest,
      longest,
    }
  }

  findPathingAnalysis(input: {
    gameId: number
    puuid: string
    inputHash: string
    graphVersion: number
    modelVersion: number
  }) {
    return this.db.prepare(`
      SELECT analysis_id AS analysisId, game_id AS gameId, puuid, input_hash AS inputHash,
             graph_version AS graphVersion, model_version AS modelVersion, status,
             coverage_json AS coverageJson, created_at AS createdAt,
             completed_at AS completedAt, error_code AS errorCode
      FROM pathing_analysis_runs
      WHERE game_id = ? AND puuid = ? AND input_hash = ?
        AND graph_version = ? AND model_version = ?
      LIMIT 1
    `).get(
      input.gameId,
      input.puuid,
      input.inputHash,
      input.graphVersion,
      input.modelVersion,
    ) as PathRunRow | undefined
  }

  startPathingAnalysis(input: {
    gameId: number
    puuid: string
    inputHash: string
    graphVersion: number
    modelVersion: number
    coverage: unknown
  }) {
    const existing = this.findPathingAnalysis(input)
    if (existing) return existing.analysisId
    const analysisId = randomUUID()
    this.db.prepare(`
      INSERT INTO pathing_analysis_runs
        (analysis_id, game_id, puuid, input_hash, graph_version, model_version,
         mode, status, coverage_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'postgame_smoothed', 'running', ?, ?)
    `).run(
      analysisId,
      input.gameId,
      input.puuid,
      input.inputHash,
      input.graphVersion,
      input.modelVersion,
      JSON.stringify(input.coverage),
      Date.now(),
    )
    return analysisId
  }

  replacePathSegments(analysisId: string, segments: PathSegment[]) {
    this.db.prepare("DELETE FROM path_segments WHERE analysis_id = ?").run(analysisId)
    const insert = this.db.prepare(`
      INSERT INTO path_segments
        (analysis_id, participant_key, start_time_ms, end_time_ms, kind,
         points_json, confidence, uncertainty_json, inference_mode, model_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const segment of segments) {
      insert.run(
        analysisId,
        segment.participantKey,
        Math.round(segment.startTimeMs),
        Math.round(segment.endTimeMs),
        segment.kind,
        JSON.stringify(segment.points),
        segment.confidence,
        segment.uncertaintyRadius ? JSON.stringify(segment.uncertaintyRadius) : null,
        segment.inferenceMode ?? null,
        segment.modelVersion,
      )
    }
    this.db.prepare(`
      UPDATE pathing_analysis_runs
      SET status = 'complete', completed_at = ?, error_code = NULL
      WHERE analysis_id = ?
    `).run(Date.now(), analysisId)
  }

  failPathingAnalysis(analysisId: string, errorCode: string) {
    this.db.prepare(`
      UPDATE pathing_analysis_runs
      SET status = 'failed', completed_at = ?, error_code = ?
      WHERE analysis_id = ?
    `).run(Date.now(), errorCode.slice(0, 256), analysisId)
  }

  getReview(gameId: number, puuid: string): PathingReviewData {
    const run = this.db.prepare(`
      SELECT analysis_id AS analysisId, game_id AS gameId, puuid, input_hash AS inputHash,
             graph_version AS graphVersion, model_version AS modelVersion, status,
             coverage_json AS coverageJson, created_at AS createdAt,
             completed_at AS completedAt, error_code AS errorCode
      FROM pathing_analysis_runs
      WHERE game_id = ? AND puuid = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(gameId, puuid) as PathRunRow | undefined
    const rows = run ? this.db.prepare(`
      SELECT participant_key AS participantKey, start_time_ms AS startTimeMs,
             end_time_ms AS endTimeMs, kind, points_json AS pointsJson,
             confidence, uncertainty_json AS uncertaintyJson,
             inference_mode AS inferenceMode, model_version AS modelVersion
      FROM path_segments
      WHERE analysis_id = ?
      ORDER BY participant_key, start_time_ms, end_time_ms
    `).all(run.analysisId) as PathSegmentRow[] : []
    const participants = this.db.prepare(`
      SELECT participant_key AS participantKey, champion_name AS championName,
             team, is_local AS isLocal
      FROM champion_track_chunks
      WHERE game_id = ? AND puuid = ?
      GROUP BY participant_key, champion_name, team, is_local
      ORDER BY is_local DESC, team, champion_name
    `).all(gameId, puuid) as PathParticipantRow[]
    return {
      analysis: run ? {
        analysisId: run.analysisId,
        gameId: run.gameId,
        puuid: run.puuid,
        inputHash: run.inputHash,
        graphVersion: run.graphVersion,
        modelVersion: run.modelVersion,
        status: run.status,
        coverage: parseJson(run.coverageJson, {}),
        createdAt: run.createdAt,
        completedAt: run.completedAt ?? undefined,
        errorCode: run.errorCode ?? undefined,
      } : undefined,
      participants: participants.map((participant) => ({
        participantKey: participant.participantKey,
        championName: participant.championName,
        team: participant.team,
        isLocal: participant.isLocal === 1,
      })),
      segments: rows.map((row) => ({
        gameId,
        participantKey: row.participantKey,
        startTimeMs: row.startTimeMs,
        endTimeMs: row.endTimeMs,
        kind: row.kind,
        points: parseJson(row.pointsJson, []),
        confidence: row.confidence,
        uncertaintyRadius: row.uncertaintyJson
          ? parseJson(row.uncertaintyJson, [])
          : undefined,
        inferenceMode: row.inferenceMode ?? undefined,
        modelVersion: row.modelVersion,
      })),
      campClears: this.listCampClears(gameId, puuid),
    }
  }

  flushAll() {
    for (const [key, buffer] of [...this.trackBuffers]) this.flushTrack(key, buffer)
  }

  private flushTrack(key: string, buffer: TrackBuffer) {
    if (buffer.observations.length === 0) {
      this.trackBuffers.delete(key)
      return
    }
    const first = buffer.observations[0]
    const encoded = encodeTrackChunk(buffer.observations)
    this.db.prepare(`
      INSERT OR REPLACE INTO champion_track_chunks
        (game_id, puuid, participant_key, champion_name, team, is_local,
         chunk_start_ms, chunk_end_ms, point_count, encoding,
         uncompressed_bytes, compressed_bytes, payload_sha256, payload,
         detector_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      first.gameId,
      buffer.puuid,
      first.participantKey,
      first.championName,
      first.team,
      first.isLocal ? 1 : 0,
      encoded.startTimeMs,
      encoded.endTimeMs,
      encoded.pointCount,
      encoded.encoding,
      encoded.uncompressedBytes,
      encoded.compressedBytes,
      encoded.sha256,
      encoded.payload,
      first.detectorVersion,
    )
    this.trackBuffers.delete(key)
  }
}
