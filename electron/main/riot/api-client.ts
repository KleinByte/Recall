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

/**
 * Accepts only Riot Web API keys. RSO client secrets and access tokens are
 * different credential types and cannot authenticate Match-V5 requests.
 */
export function normalizeRiotApiKey(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Enter an API key before saving")
  }

  const key = value.trim()
  if (!key.startsWith("RGAPI-") || /\s/.test(key)) {
    throw new Error(
      "Paste the RGAPI-… Web API key from developer.riotgames.com, not an RSO client secret or access token.",
    )
  }
  return key
}

interface RiotApiClientOptions {
  fetch?: typeof fetch
  limiter?: RiotRateLimiter
  sleep?: Sleep
}

const RETRYABLE = new Set([500, 502, 503, 504])

function failureMessage(status: number, scope: string) {
  const api = scope === "account" ? "Account-V1" : "Match-V5"
  switch (status) {
    case 400:
      return (
        `Riot rejected Recall's ${api} request as invalid (400). ` +
        "Retry the history import; if it continues, update Recall."
      )
    case 401:
      return (
        "Riot did not receive a usable Web API key (401). Paste the " +
        "RGAPI-… key from developer.riotgames.com, not an RSO client secret."
      )
    case 403:
      return (
        "Riot rejected this API key or API route (403). Development keys " +
        "expire every 24 hours; regenerate the key and try again."
      )
    default:
      return `Riot API request failed (${status}).`
  }
}

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

      throw new RiotApiError(
        failureMessage(response.status, scope),
        response.status,
      )
    }
  }
}
