import { describe, expect, it } from "vitest"
import {
  currentAppVersion,
  hasUnseenPatchNotes,
  patchNotes,
  patchNotesForVersion,
} from "../src/data/patch-notes.js"

describe("patch notes", () => {
  it("includes useful notes for the running application version", () => {
    const current = patchNotesForVersion(currentAppVersion)

    expect(current).toBeDefined()
    expect(current?.title.trim()).not.toBe("")
    expect(current?.summary.trim()).not.toBe("")
    expect(current?.sections.length).toBeGreaterThan(0)
    expect(current?.sections.every((section) => section.items.length > 0)).toBe(
      true,
    )
  })

  it("keeps releases newest first with unique versions", () => {
    expect(new Set(patchNotes.map((release) => release.version)).size).toBe(
      patchNotes.length,
    )

    const dates = patchNotes.map((release) => release.releasedAt)
    expect(dates).toEqual([...dates].sort().reverse())
  })

  it("shows notes once for a version and ignores releases without notes", () => {
    expect(hasUnseenPatchNotes(undefined, currentAppVersion)).toBe(true)
    expect(hasUnseenPatchNotes("1.1.2", currentAppVersion)).toBe(true)
    expect(hasUnseenPatchNotes(currentAppVersion, currentAppVersion)).toBe(false)
    expect(hasUnseenPatchNotes("1.1.3", "9.9.9")).toBe(false)
  })
})
