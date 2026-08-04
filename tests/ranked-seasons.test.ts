import { describe, expect, it } from "vitest"
import {
  currentRankedSeason,
  pointsForSeason,
  seasonsWithRankedHistory,
} from "../src/helpers/ranked-seasons.js"
import type { RankedPoint } from "../src/types/stats.js"

const point = (recordedAt: number): RankedPoint => ({
  recordedAt,
  points: 1_000,
  label: "Gold IV",
  leaguePoints: 0,
  wins: 0,
  losses: 0,
})

describe("ranked season boundaries", () => {
  it("recognizes the current 2026 ranked season from Riot's published transition", () => {
    expect(currentRankedSeason(new Date(2026, 6, 31).getTime())).toMatchObject({
      id: "2026-s3",
      label: "2026 Season 3",
    })
  })

  it("never includes an earlier season in a season-scoped line", () => {
    const season = currentRankedSeason(new Date(2026, 6, 31).getTime())
    const points = [
      point(new Date(2026, 6, 28, 23).getTime()),
      point(new Date(2026, 6, 29, 12).getTime()),
      point(new Date(2026, 6, 31).getTime()),
    ]

    expect(pointsForSeason(points, season).map((entry) => entry.recordedAt)).toEqual([
      points[1].recordedAt,
      points[2].recordedAt,
    ])
  })

  it("lists only seasons represented by recorded ranked readings", () => {
    const seasons = seasonsWithRankedHistory([{
      queue: "RANKED_SOLO_5x5",
      points: [
        point(new Date(2025, 4, 1).getTime()),
        point(new Date(2026, 6, 31).getTime()),
      ],
    }])

    expect(seasons.map((season) => season.id)).toEqual(["2026-s3", "2025-s2"])
  })
})
