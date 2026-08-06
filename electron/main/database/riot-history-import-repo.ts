import type { Database } from "better-sqlite3"

export interface RiotHistoryRunInput {
  puuid: string
  matchPuuid: string
  platformRoute: string
  regionalRoute: string
  startTimeSeconds?: number
  endTimeSeconds: number
  requestedTimeline: boolean
  identitySource: "cache" | "league_client"
  startedAt: number
}

export class RiotHistoryImportRepository {
  constructor(private readonly db: Database) {}

  createRun(input: RiotHistoryRunInput): number {
    const result = this.db.prepare(`
      INSERT INTO riot_history_runs
        (puuid, match_puuid, platform_route, regional_route,
         start_time_seconds, end_time_seconds, requested_detail, requested_timeline,
         identity_source, discovery_status, detail_status, timeline_status,
         started_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'pending', 'pending', ?, ?, ?)
    `).run(
      input.puuid, input.matchPuuid, input.platformRoute, input.regionalRoute,
      input.startTimeSeconds ?? null, input.endTimeSeconds,
      Number(input.requestedTimeline), input.identitySource,
      input.requestedTimeline ? "pending" : "not_requested",
      input.startedAt, input.startedAt,
    )
    return Number(result.lastInsertRowid)
  }

  recordDiscoveredMatch(input: {
    runId: number
    puuid: string
    regionalRoute: string
    riotMatchId: string
    listOffset: number
    discoveredAt: number
    timelineRequested: boolean
  }): void {
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO riot_match_ingestion
          (puuid, regional_route, riot_match_id, first_discovered_at,
           last_discovered_at, detail_status, timeline_status, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
        ON CONFLICT(puuid, riot_match_id) DO UPDATE SET
          last_discovered_at = MAX(last_discovered_at, excluded.last_discovered_at),
          updated_at = excluded.updated_at
      `).run(input.puuid, input.regionalRoute, input.riotMatchId,
        input.discoveredAt, input.discoveredAt,
        input.timelineRequested ? "pending" : "not_requested", input.discoveredAt)
      this.db.prepare(`
        INSERT INTO riot_history_run_matches
          (run_id, puuid, riot_match_id, list_offset, discovered_at,
           detail_disposition, timeline_disposition)
        VALUES (?, ?, ?, ?, ?, 'active', ?)
        ON CONFLICT(run_id, puuid, riot_match_id) DO NOTHING
      `).run(input.runId, input.puuid, input.riotMatchId, input.listOffset,
        input.discoveredAt, input.timelineRequested ? "active" : "not_requested")
    })()
  }
}
