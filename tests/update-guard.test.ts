import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  markUpdateInProgress,
  updateStartupState,
  UPDATE_MARKER_MAX_AGE_MS,
} from "../electron/main/update-guard.js"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "recall-update-guard-test-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("cross-version update guard", () => {
  it("blocks an older executable while the target version is installing", () => {
    markUpdateInProgress(dir, "3.3.0", () => 1_000)

    expect(updateStartupState(dir, "3.2.2", () => 2_000)).toEqual({
      kind: "updating",
      targetVersion: "3.3.0",
      startedAt: 1_000,
    })
  })

  it("lets the installed target or a newer build clear the handoff", () => {
    markUpdateInProgress(dir, "3.3.0", () => 1_000)
    expect(updateStartupState(dir, "3.4.0", () => 2_000)).toEqual({
      kind: "normal",
    })
    expect(existsSync(path.join(dir, "update-in-progress.json"))).toBe(false)
  })

  it("expires a stale or malformed handoff instead of locking Recall forever", () => {
    markUpdateInProgress(dir, "3.3.0", () => 1_000)
    expect(updateStartupState(
      dir,
      "3.2.2",
      () => 1_000 + UPDATE_MARKER_MAX_AGE_MS + 1,
    )).toEqual({ kind: "normal" })

    writeFileSync(path.join(dir, "update-in-progress.json"), "not json")
    expect(updateStartupState(dir, "3.2.2", () => 2_000)).toEqual({
      kind: "normal",
    })
  })
})
