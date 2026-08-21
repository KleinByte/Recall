import { readFile } from "node:fs/promises"
import type { MinimapPlacement } from "../../../src/shared/minimap/contracts.js"
import type { MinimapCalibrationHints } from "./calibration.js"

export interface LeagueMinimapSettings {
  placement?: MinimapPlacement
  minimapScale?: number
  resolutionWidth?: number
  resolutionHeight?: number
  windowMode?: number
}

export type ReadTextFile = (path: string) => Promise<string>

function finiteNumber(value: string | undefined) {
  if (value === undefined || value.trim() === "") return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function positiveInteger(value: string | undefined) {
  const parsed = finiteNumber(value)
  return parsed !== undefined && Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : undefined
}

/**
 * Parses the small subset of game.cfg that determines minimap geometry.
 * Section names are retained in the key so unrelated Width/Height settings do
 * not override General. Invalid individual values are ignored safely.
 */
export function parseLeagueGameConfig(source: string): LeagueMinimapSettings {
  const values = new Map<string, string>()
  let section = ""
  for (const rawLine of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(";") || line.startsWith("#")) continue
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line)
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase()
      continue
    }
    const separator = line.indexOf("=")
    if (separator < 1) continue
    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).split(/[;#]/, 1)[0].trim()
    values.set(`${section}.${key}`, value)
  }

  const firstValue = (...keys: string[]) => keys
    .map((key) => values.get(key))
    .find((value) => value !== undefined)
  const flip = finiteNumber(firstValue("hud.flipminimap", "general.flipminimap"))
  const scale = finiteNumber(firstValue("hud.minimapscale", "general.minimapscale"))
  const placement = flip === 1 ? "left" : flip === 0 ? "right" : undefined
  return {
    placement,
    minimapScale: scale !== undefined && scale >= 0.5 && scale <= 3
      ? scale
      : undefined,
    resolutionWidth: positiveInteger(values.get("general.width")),
    resolutionHeight: positiveInteger(values.get("general.height")),
    windowMode: finiteNumber(values.get("general.windowmode")),
  }
}

export async function readLeagueMinimapSettings(
  gameConfigPath: string,
  readText: ReadTextFile = async (path) => readFile(path, "utf8"),
) {
  return parseLeagueGameConfig(await readText(gameConfigPath))
}

export function calibrationHintsFromLeagueSettings(
  settings: LeagueMinimapSettings,
  displayScaleFactor?: number,
): MinimapCalibrationHints {
  return {
    placement: settings.placement,
    minimapScale: settings.minimapScale,
    displayScaleFactor: displayScaleFactor !== undefined &&
      Number.isFinite(displayScaleFactor) && displayScaleFactor > 0
      ? displayScaleFactor
      : undefined,
  }
}
