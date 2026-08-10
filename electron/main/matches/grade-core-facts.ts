/**
 * Raw participant facts that must have been present in the source payload
 * before a participant can contribute to a Recall v3 grade or calibration.
 *
 * Keep these source-facing names stable. They are persisted in
 * `grade_core_missing_fields_json`, so renaming one is a contract migration.
 */
export const GRADE_CORE_FIELDS = [
  "participant_id",
  "team_id",
  "champion_id",
  "kills",
  "deaths",
  "assists",
  "gold_earned",
  "damage_to_champions",
  "total_minions_killed",
  "neutral_minions",
  "damage_objectives",
  "damage_turrets",
  "time_ccing_others",
  "vision_score",
] as const

export type GradeCoreField = typeof GRADE_CORE_FIELDS[number]

export const GRADE_CORE_SOURCES = [
  "league_client",
  "match_v5",
  "legacy_full_detail",
  "legacy_unknown",
] as const

export type GradeCoreSource = typeof GRADE_CORE_SOURCES[number]

export const GRADE_CORE_FACT_CONTRACT_VERSION = 1 as const

export type RawGradeCoreFacts = Partial<Record<GradeCoreField, unknown>>

export interface GradeCoreFactAssessment {
  gradeCoreComplete: 0 | 1
  gradeCoreSource: GradeCoreSource
  gradeCoreMissingFields: GradeCoreField[]
  gradeCoreContractVersion: typeof GRADE_CORE_FACT_CONTRACT_VERSION
}

const ID_FIELDS = new Set<GradeCoreField>([
  "participant_id",
  "team_id",
  "champion_id",
])

function isObservedCoreFact(field: GradeCoreField, value: unknown): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false
  if (ID_FIELDS.has(field)) return Number.isSafeInteger(value) && value > 0
  // A real zero is common for kills, vision, CC, and objective damage. It is
  // evidence, not absence. Negative counters are malformed source data.
  return value >= 0
}

/**
 * Assess the uncoerced source payload. Call this before mapper helpers turn an
 * absent numeric value into the storage-compatible zero fallback.
 */
export function assessGradeCoreFacts(
  source: Extract<GradeCoreSource, "league_client" | "match_v5">,
  facts: RawGradeCoreFacts,
): GradeCoreFactAssessment {
  const gradeCoreMissingFields = GRADE_CORE_FIELDS.filter(
    (field) => !isObservedCoreFact(field, facts[field]),
  )
  return {
    gradeCoreComplete: gradeCoreMissingFields.length === 0 ? 1 : 0,
    gradeCoreSource: source,
    gradeCoreMissingFields,
    gradeCoreContractVersion: GRADE_CORE_FACT_CONTRACT_VERSION,
  }
}

export function isGradeCoreField(value: unknown): value is GradeCoreField {
  return typeof value === "string" &&
    (GRADE_CORE_FIELDS as readonly string[]).includes(value)
}

export function isGradeCoreSource(value: unknown): value is GradeCoreSource {
  return typeof value === "string" &&
    (GRADE_CORE_SOURCES as readonly string[]).includes(value)
}
