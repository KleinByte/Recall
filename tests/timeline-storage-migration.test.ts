import { createHash } from "node:crypto"
import Database from "better-sqlite3-node"
import { describe, expect, it } from "vitest"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import {
  executeMigration,
  migrations,
} from "../electron/main/database/migrations.js"
import {
  canonicalJson,
  decodeCanonicalJsonV1,
} from "../electron/main/database/match-source-repo.js"
import { MatchSourceRepository } from "../electron/main/database/match-source-repo.js"
import {
  TIMELINE_STORAGE_V32_AFTER,
  TIMELINE_STORAGE_V32_MAPPER,
  TIMELINE_STORAGE_V32_UP,
  migrateTimelineStorageV32,
  verifyTimelineStorageV32,
} from "../electron/main/database/timeline-storage-migration.js"
import {
  timelineSourceMetadata,
} from "../electron/main/database/timeline-repo.js"
import type { CompactTimeline } from "../electron/main/riot/timeline-mapper.js"
import { buildMatchRow } from "./fixtures/matches.js"

const PUUID = "timeline-v32-owner"

function compactTimeline(seed = 1): CompactTimeline {
  return {
    frames: [{
      timestamp: 0,
      blueGold: 500 + seed,
      redGold: 500,
      ownerGold: 500 + seed,
      ownerLevel: 1,
      ownerXp: 0,
      ownerCs: 0,
      teamGoldComplete: true,
      participants: [{
        participantId: 1,
        teamId: 100,
        currentGold: 500 + seed,
        totalGold: 500 + seed,
        level: 1,
        xp: 0,
        minionsKilled: 0,
        jungleMinionsKilled: 0,
        position: { x: 5_000, y: 5_000 },
      }],
    }],
    events: [{
      eventId: `kill-${seed}`,
      timestamp: 10_000,
      type: "CHAMPION_KILL",
      category: "kill",
      participantId: 1,
      targetId: 2,
    }],
    turningPoints: [],
  }
}

function rawTimeline(seed = 1) {
  return {
    frames: [{
      timestamp: 0,
      participantFrames: {
        "1": {
          participantId: 1,
          totalGold: 500 + seed,
          currentGold: 500 + seed,
          level: 1,
          xp: 0,
          minionsKilled: 0,
          jungleMinionsKilled: 0,
        },
      },
      events: [],
    }],
  }
}

function databaseAtV31(gameIds: readonly number[]) {
  const db = new Database(":memory:")
  const throughV31 = migrations.filter((migration) => migration.version <= 31)
  for (const migration of throughV31) executeMigration(db, migration)
  db.pragma("user_version = 31")
  new MatchesRepository(db).insertMany(gameIds.map((gameId) => buildMatchRow({
    gameId,
    puuid: PUUID,
    riotMatchId: `NA1_${gameId}`,
  })))
  return db
}

function runV32(db: Database.Database) {
  db.transaction(() => {
    db.exec(TIMELINE_STORAGE_V32_UP)
    migrateTimelineStorageV32(db as never)
    db.exec(TIMELINE_STORAGE_V32_AFTER)
    verifyTimelineStorageV32(db as never)
    db.pragma("user_version = 32")
  })()
}

function insertCache(db: Database.Database, input: {
  gameId: number
  status?: "not_requested" | "pending" | "loading" | "ready" | "unavailable" | "error"
  mapperVersion?: number
  timeline?: CompactTimeline
  raw?: unknown
  error?: string
  observedAt?: number
}) {
  const observedAt = input.observedAt ?? 1_700_000_000_000 + input.gameId
  db.prepare(`
    INSERT INTO match_timeline_cache
      (game_id, puuid, riot_match_id, status, mapper_version, fetched_at,
       last_error, data_json, raw_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.gameId,
    PUUID,
    `NA1_${input.gameId}`,
    input.status ?? "ready",
    input.mapperVersion ?? TIMELINE_STORAGE_V32_MAPPER,
    observedAt,
    input.error ?? null,
    input.timeline ? canonicalJson(input.timeline) : null,
    input.raw === undefined ? null : canonicalJson(input.raw),
    observedAt,
  )
}

function insertLegacySource(db: Database.Database, input: {
  gameId: number
  source: "league_client" | "match_v5"
  mapperVersion: number
  timeline?: CompactTimeline
  status?: "ready" | "unavailable"
  sourceMatchId?: string
  sourcePayloadSha256?: string
  capturedAt?: number
  corruptHash?: boolean
}) {
  const status = input.status ?? "ready"
  const dataJson = input.timeline ? canonicalJson(input.timeline) : null
  const dataSha256 = dataJson
    ? input.corruptHash ? "0".repeat(64) : createHash("sha256").update(dataJson).digest("hex")
    : null
  db.prepare(`
    INSERT INTO match_timeline_sources
      (game_id, puuid, source, source_match_id, mapper_version, status,
       data_json, data_sha256, event_categories_json, evidence_counts_json,
       source_payload_sha256, captured_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.gameId,
    PUUID,
    input.source,
    input.sourceMatchId ?? (
      input.source === "league_client" ? String(input.gameId) : `NA1_${input.gameId}`
    ),
    input.mapperVersion,
    status,
    dataJson,
    dataSha256,
    canonicalJson(["legacy-wrong-metadata"]),
    canonicalJson({ version: 0, wrong: true }),
    input.sourcePayloadSha256 ?? null,
    input.capturedAt ?? input.mapperVersion,
    input.capturedAt ?? input.mapperVersion,
  )
}

describe("timeline storage migration v32", () => {
  it("promotes cache-only raw JSON without incrementing an existing observation", () => {
    const db = databaseAtV31([1])
    const raw = rawTimeline(1)
    const sources = new MatchSourceRepository(db as never)
    const identity = sources.persistRawPayload({
      ownerPuuid: PUUID,
      source: "league_client",
      sourceMatchId: "1",
      gameId: 1,
      kind: "timeline",
      body: raw,
      mapperVersion: TIMELINE_STORAGE_V32_MAPPER - 1,
      fetchedAt: 100,
    })
    db.prepare(`
      UPDATE match_source_payloads
      SET observation_count = 7, mapping_status = 'unmappable',
          mapping_error = 'old mapper', mapped_at = 100
      WHERE owner_puuid = ? AND sha256 = ?
    `).run(PUUID, identity.sha256)
    insertCache(db, { gameId: 1, timeline: compactTimeline(1), raw })

    runV32(db)

    const payload = db.prepare(`
      SELECT encoding, payload, sha256, mapper_version AS mapperVersion,
             mapping_status AS mappingStatus, observation_count AS observationCount
      FROM match_source_payloads
      WHERE owner_puuid = ? AND source = 'league_client'
        AND source_match_id = '1' AND kind = 'timeline'
    `).get(PUUID) as {
      encoding: string
      payload: Buffer
      sha256: string
      mapperVersion: number
      mappingStatus: string
      observationCount: number
    }
    expect(payload.encoding).toBe("gzip_json_v1")
    expect(payload.mapperVersion).toBe(TIMELINE_STORAGE_V32_MAPPER)
    expect(payload.mappingStatus).toBe("mapped")
    expect(payload.observationCount).toBe(7)
    expect(canonicalJson(decodeCanonicalJsonV1(payload.payload, payload.sha256)))
      .toBe(canonicalJson(raw))
    expect(db.prepare(`
      SELECT source, source_match_id AS sourceMatchId,
             source_payload_sha256 AS sourcePayloadSha256
      FROM selected_match_timelines
    `).get()).toEqual({
      source: "league_client",
      sourceMatchId: "1",
      sourcePayloadSha256: payload.sha256,
    })
  })

  it("keeps one current row per source and selects Match-V5 authoritatively", () => {
    const db = databaseAtV31([2])
    const lcuOld = compactTimeline(20)
    const lcuCurrent = compactTimeline(21)
    const matchV5 = compactTimeline(22)
    insertLegacySource(db, {
      gameId: 2,
      source: "league_client",
      mapperVersion: 8,
      timeline: lcuOld,
      capturedAt: 80,
    })
    insertLegacySource(db, {
      gameId: 2,
      source: "league_client",
      mapperVersion: TIMELINE_STORAGE_V32_MAPPER,
      timeline: lcuCurrent,
      capturedAt: 110,
    })
    insertLegacySource(db, {
      gameId: 2,
      source: "match_v5",
      mapperVersion: TIMELINE_STORAGE_V32_MAPPER,
      timeline: matchV5,
      capturedAt: 100,
    })
    insertCache(db, { gameId: 2, timeline: matchV5, raw: rawTimeline(2) })

    runV32(db)

    expect(db.prepare(`
      SELECT source, mapper_version AS mapperVersion
      FROM match_timeline_sources ORDER BY source
    `).all()).toEqual([
      { source: "league_client", mapperVersion: TIMELINE_STORAGE_V32_MAPPER },
      { source: "match_v5", mapperVersion: TIMELINE_STORAGE_V32_MAPPER },
    ])
    expect(db.prepare(`
      SELECT source, data_json AS dataJson FROM selected_match_timelines
      WHERE game_id = 2 AND puuid = ?
    `).get(PUUID)).toEqual({ source: "match_v5", dataJson: canonicalJson(matchV5) })
    const metadata = timelineSourceMetadata(lcuCurrent)
    expect(db.prepare(`
      SELECT event_categories_json AS eventCategoriesJson,
             evidence_counts_json AS evidenceCountsJson
      FROM match_timeline_sources
      WHERE game_id = 2 AND puuid = ? AND source = 'league_client'
    `).get(PUUID)).toEqual({
      eventCategoriesJson: metadata.eventCategoriesJson,
      evidenceCountsJson: metadata.evidenceCountsJson,
    })
  })

  it.each([
    ["pending", null],
    ["loading", null],
    ["unavailable", "timeline incomplete"],
    ["error", "client offline"],
  ] as const)("preserves cache status %s when no ready source exists", (status, error) => {
    const db = databaseAtV31([3])
    insertCache(db, {
      gameId: 3,
      status,
      error: error ?? undefined,
      raw: status === "unavailable" ? rawTimeline(3) : undefined,
    })

    runV32(db)

    expect(db.prepare(`
      SELECT status, last_error AS error FROM match_timeline_sources
      WHERE game_id = 3 AND puuid = ? AND source = 'league_client'
    `).get(PUUID)).toEqual({ status, error })
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM selected_match_timelines
      WHERE game_id = 3 AND puuid = ?
    `).get(PUUID)).toEqual({ count: 0 })
  })

  it("aborts atomically when a ready source hash is corrupt", () => {
    const db = databaseAtV31([4])
    const timeline = compactTimeline(4)
    insertLegacySource(db, {
      gameId: 4,
      source: "league_client",
      mapperVersion: TIMELINE_STORAGE_V32_MAPPER,
      timeline,
      corruptHash: true,
    })
    insertCache(db, { gameId: 4, timeline, raw: rawTimeline(4) })

    expect(() => runV32(db)).toThrow("timeline_v32_source_hash_or_canonical_mismatch")
    expect(db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table'
        AND name = 'match_timeline_cache'
    `).get()).toBeDefined()
    expect(db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table'
        AND name = 'match_timeline_sources_v32'
    `).get()).toBeUndefined()
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM match_source_payloads
      WHERE owner_puuid = ? AND source = 'league_client' AND kind = 'timeline'
    `).get(PUUID)).toEqual({ count: 0 })
  })

  it("aborts rather than dropping a stale ready cache without retained raw evidence", () => {
    const db = databaseAtV31([5])
    insertCache(db, {
      gameId: 5,
      mapperVersion: TIMELINE_STORAGE_V32_MAPPER - 1,
      timeline: compactTimeline(5),
    })

    expect(() => runV32(db)).toThrow("timeline_v32_stale_cache_without_raw_payload")
    expect(db.prepare(`
      SELECT status FROM match_timeline_cache WHERE game_id = 5 AND puuid = ?
    `).get(PUUID)).toEqual({ status: "ready" })
  })

  it("prunes stale compact generations after preserving their raw remap evidence", () => {
    const db = databaseAtV31([6])
    insertLegacySource(db, {
      gameId: 6,
      source: "league_client",
      mapperVersion: TIMELINE_STORAGE_V32_MAPPER - 3,
      timeline: compactTimeline(60),
    })
    insertCache(db, {
      gameId: 6,
      mapperVersion: TIMELINE_STORAGE_V32_MAPPER - 3,
      timeline: compactTimeline(60),
      raw: rawTimeline(60),
    })

    runV32(db)

    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM match_timeline_sources
      WHERE game_id = 6 AND puuid = ?
    `).get(PUUID)).toEqual({ count: 0 })
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM match_source_payloads
      WHERE owner_puuid = ? AND game_id = 6 AND kind = 'timeline'
    `).get(PUUID)).toEqual({ count: 1 })
  })
})
