import { execFile } from "node:child_process"
import { EventEmitter } from "node:events"
import { existsSync, readFileSync, unwatchFile, watchFile } from "node:fs"
import path from "node:path"

const DISCOVERY_INTERVAL_MS = 10_000
const EXTERNAL_LOCKFILE_ENV = "RECALL_LCU_LOCKFILE"

export interface LcuCredentials {
  address: string
  port: number
  username: string
  password: string
  protocol: string
}

const LCU_LOOPBACK_ADDRESS = "127.0.0.1"

/**
 * Riot's local APIs use self-signed certificates. Any caller that disables
 * certificate verification must prove the destination is a numeric loopback
 * address first so credentials can never be sent to an arbitrary host.
 */
export function assertLoopbackLcuCredentials(
  credentials: LcuCredentials,
): LcuCredentials {
  if (credentials.address !== LCU_LOOPBACK_ADDRESS) {
    throw new Error("League Client credentials must target a loopback address.")
  }
  return credentials
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

export function configuredLcuLockfilePath(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const configured = environment[EXTERNAL_LOCKFILE_ENV]?.trim()
  return configured ? path.resolve(configured) : undefined
}

export function leagueInstallDirectoryFromLockfilePath(lockfilePath: string) {
  return path.dirname(path.resolve(lockfilePath))
}

export class LcuDiscovery extends EventEmitter {
  private installDirectory?: string
  private discoveryTimer?: NodeJS.Timeout
  private lockfilePath?: string
  private previousLockfile?: string
  private discovering = false
  private stopped = true

  start() {
    if (this.discoveryTimer || !this.stopped) return

    const configuredLockfile = configuredLcuLockfilePath()
    if (configuredLockfile) {
      this.stopped = false
      this.lockfilePath = configuredLockfile
      this.installDirectory = leagueInstallDirectoryFromLockfilePath(configuredLockfile)
      watchFile(this.lockfilePath, { interval: 1_000 }, () => this.readLockfile())
      this.readLockfile()
      return
    }

    if (process.platform !== "win32") return

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

  getInstallDirectory() {
    return this.installDirectory
  }

  getLockfilePath() {
    return this.lockfilePath
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
