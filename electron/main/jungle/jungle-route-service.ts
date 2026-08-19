import type { CampClearEvent, CampKey } from "../../../src/shared/minimap/contracts.js"

export interface JungleRouteSummary {
  routeKey: string
  campKeys: CampKey[]
  splits: Array<{
    campKey: CampKey
    completedAtMs: number
    intervalFromPreviousMs?: number
    confidence: number
  }>
  fullClearCompletedAtMs?: number
  sourceQuality: "high" | "mixed" | "estimated"
}

export class JungleRouteService {
  summarize(events: CampClearEvent[]): JungleRouteSummary | undefined {
    const local = events
      .filter((event) => event.attribution === "local")
      .sort((left, right) => left.clearedAtMs - right.clearedAtMs)
    if (local.length === 0) return undefined
    const campKeys = local.map((event) => event.campKey)
    const splits = local.map((event, index) => ({
      campKey: event.campKey,
      completedAtMs: event.clearedAtMs,
      ...(index > 0
        ? { intervalFromPreviousMs: event.clearedAtMs - local[index - 1].clearedAtMs }
        : {}),
      confidence: event.attributionConfidence * event.sourceConfidence,
    }))
    const high = local.filter((event) =>
      event.attributionConfidence >= 0.8 && event.sourceConfidence >= 0.8).length
    return {
      routeKey: campKeys.join(">"),
      campKeys,
      splits,
      fullClearCompletedAtMs: local.length >= 6 ? local[5].clearedAtMs : undefined,
      sourceQuality: high === local.length
        ? "high"
        : high >= Math.ceil(local.length / 2)
          ? "mixed"
          : "estimated",
    }
  }
}
