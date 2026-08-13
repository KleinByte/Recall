import { AccountProfileRepository } from "./database/account-profile-repo.js"

export interface AccountProfileSummoner {
  puuid: string
  gameName: string
  tagLine: string
  summonerId: number
  profileIconId: number
  summonerLevel: number
}

export interface AccountProfileRoutes {
  platformId?: string
  regionalRoute?: string
}

export type AccountProfileRefreshResult =
  | { state: "changed"; summoner: AccountProfileSummoner }
  | { state: "unchanged"; summoner: AccountProfileSummoner }
  | { state: "stale" }
  | { state: "account_changed" }

/** Maps LCU identity/profile observations into their durable transition log. */
export class AccountProfileCapture {
  constructor(
    private readonly repository: AccountProfileRepository,
    private readonly now: () => number = Date.now,
  ) {}

  record(
    summoner: AccountProfileSummoner,
    routes: AccountProfileRoutes,
  ): boolean {
    return this.repository.recordSnapshot({
      puuid: summoner.puuid,
      summonerId: summoner.summonerId ?? null,
      gameName: summoner.gameName || null,
      tagLine: summoner.tagLine || null,
      profileIconId: summoner.profileIconId ?? null,
      summonerLevel: summoner.summonerLevel ?? null,
      platformId: routes.platformId ?? null,
      regionalRoute: routes.regionalRoute ?? null,
      observedAt: this.now(),
    })
  }

  async refresh(
    requestCurrentSummoner: () => Promise<AccountProfileSummoner>,
    expectedPuuid: string,
    routes: AccountProfileRoutes,
    isCurrent: () => boolean,
  ): Promise<AccountProfileRefreshResult> {
    const summoner = await requestCurrentSummoner()
    if (!isCurrent()) return { state: "stale" }
    if (summoner.puuid !== expectedPuuid) return { state: "account_changed" }
    return {
      state: this.record(summoner, routes) ? "changed" : "unchanged",
      summoner,
    }
  }
}
