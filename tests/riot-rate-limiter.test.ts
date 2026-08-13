import { describe, expect, it, vi } from "vitest"
import {
  normalizeRiotApiKey,
  RiotApiClient,
} from "../electron/main/riot/api-client.js"
import { abortableSleep, RiotRateLimiter } from "../electron/main/riot/rate-limiter.js"

describe("RiotRateLimiter", () => {
  it("removes abort listeners after both completion and cancellation", async () => {
    const completed = new AbortController()
    const completedRemove = vi.spyOn(completed.signal, "removeEventListener")
    await abortableSleep(0, completed.signal)
    expect(completedRemove).toHaveBeenCalledWith("abort", expect.any(Function))

    const cancelled = new AbortController()
    const cancelledRemove = vi.spyOn(cancelled.signal, "removeEventListener")
    const sleep = abortableSleep(60_000, cancelled.signal)
    cancelled.abort()
    await expect(sleep).rejects.toThrow()
    expect(cancelledRemove).toHaveBeenCalledWith("abort", expect.any(Function))
  })

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
  it("accepts only RGAPI Web API credentials", () => {
    expect(normalizeRiotApiKey("  RGAPI-valid-key  ")).toBe("RGAPI-valid-key")
    expect(() => normalizeRiotApiKey("")).toThrow("Enter an API key")
    expect(() => normalizeRiotApiKey("rso-client-secret")).toThrow(
      "not an RSO client secret",
    )
  })

  it.each([
    [
      400,
      "Riot rejected Recall's Match-V5 request as invalid (400).",
    ],
    [401, "Riot did not receive a usable Web API key (401)."],
    [403, "Riot rejected this API key or API route (403)."],
  ])("explains Riot HTTP %i failures", async (status, message) => {
    const limiter = {
      acquire: vi.fn().mockResolvedValue(undefined),
      observe: vi.fn(),
    }
    const client = new RiotApiClient("RGAPI-test", "americas", {
      fetch: vi.fn().mockResolvedValue(new Response("", { status })),
      limiter: limiter as never,
    })

    await expect(client.get("/lol/match/v5/matches/NA1_1", "detail")).rejects.toThrow(message)
  })

  it("identifies Account-V1 failures during PUUID refresh", async () => {
    const client = new RiotApiClient("RGAPI-test", "americas", {
      fetch: vi.fn().mockResolvedValue(new Response("", { status: 400 })),
      limiter: {
        acquire: vi.fn().mockResolvedValue(undefined),
        observe: vi.fn(),
      } as never,
    })

    await expect(client.get(
      "/riot/account/v1/accounts/by-riot-id/Recall%20Player/NA1",
      "account",
    )).rejects.toThrow("Account-V1 request as invalid (400)")
  })

  it("rejects unsupported Riot APIs before making a request", async () => {
    const fetcher = vi.fn()
    const client = new RiotApiClient("RGAPI-test", "americas", {
      fetch: fetcher,
      limiter: {
        acquire: vi.fn().mockResolvedValue(undefined),
        observe: vi.fn(),
      } as never,
    })

    await expect(
      client.get("/account-path-containing-a-name", "account"),
    ).rejects.toThrow("riot_web_api_path_not_allowed")
    expect(fetcher).not.toHaveBeenCalled()
  })

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

    await expect(client.get<string[]>("/lol/match/v5/matches/by-puuid/local-puuid/ids?start=0&count=100", "ids")).resolves.toEqual([
      "NA1_1",
    ])
    expect(sleeps).toEqual([2_050])
    expect(fetcher).toHaveBeenCalledTimes(2)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).not.toContain("secret-key")
    expect(init.headers["X-Riot-Token"]).toBe("secret-key")
  })
})
