import { describe, expect, it } from "vitest"
import { regionalRouteFor } from "../electron/main/riot/routing.js"

describe("regionalRouteFor", () => {
  it.each([
    ["NA1", "americas"],
    ["BR", "americas"],
    ["EUW1", "europe"],
    ["TR", "europe"],
    ["KR", "asia"],
    ["JP1", "asia"],
    ["OC1", "sea"],
    ["PH2", "sea"],
  ])("maps %s to %s", (platform, route) => {
    expect(regionalRouteFor(platform)).toBe(route)
  })

  it("normalises case and refuses unknown routes", () => {
    expect(regionalRouteFor(" euw ")).toBe("europe")
    expect(regionalRouteFor("unknown")).toBeUndefined()
  })
})
