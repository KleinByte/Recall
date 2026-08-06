import { describe, expect, it } from "vitest"
import {
  evidenceCoverage,
  evidenceValueOrNull,
  invalid,
  isScorableEvidence,
  noOpportunity,
  notApplicable,
  observed,
  summarizeEvidence,
  unavailable,
  unknownEvidence,
} from "../src/shared/measurement.js"

describe("measurement evidence contract", () => {
  it("preserves an observed numeric zero", () => {
    const evidence = observed(0, { source: "league_client" })

    expect(evidence).toEqual({ state: "observed", value: 0, source: "league_client" })
    expect(isScorableEvidence(evidence)).toBe(true)
    expect(evidenceValueOrNull(evidence)).toBe(0)
  })

  it("keeps every non-observed state valueless and unscorable", () => {
    const states = [
      unavailable("field_missing"),
      noOpportunity("baron_never_spawned"),
      invalid("nonfinite"),
      notApplicable("unsupported_mode"),
      unknownEvidence("legacy_unproven"),
    ]

    for (const evidence of states) {
      expect(evidence).not.toHaveProperty("value")
      expect(isScorableEvidence(evidence)).toBe(false)
      expect(evidenceValueOrNull(evidence)).toBeNull()
    }
    expect(summarizeEvidence(states)).toEqual({
      observed: 0,
      unavailable: 1,
      no_opportunity: 1,
      invalid: 1,
      not_applicable: 1,
      unknown: 1,
    })
  })

  it("computes coverage without treating missing evidence as a neutral score", () => {
    const evidence = [
      observed(0),
      unavailable(),
      invalid(),
      unknownEvidence(),
      notApplicable(),
      noOpportunity(),
    ]

    expect(evidenceCoverage(evidence, { noOpportunity: "exclude" })).toEqual({
      observed: 1,
      applicable: 4,
      coverage: 0.25,
    })
    expect(evidenceCoverage(evidence, { noOpportunity: "include" })).toEqual({
      observed: 1,
      applicable: 5,
      coverage: 0.2,
    })
  })
})
