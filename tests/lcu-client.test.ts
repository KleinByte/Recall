import { describe, expect, it } from "vitest"
import { buildAuthHeader } from "../electron/main/lcu-client.js"

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
})
