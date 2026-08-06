import { describe, expect, it } from "vitest"
import { readSourceFact, type SourceCaptureManifest } from "../electron/main/database/source-fact-reader.js"

const capture = (overrides: Partial<SourceCaptureManifest> = {}): SourceCaptureManifest => ({
  source: "league_client", current: true, captured: [], partial: [], unavailable: [],
  invalid: [], notApplicable: [], intentionallyIgnored: [], unknown: [], ...overrides,
})

describe("source fact reader", () => {
  const read = (normalizedValue: number | undefined, captures: SourceCaptureManifest[], compatibilityValueExists = false) =>
    readSourceFact({
      key: "participant.kills", normalizedValue, captures, compatibilityValueExists,
      normalizedValueValid: (value): value is number => Number.isSafeInteger(value) && (value as number) >= 0,
    })

  it("returns observed zero only when a current manifest captured it", () => {
    expect(read(0, [capture({ captured: ["participant.kills"] })])).toEqual({
      state: "observed", value: 0, source: "league_client",
    })
    expect(read(0, [], true)).toMatchObject({ state: "unknown", reason: "legacy_unproven" })
  })

  it("preserves invalid, partial, not-applicable, and current unknown states", () => {
    expect(read(0, [capture({ invalid: [{ key: "participant.kills", reason: "invalid_type" }] })]).state)
      .toBe("invalid")
    expect(read(0, [capture({ partial: ["participant.kills"] })])).toMatchObject({
      state: "unavailable", reason: "partial_entities",
    })
    expect(read(0, [capture({ notApplicable: ["participant.kills"] })]).state).toBe("not_applicable")
    expect(read(0, [capture({ unknown: ["participant.kills"] })]).state).toBe("unavailable")
  })
})
