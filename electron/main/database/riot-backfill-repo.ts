import type { Database } from "better-sqlite3"

export type RiotBackfillStatus =
  | "idle"
  | "running"
  | "complete"
  | "error"
  | "paused"

export interface RiotBackfillState {
  puuid: string
  regionalRoute: string
  endTimeSeconds: number
  nextOffset: number
  idsScanned: number
  matchesDownloaded: number
  matchesImported: number
  matchesSkipped: number
  status: RiotBackfillStatus
  lastError?: string
  startedAt?: number
  updatedAt: number
  completedAt?: number
}

interface ProgressDelta {
  idsScanned: number
  matchesDownloaded: number
  matchesImported: number
  matchesSkipped: number
}

const SELECT = `
  SELECT
    puuid,
    regional_route AS regionalRoute,
    end_time_seconds AS endTimeSeconds,
    next_offset AS nextOffset,
    ids_scanned AS idsScanned,
    matches_downloaded AS matchesDownloaded,
    matches_imported AS matchesImported,
    matches_skipped AS matchesSkipped,
    status,
    last_error AS lastError,
    started_at AS startedAt,
    updated_at AS updatedAt,
    completed_at AS completedAt
  FROM riot_history_backfill
`

export class RiotBackfillRepository {
  constructor(private readonly db: Database) {}

  get(puuid: string, regionalRoute: string): RiotBackfillState | undefined {
    return this.db
      .prepare(`${SELECT} WHERE puuid = ? AND regional_route = ?`)
      .get(puuid, regionalRoute) as RiotBackfillState | undefined
  }

  getLatest(puuid: string): RiotBackfillState | undefined {
    return this.db
      .prepare(`${SELECT} WHERE puuid = ? ORDER BY updated_at DESC LIMIT 1`)
      .get(puuid) as RiotBackfillState | undefined
  }

  /**
   * Explicitly saving a key starts a fresh ID scan. Existing match rows make
   * that cheap, while interrupted automatic resumes keep their exact cursor.
   */
  start(
    puuid: string,
    regionalRoute: string,
    restart: boolean,
    now = Date.now(),
  ): RiotBackfillState {
    const existing = this.get(puuid, regionalRoute)

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO riot_history_backfill
             (puuid, regional_route, end_time_seconds, status, started_at, updated_at)
           VALUES (?, ?, ?, 'running', ?, ?)`,
        )
        .run(puuid, regionalRoute, Math.floor(now / 1_000), now, now)
    } else if (restart) {
      this.db
        .prepare(
          `UPDATE riot_history_backfill
           SET next_offset = 0,
               end_time_seconds = ?,
               ids_scanned = 0,
               matches_downloaded = 0,
               matches_imported = 0,
               matches_skipped = 0,
               status = 'running',
               last_error = NULL,
               started_at = ?,
               updated_at = ?,
               completed_at = NULL
           WHERE puuid = ? AND regional_route = ?`,
        )
        .run(
          Math.floor(now / 1_000),
          now,
          now,
          puuid,
          regionalRoute,
        )
    } else {
      this.db
        .prepare(
          `UPDATE riot_history_backfill
           SET status = 'running', last_error = NULL, updated_at = ?
           WHERE puuid = ? AND regional_route = ?`,
        )
        .run(now, puuid, regionalRoute)
    }

    return this.get(puuid, regionalRoute)!
  }

  advance(
    puuid: string,
    regionalRoute: string,
    nextOffset: number,
    delta: ProgressDelta,
    now = Date.now(),
  ): RiotBackfillState {
    this.db
      .prepare(
        `UPDATE riot_history_backfill
         SET next_offset = ?,
             ids_scanned = ids_scanned + ?,
             matches_downloaded = matches_downloaded + ?,
             matches_imported = matches_imported + ?,
             matches_skipped = matches_skipped + ?,
             status = 'running',
             last_error = NULL,
             updated_at = ?
         WHERE puuid = ? AND regional_route = ?`,
      )
      .run(
        nextOffset,
        delta.idsScanned,
        delta.matchesDownloaded,
        delta.matchesImported,
        delta.matchesSkipped,
        now,
        puuid,
        regionalRoute,
      )

    return this.get(puuid, regionalRoute)!
  }

  complete(
    puuid: string,
    regionalRoute: string,
    now = Date.now(),
  ): RiotBackfillState {
    this.db
      .prepare(
        `UPDATE riot_history_backfill
         SET status = 'complete',
             last_error = NULL,
             updated_at = ?,
             completed_at = ?
         WHERE puuid = ? AND regional_route = ?`,
      )
      .run(now, now, puuid, regionalRoute)
    return this.get(puuid, regionalRoute)!
  }

  stop(
    puuid: string,
    regionalRoute: string,
    status: "error" | "paused",
    message?: string,
    now = Date.now(),
  ): RiotBackfillState {
    this.db
      .prepare(
        `UPDATE riot_history_backfill
         SET status = ?, last_error = ?, updated_at = ?
         WHERE puuid = ? AND regional_route = ?`,
      )
      .run(status, message ?? null, now, puuid, regionalRoute)
    return this.get(puuid, regionalRoute)!
  }

  deleteAll(puuid: string): number {
    return this.db
      .prepare("DELETE FROM riot_history_backfill WHERE puuid = ?")
      .run(puuid).changes
  }
}
