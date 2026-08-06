export interface DataIntegrityFlagsV1 {
  version: 1
  gradeV3Reads: boolean
  championFormV2: boolean
  rviV3: boolean
  skillReportV3: boolean
  historyImporterV2: boolean
  retentionV2: "disabled" | "report_only" | "apply"
}

export const SAFE_SHADOW_DEFAULTS: Readonly<DataIntegrityFlagsV1> = Object.freeze({
  version: 1,
  gradeV3Reads: false,
  championFormV2: false,
  rviV3: false,
  skillReportV3: false,
  historyImporterV2: false,
  retentionV2: "disabled",
})

export const RELEASE_G_DEFAULTS: Readonly<DataIntegrityFlagsV1> = Object.freeze({
  version: 1,
  gradeV3Reads: true,
  championFormV2: true,
  rviV3: true,
  skillReportV3: true,
  historyImporterV2: true,
  retentionV2: "report_only",
})

/** Release A starts from safe shadow defaults. Later release gates change this one export. */
export const RELEASE_DEFAULTS = SAFE_SHADOW_DEFAULTS

export type DataIntegrityFlagOverridesV1 = Partial<DataIntegrityFlagsV1>

const FLAG_KEYS = [
  "version",
  "gradeV3Reads",
  "championFormV2",
  "rviV3",
  "skillReportV3",
  "historyImporterV2",
  "retentionV2",
] as const

export function validateDataIntegrityFlagOverrides(
  value: unknown,
): DataIntegrityFlagOverridesV1 | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (Object.keys(candidate).some((key) => !FLAG_KEYS.includes(key as typeof FLAG_KEYS[number]))) {
    return undefined
  }
  if (candidate.version !== undefined && candidate.version !== 1) return undefined
  for (const key of [
    "gradeV3Reads",
    "championFormV2",
    "rviV3",
    "skillReportV3",
    "historyImporterV2",
  ] as const) {
    if (candidate[key] !== undefined && typeof candidate[key] !== "boolean") return undefined
  }
  if (candidate.retentionV2 !== undefined &&
      !["disabled", "report_only", "apply"].includes(candidate.retentionV2 as string)) {
    return undefined
  }
  return Object.fromEntries(
    FLAG_KEYS.filter((key) => candidate[key] !== undefined).map((key) => [key, candidate[key]]),
  ) as DataIntegrityFlagOverridesV1
}

export function mergeDataIntegrityFlags(
  defaults: Readonly<DataIntegrityFlagsV1>,
  stored: unknown,
): Readonly<DataIntegrityFlagsV1> {
  if (stored === undefined) return defaults
  const overrides = validateDataIntegrityFlagOverrides(stored)
  if (!overrides) return defaults
  return Object.freeze({ ...defaults, ...overrides, version: 1 })
}
