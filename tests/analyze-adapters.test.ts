import { describe, expect, it } from "vitest"
import {
  armFormComparisons,
  championAnalysisPoints,
  gradeSessionPositionAnalysis,
  matchInspectorContext,
  rollingRecallScores,
} from "../src/helpers/analyze-adapters"
import type {
  SkillChampionPoint,
  SkillGradeComponentPoint,
  SkillHistoryPoint,
} from "../src/types/stats"

const DAY = 86_400_000

function componentRow(
  gameId: number,
  percentile: number,
  extra: Record<string, unknown> = {},
): SkillGradeComponentPoint {
  return {
    gameId,
    playedAt: gameId * DAY,
    compositePercentile: percentile,
    components: [{
      key: "combat",
      label: "Combat",
      percentile,
      weight: 1,
      contribution: percentile,
      scope: "role",
    }],
    ...extra,
  } as SkillGradeComponentPoint
}

function historyPoint(
  gameId: number,
  extra: Partial<SkillHistoryPoint> = {},
): SkillHistoryPoint {
  return {
    gameId,
    playedAt: gameId * 60 * 60_000,
    championId: 1,
    win: true,
    recallScore: 50,
    durationSecs: 1_800,
    ...extra,
  }
}

describe("Analyze adapters", () => {
  it("keeps a missing match result unavailable instead of calling it a loss", () => {
    expect(matchInspectorContext(componentRow(1, .5)).outcome).toBe("unavailable")
    expect(matchInspectorContext(componentRow(1, .5, { win: false })).outcome).toBe("loss")
    expect(matchInspectorContext(componentRow(1, .5), historyPoint(1, { win: true })).outcome)
      .toBe("win")
  })

  it("compares two non-overlapping measured windows and excludes career-only Range", () => {
    const rows = Array.from({ length: 20 }, (_, index) => {
      const row = componentRow(index + 1, index < 10 ? .2 : .8)
      row.components.push({
        key: "consistency_versatility" as never,
        label: "Range",
        percentile: 1,
        weight: 0,
        contribution: 0,
        scope: "role",
      })
      return row
    })

    expect(armFormComparisons(rows)).toEqual([expect.objectContaining({
      key: "combat",
      recentGames: 10,
      priorGames: 10,
      recentScore: 80,
      priorScore: 20,
      delta: 60,
    })])
  })

  it("withholds arm-form claims until both windows have at least three games", () => {
    expect(armFormComparisons(Array.from({ length: 5 }, (_, index) =>
      componentRow(index + 1, .5)))).toEqual([])
  })

  it("uses stable pre-filter session positions when enriched Grade rows provide them", () => {
    const rows = [
      componentRow(1, .7, { session: 12, sessionGame: 2, win: true, recallScore: 70 }),
      componentRow(2, .4, { session: 12, sessionGame: 4, win: false, recallScore: 40 }),
    ]
    const analysis = gradeSessionPositionAnalysis(rows, [])

    expect(analysis.usesStableOrdinal).toBe(true)
    expect(analysis.comparable).toBe(false)
    expect(analysis.sessions).toBe(1)
    expect(analysis.buckets.map((bucket) => bucket.label)).toEqual([
      "Session game 2",
      "Session game 4",
    ])
    expect(analysis.buckets[0]).toMatchObject({
      games: 1,
      outcomeGames: 1,
      wins: 1,
      gradedGames: 1,
      averageRecallScore: 70,
      medianRecallScore: null,
      scoreSampleSufficient: false,
    })
  })

  it("uses median and interquartile Recall Scores only after three games per session position", () => {
    const rows = [
      componentRow(1, .4, { session: 1, sessionGame: 1, recallScore: 40 }),
      componentRow(2, .3, { session: 1, sessionGame: 2, recallScore: 30 }),
      componentRow(3, .6, { session: 2, sessionGame: 1, recallScore: 60 }),
      componentRow(4, .5, { session: 2, sessionGame: 2, recallScore: 50 }),
      componentRow(5, .8, { session: 3, sessionGame: 1, recallScore: 80 }),
      componentRow(6, .9, { session: 3, sessionGame: 2, recallScore: 90 }),
    ]
    const analysis = gradeSessionPositionAnalysis(rows, [])

    expect(analysis.comparable).toBe(true)
    expect(analysis.buckets[0]).toMatchObject({
      medianRecallScore: 60,
      lowerQuartileRecallScore: 50,
      upperQuartileRecallScore: 70,
      scoreSampleSufficient: true,
    })
    expect(analysis.buckets[1]).toMatchObject({
      medianRecallScore: 50,
      lowerQuartileRecallScore: 40,
      upperQuartileRecallScore: 70,
      scoreSampleSufficient: true,
    })
  })

  it("labels the legacy fallback as selected-game order", () => {
    const history = [historyPoint(1), historyPoint(2)]
    const analysis = gradeSessionPositionAnalysis([
      componentRow(1, .5),
      componentRow(2, .5),
    ], history)

    expect(analysis.usesStableOrdinal).toBe(false)
    expect(analysis.comparable).toBe(false)
    expect(analysis.buckets.map((bucket) => bucket.label)).toEqual([
      "Selected game 1",
      "Selected game 2",
    ])
  })

  it("plots champion sample size from graded games and discloses coverage", () => {
    const champions: SkillChampionPoint[] = [{
      championId: 1,
      games: 10,
      wins: 5,
      winRate: .5,
      kda: 3,
      averageRecallScore: 60,
      gradedGames: 4,
    }, {
      championId: 2,
      games: 20,
      wins: 10,
      winRate: .5,
      kda: 3,
      averageRecallScore: 80,
      gradedGames: 2,
    }]

    expect(championAnalysisPoints(champions)).toEqual([expect.objectContaining({
      championId: 1,
      gradedGames: 4,
      coverage: .4,
      sampleLabel: "Early sample",
    })])
  })

  it("does not emit a five-game rolling score before the fifth game", () => {
    const games = Array.from({ length: 6 }, (_, index) =>
      historyPoint(index + 1, { recallScore: (index + 1) * 10 }))

    expect(rollingRecallScores(games)).toEqual([
      { gameId: 5, average: 30 },
      { gameId: 6, average: 40 },
    ])
  })
})
