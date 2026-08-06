import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { canonicalJson } from "./match-source-repo.js"

export const STORAGE_MAINTENANCE_LEASE_MS = 300_000
export const STORAGE_MAINTENANCE_HEARTBEAT_MS = 15_000

export interface StorageLockOwner {
  ownerToken: string
  operation: string
  pid: number
  processStartToken: string
  hostId: string
  acquiredAt: number
  heartbeatAt: number
  leaseUntil: number
}

export interface StorageLockOptions {
  now?: () => number
  pid?: number
  hostId?: string
  processStartToken?: string
  /** Must prove the exact PID/start-token pair is dead; unknown returns undefined. */
  isProcessAlive?: (owner: StorageLockOwner) => boolean | undefined
  staleReadDelayMs?: number
}

function inside(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(candidate)
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("maintenance_lock_path_escape")
  }
  return resolved
}

const readOwner = (lockPath: string): StorageLockOwner =>
  JSON.parse(readFileSync(path.join(lockPath, "owner.json"), "utf8")) as StorageLockOwner

const delay = (milliseconds: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds)
})

export class StorageMaintenanceLock {
  private timer?: ReturnType<typeof setInterval>
  private failed = false

  constructor(
    private readonly lockPath: string,
    private owner: StorageLockOwner,
    private readonly now: () => number,
  ) {
    this.timer = setInterval(() => {
      try { this.heartbeat() } catch { this.failed = true }
    }, STORAGE_MAINTENANCE_HEARTBEAT_MS)
    this.timer.unref?.()
  }

  assertOwned(): void {
    if (this.failed) throw new Error("maintenance_lock_heartbeat_failed")
    const current = readOwner(this.lockPath)
    if (current.ownerToken !== this.owner.ownerToken) {
      this.failed = true
      throw new Error("maintenance_lock_token_lost")
    }
  }

  heartbeat(): void {
    this.assertOwned()
    const heartbeatAt = this.now()
    this.owner = {
      ...this.owner,
      heartbeatAt,
      leaseUntil: heartbeatAt + STORAGE_MAINTENANCE_LEASE_MS,
    }
    const temporary = path.join(this.lockPath, `owner.${this.owner.ownerToken}.tmp`)
    writeFileSync(temporary, canonicalJson(this.owner), { encoding: "utf8", flag: "wx" })
    renameSync(temporary, path.join(this.lockPath, "owner.json"))
  }

  release(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.assertOwned()
    rmSync(this.lockPath, { recursive: true, force: false })
  }
}

export async function acquireStorageMaintenanceLock(
  dataRoot: string,
  operation: string,
  options: StorageLockOptions = {},
): Promise<StorageMaintenanceLock> {
  const root = path.resolve(dataRoot)
  const lockPath = inside(root, path.join(root, ".storage-maintenance.lock"))
  const now = options.now ?? Date.now
  const pid = options.pid ?? process.pid
  const hostId = options.hostId ?? os.hostname()
  const processStartToken = options.processStartToken ??
    `${pid}:${Math.trunc(Date.now() - process.uptime() * 1000)}`

  const create = () => {
    mkdirSync(lockPath)
    const acquiredAt = now()
    const owner: StorageLockOwner = {
      ownerToken: randomUUID(), operation, pid, processStartToken, hostId,
      acquiredAt, heartbeatAt: acquiredAt,
      leaseUntil: acquiredAt + STORAGE_MAINTENANCE_LEASE_MS,
    }
    try {
      writeFileSync(path.join(lockPath, "owner.json"), canonicalJson(owner), {
        encoding: "utf8", flag: "wx",
      })
    } catch (error) {
      rmSync(lockPath, { recursive: true, force: true })
      throw error
    }
    return new StorageMaintenanceLock(lockPath, owner, now)
  }

  try {
    return create()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "EEXIST") throw error
  }

  const first = readOwner(lockPath)
  if (first.leaseUntil >= now()) throw new Error("storage_maintenance_locked")
  await delay(options.staleReadDelayMs ?? 5_000)
  const second = readOwner(lockPath)
  if (second.ownerToken !== first.ownerToken || second.leaseUntil >= now()) {
    throw new Error("storage_maintenance_locked")
  }
  const alive = options.isProcessAlive?.(second)
  if (alive !== false) throw new Error(alive ? "storage_maintenance_owner_alive" : "storage_maintenance_liveness_unknown")

  const stalePath = inside(root, path.join(root, `.storage-maintenance.stale.${second.ownerToken}`))
  renameSync(lockPath, stalePath)
  try {
    const lock = create()
    rmSync(stalePath, { recursive: true, force: true })
    return lock
  } catch (error) {
    // Another contender won normal creation. Preserve the stale directory for
    // diagnosis; it is no longer the active lock.
    throw error
  }
}
