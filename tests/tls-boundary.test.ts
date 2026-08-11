import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(target) : entry.name.endsWith(".ts") ? [target] : []
  })
}

const mainSources = sourceFiles("electron/main").map((file) => ({
  file: file.replaceAll("\\", "/"),
  source: read(file),
}))

describe("TLS verification boundary", () => {
  it("never disables certificate verification process-wide", () => {
    for (const { source } of mainSources) {
      expect(source).not.toContain("ignore-certificate-errors")
      expect(source).not.toContain("allow-insecure-localhost")
      expect(source).not.toContain("NODE_TLS_REJECT_UNAUTHORIZED")
    }
  })

  it("limits self-signed certificate exceptions to Riot loopback clients", () => {
    const lcuClient = read("electron/main/lcu-client.ts")
    const lcuDiscovery = read("electron/main/lcu-discovery.ts")
    const lcuEvents = read("electron/main/lcu-events.ts")
    const gameClient = read("electron/main/game-client.ts")

    expect(mainSources
      .filter(({ source }) => source.includes("rejectUnauthorized: false"))
      .map(({ file }) => file)
      .sort(),
    ).toEqual([
      "electron/main/game-client.ts",
      "electron/main/lcu-client.ts",
      "electron/main/lcu-events.ts",
    ])
    expect(lcuDiscovery).toContain('address: "127.0.0.1"')
    expect(lcuDiscovery).toContain("assertLoopbackLcuCredentials")
    expect(lcuClient).toContain("new Agent({ rejectUnauthorized: false })")
    expect(lcuClient).toContain("assertLoopbackLcuCredentials(credentials)")
    expect(lcuClient).toContain("scoped to this loopback connection")
    expect(lcuEvents).toContain("rejectUnauthorized: false")
    expect(lcuEvents).toContain("assertLoopbackLcuCredentials(credentials)")
    expect(gameClient).toContain('host: "127.0.0.1"')
    expect(gameClient).toContain("new Agent({ rejectUnauthorized: false })")
  })
})
