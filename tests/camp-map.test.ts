import { describe, expect, it } from "vitest"
import { SUMMONERS_RIFT_GRAPH } from "../electron/main/pathing/summoners-rift-graph.js"
import {
  CAMP_BY_KEY,
  SUMMONERS_RIFT_CAMP_MAP_VERSION,
} from "../src/shared/minimap/camp-map.js"
import type { CampKey, NormalizedPoint } from "../src/shared/minimap/contracts.js"

const CALIBRATED_REGULAR_CAMPS: Partial<Record<CampKey, NormalizedPoint>> = {
  west_blue: { x: 0.266, y: 0.468 },
  west_gromp: { x: 0.158, y: 0.434 },
  west_wolves: { x: 0.267, y: 0.563 },
  west_raptors: { x: 0.481, y: 0.638 },
  west_red: { x: 0.535, y: 0.733 },
  west_krugs: { x: 0.572, y: 0.818 },
  east_blue: { x: 0.750, y: 0.535 },
  east_gromp: { x: 0.855, y: 0.568 },
  east_wolves: { x: 0.747, y: 0.438 },
  east_raptors: { x: 0.534, y: 0.357 },
  east_red: { x: 0.485, y: 0.268 },
  east_krugs: { x: 0.446, y: 0.180 },
}

const CALIBRATED_SPECIAL_CAMPS: Partial<Record<CampKey, NormalizedPoint>> = {
  north_scuttle: { x: 0.306, y: 0.356 },
  south_scuttle: { x: 0.713, y: 0.652 },
  dragon: { x: 0.677, y: 0.704 },
  baron: { x: 0.343, y: 0.298 },
  rift_herald: { x: 0.343, y: 0.298 },
  void_grubs: { x: 0.343, y: 0.298 },
}

describe("Summoner's Rift camp map", () => {
  it("uses the measured rendered-map centers instead of mirrored world estimates", () => {
    expect(SUMMONERS_RIFT_CAMP_MAP_VERSION).toBe(3)
    for (const [key, center] of Object.entries(CALIBRATED_REGULAR_CAMPS)) {
      expect(CAMP_BY_KEY.get(key as CampKey)?.center).toEqual(center)
    }
    for (const [key, center] of Object.entries(CALIBRATED_SPECIAL_CAMPS)) {
      expect(CAMP_BY_KEY.get(key as CampKey)?.center).toEqual(center)
    }

    expect(CAMP_BY_KEY.get("west_red")?.center.x).toBeGreaterThan(0.5)
    expect(CAMP_BY_KEY.get("east_red")?.center.x).toBeLessThan(0.5)
  })

  it("keeps path inference on the same camp centers used by CV and review maps", () => {
    const graphNodes = new Map(SUMMONERS_RIFT_GRAPH.nodes.map((entry) => [entry.id, entry]))
    for (const [key, center] of Object.entries(CALIBRATED_REGULAR_CAMPS)) {
      expect(graphNodes.get(key)?.point).toEqual(center)
    }
    expect(graphNodes.get("river_north")?.point).toEqual(CALIBRATED_SPECIAL_CAMPS.north_scuttle)
    expect(graphNodes.get("river_south")?.point).toEqual(CALIBRATED_SPECIAL_CAMPS.south_scuttle)
    expect(graphNodes.get("baron_pit")?.point).toEqual(CALIBRATED_SPECIAL_CAMPS.baron)
    expect(graphNodes.get("dragon_pit")?.point).toEqual(CALIBRATED_SPECIAL_CAMPS.dragon)
  })
})
