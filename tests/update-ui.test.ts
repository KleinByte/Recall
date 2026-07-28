import { afterEach, describe, expect, it, vi } from "vitest"
import { api } from "../src/helpers/api.js"
import { updatePresentation } from "../src/helpers/update.js"

afterEach(() => vi.unstubAllGlobals())

describe("updatePresentation", () => {
  it("renders every update state with only valid actions", () => {
    expect(updatePresentation({ kind: "checking" })).toEqual({
      message: "Checking for updates…",
      action: null,
    })
    expect(
      updatePresentation({ kind: "downloading", version: "1.2.0", percent: 42 }),
    ).toEqual({
      message: "Downloading Recall 1.2.0: 42%",
      action: null,
    })
    expect(updatePresentation({ kind: "downloaded", version: "1.2.0" })).toEqual({
      message: "Recall 1.2.0 is ready.",
      action: { label: "Restart to update", command: "install" },
    })
    expect(
      updatePresentation({
        kind: "error",
        message: "Could not check for updates. Recall is still ready to use.",
      }),
    ).toEqual({
      message: "Could not check for updates. Recall is still ready to use.",
      action: { label: "Try again", command: "retry" },
    })
  })
})

describe("update API", () => {
  it("uses only the dedicated update IPC channels", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    const on = vi.fn()
    vi.stubGlobal("window", { ipcRenderer: { invoke, on } })

    await api.getUpdateStatus()
    await api.retryUpdate()
    await api.installUpdate()
    api.onUpdateStatus(vi.fn())

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      "app:update-status",
      "app:update-retry",
      "app:update-install",
    ])
    expect(on).toHaveBeenCalledWith("app:update-status", expect.any(Function))
  })
})
