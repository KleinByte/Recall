import { describe, expect, it, vi } from "vitest"
import { RiotApiClient } from "../electron/main/riot/api-client.js"
import { RiotRateLimiter } from "../electron/main/riot/rate-limiter.js"

describe("RiotRateLimiter", () => {
  it("uses the documented personal-key windows before Riot sends headers", async () => {
    let now = 0
    const sleeps: number[] = []
    const limiter = new RiotRateLimiter(
      () => now,
      async (milliseconds) => {
        sleeps.push(milliseconds)
        now += milliseconds
      },
    )

    for (let request = 0; request < 20; request += 1) {
      await limiter.acquire("match-detail")
    }
    expect(sleeps).toEqual([])

    await limiter.acquire("match-detail")
    expect(sleeps).toEqual([1_025])
  })

  it("adopts Riot's current app and method headers", async () => {
    let now = 0
    const sleeps: number[] = []
    const limiter = new RiotRateLimiter(
      () => now,
      async (milliseconds) => {
        sleeps.push(milliseconds)
        now += milliseconds
      },
    )
    limiter.observe(
      "match-detail",
      new Headers({
        "x-app-rate-limit": "500:10,30000:600",
        "x-app-rate-limit-count": "10:10,10:600",
        "x-method-rate-limit": "100:120",
        "x-method-rate-limit-count": "100:120",
      }),
    )

    await limiter.acquire("match-detail")

    expect(sleeps).toEqual([120_025])
  })

  it("automatically uses higher approved limits returned by Riot", async () => {
    let now = 0
    const sleeps: number[] = []
    const limiter = new RiotRateLimiter(
      () => now,
      async (milliseconds) => {
        sleeps.push(milliseconds)
        now += milliseconds
      },
    )
    limiter.observe(
      "match-detail",
      new Headers({
        "x-app-rate-limit": "500:10,30000:600",
        "x-app-rate-limit-count": "0:10,0:600",
        "x-method-rate-limit": "500:10,30000:600",
        "x-method-rate-limit-count": "0:10,0:600",
      }),
    )

    for (let request = 0; request < 101; request += 1) {
      await limiter.acquire("match-detail")
    }

    expect(sleeps).toEqual([])
  })
})

describe("RiotApiClient", () => {
  it("honours Retry-After and keeps the key out of the URL", async () => {
    const sleeps: number[] = []
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", {
          status: 429,
          headers: { "retry-after": "2" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(["NA1_1"]), { status: 200 }),
      )
    const limiter = {
      acquire: vi.fn().mockResolvedValue(undefined),
      observe: vi.fn(),
    }
    const client = new RiotApiClient("secret-key", "americas", {
      fetch: fetcher,
      limiter: limiter as never,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
      },
    })

    await expect(client.get<string[]>("/matches", "ids")).resolves.toEqual([
      "NA1_1",
    ])
    expect(sleeps).toEqual([2_050])
    expect(fetcher).toHaveBeenCalledTimes(2)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).not.toContain("secret-key")
    expect(init.headers["X-Riot-Token"]).toBe("secret-key")
  })
})
