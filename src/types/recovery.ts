export type DatabaseFailureReason =
  | "newer_schema"
  | "corrupt"
  | "migration_failed"
  | "permission_or_lock"
  | "disk_or_io_error"
  | "unknown"

export type StartupState =
  | { kind: "ready" }
  | {
      kind: "recovery_required"
      reason: DatabaseFailureReason
      message: string
      databasePath: string
      supportedSchemaVersion: number
    }
  | {
      kind: "restoring"
      message: string
      databasePath: string
      supportedSchemaVersion: number
    }

export type RecoveryBackupStatus =
  | "restorable"
  | "newer_schema"
  | "corrupt"
  | "missing"

export interface RecoveryBackupSummary {
  id: string
  fileName: string
  createdAt: number
  sizeBytes: number
  managed: boolean
  schemaVersion?: number
  matchCount?: number
  status: RecoveryBackupStatus
  detail?: string
}

export interface BackupCleanupItem {
  id: string
  fileName: string
  sizeBytes: number
  reason: "automatic_budget" | "stale_temporary" | "orphan_sidecar" |
    "orphan_manifest" | "old_recovery_original"
}

export interface BackupCleanupPreview {
  items: BackupCleanupItem[]
  reclaimableBytes: number
}
