import { describe, expect, it } from "vitest"
import {
  buildPatternReviewGroups,
  defaultPatternReviewFilter,
  isClearPattern,
  isReviewablePattern,
  patternReviewCounts,
  type PatternReviewSourceGroup,
} from "../src/helpers/pattern-review"
import type { InsightFinding } from "../src/types/stats"

function finding(overrides: Partial<InsightFinding> = {}): InsightFinding {
  return {
    key: "after-loss",
    title: "After loss",
    summary: "Games after a loss were usually lower scoring.",
    evidenceLevel: "comparative",
    confidence: "medium",
    games: 12,
    eligibleGames: 40,
    effect: -4,
    unit: "grade",
    interval: { low: -7, high: -1, level: 0.95 },
    scope: "12 games after a loss vs 28 other games",
    ...overrides,
  }
}

function group(key: string, findings: InsightFinding[]): PatternReviewSourceGroup {
  return { key, title: key, method: `${key} method`, findings }
}

describe("pattern review queue", () => {
  it("separates clear patterns from results that still need evidence", () => {
    const clear = finding()
    const crossesZero = finding({ key: "unclear", interval: { low: -2, high: 5, level: 0.95 } })
    const noInterval = finding({ key: "thin", games: 4, interval: undefined })

    expect(isClearPattern(clear)).toBe(true)
    expect(isClearPattern(crossesZero)).toBe(false)
    expect(isClearPattern(noInterval)).toBe(false)
    expect(patternReviewCounts([group("conditions", [clear, crossesZero, noInterval])])).toEqual({
      standouts: 1,
      learning: 2,
      total: 3,
    })
  })

  it("keeps meaningful thin samples but drops empty and internal trend-window rows", () => {
    expect(isReviewablePattern(finding({ interval: undefined, games: 3 }))).toBe(true)
    expect(isReviewablePattern(finding({
      key: "item:1001",
      interval: undefined,
      games: 0,
      eligibleGames: 0,
      values: { recordedItemGames: 11 },
    }))).toBe(true)
    expect(isReviewablePattern(finding({ interval: undefined, games: 0 }))).toBe(false)
    expect(isReviewablePattern(finding({ key: "window:0" }))).toBe(false)
  })

  it("ranks within a category by confidence and comparison sample, never raw mixed-unit effect", () => {
    const highConfidence = finding({ key: "high", effect: 1, confidence: "high", games: 12 })
    const hugeLowConfidence = finding({ key: "huge", effect: 90, confidence: "low", games: 100 })
    const mediumSmall = finding({ key: "medium-small", confidence: "medium", games: 8 })
    const mediumLarge = finding({ key: "medium-large", confidence: "medium", games: 16 })

    const rows = buildPatternReviewGroups([
      group("conditions", [hugeLowConfidence, mediumSmall, highConfidence, mediumLarge]),
    ], "standouts")[0].items

    expect(rows.map((row) => row.finding.key)).toEqual([
      "high",
      "medium-large",
      "medium-small",
      "huge",
    ])
  })

  it("uses question-oriented category labels and falls back to learning when nothing stands out", () => {
    const unclear = finding({ interval: { low: -1, high: 1, level: 0.95 } })
    const groups = [group("bestGamePattern", [unclear])]

    expect(buildPatternReviewGroups(groups, "learning")[0].label)
      .toBe("What your highest-scoring games looked like")
    expect(defaultPatternReviewFilter(groups)).toBe("learning")
    expect(defaultPatternReviewFilter([group("conditions", [finding()])])).toBe("standouts")
  })
})
