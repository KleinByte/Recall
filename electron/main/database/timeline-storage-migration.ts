import type { Database } from "better-sqlite3"
import { createHash } from "node:crypto"
import {
  canonicalJson,
  decodeJsonBodyV1,
  gzipCanonicalJsonV1,
} from "./json-body-codec.js"
import {
  selectTimelineSource,
  timelineSourceMetadata,
  type TimelineSource,
  type TimelineSourceCandidate,
  type TimelineSourceStatus,
} from "./timeline-repo.js"
import type { CompactTimeline } from "../riot/timeline-mapper.js"

/** Frozen into schema v32. A future mapper requires a later migration. */
export const TIMELINE_STORAGE_V32_MAPPER = 11

interface LegacyCacheRow {
  gameId: number
  puuid: string
  status: "not_requested" | "pending" | "loading" | "ready" | "unavailable" | "error"
  mapperVersion: number
  fetchedAt: number | null
  error: string | null
  dataJson: string | null
  rawJson: string | null
  updatedAt: number
}

interface LegacySourceRow extends TimelineSourceCandidate {
  gameId: number
  puuid: string
  source: TimelineSource
  sourceMatchId: string | null
  dataSha256: string | null
  eventCategoriesJson: string
  evidenceCountsJson: string
  sourcePayloadSha256: string | null
  updatedAt: number
}

interface V32SourceRow {
  gameId: number
  puuid: string
  source: TimelineSource
  sourceMatchId: string
  mapperVersion: number
  status: TimelineSourceStatus
  dataJson: string | null
  dataSha256: string | null
  eventCategoriesJson: string
  evidenceCountsJson: string
  sourcePayloadSha256: string | null
  capturedAt: number
  fetchedAt: number | null
  error: string | null
  updatedAt: number
}

const keyFor = (gameId: number, puuid: string) => `${gameId}\u0000${puuid}`
const sourceKeyFor = (gameId: number, puuid: string, source: TimelineSource) =>
  `${keyFor(gameId, puuid)}\u0000${source}`

function canonicalJsonText(text: string, errorCode: string): string {
  try {
    return canonicalJson(JSON.parse(text) as unknown)
  } catch (error) {
    throw new Error(errorCode, { cause: error })
  }
}

function unavailableReason(row: LegacySourceRow): string | null {
  try {
    const value = JSON.parse(row.dataJson ?? row.evidenceCountsJson ?? "{}") as {
      reason?: unknown
    }
    return typeof value.reason === "string" ? value.reason : null
  } catch {
    try {
      const value = JSON.parse(row.evidenceCountsJson) as { reason?: unknown }
      return typeof value.reason === "string" ? value.reason : null
    } catch {
      return null
    }
  }
}

function canonicalSourceMatchId(row: LegacySourceRow): string {
  if (row.source === "league_client") return String(row.gameId)
  const sourceMatchId = row.sourceMatchId?.trim()
  if (!sourceMatchId) {
    throw new Error("timeline_v32_match_v5_source_identity_missing")
  }
  return sourceMatchId
}

function sourceRowFromLegacy(row: LegacySourceRow): V32SourceRow {
  if (row.status === "ready") {
    if (!row.dataJson) throw new Error("timeline_v32_ready_source_missing_data")
    const canonical = canonicalJsonText(row.dataJson, "timeline_v32_source_json_invalid")
    const storedHash = createHash("sha256").update(canonical).digest("hex")
    if (canonical !== row.dataJson || storedHash !== row.dataSha256) {
      throw new Error("timeline_v32_source_hash_or_canonical_mismatch")
    }
    const timeline = JSON.parse(canonical) as CompactTimeline
    const metadata = timelineSourceMetadata(timeline)
    return {
      ...row,
      sourceMatchId: canonicalSourceMatchId(row),
      dataJson: metadata.dataJson,
      dataSha256: metadata.dataSha256,
      eventCategoriesJson: metadata.eventCategoriesJson,
      evidenceCountsJson: metadata.evidenceCountsJson,
      fetchedAt: row.capturedAt,
      error: null,
    }
  }
  return {
    ...row,
    sourceMatchId: canonicalSourceMatchId(row),
    status: "unavailable",
    dataJson: null,
    dataSha256: null,
    eventCategoriesJson: "[]",
    evidenceCountsJson: canonicalJson({
      version: 1,
      ...(unavailableReason(row) ? { reason: unavailableReason(row) } : {}),
    }),
    sourcePayloadSha256: null,
    fetchedAt: row.capturedAt,
    error: unavailableReason(row),
  }
}

export const TIMELINE_STORAGE_V32_UP = `
  CREATE TABLE match_timeline_sources_v32 (
    game_id INTEGER NOT NULL,
    puuid TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('league_client','match_v5')),
    source_match_id TEXT NOT NULL,
    mapper_version INTEGER NOT NULL CHECK (mapper_version > 0),
    status TEXT NOT NULL CHECK (
      status IN ('pending','loading','ready','unavailable','error')
    ),
    data_json TEXT,
    data_sha256 TEXT,
    event_categories_json TEXT NOT NULL,
    evidence_counts_json TEXT NOT NULL,
    source_payload_sha256 TEXT,
    captured_at INTEGER NOT NULL CHECK (captured_at >= 0),
    fetched_at INTEGER CHECK (fetched_at IS NULL OR fetched_at >= 0),
    last_error TEXT,
    updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
    CHECK (json_valid(event_categories_json) AND json_valid(evidence_counts_json)),
    CHECK (data_json IS NULL OR json_valid(data_json)),
    CHECK (data_sha256 IS NULL OR (
      length(data_sha256) = 64 AND data_sha256 NOT GLOB '*[^0-9a-f]*'
    )),
    CHECK (source_payload_sha256 IS NULL OR (
      length(source_payload_sha256) = 64
      AND source_payload_sha256 NOT GLOB '*[^0-9a-f]*'
    )),
    CHECK (
      (status = 'ready' AND data_json IS NOT NULL AND data_sha256 IS NOT NULL
        AND last_error IS NULL)
      OR
      (status <> 'ready' AND data_json IS NULL AND data_sha256 IS NULL)
    ),
    PRIMARY KEY (game_id, puuid, source),
    FOREIGN KEY (game_id, puuid) REFERENCES matches (game_id, puuid)
      ON DELETE CASCADE
  );
`

function insertSourceStatement(db: Database) {
  return db.prepare(`
    INSERT INTO match_timeline_sources_v32
      (game_id, puuid, source, source_match_id, mapper_version, status,
       data_json, data_sha256, event_categories_json, evidence_counts_json,
       source_payload_sha256, captured_at, fetched_at, last_error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
}

function insertSource(db: Database, row: V32SourceRow): void {
  insertSourceStatement(db).run(
    row.gameId, row.puuid, row.source, row.sourceMatchId,
    row.mapperVersion, row.status, row.dataJson, row.dataSha256,
    row.eventCategoriesJson, row.evidenceCountsJson,
    row.sourcePayloadSha256, row.capturedAt, row.fetchedAt,
    row.error, row.updatedAt,
  )
}

function replaceSource(db: Database, row: V32SourceRow): void {
  db.prepare(`
    DELETE FROM match_timeline_sources_v32
    WHERE game_id = ? AND puuid = ? AND source = ?
  `).run(row.gameId, row.puuid, row.source)
  insertSource(db, row)
}

function ensureCacheRawPayload(db: Database, cache: LegacyCacheRow): string | undefined {
  if (!cache.rawJson) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(cache.rawJson) as unknown
  } catch (error) {
    throw new Error("timeline_v32_cache_raw_json_invalid", { cause: error })
  }
  const canonicalRawJson = canonicalJson(raw)
  const encoded = gzipCanonicalJsonV1(raw)
  const sourceMatchId = String(cache.gameId)
  const observedAt = cache.fetchedAt ?? cache.updatedAt
  const mapped = cache.status === "ready" && cache.dataJson !== null
  const failed = cache.status === "unavailable" || cache.status === "error"
  const mappingStatus = mapped ? "mapped" : failed ? "unmappable" : "pending"
  const mappingError = failed
    ? cache.error ?? `legacy_cache_status:${cache.status}`
    : null
  const mappedAt = mapped || failed ? observedAt : null
  const existing = db.prepare(`
    SELECT payload, sha256, mapping_status AS mappingStatus
    FROM match_source_payloads
    WHERE owner_puuid = ? AND source = 'league_client'
      AND source_match_id = ? AND kind = 'timeline' AND sha256 = ?
  `).get(cache.puuid, sourceMatchId, encoded.sha256) as
    { payload: Buffer; sha256: string; mappingStatus: string } | undefined
  if (existing) {
    const decoded = decodeJsonBodyV1(existing.payload, existing.sha256)
    if (canonicalJson(decoded.value) !== decoded.text || decoded.text !== canonicalRawJson) {
      throw new Error("timeline_v32_existing_raw_payload_not_canonical")
    }
    // This cache row is another representation of an observation already in
    // the raw store, not a newly fetched observation. Reconcile mapping state
    // and provenance without touching observation_count or fetch timestamps.
    const preserveMapping = !mapped && !failed
    if (preserveMapping) {
      db.prepare(`
        UPDATE match_source_payloads
        SET game_id = COALESCE(game_id, ?),
            mapper_version = MAX(mapper_version, ?)
        WHERE owner_puuid = ? AND source = 'league_client'
          AND source_match_id = ? AND kind = 'timeline' AND sha256 = ?
      `).run(cache.gameId, cache.mapperVersion, cache.puuid, sourceMatchId, encoded.sha256)
    } else {
      db.prepare(`
        UPDATE match_source_payloads
        SET game_id = COALESCE(game_id, ?),
            mapper_version = MAX(mapper_version, ?),
            mapping_status = ?, mapping_error = ?, mapped_at = ?
        WHERE owner_puuid = ? AND source = 'league_client'
          AND source_match_id = ? AND kind = 'timeline' AND sha256 = ?
      `).run(
        cache.gameId,
        cache.mapperVersion,
        mappingStatus,
        mapped ? null : mappingError,
        mappedAt,
        cache.puuid,
        sourceMatchId,
        encoded.sha256,
      )
    }
    return encoded.sha256
  }

  db.prepare(`
    INSERT INTO match_source_payloads
      (owner_puuid, source, source_match_id, game_id, kind, encoding,
       payload, sha256, data_version, mapper_version,
       serialization_version, mapping_status, mapping_error, mapped_at,
       fetched_at, first_fetched_at, last_fetched_at, observation_count)
    VALUES (?, 'league_client', ?, ?, 'timeline', 'gzip_json_v1',
            ?, ?, NULL, ?, 1, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    cache.puuid, sourceMatchId, cache.gameId, encoded.payload, encoded.sha256,
    cache.mapperVersion, mappingStatus, mappingError, mappedAt,
    observedAt, observedAt, observedAt,
  )
  return encoded.sha256
}

function sourceRows(db: Database): LegacySourceRow[] {
  return db.prepare(`
    SELECT game_id AS gameId, puuid, source,
           source_match_id AS sourceMatchId,
           mapper_version AS mapperVersion, status,
           data_json AS dataJson, data_sha256 AS dataSha256,
           event_categories_json AS eventCategoriesJson,
           evidence_counts_json AS evidenceCountsJson,
           source_payload_sha256 AS sourcePayloadSha256,
           captured_at AS capturedAt, updated_at AS updatedAt
    FROM match_timeline_sources
    ORDER BY game_id, puuid, source, mapper_version DESC, captured_at DESC
  `).all() as LegacySourceRow[]
}

function cacheRows(db: Database): LegacyCacheRow[] {
  return db.prepare(`
    SELECT game_id AS gameId, puuid, status,
           mapper_version AS mapperVersion, fetched_at AS fetchedAt,
           last_error AS error, data_json AS dataJson, raw_json AS rawJson,
           updated_at AS updatedAt
    FROM match_timeline_cache
    ORDER BY game_id, puuid
  `).all() as LegacyCacheRow[]
}

function stagedSources(db: Database, gameId: number, puuid: string): V32SourceRow[] {
  return db.prepare(`
    SELECT game_id AS gameId, puuid, source,
           source_match_id AS sourceMatchId,
           mapper_version AS mapperVersion, status,
           data_json AS dataJson, data_sha256 AS dataSha256,
           event_categories_json AS eventCategoriesJson,
           evidence_counts_json AS evidenceCountsJson,
           source_payload_sha256 AS sourcePayloadSha256,
           captured_at AS capturedAt, fetched_at AS fetchedAt,
           last_error AS error, updated_at AS updatedAt
    FROM match_timeline_sources_v32
    WHERE game_id = ? AND puuid = ?
  `).all(gameId, puuid) as V32SourceRow[]
}

function currentSelected(rows: readonly V32SourceRow[]): V32SourceRow | undefined {
  const selected = selectTimelineSource(rows, TIMELINE_STORAGE_V32_MAPPER)
  return selected as V32SourceRow | undefined
}

function selectedCurrentSource(rows: LegacySourceRow[]): LegacySourceRow | undefined {
  return rows.filter((row) => row.mapperVersion === TIMELINE_STORAGE_V32_MAPPER)
    .sort((left, right) => right.capturedAt - left.capturedAt ||
      right.updatedAt - left.updatedAt)[0]
}

export function migrateTimelineStorageV32(db: Database): void {
  const unsupported = db.prepare(`
    SELECT
      SUM(CASE WHEN source = 'live_capture' THEN 1 ELSE 0 END) AS liveCaptureRows,
      SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) AS partialRows
    FROM match_timeline_sources
  `).get() as { liveCaptureRows: number | null; partialRows: number | null }
  if (Number(unsupported.liveCaptureRows) > 0) {
    throw new Error("timeline_v32_live_capture_source_requires_manual_resolution")
  }
  if (Number(unsupported.partialRows) > 0) {
    throw new Error("timeline_v32_partial_source_requires_manual_resolution")
  }

  const caches = cacheRows(db)
  const rawHashByMatch = new Map<string, string>()
  for (const cache of caches) {
    const hash = ensureCacheRawPayload(db, cache)
    if (hash) rawHashByMatch.set(keyFor(cache.gameId, cache.puuid), hash)
  }

  const grouped = new Map<string, LegacySourceRow[]>()
  for (const row of sourceRows(db)) {
    const key = sourceKeyFor(row.gameId, row.puuid, row.source)
    const rows = grouped.get(key) ?? []
    rows.push(row)
    grouped.set(key, rows)
  }
  for (const rows of grouped.values()) {
    const current = selectedCurrentSource(rows)
    // Old compact mapper output is derivable and no reader consumes it after
    // this cutover. Its canonical raw body remains available for a future
    // remap, so retaining another JSON generation would only recreate the
    // versioned duplication v32 removes.
    if (!current) continue
    const selected = sourceRowFromLegacy(current)
    if (selected.source === "league_client") {
      selected.sourceMatchId = String(selected.gameId)
      selected.sourcePayloadSha256 = rawHashByMatch.get(
        keyFor(selected.gameId, selected.puuid),
      ) ?? selected.sourcePayloadSha256
    }
    insertSource(db, selected)
  }

  for (const cache of caches) {
    const rows = stagedSources(db, cache.gameId, cache.puuid)
    const selected = currentSelected(rows)
    const local = rows.find((row) => row.source === "league_client")
    const rawHash = rawHashByMatch.get(keyFor(cache.gameId, cache.puuid))

    if (cache.status === "ready") {
      if (!cache.dataJson) throw new Error("timeline_v32_ready_cache_missing_data")
      const cacheJson = canonicalJsonText(cache.dataJson, "timeline_v32_cache_json_invalid")
      if (cache.dataJson !== cacheJson) {
        throw new Error("timeline_v32_cache_json_not_canonical")
      }
      if (selected) {
        if (cacheJson !== selected.dataJson) {
          throw new Error("timeline_v32_cache_selected_source_divergence")
        }
        continue
      }

      if (cache.mapperVersion !== TIMELINE_STORAGE_V32_MAPPER) {
        if (!rawHash) throw new Error("timeline_v32_stale_cache_without_raw_payload")
        continue
      }

      if (local && (local.status !== "ready" || local.dataJson !== cacheJson)) {
        throw new Error("timeline_v32_current_cache_source_divergence")
      }
      if (!local) {
        const metadata = timelineSourceMetadata(JSON.parse(cacheJson) as CompactTimeline)
        insertSource(db, {
          gameId: cache.gameId,
          puuid: cache.puuid,
          source: "league_client",
          sourceMatchId: String(cache.gameId),
          mapperVersion: cache.mapperVersion,
          status: "ready",
          dataJson: metadata.dataJson,
          dataSha256: metadata.dataSha256,
          eventCategoriesJson: metadata.eventCategoriesJson,
          evidenceCountsJson: metadata.evidenceCountsJson,
          sourcePayloadSha256: rawHash ?? null,
          capturedAt: cache.fetchedAt ?? cache.updatedAt,
          fetchedAt: cache.fetchedAt,
          error: null,
          updatedAt: cache.updatedAt,
        })
      }
      continue
    }

    if (selected) throw new Error("timeline_v32_cache_status_selected_source_divergence")
    if (cache.status === "not_requested") {
      continue
    }

    replaceSource(db, {
      gameId: cache.gameId,
      puuid: cache.puuid,
      source: "league_client",
      sourceMatchId: String(cache.gameId),
      mapperVersion: TIMELINE_STORAGE_V32_MAPPER,
      status: cache.status,
      dataJson: null,
      dataSha256: null,
      eventCategoriesJson: "[]",
      evidenceCountsJson: canonicalJson({
        version: 1,
        ...(cache.error ? { reason: cache.error } : {}),
      }),
      sourcePayloadSha256: null,
      capturedAt: cache.fetchedAt ?? cache.updatedAt,
      fetchedAt: cache.fetchedAt,
      error: cache.error,
      updatedAt: cache.updatedAt,
    })
  }

  for (const cache of caches.filter((row) => row.rawJson !== null)) {
    const hash = rawHashByMatch.get(keyFor(cache.gameId, cache.puuid))
    const found = hash && db.prepare(`
      SELECT 1 AS present FROM match_source_payloads
      WHERE owner_puuid = ? AND source = 'league_client'
        AND source_match_id = ? AND kind = 'timeline' AND sha256 = ?
    `).get(cache.puuid, String(cache.gameId), hash)
    if (!found) throw new Error("timeline_v32_cache_raw_payload_not_promoted")
  }
}

export const TIMELINE_STORAGE_V32_AFTER = `
  DROP TABLE match_timeline_cache;
  DROP TABLE match_timeline_sources;
  ALTER TABLE match_timeline_sources_v32 RENAME TO match_timeline_sources;

  CREATE INDEX idx_timeline_sources_owner_status
    ON match_timeline_sources (puuid, status, mapper_version, game_id);

  CREATE VIEW selected_match_timelines AS
  SELECT timeline.*
  FROM match_timeline_sources timeline
  WHERE timeline.mapper_version = 11
    AND timeline.status = 'ready'
    AND timeline.data_json IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM match_timeline_sources preferred
      WHERE preferred.game_id = timeline.game_id
        AND preferred.puuid = timeline.puuid
        AND preferred.mapper_version = 11
        AND preferred.status = 'ready'
        AND preferred.data_json IS NOT NULL
        AND CASE preferred.source WHEN 'match_v5' THEN 0 ELSE 1 END
          < CASE timeline.source WHEN 'match_v5' THEN 0 ELSE 1 END
    );
`

export function verifyTimelineStorageV32(db: Database): void {
  const cache = db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'match_timeline_cache'
  `).get()
  if (cache) throw new Error("timeline_v32_compatibility_cache_retained")

  const rows = db.prepare(`
    SELECT game_id AS gameId, puuid, source,
           source_match_id AS sourceMatchId, status,
           data_json AS dataJson, data_sha256 AS dataSha256,
           source_payload_sha256 AS sourcePayloadSha256
    FROM match_timeline_sources
  `).all() as Array<{
    gameId: number
    puuid: string
    source: TimelineSource
    sourceMatchId: string
    status: TimelineSourceStatus
    dataJson: string | null
    dataSha256: string | null
    sourcePayloadSha256: string | null
  }>
  for (const row of rows) {
    if (row.status === "ready") {
      if (!row.dataJson || !row.dataSha256) {
        throw new Error("timeline_v32_ready_source_incomplete")
      }
      const canonical = canonicalJsonText(row.dataJson, "timeline_v32_source_json_invalid")
      const hash = createHash("sha256").update(canonical).digest("hex")
      if (canonical !== row.dataJson || hash !== row.dataSha256) {
        throw new Error("timeline_v32_source_hash_or_canonical_mismatch")
      }
    }
    if (row.source === "league_client" && row.sourceMatchId !== String(row.gameId)) {
      throw new Error("timeline_v32_lcu_source_identity_mismatch")
    }
    if (row.sourcePayloadSha256) {
      const payload = db.prepare(`
        SELECT encoding, payload, sha256
        FROM match_source_payloads
        WHERE owner_puuid = ? AND source = ? AND source_match_id = ?
          AND kind = 'timeline' AND sha256 = ?
      `).get(row.puuid, row.source, row.sourceMatchId, row.sourcePayloadSha256) as
        { encoding: string; payload: Buffer; sha256: string } | undefined
      if (!payload) throw new Error("timeline_v32_source_payload_link_broken")
      if (payload.encoding !== "gzip_json_v1") {
        throw new Error("timeline_v32_source_payload_encoding_invalid")
      }
      const decoded = decodeJsonBodyV1(payload.payload, payload.sha256)
      if (canonicalJson(decoded.value) !== decoded.text) {
        throw new Error("timeline_v32_source_payload_not_canonical")
      }
    }
  }

  const duplicate = db.prepare(`
    SELECT 1 FROM match_timeline_sources
    GROUP BY game_id, puuid, source HAVING COUNT(*) <> 1 LIMIT 1
  `).get()
  if (duplicate) throw new Error("timeline_v32_duplicate_source")
  if ((db.pragma("foreign_key_check") as unknown[]).length > 0) {
    throw new Error("timeline_v32_foreign_key_violation")
  }
}
