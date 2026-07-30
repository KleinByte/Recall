import { RiotRateLimiter } from "./rate-limiter.js"

type Priority = "interactive" | "background"

interface Pending<T> {
  priority: Priority
  scope: string
  signal?: AbortSignal
  task: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

/**
 * One scheduler per regional route. Requests are deliberately serialized:
 * Riot's fixed-window limiter still controls throughput, while serialization
 * makes it possible for an interactive timeline request to run immediately
 * after the in-flight history request.
 */
export class RiotRequestScheduler {
  private readonly limiter = new RiotRateLimiter()
  private readonly queue: Pending<unknown>[] = []
  private running = false

  schedule<T>(
    scope: string,
    priority: Priority,
    task: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const pending: Pending<T> = { priority, scope, task, signal, resolve, reject }
      const firstBackground = this.queue.findIndex(
        (entry) => entry.priority === "background",
      )
      if (priority === "interactive" && firstBackground >= 0) {
        this.queue.splice(firstBackground, 0, pending as Pending<unknown>)
      } else {
        this.queue.push(pending as Pending<unknown>)
      }
      void this.drain()
    })
  }

  observe(scope: string, headers: Headers) {
    this.limiter.observe(scope, headers)
  }

  snapshot() {
    return this.limiter.snapshot()
  }

  private async drain() {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length) {
        const pending = this.queue.shift()!
        if (pending.signal?.aborted) {
          pending.reject(pending.signal.reason ?? new DOMException("Aborted", "AbortError"))
          continue
        }
        try {
          await this.limiter.acquire(pending.scope, pending.signal)
          pending.resolve(await pending.task())
        } catch (error) {
          pending.reject(error)
        }
      }
    } finally {
      this.running = false
    }
  }
}

const schedulers = new Map<string, RiotRequestScheduler>()

export function schedulerForRoute(route: string) {
  let scheduler = schedulers.get(route)
  if (!scheduler) {
    scheduler = new RiotRequestScheduler()
    schedulers.set(route, scheduler)
  }
  return scheduler
}
