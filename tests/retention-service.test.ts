import { describe, expect, it } from "vitest"
import { protectionForReason, proposeBackupRetention } from "../electron/main/database/retention-service.js"

describe("backup retention v2", () => {
  it("pins reason protection and remains report-only", () => {
    expect(protectionForReason("manual")).toEqual({ kind: "until_user_deletes" })
    expect(protectionForReason("daily")).toEqual({ kind: "none" })
    expect(protectionForReason("pre-repair", 4)).toEqual({
      kind: "through_release", throughReleaseSequence: 5,
    })
    const rows = Array.from({ length: 10 }, (_, index) => ({
      fileName: `${index}.db`, createdAt: index * 86_400_000, reason: "daily" as const,
      sizeBytes: 100 * 1024 * 1024, integrity: "ok" as const,
      manifestVersion: 2, protection: { kind: "none" as const },
    }))
    const proposal = proposeBackupRetention(rows, 1)
    expect(proposal.mode).toBe("report_only")
    expect(proposal.delete.length).toBeGreaterThan(0)
    expect(proposal.reclaimableBytes).toBeGreaterThan(0)
  })

  it("never proposes a legacy, corrupt, manual, or newest healthy artifact", () => {
    const proposal = proposeBackupRetention([
      { fileName: "new.db", createdAt: 4, reason: "daily", sizeBytes: 600_000_000, integrity: "ok",
        protection: { kind: "none" } },
      { fileName: "manual.db", createdAt: 3, reason: "manual", sizeBytes: 1, integrity: "ok" },
      { fileName: "legacy.db", createdAt: 2, reason: "legacy_unclassified", sizeBytes: 1, integrity: "unknown" },
      { fileName: "bad.db", createdAt: 1, reason: "daily", sizeBytes: 1, integrity: "failed" },
    ], 1)
    expect(proposal.delete).toEqual([])
    expect(proposal.keep.map((entry) => entry.fileName).sort()).toEqual([
      "bad.db", "legacy.db", "manual.db", "new.db",
    ])
  })

  it("expires transient release protection after fourteen days", () => {
    const day = 24 * 60 * 60 * 1_000
    const now = 40 * day
    const proposal = proposeBackupRetention([
      { fileName: "new.db", createdAt: now, reason: "daily", sizeBytes: 600_000_000,
        integrity: "ok", protection: { kind: "none" } },
      { fileName: "old-update.db", createdAt: now - 20 * day, reason: "pre-update",
        sizeBytes: 600_000_000, integrity: "ok",
        protection: { kind: "through_release", throughReleaseSequence: 999 } },
    ], 1, 1, now)

    expect(proposal.delete.map((entry) => entry.fileName)).toEqual(["old-update.db"])
  })
})
