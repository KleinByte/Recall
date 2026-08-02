export const POSITIONS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const

export type Position = typeof POSITIONS[number]

const CANONICAL = new Set<string>(POSITIONS)

const ASSIGNED_ALIASES: Record<string, Position> = {
  TOP: "TOP",
  JUNGLE: "JUNGLE",
  JUNGLER: "JUNGLE",
  MID: "MIDDLE",
  MIDDLE: "MIDDLE",
  BOT: "BOTTOM",
  BOTTOM: "BOTTOM",
  ADC: "BOTTOM",
  UTILITY: "UTILITY",
  SUPPORT: "UTILITY",
}

const upper = (value?: string) => value?.trim().toUpperCase() ?? ""

/** Main-process twin of the renderer's pure position resolver. */
export function resolvePosition(
  lane?: string,
  role?: string,
  assigned?: string,
): Position | undefined {
  const roleKey = upper(role)
  if (CANONICAL.has(roleKey)) return roleKey as Position

  const assignedPosition = ASSIGNED_ALIASES[upper(assigned)]
  if (assignedPosition) return assignedPosition

  const laneKey = upper(lane)
  if (laneKey === "BOTTOM" || laneKey === "BOT") {
    return roleKey === "SUPPORT" || roleKey === "DUO_SUPPORT"
      ? "UTILITY"
      : "BOTTOM"
  }
  if (laneKey === "TOP" || laneKey === "JUNGLE" || laneKey === "MIDDLE") {
    return laneKey
  }
  return undefined
}
