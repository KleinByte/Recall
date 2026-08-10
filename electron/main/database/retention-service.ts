export const BACKUP_RELEASE_SEQUENCE = 1
export const MINIMUM_AUTOMATIC_BACKUP_BUDGET = 512 * 1024 * 1024

export type ManagedBackupReason =
  | "daily" | "manual" | "pre-update" | "pre-migration"
  | "pre-repair" | "pre-restore" | "pre-clear" | "pre-cleanup"

export type BackupProtectionLegacy =
  | { kind: "none" }
  | { kind: "through_release"; throughReleaseSequence: number }
  | { kind: "until_user_deletes" }

export interface ManagedBackupManifestLegacy {
  format: "recall-managed-backup"
  manifestVersion: 2
  fileName: string
  createdAt: number
  reason: ManagedBackupReason
  protection: BackupProtectionLegacy
  appVersion: string
  releaseSequence: number
  sha256: string
  schemaVersion: number
  sizeBytes: number
  matchCount: number
  integrity: "ok"
}

export interface RetentionCandidate extends Omit<Partial<ManagedBackupManifestLegacy>,
  "reason" | "integrity" | "manifestVersion" | "fileName" | "createdAt" | "sizeBytes"> {
  fileName: string
  createdAt: number
  reason: ManagedBackupReason | "legacy_unclassified"
  sizeBytes: number
  integrity: "ok" | "failed" | "unknown"
  manifestVersion?: number
}

export interface BackupRetentionProposal {
  mode: "report_only"
  budgetBytes: number
  protectedBytes: number
  excessProtectedBytes: number
  unfilledDailySlots: number
  unfilledMonthlySlots: number
  keep: Array<{ fileName: string; reason: string }>
  delete: Array<{ fileName: string; reason: "automatic_budget"; sizeBytes: number }>
  reclaimableBytes: number
}

export function protectionForReason(
  reason: ManagedBackupReason,
  releaseSequence = BACKUP_RELEASE_SEQUENCE,
): BackupProtectionLegacy {
  if (reason === "manual" || reason === "pre-clear") return { kind: "until_user_deletes" }
  if (reason === "daily") return { kind: "none" }
  return { kind: "through_release", throughReleaseSequence: releaseSequence + 1 }
}

export function isProtectionActive(
  protection: BackupProtectionLegacy,
  releaseSequence = BACKUP_RELEASE_SEQUENCE,
): boolean {
  return protection.kind === "until_user_deletes" ||
    (protection.kind === "through_release" && releaseSequence <= protection.throughReleaseSequence)
}

const utcDay = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10)
const utcMonth = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 7)

export function proposeBackupRetention(
  input: readonly RetentionCandidate[],
  currentDatabaseBytes: number,
  releaseSequence = BACKUP_RELEASE_SEQUENCE,
): BackupRetentionProposal {
  const budgetBytes = Math.max(MINIMUM_AUTOMATIC_BACKUP_BUDGET, 8 * currentDatabaseBytes)
  const ordered = [...input].sort((left, right) => right.createdAt - left.createdAt ||
    left.fileName.localeCompare(right.fileName))
  const verifiedAutomatic = ordered.filter((candidate) =>
    candidate.integrity === "ok" && candidate.reason !== "manual" &&
    candidate.reason !== "pre-clear" && candidate.reason !== "legacy_unclassified")
  const newestAutomatic = verifiedAutomatic[0]?.fileName
  const keep = new Map<string, string>()
  for (const candidate of ordered) {
    if (candidate.reason === "legacy_unclassified") keep.set(candidate.fileName, "legacy_unclassified")
    else if (candidate.integrity !== "ok") keep.set(candidate.fileName, "unverified_or_corrupt")
    else if (candidate.reason === "manual" || candidate.reason === "pre-clear") {
      keep.set(candidate.fileName, "user_protected")
    } else if (candidate.fileName === newestAutomatic) keep.set(candidate.fileName, "newest_healthy")
    else if (candidate.protection && isProtectionActive(candidate.protection, releaseSequence)) {
      keep.set(candidate.fileName, "manifest_protection")
    }
  }
  const protectedBytes = ordered.filter((entry) => keep.has(entry.fileName) &&
    entry.reason !== "manual" && entry.reason !== "pre-clear" && entry.reason !== "legacy_unclassified")
    .reduce((sum, entry) => sum + entry.sizeBytes, 0)
  const dailyAnchors: RetentionCandidate[] = []
  const days = new Set<string>()
  for (const candidate of verifiedAutomatic) {
    const day = utcDay(candidate.createdAt)
    if (days.has(day) || days.size >= 7) continue
    days.add(day)
    dailyAnchors.push(candidate)
  }
  const monthlyAnchors: RetentionCandidate[] = []
  const months = new Set<string>()
  for (const candidate of verifiedAutomatic) {
    const month = utcMonth(candidate.createdAt)
    if (months.has(month) || months.size >= 3) continue
    months.add(month)
    monthlyAnchors.push(candidate)
  }
  let keptAutomaticBytes = protectedBytes
  for (const [reason, anchors] of [["daily_anchor", dailyAnchors], ["monthly_anchor", monthlyAnchors]] as const) {
    for (const candidate of anchors) {
      if (keep.has(candidate.fileName)) continue
      if (keptAutomaticBytes + candidate.sizeBytes <= budgetBytes) {
        keep.set(candidate.fileName, reason)
        keptAutomaticBytes += candidate.sizeBytes
      }
    }
  }
  const deletions = verifiedAutomatic
    .filter((candidate) => !keep.has(candidate.fileName))
    .sort((left, right) => left.createdAt - right.createdAt || left.fileName.localeCompare(right.fileName))
    .map((candidate) => ({ fileName: candidate.fileName,
      reason: "automatic_budget" as const, sizeBytes: candidate.sizeBytes }))
  return {
    mode: "report_only",
    budgetBytes,
    protectedBytes,
    excessProtectedBytes: Math.max(0, protectedBytes - budgetBytes),
    unfilledDailySlots: Math.max(0, 7 - days.size),
    unfilledMonthlySlots: Math.max(0, 3 - months.size),
    keep: ordered.filter((entry) => keep.has(entry.fileName))
      .map((entry) => ({ fileName: entry.fileName, reason: keep.get(entry.fileName)! })),
    delete: deletions,
    reclaimableBytes: deletions.reduce((sum, entry) => sum + entry.sizeBytes, 0),
  }
}
