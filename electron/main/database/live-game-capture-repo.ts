import type { Database } from "better-sqlite3"
import type {
  LiveGameEvent,
  LiveGamePlayer,
  LiveGameSnapshot,
} from "../game-client.js"
import type {
  CompactTimeline,
  CompactTimelineEvent,
} from "../riot/timeline-mapper.js"
import type { ParticipantRow } from "../matches/types.js"
import { resolvePosition } from "../matches/position.js"

const PERIODIC_SNAPSHOT_MS = 15_000

export interface LiveCaptureParticipant {
  participantId: number
  teamId: number
  isPlayer: number
  summonerName?: string
}

export interface StoredLiveGameSnapshot extends Omit<LiveGameSnapshot, "events"> {
  reason: "first" | "periodic" | "state_change"
}

interface CaptureState {
  gameTimeMs: number
  stateFingerprint: string
}

function identity(value?: string) {
  return value?.trim().toLocaleLowerCase()
}

function playerIdentity(player: LiveGamePlayer) {
  return identity(player.riotId) ??
    `${player.team}:${player.championName.toLocaleLowerCase()}:${player.isLocal ? "local" : "remote"}`
}

function itemCounts(player: LiveGamePlayer) {
  const counts = new Map<number, number>()
  for (const item of player.items) {
    counts.set(item.itemId, (counts.get(item.itemId) ?? 0) + item.count)
  }
  return counts
}

/** Only changes that need sub-15-second timing force an immediate snapshot. */
function stateFingerprint(snapshot: Omit<LiveGameSnapshot, "events">) {
  return JSON.stringify(
    [...snapshot.allies, ...snapshot.enemies]
      .map((player) => ({
        id: playerIdentity(player),
        position: player.position,
        level: player.level,
        items: [...itemCounts(player)].sort((left, right) => left[0] - right[0]),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  )
}

function withoutEvents(snapshot: LiveGameSnapshot): Omit<LiveGameSnapshot, "events"> {
  const { events: _events, ...stored } = snapshot
  return stored
}

function parseSnapshot(value: string): Omit<LiveGameSnapshot, "events"> {
  return JSON.parse(value) as Omit<LiveGameSnapshot, "events">
}

function eventId(prefix: string, values: Array<string | number>) {
  return `${prefix}:${values.join(":")}`
}

export class LiveGameCaptureRepository {
  private readonly state = new Map<string, CaptureState>()
  private readonly seenEventIds = new Map<string, Set<number>>()

  constructor(private readonly db: Database) {}

  record(gameId: number, puuid: string, snapshot: LiveGameSnapshot) {
    if (!snapshot.available || !Number.isFinite(snapshot.gameTime)) {
      return { snapshotWritten: false, eventsWritten: 0 }
    }

    const key = `${gameId}:${puuid}`
    const gameTimeMs = Math.max(0, Math.round(snapshot.gameTime * 1_000))
    const stored = withoutEvents(snapshot)
    const fingerprint = stateFingerprint(stored)
    const previous = this.state.get(key) ?? this.readLatestState(gameId, puuid)
    const stateChanged = previous?.stateFingerprint !== fingerprint
    const periodic = previous === undefined ||
      gameTimeMs - previous.gameTimeMs >= PERIODIC_SNAPSHOT_MS
    const reason = previous === undefined
      ? "first"
      : stateChanged
        ? "state_change"
        : "periodic"
    let snapshotWritten = false

    if (stateChanged || periodic) {
      snapshotWritten = this.db.prepare(
        `INSERT OR IGNORE INTO live_game_snapshots
         (game_id, puuid, game_time_ms, captured_at, reason, snapshot_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        gameId,
        puuid,
        gameTimeMs,
        snapshot.updatedAt,
        reason,
        JSON.stringify(stored),
      ).changes > 0
      this.state.set(key, { gameTimeMs, stateFingerprint: fingerprint })
    }

    const insertEvent = this.db.prepare(
      `INSERT OR IGNORE INTO live_game_events
       (game_id, puuid, event_id, event_time_ms, event_name, captured_at, event_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    let seen = this.seenEventIds.get(key)
    if (!seen) {
      seen = new Set((this.db.prepare(
        `SELECT event_id AS eventId FROM live_game_events
         WHERE game_id = ? AND puuid = ?`,
      ).all(gameId, puuid) as { eventId: number }[]).map((row) => row.eventId))
      this.seenEventIds.set(key, seen)
    }
    let eventsWritten = 0
    for (const event of snapshot.events) {
      if (seen.has(event.id)) continue
      eventsWritten += insertEvent.run(
        gameId,
        puuid,
        event.id,
        Math.max(0, Math.round(event.time * 1_000)),
        event.name,
        snapshot.updatedAt,
        JSON.stringify(event),
      ).changes
      seen.add(event.id)
    }

    return { snapshotWritten, eventsWritten }
  }

  listSnapshots(gameId: number, puuid: string): StoredLiveGameSnapshot[] {
    return (this.db.prepare(
      `SELECT reason, snapshot_json AS snapshotJson
       FROM live_game_snapshots
       WHERE game_id = ? AND puuid = ?
       ORDER BY game_time_ms`,
    ).all(gameId, puuid) as { reason: StoredLiveGameSnapshot["reason"]; snapshotJson: string }[])
      .map((row) => ({ ...parseSnapshot(row.snapshotJson), reason: row.reason }))
  }

  listEvents(gameId: number, puuid: string): LiveGameEvent[] {
    return (this.db.prepare(
      `SELECT event_json AS eventJson
       FROM live_game_events
       WHERE game_id = ? AND puuid = ?
       ORDER BY event_time_ms, event_id`,
    ).all(gameId, puuid) as { eventJson: string }[])
      .map((row) => JSON.parse(row.eventJson) as LiveGameEvent)
  }

  /**
   * Applies the documented in-game position to the post-game scoreboard.
   *
   * The LCU match-history payload can omit or misclassify the enemy team's
   * lane, while Live Client Data exposes a canonical position for every
   * player. Prefer the latest captured value and match remote players by Riot
   * ID; the local player has an explicit marker and does not depend on a name.
   */
  stampPositions(gameId: number | undefined, puuid: string, rows: ParticipantRow[]) {
    if (!gameId || rows.length === 0) return 0

    const snapshots = this.listSnapshots(gameId, puuid)
    const snapshot = [...snapshots].reverse().find((entry) =>
      [...entry.allies, ...entry.enemies].some((player) =>
        resolvePosition(undefined, player.position) !== undefined,
      ),
    )
    if (!snapshot) return 0

    const players = [...snapshot.allies, ...snapshot.enemies]
    const localPosition = players.find((player) => player.isLocal)?.position
    const positionsByName = new Map(
      players.flatMap((player) => {
        const name = identity(player.riotId)
        const position = resolvePosition(undefined, player.position)
        return name && position ? [[name, position] as const] : []
      }),
    )

    let stamped = 0
    for (const row of rows) {
      const position = row.isPlayer === 1
        ? resolvePosition(undefined, localPosition)
        : positionsByName.get(identity(row.summonerName) ?? "")
      if (!position) continue
      row.role = position
      stamped += 1
    }
    return stamped
  }

  /** Repairs lobbies captured before live positions were promoted post-game. */
  repairStoredPositions(puuid: string) {
    const games = this.db.prepare(
      `SELECT DISTINCT game_id AS gameId
       FROM live_game_snapshots
       WHERE puuid = ?`,
    ).all(puuid) as { gameId: number }[]
    const read = this.db.prepare(
      `SELECT participant_id AS participantId,
              is_player AS isPlayer,
              summoner_name AS summonerName,
              role
       FROM match_participants
       WHERE game_id = ? AND puuid = ?`,
    )
    const update = this.db.prepare(
      `UPDATE match_participants SET role = ?
       WHERE game_id = ? AND puuid = ? AND participant_id = ?`,
    )

    return this.db.transaction(() => {
      let repaired = 0
      for (const { gameId } of games) {
        const rows = read.all(gameId, puuid) as ParticipantRow[]
        if (rows.length === 0) continue
        const previous = new Map(rows.map((row) => [row.participantId, row.role]))
        this.stampPositions(gameId, puuid, rows)
        for (const row of rows) {
          if (!row.role || row.role === previous.get(row.participantId)) continue
          repaired += update.run(row.role, gameId, puuid, row.participantId).changes
        }
      }
      return repaired
    })()
  }

  deleteAll(puuid: string) {
    const deleted = this.db.transaction(() => {
      const events = this.db.prepare(
        "DELETE FROM live_game_events WHERE puuid = ?",
      ).run(puuid).changes
      const snapshots = this.db.prepare(
        "DELETE FROM live_game_snapshots WHERE puuid = ?",
      ).run(puuid).changes
      return { events, snapshots }
    })()
    for (const key of this.state.keys()) {
      if (key.endsWith(`:${puuid}`)) this.state.delete(key)
    }
    for (const key of this.seenEventIds.keys()) {
      if (key.endsWith(`:${puuid}`)) this.seenEventIds.delete(key)
    }
    return deleted
  }

  enrichTimeline(
    gameId: number,
    puuid: string,
    timeline: CompactTimeline,
    participants: LiveCaptureParticipant[],
  ): CompactTimeline {
    const derived = deriveLiveTimelineEvents(
      this.listSnapshots(gameId, puuid),
      participants,
      this.listEvents(gameId, puuid),
    )
    if (derived.length === 0) return timeline

    const enrichedDerived = derived.map((event) => {
      if (event.type !== "CHAMPION_KILL") return event
      const candidates = timeline.events.filter((candidate) =>
        candidate.type === "CHAMPION_KILL" &&
        Math.abs(candidate.timestamp - event.timestamp) <= 2_000,
      )
      const recorded = event.targetId
        ? candidates.find((candidate) => candidate.targetId === event.targetId)
        : candidates.length === 1 ? candidates[0] : undefined
      if (!recorded) return event

      // Live Client Data gives us reliable Riot IDs, while the post-game LCU
      // event contains the exact map coordinate and combat payload. Combining
      // them keeps the richer kill instead of silently dropping its position.
      return {
        ...recorded,
        participantId: event.participantId ?? recorded.participantId,
        assistingParticipantIds: event.assistingParticipantIds?.length
          ? event.assistingParticipantIds
          : recorded.assistingParticipantIds,
        teamId: event.teamId ?? recorded.teamId,
        targetId: event.targetId ?? recorded.targetId,
        actorName: event.actorName ?? recorded.actorName,
        targetName: event.targetName ?? recorded.targetName,
        position: event.position ?? recorded.position,
      }
    })
    const liveLevels = new Set(enrichedDerived.flatMap((event) =>
      event.type === "LEVEL_UP" && event.participantId && event.level
        ? [`${event.participantId}:${event.level}`]
        : [],
    ))
    const liveKills = enrichedDerived.filter((event) => event.type === "CHAMPION_KILL")
    const incompleteSupplementalKillEvents = liveKills.filter((event) =>
      event.eventId.startsWith("live-kill:")).length
    const retained = timeline.events.filter((event) =>
      !(event.type === "CHAMPION_KILL" && liveKills.some((live) =>
        live.targetId === event.targetId && Math.abs(live.timestamp - event.timestamp) <= 2_000,
      )) && !(
        event.approximate &&
        event.type === "LEVEL_UP" &&
        event.participantId &&
        event.level &&
        liveLevels.has(`${event.participantId}:${event.level}`)
      ),
    )
    const added = enrichedDerived.filter((event) => {
      if (event.category === "level") {
        return !retained.some((existing) =>
          existing.type === "LEVEL_UP" &&
          existing.participantId === event.participantId &&
          existing.level === event.level,
        )
      }
      if (event.category === "kill") {
        // Live Client kill rows do not carry map coordinates and can retain
        // unresolved names. They are useful only when they enrich a matching
        // post-game event above; an unmatched supplement must remain in the
        // raw live capture instead of masquerading as a complete timeline
        // kill and invalidating spatial fight evidence.
        if (event.eventId.startsWith("live-kill:")) return false
        return !retained.some((existing) => existing.type === "CHAMPION_KILL" &&
          existing.targetId === event.targetId && Math.abs(existing.timestamp - event.timestamp) <= 2_000)
      }
      return !retained.some((existing) =>
        existing.category === "item" &&
        existing.participantId === event.participantId &&
        existing.itemId === event.itemId &&
        Math.abs(existing.timestamp - event.timestamp) <= 5_000,
      )
    })

    return {
      ...timeline,
      events: [...retained, ...added].sort((left, right) =>
        left.timestamp - right.timestamp || left.eventId.localeCompare(right.eventId),
      ),
      evidenceCoverage: {
        ...timeline.evidenceCoverage,
        incompleteSupplementalKillEvents:
          (timeline.evidenceCoverage?.incompleteSupplementalKillEvents ?? 0) +
          incompleteSupplementalKillEvents,
      },
    }
  }

  private readLatestState(gameId: number, puuid: string): CaptureState | undefined {
    const row = this.db.prepare(
      `SELECT game_time_ms AS gameTimeMs, snapshot_json AS snapshotJson
       FROM live_game_snapshots
       WHERE game_id = ? AND puuid = ?
       ORDER BY game_time_ms DESC LIMIT 1`,
    ).get(gameId, puuid) as { gameTimeMs: number; snapshotJson: string } | undefined
    if (!row) return undefined
    return {
      gameTimeMs: row.gameTimeMs,
      stateFingerprint: stateFingerprint(parseSnapshot(row.snapshotJson)),
    }
  }
}

export function deriveLiveTimelineEvents(
  snapshots: StoredLiveGameSnapshot[],
  participants: LiveCaptureParticipant[],
  liveEvents: LiveGameEvent[] = [],
): CompactTimelineEvent[] {
  const owner = participants.find((participant) => participant.isPlayer === 1)
  const byName = new Map(participants.flatMap((participant) => {
    const name = identity(participant.summonerName)
    return name ? [name, name.split("#")[0]].map((alias) => [alias, participant] as const) : []
  }))
  const previous = new Map<number, LiveGamePlayer>()
  const events: CompactTimelineEvent[] = []

  for (const event of liveEvents) {
    if (event.name !== "ChampionKill" || !event.victimName) continue
    const killer = byName.get(identity(event.killerName) ?? "")
    const victim = byName.get(identity(event.victimName) ?? "")
    const assists = event.assisters.flatMap((name) => {
      const participant = byName.get(identity(name) ?? "")
      return participant ? [participant.participantId] : []
    })
    events.push({
      eventId: eventId("live-kill", [event.id, Math.round(event.time * 1_000)]),
      timestamp: Math.max(0, Math.round(event.time * 1_000)),
      type: "CHAMPION_KILL",
      category: "kill",
      participantId: killer?.participantId,
      assistingParticipantIds: assists,
      teamId: killer?.teamId,
      targetId: victim?.participantId,
      actorName: event.killerName,
      targetName: event.victimName,
    })
  }

  for (const snapshot of snapshots) {
    const timestamp = Math.max(0, Math.round(snapshot.gameTime * 1_000))
    for (const player of [...snapshot.allies, ...snapshot.enemies]) {
      const participant = player.isLocal
        ? owner
        : byName.get(identity(player.riotId) ?? "")
      if (!participant) continue
      const prior = previous.get(participant.participantId)
      const currentItems = itemCounts(player)
      const priorItems = prior ? itemCounts(prior) : new Map<number, number>()

      for (const [itemId, count] of currentItems) {
        const added = count - (priorItems.get(itemId) ?? 0)
        for (let index = 0; index < added; index += 1) {
          events.push({
            eventId: eventId(prior ? "live-item-acquired" : "live-item-observed", [
              timestamp,
              participant.participantId,
              itemId,
              index,
            ]),
            timestamp,
            type: prior ? "ITEM_ACQUIRED" : "ITEM_OBSERVED",
            category: "item",
            participantId: participant.participantId,
            teamId: participant.teamId,
            itemId,
            approximate: true,
          })
        }
      }

      if (prior && player.level > prior.level) {
        for (let level = prior.level + 1; level <= player.level; level += 1) {
          events.push({
            eventId: eventId("live-level", [timestamp, participant.participantId, level]),
            timestamp,
            type: "LEVEL_UP",
            category: "level",
            participantId: participant.participantId,
            teamId: participant.teamId,
            level,
            approximate: true,
          })
        }
      }
      previous.set(participant.participantId, player)
    }
  }

  return events
}
