import { describe, expect, it, vi } from "vitest"
import { buildMatchRow } from "./fixtures/matches.js"
import { RiotApiError } from "../electron/main/riot/api-client.js"
import { RecentMatchEnricher } from "../electron/main/riot/recent-match-enricher.js"
import type { RiotMatchDto } from "../electron/main/riot/match-mapper.js"

const OWNER = "local-owner"
const MATCH_PUUID = "riot-puuid"

function repositories() {
  const matches = {
    needsLabelEvaluation: vi.fn(() => true),
    markLabelsUnavailable: vi.fn(),
    setRiotMatchId: vi.fn(),
    setGrade: vi.fn(),
    replacePerformanceLabels: vi.fn(),
  }
  const participants = {
    insertMany: vi.fn(),
    insertTeams: vi.fn(),
    recordCapture: vi.fn(),
    setGrades: vi.fn(),
  }
  return { matches, participants }
}

function dto(): RiotMatchDto {
  return {
    metadata: { matchId: "NA1_7" },
    info: {
      gameId: 7,
      gameStartTimestamp: 1_700_000_000_000,
      gameDuration: 1_800,
      gameMode: "CLASSIC",
      gameType: "MATCHED_GAME",
      gameVersion: "16.1",
      queueId: 420,
      mapId: 11,
      participants: Array.from({ length: 10 }, (_, index) => ({
        participantId: index + 1,
        puuid: index === 0 ? MATCH_PUUID : `other-${index}`,
        championId: index + 1,
        teamId: index < 5 ? 100 : 200,
        win: index < 5,
        kills: index === 0 ? 12 : 3,
        deaths: index === 0 ? 1 : 5,
        assists: index === 0 ? 14 : 4,
        goldEarned: index === 0 ? 14_000 : 10_000,
        totalDamageDealtToChampions: index === 0 ? 38_000 : 12_000,
        totalDamageTaken: 15_000,
        totalMinionsKilled: index === 0 ? 250 : 130,
        neutralMinionsKilled: 0,
        visionScore: 20,
        teamPosition: index === 0 ? "MIDDLE" : "TOP",
        pentaKills: index === 0 ? 1 : 0,
      })),
      teams: [
        { teamId: 100, win: true, objectives: {} },
        { teamId: 200, win: false, objectives: {} },
      ],
    },
  }
}

function row() {
  return buildMatchRow({
    gameId: 7,
    puuid: OWNER,
    queueId: 420,
    gameMode: "CLASSIC",
    mode: "sr_ranked_solo",
    modeFamily: "sr",
  })
}

describe("RecentMatchEnricher", () => {
  it("makes no Riot request when no key is configured", async () => {
    const repos = repositories()
    const apiFactory = vi.fn()
    const enricher = new RecentMatchEnricher(
      () => undefined, "americas", "NA1", OWNER,
      { gameName: "Recall", tagLine: "NA1" },
      repos.matches as never, repos.participants as never, { apiFactory },
    )

    await expect(enricher.enrich([row()], new Map())).resolves.toBe(0)
    expect(apiFactory).not.toHaveBeenCalled()
  })

  it("quarantines a rejected key instead of retrying every sync", async () => {
    const repos = repositories()
    const get = vi.fn().mockRejectedValue(new RiotApiError("rejected", 403))
    const apiFactory = vi.fn(() => ({ get }))
    const enricher = new RecentMatchEnricher(
      () => "RGAPI-rejected", "americas", "NA1", OWNER,
      { gameName: "Recall", tagLine: "NA1" },
      repos.matches as never, repos.participants as never, { apiFactory },
    )

    await enricher.enrich([row()], new Map())
    await enricher.enrich([row()], new Map())

    expect(apiFactory).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledTimes(1)
    expect(repos.matches.replacePerformanceLabels).not.toHaveBeenCalled()
  })

  it("stores the Match-V5 lobby and evidence-backed labels", async () => {
    const repos = repositories()
    const get = vi.fn(async (path: string) =>
      path.includes("/accounts/by-riot-id/") ? { puuid: MATCH_PUUID } : dto(),
    )
    const enricher = new RecentMatchEnricher(
      () => "RGAPI-valid", "americas", "NA1", OWNER,
      { gameName: "Recall", tagLine: "NA1" },
      repos.matches as never,
      repos.participants as never,
      { apiFactory: () => ({ get }) },
    )

    await expect(enricher.enrich([row()], new Map())).resolves.toBe(1)
    expect(get).toHaveBeenCalledTimes(2)
    expect(repos.matches.setRiotMatchId).toHaveBeenCalledWith(7, OWNER, "NA1_7")
    expect(repos.participants.recordCapture).toHaveBeenCalled()
    const labels = repos.matches.replacePerformanceLabels.mock.calls[0][2]
    expect(labels.map((label: { id: string }) => label.id)).toContain("pentakill")
    expect(labels.every((label: { evidence: object }) => Object.keys(label.evidence).length > 0)).toBe(true)
  })
})
