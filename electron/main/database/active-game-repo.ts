import type { GameLifecycleSnapshot } from "../game-lifecycle-coordinator.js"
import type { LiveSession } from "../live-session.js"

interface StatementLike {
  run(...parameters: unknown[]): { changes?: number }
  get(...parameters: unknown[]): unknown
}

export interface ActiveGameDatabase {
  prepare(sql: string): StatementLike
}

interface ActiveGameRow {
  ownerPuuid: string
  gameId: number | null
  lifecycleState: GameLifecycleSnapshot["stage"]
  sessionJson: string
  lifecycleJson: string
  startedAt: number
  updatedAt: number
  lastLcuSeenAt: number | null
  lastPortSeenAt: number | null
}

export interface ActiveGameRecord {
  ownerPuuid: string
  session: LiveSession
  lifecycle: GameLifecycleSnapshot
}

function durableSession(session: LiveSession): LiveSession {
  const { game: _game, ...metadata } = session
  return metadata
}

function parseSession(value: string): LiveSession | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<LiveSession>
    if (parsed.phase !== "ChampSelect" && parsed.phase !== "InProgress") return undefined
    return {
      ...parsed,
      phase: parsed.phase,
      benchChampionIds: Array.isArray(parsed.benchChampionIds)
        ? parsed.benchChampionIds
        : [],
      allies: Array.isArray(parsed.allies) ? parsed.allies : [],
      enemies: Array.isArray(parsed.enemies) ? parsed.enemies : [],
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    }
  } catch {
    return undefined
  }
}

function parseLifecycle(
  value: string,
  row: ActiveGameRow,
  session: LiveSession,
): GameLifecycleSnapshot {
  let parsed: Partial<GameLifecycleSnapshot> = {}
  try {
    parsed = JSON.parse(value) as Partial<GameLifecycleSnapshot>
  } catch {
    // The indexed columns below are enough for conservative recovery.
  }
  return {
    ...parsed,
    stage: row.lifecycleState,
    gameId: row.gameId ?? session.gameId ?? parsed.gameId,
    lcuConnected: false,
    portAvailable: false,
    startedAt: row.startedAt,
    lastLcuSeenAt: row.lastLcuSeenAt ?? parsed.lastLcuSeenAt,
    lastPortSeenAt: row.lastPortSeenAt ?? parsed.lastPortSeenAt,
    suspendedAt: parsed.suspendedAt ?? row.updatedAt,
  }
}

/** A single small restart journal; frame and live-snapshot payloads stay elsewhere. */
export class ActiveGameRepository {
  constructor(private readonly db: ActiveGameDatabase) {}

  save(ownerPuuid: string, session: LiveSession, lifecycle: GameLifecycleSnapshot) {
    if (session.phase === "Idle") {
      this.clear(ownerPuuid)
      return
    }
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO active_game_sessions
        (owner_puuid, game_id, lifecycle_state, session_json, lifecycle_json,
         started_at, updated_at, last_lcu_seen_at, last_port_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_puuid) DO UPDATE SET
        game_id = excluded.game_id,
        lifecycle_state = excluded.lifecycle_state,
        session_json = excluded.session_json,
        lifecycle_json = excluded.lifecycle_json,
        updated_at = excluded.updated_at,
        last_lcu_seen_at = excluded.last_lcu_seen_at,
        last_port_seen_at = excluded.last_port_seen_at
    `).run(
      ownerPuuid,
      session.gameId ?? lifecycle.gameId ?? null,
      lifecycle.stage,
      JSON.stringify(durableSession(session)),
      JSON.stringify(lifecycle),
      lifecycle.startedAt ?? now,
      now,
      lifecycle.lastLcuSeenAt ?? null,
      lifecycle.lastPortSeenAt ?? null,
    )
  }

  get(ownerPuuid: string): ActiveGameRecord | undefined {
    return this.fromRow(this.db.prepare(`
      SELECT owner_puuid AS ownerPuuid, game_id AS gameId,
             lifecycle_state AS lifecycleState, session_json AS sessionJson,
             lifecycle_json AS lifecycleJson,
             started_at AS startedAt, updated_at AS updatedAt,
             last_lcu_seen_at AS lastLcuSeenAt,
             last_port_seen_at AS lastPortSeenAt
      FROM active_game_sessions
      WHERE owner_puuid = ?
    `).get(ownerPuuid) as ActiveGameRow | undefined)
  }

  getLatest(): ActiveGameRecord | undefined {
    return this.fromRow(this.db.prepare(`
      SELECT owner_puuid AS ownerPuuid, game_id AS gameId,
             lifecycle_state AS lifecycleState, session_json AS sessionJson,
             lifecycle_json AS lifecycleJson,
             started_at AS startedAt, updated_at AS updatedAt,
             last_lcu_seen_at AS lastLcuSeenAt,
             last_port_seen_at AS lastPortSeenAt
      FROM active_game_sessions
      ORDER BY updated_at DESC
      LIMIT 1
    `).get() as ActiveGameRow | undefined)
  }

  clear(ownerPuuid: string) {
    this.db.prepare("DELETE FROM active_game_sessions WHERE owner_puuid = ?")
      .run(ownerPuuid)
  }

  private fromRow(row?: ActiveGameRow): ActiveGameRecord | undefined {
    if (!row) return undefined
    const session = parseSession(row.sessionJson)
    if (!session) return undefined
    return {
      ownerPuuid: row.ownerPuuid,
      session: {
        ...session,
        gameId: session.gameId ?? row.gameId ?? undefined,
      },
      lifecycle: parseLifecycle(row.lifecycleJson, row, session),
    }
  }
}
