import { describe, expect, it, vi } from "vitest"
import { createSingleFlightRefresh } from "../electron/main/full-refresh.js"

describe("createSingleFlightRefresh", () => {
  it("shares one in-flight refresh and starts again after it settles", async () => {
    let resolveFirst!: (value: { inserted: number }) => void
    const run = vi
      .fn<() => Promise<{ inserted: number }>>()
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveFirst = resolve }),
      )
      .mockResolvedValueOnce({ inserted: 2 })
    const refresh = createSingleFlightRefresh(run)

    const first = refresh()
    const second = refresh()
    expect(second).toBe(first)
    expect(run).toHaveBeenCalledTimes(1)

    resolveFirst({ inserted: 1 })
    await expect(first).resolves.toEqual({ inserted: 1 })
    await expect(refresh()).resolves.toEqual({ inserted: 2 })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it("clears the in-flight request after a failure", async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("client unavailable"))
      .mockResolvedValueOnce("recovered")
    const refresh = createSingleFlightRefresh(run)

    await expect(refresh()).rejects.toThrow("client unavailable")
    await expect(refresh()).resolves.toBe("recovered")
    expect(run).toHaveBeenCalledTimes(2)
  })
})
