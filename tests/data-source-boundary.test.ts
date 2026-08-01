import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

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
    expect(main).not.toContain("/lol/match/v5/")
  })

  it("explains the boundary in Settings and Review", () => {
    const settings = read("src/pages/SettingsPage.vue")
    const review = read("src/pages/ReviewPage.vue")

    expect(settings).toContain("Used only for the full Match-V5 history import")
    expect(review).toContain("Recent timelines come directly from the connected League client")
    expect(review).not.toContain("Add a Riot API key in Settings if needed")
  })
})
