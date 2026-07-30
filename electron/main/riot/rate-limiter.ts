export type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>

interface WindowState {
  kind: "app" | "method"
  scope: string
  capacity: number
  windowMs: number
  count: number
  observedAt: number
}

const DEFAULT_LIMITS = [
  { capacity: 20, windowMs: 1_000 },
  { capacity: 100, windowMs: 120_000 },
]

export const abortableSleep: Sleep = (milliseconds, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
      return
    }

    const timer = setTimeout(resolve, Math.max(0, milliseconds))
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
      },
      { once: true },
    )
  })

function pairs(value: string | null): { count: number; windowMs: number }[] {
  if (!value) return []

  return value
    .split(",")
    .map((entry) => entry.trim().split(":").map(Number))
    .filter(
      (entry) =>
        entry.length === 2 &&
        Number.isFinite(entry[0]) &&
        entry[0] >= 0 &&
        Number.isFinite(entry[1]) &&
        entry[1] > 0,
    )
    .map(([count, seconds]) => ({ count, windowMs: seconds * 1_000 }))
}

/**
 * A conservative view of Riot's fixed windows.
 *
 * The documented personal-key limits are used before the first response. Once
 * Riot returns headers, their application and per-method limits replace those
 * defaults, so a production key automatically uses its approved capacity.
 */
export class RiotRateLimiter {
  private readonly windows = new Map<string, WindowState>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly sleep: Sleep = abortableSleep,
  ) {
    for (const limit of DEFAULT_LIMITS) {
      this.windows.set(`app:*:${limit.windowMs}`, {
        kind: "app",
        scope: "*",
        ...limit,
        count: 0,
        observedAt: this.now(),
      })
    }
  }

  async acquire(scope: string, signal?: AbortSignal) {
    while (true) {
      const now = this.now()
      let delay = 0

      for (const window of this.applicable(scope)) {
        if (now - window.observedAt >= window.windowMs) {
          window.count = 0
          window.observedAt = now
        }
        if (window.count >= window.capacity) {
          delay = Math.max(
            delay,
            window.observedAt + window.windowMs - now + 25,
          )
        }
      }

      if (delay <= 0) break
      await this.sleep(delay, signal)
    }

    for (const window of this.applicable(scope)) window.count += 1
  }

  observe(scope: string, headers: Headers) {
    this.replace(
      "app",
      "*",
      headers.get("x-app-rate-limit"),
      headers.get("x-app-rate-limit-count"),
    )
    this.replace(
      "method",
      scope,
      headers.get("x-method-rate-limit"),
      headers.get("x-method-rate-limit-count"),
    )
  }

  snapshot() {
    const now = this.now()
    return [...this.windows.values()]
      .filter((window) => window.kind === "app")
      .map((window) => ({
        limit: window.capacity,
        seconds: window.windowMs / 1_000,
        used: window.count,
        resetsAt: window.observedAt + window.windowMs > now
          ? window.observedAt + window.windowMs
          : undefined,
      }))
  }

  private applicable(scope: string) {
    return [...this.windows.values()].filter(
      (window) => window.kind === "app" || window.scope === scope,
    )
  }

  private replace(
    kind: "app" | "method",
    scope: string,
    limitHeader: string | null,
    countHeader: string | null,
  ) {
    const limits = pairs(limitHeader)
    if (limits.length === 0) return

    const counts = new Map(
      pairs(countHeader).map((entry) => [entry.windowMs, entry.count]),
    )
    const prefix = `${kind}:${scope}:`
    for (const key of this.windows.keys()) {
      if (key.startsWith(prefix)) this.windows.delete(key)
    }

    const observedAt = this.now()
    for (const limit of limits) {
      this.windows.set(`${prefix}${limit.windowMs}`, {
        kind,
        scope,
        capacity: limit.count,
        windowMs: limit.windowMs,
        count: counts.get(limit.windowMs) ?? 0,
        observedAt,
      })
    }
  }
}
