import type {
  PerformanceConfidence,
  PerformanceScopeSummary,
} from "../types/stats"

const POSITION_LABELS = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MIDDLE: "Mid",
  BOTTOM: "Bot",
  UTILITY: "Support",
} as const

const CONFIDENCE_RANK: Record<PerformanceConfidence, number> = {
  learning: 0,
  provisional: 1,
  established: 2,
}

const titleCase = (value: string) => value
  .split("_")
  .map((part) => part[0]?.toUpperCase() + part.slice(1))
  .join(" ")

export function performanceScopeLabel(scope: PerformanceScopeSummary): string {
  if (scope.kind === "overall") return "All matches"
  if (scope.kind === "position" && scope.position) return POSITION_LABELS[scope.position]
  if (scope.kind === "primary_archetype" && scope.primaryArchetype) {
    return titleCase(scope.primaryArchetype)
  }
  return scope.key
}

export function rankPerformanceScopes(
  scopes: readonly PerformanceScopeSummary[],
): PerformanceScopeSummary[] {
  return scopes
    .filter((scope) => Number.isFinite(scope.score))
    .slice()
    .sort((left, right) =>
      right.score - left.score ||
      CONFIDENCE_RANK[right.confidence] - CONFIDENCE_RANK[left.confidence] ||
      right.measuredGames - left.measuredGames ||
      right.games - left.games ||
      performanceScopeLabel(left).localeCompare(performanceScopeLabel(right)))
}

export function performanceConfidenceLabel(confidence: PerformanceConfidence): string {
  return ({
    learning: "Learning",
    provisional: "Provisional",
    established: "Established",
  })[confidence]
}

export function performanceScoreLabel(score: number): string {
  if (score >= 65) return "Leading"
  if (score >= 55) return "Positive"
  if (score >= 45) return "Even"
  return "Developing"
}

export function performanceScopeEvidenceLabel(scope: PerformanceScopeSummary): string {
  const arms = scope.headline.source === "career_arm_mean"
    ? `${scope.headline.availableArms} of ${scope.headline.totalArms} arms`
    : `${scope.measuredGames} graded`
  return `${performanceConfidenceLabel(scope.confidence)} · ${arms} · ${scope.games} ${scope.games === 1 ? "game" : "games"}`
}

export function performanceScopeAriaLabel(scope: PerformanceScopeSummary): string {
  const context = scope.kind === "position" ? "position" : "primary archetype"
  return `${performanceScopeLabel(scope)} ${context} RVI, ${scope.score} out of 100`
}
