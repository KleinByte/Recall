import type { CampKey, NormalizedPoint } from "./contracts.js"

export interface CampDefinition {
  key: CampKey
  center: NormalizedPoint
  patchRadius: number
  attributionRadius: number
  respawnRule: "standard" | "buff" | "scuttle" | "epic"
  mirroredFrom?: CampKey
}

/** Versioned normalized anchors for the rendered Summoner's Rift minimap. */
export const SUMMONERS_RIFT_CAMP_MAP_VERSION = 3
export const CAMP_CLEAR_ALGORITHM_VERSION = 6

// These are the centers of Riot's rendered minimap camp glyphs. They stay
// explicit because the rendered map is not perfectly point-symmetric; deriving
// the east camps with (1 - x, 1 - y) visibly displaces several markers.
const regularCamps = [
  ["west_blue", 0.266, 0.468, "buff"],
  ["west_gromp", 0.158, 0.434, "standard"],
  ["west_wolves", 0.267, 0.563, "standard"],
  ["west_raptors", 0.481, 0.638, "standard"],
  ["west_red", 0.535, 0.733, "buff"],
  ["west_krugs", 0.572, 0.818, "standard"],
  ["east_blue", 0.750, 0.535, "buff"],
  ["east_gromp", 0.855, 0.568, "standard"],
  ["east_wolves", 0.747, 0.438, "standard"],
  ["east_raptors", 0.534, 0.357, "standard"],
  ["east_red", 0.485, 0.268, "buff"],
  ["east_krugs", 0.446, 0.180, "standard"],
] as const

export const SUMMONERS_RIFT_CAMPS: readonly CampDefinition[] = [
  ...regularCamps.map(([key, x, y, respawnRule]) => ({
    key,
    center: { x, y },
    patchRadius: 0.026,
    attributionRadius: 0.075,
    respawnRule,
  } satisfies CampDefinition)),
  {
    key: "north_scuttle",
    center: { x: 0.306, y: 0.356 },
    patchRadius: 0.027,
    attributionRadius: 0.09,
    respawnRule: "scuttle",
  },
  {
    key: "south_scuttle",
    center: { x: 0.713, y: 0.652 },
    patchRadius: 0.027,
    attributionRadius: 0.09,
    respawnRule: "scuttle",
  },
  {
    key: "dragon",
    center: { x: 0.677, y: 0.704 },
    patchRadius: 0.032,
    attributionRadius: 0.12,
    respawnRule: "epic",
  },
  {
    key: "baron",
    center: { x: 0.343, y: 0.298 },
    patchRadius: 0.032,
    attributionRadius: 0.12,
    respawnRule: "epic",
  },
  {
    key: "rift_herald",
    center: { x: 0.343, y: 0.298 },
    patchRadius: 0.032,
    attributionRadius: 0.12,
    respawnRule: "epic",
  },
  {
    key: "void_grubs",
    center: { x: 0.343, y: 0.298 },
    patchRadius: 0.032,
    attributionRadius: 0.12,
    respawnRule: "epic",
  },
]

export const CAMP_BY_KEY = new Map(SUMMONERS_RIFT_CAMPS.map((camp) => [camp.key, camp]))

/** Patch 26.1 non-epic camp timers used for review playback and clear deduplication. */
export function campRespawnDurationMs(campKey: CampKey) {
  const rule = CAMP_BY_KEY.get(campKey)?.respawnRule
  if (rule === "standard") return 2 * 60_000
  if (rule === "buff") return 4.5 * 60_000
  return undefined
}
