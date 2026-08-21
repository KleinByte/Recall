import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

export const UPDATE_MARKER_MAX_AGE_MS = 30 * 60_000
const UPDATE_MARKER_FILE = "update-in-progress.json"

interface UpdateMarker {
  format: "recall-update-in-progress"
  version: 1
  targetVersion: string
  startedAt: number
}

export type UpdateStartupState =
  | { kind: "normal" }
  | { kind: "updating"; targetVersion: string; startedAt: number }

function markerPath(userDataDir: string) {
  return path.join(userDataDir, UPDATE_MARKER_FILE)
}

function versionParts(version: string): number[] | undefined {
  const normalized = version.trim().replace(/^v/i, "").split("-", 1)[0]
  if (!/^\d+(?:\.\d+)*$/.test(normalized)) return undefined
  return normalized.split(".").map(Number)
}

function isAtLeast(currentVersion: string, targetVersion: string) {
  const current = versionParts(currentVersion)
  const target = versionParts(targetVersion)
  if (!current || !target) return currentVersion.trim() === targetVersion.trim()
  const length = Math.max(current.length, target.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (current[index] ?? 0) - (target[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return true
}

export function clearUpdateMarker(userDataDir: string) {
  rmSync(markerPath(userDataDir), { force: true })
}

export function markUpdateInProgress(
  userDataDir: string,
  targetVersion: string,
  now: () => number = Date.now,
) {
  if (!targetVersion.trim()) throw new Error("Update target version is missing")
  const destination = markerPath(userDataDir)
  const staging = `${destination}.tmp-${process.pid}`
  const marker: UpdateMarker = {
    format: "recall-update-in-progress",
    version: 1,
    targetVersion: targetVersion.trim(),
    startedAt: now(),
  }
  try {
    rmSync(staging, { force: true })
    writeFileSync(staging, JSON.stringify(marker), { encoding: "utf8", flag: "wx" })
    rmSync(destination, { force: true })
    renameSync(staging, destination)
  } finally {
    rmSync(staging, { force: true })
  }
}

/**
 * Called before the normal single-instance lock or any database access. An old
 * executable sees a fresh marker and enters the read-free update window. The
 * installed target (or anything newer) clears the handoff and starts normally.
 */
export function updateStartupState(
  userDataDir: string,
  currentVersion: string,
  now: () => number = Date.now,
): UpdateStartupState {
  const filePath = markerPath(userDataDir)
  if (!existsSync(filePath)) return { kind: "normal" }

  try {
    const marker = JSON.parse(readFileSync(filePath, "utf8")) as UpdateMarker
    const age = now() - marker.startedAt
    if (marker.format !== "recall-update-in-progress" || marker.version !== 1 ||
        !marker.targetVersion?.trim() || !Number.isFinite(marker.startedAt) ||
        age < -60_000 || age > UPDATE_MARKER_MAX_AGE_MS) {
      clearUpdateMarker(userDataDir)
      return { kind: "normal" }
    }
    if (isAtLeast(currentVersion, marker.targetVersion)) {
      clearUpdateMarker(userDataDir)
      return { kind: "normal" }
    }
    return {
      kind: "updating",
      targetVersion: marker.targetVersion,
      startedAt: marker.startedAt,
    }
  } catch {
    clearUpdateMarker(userDataDir)
    return { kind: "normal" }
  }
}
