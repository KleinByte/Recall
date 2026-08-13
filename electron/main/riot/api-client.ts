import {
  abortableSleep,
  RiotRateLimiter,
  type Sleep,
} from "./rate-limiter.js"
import { schedulerForRoute, type RiotRequestScheduler } from "./request-scheduler.js"

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
  scheduler?: RiotRequestScheduler
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

const MATCH_ID = "[A-Za-z0-9_-]{1,96}"
const PUUID = "[A-Za-z0-9_-]{1,128}"
const LIST_PATH = new RegExp(`^/lol/match/v5/matches/by-puuid/${PUUID}/ids(?:\\?[^#]*)?$`)
const ARTIFACT_PATH = new RegExp(`^/lol/match/v5/matches/${MATCH_ID}(?:/timeline)?$`)
const ACCOUNT_BY_RIOT_ID_PATH =
  /^\/riot\/account\/v1\/accounts\/by-riot-id\/[^/?#]{1,192}\/[^/?#]{1,64}$/

/** Rejects every Riot Web API path outside identity resolution and Match-V5 history. */
export function assertAllowedRiotHistoryPath(path: string): void {
  if (!LIST_PATH.test(path) && !ARTIFACT_PATH.test(path) &&
      !ACCOUNT_BY_RIOT_ID_PATH.test(path)) {
    throw new Error("riot_web_api_path_not_allowed")
  }
}

/** Backwards-compatible name for callers that only need the boundary assertion. */
export const assertAllowedMatchV5Path = assertAllowedRiotHistoryPath

export class RiotApiClient {
  private readonly fetcher: typeof fetch
  private readonly limiter: RiotRateLimiter
  private readonly scheduler?: RiotRequestScheduler
  private readonly sleep: Sleep

  constructor(
    private readonly apiKey: string,
    private readonly regionalRoute: string,
    options: RiotApiClientOptions = {},
  ) {
    this.fetcher = options.fetch ?? fetch
    this.sleep = options.sleep ?? abortableSleep
    this.limiter = options.limiter ?? new RiotRateLimiter(Date.now, this.sleep)
    this.scheduler = options.limiter
      ? options.scheduler
      : options.scheduler ?? schedulerForRoute(regionalRoute)
  }

  async get<T>(path: string, scope: string, signal?: AbortSignal): Promise<T> {
    assertAllowedRiotHistoryPath(path)
    let transientAttempts = 0

    while (true) {
      let response: Response
      try {
        const request = () => this.fetcher(
            `https://${this.regionalRoute}.api.riotgames.com${path}`,
            {
              headers: {
                Accept: "application/json",
                "X-Riot-Token": this.apiKey,
              },
              signal,
            },
          )
        response = this.scheduler
          ? await this.scheduler.schedule(
            scope,
            scope === "timeline" ? "interactive" : "background",
            request,
            signal,
          )
          : await (async () => {
            await this.limiter.acquire(scope, signal)
            return request()
          })()
      } catch (error) {
        if (signal?.aborted) throw error
        if (transientAttempts >= 4) throw error
        await this.sleep(1_000 * 2 ** transientAttempts, signal)
        transientAttempts += 1
        continue
      }

      if (this.scheduler) this.scheduler.observe(scope, response.headers)
      else this.limiter.observe(scope, response.headers)

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
