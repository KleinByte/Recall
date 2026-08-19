export const MINIMAP_TELEMETRY_SCHEMA_VERSION = 34

export const MINIMAP_TELEMETRY_V33_UP = `
  CREATE TABLE minimap_capture_sessions (
    session_id TEXT PRIMARY KEY,
    game_id INTEGER NOT NULL,
    puuid TEXT NOT NULL,
    capture_backend TEXT NOT NULL CHECK (capture_backend IN (
      'electron_desktop_capture','windows_graphics_capture')),
    calibration_id TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    processed_frames INTEGER NOT NULL DEFAULT 0 CHECK (processed_frames >= 0),
    dropped_frames INTEGER NOT NULL DEFAULT 0 CHECK (dropped_frames >= 0),
    average_processing_ms REAL NOT NULL DEFAULT 0 CHECK (average_processing_ms >= 0),
    detector_version INTEGER NOT NULL CHECK (detector_version > 0),
    status TEXT NOT NULL CHECK (status IN (
      'running','complete','capture_unavailable','calibration_required','failed','aborted')),
    terminal_error_code TEXT,
    debug_retention INTEGER NOT NULL DEFAULT 0 CHECK (debug_retention IN (0,1))
  );
  CREATE INDEX idx_minimap_capture_owner
    ON minimap_capture_sessions (puuid, game_id, started_at);

  CREATE TABLE minimap_calibrations (
    calibration_id TEXT PRIMARY KEY,
    source_fingerprint TEXT NOT NULL,
    source_width INTEGER NOT NULL CHECK (source_width > 0),
    source_height INTEGER NOT NULL CHECK (source_height > 0),
    minimap_rect_json TEXT NOT NULL CHECK (json_valid(minimap_rect_json)),
    inner_map_rect_json TEXT NOT NULL CHECK (json_valid(inner_map_rect_json)),
    placement TEXT NOT NULL CHECK (placement IN ('left','right')),
    display_scale_factor REAL NOT NULL CHECK (display_scale_factor > 0),
    color_model_json TEXT CHECK (color_model_json IS NULL OR json_valid(color_model_json)),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    calibration_version INTEGER NOT NULL CHECK (calibration_version > 0),
    created_at INTEGER NOT NULL,
    verified_at INTEGER NOT NULL
  );
  CREATE INDEX idx_minimap_calibration_fingerprint
    ON minimap_calibrations (source_fingerprint, verified_at DESC);

  CREATE TABLE champion_track_chunks (
    game_id INTEGER NOT NULL,
    puuid TEXT NOT NULL,
    participant_key TEXT NOT NULL,
    champion_name TEXT NOT NULL,
    team TEXT NOT NULL CHECK (team IN ('ally','enemy')),
    is_local INTEGER NOT NULL CHECK (is_local IN (0,1)),
    chunk_start_ms INTEGER NOT NULL CHECK (chunk_start_ms >= 0),
    chunk_end_ms INTEGER NOT NULL CHECK (chunk_end_ms >= chunk_start_ms),
    point_count INTEGER NOT NULL CHECK (point_count > 0),
    encoding TEXT NOT NULL CHECK (encoding = 'gzip_delta_json_v1'),
    uncompressed_bytes INTEGER NOT NULL CHECK (uncompressed_bytes > 0),
    compressed_bytes INTEGER NOT NULL CHECK (compressed_bytes >= 18),
    payload_sha256 TEXT NOT NULL CHECK (
      length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
    payload BLOB NOT NULL CHECK (
      typeof(payload) = 'blob' AND length(payload) = compressed_bytes),
    detector_version INTEGER NOT NULL CHECK (detector_version > 0),
    PRIMARY KEY (game_id, puuid, participant_key, chunk_start_ms)
  );
  CREATE INDEX idx_champion_track_owner
    ON champion_track_chunks (puuid, game_id, participant_key, chunk_start_ms);

  CREATE TABLE camp_state_events (
    game_id INTEGER NOT NULL,
    puuid TEXT NOT NULL,
    camp_key TEXT NOT NULL,
    game_time_ms INTEGER NOT NULL CHECK (game_time_ms >= 0),
    state TEXT NOT NULL CHECK (state IN (
      'alive','dead','respawn_long','respawn_soon','unknown')),
    source TEXT NOT NULL CHECK (source IN (
      'minimap_cv','live_client_inference','manual')),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    provider_version INTEGER NOT NULL CHECK (provider_version > 0),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (game_id, puuid, camp_key, game_time_ms, source)
  );
  CREATE INDEX idx_camp_state_owner
    ON camp_state_events (puuid, game_id, camp_key, game_time_ms);

  CREATE TABLE camp_clear_events (
    game_id INTEGER NOT NULL,
    puuid TEXT NOT NULL,
    camp_key TEXT NOT NULL,
    cleared_at_ms INTEGER NOT NULL CHECK (cleared_at_ms >= 0),
    respawn_at_ms INTEGER CHECK (respawn_at_ms IS NULL OR respawn_at_ms > cleared_at_ms),
    source TEXT NOT NULL CHECK (source IN (
      'minimap_cv','live_client_inference','manual')),
    source_confidence REAL NOT NULL CHECK (source_confidence BETWEEN 0 AND 1),
    attribution TEXT NOT NULL CHECK (attribution IN ('local','other','uncertain')),
    attribution_confidence REAL NOT NULL CHECK (attribution_confidence BETWEEN 0 AND 1),
    evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
    route_index INTEGER CHECK (route_index IS NULL OR route_index >= 0),
    algorithm_version INTEGER NOT NULL CHECK (algorithm_version > 0),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (game_id, puuid, camp_key, cleared_at_ms)
  );
  CREATE INDEX idx_camp_clear_owner
    ON camp_clear_events (puuid, game_id, cleared_at_ms);

  CREATE TABLE pathing_analysis_runs (
    analysis_id TEXT PRIMARY KEY,
    game_id INTEGER NOT NULL,
    puuid TEXT NOT NULL,
    input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
    graph_version INTEGER NOT NULL CHECK (graph_version > 0),
    model_version INTEGER NOT NULL CHECK (model_version > 0),
    mode TEXT NOT NULL CHECK (mode = 'postgame_smoothed'),
    status TEXT NOT NULL CHECK (status IN ('running','complete','failed')),
    coverage_json TEXT NOT NULL CHECK (json_valid(coverage_json)),
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    error_code TEXT
  );
  CREATE UNIQUE INDEX idx_pathing_analysis_input
    ON pathing_analysis_runs (game_id, puuid, input_hash, graph_version, model_version);

  CREATE TABLE path_segments (
    analysis_id TEXT NOT NULL,
    participant_key TEXT NOT NULL,
    start_time_ms INTEGER NOT NULL CHECK (start_time_ms >= 0),
    end_time_ms INTEGER NOT NULL CHECK (end_time_ms >= start_time_ms),
    kind TEXT NOT NULL CHECK (kind IN ('observed','interpolated','inferred','unknown')),
    points_json TEXT NOT NULL CHECK (json_valid(points_json)),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    uncertainty_json TEXT CHECK (uncertainty_json IS NULL OR json_valid(uncertainty_json)),
    inference_mode TEXT CHECK (
      inference_mode IS NULL OR inference_mode = 'smoothed_postgame'),
    model_version INTEGER NOT NULL CHECK (model_version > 0),
    PRIMARY KEY (analysis_id, participant_key, start_time_ms, end_time_ms, kind),
    FOREIGN KEY (analysis_id) REFERENCES pathing_analysis_runs (analysis_id)
      ON DELETE CASCADE
  );
  CREATE INDEX idx_path_segments_participant
    ON path_segments (analysis_id, participant_key, start_time_ms);
`

interface DatabaseLike {
  prepare(sql: string): {
    all(...parameters: unknown[]): unknown[]
  }
  pragma?(name: string): unknown
}

export function verifyMinimapTelemetryV33(db: DatabaseLike) {
  const required = new Set([
    "minimap_capture_sessions",
    "minimap_calibrations",
    "champion_track_chunks",
    "camp_state_events",
    "camp_clear_events",
    "pathing_analysis_runs",
    "path_segments",
  ])
  const rows = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND (name LIKE '%minimap%'
       OR name IN (
         'champion_track_chunks','camp_state_events','camp_clear_events',
         'pathing_analysis_runs','path_segments'))
  `).all() as Array<{ name?: string }>
  for (const row of rows) if (row.name) required.delete(row.name)
  if (required.size > 0) {
    throw new Error(`minimap_telemetry_schema_missing:${[...required].join(",")}`)
  }
  const foreignKeys = db.pragma?.("foreign_key_check")
  if (Array.isArray(foreignKeys) && foreignKeys.length > 0) {
    throw new Error("minimap_telemetry_foreign_key_violation")
  }
}

/** Numeric-only capture quality aggregates; no screenshots or frame payloads. */
export const MINIMAP_TELEMETRY_V34_UP = `
  ALTER TABLE minimap_capture_sessions
    ADD COLUMN capture_attempts INTEGER NOT NULL DEFAULT 0 CHECK (capture_attempts >= 0);
  ALTER TABLE minimap_capture_sessions
    ADD COLUMN rejected_frames INTEGER NOT NULL DEFAULT 0 CHECK (rejected_frames >= 0);
  ALTER TABLE minimap_capture_sessions
    ADD COLUMN achieved_fps REAL NOT NULL DEFAULT 0 CHECK (achieved_fps >= 0);
  ALTER TABLE minimap_capture_sessions
    ADD COLUMN p95_frame_gap_ms REAL NOT NULL DEFAULT 0 CHECK (p95_frame_gap_ms >= 0);
  ALTER TABLE minimap_capture_sessions
    ADD COLUMN maximum_frame_gap_ms REAL NOT NULL DEFAULT 0 CHECK (maximum_frame_gap_ms >= 0);
  ALTER TABLE minimap_capture_sessions
    ADD COLUMN confirmed_observations INTEGER NOT NULL DEFAULT 0
      CHECK (confirmed_observations >= 0);
`

export function verifyMinimapTelemetryV34(db: DatabaseLike) {
  const required = new Set([
    "capture_attempts",
    "rejected_frames",
    "achieved_fps",
    "p95_frame_gap_ms",
    "maximum_frame_gap_ms",
    "confirmed_observations",
  ])
  const columns = db.prepare("PRAGMA table_info(minimap_capture_sessions)")
    .all() as Array<{ name?: string }>
  for (const column of columns) if (column.name) required.delete(column.name)
  if (required.size > 0) {
    throw new Error(`minimap_capture_quality_columns_missing:${[...required].join(",")}`)
  }
}
