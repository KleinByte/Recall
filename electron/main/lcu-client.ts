import { Agent, request } from "node:https"
import { assertLoopbackLcuCredentials } from "./lcu-discovery.js"
import type { LcuCredentials } from "./lcu-discovery.js"

export function buildAuthHeader(credentials: LcuCredentials): string {
  const { username, password } = credentials
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

export class LcuRequestError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`League Client returned ${status} for ${path}`)
    this.name = "LcuRequestError"
  }
}

export class LcuRequestTimeoutError extends Error {
  constructor(
    readonly timeoutMs: number,
    path: string,
  ) {
    super(`League Client request timed out after ${timeoutMs}ms for ${path}`)
    this.name = "LcuRequestTimeoutError"
  }
}

export interface LcuRequestOptions {
  /** Local lifecycle reads should fail quickly enough for the next poll to recover. */
  timeoutMs?: number
  signal?: AbortSignal
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5_000

/**
 * Reads from the local League Client API.
 *
 * The client serves HTTPS with a self-signed certificate. Verification is
 * disabled through a dedicated agent, scoped to this loopback connection,
 * rather than a process-wide TLS override.
 */
export class LcuClient {
  private readonly agent = new Agent({ rejectUnauthorized: false })
  private readonly credentials: LcuCredentials

  constructor(credentials: LcuCredentials) {
    this.credentials = assertLoopbackLcuCredentials(credentials)
  }

  request<T>(path: string, options: LcuRequestOptions = {}): Promise<T> {
    const { address, port } = this.credentials
    const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)

    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        options.signal?.removeEventListener("abort", abort)
        callback()
      }
      const req = request(
        {
          host: address,
          port,
          path,
          method: "GET",
          agent: this.agent,
          headers: {
            accept: "application/json",
            authorization: buildAuthHeader(this.credentials),
          },
        },
        (res) => {
          const status = res.statusCode ?? 0
          const chunks: Buffer[] = []

          res.on("data", (chunk: Buffer) => chunks.push(chunk))
          res.on("error", (error) => finish(() => reject(error)))
          res.on("end", () => {
            if (status < 200 || status >= 300) {
              finish(() => reject(new LcuRequestError(status, path)))
              return
            }

            try {
              const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as T
              finish(() => resolve(value))
            } catch (error) {
              finish(() => reject(error))
            }
          })
        },
      )

      const abort = () => req.destroy(options.signal?.reason instanceof Error
        ? options.signal.reason
        : new Error("League Client request aborted"))
      req.setTimeout(timeoutMs, () => {
        req.destroy(new LcuRequestTimeoutError(timeoutMs, path))
      })
      req.on("error", (error) => finish(() => reject(error)))
      if (options.signal?.aborted) {
        abort()
        return
      }
      options.signal?.addEventListener("abort", abort, { once: true })
      req.end()
    })
  }

  close() {
    this.agent.destroy()
  }
}
