import { describe, expect, it, vi } from "vitest"
import { retryDelays, syncUntilRecorded } from "../electron/main/post-game-sync.js"

describe("retryDelays", () => {
  it("starts almost immediately", () => {
    expect(retryDelays()[0]).toBeLessThanOrEqual(2_000)
  })

  it("backs off rather than hammering the client", () => {
    const delays = retryDelays()

    for (let index = 1; index < delays.length; index += 1) {
      expect(delays[index]).toBeGreaterThanOrEqual(delays[index - 1])
    }
  })

  it("gives up within a couple of minutes", () => {
    const total = retryDelays().reduce((sum, delay) => sum + delay, 0)

    expect(total).toBeGreaterThan(60_000)
    expect(total).toBeLessThanOrEqual(180_000)
  })
})

describe("syncUntilRecorded", () => {
  it("stops as soon as the game is recorded", async () => {
    const sync = vi.fn().mockResolvedValue({ inserted: 1 })
    const wait = vi.fn().mockResolvedValue(undefined)

    const attempts = await syncUntilRecorded(sync, wait)

    expect(attempts).toBe(1)
    expect(sync).toHaveBeenCalledTimes(1)
  })

  it("keeps trying while the client has nothing yet", async () => {
    const sync = vi
      .fn()
      .mockResolvedValueOnce({ inserted: 0 })
      .mockResolvedValueOnce({ inserted: 0 })
      .mockResolvedValue({ inserted: 1 })
    const wait = vi.fn().mockResolvedValue(undefined)

    const attempts = await syncUntilRecorded(sync, wait)

    expect(attempts).toBe(3)
  })

  it("waits between attempts", async () => {
    const sync = vi
      .fn()
      .mockResolvedValueOnce({ inserted: 0 })
      .mockResolvedValue({ inserted: 1 })
    const waited: number[] = []
    const wait = async (ms: number) => {
      waited.push(ms)
    }

    await syncUntilRecorded(sync, wait)

    expect(waited).toEqual([retryDelays()[0]])
  })

  it("gives up after the last delay rather than looping forever", async () => {
    const sync = vi.fn().mockResolvedValue({ inserted: 0 })
    const wait = vi.fn().mockResolvedValue(undefined)

    const attempts = await syncUntilRecorded(sync, wait)

    expect(attempts).toBe(retryDelays().length + 1)
  })

  it("keeps trying when a sync throws", async () => {
    // A client that is still writing the game can refuse the request.
    const sync = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue({ inserted: 1 })
    const wait = vi.fn().mockResolvedValue(undefined)

    const attempts = await syncUntilRecorded(sync, wait)

    expect(attempts).toBe(2)
  })
})
