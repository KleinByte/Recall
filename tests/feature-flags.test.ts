import { describe, expect, it } from "vitest"
import {
  RELEASE_G_DEFAULTS,
  SAFE_SHADOW_DEFAULTS,
  mergeDataIntegrityFlags,
  validateDataIntegrityFlagOverrides,
} from "../electron/main/feature-flags.js"

describe("data-integrity feature flags", () => {
  it("pins the safe shadow and Release G defaults", () => {
    expect(SAFE_SHADOW_DEFAULTS).toEqual({
      version: 1,
      gradeV3Reads: false,
      championFormV2: false,
      rviV3: false,
      skillReportV3: false,
      historyImporterV2: false,
      retentionV2: "disabled",
    })
    expect(RELEASE_G_DEFAULTS).toEqual({
      version: 1,
      gradeV3Reads: true,
      championFormV2: true,
      rviV3: true,
      skillReportV3: true,
      historyImporterV2: true,
      retentionV2: "report_only",
    })
  })

  it("validates partial overrides and never persists compiled defaults", () => {
    expect(validateDataIntegrityFlagOverrides({ rviV3: true })).toEqual({ rviV3: true })
    expect(validateDataIntegrityFlagOverrides({ rviV3: "yes" })).toBeUndefined()
    expect(validateDataIntegrityFlagOverrides({ unknown: true })).toBeUndefined()
    expect(mergeDataIntegrityFlags(RELEASE_G_DEFAULTS, { rviV3: false })).toEqual({
      ...RELEASE_G_DEFAULTS,
      rviV3: false,
    })
    expect(mergeDataIntegrityFlags(RELEASE_G_DEFAULTS, undefined)).toBe(RELEASE_G_DEFAULTS)
  })
})
