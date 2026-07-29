import {
  abortableSleep,
  RiotRateLimiter,
  type Sleep,
} from "./rate-limiter.js"

export class RiotApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "RiotApiError"
  }
}

interface RiotApiClientOptions {
  fetch?: typeof fetch
  limiter?: RiotRateLimiter
  sleep?: Sleep
}

const RETRYABLE = new Set([500, 502, 503, 504])

export class RiotApiClient {
  private readonly fetcher: typeof fetch
  private readonly limiter: RiotRateLimiter
  private readonly sleep: Sleep

  constructor(
    private readonly apiKey: string,
    private readonly regionalRoute: string,
    options: RiotApiClientOptions = {},
  ) {
    this.fetcher = options.fetch ?? fetch
    this.sleep = options.sleep ?? abortableSleep
    this.limiter = options.limiter ?? new RiotRateLimiter(Date.now, this.sleep)
  }

  async get<T>(path: string, scope: string, signal?: AbortSignal): Promise<T> {
    let transientAttempts = 0

    while (true) {
      await this.limiter.acquire(scope, signal)

      let response: Response
      try {
        response = await this.fetcher(
          `https://${this.regionalRoute}.api.riotgames.com${path}`,
          {
            headers: {
              Accept: "application/json",
              "X-Riot-Token": this.apiKey,
            },
            signal,
          },
        )
      } catch (error) {
        if (signal?.aborted) throw error
        if (transientAttempts >= 4) throw error
        await this.sleep(1_000 * 2 ** transientAttempts, signal)
        transientAttempts += 1
        continue
      }

      this.limiter.observe(scope, response.headers)

      if (response.ok) return (await response.json()) as T

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"))
        const delay = Number.isFinite(retryAfter)
          ? Math.max(1, retryAfter) * 1_000
          : 120_000
        await this.sleep(delay + 50, signal)
        continue
      }

      if (RETRYABLE.has(response.status) && transientAttempts < 4) {
        await this.sleep(1_000 * 2 ** transientAttempts, signal)
        transientAttempts += 1
        continue
      }

      const suffix =
        response.status === 401 || response.status === 403
          ? " Check or regenerate the API key in Settings."
          : ""
      throw new RiotApiError(
        `Riot API request failed (${response.status}).${suffix}`,
        response.status,
      )
    }
  }
}
