import { describe, expect, it } from "vitest"
import {
  mapPositionPercent,
  REVIEW_MAP_DOMAINS,
  reviewMapId,
} from "../src/helpers/map-coordinate"

describe("review map coordinates", () => {
  it("selects Riot's mode-specific map artwork", () => {
    expect(reviewMapId("aram")).toBe(12)
    expect(reviewMapId("classic")).toBe(453)
    expect(reviewMapId("ranked")).toBe(11)
  })

  it("uses Riot's non-generic world bounds and flips only the screen y axis", () => {
    expect(REVIEW_MAP_DOMAINS[11].max).toEqual({ x: 14_820, y: 14_881 })
    expect(REVIEW_MAP_DOMAINS[12]).toEqual({
      min: { x: -28, y: -19 },
      max: { x: 12_849, y: 12_858 },
    })
    expect(mapPositionPercent({ x: -28, y: -19 }, 12)).toEqual({ left: 0, top: 100 })
    expect(mapPositionPercent({ x: 12_849, y: 12_858 }, 12)).toEqual({ left: 100, top: 0 })
  })

  it("regresses an exact raw death from the recent Cho'Gath Classic match", () => {
    const plotted = mapPositionPercent({ x: 2_342, y: 12_040 }, 453)
    expect(plotted.left).toBeCloseTo(15.803, 3)
    expect(plotted.top).toBeCloseTo(19.091, 3)
  })

  it("clamps out-of-domain telemetry to the map edge", () => {
    expect(mapPositionPercent({ x: -500, y: 20_000 }, 11)).toEqual({ left: 0, top: 0 })
  })
})
