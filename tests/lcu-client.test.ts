import { describe, expect, it } from "vitest"
import { buildAuthHeader, LcuClient } from "../electron/main/lcu-client.js"
import { LcuEvents } from "../electron/main/lcu-events.js"

describe("buildAuthHeader", () => {
  it("encodes the local API credentials as HTTP basic auth", () => {
    const header = buildAuthHeader({
      address: "127.0.0.1",
      port: 50329,
      username: "riot",
      password: "secret-password",
      protocol: "https",
    })

    expect(header).toBe(
      `Basic ${Buffer.from("riot:secret-password").toString("base64")}`,
    )
  })

  it("rejects non-loopback destinations before creating an insecure HTTP client", () => {
    const credentials = {
      address: "example.com",
      port: 443,
      username: "riot",
      password: "must-not-leave-loopback",
      protocol: "https",
    }

    expect(() => new LcuClient(credentials)).toThrow(/loopback address/i)
    expect(() => new LcuEvents(credentials)).toThrow(/loopback address/i)
  })

  it("accepts Riot's numeric IPv4 loopback destination", () => {
    const credentials = {
      address: "127.0.0.1",
      port: 50329,
      username: "riot",
      password: "local-secret",
      protocol: "https",
    }

    const client = new LcuClient(credentials)
    const events = new LcuEvents(credentials)
    client.close()
    events.stop()
  })
})
