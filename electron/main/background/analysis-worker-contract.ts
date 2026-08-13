import type {
  SkillReport,
} from "../matches/skill-report.js"
import type {
  PerformanceProfile,
} from "../matches/performance-profile.js"
import type { SkillReportDatabaseInput } from "./skill-report-database.js"
import type { PerformanceProfileDatabaseInput } from "./performance-profile-database.js"
import type {
  PerformanceReferenceRebuildProgress,
  PerformanceReferenceRebuildResult,
  PerformanceReferenceStatus,
  VerifiedGradeBackup,
} from "../matches/match-grading-service.js"

export interface GradeRebuildWorkerInput {
  databasePath: string
  backup: VerifiedGradeBackup
}

export interface MatchSummaryExportWorkerInput {
  databasePath: string
  puuid: string
  filePath: string
}

export interface MatchSummaryExportWorkerResult {
  exported: number
  filePath: string
  digest: string
}

export type AnalysisWorkerTask =
  | { task: "ping" }
  | { task: "skill-report-database"; input: SkillReportDatabaseInput & { databasePath: string } }
  | { task: "performance-profile-database"; input: PerformanceProfileDatabaseInput & { databasePath: string } }
  | { task: "grade-rebuild"; input: GradeRebuildWorkerInput }
  | { task: "grade-ensure-frozen"; input: GradeRebuildWorkerInput }
  | { task: "match-summary-export"; input: MatchSummaryExportWorkerInput }

export type AnalysisWorkerRequest = AnalysisWorkerTask & { id: number }

export type AnalysisWorkerSuccess =
  | { id: number; ok: true; task: "ping"; result: "pong" }
  | { id: number; ok: true; task: "skill-report-database"; result: SkillReport }
  | { id: number; ok: true; task: "performance-profile-database"; result: PerformanceProfile | undefined }
  | { id: number; ok: true; task: "grade-rebuild"; result: PerformanceReferenceRebuildResult }
  | { id: number; ok: true; task: "grade-ensure-frozen"; result: PerformanceReferenceRebuildResult | PerformanceReferenceStatus }
  | { id: number; ok: true; task: "match-summary-export"; result: MatchSummaryExportWorkerResult }

export interface AnalysisWorkerProgress {
  id: number
  task: "grade-rebuild" | "grade-ensure-frozen"
  progress: PerformanceReferenceRebuildProgress
}

export interface AnalysisWorkerFailure {
  id: number
  ok: false
  error: {
    message: string
    stack?: string
  }
}

export type AnalysisWorkerResponse =
  | AnalysisWorkerSuccess
  | AnalysisWorkerFailure
  | AnalysisWorkerProgress
