import type { Database } from "better-sqlite3"

/**
 * A point-in-time view of the connected League account.
 *
 * LCU fields are nullable on purpose: an unavailable value is different from
 * an empty string or zero and should stay unknown in durable history.
 */
export interface AccountProfileSnapshotInput {
  puuid: string
  summonerId: number | null
  gameName: string | null
  tagLine: string | null
  profileIconId: number | null
  summonerLevel: number | null
  platformId: string | null
  regionalRoute: string | null
  observedAt: number
}

export type AccountProfileSnapshot = Readonly<AccountProfileSnapshotInput>

function normalizedSnapshot(
  input: AccountProfileSnapshotInput,
): AccountProfileSnapshot {
  return {
    puuid: input.puuid,
    summonerId: input.summonerId ?? null,
    gameName: input.gameName ?? null,
    tagLine: input.tagLine ?? null,
    profileIconId: input.profileIconId ?? null,
    summonerLevel: input.summonerLevel ?? null,
    platformId: input.platformId ?? null,
    regionalRoute: input.regionalRoute ?? null,
    observedAt: input.observedAt,
  }
}

function hasSameProfile(
  current: AccountProfileSnapshot,
  incoming: AccountProfileSnapshot,
): boolean {
  return current.summonerId === incoming.summonerId &&
    current.gameName === incoming.gameName &&
    current.tagLine === incoming.tagLine &&
    current.profileIconId === incoming.profileIconId &&
    current.summonerLevel === incoming.summonerLevel &&
    current.platformId === incoming.platformId &&
    current.regionalRoute === incoming.regionalRoute
}

const SELECT_SNAPSHOT = `
  SELECT puuid, summoner_id AS summonerId, game_name AS gameName,
         tag_line AS tagLine, profile_icon_id AS profileIconId,
         summoner_level AS summonerLevel, platform_id AS platformId,
         regional_route AS regionalRoute, observed_at AS observedAt
  FROM account_profile_snapshots
`

export class AccountProfileRepository {
  constructor(private readonly db: Database) {}

  /**
   * Records a new state only when it differs from the account's last state.
   * The transaction keeps the comparison and insert atomic for future callers
   * that may write through more than one asynchronous capture path.
   */
  recordSnapshot(input: AccountProfileSnapshotInput): boolean {
    const snapshot = normalizedSnapshot(input)
    return this.db.transaction(() => {
      const current = this.getLatest(snapshot.puuid)
      if (current && hasSameProfile(current, snapshot)) return false

      this.db.prepare(`
        INSERT INTO account_profile_snapshots
          (puuid, summoner_id, game_name, tag_line, profile_icon_id,
           summoner_level, platform_id, regional_route, observed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        snapshot.puuid,
        snapshot.summonerId,
        snapshot.gameName,
        snapshot.tagLine,
        snapshot.profileIconId,
        snapshot.summonerLevel,
        snapshot.platformId,
        snapshot.regionalRoute,
        snapshot.observedAt,
      )
      return true
    })()
  }

  getLatest(puuid: string): AccountProfileSnapshot | undefined {
    return this.db.prepare(`
      ${SELECT_SNAPSHOT}
      WHERE puuid = ?
      ORDER BY observed_at DESC, id DESC
      LIMIT 1
    `).get(puuid) as AccountProfileSnapshot | undefined
  }

  getHistory(puuid: string, sinceObservedAt = 0): AccountProfileSnapshot[] {
    return this.db.prepare(`
      ${SELECT_SNAPSHOT}
      WHERE puuid = ? AND observed_at >= ?
      ORDER BY observed_at ASC, id ASC
    `).all(puuid, sinceObservedAt) as AccountProfileSnapshot[]
  }
}
