import { describe, expect, it } from "vitest"
import {
  configuredLcuLockfilePath,
  parseLeagueClientInstallPath,
  parseLcuLockfile,
} from "../electron/main/lcu-discovery.js"
import path from "node:path"

describe("parseLeagueClientInstallPath", () => {
  it("extracts the installation directory when League quotes the complete switch", () => {
    const commandLine =
      '"C:\\Riot Games\\League of Legends\\LeagueClientUx.exe" "--install-directory=C:\\Riot Games\\League of Legends" --app-name=LeagueClient'

    expect(parseLeagueClientInstallPath(commandLine)).toBe(
      "C:\\Riot Games\\League of Legends",
    )
  })

  it("extracts a quoted League installation directory from PowerShell process output", () => {
    const commandLine =
      '"C:\\Riot Games\\League of Legends\\LeagueClientUx.exe" --install-directory="C:\\Riot Games\\League of Legends" --app-name=LeagueClient'

    expect(parseLeagueClientInstallPath(commandLine)).toBe(
      "C:\\Riot Games\\League of Legends",
    )
  })

  it("returns undefined when the process command line has no install directory", () => {
    expect(parseLeagueClientInstallPath("LeagueClientUx.exe")).toBeUndefined()
  })
})

describe("parseLcuLockfile", () => {
  it("converts a valid lockfile into LCU credentials", () => {
    expect(
      parseLcuLockfile(
        "LeagueClient:8675:12345:secret-password:https",
      ),
    ).toEqual({
      address: "127.0.0.1",
      port: 12345,
      username: "riot",
      password: "secret-password",
      protocol: "https",
    })
  })

  it("rejects malformed lockfile content", () => {
    expect(parseLcuLockfile("not-a-lockfile")).toBeUndefined()
  })
})

describe("configuredLcuLockfilePath", () => {
  it("allows a non-Windows container to discover an explicitly mounted lockfile", () => {
    expect(configuredLcuLockfilePath({ RECALL_LCU_LOCKFILE: "/league-client/lockfile" }))
      .toBe(path.resolve("/league-client/lockfile"))
    expect(configuredLcuLockfilePath({ RECALL_LCU_LOCKFILE: "  " })).toBeUndefined()
  })
})
