import type { InsightFinding } from "../types/stats"

export type PatternReviewFilter = "standouts" | "learning" | "all"
export type PatternReviewStatus = "standout" | "learning"

export interface PatternReviewSourceGroup {
  key: string
  title: string
  method: string
  findings: InsightFinding[]
}

export interface PatternReviewItem {
  id: string
  groupKey: string
  groupLabel: string
  method: string
  finding: InsightFinding
  status: PatternReviewStatus
  sourceOrder: number
  findingOrder: number
}

export interface PatternReviewGroup {
  key: string
  label: string
  method: string
  items: PatternReviewItem[]
}

const GROUP_LABELS: Record<string, string> = {
  bestGamePattern: "What your highest-scoring games looked like",
  conditions: "When and how you played",
  duration: "Match length",
  trends: "Recent form",
  champions: "Champions",
  items: "Final builds",
}

const CONFIDENCE_RANK: Record<InsightFinding["confidence"], number> = {
  insufficient: 0,
  low: 1,
  medium: 2,
  high: 3,
}

export function hasUsableInterval(finding: InsightFinding): boolean {
  return Boolean(
    finding.interval &&
    Number.isFinite(finding.interval.low) &&
    Number.isFinite(finding.interval.high),
  )
}

export function isClearPattern(finding: InsightFinding): boolean {
  return Boolean(
    hasUsableInterval(finding) &&
    (finding.interval!.low > 0 || finding.interval!.high < 0),
  )
}

export function isReviewablePattern(finding: InsightFinding): boolean {
  if (!Number.isFinite(finding.effect) || finding.key.startsWith("window:")) return false
  if (hasUsableInterval(finding)) return true
  if (finding.games > 0) return true
  return Number(finding.values?.recordedItemGames ?? 0) > 0
}

function effectiveComparisonSample(finding: InsightFinding): number {
  const comparisonGames = Math.max(0, finding.eligibleGames - finding.games)
  return comparisonGames ? Math.min(finding.games, comparisonGames) : finding.games
}

function compareItems(left: PatternReviewItem, right: PatternReviewItem): number {
  const confidenceDifference =
    CONFIDENCE_RANK[right.finding.confidence] - CONFIDENCE_RANK[left.finding.confidence]
  if (confidenceDifference) return confidenceDifference

  const sampleDifference =
    effectiveComparisonSample(right.finding) - effectiveComparisonSample(left.finding)
  if (sampleDifference) return sampleDifference

  if (left.sourceOrder !== right.sourceOrder) return left.sourceOrder - right.sourceOrder
  return left.findingOrder - right.findingOrder
}

export function buildPatternReviewGroups(
  sourceGroups: PatternReviewSourceGroup[],
  filter: PatternReviewFilter,
): PatternReviewGroup[] {
  return sourceGroups.flatMap((group, sourceOrder) => {
    const items = group.findings
      .map((finding, findingOrder): PatternReviewItem => ({
        id: `${group.key}:${finding.key}:${findingOrder}`,
        groupKey: group.key,
        groupLabel: GROUP_LABELS[group.key] ?? group.title,
        method: group.method,
        finding,
        status: isClearPattern(finding) ? "standout" : "learning",
        sourceOrder,
        findingOrder,
      }))
      .filter((item) => isReviewablePattern(item.finding))
      .filter((item) => filter === "all" || item.status === (
        filter === "standouts" ? "standout" : "learning"
      ))
      .sort(compareItems)

    return items.length ? [{
      key: group.key,
      label: GROUP_LABELS[group.key] ?? group.title,
      method: group.method,
      items,
    }] : []
  })
}

export function patternReviewCounts(sourceGroups: PatternReviewSourceGroup[]) {
  let standouts = 0
  let learning = 0
  for (const group of sourceGroups) {
    for (const finding of group.findings) {
      if (!isReviewablePattern(finding)) continue
      if (isClearPattern(finding)) standouts += 1
      else learning += 1
    }
  }
  return { standouts, learning, total: standouts + learning }
}

export function defaultPatternReviewFilter(
  sourceGroups: PatternReviewSourceGroup[],
): PatternReviewFilter {
  return patternReviewCounts(sourceGroups).standouts ? "standouts" : "learning"
}
