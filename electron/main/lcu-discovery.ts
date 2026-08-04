import { execFile } from "node:child_process"
import { EventEmitter } from "node:events"
import { existsSync, readFileSync, unwatchFile, watchFile } from "node:fs"
import path from "node:path"

const DISCOVERY_INTERVAL_MS = 10_000

export interface LcuCredentials {
  address: string
  port: number
  username: string
  password: string
  protocol: string
}

export function parseLeagueClientInstallPath(commandLine: string) {
  const match = commandLine.match(
    /"--install-directory=([^"]+)"|--install-directory="([^"]+)"|--install-directory=([^\s]+)/,
  )
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

export function parseLcuLockfile(lockfile: string): LcuCredentials | undefined {
  const [processName, processId, portText, password, protocol] = lockfile
    .trim()
    .split(":")
  const port = Number(portText)

  if (
    processName !== "LeagueClient" ||
    !Number.isInteger(Number(processId)) ||
    !Number.isInteger(port) ||
    port <= 0 ||
    !password ||
    !protocol
  ) {
    return undefined
  }

  return {
    address: "127.0.0.1",
    port,
    username: "riot",
    password,
    protocol,
  }
}

export class LcuDiscovery extends EventEmitter {
  private installDirectory?: string
  private discoveryTimer?: NodeJS.Timeout
  private lockfilePath?: string
  private previousLockfile?: string
  private discovering = false
  private stopped = true

  start() {
    if (process.platform !== "win32" || this.discoveryTimer || !this.stopped) return

    this.stopped = false
    void this.discover()
    this.discoveryTimer = setInterval(
      () => void this.discover(),
      DISCOVERY_INTERVAL_MS,
    )
  }

  stop() {
    this.stopped = true
    if (this.discoveryTimer) clearInterval(this.discoveryTimer)
    if (this.lockfilePath) unwatchFile(this.lockfilePath)
    this.discoveryTimer = undefined
    this.installDirectory = undefined
    this.lockfilePath = undefined
    this.previousLockfile = undefined
  }

  private async discover() {
    if (this.installDirectory || this.discovering || this.stopped) return

    this.discovering = true
    try {
      const installDirectory = await findLeagueClientInstallDirectory()
      if (
        this.stopped ||
        !installDirectory ||
        !existsSync(path.join(installDirectory, "LeagueClient.exe"))
      ) return

      this.installDirectory = installDirectory
      this.lockfilePath = path.join(installDirectory, "lockfile")
      if (this.discoveryTimer) clearInterval(this.discoveryTimer)
      this.discoveryTimer = undefined
      watchFile(this.lockfilePath, { interval: 1000 }, () => this.readLockfile())
      this.readLockfile()
    } finally {
      this.discovering = false
    }
  }

  private readLockfile() {
    if (!this.lockfilePath || !existsSync(this.lockfilePath)) {
      if (this.previousLockfile) {
        this.previousLockfile = undefined
        this.emit("disconnect")
      }
      return
    }

    const lockfile = readFileSync(this.lockfilePath, "utf8")
    if (lockfile === this.previousLockfile) return

    const credentials = parseLcuLockfile(lockfile)
    if (!credentials) return

    this.previousLockfile = lockfile
    this.emit("connect", credentials)
  }
}

function findLeagueClientInstallDirectory(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance -ClassName Win32_Process -Filter \"Name = 'LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine",
      ],
      (error, stdout) => {
        if (error) {
          resolve(undefined)
          return
        }

        resolve(parseLeagueClientInstallPath(stdout))
      },
    )
  })
}
