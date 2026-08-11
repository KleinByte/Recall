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

  request<T>(path: string): Promise<T> {
    const { address, port } = this.credentials

    return new Promise<T>((resolve, reject) => {
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
          res.on("end", () => {
            if (status < 200 || status >= 300) {
              reject(new LcuRequestError(status, path))
              return
            }

            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T)
            } catch (error) {
              reject(error)
            }
          })
        },
      )

      req.on("error", reject)
      req.end()
    })
  }

  close() {
    this.agent.destroy()
  }
}
