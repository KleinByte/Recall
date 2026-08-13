import { describe, expect, it, vi } from "vitest"
import { runStableAnalysis } from "../electron/main/background/stable-analysis.js"

describe("runStableAnalysis", () => {
  it("returns the first result from a stable source generation", async () => {
    const task = vi.fn(async () => 42)
    await expect(runStableAnalysis({
      expectedIdentity: "owner",
      currentIdentity: () => "owner",
      currentRevision: () => 1,
      task,
    })).resolves.toBe(42)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it("retries once when a stats update lands during analysis", async () => {
    let revision = 1
    const task = vi.fn(async () => {
      if (revision === 1) revision = 2
      return revision
    })
    await expect(runStableAnalysis({
      expectedIdentity: "owner",
      currentIdentity: () => "owner",
      currentRevision: () => revision,
      task,
    })).resolves.toBe(2)
    expect(task).toHaveBeenCalledTimes(2)
  })

  it("rejects results belonging to an account that changed mid-task", async () => {
    let identity = "owner"
    await expect(runStableAnalysis({
      expectedIdentity: identity,
      currentIdentity: () => identity,
      currentRevision: () => 1,
      task: async () => {
        identity = "other"
        return 42
      },
    })).rejects.toThrow("active_account_changed")
  })
})

