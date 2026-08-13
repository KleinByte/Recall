import type Database from "better-sqlite3-node"

function scalar(db: Database.Database, sql: string): number {
  return Number((db.prepare(sql).get() as { count: number }).count)
}

function hasTable(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(table))
}

function hasRelation(db: Database.Database, relation: string): boolean {
  return Boolean(db.prepare(`
    SELECT 1 FROM sqlite_master
    WHERE type IN ('table', 'view') AND name = ?
  `).get(relation))
}

function hasColumns(
  db: Database.Database,
  table: string,
  columns: readonly string[],
): boolean {
  if (!hasTable(db, table)) return false
  const present = new Set((db.pragma(`table_info(${table})`) as { name: string }[])
    .map((entry) => entry.name))
  return columns.every((column) => present.has(column))
}

function sumIfColumns(
  db: Database.Database,
  table: string,
  columns: readonly string[],
  expression: string,
): number {
  return hasColumns(db, table, columns)
    ? scalar(db, `SELECT COALESCE(SUM(${expression}), 0) AS count FROM ${table}`)
    : 0
}

export function migrationRehearsalCounts(db: Database.Database) {
  const canFilterHistory = hasColumns(db, "match_source_payloads", [
    "source", "kind",
  ])
  const canIdentifyHistory = hasColumns(db, "match_source_payloads", [
    "owner_puuid", "source", "kind", "sha256",
  ])
  const hasObservationCount = hasColumns(db, "match_source_payloads", [
    "source", "kind", "observation_count",
  ])
  const metricObservationRelation = hasRelation(
    db,
    "match_metric_observation_details",
  )
    ? "match_metric_observation_details"
    : hasColumns(db, "match_metric_observations", [
        "algorithm_version", "recipe_id", "calibration_id",
      ])
      ? "match_metric_observations"
      : undefined
  const canFilterRawTimelines = hasColumns(db, "match_source_payloads", [
    "source", "kind",
  ])
  const hasTimelineObservationCount = hasColumns(db, "match_source_payloads", [
    "source", "kind", "observation_count",
  ])
  const hasSelectedTimelines = hasRelation(db, "selected_match_timelines")
  const hasTimelineSources = hasTable(db, "match_timeline_sources")
  const hasTimelineCache = hasTable(db, "match_timeline_cache")
  return {
    matches: hasTable(db, "matches")
      ? scalar(db, "SELECT COUNT(*) AS count FROM matches") : 0,
    participants: hasTable(db, "match_participants")
      ? scalar(db, "SELECT COUNT(*) AS count FROM match_participants") : 0,
    historyPages: canFilterHistory ? scalar(db, `
      SELECT COUNT(*) AS count FROM match_source_payloads
      WHERE source = 'league_client' AND kind = 'history_page'
    `) : 0,
    distinctHistoryBodies: canIdentifyHistory ? scalar(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT owner_puuid, source, kind, sha256
        FROM match_source_payloads
        WHERE source = 'league_client' AND kind = 'history_page'
        GROUP BY owner_puuid, source, kind, sha256
      )
    `) : 0,
    historyObservations: canFilterHistory ? scalar(db, hasObservationCount ? `
      SELECT COALESCE(SUM(observation_count), 0) AS count
      FROM match_source_payloads
      WHERE source = 'league_client' AND kind = 'history_page'
    ` : `
      SELECT COUNT(*) AS count FROM match_source_payloads
      WHERE source = 'league_client' AND kind = 'history_page'
    `) : 0,
    metricObservations: metricObservationRelation
      ? scalar(db, `SELECT COUNT(*) AS count FROM ${metricObservationRelation}`)
      : 0,
    metricRecipeIdentities: metricObservationRelation ? scalar(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT algorithm_version, recipe_id, calibration_id
        FROM ${metricObservationRelation}
        GROUP BY algorithm_version, recipe_id, calibration_id
      )
    `) : 0,
    liveSnapshots: hasTable(db, "live_game_snapshots")
      ? scalar(db, "SELECT COUNT(*) AS count FROM live_game_snapshots") : 0,
    gradeCalibrationSnapshots: hasTable(db, "grade_calibration_snapshots")
      ? scalar(db, "SELECT COUNT(*) AS count FROM grade_calibration_snapshots") : 0,
    timelineCacheRows: hasTimelineCache
      ? scalar(db, "SELECT COUNT(*) AS count FROM match_timeline_cache") : 0,
    timelineCacheRawBodies: hasColumns(db, "match_timeline_cache", ["raw_json"])
      ? scalar(db, `
          SELECT COUNT(*) AS count FROM match_timeline_cache
          WHERE raw_json IS NOT NULL
        `) : 0,
    timelineSourceRows: hasTimelineSources
      ? scalar(db, "SELECT COUNT(*) AS count FROM match_timeline_sources") : 0,
    timelineSourceKeys: hasTimelineSources ? scalar(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT game_id, puuid, source FROM match_timeline_sources
        GROUP BY game_id, puuid, source
      )
    `) : 0,
    currentTimelineSourceKeys: hasColumns(db, "match_timeline_sources", [
      "game_id", "puuid", "source", "mapper_version",
    ]) ? scalar(db, `
      SELECT COUNT(*) AS count FROM (
        SELECT game_id, puuid, source FROM match_timeline_sources
        WHERE mapper_version = 11
        GROUP BY game_id, puuid, source
      )
    `) : 0,
    selectedTimelines: hasSelectedTimelines
      ? scalar(db, "SELECT COUNT(*) AS count FROM selected_match_timelines")
      : hasTimelineCache ? scalar(db, `
          SELECT COUNT(*) AS count FROM match_timeline_cache
          WHERE status = 'ready' AND mapper_version = 11 AND data_json IS NOT NULL
        `) : 0,
    rawTimelineBodies: canFilterRawTimelines ? scalar(db, `
      SELECT COUNT(*) AS count FROM match_source_payloads
      WHERE source IN ('league_client', 'match_v5') AND kind = 'timeline'
    `) : 0,
    rawTimelineObservations: canFilterRawTimelines ? scalar(
      db,
      hasTimelineObservationCount ? `
        SELECT COALESCE(SUM(observation_count), 0) AS count
        FROM match_source_payloads
        WHERE source IN ('league_client', 'match_v5') AND kind = 'timeline'
      ` : `
        SELECT COUNT(*) AS count FROM match_source_payloads
        WHERE source IN ('league_client', 'match_v5') AND kind = 'timeline'
      `,
    ) : 0,
  }
}

export function migrationStorageProfile(db: Database.Database) {
  const pageSize = Number(db.pragma("page_size", { simple: true }))
  const pageCount = Number(db.pragma("page_count", { simple: true }))
  const freePages = Number(db.pragma("freelist_count", { simple: true }))
  const oldMetricColumns = hasColumns(db, "match_metric_observations", [
    "algorithm_version", "recipe_id", "calibration_id",
  ])
  const repeatedRecipeTextBytes = oldMetricColumns
    ? scalar(db, `
        SELECT COALESCE(SUM(length(recipe_id) + length(calibration_id)), 0) AS count
        FROM match_metric_observations
      `)
    : 0
  let metricTreeBytes: number | null = null
  let snapshotTreeBytes: number | null = null
  let timelineTreeBytes: number | null = null
  try {
    metricTreeBytes = scalar(db, `
      SELECT COALESCE(SUM(pgsize), 0) AS count
      FROM dbstat
      WHERE name = 'match_metric_observations'
         OR name = 'rvi_recipe_storage_keys'
         OR name LIKE 'idx_metric_observations_%'
         OR name LIKE 'sqlite_autoindex_match_metric_observations_%'
         OR name LIKE 'sqlite_autoindex_rvi_recipe_storage_keys_%'
    `)
  } catch {
    // DBSTAT is optional in SQLite. The portable page and repeated-text
    // measurements still make the storage change visible in rehearsals.
  }
  try {
    timelineTreeBytes = scalar(db, `
      SELECT COALESCE(SUM(pgsize), 0) AS count
      FROM dbstat
      WHERE name IN (
        'match_timeline_cache', 'match_timeline_sources',
        'selected_match_timelines'
      )
         OR name LIKE 'idx_timeline_%'
         OR name LIKE 'sqlite_autoindex_match_timeline_%'
    `)
  } catch {
    // DBSTAT is optional; logical payload totals below remain portable.
  }
  try {
    snapshotTreeBytes = scalar(db, `
      SELECT COALESCE(SUM(pgsize), 0) AS count
      FROM dbstat
      WHERE name IN ('live_game_snapshots', 'grade_calibration_snapshots')
         OR name = 'idx_live_snapshots_owner'
         OR name LIKE 'sqlite_autoindex_live_game_snapshots_%'
         OR name LIKE 'sqlite_autoindex_grade_calibration_snapshots_%'
    `)
  } catch {
    // DBSTAT is optional; payload-byte totals below remain portable.
  }
  const legacyLiveSnapshotTextBytes = sumIfColumns(
    db,
    "live_game_snapshots",
    ["snapshot_json"],
    "length(CAST(snapshot_json AS BLOB))",
  )
  const legacyGradeCalibrationTextBytes = sumIfColumns(
    db,
    "grade_calibration_snapshots",
    ["snapshot_json"],
    "length(CAST(snapshot_json AS BLOB))",
  )
  const compressedLiveSnapshotBytes = sumIfColumns(
    db,
    "live_game_snapshots",
    ["snapshot_payload"],
    "length(snapshot_payload)",
  )
  const compressedGradeCalibrationBytes = sumIfColumns(
    db,
    "grade_calibration_snapshots",
    ["snapshot_payload"],
    "length(snapshot_payload)",
  )
  const timelineCacheCompactTextBytes = sumIfColumns(
    db,
    "match_timeline_cache",
    ["data_json"],
    "length(CAST(data_json AS BLOB))",
  )
  const timelineCacheRawTextBytes = sumIfColumns(
    db,
    "match_timeline_cache",
    ["raw_json"],
    "length(CAST(raw_json AS BLOB))",
  )
  const timelineSourceCompactTextBytes = sumIfColumns(
    db,
    "match_timeline_sources",
    ["data_json"],
    "length(CAST(data_json AS BLOB))",
  )
  const rawTimelineCompressedBytes = hasColumns(db, "match_source_payloads", [
    "source", "kind", "payload",
  ]) ? scalar(db, `
    SELECT COALESCE(SUM(length(payload)), 0) AS count
    FROM match_source_payloads
    WHERE source IN ('league_client', 'match_v5') AND kind = 'timeline'
  `) : 0
  return {
    pageSize,
    pageCount,
    freePages,
    liveDatabaseBytes: (pageCount - freePages) * pageSize,
    metricTreeBytes,
    repeatedRecipeTextBytes,
    snapshotTreeBytes,
    timelineTreeBytes,
    legacySnapshotTextBytes:
      legacyLiveSnapshotTextBytes + legacyGradeCalibrationTextBytes,
    compressedSnapshotBytes:
      compressedLiveSnapshotBytes + compressedGradeCalibrationBytes,
    timelineCacheCompactTextBytes,
    timelineCacheRawTextBytes,
    timelineSourceCompactTextBytes,
    rawTimelineCompressedBytes,
  }
}
