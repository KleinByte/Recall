import type { Database } from "better-sqlite3"
import { TIMELINE_MAPPER_VERSION, type CompactTimeline } from "../riot/timeline-mapper.js"

export interface TimelineSourceCandidate {
  source: "league_client" | "match_v5" | "live_capture"
  mapperVersion: number
  status: "ready" | "partial" | "unavailable"
  dataJson?: string | null
  capturedAt: number
}

const AUTHORITY: Record<TimelineSourceCandidate["source"], number> = {
  league_client: 0,
  match_v5: 1,
  live_capture: 2,
}

export function selectTimelineSource(
  candidates: readonly TimelineSourceCandidate[],
  mapperVersion = TIMELINE_MAPPER_VERSION,
): TimelineSourceCandidate | undefined {
  return candidates.filter((candidate) => candidate.mapperVersion === mapperVersion &&
    candidate.status === "ready" && candidate.dataJson)
    .sort((left, right) => AUTHORITY[left.source] - AUTHORITY[right.source] ||
      right.capturedAt - left.capturedAt)[0]
}

export function refreshTimelineCompatibilityCache(
  db: Database,
  gameId: number,
  puuid: string,
  now = Date.now(),
): "refreshed" | "preserved_no_current_source" {
  const candidates = db.prepare(`
    SELECT source, mapper_version AS mapperVersion, status,
           data_json AS dataJson, captured_at AS capturedAt
    FROM match_timeline_sources WHERE game_id = ? AND puuid = ?
  `).all(gameId, puuid) as TimelineSourceCandidate[]
  const selected = selectTimelineSource(candidates)
  if (!selected?.dataJson) return "preserved_no_current_source"
  const parsed = JSON.parse(selected.dataJson) as CompactTimeline
  db.prepare(`
    INSERT INTO match_timeline_cache
      (game_id, puuid, status, mapper_version, fetched_at, data_json, updated_at)
    VALUES (?, ?, 'ready', ?, ?, ?, ?)
    ON CONFLICT(game_id, puuid) DO UPDATE SET
      status = 'ready', mapper_version = excluded.mapper_version,
      fetched_at = excluded.fetched_at, last_error = NULL,
      data_json = excluded.data_json, updated_at = excluded.updated_at
  `).run(gameId, puuid, TIMELINE_MAPPER_VERSION, selected.capturedAt,
    JSON.stringify(parsed), now)
  return "refreshed"
}
