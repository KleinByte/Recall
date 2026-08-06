import type { Database } from "better-sqlite3"
import type { RawPayloadIdentity } from "./match-source-repo.js"

export interface MappedMatchBundleWrite {
  rawPayload: RawPayloadIdentity
  gameId: number
  mappedAt: number
  /** Writes match, roster, teams, capture, evidence, and derived pairs using this DB. */
  writeNormalized(db: Database): void
}

/**
 * Transaction B of source ingestion. Raw bytes must already have committed in
 * Transaction A; this method never inserts, replaces, or rewrites them.
 */
export class MatchBundleWriter {
  constructor(private readonly db: Database) {}

  writeMappedMatchBundle(bundle: MappedMatchBundleWrite): void {
    const mark = (status: "mapped" | "error", error?: string) => this.db.prepare(`
      UPDATE match_source_payloads
      SET game_id = ?, mapping_status = ?, mapping_error = ?, mapped_at = ?
      WHERE owner_puuid = ? AND source = ? AND source_match_id = ? AND kind = ? AND sha256 = ?
    `).run(
      bundle.gameId, status, error ?? null, bundle.mappedAt,
      bundle.rawPayload.ownerPuuid, bundle.rawPayload.source,
      bundle.rawPayload.sourceMatchId, bundle.rawPayload.kind, bundle.rawPayload.sha256,
    )

    try {
      this.db.transaction(() => {
        bundle.writeNormalized(this.db)
        const result = mark("mapped")
        if (result.changes !== 1) throw new Error("raw_payload_identity_not_found")
      })()
    } catch (error) {
      // Normalized work rolled back. Only the durable raw mapping ledger is
      // updated in this separate follow-up transaction.
      const message = error instanceof Error ? error.message : String(error)
      this.db.transaction(() => mark("error", message.slice(0, 2_000)))()
      throw error
    }
  }
}
