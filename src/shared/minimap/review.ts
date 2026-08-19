import type { CampClearEvent, PathSegment } from "./contracts.js"

export interface MinimapPathingAnalysisSummary {
  analysisId: string
  gameId: number
  puuid: string
  inputHash: string
  graphVersion: number
  modelVersion: number
  status: "running" | "complete" | "failed"
  coverage: Record<string, unknown>
  createdAt: number
  completedAt?: number
  errorCode?: string
}

export interface MinimapPathingReview {
  analysis?: MinimapPathingAnalysisSummary
  segments: PathSegment[]
  campClears: CampClearEvent[]
}
