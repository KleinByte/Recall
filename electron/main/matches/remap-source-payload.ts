import type { Database } from "better-sqlite3"
import {
  MatchSourceRepository,
  type RawPayloadIdentity,
} from "../database/match-source-repo.js"

export interface SourceRemapper<T> {
  mapperVersion: number
  map(raw: unknown): T
  persist(db: Database, mapped: T, raw: RawPayloadIdentity): void
}

/** Purely local, restart-safe remapping of one durable raw checksum. */
export function remapSourcePayload<T>(
  db: Database,
  identity: RawPayloadIdentity,
  remapper: SourceRemapper<T>,
  now = Date.now(),
): "mapped" | "already_mapped" {
  const row = db.prepare(`
    SELECT mapping_status AS status, mapper_version AS mapperVersion, game_id AS gameId
    FROM match_source_payloads
    WHERE owner_puuid = ? AND source = ? AND source_match_id = ? AND kind = ? AND sha256 = ?
  `).get(identity.ownerPuuid, identity.source, identity.sourceMatchId,
    identity.kind, identity.sha256) as { status: string; mapperVersion: number; gameId?: number } | undefined
  if (!row) throw new Error("source_payload_not_found")
  if (row.status === "mapped" && row.mapperVersion === remapper.mapperVersion) {
    return "already_mapped"
  }
  const repository = new MatchSourceRepository(db)
  try {
    const mapped = remapper.map(repository.read(identity))
    db.transaction(() => remapper.persist(db, mapped, identity))()
    repository.setMappingResult(identity, "mapped", now, { gameId: row.gameId })
    return "mapped"
  } catch (error) {
    repository.setMappingResult(identity, "unmappable", now, {
      error: error instanceof Error ? error.message.slice(0, 500) : "unmappable_source_payload",
    })
    throw error
  }
}
