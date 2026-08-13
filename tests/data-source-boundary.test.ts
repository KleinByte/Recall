import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { assertAllowedMatchV5Path } from "../electron/main/riot/api-client.js"

const read = (path: string) => readFileSync(path, "utf8")

describe("League data-source boundary", () => {
  it("uses the local client for recent timelines", () => {
    const service = read("electron/main/lcu-timeline-service.ts")

    expect(service).toContain("/lol-match-history/v1/game-timelines/")
    expect(service).toContain('from "./lcu-client.js"')
    expect(service).not.toContain("RiotApiClient")
    expect(service).not.toContain("/lol/match/v5/")
  })

  it("does not attach a developer-api enricher to normal match sync", () => {
    const main = read("electron/main/index.ts")
    const sync = read("electron/main/match-sync.ts")

    expect(main).not.toContain("RecentMatchEnricher")
    expect(sync).not.toContain("MatchEnricher")
    expect(sync).toContain("evaluateMatchLabels")
  })

  it("keeps developer-api requests inside the explicit history importer", () => {
    const history = read("electron/main/riot/history-backfill.ts")
    const main = read("electron/main/index.ts")

    expect(history).toContain("new RiotApiClient")
    expect(main).toContain("startRiotHistoryBackfill")
    expect(main.match(/startRiotHistoryBackfill\(win/g)).toHaveLength(3)
    expect(main).toContain('ipcMain.handle("riot-api-key:save"')
    expect(main).toContain('ipcMain.handle("riot-history:retry"')
    expect(main).toContain('ipcMain.handle("riot-history:reimport-details"')
    expect(main).not.toContain("/lol/match/v5/")
    expect(history).toContain("/riot/account/v1/accounts/by-riot-id/")
  })

  it("allows only account resolution and the three Match-V5 history shapes", () => {
    expect(() => assertAllowedMatchV5Path(
      "/riot/account/v1/accounts/by-riot-id/Recall%20Player/NA1",
    )).not.toThrow()
    expect(() => assertAllowedMatchV5Path(
      "/lol/match/v5/matches/by-puuid/synthetic_owner/ids?start=0&count=100",
    )).not.toThrow()
    expect(() => assertAllowedMatchV5Path(
      "/lol/match/v5/matches/NA1_123",
    )).not.toThrow()
    expect(() => assertAllowedMatchV5Path(
      "/lol/match/v5/matches/NA1_123/timeline",
    )).not.toThrow()
    for (const path of [
      "/riot/account/v1/accounts/by-puuid/a",
      "/lol/league/v4/entries/by-summoner/a",
      "/lol/champion-mastery/v4/champion-masteries/by-puuid/a",
      "/lol/challenges/v1/player-data/a",
      "/lol/spectator/v5/active-games/by-summoner/a",
    ]) expect(() => assertAllowedMatchV5Path(path)).toThrow("riot_web_api_path_not_allowed")
  })

  it("explains the boundary in Settings and Review", () => {
    const settings = read("src/pages/SettingsPage.vue")
    const review = read("src/pages/ReviewPage.vue")

    expect(settings).toContain("Used only to resolve the signed-in Riot ID")
    expect(review).toContain("Recent timelines come directly from the connected League client")
    expect(review).not.toContain("Add a Riot API key in Settings if needed")
  })
})
