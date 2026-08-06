import { describe, expect, it } from "vitest"
import {
  CAPTURE_CATEGORY_IDS,
  categoryApplicability,
  resolveModeCapability,
} from "../electron/main/matches/source-capabilities.js"
import { SOURCE_FIELD_REGISTRY_V1 } from "../electron/main/matches/source-field-contract.js"

describe("source capability contracts", () => {
  it("resolves registered modes before product families", () => {
    expect(resolveModeCapability({ gameMode: "CHERRY", mapId: 30 })).toBe("arena")
    expect(resolveModeCapability({ gameMode: "KIWI_JADE" })).toBe("mayhem")
    expect(resolveModeCapability({ gameMode: "JADE" })).toBe("league_classic")
    expect(resolveModeCapability({ gameMode: "ARAM", mapId: 12 })).toBe("aram")
    expect(resolveModeCapability({ gameMode: "CLASSIC", mapId: 11, queueId: 420 })).toBe("rift_draft")
    expect(resolveModeCapability({ gameMode: "FUTURE", mapId: 99 })).toBe("unknown")
  })

  it("distinguishes not-applicable, unknown, and source-unpromised", () => {
    expect(categoryApplicability("aram", "participant.wards")).toBe("not_applicable")
    expect(categoryApplicability("unknown", "participant.wards")).toBe("unknown")
    expect(categoryApplicability("rift_draft", "match.end_state", "league_client"))
      .toBe("source_unpromised")
  })

  it("has stable unique categories and field keys", () => {
    expect(new Set(CAPTURE_CATEGORY_IDS).size).toBe(CAPTURE_CATEGORY_IDS.length)
    const keys = SOURCE_FIELD_REGISTRY_V1.map((field) => field.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain("match.duration_secs")
    expect(keys).toContain("participant.kills")
    expect(keys).toContain("timeline.ward_events")
  })
})
