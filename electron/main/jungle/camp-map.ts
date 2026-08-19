import type { CampKey, NormalizedPoint } from "../../../src/shared/minimap/contracts.js"

export interface CampDefinition {
  key: CampKey
  center: NormalizedPoint
  patchRadius: number
  attributionRadius: number
  respawnRule: "standard" | "buff" | "scuttle" | "epic"
  mirroredFrom?: CampKey
}

/**
 * Versioned minimap anchors. These are deliberately data, not detector logic,
 * so patch-specific fixture calibration can replace them without code changes.
 */
export const SUMMONERS_RIFT_CAMP_MAP_VERSION = 1

const west = [
  ["west_blue", 0.275, 0.704, "buff"],
  ["west_gromp", 0.205, 0.758, "standard"],
  ["west_wolves", 0.35, 0.625, "standard"],
  ["west_raptors", 0.465, 0.676, "standard"],
  ["west_red", 0.525, 0.754, "buff"],
  ["west_krugs", 0.61, 0.835, "standard"],
] as const

export const SUMMONERS_RIFT_CAMPS: readonly CampDefinition[] = [
  ...west.map(([key, x, y, respawnRule]) => ({
    key,
    center: { x, y },
    patchRadius: 0.026,
    attributionRadius: 0.075,
    respawnRule,
  } satisfies CampDefinition)),
  ...west.map(([westKey, x, y, respawnRule]) => ({
    key: westKey.replace("west_", "east_") as CampKey,
    center: { x: 1 - x, y: 1 - y },
    patchRadius: 0.026,
    attributionRadius: 0.075,
    respawnRule,
    mirroredFrom: westKey,
  } satisfies CampDefinition)),
  {
    key: "north_scuttle",
    center: { x: 0.43, y: 0.39 },
    patchRadius: 0.027,
    attributionRadius: 0.09,
    respawnRule: "scuttle",
  },
  {
    key: "south_scuttle",
    center: { x: 0.57, y: 0.61 },
    patchRadius: 0.027,
    attributionRadius: 0.09,
    respawnRule: "scuttle",
  },
  {
    key: "dragon",
    center: { x: 0.61, y: 0.52 },
    patchRadius: 0.032,
    attributionRadius: 0.12,
    respawnRule: "epic",
  },
  {
    key: "baron",
    center: { x: 0.39, y: 0.48 },
    patchRadius: 0.032,
    attributionRadius: 0.12,
    respawnRule: "epic",
  },
  {
    key: "rift_herald",
    center: { x: 0.39, y: 0.48 },
    patchRadius: 0.032,
    attributionRadius: 0.12,
    respawnRule: "epic",
  },
  {
    key: "void_grubs",
    center: { x: 0.39, y: 0.48 },
    patchRadius: 0.032,
    attributionRadius: 0.12,
    respawnRule: "epic",
  },
]

export const CAMP_BY_KEY = new Map(SUMMONERS_RIFT_CAMPS.map((camp) => [camp.key, camp]))
